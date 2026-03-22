/**
 * ═══════════════════════════════════════════════════════════════
 * BONDLI AI JOB ROUTER — Routes inference to Nosana GPU fleet
 * ═══════════════════════════════════════════════════════════════
 *
 * When Bondli needs inference (rug scoring, price prediction, etc),
 * it posts jobs to Nosana markets where Bondli users' nodes are
 * registered. Any of their GPUs may pick up the job. They still
 * earn the full NOS rate.
 *
 * Architecture:
 *   1. Local LoRA server (src/ml/serve.py) is the primary path
 *   2. When local is unavailable or overloaded, jobs route to
 *      Nosana GPU fleet via the Nosana API/SDK
 *   3. Active Bondli GPU fleet deployments provide always-on
 *      inference endpoints via Nosana's expose/frpc system
 *
 * The router manages:
 *   - Deployment lifecycle (create, monitor, restart)
 *   - Endpoint health tracking for Nosana-hosted services
 *   - Fallback chain: local GPU → Nosana fleet → rule-only scoring
 *   - Job batching and cost optimization
 * ═══════════════════════════════════════════════════════════════
 */

import { nosanaClient, buildBondliInferenceJob, resolveMarket, NOSANA_MARKETS } from "./nosana-client.mjs";

// ── Config ──
const NOSANA_INFERENCE_ENABLED = process.env.NOSANA_INFERENCE !== "false";
const NOSANA_DEPLOY_MARKET = process.env.NOSANA_DEPLOY_MARKET || NOSANA_MARKETS["RTX 4090"].address;
const NOSANA_DEPLOY_REPLICAS = parseInt(process.env.NOSANA_DEPLOY_REPLICAS || "2");
const NOSANA_DEPLOY_TIMEOUT = parseInt(process.env.NOSANA_DEPLOY_TIMEOUT || "3600");
const NOSANA_DEPLOY_SCHEDULE = process.env.NOSANA_DEPLOY_SCHEDULE || "0 * * * *"; // hourly

// Endpoint polling
const ENDPOINT_CHECK_INTERVAL = 60_000; // 1 min
const ENDPOINT_TIMEOUT_MS = 5000;
const MAX_RETRIES = 2;

/**
 * Manages Bondli's inference routing across local and Nosana GPU fleet.
 */
export class NosanaJobRouter {
  constructor(opts = {}) {
    this.redis = opts.redis || null;
    this.loraClient = opts.loraClient || null;
    this.enabled = NOSANA_INFERENCE_ENABLED && nosanaClient.enabled;

    // Active Nosana deployment state
    this.deployment = null;
    this.endpoints = []; // Active inference endpoint URLs
    this.endpointIndex = 0; // Round-robin index

    // Stats
    this.stats = {
      localHits: 0,
      nosanaHits: 0,
      nosanaErrors: 0,
      fallbackHits: 0,
      totalRequests: 0,
      activeDeployment: null,
      endpointsOnline: 0,
    };

    this._checkInterval = null;
  }

  /**
   * Initialize the router. Optionally deploys inference service to Nosana.
   */
  async init() {
    if (!this.enabled) {
      console.log("[JOB-ROUTER] Nosana inference disabled (NOSANA_API_KEY not set or NOSANA_INFERENCE=false)");
      return;
    }

    console.log("[JOB-ROUTER] Initializing Nosana inference routing...");

    // Restore deployment state from Redis
    if (this.redis) {
      try {
        const saved = await this.redis.get("bondli:nosana:deployment");
        if (saved) {
          this.deployment = JSON.parse(saved);
          console.log(`[JOB-ROUTER] Restored deployment: ${this.deployment.id}`);
        }
      } catch {}
    }

    // Start endpoint health monitoring
    this._checkInterval = setInterval(() => this._checkEndpoints(), ENDPOINT_CHECK_INTERVAL);
    await this._checkEndpoints();

    console.log(`[JOB-ROUTER] Ready — endpoints: ${this.endpoints.length}, deployment: ${this.deployment?.id || "none"}`);
  }

