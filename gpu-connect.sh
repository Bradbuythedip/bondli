#!/bin/bash
# ══════════════════════════════════════════════════════════
#   BONDLI GPU — One command to connect your GPU
# ══════════════════════════════════════════════════════════
#
#   curl -sSL https://bondli.fun/gpu | bash
#
#   Or locally:
#     chmod +x gpu-connect.sh && ./gpu-connect.sh
#
#   What this does:
#     1. Detects your GPU
#     2. Installs Python + PyTorch (if needed)
#     3. Trains the scoring model (takes ~2 min)
#     4. Starts the inference server on port 8420
#     5. Keeps running — Ctrl+C to stop
#
# ══════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GRN='\033[0;32m'
YEL='\033[1;33m'
CYN='\033[0;36m'
PUR='\033[0;35m'
NC='\033[0m'

echo ""
echo -e "${PUR}  ╔══════════════════════════════════════╗${NC}"
echo -e "${PUR}  ║       BONDLI GPU CONNECT             ║${NC}"
echo -e "${PUR}  ║   Train & serve the LoRA model       ║${NC}"
echo -e "${PUR}  ╚══════════════════════════════════════╝${NC}"
echo ""

ML_DIR="$(cd "$(dirname "$0")" && pwd)/src/ml"

# If we're not in the repo, try to clone it
if [ ! -f "$ML_DIR/model.py" ]; then
    # Check if we're already in a bondli dir
    if [ -f "src/ml/model.py" ]; then
        ML_DIR="$(pwd)/src/ml"
    else
        echo -e "${CYN}[1/6]${NC} Downloading Bondli ML code..."
        if command -v git &> /dev/null; then
            git clone --depth 1 --filter=blob:none --sparse https://github.com/Bradbuythedip/BONDLIv4.git bondli-gpu 2>/dev/null || true
            cd bondli-gpu
            git sparse-checkout set src/ml 2>/dev/null || true
            ML_DIR="$(pwd)/src/ml"
        else
            echo -e "${RED}Git not found. Please clone the repo first:${NC}"
            echo "  git clone https://github.com/Bradbuythedip/BONDLIv4.git"
            echo "  cd BONDLIv4 && ./gpu-connect.sh"
            exit 1
        fi
    fi
fi

cd "$ML_DIR"
echo -e "${GRN}  ML directory: $ML_DIR${NC}"
echo ""

# ── Step 1: Detect GPU ──
echo -e "${CYN}[1/6]${NC} Detecting GPU..."
GPU_MODE="cpu"
GPU_NAME="CPU (no NVIDIA GPU detected)"

if command -v nvidia-smi &> /dev/null; then
    GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || echo "Unknown NVIDIA GPU")
    GPU_VRAM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 || echo "?")
    GPU_MODE="cuda"
    echo -e "  ${GRN}✓ GPU: $GPU_NAME (${GPU_VRAM}MB VRAM)${NC}"
else
    echo -e "  ${YEL}⚠ No NVIDIA GPU found — will use CPU (slower but works)${NC}"
fi

# ── Step 2: Check Python ──
echo -e "${CYN}[2/6]${NC} Checking Python..."
PYTHON=""
for p in python3.12 python3.11 python3.10 python3 python; do
    if command -v $p &> /dev/null; then
        ver=$($p --version 2>&1 | grep -oP '\d+\.\d+')
        major=$(echo $ver | cut -d. -f1)
        minor=$(echo $ver | cut -d. -f2)
        if [ "$major" -ge 3 ] && [ "$minor" -ge 10 ]; then
            PYTHON=$p
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    echo -e "${RED}Python 3.10+ required. Install:${NC}"
    echo "  Ubuntu: sudo apt install python3.11 python3.11-venv"
    echo "  macOS:  brew install python@3.11"
    exit 1
fi
echo -e "  ${GRN}✓ $($PYTHON --version)${NC}"

# ── Step 3: Create venv + install deps ──
echo -e "${CYN}[3/6]${NC} Setting up environment..."
if [ ! -d "venv" ]; then
    $PYTHON -m venv venv
    echo "  Created virtual environment"
fi
source venv/bin/activate

pip install --upgrade pip -q 2>/dev/null

if [ "$GPU_MODE" = "cuda" ]; then
    echo "  Installing PyTorch with CUDA..."
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124 -q 2>/dev/null || \
    pip install torch torchvision -q 2>/dev/null
else
    echo "  Installing PyTorch (CPU)..."
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu -q 2>/dev/null
fi

pip install fastapi 'uvicorn[standard]' pydantic redis -q 2>/dev/null
echo -e "  ${GRN}✓ All dependencies installed${NC}"

# ── Step 4: Download training data (if available) ──
echo -e "${CYN}[4/6]${NC} Checking for training data..."
DATA_FLAG=""

if [ -f "training_data.json" ]; then
    COUNT=$(python -c "import json; print(len(json.load(open('training_data.json'))))" 2>/dev/null || echo "0")
    echo -e "  ${GRN}✓ Found training_data.json ($COUNT records)${NC}"
    DATA_FLAG="--from-json training_data.json"
else
    # Try to download from Bondli API
    echo "  Checking Bondli API for training data..."
    if curl -sf --max-time 5 "https://bondli-production.up.railway.app/api/intel/training-export" -o training_data.json 2>/dev/null; then
        COUNT=$(python -c "import json; d=json.load(open('training_data.json')); print(len(d) if isinstance(d,list) else len(d.get('records',[])))" 2>/dev/null || echo "0")
        if [ "$COUNT" -gt "10" ]; then
            echo -e "  ${GRN}✓ Downloaded $COUNT training records from Bondli${NC}"
            DATA_FLAG="--from-json training_data.json"
        else
            rm -f training_data.json
            echo -e "  ${YEL}Using synthetic warmup data (connect to Redis for real data)${NC}"
        fi
    else
        echo -e "  ${YEL}Using synthetic warmup data (model will improve with real trades)${NC}"
    fi
fi

# ── Step 5: Train ──
echo -e "${CYN}[5/6]${NC} Training model..."
echo ""
python train.py --epochs 50 $DATA_FLAG
echo ""

# ── Step 6: Verify & Serve ──
echo -e "${CYN}[6/6]${NC} Starting inference server..."
echo ""

python -c "
import torch
from model import BondliScorer
print('  ═══════════════════════════════════════')
print('  BONDLI GPU NODE — READY')
print('  ═══════════════════════════════════════')
device = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f'  Device:  {device}')
if device == 'cuda':
    print(f'  GPU:     {torch.cuda.get_device_name(0)}')
    vram = torch.cuda.get_device_properties(0).total_mem / 1e9
    print(f'  VRAM:    {vram:.1f} GB')
m = BondliScorer()
p = m.count_params()
print(f'  Model:   {p[\"total\"]:,} params')
print(f'  LoRA:    {p[\"trainable\"]:,} trainable')
print(f'  Server:  http://0.0.0.0:8420')
print()
print('  Endpoints:')
print('    GET  /health         — Status + GPU info')
print('    POST /predict        — Score a token')
print('    POST /predict/batch  — Score up to 100 tokens')
print('    POST /reload         — Hot-reload weights')
print()
print('  Point Bondli backend at this server:')
print('    export BONDLI_LORA_URL=http://YOUR_IP:8420')
print()
print('  Ctrl+C to stop')
print('  ═══════════════════════════════════════')
print()
"

# Run the server — this blocks until Ctrl+C
exec python serve.py --device $GPU_MODE --port 8420 --host 0.0.0.0
