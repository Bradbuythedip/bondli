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

# ── Check NVIDIA GPU + driver ──
if ! command -v nvidia-smi &>/dev/null; then
  echo "Error: nvidia-smi not found."
  echo "  Install NVIDIA drivers first:"
  echo "  sudo apt install -y nvidia-driver-560   # or latest version"
  echo "  sudo reboot"
  exit 1
fi
GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
if [ -z "$GPU_NAME" ]; then
  echo "Error: NVIDIA driver installed but no GPU detected."
  echo "  Check: nvidia-smi"
  exit 1
fi
echo "[OK] GPU: $GPU_NAME"

# ── Check / Install Docker ──
NEED_RELOGIN=false

# Remove snap Docker if present (conflicts with docker-ce)
if snap list docker &>/dev/null 2>&1; then
  echo "[..] Removing snap Docker (conflicts with docker-ce)..."
  sudo snap remove docker --purge 2>/dev/null || sudo snap remove docker
  echo "[OK] Snap Docker removed"
fi

if ! command -v docker &>/dev/null || ! dpkg -l docker-ce &>/dev/null 2>&1; then
  echo "[..] Installing Docker..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  NEED_RELOGIN=true
  echo "[OK] Docker installed"
else
  echo "[OK] Docker already installed"
fi

# Make sure Docker daemon is running
if ! sudo systemctl is-active --quiet docker 2>/dev/null; then
  echo "[..] Starting Docker daemon..."
  sudo systemctl enable docker 2>/dev/null || true
  sudo systemctl start docker 2>/dev/null || true
  sleep 3
  if ! sudo systemctl is-active --quiet docker 2>/dev/null; then
    echo ""
    echo "Error: Docker daemon won't start."
    echo "  Try: sudo systemctl status docker"
    echo "  Or reinstall: sudo apt-get remove -y docker-ce docker-ce-cli && curl -fsSL https://get.docker.com | sudo sh"
    exit 1
  fi
fi
echo "[OK] Docker daemon running"

# ── Check / Install NVIDIA Container Toolkit ──
if ! dpkg -l nvidia-container-toolkit &>/dev/null 2>&1; then
  echo "[..] Installing NVIDIA Container Toolkit..."
  # Add NVIDIA repo key (overwrite if exists)
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | sudo gpg --yes --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
  sudo apt-get update -qq && sudo apt-get install -y -qq nvidia-container-toolkit
  echo "[OK] NVIDIA Container Toolkit installed"
else
  echo "[OK] NVIDIA Container Toolkit already installed"
fi

# Configure NVIDIA runtime for Docker
if sudo nvidia-ctk runtime configure --runtime=docker 2>/dev/null; then
  echo "[OK] NVIDIA runtime configured via nvidia-ctk"
else
  echo "[..] nvidia-ctk configure failed, writing daemon.json manually..."
  # Manually configure Docker to use the NVIDIA runtime
  sudo mkdir -p /etc/docker
  if [ -f /etc/docker/daemon.json ] && [ -s /etc/docker/daemon.json ]; then
    # Merge with existing config
    sudo python3 -c "
import json
with open('/etc/docker/daemon.json') as f:
    cfg = json.load(f)
cfg.setdefault('runtimes', {})['nvidia'] = {'path': 'nvidia-container-runtime', 'runtimeArgs': []}
cfg['default-runtime'] = 'nvidia'
with open('/etc/docker/daemon.json', 'w') as f:
    json.dump(cfg, f, indent=2)
"
  else
    echo '{"default-runtime":"nvidia","runtimes":{"nvidia":{"path":"nvidia-container-runtime","runtimeArgs":[]}}}' | sudo tee /etc/docker/daemon.json > /dev/null
  fi
  echo "[OK] NVIDIA runtime configured in /etc/docker/daemon.json"
fi

# Verify the config was actually written
if ! grep -q '"nvidia"' /etc/docker/daemon.json 2>/dev/null; then
  echo "Error: Failed to configure NVIDIA runtime in /etc/docker/daemon.json"
  echo "  Try manually: sudo nvidia-ctk runtime configure --runtime=docker"
  exit 1
fi

sudo systemctl restart docker 2>/dev/null || true
sleep 3
echo "[OK] Docker restarted with NVIDIA GPU runtime"

# Verify GPU is visible to Docker (retry up to 3 times — image pull + runtime init can be slow)
echo "[..] Verifying GPU is visible to Docker (this may pull an image on first run)..."
GPU_OK=false
for attempt in 1 2 3; do
  if sudo docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi >/dev/null 2>&1; then
    GPU_OK=true
    break
  fi
  if [ "$attempt" -lt 3 ]; then
    echo "     Attempt $attempt/3 failed, retrying in 5s..."
    sleep 5
    sudo systemctl restart docker 2>/dev/null || true
    sleep 3
  fi
