/**
 * ═══════════════════════════════════════════════════════════════
 * LORA CLIENT — GPU-Accelerated Scoring via Local Python Server
 * ═══════════════════════════════════════════════════════════════
 *
 * Connects to the local LoRA inference server (src/ml/serve.py).
 * Falls back gracefully to rule-only scoring if server is down.
 *
 * Usage:
 *   import { loraClient } from './lora-client.mjs';
 *   const prediction = await loraClient.predict(features);
 *   // { score: 72.3, rugProb: 0.12, graduationProb: 0.45, latency_ms: 1.2 }
 */

const LORA_URL = process.env.BONDLI_LORA_URL || "http://127.0.0.1:8420";
const TIMEOUT_MS = 200; // Hard cap — if LoRA is slower than this, skip it
const HEALTH_CHECK_INTERVAL = 30000; // 30s between health checks
const BATCH_MAX = 100;

class LoRAClient {
  constructor() {
    this.available = false;
    this.lastHealthCheck = 0;
    this.stats = {
      calls: 0,
      hits: 0,
      misses: 0,
      errors: 0,
      avgLatencyMs: 0,
      gpuName: null,
      vramUsedGb: 0,
    };
    this._checking = false;
  }

  async checkHealth() {
    if (this._checking) return this.available;
    this._checking = true;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(`${LORA_URL}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) {
        const data = await resp.json();
        this.available = data.loaded === true;
        this.stats.gpuName = data.gpu || null;
        this.stats.vramUsedGb = data.vram_used_gb || 0;
        if (this.available) {
          console.log(`[LORA] Connected: ${data.gpu || "CPU"} | ${data.params_total?.toLocaleString() || "?"} params | ${data.benchmark_ms_per_token?.toFixed(2) || "?"}ms/token`);
        }
      } else {
        this.available = false;
      }
    } catch {
      this.available = false;
    }
    this.lastHealthCheck = Date.now();
    this._checking = false;
    return this.available;
  }

  async predict(features) {
    // Periodic health check
    if (Date.now() - this.lastHealthCheck > HEALTH_CHECK_INTERVAL) {
      this.checkHealth(); // Non-blocking
    }
    if (!this.available) {
      this.stats.misses++;
      return null;
    }

    this.stats.calls++;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const resp = await fetch(`${LORA_URL}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        this.stats.errors++;
        return null;
      }

      const data = await resp.json();
      this.stats.hits++;
      this.stats.avgLatencyMs = (this.stats.avgLatencyMs * (this.stats.hits - 1) + (data.latency_ms || 0)) / this.stats.hits;
      return data;
    } catch {
      this.stats.errors++;
      // If too many errors, disable temporarily
      if (this.stats.errors > 10 && this.stats.errors > this.stats.hits) {
        this.available = false;
        console.log("[LORA] Too many errors — disabling until next health check");
      }
      return null;
    }
  }

  async predictBatch(featuresList) {
    if (!this.available || featuresList.length === 0) return null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS * 2);
      const resp = await fetch(`${LORA_URL}/predict/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: featuresList.slice(0, BATCH_MAX) }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) return null;
      const data = await resp.json();
      this.stats.hits += featuresList.length;
      return data.predictions;
    } catch {
      this.stats.errors++;
      return null;
    }
  }

  async reload() {
    try {
      const resp = await fetch(`${LORA_URL}/reload`, { method: "POST" });
      return resp.ok;
    } catch {
      return false;
    }
  }

  getStats() {
    return {
      available: this.available,
      ...this.stats,
      hitRate: this.stats.calls > 0 ? ((this.stats.hits / this.stats.calls) * 100).toFixed(1) + "%" : "N/A",
    };
  }
}

export const loraClient = new LoRAClient();
export default loraClient;
