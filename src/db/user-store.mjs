// BONDLI — Persistent User Store (Redis, no TTL on user records)
// Tracks: wallet, tier, first seen, launches, volume, profit, referrals, last active

export class UserStore {
  constructor(redis) {
    this.redis = redis;
    this.prefix = "user:";
  }

  // Get or create user — called on every authenticated request
  async getOrCreate(wallet) {
    const key = this.prefix + wallet;
    let data = await this.redis.hGetAll(key);

    if (!data || !data.wallet) {
      // New user
      data = {
        wallet,
        tier: "free",
        firstSeen: Date.now().toString(),
        lastActive: Date.now().toString(),
        totalLaunches: "0",
        totalDeploys: "0",
        totalSolIn: "0",           // total SOL deposited into sessions
        totalSolOut: "0",          // total SOL recovered/returned
        totalProfit: "0",          // net profit across all sessions
        totalPlatformCut: "0",     // total fees paid to platform
        totalTokensCreated: "0",
        referralCode: this._genRefCode(wallet),
        referredBy: "",
        referralCount: "0",
        referralEarnings: "0",     // SOL earned from referrals
        banned: "false",
        notes: "",
      };
      await this.redis.hSet(key, data);
      console.log(`[USER] New user: ${wallet.slice(0, 8)}... | ref: ${data.referralCode}`);
    }

    return this._parse(data);
  }

  // Get user (returns null if not found)
  async get(wallet) {
    const key = this.prefix + wallet;
    const data = await this.redis.hGetAll(key);
    if (!data || !data.wallet) return null;
    return this._parse(data);
  }

  // Update user fields
  async update(wallet, fields) {
    const key = this.prefix + wallet;
    const stringFields = {};
    for (const [k, v] of Object.entries(fields)) {
      stringFields[k] = String(v);
    }
    stringFields.lastActive = Date.now().toString();
    await this.redis.hSet(key, stringFields);
  }

  // Record a launch (create token + fleet)
  async recordLaunch(wallet, ca, solIn) {
    const user = await this.getOrCreate(wallet);
    await this.update(wallet, {
      totalLaunches: user.totalLaunches + 1,
      totalSolIn: +(user.totalSolIn + solIn).toFixed(6),
      lastCA: ca,
      lastLaunchAt: Date.now().toString(),
    });

    // Push to launch history (keep 200)
    await this.redis.lPush("launches:" + wallet, JSON.stringify({ ca, solIn, time: Date.now() }));
    await this.redis.lTrim("launches:" + wallet, 0, 199);
  }

  // Record a deploy-only (no fleet)
  async recordDeploy(wallet, ca) {
    const user = await this.getOrCreate(wallet);
    await this.update(wallet, {
      totalDeploys: user.totalDeploys + 1,
      totalTokensCreated: user.totalTokensCreated + 1,
      lastCA: ca,
      lastDeployAt: Date.now().toString(),
    });
  }

  // Record session close / sweep results
  async recordClose(wallet, solOut, platformCut, netProfit) {
    const user = await this.getOrCreate(wallet);
    await this.update(wallet, {
      totalSolOut: +(user.totalSolOut + solOut).toFixed(6),
      totalPlatformCut: +(user.totalPlatformCut + platformCut).toFixed(6),
      totalProfit: +(user.totalProfit + netProfit).toFixed(6),
    });

    // Check if referrer gets a cut
    if (user.referredBy) {
      const referrerCut = +(platformCut * 0.10).toFixed(6); // 10% of platform cut to referrer
      if (referrerCut > 0.0001) {
        const referrer = await this.get(user.referredBy);
        if (referrer) {
          await this.update(user.referredBy, {
            referralEarnings: +(referrer.referralEarnings + referrerCut).toFixed(6),
          });
        }
      }
    }
  }

  // Set tier (pro upgrade, vip whitelist)
  async setTier(wallet, tier) {
    await this.update(wallet, { tier, tierChangedAt: Date.now().toString() });
  }

