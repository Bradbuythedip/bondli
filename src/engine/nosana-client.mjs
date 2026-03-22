/**
 * ═══════════════════════════════════════════════════════════════
 * NOSANA CLIENT — SDK + REST API wrapper for Nosana GPU network
 * ═══════════════════════════════════════════════════════════════
 *
 * Provides a unified interface for:
 *   - Job creation and monitoring
 *   - Deployment management (SCHEDULED strategy for always-on services)
 *   - Market discovery and GPU tier selection
 *   - Credits/balance checking
 *   - IPFS pinning for job definitions
 *
 * Auth: Bearer token (nos_xxx_...) from Nosana dashboard
 * API base: https://dashboard.k8s.prd.nos.ci/api
 *
 * Falls back to REST API when @nosana/kit is not installed.
 * ═══════════════════════════════════════════════════════════════
 */

const NOSANA_API_BASE = process.env.NOSANA_API_URL || "https://dashboard.k8s.prd.nos.ci/api";
const NOSANA_API_KEY = process.env.NOSANA_API_KEY || ""; // nos_xxx_...

// NOS token mint on Solana
export const NOS_MINT = "nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7";

// ═══════════════════════════════════════
// GPU MARKET ADDRESSES — Nosana market IDs
// ═══════════════════════════════════════
export const NOSANA_MARKETS = {
  "RTX 3060":  { address: "7AtiXMSH6R1jjBxrcYjehCkkSF7zvYWte63gwEDBcGHq", nosPerSec: 0.000043, vram: 12 },
  "RTX 4070":  { address: "EzuHhkrhmV98HWzREsgLenKj2iHdJgrKmzfL8psP8Aso", nosPerSec: 0.000035, vram: 12 },
  "RTX 3090":  { address: "CA5pMpqkYFKtme7K31pNB1s62X2SdhEv1nN9RdxKCpuQ", nosPerSec: 0.00009,  vram: 24 },
  "RTX 4090":  { address: "97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf", nosPerSec: 0.000097, vram: 24 },
  "A100":      { address: "GLJHzqRN9fKGBsvsFzmGnaQGknUtLN1dqaFR8n3YdM22", nosPerSec: 0.000115, vram: 80 },
};

// Slug-based market lookup (for CLI compatibility)
export const MARKET_SLUGS = {
  "nvidia-3060": NOSANA_MARKETS["RTX 3060"],
  "nvidia-4070": NOSANA_MARKETS["RTX 4070"],
  "nvidia-3090": NOSANA_MARKETS["RTX 3090"],
  "nvidia-4090": NOSANA_MARKETS["RTX 4090"],
  "nvidia-a100": NOSANA_MARKETS["A100"],
};

/**
 * Resolve GPU model name to Nosana market address.
 * Handles partial matches (e.g., "NVIDIA GeForce RTX 4070 Ti" → RTX 4070 market).
 */
export function resolveMarket(gpuModel) {
  if (!gpuModel) return NOSANA_MARKETS["RTX 4090"]; // default

  const normalized = gpuModel.toUpperCase();
  const isLaptop = normalized.includes("LAPTOP") || normalized.includes("MOBILE") || normalized.includes("MAX-Q");

  // Laptop GPUs have less VRAM than desktop equivalents — map by comparable desktop VRAM
  if (isLaptop) {
    // High-end laptop GPUs (5070+, 4080+, 4090) → ~12GB VRAM → RTX 4070 market
    if (normalized.includes("5090") || normalized.includes("5080") || normalized.includes("5070") ||
        normalized.includes("4090") || normalized.includes("4080")) {
      return { ...NOSANA_MARKETS["RTX 4070"], name: "RTX 4070 (laptop)" };
    }
    // Lower-end laptop GPUs → RTX 3060 market
    return { ...NOSANA_MARKETS["RTX 3060"], name: "RTX 3060 (laptop)" };
  }

  // Exact match first
  for (const [name, market] of Object.entries(NOSANA_MARKETS)) {
    if (normalized.includes(name.toUpperCase().replace("RTX ", ""))) {
      return { ...market, name };
    }
  }

  // Tier-based fallback: newer/higher cards get best available market
  if (normalized.includes("5090") || normalized.includes("5080") || normalized.includes("A100") || normalized.includes("H100")) {
    return { ...NOSANA_MARKETS["A100"], name: "A100" };
  }
  if (normalized.includes("5070") || normalized.includes("4090") || normalized.includes("4080")) {
    return { ...NOSANA_MARKETS["RTX 4090"], name: "RTX 4090" };
  }
  if (normalized.includes("3090") || normalized.includes("3080") || normalized.includes("A4000") || normalized.includes("A5000")) {
    return { ...NOSANA_MARKETS["RTX 3090"], name: "RTX 3090" };
  }
  if (normalized.includes("4070") || normalized.includes("4060")) {
    return { ...NOSANA_MARKETS["RTX 4070"], name: "RTX 4070" };
  }

  // Fallback to lowest tier
  return { ...NOSANA_MARKETS["RTX 3060"], name: "RTX 3060" };
}

