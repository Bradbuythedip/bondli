"""
Bondli LoRA Training Script
============================
Pulls trade outcomes from Redis, trains the LoRA-enhanced scorer.

Usage:
    python src/ml/train.py                     # Train from Redis data
    python src/ml/train.py --epochs 100        # Custom epochs
    python src/ml/train.py --from-json data.json  # Train from exported JSON

Data format (from Redis stream:trade_outcomes):
    { features: {...}, outcome: { graduated, peakMcx, fleetPnl, rugged, alive } }

Output:
    src/ml/checkpoints/bondli_scorer_latest.pt  — full model
    src/ml/checkpoints/bondli_lora_latest.pt    — LoRA weights only (small, fast to load)
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader

# Add parent to path for model import
sys.path.insert(0, str(Path(__file__).parent))
from model import BondliScorer, FEATURE_KEYS, features_dict_to_tensor

CHECKPOINT_DIR = Path(__file__).parent / "checkpoints"
CHECKPOINT_DIR.mkdir(exist_ok=True)


# ═══ Dataset ═══
class TradeOutcomeDataset(Dataset):
    """Dataset of (features, labels) from trade outcomes."""

    def __init__(self, records):
        self.samples = []
        for r in records:
            features = r.get("features", {})
            outcome = r.get("outcome", {})

            # Feature vector (115-dim, padded)
            vec = [float(features.get(k, 0.0)) for k in FEATURE_KEYS]

            # Labels
            graduated = 1.0 if outcome.get("graduated") else 0.0
            rugged = 1.0 if outcome.get("rugged") else 0.0
            peak_mcx = float(outcome.get("peakMcx", 1.0))
            pnl = float(outcome.get("fleetPnl", 0.0))

            # Score label: same as outcomeToLabel in meme-intelligence.mjs
            score = 0.25  # skeptical baseline
            if graduated:
                score += 0.4
            if peak_mcx > 5:
                score += 0.15
            if peak_mcx > 10:
                score += 0.1
            if outcome.get("alive"):
                score += 0.1
            if rugged:
                score -= 0.7
            if peak_mcx < 0.2:  # 80%+ drop
                score -= 0.4
            if outcome.get("devDumped"):
                score -= 0.5
            score = max(0.0, min(1.0, score))

            # Rug probability: binary (was this a rug pull?)
            rug_prob = 1.0 if (rugged or peak_mcx < 0.3 or outcome.get("devDumped")) else 0.0

            # Graduation probability
            grad_prob = graduated

            self.samples.append({
                "features": torch.tensor(vec, dtype=torch.float32),
                "score": torch.tensor([score], dtype=torch.float32),
                "rugProb": torch.tensor([rug_prob], dtype=torch.float32),
                "graduationProb": torch.tensor([grad_prob], dtype=torch.float32),
            })

        print(f"[TRAIN] Dataset: {len(self.samples)} samples")
        if self.samples:
            scores = [s["score"].item() for s in self.samples]
            rugs = sum(1 for s in self.samples if s["rugProb"].item() > 0.5)
            grads = sum(1 for s in self.samples if s["graduationProb"].item() > 0.5)
            print(f"[TRAIN] Score range: {min(scores):.3f} - {max(scores):.3f}, mean: {sum(scores)/len(scores):.3f}")
            print(f"[TRAIN] Rugs: {rugs}/{len(self.samples)} ({rugs/len(self.samples)*100:.1f}%)")
            print(f"[TRAIN] Graduated: {grads}/{len(self.samples)} ({grads/len(self.samples)*100:.1f}%)")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        return self.samples[idx]


def load_from_redis(host="127.0.0.1", port=6379):
    """Pull trade outcomes from Redis stream."""
    try:
        import redis
    except ImportError:
        print("[TRAIN] pip install redis — falling back to JSON mode")
        return []

    r = redis.Redis(host=host, port=port, decode_responses=True)

    records = []

    # Method 1: Redis stream (stream:trade_outcomes)
    try:
        stream_data = r.xrange("stream:trade_outcomes", count=10000)
        for _id, fields in stream_data:
            try:
                data = json.loads(fields.get("data", "{}"))
                if "features" in data and "outcome" in data:
                    records.append(data)
            except (json.JSONDecodeError, KeyError):
                continue
        print(f"[TRAIN] Loaded {len(records)} from Redis stream")
    except Exception as e:
        print(f"[TRAIN] Stream read failed: {e}")

    # Method 2: Intel memory (intel:memory) — scored tokens with outcomes
    try:
        raw = r.get("intel:memory")
        if raw:
            memory = json.loads(raw)
            for item in memory:
                if "features" in item and "outcome" in item:
                    records.append(item)
            print(f"[TRAIN] +{len(memory)} from intel:memory")
    except Exception as e:
        print(f"[TRAIN] Memory read failed: {e}")

    # Method 3: Survivor/dead archives from survivorship-bias engine
    for key in ["survivor:archive", "dead:archive"]:
        try:
            raw = r.get(key)
            if raw:
                archive = json.loads(raw)
                for item in archive:
                    if "features" in item:
                        # Construct outcome from archive metadata
                        outcome = {
                            "graduated": item.get("graduated", False),
                            "rugged": item.get("rugged", False),
                            "peakMcx": item.get("peakMcx", 1.0),
                            "fleetPnl": item.get("pnl", 0.0),
                            "alive": item.get("alive", False),
                            "devDumped": item.get("devDumped", False),
                        }
                        records.append({"features": item["features"], "outcome": outcome})
                print(f"[TRAIN] +{len(archive)} from {key}")
        except Exception as e:
            print(f"[TRAIN] {key} read failed: {e}")

    return records


def load_from_json(path):
    """Load from exported JSON file."""
    with open(path) as f:
        data = json.load(f)
    # Handle both array and { records: [...] } format
    if isinstance(data, list):
        return data
    if "records" in data:
        return data["records"]
    if "learner" in data and "history" in data["learner"]:
        return data["learner"]["history"]
    return []


def train(args):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[TRAIN] Device: {device}")
    if device.type == "cuda":
        print(f"[TRAIN] GPU: {torch.cuda.get_device_name(0)}")
        print(f"[TRAIN] VRAM: {torch.cuda.get_device_properties(0).total_mem / 1e9:.1f} GB")

    # Load data
    if args.from_json:
        records = load_from_json(args.from_json)
    else:
        records = load_from_redis(args.redis_host, args.redis_port)

    if len(records) < 10:
        print("[TRAIN] Not enough data. Need at least 10 trade outcomes.")
        print("[TRAIN] Generate data by trading with bondli, or export session logs.")
        # Create synthetic warmup data so the model can still be initialized
        print("[TRAIN] Creating synthetic warmup dataset (200 samples)...")
        records = generate_synthetic_data(200)

    dataset = TradeOutcomeDataset(records)

    # Split: 85% train, 15% validation
    val_size = max(1, int(len(dataset) * 0.15))
    train_size = len(dataset) - val_size
    train_ds, val_ds = torch.utils.data.random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, drop_last=False)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False)

    # Model
    model = BondliScorer(
        d_model=args.d_model,
        n_layers=args.n_layers,
        n_heads=args.n_heads,
        lora_rank=args.lora_rank,
        dropout=args.dropout,
    ).to(device)

    # Load existing checkpoint if resuming
    latest_path = CHECKPOINT_DIR / "bondli_scorer_latest.pt"
    if latest_path.exists() and not args.from_scratch:
        state = torch.load(latest_path, map_location=device, weights_only=True)
        model.load_state_dict(state, strict=False)
        print(f"[TRAIN] Resumed from {latest_path}")

    # Freeze base for LoRA-only fine-tuning (or train full if specified)
    if args.full_finetune:
        model.unfreeze_all()
        print("[TRAIN] Mode: Full fine-tune (all params)")
    else:
        model.freeze_base()
        print("[TRAIN] Mode: LoRA fine-tune (adapters + heads only)")

    params = model.count_params()
    print(f"[TRAIN] Params: {params['total']:,} total, {params['trainable']:,} trainable")

    # Optimizer
    optimizer = optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=args.lr,
        weight_decay=args.weight_decay,
    )

    # Learning rate scheduler: cosine annealing with warmup
    warmup_steps = min(50, len(train_loader) * 2)
    total_steps = len(train_loader) * args.epochs

    def lr_lambda(step):
        if step < warmup_steps:
            return step / max(1, warmup_steps)
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        return 0.5 * (1.0 + math.cos(math.pi * progress))

    import math
    scheduler = optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    # Loss: weighted combination — rug detection matters most (matches 3.0x group weight)
    score_criterion = nn.MSELoss()
    rug_criterion = nn.BCELoss()
    grad_criterion = nn.BCELoss()

    # Asymmetric loss weights — missing a rug is worse than missing a gem
    SCORE_WEIGHT = 1.0
    RUG_WEIGHT = 3.0  # Matches rg group weight of 3.0
    GRAD_WEIGHT = 1.5

    best_val_loss = float("inf")
    step = 0

    print(f"\n[TRAIN] Starting training: {args.epochs} epochs, batch_size={args.batch_size}")
    print(f"[TRAIN] Train: {train_size}, Val: {val_size}")
    print("=" * 60)

    for epoch in range(args.epochs):
        model.train()
        epoch_loss = 0.0
        epoch_rug_correct = 0
        epoch_total = 0

        for batch in train_loader:
            features = batch["features"].to(device)
            target_score = batch["score"].to(device)
            target_rug = batch["rugProb"].to(device)
            target_grad = batch["graduationProb"].to(device)

            preds = model(features)

            loss_score = score_criterion(preds["score"], target_score)
            loss_rug = rug_criterion(preds["rugProb"], target_rug)
            loss_grad = grad_criterion(preds["graduationProb"], target_grad)

            loss = SCORE_WEIGHT * loss_score + RUG_WEIGHT * loss_rug + GRAD_WEIGHT * loss_grad

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()

            epoch_loss += loss.item() * features.shape[0]
            rug_pred = (preds["rugProb"] > 0.5).float()
            epoch_rug_correct += (rug_pred == target_rug).sum().item()
            epoch_total += features.shape[0]
            step += 1

        avg_loss = epoch_loss / max(1, epoch_total)
        rug_acc = epoch_rug_correct / max(1, epoch_total) * 100

        # Validation
        model.eval()
        val_loss = 0.0
        val_rug_correct = 0
        val_grad_correct = 0
        val_total = 0

        with torch.no_grad():
            for batch in val_loader:
                features = batch["features"].to(device)
                target_score = batch["score"].to(device)
                target_rug = batch["rugProb"].to(device)
                target_grad = batch["graduationProb"].to(device)

                preds = model(features)
                loss = (SCORE_WEIGHT * score_criterion(preds["score"], target_score)
                        + RUG_WEIGHT * rug_criterion(preds["rugProb"], target_rug)
                        + GRAD_WEIGHT * grad_criterion(preds["graduationProb"], target_grad))

                val_loss += loss.item() * features.shape[0]
                val_rug_correct += ((preds["rugProb"] > 0.5).float() == target_rug).sum().item()
                val_grad_correct += ((preds["graduationProb"] > 0.5).float() == target_grad).sum().item()
                val_total += features.shape[0]

        avg_val_loss = val_loss / max(1, val_total)
        val_rug_acc = val_rug_correct / max(1, val_total) * 100
        val_grad_acc = val_grad_correct / max(1, val_total) * 100

        # Log every 5 epochs or first/last
        if epoch % 5 == 0 or epoch == args.epochs - 1:
            lr = scheduler.get_last_lr()[0]
            print(f"  Epoch {epoch+1:3d}/{args.epochs} | "
                  f"loss: {avg_loss:.4f} | val_loss: {avg_val_loss:.4f} | "
                  f"rug_acc: {rug_acc:.1f}% | val_rug: {val_rug_acc:.1f}% | val_grad: {val_grad_acc:.1f}% | "
                  f"lr: {lr:.6f}")

        # Save best model
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            torch.save(model.state_dict(), CHECKPOINT_DIR / "bondli_scorer_best.pt")
            # Save LoRA weights only (much smaller file)
            lora_state = {k: v for k, v in model.state_dict().items() if "lora_" in k or "_head" in k}
            torch.save(lora_state, CHECKPOINT_DIR / "bondli_lora_best.pt")

    # Save final checkpoint
    torch.save(model.state_dict(), CHECKPOINT_DIR / "bondli_scorer_latest.pt")
    lora_state = {k: v for k, v in model.state_dict().items() if "lora_" in k or "_head" in k}
    torch.save(lora_state, CHECKPOINT_DIR / "bondli_lora_latest.pt")

    print("=" * 60)
    print(f"[TRAIN] Done! Best val_loss: {best_val_loss:.4f}")
    print(f"[TRAIN] Saved: {CHECKPOINT_DIR / 'bondli_scorer_latest.pt'}")
    print(f"[TRAIN] LoRA:  {CHECKPOINT_DIR / 'bondli_lora_latest.pt'}")

    # Quick inference benchmark
    model.eval()
    dummy = torch.randn(1, 115, device=device)
    with torch.no_grad():
        start = time.time()
        for _ in range(1000):
            model(dummy)
        if device.type == "cuda":
            torch.cuda.synchronize()
        elapsed = (time.time() - start) / 1000 * 1000  # ms per inference
    print(f"[TRAIN] Inference speed: {elapsed:.2f} ms/token ({device})")


def generate_synthetic_data(n=200):
    """Generate synthetic training data for model warmup."""
    import random
    records = []
    for _ in range(n):
        features = {}
        for k in FEATURE_KEYS:
            if k.startswith("_pad_"):
                features[k] = 0.0
            elif k.startswith("rg_"):
                features[k] = random.random() * 0.8  # Rug features vary
            else:
                features[k] = random.random()

        # Determine outcome based on features (somewhat realistic)
        rug_score = sum(features.get(k, 0) for k in FEATURE_KEYS if k.startswith("rg_")) / 15
        is_rug = rug_score > 0.45 or random.random() < 0.3
        is_graduated = not is_rug and random.random() < 0.15

        outcome = {
            "graduated": is_graduated,
            "rugged": is_rug,
            "peakMcx": random.uniform(0.1, 0.5) if is_rug else random.uniform(1.0, 20.0) if is_graduated else random.uniform(0.5, 3.0),
            "fleetPnl": random.uniform(-0.5, -0.1) if is_rug else random.uniform(0.1, 5.0) if is_graduated else random.uniform(-0.2, 0.3),
            "alive": not is_rug and random.random() < 0.5,
            "devDumped": is_rug and random.random() < 0.4,
        }
        records.append({"features": features, "outcome": outcome})
    return records


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Bondli LoRA scorer")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--d-model", type=int, default=128)
    parser.add_argument("--n-layers", type=int, default=4)
    parser.add_argument("--n-heads", type=int, default=8)
    parser.add_argument("--lora-rank", type=int, default=16)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--from-json", type=str, default=None, help="Train from exported JSON file")
    parser.add_argument("--from-scratch", action="store_true", help="Don't load existing checkpoint")
    parser.add_argument("--full-finetune", action="store_true", help="Train all params, not just LoRA")
    parser.add_argument("--redis-host", type=str, default="127.0.0.1")
    parser.add_argument("--redis-port", type=int, default=6379)

    args = parser.parse_args()
    train(args)
