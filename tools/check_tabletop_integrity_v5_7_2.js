#!/usr/bin/env node
"use strict";

// Cross-check the tabletop source of truth against the executable Arena.
// This intentionally validates structure and parity, not balance opinions.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const file = (rel) => path.join(ROOT, rel);
const read = (rel) => fs.readFileSync(file(rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const fail = (message) => { throw new Error(message); };
const check = (condition, message) => { if (!condition) fail(message); };

const mgd = json("data/master_game_data_v5.7.2-dev.json");
const intrigues = json("data/intrigues_v5.7.2.json");
const cards = json("cards/canonical_card_set_v5.7.2.json");
const topology = json("map/canonical_topology_v5.7.2.json");
const manifest = json("arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.manifest.json");
const events = mgd.sheets?.Events || [];
const params = mgd.sheets?.["Global Parameters"] || [];
const actions = mgd.sheets?.Actions || [];
const engine = [
  read("arena/source/current/recovery/engine_runtime_recovered_prefix.js"),
  read("arena/source/current/engine_runtime_tail.part-00.js"),
  read("arena/source/current/engine_runtime_tail.part-01.js"),
  read("arena/source/current/engine_runtime_tail.part-02.js"),
].join("\n");
const diplomacy = read("arena/source/current/diplomacy_runtime_patch.js");
const intrigueRuntime = read("arena/source/current/intrigue_runtime_patch.js");
const ui = read("arena/source/current/ui_runtime.js");
const coreRules = read("rules/source/00_core_setup.md");
const intrigueRules = read("rules/source/03aa_intrigues_v5.7.2_new_design.md");

check(mgd.version === "V5.7.2-DEV", `MGD version mismatch: ${mgd.version}`);
check(params.some((p) => p.PARAM_ID === "INTRIGUE_START_HAND" && p.Min === 0 && p.Max === 0 && p["По умолчанию"] === 0), "INTRIGUE_START_HAND must be fixed at 0");
check(actions.length === 18, `MGD action count mismatch: ${actions.length}`);
check(intrigues.version === "V5.7.2-DEV" && String(intrigues.status || "").startsWith("CANONICAL_MODULE"), "Intrigue module is not canonical");
check(Array.isArray(intrigues.cards) && intrigues.cards.length === 40, `Intrigue design count mismatch: ${intrigues.cards?.length}`);
check(cards.design_count === 151 && cards.physical_copy_count === 160, "Composite card totals mismatch");
check(topology.counts?.territories === 52 && topology.counts?.land_edges === 81 && topology.counts?.sea_edges === 23 && topology.counts?.ports === 16, "Canonical topology counts mismatch");

const p06 = events.find((row) => row.CARD_ID === "EV-P06");
check(p06 && p06["Название"] === "Съезд заложников", "EV-P06 canonical event missing");
check(String(p06["Модификатор"] || "").includes("2 золота"), "EV-P06 ransom exception missing");
check(String(p06["Запрет"] || "").includes("Не меняет цену казни"), "EV-P06 execution guard missing");

check(intrigueRules.includes("Стартовая рука Интриг — 0 карт"), "Intrigue rules do not state zero-card setup");
check(coreRules.includes("0 карт Интриг"), "Core setup does not state zero-card setup");
check(engine.includes("for(let amount=1;amount<=max;amount++)"), "March does not expose every legal army size");
check(engine.includes("March would exceed territory warrior cap"), "March territory cap guard missing");
check(diplomacy.includes("pendingDiplomacy") && diplomacy.includes("requiresDiplomacyConsent"), "Human diplomacy consent patch missing");
check(intrigueRuntime.includes("INTRIGUE_START_HAND"), "Runtime is not parameterized by intrigue start hand");
check(ui.includes("Симуляция до конца") && ui.includes("function topologyMap"), "Arena UI full-run/map controls missing");

const artifact = file(`arena/builds/${manifest.artifact}`);
check(fs.existsSync(artifact), `Arena artifact missing: ${manifest.artifact}`);
const bytes = fs.statSync(artifact).size;
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
check(bytes === manifest.bytes, `Arena byte manifest mismatch: ${bytes} != ${manifest.bytes}`);
check(sha256 === manifest.sha256, `Arena SHA-256 manifest mismatch: ${sha256} != ${manifest.sha256}`);
check(manifest.sourceBlockedActions.length === 0, "Arena reports source-blocked actions");
check(manifest.territories === 52 && manifest.actionsInMGD === 18 && manifest.intrigueCards === 40, "Arena manifest capability counts mismatch");
check(manifest.mapRenderer === "INLINE_CANONICAL_TOPOLOGY_SVG" && manifest.newGameFeedback === true, "Arena manifest UI capability mismatch");

console.log(JSON.stringify({
  status: "OK",
  version: mgd.version,
  actions: actions.length,
  intrigues: intrigues.cards.length,
  cards: `${cards.design_count}/${cards.physical_copy_count}`,
  topology: topology.counts,
  arena: { bytes, sha256, sourceBlockedActions: manifest.sourceBlockedActions },
}, null, 2));
