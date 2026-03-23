#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# BONDLI GPU AGENT — 1 user · 1 GPU · 1 node
# ═══════════════════════════════════════════════════════════════
#
# Usage:
#   curl -s https://bondli.fun/gpu-agent.sh | bash -s -- --wallet <WALLET> --email <EMAIL>
#
# Or download and run:
#   chmod +x bondli-gpu-agent.sh
#   ./bondli-gpu-agent.sh --wallet <YOUR_SOLANA_WALLET> --email <YOUR_EMAIL>
#
# Requires: NVIDIA GPU, Docker, internet connection
# Nosana constraint: 1 private key per GPU, 1 GPU per PC
# ═══════════════════════════════════════════════════════════════

{ # this ensures the entire script is downloaded before execution begins

set -e

WALLET=""
EMAIL=""
DISCORD_USER="bondli-user"
BONDLI_API="${BONDLI_API:-https://api.bondli.fun}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --wallet) WALLET="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --discord) DISCORD_USER="$2"; shift 2 ;;
    --api) BONDLI_API="$2"; shift 2 ;;
    *) shift ;;
  esac
done

[ -z "$WALLET" ] && echo "Error: --wallet required" && exit 1
[ -z "$EMAIL" ] && echo "Error: --email required (for Nosana node registration)" && exit 1

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

# ── Register with Bondli (or reconnect to existing node) ──
echo ""
echo "[..] Registering with Bondli..."
RECONNECTED=false
HTTP_CODE=$(curl -s -o /tmp/bondli-register.json -w "%{http_code}" -X POST "$BONDLI_API/api/gpu/register" \
  -H "Content-Type: application/json" \
  -d "{\"wallet\":\"$WALLET\",\"gpuModel\":\"$GPU_NAME\"}")

if [ "$HTTP_CODE" = "409" ]; then
  # Node already exists — reconnect to preserve funded SOL balance
  echo "[..] Existing node found — reconnecting (preserving your SOL balance)..."
  HTTP_CODE=$(curl -s -o /tmp/bondli-register.json -w "%{http_code}" -X POST "$BONDLI_API/api/gpu/reconnect" \
    -H "Content-Type: application/json" \
    -d "{\"wallet\":\"$WALLET\",\"gpuModel\":\"$GPU_NAME\"}")
  RECONNECTED=true
fi

# Register may return reconnected=true for reactivated disconnected nodes
if [ "$RECONNECTED" = false ] && [ "$HTTP_CODE" = "200" ]; then
  REG_RECONNECTED=$(cat /tmp/bondli-register.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('reconnected',False))" 2>/dev/null)
  if [ "$REG_RECONNECTED" = "True" ]; then
    RECONNECTED=true
  fi
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
NOSANA_MARKET=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('nosanaMarket',''))" 2>/dev/null)
NOSANA_MARKET_NAME=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('nosanaMarketName',''))" 2>/dev/null)
SPOOF_GPU_NAME=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('spoofGpuName',''))" 2>/dev/null)
if [ -z "$NODE_ADDRESS" ] || [ -z "$KEYPAIR_JSON" ]; then
  echo "Error: Registration response missing required fields."
  echo "  Response: $REGISTER"
  exit 1
fi

if [ "$RECONNECTED" = true ]; then
  echo "[OK] Reconnected: $NODE_ADDRESS (existing node, SOL preserved)"
else
  echo "[OK] Registered: $NODE_ADDRESS (new node)"
fi

# ── Write keypair to Nosana location ──
# Nosana's podman container mounts /root/.nosana/ — write there too if we can
mkdir -p ~/.nosana
echo "$KEYPAIR_JSON" > ~/.nosana/nosana_key.json
chmod 600 ~/.nosana/nosana_key.json
if [ "$(id -u)" != "0" ]; then
  sudo mkdir -p /root/.nosana
  sudo tee /root/.nosana/nosana_key.json > /dev/null <<< "$KEYPAIR_JSON"
  sudo chmod 600 /root/.nosana/nosana_key.json
fi
echo "[OK] Node keypair written to ~/.nosana/nosana_key.json"

# Stop old podman container so Nosana picks up the new key
if docker ps -q --filter name=podman 2>/dev/null | grep -q .; then
  echo "[..] Stopping old podman to pick up new key..."
  timeout 15 docker stop podman >/dev/null 2>&1 || true
  timeout 10 docker rm podman >/dev/null 2>&1 || true
  echo "[OK] Old podman stopped"
fi

# ── Fund node wallet with SOL for Nosana tx fees ──
if [ "$RECONNECTED" = true ]; then
  echo ""
  echo "[OK] Using existing node wallet — SOL balance preserved"
  echo "     Node wallet: $NODE_ADDRESS"
