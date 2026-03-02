// BONDLI v3.0 — Anti-Detection (Gaussian timing, human patterns)
import CONFIG from "./config.mjs";

// Box-Muller transform for Gaussian random
function gaussianRandom(mean, stdDev) {
  let u1, u2;
  do { u1 = Math.random(); } while (u1 === 0);
  u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, mean + z * stdDev);
}

// Generate human-like delay between trades
export function humanDelay(baseMs = 3000, jitterFactor = 0.4) {
  const delay = gaussianRandom(baseMs, baseMs * jitterFactor);
  // Add occasional "thinking" pauses (5% chance of 2-8s extra)
  if (Math.random() < 0.05) {
    return delay + gaussianRandom(5000, 1500);
  }
  return Math.max(500, delay);
}

// Generate random trade amount with human-like rounding
export function humanAmount(baseSol, variance = 0.15) {
  const raw = gaussianRandom(baseSol, baseSol * variance);
  // Humans tend to use round numbers
  if (raw > 1) return Math.round(raw * 10) / 10;
  if (raw > 0.1) return Math.round(raw * 100) / 100;
  return Math.round(raw * 1000) / 1000;
}

// Stagger wallet activations to avoid burst patterns
export function staggerActivation(walletIndex, totalWallets) {
  const baseDelay = (walletIndex / totalWallets) * 30000; // spread over 30s
  return humanDelay(baseDelay, 0.3);
}

// Generate a sequence of trade sizes that look organic
export function organicSequence(totalSol, numTrades) {
  const amounts = [];
  let remaining = totalSol;

  for (let i = 0; i < numTrades - 1; i++) {
    const avgChunk = remaining / (numTrades - i);
    const amount = humanAmount(avgChunk, 0.3);
    const capped = Math.min(amount, remaining * 0.6); // no single trade > 60%
    amounts.push(Math.max(0.001, capped));
    remaining -= capped;
  }
  amounts.push(Math.max(0.001, remaining));

  // Shuffle slightly (don't want perfect ascending/descending)
  for (let i = amounts.length - 1; i > 0; i--) {
    if (Math.random() < 0.3) {
      const j = Math.floor(Math.random() * (i + 1));
      [amounts[i], amounts[j]] = [amounts[j], amounts[i]];
    }
  }

  return amounts;
}

// Sleep helper
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export default { humanDelay, humanAmount, staggerActivation, organicSequence, sleep };
