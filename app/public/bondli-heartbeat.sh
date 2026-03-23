#!/bin/bash
# Bondli GPU heartbeat daemon — reports node status to dashboard
# This file is downloaded by gpu-agent.sh, NOT embedded via heredoc
# (heredocs break when the parent script runs via curl|bash)

BONDLI_API="__BONDLI_API__"
NODE_ADDRESS="__NODE_ADDRESS__"
PENDING_RESULTS_FILE="/tmp/bondli-cmd-results.json"
echo "[]" > "$PENDING_RESULTS_FILE"

execute_command() {
  local CMD_TYPE="$1"
  local CMD_PARAMS="$2"
  local CMD_ID="$3"
  local OUTPUT=""
  local STATUS="success"

  case "$CMD_TYPE" in
    stop_node)
      # Nosana node runs inside the podman container
      OUTPUT=$(docker exec podman podman stop nosana-node 2>&1) || \
      OUTPUT=$(docker stop nosana-node 2>&1) || STATUS="error"
      ;;
    restart_node)
      OUTPUT=$(docker exec podman podman restart nosana-node 2>&1) || \
      OUTPUT=$(docker restart nosana-node 2>&1) || STATUS="error"
      ;;
    get_logs)
      OUTPUT=$(docker exec podman podman logs --tail 50 nosana-node 2>&1 | head -c 10000) || \
      OUTPUT=$(docker logs nosana-node --tail 50 2>&1 | head -c 10000) || STATUS="error"
      ;;
    set_power_limit)
      local PL=$(echo "$CMD_PARAMS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('powerLimit',0))" 2>/dev/null)
      if [ -n "$PL" ] && [ "$PL" -gt 0 ] 2>/dev/null; then
        OUTPUT=$(sudo nvidia-smi -pl "$PL" 2>&1) || STATUS="error"
      else
        OUTPUT="Invalid power limit"
        STATUS="error"
      fi
      ;;
    get_gpu_details)
      OUTPUT=$(nvidia-smi --query-gpu=clocks.gr,clocks.mem,power.draw,power.limit,fan.speed,driver_version,name --format=csv,noheader 2>&1) || STATUS="error"
      ;;
    *)
      OUTPUT="Unknown command: $CMD_TYPE"
      STATUS="error"
      ;;
  esac

  # Escape output for JSON
  local ESCAPED_OUTPUT=$(echo "$OUTPUT" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))" 2>/dev/null || echo '""')

  # Append result to pending results
  local RESULT="{\"id\":\"$CMD_ID\",\"type\":\"$CMD_TYPE\",\"status\":\"$STATUS\",\"output\":$ESCAPED_OUTPUT,\"executedAt\":$(date +%s000)}"
  python3 -c "
import json
with open('$PENDING_RESULTS_FILE') as f:
    results = json.load(f)
results.append(json.loads('$RESULT'))
with open('$PENDING_RESULTS_FILE', 'w') as f:
    json.dump(results, f)
" 2>/dev/null
}

while true; do
  # Collect GPU metrics
  GPU_UTIL=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null || echo "0")
  GPU_TEMP=$(nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader 2>/dev/null || echo "0")
  MEM_USED=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null || echo "0")
  MEM_TOTAL=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null || echo "0")
  POWER_DRAW=$(nvidia-smi --query-gpu=power.draw --format=csv,noheader,nounits 2>/dev/null || echo "0")
  POWER_LIMIT=$(nvidia-smi --query-gpu=power.limit --format=csv,noheader,nounits 2>/dev/null || echo "0")
  FAN_SPEED=$(nvidia-smi --query-gpu=fan.speed --format=csv,noheader,nounits 2>/dev/null || echo "0")
  GPU_CLOCK=$(nvidia-smi --query-gpu=clocks.gr --format=csv,noheader,nounits 2>/dev/null || echo "0")
  MEM_CLOCK=$(nvidia-smi --query-gpu=clocks.mem --format=csv,noheader,nounits 2>/dev/null || echo "0")

  STATUS="idle"
  [ "$GPU_UTIL" -gt 50 ] 2>/dev/null && STATUS="working"
  [ "$GPU_UTIL" -gt 80 ] 2>/dev/null && STATUS="earning"

  # Read pending command results
  CMD_RESULTS=$(cat "$PENDING_RESULTS_FILE" 2>/dev/null || echo "[]")

  # Send heartbeat and capture response
  RESPONSE=$(curl -s -X POST "$BONDLI_API/api/gpu/heartbeat" \
    -H "Content-Type: application/json" \
    -d "{\"nodeAddress\":\"$NODE_ADDRESS\",\"gpuUtil\":$GPU_UTIL,\"gpuTemp\":$GPU_TEMP,\"memUsed\":$MEM_USED,\"memTotal\":$MEM_TOTAL,\"status\":\"$STATUS\",\"powerDraw\":$POWER_DRAW,\"powerLimit\":$POWER_LIMIT,\"fanSpeed\":$FAN_SPEED,\"gpuClock\":$GPU_CLOCK,\"memClock\":$MEM_CLOCK,\"commandResults\":$CMD_RESULTS}" 2>/dev/null)

  # Clear pending results after successful send
  echo "[]" > "$PENDING_RESULTS_FILE"

  # Process commands from server
  if [ -n "$RESPONSE" ]; then
    CMD_COUNT=$(echo "$RESPONSE" | python3 -c "import sys,json; cmds=json.load(sys.stdin).get('commands',[]); print(len(cmds))" 2>/dev/null || echo "0")
    if [ "$CMD_COUNT" -gt 0 ] 2>/dev/null; then
      echo "$RESPONSE" | python3 -c "
import sys, json
cmds = json.load(sys.stdin).get('commands', [])
for i, cmd in enumerate(cmds):
    print(f\"{i}|{cmd['id']}|{cmd['type']}|{json.dumps(cmd.get('params', {}))}\")
" 2>/dev/null | while IFS='|' read -r IDX CMD_ID CMD_TYPE CMD_PARAMS; do
        echo "[bondli] Executing command: $CMD_TYPE ($CMD_ID)"
        execute_command "$CMD_TYPE" "$CMD_PARAMS" "$CMD_ID"
      done
    fi
  fi

  sleep 15
done