  /**
   * Deploy Bondli's inference model to Nosana as a SCHEDULED deployment.
   * This creates an always-on service using Bondli GPU fleet nodes.
   */
  async deployInferenceService() {
    if (!this.enabled) {
      return { error: "Nosana inference not configured" };
    }

    try {
      const jobDef = buildBondliInferenceJob();
      const result = await nosanaClient.createDeployment({
        name: "bondli-scorer",
        jobDefinition: jobDef,
        market: NOSANA_DEPLOY_MARKET,
        timeout: NOSANA_DEPLOY_TIMEOUT,
        replicas: NOSANA_DEPLOY_REPLICAS,
        strategy: "SCHEDULED",
        schedule: NOSANA_DEPLOY_SCHEDULE,
      });

      this.deployment = {
        id: result.id,
        createdAt: Date.now(),
        market: NOSANA_DEPLOY_MARKET,
        replicas: NOSANA_DEPLOY_REPLICAS,
        status: "starting",
      };
      this.stats.activeDeployment = result.id;

      // Persist deployment state
      if (this.redis) {
        await this.redis.set("bondli:nosana:deployment", JSON.stringify(this.deployment));
      }

      // Start the deployment
      await nosanaClient.startDeployment(result.id);

      console.log(`[JOB-ROUTER] Deployed inference service: ${result.id} (${NOSANA_DEPLOY_REPLICAS} replicas, ${NOSANA_DEPLOY_SCHEDULE})`);
      return { deploymentId: result.id, status: "starting" };
    } catch (err) {
      console.error("[JOB-ROUTER] Deployment failed:", err.message);
      return { error: err.message };
    }
  }

  /**
   * Score a token using the best available inference path.
   *
   * Priority:
   *   1. Local LoRA server (fastest, 0 cost)
   *   2. Nosana fleet endpoint (remote, costs NOS)
   *   3. null (caller falls back to rule-only scoring)
   *
   * @param {object} features - Feature dict for BondliScorer
   * @returns {object|null} Prediction result or null
   */
  async predict(features) {
    this.stats.totalRequests++;

    // 1. Try local LoRA server first
    if (this.loraClient?.available) {
      const result = await this.loraClient.predict(features);
      if (result) {
        this.stats.localHits++;
        return { ...result, source: "local" };
      }
    }

    // 2. Try Nosana fleet endpoint
    if (this.endpoints.length > 0) {
      const result = await this._predictViaEndpoint(features);
      if (result) {
        this.stats.nosanaHits++;
        return { ...result, source: "nosana" };
      }
    }

    // 3. No inference available
    this.stats.fallbackHits++;
    return null;
  }

  /**
   * Batch predict via the best available path.
   */
  async predictBatch(featuresList) {
    if (!featuresList?.length) return null;

    // Try local first
    if (this.loraClient?.available) {
      const result = await this.loraClient.predictBatch(featuresList);
      if (result) {
        this.stats.localHits += featuresList.length;
        return result.map(r => ({ ...r, source: "local" }));
      }
    }

    // Try Nosana endpoint
    if (this.endpoints.length > 0) {
      const result = await this._batchPredictViaEndpoint(featuresList);
      if (result) {
        this.stats.nosanaHits += featuresList.length;
        return result.map(r => ({ ...r, source: "nosana" }));
      }
    }

    return null;
  }

  /**
   * Post a one-off inference job to Nosana (for heavy workloads).
   * Returns a job ID that can be polled for results.
   */
  async postInferenceJob(jobDefinition, market) {
    if (!this.enabled) return null;

    try {
      const result = await nosanaClient.createJob(
        jobDefinition,
        market || NOSANA_DEPLOY_MARKET,
        NOSANA_DEPLOY_TIMEOUT
      );

      // Track the job in Redis
      if (this.redis) {
        await this.redis.lPush("bondli:nosana:jobs", JSON.stringify({
          ...result,
          createdAt: Date.now(),
        }));
        await this.redis.lTrim("bondli:nosana:jobs", 0, 499);
      }

      return result;
    } catch (err) {
      console.error("[JOB-ROUTER] Job post failed:", err.message);
      this.stats.nosanaErrors++;
      return null;
    }
  }

  /**
   * Get the current inference endpoint URL for a running Nosana service.
   * Uses the .node.k8s.prd.nos.ci pattern.
   */
  async getServiceEndpoint(nodePublicKey) {
    return `https://${nodePublicKey}.node.k8s.prd.nos.ci`;
  }

  // ── Route API endpoints ──

