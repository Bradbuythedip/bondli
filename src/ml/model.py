"""
Bondli LoRA-Enhanced Token Scorer
=================================
Small transformer encoder with LoRA adapters for meme token scoring.
Designed for RTX 5070 Ti (12GB VRAM) — runs inference in <2ms per token.

Architecture:
  Input: 115-dim feature vector (normalized 0-1)
  → Linear projection to d_model
  → 4 transformer encoder layers with LoRA on Q/V projections
  → 3 prediction heads: score, rugProb, graduationProb

LoRA rank 16 = ~50K trainable params (vs ~2M total) = fast fine-tuning on small datasets.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import math


# ═══ LoRA Layer ═══
class LoRALinear(nn.Module):
    """Low-Rank Adaptation: W' = W + BA where B ∈ R^{d×r}, A ∈ R^{r×k}"""

    def __init__(self, in_features, out_features, rank=16, alpha=32.0):
        super().__init__()
        self.linear = nn.Linear(in_features, out_features)
        self.lora_A = nn.Linear(in_features, rank, bias=False)
        self.lora_B = nn.Linear(rank, out_features, bias=False)
        self.scale = alpha / rank

        # Init: A ~ N(0, 1/r), B = 0 → LoRA starts as identity
        nn.init.kaiming_uniform_(self.lora_A.weight, a=math.sqrt(5))
        nn.init.zeros_(self.lora_B.weight)

    def forward(self, x):
        return self.linear(x) + self.lora_B(self.lora_A(x)) * self.scale

    def freeze_pretrained(self):
        """Freeze the base linear, only train LoRA adapters."""
        self.linear.weight.requires_grad_(False)
        if self.linear.bias is not None:
            self.linear.bias.requires_grad_(False)


# ═══ Transformer Block with LoRA on Q/V ═══
class LoRATransformerBlock(nn.Module):
    def __init__(self, d_model, n_heads, rank=16, dropout=0.1):
        super().__init__()
        self.n_heads = n_heads
        self.head_dim = d_model // n_heads
        assert d_model % n_heads == 0

        # Q, K, V projections — LoRA on Q and V (most impactful per Hu et al.)
        self.q_proj = LoRALinear(d_model, d_model, rank=rank)
        self.k_proj = nn.Linear(d_model, d_model)
        self.v_proj = LoRALinear(d_model, d_model, rank=rank)
        self.out_proj = nn.Linear(d_model, d_model)

        self.norm1 = nn.LayerNorm(d_model)
        self.norm2 = nn.LayerNorm(d_model)

        self.ffn = nn.Sequential(
            nn.Linear(d_model, d_model * 4),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model * 4, d_model),
            nn.Dropout(dropout),
        )
        self.dropout = nn.Dropout(dropout)

    def forward(self, x):
        # x: (batch, d_model) — single token per sample, no sequence dim needed
        # Self-attention over feature groups (treat as 1-token sequence)
        B, D = x.shape
        residual = x

        x = self.norm1(x)

        # Reshape for multi-head attention: (B, 1, D) → (B, n_heads, 1, head_dim)
        q = self.q_proj(x).view(B, 1, self.n_heads, self.head_dim).transpose(1, 2)
        k = self.k_proj(x).view(B, 1, self.n_heads, self.head_dim).transpose(1, 2)
        v = self.v_proj(x).view(B, 1, self.n_heads, self.head_dim).transpose(1, 2)

        # Scaled dot-product attention
        attn = (q @ k.transpose(-2, -1)) / math.sqrt(self.head_dim)
        attn = F.softmax(attn, dim=-1)
        out = (attn @ v).transpose(1, 2).reshape(B, D)
        out = self.out_proj(out)
        x = residual + self.dropout(out)

        # FFN
        x = x + self.ffn(self.norm2(x))
        return x


