// ═══ VELOCITY — Alerts (E9) ═══
// Every alert lands in the store and the ledger first; delivery is a bonus.
// Each alert ends with a halt link and a status link. Three retries, then the
// failure itself is written to the status banner.

export class Alerter {
  constructor({ store, ledger, webhookUrl = null, statusUrl = "", fetchImpl = globalThis.fetch, retries = 3 } = {}) {
    this.store = store; this.ledger = ledger; this.webhookUrl = webhookUrl; this.statusUrl = statusUrl; this.fetch = fetchImpl; this.retries = retries;
  }
  async send(level, text) {
    const a = this.store?.alert(level, text);
    const body = `${level.toUpperCase()}: ${text}\nhalt: ${this.statusUrl}/halt (POST {"mode":"freeze"})\nstatus: ${this.statusUrl}/status`;
    let delivered = false, error = null;
    if (this.webhookUrl) {
      for (let i = 0; i < this.retries && !delivered; i++) {
        try {
          const res = await this.fetch(this.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: body, level }), signal: AbortSignal.timeout(5_000) });
          delivered = res.ok;
          if (!res.ok) error = `webhook ${res.status}`;
        } catch (err) { error = err.message; }
      }
      if (!delivered) this.store?.alert("error", `alert delivery failed: ${error}`);
    }
    this.ledger?.append({ kind: "alert", level, text, delivered, error });
    return { ...a, delivered, error };
  }
}
