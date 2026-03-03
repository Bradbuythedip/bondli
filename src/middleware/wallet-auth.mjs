// BONDLI — Wallet Signature Auth
// Verifies Solana wallet ownership via signed message
// Flow: 
//   1. Frontend calls /api/auth/challenge → gets nonce
//   2. User signs nonce with Phantom → sends signature
//   3. Server verifies signature → issues JWT session token
//   4. All subsequent requests use Bearer token

import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// In-memory nonce store (short-lived)
const nonces = new Map();

// ── JWT helpers ──
function base64url(buf) { return Buffer.from(buf).toString("base64url"); }

function signJWT(payload) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + TOKEN_TTL }));
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  try {
    const [header, body, sig] = token.split(".");
    const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

// ── Challenge: generate nonce for wallet to sign ──
export function generateChallenge(wallet) {
  const nonce = crypto.randomBytes(32).toString("hex");
  const message = `Sign this message to verify your wallet on BONDLI.\n\nNonce: ${nonce}\nWallet: ${wallet}\nTimestamp: ${Date.now()}`;
  // Store nonce with 5-minute expiry
  nonces.set(wallet, { nonce, message, createdAt: Date.now() });
  setTimeout(() => nonces.delete(wallet), 5 * 60 * 1000);
  return { message, nonce };
}

// ── Verify: check signature against challenge ──
export function verifySolanaSignature(wallet, signature, message) {
  try {
    const publicKey = new PublicKey(wallet);
    const sigBytes = bs58.decode(signature);
    const msgBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(msgBytes, sigBytes, publicKey.toBytes());
  } catch { return false; }
}

// ── Issue session token after verification ──
export function issueAuthToken(wallet, tier) {
  return signJWT({ wallet, tier, verified: true });
}

// ── Middleware: require verified wallet ──
export function requireVerifiedWallet(req, res, next) {
  // Check Bearer token first
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    const payload = verifyJWT(auth.slice(7));
    if (payload && payload.verified) {
      req.user = payload;
      return next();
    }
  }
  
  // Fallback: X-Wallet header (legacy, less secure)
  const wallet = req.headers["x-wallet"] || req.body?.wallet;
  if (wallet) {
    req.user = { wallet, verified: false };
    return next();
  }

  return res.status(401).json({ error: "Authentication required. Connect wallet first." });
}

// ── Middleware: require verified wallet for sensitive ops ──
export function requireStrictAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    // Allow X-Wallet as fallback during transition
    const wallet = req.headers["x-wallet"] || req.body?.wallet;
    if (wallet) {
      req.user = { wallet, verified: false };
      return next();
    }
    return res.status(401).json({ error: "Wallet verification required. Sign the challenge first." });
  }

  const payload = verifyJWT(auth.slice(7));
  if (!payload || !payload.verified) {
    return res.status(401).json({ error: "Invalid or expired session. Re-verify wallet." });
  }

  req.user = payload;
  next();
}

export { nonces, signJWT, verifyJWT, JWT_SECRET };
