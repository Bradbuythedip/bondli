// ═══ The vanity grinder's hot loop ═══
// Separated from the CLI so it can be tested against the plain ethers prediction it has to reproduce.
import { getBytes } from "ethers";
import { keccak_256 } from "@noble/hashes/sha3";   // ethers' own hash, with a resumable state

const ZERO_ADDR = "0x" + "0".repeat(40);

/** The same prediction as `predict` below, in raw bytes, ~20x faster.
 *
 *  Per try the slow path ABI-encodes the whole token argument list (four strings and five socials) and
 *  keccaks the entire token init code — nine kilobytes of creation code that never changes. Only ONE
 *  32-byte word changes between tries: the curve address inside the arguments. So: find that word by
 *  encoding twice and diffing, absorb everything before it into a keccak state once, and per try clone
 *  the state and feed the 32-byte word plus the short tail. Four keccaks of 64, 85, ~600 and 85 bytes,
 *  no hex strings, no re-encoding. `mine` proves this agrees with the slow path before it grinds.
 */
export function fastPredictor({ tokenCreation, argsWithCurve, curveHash, wallet, deployer }) {
  const zero = getBytes(argsWithCurve(ZERO_ADDR)), probe = getBytes(argsWithCurve("0x" + "11".repeat(20)));
  if (zero.length !== probe.length) throw new Error("token arguments change length with the curve address; the fast path cannot splice them");
  let at = -1;
  for (let i = 0; i < zero.length; i++) if (zero[i] !== probe[i]) { at = i; break; }
  if (at < 0) throw new Error("the curve address does not appear in the token arguments");
  const word = at - (at % 32);                       // the 32-byte word the address sits in
  for (let i = word; i < word + 32; i++) if (i < word + 12 ? zero[i] !== 0 || probe[i] !== 0 : false) throw new Error("the curve word is not a left-padded address");
  for (let i = word + 32; i < zero.length; i++) if (zero[i] !== probe[i]) throw new Error("the curve address appears more than once in the token arguments");

  const creation = getBytes(tokenCreation);
  const prefix = new Uint8Array(creation.length + word);
  prefix.set(creation); prefix.set(zero.subarray(0, word), creation.length);
  const tail = zero.subarray(word + 32);
  const base = keccak_256.create(); base.update(prefix);

  const saltIn = new Uint8Array(64); saltIn.set(getBytes(wallet), 12);   // abi.encode(address,bytes32)
  const saltView = new DataView(saltIn.buffer);
  const c2 = new Uint8Array(85); c2[0] = 0xff; c2.set(getBytes(deployer), 1);   // 0xff ++ deployer ++ salt ++ initHash
  const curveHashBytes = getBytes(curveHash);
  const curveWord = new Uint8Array(32);

  /** The 20 token address bytes for one user salt. */
  return (userSalt) => {
    saltView.setBigUint64(56, userSalt);
    c2.set(keccak_256(saltIn), 21);
    c2.set(curveHashBytes, 53);
    curveWord.set(keccak_256(c2).subarray(12), 12);
    const h = base.clone(); h.update(curveWord); h.update(tail);
    c2.set(h.digest(), 53);
    return keccak_256(c2).subarray(12);
  };
}

/** A hex prefix/suffix test on the 20 raw address bytes, so no address is ever turned into a string. */
export function byteMatcher(prefix, suffix) {
  const nib = (hex, fromEnd) => { const out = []; for (let i = 0; i < hex.length; i++) { const pos = fromEnd ? 40 - hex.length + i : i; out.push([pos >> 1, pos & 1 ? 0x0f : 0xf0, parseInt(hex[i], 16) << (pos & 1 ? 0 : 4)]); } return out; };
  const tests = [...nib(prefix, false), ...nib(suffix, true)];
  return (a) => { for (const [i, mask, want] of tests) if ((a[i] & mask) !== want) return false; return true; };
}

