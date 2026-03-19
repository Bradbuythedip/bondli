#!/bin/bash
# ═══════════════════════════════════════
# Bondli LoRA GPU Setup — RTX 5070 Ti
# ═══════════════════════════════════════
#
# Usage:
#   chmod +x src/ml/setup.sh
#   ./src/ml/setup.sh
#
# This script:
#   1. Creates a Python venv
#   2. Installs PyTorch with CUDA 12.x support
#   3. Installs inference server dependencies
#   4. Trains the initial model (synthetic data if no trade history)
#   5. Starts the inference server

set -e
cd "$(dirname "$0")"

echo "═══════════════════════════════════════"
echo "  BONDLI LoRA GPU Setup"
echo "═══════════════════════════════════════"

# 1. Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo "[1/5] Creating Python virtual environment..."
    python3 -m venv venv
else
    echo "[1/5] Venv already exists"
fi

source venv/bin/activate

# 2. Install PyTorch with CUDA
echo "[2/5] Installing PyTorch + CUDA..."
# Detect if NVIDIA GPU is available
if command -v nvidia-smi &> /dev/null; then
    echo "  GPU detected: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo 'unknown')"
    pip install --upgrade pip
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124 2>/dev/null || \
    pip install torch torchvision  # Fallback to default
else
    echo "  No NVIDIA GPU detected — using CPU"
    pip install --upgrade pip
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
fi

# 3. Install other dependencies
echo "[3/5] Installing dependencies..."
pip install fastapi uvicorn[standard] pydantic redis

# 4. Train initial model
echo "[4/5] Training initial model..."
python train.py --epochs 30

# 5. Verify
echo "[5/5] Verifying..."
python -c "
import torch
print(f'  PyTorch: {torch.__version__}')
print(f'  CUDA available: {torch.cuda.is_available()}')
if torch.cuda.is_available():
    print(f'  GPU: {torch.cuda.get_device_name(0)}')
    print(f'  VRAM: {torch.cuda.get_device_properties(0).total_mem / 1e9:.1f} GB')
from model import BondliScorer
m = BondliScorer()
p = m.count_params()
print(f'  Model: {p[\"total\"]:,} params ({p[\"trainable\"]:,} trainable with LoRA)')
"

echo ""
echo "═══════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  Start inference server:"
echo "    cd src/ml && source venv/bin/activate"
echo "    python serve.py"
echo ""
echo "  Train with your data:"
echo "    python train.py                    # From Redis"
echo "    python train.py --from-json data.json  # From export"
echo "    python train.py --epochs 100       # More training"
echo ""
echo "  The Node.js engine auto-detects the"
echo "  LoRA server and blends predictions."
echo "═══════════════════════════════════════"