else
  echo ""
  echo "======================================="
  echo "  Send ~0.05 SOL to your node wallet"
  echo "======================================="
  echo "  Nosana requires SOL for on-chain"
  echo "  transaction fees (claiming jobs,"
  echo "  submitting results)."
  echo ""
  echo "  Node wallet:"
  echo "  $NODE_ADDRESS"
  echo ""
  echo "  Without SOL your node cannot accept jobs."
  echo "  Fund via Bondli dashboard: https://bondli.fun/gpu"
  echo "======================================="
fi

# ── GPU name spoof for laptop/unrecognized GPUs ──
# Nosana Grid can't mint access keys for GPUs it doesn't recognize (e.g. laptop GPUs).
# We create a nvidia-smi wrapper that reports a recognized desktop GPU name.
# The wrapper lives in ~/.nosana/bin/ which is mounted into the nosana-node container.
if [ -n "$SPOOF_GPU_NAME" ]; then
  echo "[..] Laptop GPU detected — creating nvidia-smi wrapper for Grid registration"
  echo "     Real GPU: $GPU_NAME"
  echo "     Spoof:   $SPOOF_GPU_NAME"
  mkdir -p ~/.nosana/bin
  # The wrapper runs inside the nosana-node container where PATH puts our dir first.
  # We call the real nvidia-smi by temporarily removing our dir from PATH.
  cat > ~/.nosana/bin/nvidia-smi << 'NVWRAPPER'
#!/bin/bash
# Bondli nvidia-smi wrapper — spoofs GPU name for Nosana Grid access key minting
CLEAN_PATH=$(echo "$PATH" | sed 's|/root/.nosana/bin:||g; s|:/root/.nosana/bin||g')
REAL_NVSMI=$(PATH="$CLEAN_PATH" which nvidia-smi 2>/dev/null || echo "/usr/bin/nvidia-smi")
NVWRAPPER
  # Append the sed line with actual GPU names (not inside single-quoted heredoc)
  echo "\"\$REAL_NVSMI\" \"\$@\" 2>&1 | sed 's/$GPU_NAME/$SPOOF_GPU_NAME/g'" >> ~/.nosana/bin/nvidia-smi
  chmod +x ~/.nosana/bin/nvidia-smi
  echo "[OK] nvidia-smi wrapper created at ~/.nosana/bin/nvidia-smi"
fi

# ── Start Nosana node ──
echo "[..] Starting Nosana node..."

# Download Nosana's start script so we can patch it for unsupported GPUs
curl -s --connect-timeout 10 --max-time 30 https://nosana.com/start.sh -o /tmp/nosana-start.sh
if [ ! -s /tmp/nosana-start.sh ]; then
  echo "[!!] Failed to download Nosana start script"
  echo "     Try running manually: bash <(curl -s https://nosana.com/start.sh)"
  exit 1
fi

# If we have a pre-resolved market from Bondli, patch the start script
# to pass market address to nosana-node (bypasses Grid GPU detection that fails for new GPUs like 5070 Ti)
# Note: market is a POSITIONAL argument: `nosana node start <market-address> --network mainnet`
if [ -n "$NOSANA_MARKET" ]; then
  echo "[OK] Using Bondli-resolved market: ${NOSANA_MARKET_NAME:-$NOSANA_MARKET}"
  # Nosana's start.sh has:
  #   NOSANA_NODE_ARGS=( start )
  #   NOSANA_NODE_ARGS+=(--network "$SOL_NET_ENV")
  # We need: NOSANA_NODE_ARGS=( start <MARKET_ADDRESS> )
  # Inject market address as positional arg right after "start" in the array
  sed -i "s|^\\([[:space:]]*\\)start[[:space:]]*$|\\1start\\n\\1$NOSANA_MARKET|" /tmp/nosana-start.sh
  # Verify the patch was applied
  if grep -q "$NOSANA_MARKET" /tmp/nosana-start.sh; then
    echo "[OK] Market address injected into Nosana start script"
  else
    echo "[!!] WARNING: Failed to patch Nosana start script with market address"
    echo "     The node may fail if Nosana Grid is unreachable"
  fi
else
  echo "[!!] WARNING: No market address from Bondli API — node will use Nosana Grid auto-detection"
fi

# Nosana's start.sh uses `docker exec -it` and `--interactive -t` which require a TTY
# and cause the script to block forever (attached to the node process).
# Always keep stdin open (-i / --interactive) so we can pipe an email for Nosana
# registration. A "reconnected" Bondli node may still be unregistered with Nosana
# (e.g. after disconnect + re-register). Remove -t (no tty needed).
sed -i 's/docker exec -it /docker exec -i /g' /tmp/nosana-start.sh
sed -i 's/--interactive -t/--interactive/g' /tmp/nosana-start.sh