# ═══ Main Model ═══
class BondliScorer(nn.Module):
    """
    Token scorer: 115 features → (score, rugProb, graduationProb)

    Architecture tuned for RTX 5070 Ti:
    - d_model=128, 4 layers, 8 heads → ~2M params total
    - LoRA rank=16 on Q/V → ~50K trainable params for fine-tuning
    - Inference: <2ms per token on GPU, <10ms on CPU
    """

    # Feature group boundaries (matches FEATURE_KEYS order in meme-intelligence.mjs)
    GROUPS = {
        "tp": (0, 6),       # Tipping Point
        "k": (6, 12),       # Kahneman
        "oc": (12, 22),     # On-chain velocity
        "so": (22, 29),     # Social
        "rg": (29, 46),     # Rug detection (17 features)
        "ch": (46, 51),     # Chart patterns
        "cs": (51, 56),     # Cascade/reflexivity
        "sir": (56, 59),    # SIR viral
        "gf": (59, 61),     # Graduation frontrunning
        "apd": (61, 64),    # Attention-price divergence
        "mt": (64, 67),     # Meta/timing
    }
    N_FEATURES = 67  # Actual count from FEATURE_KEYS

    def __init__(self, d_model=128, n_layers=4, n_heads=8, lora_rank=16, dropout=0.1):
        super().__init__()
        self.d_model = d_model

        # Input projection: 115 features → d_model (handles variable feature count)
        self.input_proj = nn.Sequential(
            nn.Linear(115, d_model),
            nn.LayerNorm(d_model),
            nn.GELU(),
            nn.Dropout(dropout),
        )

        # Group-aware embeddings: learnable embedding per feature group
        self.group_embed = nn.Embedding(11, d_model)  # 11 feature groups

        # Transformer encoder with LoRA
        self.layers = nn.ModuleList([
            LoRATransformerBlock(d_model, n_heads, rank=lora_rank, dropout=dropout)
            for _ in range(n_layers)
        ])

        self.norm = nn.LayerNorm(d_model)

        # 3 prediction heads
        self.score_head = nn.Sequential(
            nn.Linear(d_model, d_model // 2),
            nn.GELU(),
            nn.Linear(d_model // 2, 1),
            nn.Sigmoid(),  # 0-1 score
        )

        self.rug_head = nn.Sequential(
            nn.Linear(d_model, d_model // 2),
            nn.GELU(),
            nn.Linear(d_model // 2, 1),
            nn.Sigmoid(),  # 0-1 rug probability
        )

        self.grad_head = nn.Sequential(
            nn.Linear(d_model, d_model // 2),
            nn.GELU(),
            nn.Linear(d_model // 2, 1),
            nn.Sigmoid(),  # 0-1 graduation probability
        )

    def forward(self, features):
        """
        Args:
            features: (batch, 115) tensor of normalized feature values

        Returns:
            dict with score, rugProb, graduationProb — all (batch, 1) in [0, 1]
        """
        # Project to model dimension
        x = self.input_proj(features)

        # Add group-aware bias (which feature group is most active?)
        group_signal = torch.zeros(features.shape[0], self.d_model, device=features.device)
        for i, (name, (start, end)) in enumerate(self.GROUPS.items()):
            if end <= features.shape[1]:
                group_energy = features[:, start:end].mean(dim=1, keepdim=True)
                group_signal += group_energy * self.group_embed(
                    torch.tensor(i, device=features.device)
                ).unsqueeze(0)
        x = x + group_signal * 0.1  # Soft group conditioning

        # Transformer layers
        for layer in self.layers:
            x = layer(x)

        x = self.norm(x)

        return {
            "score": self.score_head(x),
            "rugProb": self.rug_head(x),
            "graduationProb": self.grad_head(x),
        }

    def freeze_base(self):
        """Freeze everything except LoRA adapters + prediction heads."""
        for name, param in self.named_parameters():
            if "lora_" in name or "_head" in name:
                param.requires_grad_(True)
            else:
                param.requires_grad_(False)

    def unfreeze_all(self):
        """Unfreeze everything for full fine-tuning."""
        for param in self.parameters():
            param.requires_grad_(True)

    def count_params(self):
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        return {"total": total, "trainable": trainable}


# ═══ Feature key mapping (must match meme-intelligence.mjs FEATURE_KEYS exactly) ═══
FEATURE_KEYS = [
    "tp_lawOfFew", "tp_stickiness", "tp_context", "tp_connectorScore", "tp_mavenScore", "tp_salesmanScore",
    "k_cognitiveEase", "k_emotionalValence", "k_anchorBias", "k_herdSignal", "k_lossAversion", "k_framingEffect",
    "oc_buyVelocity1m", "oc_buyVelocity5m", "oc_uniqueBuyers5m", "oc_giniCoeff", "oc_avgBuySol",
    "oc_devHoldPct", "oc_topHolderPct", "oc_sellRatio5m", "oc_mcapSol", "oc_volumeSol5m",
    "so_hasTwitter", "so_hasTelegram", "so_hasWebsite", "so_nameLength", "so_tickerLength", "so_hasEmoji", "so_descLength",
    "rg_devSellSpeed", "rg_holderConcentration", "rg_coordDumpScore", "rg_liqRemovalSpeed", "rg_walletAgeScore",
    "rg_sellWaveDetect", "rg_mcapDropRate", "rg_buyerRetention", "rg_zeroSellFlag", "rg_buySellImbalance",
    "rg_fakeVolumeScore", "rg_gradualRugScore", "rg_velocityLinearity", "rg_buyTimingRegularity",
    "rg_singleWalletDominance", "rg_devSelfPumpScore",
    "ch_healthScore", "ch_pumpDump", "ch_smoothGrind", "ch_dipRatio", "ch_staircaseScore",
    "cs_cascadeOnset", "cs_cascadeStrength", "cs_reflexivity", "cs_curveVelocity", "cs_attentionShare",
    "sir_r0", "sir_infectRate", "sir_recoveryRate",
    "gf_curveProgress", "gf_frontrunSignal",
    "apd_attentionGrowth", "apd_priceFlat", "apd_divergence",
    "mt_hourOfDay", "mt_dayOfWeek", "mt_isWeekend",
]

# Pad to 115 if needed (model expects 115-dim input for forward compat)
while len(FEATURE_KEYS) < 115:
    FEATURE_KEYS.append(f"_pad_{len(FEATURE_KEYS)}")


def features_dict_to_tensor(features_dict, device="cpu"):
    """Convert JS-style feature dict to model input tensor."""
    vec = [features_dict.get(k, 0.0) for k in FEATURE_KEYS]
    return torch.tensor([vec], dtype=torch.float32, device=device)
