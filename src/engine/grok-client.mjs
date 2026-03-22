/**
 * ═══════════════════════════════════════════════════════════════
 * GROK CLIENT — xAI Grok 4 for Bondli GPU support & chat
 * ═══════════════════════════════════════════════════════════════
 *
 * Provides AI-powered chat support for GPU earnings, Nosana node
 * troubleshooting, and general Bondli platform help. Uses xAI's
 * OpenAI-compatible API with Grok 4 model.
 *
 * System prompt is pre-trained on Nosana architecture, Bondli GPU
 * earnings flow, common GPU issues, and platform knowledge.
 * ═══════════════════════════════════════════════════════════════
 */

const XAI_API_URL = process.env.XAI_API_URL || "https://api.x.ai/v1/chat/completions";
const XAI_API_KEY = process.env.XAI_API_KEY || "";
const GROK_MODEL = process.env.GROK_MODEL || "grok-4";
const MAX_TOKENS = parseInt(process.env.GROK_MAX_TOKENS || "1024");
const TEMPERATURE = parseFloat(process.env.GROK_TEMPERATURE || "0.7");

// Rate limit: max messages per user per minute
const USER_RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const userRateLimits = new Map(); // wallet → { count, windowStart }

// ═══════════════════════════════════════
// SYSTEM PROMPT — Nosana + Bondli knowledge base
// ═══════════════════════════════════════
const SYSTEM_PROMPT = `You are the Bondli GPU Support AI, powered by Grok. You help users with GPU earnings, Nosana node setup, troubleshooting, and general Bondli platform questions.

## Who you are
- Friendly, concise, technically competent
- You speak like a knowledgeable friend, not a corporate bot
- Keep answers short and actionable — users are often debugging live issues
- Use code blocks for commands and config snippets

## Bondli Platform
Bondli is two things:
1. GPU Earnings — users plug in NVIDIA GPUs to earn $NOS tokens via the Nosana decentralized compute network
2. AI Trading Intelligence — ML-powered memecoin scoring, auto-trading, and rug detection on Solana

Tiers:
- Free (0 SOL): radar, scoring, auto-ape, GPU earning, fleet trading
- VIP (10 SOL): everything in Free, 0% profit share, priority queue, API access

## GPU Earnings Architecture
- Constraint: 1 user = 1 GPU = 1 node = 1 keypair (enforced by Nosana)
- Each user's PC runs one Nosana node via Docker
- Bondli generates a Solana keypair for each node (custody model)
- Nosana pays $NOS to the node keypair
- Bondli sweeps hourly: 85% (Free) or 95% (VIP) to user's wallet, remainder to treasury
- All transfers on-chain, verifiable on Solana explorer

## Setup Flow
1. User runs: curl -s https://bondli.fun/gpu-agent.sh | bash -s -- --wallet <WALLET>
2. Script checks for NVIDIA GPU (nvidia-smi), installs Docker + NVIDIA Container Toolkit if needed
3. Registers with Bondli API → gets generated Solana keypair
4. Writes keypair to ~/.nosana/nosana_key.json
5. Starts Nosana node via Docker (nosana/nosana-cli + nosana/podman)
6. Starts heartbeat daemon (reports GPU metrics every 60s)
7. Node accepts AI inference jobs from Nosana marketplace

## Nosana Network
- Decentralized GPU compute marketplace on Solana
- ~2,000 active nodes across 60+ countries
- Jobs posted as on-chain transactions, executed in Docker containers
- Payment: per-second in $NOS tokens
- Node runs Docker-in-Podman architecture (Docker outer, Podman inner)
- GPU passthrough: host → Docker (--gpus=all) → Podman → job container

## Supported GPUs & Markets
- RTX 3060: ~0.000043 NOS/s, 12 GB VRAM
- RTX 4070: ~0.000035 NOS/s, 12 GB VRAM
- RTX 3090: ~0.00009 NOS/s, 24 GB VRAM
- RTX 4090: ~0.000097 NOS/s, 24 GB VRAM
- RTX 5070/5080/5090: mapped to nearest market tier
- A100: ~0.000115 NOS/s, 80 GB VRAM
- Also supported: RTX 30/40/50 series, A4000-A6500, H100

## Common Issues & Solutions

### "No NVIDIA GPU detected"
- Install NVIDIA drivers: sudo apt install nvidia-driver-535 (or latest)
- Verify: nvidia-smi should show GPU
- WSL2 users need Windows NVIDIA drivers, not Linux ones

### Docker issues
- Install: curl -fsSL https://get.docker.com | sh
- Add user to docker group: sudo usermod -aG docker $USER (log out/in after)
- NVIDIA Container Toolkit: needed for GPU passthrough
  sudo apt-get install nvidia-container-toolkit
  sudo nvidia-ctk runtime configure --runtime=docker
  sudo systemctl restart docker

### Node not starting
- Check Docker: docker ps (should show nosana containers)
- Check logs: docker logs nosana-node --tail 50
- Fund node wallet with ~0.05 SOL for transaction fees
- Ensure port 8080 and 45876 are not blocked by firewall

### Node offline / no earnings
- Check heartbeat: curl https://api.bondli.fun/api/gpu/dashboard?wallet=<WALLET>
- Restart: docker restart nosana-node
- Check GPU: nvidia-smi (should show GPU with driver)
- Check internet: ping dashboard.nosana.com

### Low earnings
- Earnings depend on job availability in your GPU's market tier
- Higher-tier GPUs (4090, A100) tend to get more jobs
- Earnings fluctuate — some hours are busier than others
- Check Nosana explorer for market queue depth

### Keypair issues
- Keypair is at ~/.nosana/nosana_key.json
- DO NOT delete or modify this file while node is running
- To re-register: POST /api/gpu/deregister first, then re-run agent script
- Bondli holds a copy for fee sweeping (custody model)

### NOS token
- Mint: nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7
- 6 decimals
- Trades on Kraken, Crypto.com, Gate.io, Raydium, Jupiter
- Current sweep threshold: 1 NOS minimum

## Bondli API Endpoints (GPU)
- POST /api/gpu/register — register node (free for all users)
- POST /api/gpu/deregister — remove node, sweep remaining balance
- GET /api/gpu/dashboard?wallet=X — node status, earnings
- POST /api/gpu/heartbeat — agent reports metrics
- GET /api/gpu/fleet — all nodes stats

## Important Notes
- Never share private keys or seed phrases
- Node keypairs are managed by Bondli — users don't need to handle keys directly
- If user asks about trading features, answer but suggest the Radar/Intel tabs
- For billing/payment issues, suggest contacting the team on Twitter @Bondlifun
- Always be honest about limitations — if you don't know, say so`;

