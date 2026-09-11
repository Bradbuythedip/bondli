#!/usr/bin/env node
// Compiles FleetTestLaunchpad.sol with solc-js 0.8.26 into FleetTestLaunchpad.json (abi + bytecode per
// contract). The artifact is committed so the launcher needs no compiler; run this only to rebuild:
//   npm i --no-save solc@0.8.26 && node launch/robinhood/contracts/compile.mjs
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);
let solc; try { solc = require("solc"); } catch { console.error("solc is not installed: npm i --no-save solc@0.8.26"); process.exit(2); }
if (!/^0\.8\.26/.test(solc.version())) { console.error(`need solc 0.8.26, have ${solc.version()}`); process.exit(2); }
const src = fs.readFileSync(path.join(here, "FleetTestLaunchpad.sol"), "utf8");
const input = { language: "Solidity", sources: { "FleetTestLaunchpad.sol": { content: src } }, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter(e => e.severity === "error");
for (const e of out.errors || []) console.error(e.formattedMessage);
if (errors.length) process.exit(1);
const art = { compiler: solc.version(), optimizer: 200, viaIR: true, evmVersion: "paris", source: "FleetTestLaunchpad.sol", contracts: {} };
for (const [name, c] of Object.entries(out.contracts["FleetTestLaunchpad.sol"])) art.contracts[name] = { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
fs.writeFileSync(path.join(here, "FleetTestLaunchpad.json"), JSON.stringify(art));
console.log("wrote FleetTestLaunchpad.json:", Object.entries(art.contracts).map(([n, c]) => `${n} ${(c.bytecode.length - 2) / 2} bytes`).join(", "));