// ═══════════════════════════════════════
// REST API CLIENT
// ═══════════════════════════════════════

/**
 * Make an authenticated request to the Nosana REST API.
 */
async function nosanaFetch(path, options = {}) {
  if (!NOSANA_API_KEY) {
    throw new Error("NOSANA_API_KEY not set — required for Nosana API access");
  }

  const url = `${NOSANA_API_BASE}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);

  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NOSANA_API_KEY}`,
        ...options.headers,
      },
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Nosana API ${resp.status}: ${body.slice(0, 200)}`);
    }

    return resp.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ═══════════════════════════════════════
// JOB DEFINITION BUILDER
// ═══════════════════════════════════════

/**
 * Build a Nosana job definition JSON.
 *
 * @param {object} opts
 * @param {string} opts.image - Docker image (e.g., "docker.io/vllm/vllm-openai:v0.5.4")
 * @param {string[]} [opts.cmd] - Container command args
 * @param {boolean} [opts.gpu=true] - Enable GPU
 * @param {number} [opts.port] - Port to expose
 * @param {string} [opts.healthPath] - Health check HTTP path
 * @param {object} [opts.variables] - Global variables
 * @param {object[]} [opts.resources] - Resources (S3, HF, Ollama)
 * @param {number} [opts.requiredVram] - Required VRAM in GB
 * @param {object} [opts.dockerAuth] - Docker registry auth { username, password }
 * @returns {object} Nosana job definition
 */
export function buildJobDefinition(opts) {
  const {
    image,
    cmd,
    gpu = true,
    port,
    healthPath,
    variables,
    resources,
    requiredVram,
    dockerAuth,
  } = opts;

  const args = { image, gpu };
  if (cmd) args.cmd = cmd;
  if (resources) args.resources = resources;

  if (port) {
    const expose = { port };
    if (healthPath) {
      expose.health_checks = [{
        type: "http",
        path: healthPath,
        method: "GET",
        expected_status: 200,
      }];
    }
    args.expose = [expose];
  }

  if (dockerAuth) {
    args.authentication = { docker: dockerAuth };
  }

  const definition = {
    version: "0.1",
    type: "container",
    meta: { trigger: "api" },
    ops: [{
      type: "container/run",
      id: "bondli-inference",
      args,
    }],
  };

  if (requiredVram) {
    definition.meta.system_requirements = { required_vram: requiredVram };
  }
  if (variables) {
    definition.global = { variables };
  }

  return definition;
}

/**
 * Build a Bondli-specific inference job definition.
 * Uses the BondliScorer model served via the local FastAPI server,
 * containerized for Nosana execution.
 */
export function buildBondliInferenceJob(opts = {}) {
  const {
    modelImage = "docker.io/bondli/scorer:latest",
    port = 8420,
    batchSize = 100,
  } = opts;

  return buildJobDefinition({
    image: modelImage,
    cmd: ["--port", String(port), "--device", "cuda"],
    gpu: true,
    port,
    healthPath: "/health",
    requiredVram: 4, // BondliScorer is lightweight (~2M params)
    variables: {
      BATCH_MAX: String(batchSize),
    },
  });
}

// ═══════════════════════════════════════
// NOSANA CLIENT CLASS
// ═══════════════════════════════════════

export class NosanaClient {
  constructor(opts = {}) {
    this.apiKey = opts.apiKey || NOSANA_API_KEY;
    this.apiBase = opts.apiBase || NOSANA_API_BASE;
    this.defaultMarket = opts.defaultMarket || NOSANA_MARKETS["RTX 4090"].address;
    this.enabled = !!this.apiKey;
    this._kitClient = null;
    this._kitAvailable = null;
  }

  /**
   * Try to use @nosana/kit SDK (preferred). Falls back to REST API.
   */
  async _getKitClient() {
    if (this._kitAvailable === false) return null;
    if (this._kitClient) return this._kitClient;

    try {
      const { createNosanaClient } = await import("@nosana/kit");
      this._kitClient = createNosanaClient("mainnet", {
        api: { apiKey: this.apiKey },
      });
      this._kitAvailable = true;
      console.log("[NOSANA] Using @nosana/kit SDK");
      return this._kitClient;
    } catch {
      this._kitAvailable = false;
      console.log("[NOSANA] @nosana/kit not available — using REST API");
      return null;
    }
  }

  // ── Credits / Balance ──

  async getCreditsBalance() {
    const kit = await this._getKitClient();
    if (kit) {
      try {
        return await kit.api.credits.balance();
      } catch {}
    }
    return nosanaFetch("/credits/balance");
  }

  // ── Job Operations ──

  /**
   * Create a job on the Nosana network.
   *
   * @param {object} jobDefinition - Nosana job definition JSON
   * @param {string} [market] - Market address (defaults to RTX 4090)
   * @param {number} [timeout=3600] - Job timeout in seconds
   * @returns {{ jobId: string, status: string }}
   */
  async createJob(jobDefinition, market, timeout = 3600) {
    if (!this.enabled) throw new Error("Nosana not configured (NOSANA_API_KEY missing)");

    const marketAddr = market || this.defaultMarket;

    const kit = await this._getKitClient();
    if (kit) {
      try {
        // Pin job definition to IPFS
        const ipfsHash = await kit.ipfs.pin(jobDefinition);
        // Create job on-chain
        const result = await kit.api.jobs.create({
          ipfsHash,
          market: marketAddr,
          timeout,
        });
        console.log(`[NOSANA] Job created via SDK: ${result.jobId || result.id}`);
        return { jobId: result.jobId || result.id, status: "queued" };
      } catch (err) {
        console.warn("[NOSANA] SDK job creation failed, falling back to REST:", err.message);
      }
    }

    // REST API fallback
    const result = await nosanaFetch("/jobs/create-with-credits", {
      method: "POST",
      body: JSON.stringify({
        job_definition: jobDefinition,
        market: marketAddr,
        timeout,
      }),
    });

    console.log(`[NOSANA] Job created via REST: ${result.id || result.jobId}`);
    return { jobId: result.id || result.jobId, status: "queued" };
  }

  /**
   * Get job status and results.
   */
  async getJob(jobId) {
    const kit = await this._getKitClient();
    if (kit) {
      try {
        return await kit.api.jobs.get(jobId);
      } catch {}
    }
    return nosanaFetch(`/jobs/${jobId}`);
  }

  /**
   * Stop a running job.
   */
  async stopJob(jobId) {
    return nosanaFetch(`/jobs/stop-with-credits`, {
      method: "POST",
      body: JSON.stringify({ job_id: jobId }),
    });
  }

  /**
   * Extend a running job's timeout.
   */
  async extendJob(jobId, additionalSeconds = 3600) {
    return nosanaFetch(`/jobs/extend-with-credits`, {
      method: "POST",
      body: JSON.stringify({ job_id: jobId, timeout: additionalSeconds }),
    });
  }

  // ── Deployment Operations ──

  /**
   * Create a deployment (managed service).
   *
   * @param {object} opts
   * @param {string} opts.name - Deployment name
   * @param {object} opts.jobDefinition - Nosana job definition
   * @param {string} [opts.market] - Market address
   * @param {number} [opts.timeout=3600] - Job timeout in seconds
   * @param {number} [opts.replicas=1] - Number of replicas
   * @param {"SIMPLE"|"SIMPLE_EXTEND"|"SCHEDULED"} [opts.strategy="SCHEDULED"]
   * @param {string} [opts.schedule="0 * * * *"] - Cron schedule (SCHEDULED strategy)
   */
  async createDeployment(opts) {
    if (!this.enabled) throw new Error("Nosana not configured");

    const {
      name,
      jobDefinition,
      market,
      timeout = 3600,
      replicas = 1,
      strategy = "SCHEDULED",
      schedule = "0 * * * *",
    } = opts;

    const kit = await this._getKitClient();
    if (kit) {
      try {
        const result = await kit.api.deployments.create({
          name,
          market: market || this.defaultMarket,
          timeout,
          replicas,
          strategy,
          schedule: strategy === "SCHEDULED" ? schedule : undefined,
          job_definition: jobDefinition,
        });
        console.log(`[NOSANA] Deployment created: ${result.id}`);
        return result;
      } catch (err) {
        console.warn("[NOSANA] SDK deployment failed, falling back to REST:", err.message);
      }
    }

    return nosanaFetch("/deployments/create", {
      method: "POST",
      body: JSON.stringify({
        name,
        market: market || this.defaultMarket,
        timeout,
        replicas,
        strategy,
        schedule: strategy === "SCHEDULED" ? schedule : undefined,
        job_definition: jobDefinition,
      }),
    });
  }

  /**
   * List all deployments.
   */
  async listDeployments() {
    return nosanaFetch("/deployments");
  }

  /**
   * Start a deployment.
   */
  async startDeployment(deploymentId) {
    return nosanaFetch(`/deployments/${deploymentId}/start`);
  }

  // ── Market Discovery ──

  /**
   * List available markets (from known registry + live API).
   */
  async listMarkets() {
    // Return known markets augmented with live data if API is available
    const markets = Object.entries(NOSANA_MARKETS).map(([name, data]) => ({
      name,
      ...data,
    }));

    if (this.enabled) {
      try {
        const kit = await this._getKitClient();
        if (kit) {
          const live = await kit.api.markets.list();
          return { known: markets, live };
        }
      } catch {}
    }

    return { known: markets };
  }

  /**
   * Get summary info for logging/dashboard.
   */
  getSummary() {
    return {
      enabled: this.enabled,
      apiBase: this.apiBase,
      defaultMarket: this.defaultMarket,
      sdkAvailable: this._kitAvailable,
      marketsKnown: Object.keys(NOSANA_MARKETS).length,
    };
  }
}

// Singleton instance
export const nosanaClient = new NosanaClient();
export default nosanaClient;