/**
 * Check rate limit for a user.
 * @returns {boolean} true if allowed
 */
function checkRateLimit(wallet) {
  const now = Date.now();
  const entry = userRateLimits.get(wallet);

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    userRateLimits.set(wallet, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= USER_RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Send a chat message to Grok 4 via xAI API.
 *
 * @param {Array<{role: string, content: string}>} messages - Conversation history
 * @param {object} [opts] - Options
 * @param {string} [opts.wallet] - User wallet for rate limiting
 * @param {object} [opts.context] - Additional context (GPU status, node info)
 * @returns {{ content: string, usage: object } | { error: string }}
 */
export async function chat(messages, opts = {}) {
  if (!XAI_API_KEY) {
    return { error: "AI support not configured. Set XAI_API_KEY to enable Grok." };
  }

  // Rate limit check
  if (opts.wallet && !checkRateLimit(opts.wallet)) {
    return { error: "Rate limit exceeded. Please wait a moment before sending another message." };
  }

  // Build context-aware system message
  let systemContent = SYSTEM_PROMPT;
  if (opts.context) {
    systemContent += "\n\n## Current User Context\n";
    if (opts.context.tier) systemContent += `- Tier: ${opts.context.tier}\n`;
    if (opts.context.gpuRegistered !== undefined) systemContent += `- GPU registered: ${opts.context.gpuRegistered}\n`;
    if (opts.context.nodeStatus) systemContent += `- Node status: ${opts.context.nodeStatus}\n`;
    if (opts.context.gpuModel) systemContent += `- GPU model: ${opts.context.gpuModel}\n`;
    if (opts.context.totalEarnings) systemContent += `- Total earnings: ${opts.context.totalEarnings} NOS\n`;
    if (opts.context.pendingNOS) systemContent += `- Pending NOS: ${opts.context.pendingNOS}\n`;
  }

  const payload = {
    model: GROK_MODEL,
    messages: [
      { role: "system", content: systemContent },
      ...messages.slice(-20), // Keep last 20 messages for context window
    ],
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    stream: false,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const resp = await fetch(XAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(`[GROK] API error ${resp.status}: ${body.slice(0, 200)}`);
      return { error: `AI service error (${resp.status}). Try again in a moment.` };
    }

    const data = await resp.json();
    const choice = data.choices?.[0];

    if (!choice?.message?.content) {
      return { error: "No response from AI. Try again." };
    }

    return {
      content: choice.message.content,
      usage: data.usage || null,
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      return { error: "AI response timed out. Try a shorter question." };
    }
    console.error("[GROK] Error:", err.message);
    return { error: "AI service unavailable. Try again later." };
  }
}

/**
 * Mount chat support routes onto an Express app.
 */
export function mountChatRoutes(app, deps = {}) {
  const { redis, getUser, resolveTier } = deps;

  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, wallet } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "messages array required" });
      }

      // Validate message format
      for (const msg of messages) {
        if (!msg.role || !msg.content || typeof msg.content !== "string") {
          return res.status(400).json({ error: "Each message needs role and content" });
        }
        if (!["user", "assistant"].includes(msg.role)) {
          return res.status(400).json({ error: "Message role must be user or assistant" });
        }
        if (msg.content.length > 2000) {
          return res.status(400).json({ error: "Message too long (max 2000 chars)" });
        }
      }

      // Gather user context for the AI
      let context = {};
      if (wallet && redis && getUser && resolveTier) {
        try {
          const user = await getUser(wallet);
          const tierInfo = resolveTier(wallet, user._redisError ? {} : user);
          context.tier = tierInfo.tier;

          const nodeAddress = await redis.get(`bondli:gpu:user_node:${wallet}`);
          context.gpuRegistered = !!nodeAddress;
          if (nodeAddress) {
            const nodeData = await redis.hGetAll(`bondli:gpu:node:${nodeAddress}`);
            context.nodeStatus = nodeData.status || "unknown";
            context.gpuModel = nodeData.gpuModel || "unknown";
            context.totalEarnings = nodeData.totalEarningsNOS || "0";
          }
        } catch {}
      }

      const result = await chat(messages, { wallet, context });

      if (result.error) {
        return res.status(result.error.includes("Rate limit") ? 429 : 500).json({ error: result.error });
      }

      res.json({
        reply: result.content,
        usage: result.usage,
      });
    } catch (err) {
      console.error("[CHAT] Error:", err.message);
      res.status(500).json({ error: "Chat service error" });
    }
  });

  // Health check for chat service
  app.get("/api/chat/status", (_req, res) => {
    res.json({
      enabled: !!XAI_API_KEY,
      model: GROK_MODEL,
    });
  });

  console.log(`[GROK] Chat routes mounted — model: ${GROK_MODEL}, enabled: ${!!XAI_API_KEY}`);
}

export default { chat, mountChatRoutes };
