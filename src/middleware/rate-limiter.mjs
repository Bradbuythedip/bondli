// BONDLI v3.0 — Redis-backed Rate Limiter
import { createClient } from "redis";

let redis = null;

export async function initRedis(url) {
  redis = createClient({ url: url || process.env.REDIS_URL || "redis://localhost:6379" });
  redis.on("error", (e) => console.error("[REDIS]", e.message));
  await redis.connect();
  console.log("[REDIS] Connected");
  return redis;
}

export function getRedis() { return redis; }

// Sliding window rate limiter
export function rateLimit(opts = {}) {
  const {
    windowMs = 60_000,         // 1 minute window
    max = 30,                  // max requests per window
    keyPrefix = "rl:",
    message = "Too many requests, slow down.",
  } = opts;

  return async (req, res, next) => {
    if (!redis) return next(); // fail open if redis down

    const ip = req.headers["x-real-ip"] || req.headers["x-forwarded-for"]?.split(",")[0] || req.ip;
    const key = `${keyPrefix}${ip}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Remove old entries, add new, count
      await redis.zRemRangeByScore(key, 0, windowStart);
      const count = await redis.zCard(key);

      if (count >= max) {
        const oldest = await redis.zRange(key, 0, 0, { withScores: true });
        const retryAfter = oldest.length ? Math.ceil((oldest[0].score + windowMs - now) / 1000) : 60;

        res.set("Retry-After", retryAfter.toString());
        res.set("X-RateLimit-Limit", max.toString());
        res.set("X-RateLimit-Remaining", "0");
        return res.status(429).json({ error: message, retryAfter });
      }

      await redis.zAdd(key, { score: now, value: `${now}:${Math.random().toString(36).slice(2, 8)}` });
      await redis.expire(key, Math.ceil(windowMs / 1000) + 1);

      res.set("X-RateLimit-Limit", max.toString());
      res.set("X-RateLimit-Remaining", (max - count - 1).toString());
      next();
    } catch (e) {
      console.error("[RATE-LIMIT]", e.message);
      next(); // fail open
    }
  };
}

// Specific limiters
export const apiLimiter = rateLimit({ max: 60, windowMs: 60_000, keyPrefix: "rl:api:" });
export const launchLimiter = rateLimit({ max: 3, windowMs: 300_000, keyPrefix: "rl:launch:", message: "Launch rate limited. Max 3 per 5 minutes." });
export const paymentLimiter = rateLimit({ max: 10, windowMs: 60_000, keyPrefix: "rl:pay:" });
export const wsLimiter = rateLimit({ max: 5, windowMs: 60_000, keyPrefix: "rl:ws:" });