  mountRoutes(app, limiter) {
    const mw = limiter || ((_req, _res, next) => next());

    // Deploy inference service to Nosana
    app.post("/api/nosana/deploy", mw, async (req, res) => {
      if (!this.enabled) {
        return res.status(503).json({ error: "Nosana inference not configured" });
      }
      const result = await this.deployInferenceService();
      res.json(result);
    });

    // Post a one-off inference job
    app.post("/api/nosana/job", mw, async (req, res) => {
      if (!this.enabled) {
        return res.status(503).json({ error: "Nosana inference not configured" });
      }
      const { jobDefinition, market } = req.body;
      if (!jobDefinition) return res.status(400).json({ error: "jobDefinition required" });
      const result = await this.postInferenceJob(jobDefinition, market);
      res.json(result || { error: "Job creation failed" });
    });

    // Get job status
    app.get("/api/nosana/job/:jobId", mw, async (req, res) => {
      if (!this.enabled) {
        return res.status(503).json({ error: "Nosana inference not configured" });
      }
      try {
        const job = await nosanaClient.getJob(req.params.jobId);
        res.json(job);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Router status (deployment, endpoints, stats)
    app.get("/api/nosana/status", mw, async (req, res) => {
      res.json({
        enabled: this.enabled,
        deployment: this.deployment,
        endpoints: this.endpoints.map(e => ({
          url: e.url.replace(/https:\/\/(.{8}).*(.{4})\.node/, "https://$1...$2.node"),
          healthy: e.healthy,
          lastCheck: e.lastCheck,
        })),
        stats: this.stats,
        markets: Object.entries(NOSANA_MARKETS).map(([name, m]) => ({
          name,
          address: m.address.slice(0, 8) + "...",
          nosPerSec: m.nosPerSec,
          vram: m.vram,
        })),
      });
    });

    // List available markets
    app.get("/api/nosana/markets", mw, async (_req, res) => {
      try {
        const markets = await nosanaClient.listMarkets();
        res.json(markets);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Credits balance
    app.get("/api/nosana/credits", mw, async (_req, res) => {
      if (!this.enabled) {
        return res.status(503).json({ error: "Nosana not configured" });
      }
      try {
        const balance = await nosanaClient.getCreditsBalance();
        res.json(balance);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  // ── Internal Methods ──

  /**
   * Send prediction request to a Nosana-hosted endpoint (round-robin).
   */
  async _predictViaEndpoint(features) {
    const healthy = this.endpoints.filter(e => e.healthy);
    if (healthy.length === 0) return null;

    const endpoint = healthy[this.endpointIndex % healthy.length];
    this.endpointIndex++;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ENDPOINT_TIMEOUT_MS);

        const resp = await fetch(`${endpoint.url}/predict`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ features }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (resp.ok) {
          return await resp.json();
        }
      } catch {
        if (attempt === MAX_RETRIES) {
          endpoint.healthy = false;
          this.stats.nosanaErrors++;
        }
      }
    }
    return null;
  }

  /**
   * Batch predict via Nosana endpoint.
   */
  async _batchPredictViaEndpoint(featuresList) {
    const healthy = this.endpoints.filter(e => e.healthy);
    if (healthy.length === 0) return null;

    const endpoint = healthy[this.endpointIndex % healthy.length];
    this.endpointIndex++;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ENDPOINT_TIMEOUT_MS * 2);

      const resp = await fetch(`${endpoint.url}/predict/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: featuresList.slice(0, 100) }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const data = await resp.json();
        return data.predictions;
      }
    } catch {
      this.stats.nosanaErrors++;
    }
    return null;
  }

  /**
   * Check health of all known Nosana inference endpoints.
   */
  async _checkEndpoints() {
    if (!this.enabled) return;

    // Load registered endpoints from Redis (populated by GPU nodes reporting service URLs)
    if (this.redis) {
      try {
        const endpointData = await this.redis.sMembers("bondli:nosana:endpoints");
        for (const url of endpointData) {
          if (!this.endpoints.find(e => e.url === url)) {
            this.endpoints.push({ url, healthy: false, lastCheck: 0 });
          }
        }
      } catch {}
    }

    // Health-check each endpoint
    for (const endpoint of this.endpoints) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ENDPOINT_TIMEOUT_MS);

        const resp = await fetch(`${endpoint.url}/health`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        endpoint.healthy = resp.ok;
        endpoint.lastCheck = Date.now();
      } catch {
        endpoint.healthy = false;
        endpoint.lastCheck = Date.now();
      }
    }

    // Remove stale endpoints (unhealthy for > 30 min)
    const cutoff = Date.now() - 30 * 60_000;
    this.endpoints = this.endpoints.filter(
      e => e.healthy || e.lastCheck > cutoff
    );

    this.stats.endpointsOnline = this.endpoints.filter(e => e.healthy).length;
  }

  /**
   * Cleanup resources.
   */
  cleanup() {
    if (this._checkInterval) {
      clearInterval(this._checkInterval);
      this._checkInterval = null;
    }
  }

  getStats() {
    return {
      ...this.stats,
      localAvailable: this.loraClient?.available || false,
      endpointsTotal: this.endpoints.length,
    };
  }
}

export default NosanaJobRouter;
