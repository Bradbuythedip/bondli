#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# BONDLI GPU AGENT — 1 user · 1 GPU · 1 node
# ═══════════════════════════════════════════════════════════════
#
# Usage:
#   curl -s https://bondli.fun/gpu-agent.sh | bash -s -- --wallet <WALLET>
#
# Or download and run:
#   chmod +x bondli-gpu-agent.sh
#   ./bondli-gpu-agent.sh --wallet <YOUR_SOLANA_WALLET>
#
# Requires: NVIDIA GPU, Docker, internet connection
# Nosana constraint: 1 private key per GPU, 1 GPU per PC
# ═══════════════════════════════════════════════════════════════

set -e

WALLET=""
BONDLI_API="${BONDLI_API:-https://api.bondli.fun}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --wallet) WALLET="$2"; shift 2 ;;
    --api) BONDLI_API="$2"; shift 2 ;;
    *) shift ;;
  esac
done

[ -z "$WALLET" ] && echo "Error: --wallet required" && exit 1

echo "======================================="
echo "  BONDLI GPU AGENT"
echo "  1 user - 1 GPU - 1 node"
echo "======================================="

# ── Check NVIDIA GPU ──
GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
[ -z "$GPU_NAME" ] && echo "Error: No NVIDIA GPU detected. nvidia-smi not found or no GPU available." && exit 1
echo "[OK] GPU: $GPU_NAME"

# ── Check / Install Docker ──
if ! command -v docker &>/dev/null; then
  echo "[..] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  echo "[OK] Docker installed. You may need to log out and back in for group changes."
fi

# ── Check / Install NVIDIA Container Toolkit ──
if ! dpkg -l 2>/dev/null | grep -q nvidia-container-toolkit; then
  echo "[..] Installing NVIDIA Container Toolkit..."
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
  sudo apt-get update -qq && sudo apt-get install -y -qq nvidia-container-toolkit
  sudo nvidia-ctk runtime configure --runtime=docker
  sudo systemctl restart docker
  echo "[OK] NVIDIA Container Toolkit installed"
fi

# ── Register with Bondli — get node keypair ──
echo ""
echo "[..] Registering with Bondli..."
REGISTER=$(curl -s -X POST "$BONDLI_API/api/gpu/register" \
  -H "Content-Type: application/json" \
  -d "{\"wallet\":\"$WALLET\",\"gpuModel\":\"$GPU_NAME\"}")

# Check for errors
ERROR=$(echo "$REGISTER" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null)
if [ -n "$ERROR" ]; then
  echo "Error: $ERROR"
  HINT=$(echo "$REGISTER" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('hint',''))" 2>/dev/null)
  [ -n "$HINT" ] && echo "  Hint: $HINT"
  exit 1
fi

# Extract registration data
NODE_ADDRESS=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin)['nodeAddress'])")
KEYPAIR_JSON=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin)['keypairJson'])")
PLATFORM_FEE=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin)['platformFee'])")

echo "[OK] Registered: $NODE_ADDRESS"
echo "     Platform fee: ${PLATFORM_FEE}"

# ── Write keypair to Nosana location ──
mkdir -p ~/.nosana
echo "$KEYPAIR_JSON" > ~/.nosana/nosana_key.json
chmod 600 ~/.nosana/nosana_key.json
echo "[OK] Node keypair written to ~/.nosana/nosana_key.json"

# ── Fund node wallet with SOL for tx fees ──
echo ""
echo "IMPORTANT: Send ~0.05 SOL to your node wallet for transaction fees:"
echo "  $NODE_ADDRESS"
echo ""
read -p "Press Enter once funded (or Ctrl+C to fund later)..."

# ── Start Nosana node ──
echo "[..] Starting Nosana node..."
bash <(curl -s https://nosana.com/start.sh)

# ── Start heartbeat daemon ──
echo "[..] Starting Bondli heartbeat..."
cat > ~/.bondli-heartbeat.sh << HEARTBEAT
#!/bin/bash
BONDLI_API="$BONDLI_API"
NODE_ADDRESS="$NODE_ADDRESS"
while true; do
  GPU_UTIL=\$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null || echo "0")
  GPU_TEMP=\$(nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader 2>/dev/null || echo "0")
  MEM_USED=\$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null || echo "0")
  MEM_TOTAL=\$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null || echo "0")

  STATUS="idle"
  [ "\$GPU_UTIL" -gt 50 ] 2>/dev/null && STATUS="working"
  [ "\$GPU_UTIL" -gt 80 ] 2>/dev/null && STATUS="earning"

  curl -s -X POST "\$BONDLI_API/api/gpu/heartbeat" \
    -H "Content-Type: application/json" \
    -d "{\"nodeAddress\":\"\$NODE_ADDRESS\",\"gpuUtil\":\$GPU_UTIL,\"gpuTemp\":\$GPU_TEMP,\"memUsed\":\$MEM_USED,\"memTotal\":\$MEM_TOTAL,\"status\":\"\$STATUS\"}" >/dev/null 2>&1

  sleep 60
done
HEARTBEAT
chmod +x ~/.bondli-heartbeat.sh
nohup ~/.bondli-heartbeat.sh > /dev/null 2>&1 &

echo ""
echo "======================================="
echo "  YOU'RE EARNING"
echo "======================================="
echo ""
echo "  Node:     $NODE_ADDRESS"
echo "  GPU:      $GPU_NAME"
echo "  Wallet:   $WALLET"
echo "  Fee:      ${PLATFORM_FEE} (to Bondli)"
echo ""
echo "  Your GPU is now accepting AI inference jobs."
echo "  Earnings split hourly to your Bondli wallet."
echo "  Dashboard: https://bondli.fun/gpu"
echo ""
echo "  Stop:   docker stop nosana-node"
echo "  Logs:   docker logs nosana-node --tail 20"
echo "  Status: nvidia-smi"
echo "======================================="
