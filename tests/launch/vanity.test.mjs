// The grinder decides which address the token will have, so what must hold is that its fast path is
// the same function as the plain one — bit for bit, on every salt — and that the pattern test it uses
// is the same test as reading the address as hex. A grinder that is merely fast and slightly wrong
// spends an hour finding a salt for an address that will never exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, keccak256, getCreate2Address, concat, hexlify, getBytes, zeroPadValue, toBeHex } from "ethers";
import { fastPredictor, byteMatcher } from "../../launch/notafruitfly/vanity.mjs";

const coder = AbiCoder.defaultAbiCoder();
const WALLET = "0x7a109090C2f7B730120A64f70c50f7a35f000000";
const DEPLOYER = "0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42";
const FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const TYPES = ["string", "string", "string", "string", "tuple(string,string,string,string,string)", "address", "address", "address", "uint256"];

function rig({ creationKb = 9, name = "Not a fruit fly", socials = ["https://x.com/notafruitfly", "", "https://discord.gg/SHueKKXRkv", "https://bondli.fun", ""] } = {}) {
  const tokenCreation = "0x" + "60".repeat(creationKb * 512);
  const curveHash = keccak256("0x" + "ab".repeat(64));
  const argsWithCurve = (curve) => coder.encode(TYPES, [name, "NOTAFRUITFLY", "https://bondli.fun/fly.png", "flybrain is a fruit fly. this is not.", socials, WALLET, curve, FACTORY, 10n ** 27n]);
  // the plain prediction, exactly as pons-launch.mjs writes it
  const slow = (userSalt) => {
    const salt = keccak256(coder.encode(["address", "bytes32"], [WALLET, zeroPadValue(toBeHex(userSalt), 32)]));
    const curve = getCreate2Address(DEPLOYER, salt, curveHash);
    return getCreate2Address(DEPLOYER, salt, keccak256(concat([tokenCreation, argsWithCurve(curve)]))).toLowerCase();
  };
  const fast = fastPredictor({ tokenCreation, argsWithCurve, curveHash, wallet: WALLET, deployer: DEPLOYER });
  return { slow, fast: (s) => "0x" + Buffer.from(fast(s)).toString("hex"), argsWithCurve };
}

test("vanity: the fast grinder is the same function as the plain prediction", () => {
  const { slow, fast } = rig();
  for (const s of [0n, 1n, 7n, 255n, 256n, 4096n, 65_535n, 1_000_003n, 0xffffffffn, 0xdeadbeefn, 2n ** 53n, 2n ** 63n - 1n])
    assert.equal(fast(s), slow(s), `salt ${s}`);
  // a thousand consecutive salts, which is how it is actually used
  for (let s = 1n; s <= 1000n; s++) if (fast(s) !== slow(s)) assert.fail(`salt ${s}: ${fast(s)} vs ${slow(s)}`);
});

test("vanity: it stays the same function when the launch parameters change the argument layout", () => {
  for (const over of [
    { creationKb: 1 },                                        // a short creation code
    { creationKb: 17 },                                       // one that crosses more keccak blocks
    { name: "" },                                             // an empty string moves every tail offset
    { name: "a".repeat(200) },                                // and a long one moves them the other way
    { socials: ["", "", "", "", ""] },
    { socials: ["https://x.com/notafruitfly", "https://t.me/x", "https://discord.gg/SHueKKXRkv", "https://bondli.fun", "fc"] },
  ]) {
    const { slow, fast } = rig(over);
    for (const s of [1n, 999n, 123_456_789n]) assert.equal(fast(s), slow(s), `${JSON.stringify(over)} salt ${s}`);
  }
});

test("vanity: a different wallet mines a different address, and only that wallet's", () => {
  const a = rig(), b = fastPredictor({
    tokenCreation: "0x" + "60".repeat(9 * 512), curveHash: keccak256("0x" + "ab".repeat(64)),
    argsWithCurve: a.argsWithCurve, wallet: "0x" + "11".repeat(20), deployer: DEPLOYER,
  });
  assert.notEqual(a.fast(7n), "0x" + Buffer.from(b(7n)).toString("hex"), "the launch wallet is part of the salt");
});

test("vanity: the byte test is the hex test, for prefixes, suffixes and both", () => {
  const hex = (a) => Buffer.from(a).toString("hex");
  const rnd = () => { const a = new Uint8Array(20); for (let i = 0; i < 20; i++) a[i] = (Math.random() * 256) | 0; return a; };
  const cases = [["", "000000"], ["", "0"], ["", "00000"], ["f00d", ""], ["", "f00d"], ["a", "b"], ["ab", "cde"], ["", ""]];
  for (const [pre, suf] of cases) {
    const m = byteMatcher(pre, suf);
    for (let i = 0; i < 400; i++) { const a = rnd(), h = hex(a); assert.equal(m(a), h.startsWith(pre) && h.endsWith(suf), `${pre}…${suf} on ${h}`); }
  }
  // and the one that matters: six trailing zeros is the last three bytes being zero
  const m6 = byteMatcher("", "000000"), a = new Uint8Array(20);
  a[19] = 1; assert.equal(m6(a), false);
  a[19] = 0; assert.equal(m6(a), true);
  a[17] = 0x10; assert.equal(m6(a), false, "the seventh nibble from the end is not part of the pattern");
  a[17] = 0; assert.equal(m6(a), true);
  // an odd-length suffix reads a nibble, not a byte
  const m5 = byteMatcher("", "00000"); const b = new Uint8Array(20);
  b[17] = 0x10; assert.equal(m5(b), true, "0x…1 0 00 00 ends in five zeros");
  b[17] = 0x01; assert.equal(m5(b), false);
});

test("vanity: it refuses a layout it cannot splice rather than mining a wrong address", () => {
  const base = { tokenCreation: "0x6060", curveHash: keccak256("0x00"), wallet: WALLET, deployer: DEPLOYER };
  // the curve address nowhere in the arguments
  assert.throws(() => fastPredictor({ ...base, argsWithCurve: () => coder.encode(["uint256"], [1]) }), /does not appear/);
  // the address appearing twice: splicing one of them would be wrong
  assert.throws(() => fastPredictor({ ...base, argsWithCurve: (c) => coder.encode(["address", "address"], [c, c]) }), /more than once/);
  // arguments whose length depends on the address
  assert.throws(() => fastPredictor({ ...base, argsWithCurve: (c) => coder.encode(["string"], [c.repeat(BigInt(c) % 2n === 0n ? 1 : 3)]) }), /change length|does not appear/);
});

test("vanity: how long six zeros actually takes, measured rather than assumed", () => {
  const { fast } = rig();
  const t0 = Date.now(); let n = 0n;
  while (Date.now() - t0 < 600) { fast(n); n++; }
  const rate = Number(n) / ((Date.now() - t0) / 1000);
  const coreMin = (16 ** 6) / rate / 60;
  console.log(`    ${Math.round(rate).toLocaleString()} tries/s/core -> 16.7M (six zeros) = ${coreMin.toFixed(0)} core-minutes`);
  assert.ok(rate > 1500, `the fast path should clear 1500/s/core on any machine that can run this; got ${Math.round(rate)}`);
});