done

if [ "$GPU_OK" = true ]; then
  echo "[OK] GPU verified inside Docker"
else
  echo ""
  echo "Error: Docker can't see your GPU after 3 attempts."
  echo ""
  echo "  Diagnostics:"
  echo "    nvidia-smi:  $(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null || echo 'FAILED')"
  echo "    runtime cfg: $(grep -o '\"default-runtime\"[^,}]*' /etc/docker/daemon.json 2>/dev/null || echo 'not set')"
  echo ""
  echo "  Usually a reboot fixes this:"
  echo "    sudo reboot"
  echo "    # then re-run:"
  echo "    curl -s https://bondli.fun/gpu-agent.sh | bash -s -- --wallet <WALLET>"
  exit 1
fi

# Note: if Docker was just installed, user won't be in docker group yet.
# We use sudo for docker commands below so it works on first run.
# User can run without sudo after logging out and back in.

# ── Register with Bondli — get node keypair ──
echo ""
echo "[..] Registering with Bondli..."
HTTP_CODE=$(curl -s -o /tmp/bondli-register.json -w "%{http_code}" -X POST "$BONDLI_API/api/gpu/register" \
  -H "Content-Type: application/json" \
  -d "{\"wallet\":\"$WALLET\",\"gpuModel\":\"$GPU_NAME\"}")

if [ "$HTTP_CODE" = "409" ]; then
  echo "[..] Existing node found — deregistering and re-registering..."
  curl -s -X POST "$BONDLI_API/api/gpu/deregister" \
    -H "Content-Type: application/json" \
    -d "{\"wallet\":\"$WALLET\"}" >/dev/null 2>&1
  sleep 1
  HTTP_CODE=$(curl -s -o /tmp/bondli-register.json -w "%{http_code}" -X POST "$BONDLI_API/api/gpu/register" \
    -H "Content-Type: application/json" \
    -d "{\"wallet\":\"$WALLET\",\"gpuModel\":\"$GPU_NAME\"}")
fi

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "Error: Registration failed (HTTP $HTTP_CODE)"
  cat /tmp/bondli-register.json 2>/dev/null
  echo ""
  echo "  Check your wallet address and try again."
  echo "  If the problem persists, visit https://bondli.fun for help."
  rm -f /tmp/bondli-register.json
  exit 1
fi

REGISTER=$(cat /tmp/bondli-register.json)
rm -f /tmp/bondli-register.json

# Check for errors
ERROR=$(echo "$REGISTER" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null)
if [ -n "$ERROR" ]; then
  echo "Error: $ERROR"
  HINT=$(echo "$REGISTER" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('hint',''))" 2>/dev/null)
  [ -n "$HINT" ] && echo "  Hint: $HINT"
  exit 1
fi

# Extract registration data
NODE_ADDRESS=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin)['nodeAddress'])" 2>/dev/null)
KEYPAIR_JSON=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin)['keypairJson'])" 2>/dev/null)
PLATFORM_FEE=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin)['platformFee'])" 2>/dev/null)
NOSANA_MARKET=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('nosanaMarketName','unknown'))" 2>/dev/null)
NOS_PER_SEC=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('nosPerSec',0))" 2>/dev/null)

if [ -z "$NODE_ADDRESS" ] || [ -z "$KEYPAIR_JSON" ]; then
  echo "Error: Registration response missing required fields."
  echo "  Response: $REGISTER"
  exit 1
fi

echo "[OK] Registered: $NODE_ADDRESS"
echo "     Platform fee: ${PLATFORM_FEE}"
echo "     Nosana market: ${NOSANA_MARKET} (~${NOS_PER_SEC} NOS/sec)"

# ── Write keypair to Nosana location ──
mkdir -p ~/.nosana
echo "$KEYPAIR_JSON" > ~/.nosana/nosana_key.json
chmod 600 ~/.nosana/nosana_key.json
echo "[OK] Node keypair written to ~/.nosana/nosana_key.json"

# ── Fund node wallet with SOL for tx fees ──
echo ""
echo "======================================="
echo "  ACTION REQUIRED: Fund your node"
echo "======================================="
echo "  Your node needs ~0.05 SOL to pay Solana"
echo "  transaction fees (claiming jobs, submitting"
echo "  results on the Nosana network)."
echo ""
echo "  Send SOL to this address:"
echo "  $NODE_ADDRESS"
echo ""
echo "  Without SOL, your node will start but"
echo "  cannot accept or complete any jobs."
echo "======================================="
echo ""
read -p "Press Enter once funded (or Ctrl+C to fund later and restart)..."

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
echo "  Market:   $NOSANA_MARKET (~${NOS_PER_SEC} NOS/sec)"
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