  // Apply referral code
  async applyReferral(wallet, refCode) {
    const user = await this.getOrCreate(wallet);
    if (user.referredBy) return { ok: false, error: "Already referred" };

    // Find referrer by code
    const referrerWallet = await this.redis.get("ref:" + refCode);
    if (!referrerWallet) return { ok: false, error: "Invalid referral code" };
    if (referrerWallet === wallet) return { ok: false, error: "Cannot refer yourself" };

    // Apply
    await this.update(wallet, { referredBy: referrerWallet });
    const referrer = await this.get(referrerWallet);
    if (referrer) {
      await this.update(referrerWallet, { referralCount: referrer.referralCount + 1 });
    }

    return { ok: true, referrer: referrerWallet.slice(0, 8) + "..." };
  }

  // Get launch history
  async getLaunchHistory(wallet, limit = 20) {
    const items = await this.redis.lRange("launches:" + wallet, 0, limit - 1);
    return items.map(i => { try { return JSON.parse(i); } catch { return null; } }).filter(Boolean);
  }

  // Rate limit check — returns { allowed: bool, remaining: int, resetIn: int }
  async checkRateLimit(wallet, action, maxPerHour) {
    const key = `rl:${action}:${wallet}`;
    const count = parseInt(await this.redis.get(key) || "0");
    if (count >= maxPerHour) {
      const ttl = await this.redis.ttl(key);
      return { allowed: false, remaining: 0, resetIn: ttl };
    }
    await this.redis.incr(key);
    if (count === 0) await this.redis.expire(key, 3600); // 1 hour window
    return { allowed: true, remaining: maxPerHour - count - 1, resetIn: 0 };
  }

  // Admin: get all users
  async allUsers(limit = 100) {
    const keys = await this.redis.keys(this.prefix + "*");
    const users = [];
    for (const key of keys.slice(0, limit)) {
      const data = await this.redis.hGetAll(key);
      if (data.wallet) users.push(this._parse(data));
    }
    return users.sort((a, b) => b.totalSolIn - a.totalSolIn); // sort by volume
  }

  // Admin: platform stats
  async platformStats() {
    const users = await this.allUsers(10000);
    return {
      totalUsers: users.length,
      freeUsers: users.filter(u => u.tier === "free").length,
      proUsers: users.filter(u => u.tier === "pro").length,
      vipUsers: users.filter(u => u.tier === "vip").length,
      totalLaunches: users.reduce((s, u) => s + u.totalLaunches, 0),
      totalSolVolume: +users.reduce((s, u) => s + u.totalSolIn, 0).toFixed(2),
      totalPlatformRevenue: +users.reduce((s, u) => s + u.totalPlatformCut, 0).toFixed(6),
      totalReferralEarnings: +users.reduce((s, u) => s + u.referralEarnings, 0).toFixed(6),
      activeToday: users.filter(u => Date.now() - u.lastActive < 86400000).length,
      activeWeek: users.filter(u => Date.now() - u.lastActive < 604800000).length,
    };
  }

  // Parse Redis strings to typed values
  _parse(data) {
    return {
      ...data,
      totalLaunches: parseInt(data.totalLaunches || "0"),
      totalDeploys: parseInt(data.totalDeploys || "0"),
      totalSolIn: parseFloat(data.totalSolIn || "0"),
      totalSolOut: parseFloat(data.totalSolOut || "0"),
      totalProfit: parseFloat(data.totalProfit || "0"),
      totalPlatformCut: parseFloat(data.totalPlatformCut || "0"),
      totalTokensCreated: parseInt(data.totalTokensCreated || "0"),
      referralCount: parseInt(data.referralCount || "0"),
      referralEarnings: parseFloat(data.referralEarnings || "0"),
      firstSeen: parseInt(data.firstSeen || "0"),
      lastActive: parseInt(data.lastActive || "0"),
      banned: data.banned === "true",
    };
  }

  // Generate unique referral code from wallet
  _genRefCode(wallet) {
    const code = wallet.slice(0, 4) + wallet.slice(-4);
    // Store reverse lookup
    this.redis.set("ref:" + code, wallet).catch(() => {});
    return code;
  }
}

export default UserStore;