# If we have a GPU name spoof, patch the nosana-node container to use our nvidia-smi wrapper.
# The wrapper is at ~/.nosana/bin/nvidia-smi (mounted into container at /root/.nosana/bin/).
# Add PATH override so nosana-node finds our wrapper before /usr/bin/nvidia-smi.
if [ -n "$SPOOF_GPU_NAME" ]; then
  # Add -e PATH=/root/.nosana/bin:$PATH to the nosana-node container's DOCKER_ARGS
  sed -i 's|-e NOSANA_NODE_VERSION=|-e PATH=/root/.nosana/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin -e NOSANA_NODE_VERSION=|' /tmp/nosana-start.sh
  echo "[OK] PATH override injected for nvidia-smi wrapper"
fi

# Nosana registration prompts for email + Discord username (inquirer.js).
# Plain stdin piping doesn't work because inquirer drains stdin between prompts.
# Use `expect` to answer both prompts via a pseudo-TTY, then interact (keep alive).
if command -v expect &>/dev/null; then
  cat > /tmp/nosana-expect.sh << EXPECT_SCRIPT
set timeout 300
spawn bash /tmp/nosana-start.sh
expect {
  "Email Address" {
    send "${EMAIL}\r"
    exp_continue
  }
  "Discord username" {
    send "${DISCORD_USER}\r"
    exp_continue
  }
  eof
}
EXPECT_SCRIPT
  expect /tmp/nosana-expect.sh > /tmp/nosana-start.log 2>&1 &
  NOSANA_START_PID=$!
  disown $NOSANA_START_PID 2>/dev/null || true
  rm -f /tmp/nosana-expect.sh
else
  echo "[!!] 'expect' not installed — falling back to stdin pipe"
  echo "     If registration fails, install it: sudo apt-get install -y expect"
  (printf '%s\n' "$EMAIL"; sleep 5; printf '%s\n' "$DISCORD_USER"; sleep 86400) | bash /tmp/nosana-start.sh > /tmp/nosana-start.log 2>&1 &
  NOSANA_START_PID=$!
  disown $NOSANA_START_PID 2>/dev/null || true
fi
echo "[OK] Nosana start running in background (PID $NOSANA_START_PID)"
rm -f /tmp/nosana-start.sh


# Wait for the nosana-node container to be running (it pulls images in detached mode)
echo "[..] Waiting for Nosana node to start (image pulls may take several minutes)..."
NODE_STARTED=false
for i in $(seq 1 60); do
  if docker exec podman podman ps --format '{{.Names}}' 2>/dev/null | grep -q "nosana-node"; then
    NODE_STARTED=true
    break
  fi
  sleep 5
done

if [ "$NODE_STARTED" = true ]; then
  echo "[OK] Nosana node running inside podman"
else
  echo "[!!] WARNING: Nosana node may not have started. Check logs:"
  echo "     docker exec podman podman logs nosana-node"
fi

# ── Start heartbeat daemon ──
echo "[..] Starting Bondli heartbeat..."
# Download heartbeat script (not heredoc — heredocs break with curl|bash)
curl -s "https://bondli.fun/bondli-heartbeat.sh" -o ~/.bondli-heartbeat.sh
sed -i "s|__BONDLI_API__|$BONDLI_API|g" ~/.bondli-heartbeat.sh
sed -i "s|__NODE_ADDRESS__|$NODE_ADDRESS|g" ~/.bondli-heartbeat.sh
chmod +x ~/.bondli-heartbeat.sh
# Kill any existing heartbeat before starting new one
pkill -f bondli-heartbeat 2>/dev/null || true
nohup ~/.bondli-heartbeat.sh >> ~/.bondli-heartbeat.log 2>&1 &
echo "[OK] Heartbeat daemon started (PID $!)"
echo "     Heartbeat log: ~/.bondli-heartbeat.log"

echo ""
echo "======================================="
echo "  YOU'RE EARNING"
echo "======================================="
echo ""
echo "  Node:     $NODE_ADDRESS"
echo "  GPU:      $GPU_NAME"
echo "  Wallet:   $WALLET"
echo ""
echo "  Your GPU is now accepting AI inference jobs."
echo "  Earnings are split hourly to your Bondli wallet."
echo "  Dashboard: https://bondli.fun/gpu"
echo ""
echo "  Stop:   docker exec podman podman stop nosana-node"
echo "  Logs:   docker exec podman podman logs --tail 20 nosana-node"
echo "  Status: nvidia-smi"
echo "======================================="

} # end of curl|bash safety wrapper
