"""
Bondli LoRA Inference Server
==============================
FastAPI server for GPU-accelerated token scoring.
Designed for RTX 5070 Ti — serves predictions in <5ms.

Usage:
    python src/ml/serve.py                          # Start on port 8420
    python src/ml/serve.py --port 8420 --device cuda  # Explicit GPU
    python src/ml/serve.py --device cpu               # CPU fallback

Endpoints:
    POST /predict         — Score a single token (features dict → score, rugProb, graduationProb)
    POST /predict/batch   — Score multiple tokens at once (up to 100)
    GET  /health          — Model status, device info, latency benchmark
    POST /reload          — Hot-reload model weights without restart
"""

import json
import os
import sys
import time
from pathlib import Path
from contextlib import asynccontextmanager

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent))
from model import BondliScorer, FEATURE_KEYS, features_dict_to_tensor

CHECKPOINT_DIR = Path(__file__).parent / "checkpoints"
MODEL_PATH = CHECKPOINT_DIR / "bondli_scorer_latest.pt"
LORA_PATH = CHECKPOINT_DIR / "bondli_lora_latest.pt"


# ═══ Global model state ═══
class ModelState:
    model: BondliScorer = None
    device: torch.device = None
    loaded: bool = False
    load_time: float = 0
    inference_count: int = 0
    avg_latency_ms: float = 0


state = ModelState()


def load_model(device_str="auto"):
    """Load or reload the model."""
    if device_str == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(device_str)

    model = BondliScorer(d_model=128, n_layers=4, n_heads=8, lora_rank=16, dropout=0.0)

    # Try loading full checkpoint, then LoRA-only
    if MODEL_PATH.exists():
        sd = torch.load(MODEL_PATH, map_location=device, weights_only=True)
        model.load_state_dict(sd, strict=False)
        print(f"[SERVE] Loaded full checkpoint: {MODEL_PATH}")
    elif LORA_PATH.exists():
        sd = torch.load(LORA_PATH, map_location=device, weights_only=True)
        model.load_state_dict(sd, strict=False)
        print(f"[SERVE] Loaded LoRA checkpoint: {LORA_PATH}")
    else:
        print(f"[SERVE] No checkpoint found — using random init (train first!)")

    model = model.to(device)
    model.eval()

    # Warmup: run a few dummy inferences to JIT compile CUDA kernels
    if device.type == "cuda":
        dummy = torch.randn(1, 115, device=device)
        with torch.no_grad():
            for _ in range(10):
                model(dummy)
            torch.cuda.synchronize()
        print(f"[SERVE] CUDA warmup complete — {torch.cuda.get_device_name(0)}")

    state.model = model
    state.device = device
    state.loaded = True
    state.load_time = time.time()

    params = model.count_params()
    print(f"[SERVE] Model ready: {params['total']:,} params on {device}")
    return model


# ═══ Request/Response models ═══
class PredictRequest(BaseModel):
    features: dict  # Feature dict matching FEATURE_KEYS

class BatchPredictRequest(BaseModel):
    tokens: list[dict]  # List of feature dicts (max 100)

class PredictResponse(BaseModel):
    score: float          # 0-100 composite score
    rugProb: float        # 0-1 rug probability
    graduationProb: float # 0-1 graduation probability
    latency_ms: float     # Inference time

class BatchPredictResponse(BaseModel):
    predictions: list[PredictResponse]
    total_latency_ms: float


# ═══ App lifecycle ═══
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: load model
    device_str = os.environ.get("BONDLI_ML_DEVICE", "auto")
    load_model(device_str)
    yield
    # Shutdown: cleanup
    if state.device and state.device.type == "cuda":
        torch.cuda.empty_cache()


