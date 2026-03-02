// BONDLI v3.0 — Wallet Saver (persist seeds for recovery)
import fs from "fs";
import path from "path";
import crypto from "crypto";
import bs58 from "bs58";

const SAVE_DIR = ".wallet-seeds";
const ALGO = "aes-256-gcm";

export class WalletSaver {
  constructor(password) {
    this.password = password || process.env.API_SECRET || "bondli";
    this.savePath = path.join(process.cwd(), SAVE_DIR);
    if (!fs.existsSync(this.savePath)) {
      fs.mkdirSync(this.savePath, { recursive: true });
    }
  }

  // Encrypt and save wallet seeds
  save(wallets, label = "fleet") {
    const data = wallets.map(w => ({
      index: w.index,
      role: w.role,
      pubkey: w.pubkey,
      secret: bs58.encode(w.keypair.secretKey),
    }));

    const json = JSON.stringify(data);
    const key = crypto.scryptSync(this.password, "bondli-salt", 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    let encrypted = cipher.update(json, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();

    const payload = {
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      data: encrypted,
      created: new Date().toISOString(),
      count: wallets.length,
    };

    const file = path.join(this.savePath, `${label}-${Date.now()}.enc`);
    fs.writeFileSync(file, JSON.stringify(payload));
    console.log(`[SAVER] Saved ${wallets.length} wallets to ${file}`);
    return file;
  }

  // Load and decrypt wallet seeds
  load(file) {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const key = crypto.scryptSync(this.password, "bondli-salt", 32);
    const iv = Buffer.from(payload.iv, "hex");
    const tag = Buffer.from(payload.tag, "hex");
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(payload.data, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted);
  }

  // List saved seed files
  list() {
    if (!fs.existsSync(this.savePath)) return [];
    return fs.readdirSync(this.savePath)
      .filter(f => f.endsWith(".enc"))
      .map(f => {
        const payload = JSON.parse(fs.readFileSync(path.join(this.savePath, f), "utf8"));
        return { file: f, created: payload.created, count: payload.count };
      });
  }
}

export default WalletSaver;