app = FastAPI(
    title="Bondli LoRA Scorer",
    version="1.0.0",
    lifespan=lifespan,
)


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    """Score a single token from its feature vector."""
    if not state.loaded:
        raise HTTPException(503, "Model not loaded")

    start = time.time()

    # Build input tensor
    vec = [float(req.features.get(k, 0.0)) for k in FEATURE_KEYS]
    inp = torch.tensor([vec], dtype=torch.float32, device=state.device)

    with torch.no_grad():
        preds = state.model(inp)

    if state.device.type == "cuda":
        torch.cuda.synchronize()

    elapsed_ms = (time.time() - start) * 1000

    # Update stats
    state.inference_count += 1
    state.avg_latency_ms = (state.avg_latency_ms * (state.inference_count - 1) + elapsed_ms) / state.inference_count

    score_raw = preds["score"].item()
    return PredictResponse(
        score=round(score_raw * 100, 1),
        rugProb=round(preds["rugProb"].item(), 4),
        graduationProb=round(preds["graduationProb"].item(), 4),
        latency_ms=round(elapsed_ms, 2),
    )


@app.post("/predict/batch", response_model=BatchPredictResponse)
async def predict_batch(req: BatchPredictRequest):
    """Score multiple tokens in a single GPU batch (max 100)."""
    if not state.loaded:
        raise HTTPException(503, "Model not loaded")
    if len(req.tokens) > 100:
        raise HTTPException(400, "Max 100 tokens per batch")
    if len(req.tokens) == 0:
        return BatchPredictResponse(predictions=[], total_latency_ms=0)

    start = time.time()

    # Build batched input
    batch = []
    for features in req.tokens:
        vec = [float(features.get(k, 0.0)) for k in FEATURE_KEYS]
        batch.append(vec)
    inp = torch.tensor(batch, dtype=torch.float32, device=state.device)

    with torch.no_grad():
        preds = state.model(inp)

    if state.device.type == "cuda":
        torch.cuda.synchronize()

    elapsed_ms = (time.time() - start) * 1000
    per_token_ms = elapsed_ms / len(req.tokens)

    predictions = []
    for i in range(len(req.tokens)):
        predictions.append(PredictResponse(
            score=round(preds["score"][i].item() * 100, 1),
            rugProb=round(preds["rugProb"][i].item(), 4),
            graduationProb=round(preds["graduationProb"][i].item(), 4),
            latency_ms=round(per_token_ms, 2),
        ))

    state.inference_count += len(req.tokens)

    return BatchPredictResponse(
        predictions=predictions,
        total_latency_ms=round(elapsed_ms, 2),
    )


@app.get("/health")
async def health():
    """Model status, GPU info, latency stats."""
    info = {
        "loaded": state.loaded,
        "device": str(state.device) if state.device else None,
        "inference_count": state.inference_count,
        "avg_latency_ms": round(state.avg_latency_ms, 2),
        "uptime_s": round(time.time() - state.load_time, 1) if state.loaded else 0,
    }

    if state.device and state.device.type == "cuda":
        info["gpu"] = torch.cuda.get_device_name(0)
        info["vram_total_gb"] = round(torch.cuda.get_device_properties(0).total_mem / 1e9, 1)
        info["vram_used_gb"] = round(torch.cuda.memory_allocated(0) / 1e9, 3)
        info["vram_reserved_gb"] = round(torch.cuda.memory_reserved(0) / 1e9, 3)

    if state.loaded:
        params = state.model.count_params()
        info["params_total"] = params["total"]
        info["params_trainable"] = params["trainable"]

        # Quick benchmark
        dummy = torch.randn(1, 115, device=state.device)
        with torch.no_grad():
            t0 = time.time()
            for _ in range(100):
                state.model(dummy)
            if state.device.type == "cuda":
                torch.cuda.synchronize()
            info["benchmark_ms_per_token"] = round((time.time() - t0) / 100 * 1000, 3)

    return info


@app.post("/reload")
async def reload():
    """Hot-reload model weights without restarting server."""
    try:
        device_str = str(state.device) if state.device else "auto"
        load_model(device_str)
        return {"ok": True, "message": "Model reloaded", "device": str(state.device)}
    except Exception as e:
        raise HTTPException(500, f"Reload failed: {e}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8420)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--device", type=str, default="auto", choices=["auto", "cuda", "cpu"])
    args = parser.parse_args()

    os.environ["BONDLI_ML_DEVICE"] = args.device

    print(f"[SERVE] Starting Bondli LoRA server on {args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
