#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PATHS = {
  mgd: path.join(ROOT, "data", "master_game_data_v5.7.2-dev.json"),
  prisoners: path.join(ROOT, "data", "prisoners_v5.7.2-dev.json"),
  rulesBase: path.join(ROOT, "rules", "source", "02_diplomacy_dynasty_characters.md"),
  rulesPrisoners: path.join(ROOT, "rules", "source", "02d_prisoners_ransom.md"),
};

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const check = args.has("--check") || !write;

function die(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalPrisonerFacts(prisoners) {
  invariant(prisoners.status === "CANONICAL_MODULE", "prisoners module is not CANONICAL_MODULE");
  invariant(Array.isArray(prisoners.post_capture_options), "post_capture_options missing");
  invariant(prisoners.post_capture_options.length === 4, "post_capture_options must contain exactly four choices");
  invariant(prisoners.ransom && prisoners.ransom.base_fixed_amount === null, "human ransom must not have a fixed base amount");
  invariant(prisoners.execution && prisoners.execution.cost_actions === 1, "execution action cost must remain 1");
  invariant(prisoners.execution.influence_delta === -3, "execution influence delta must remain -3");

  const hostage = (prisoners.ransom.special_event_exceptions || [])
    .find((x) => x.event_name === "Съезд заложников");
  invariant(hostage, "Съезд заложников exception missing");
  invariant(hostage.fixed_ransom_gold === 2, "Съезд заложников must fix ransom at 2 gold");
  invariant(hostage.event_id == null, "Съезд заложников event_id must remain unresolved until registry sync");

  return { hostage };
}

function reconcileMgd(mgd, prisoners) {
  const out = structuredClone(mgd);
  const { hostage } = canonicalPrisonerFacts(prisoners);

  out.confirmed_decisions = out.confirmed_decisions || {};
  out.confirmed_decisions.prisoner_post_capture_options = [...prisoners.post_capture_options];
  out.confirmed_decisions.ransom_amount = "N";
  out.confirmed_decisions.ransom_N_rule =
    "Для людей фиксированного диапазона/базовой суммы нет: пленитель предлагает N, владелец пленника принимает или отклоняет.";
  out.confirmed_decisions.ransom_acceptance_procedure =
    "Human↔Human: предложение пленителя → принять/отклонить владельцем; AI оценивает предложение отдельно по каноническому prisoner module.";
  out.confirmed_decisions.prisoner_release_destination = prisoners.release.destination;
  out.confirmed_decisions.prisoner_hold_without_ransom_destination = prisoners.hold_without_ransom?.destination_rule || "ТРЕБУЕТ РЕШЕНИЯ";
  out.confirmed_decisions.hostage_congress_exception = {
    event_name: hostage.event_name,
    event_id: hostage.event_id,
    fixed_ransom_gold: hostage.fixed_ransom_gold,
    duration: hostage.duration,
    registry_status: hostage.event_id_status,
  };

  out.prisoner_state_schema = out.prisoner_state_schema || {};
  out.prisoner_state_schema.required = [...prisoners.state_required];
  out.prisoner_state_schema.invariants = [...prisoners.invariants];

  const diplomacy = out.sheets && out.sheets.Diplomacy;
  invariant(Array.isArray(diplomacy), "MGD sheets.Diplomacy missing");
  const ransomRow = diplomacy.find((row) => row.ID === "RANSOM");
  invariant(ransomRow, "MGD Diplomacy/RANSOM row missing");
  ransomRow["Цена ресурса"] = "N золота";
  ransomRow["Условие"] =
    "Не входит в лимит подарков. Люди договариваются о N; владелец принимает/отклоняет. При событии «Съезд заложников» в его раунд N=2.";

  const executionRow = diplomacy.find((row) => row.ID === "EXECUTION");
  invariant(executionRow, "MGD Diplomacy/EXECUTION row missing");
  executionRow["Цена действий"] = `${prisoners.execution.cost_actions} действие`;
  executionRow["Цена ресурса"] = `${prisoners.execution.influence_delta} Влияния`;
  executionRow["Условие"] =
    "После казни персонаж Мёртв; ПЛЕН/heldBy очищаются. Дом жертвы может прекратить отношения без собственного штрафа по действующему правилу.";

  const events = out.sheets && out.sheets.Events;
  invariant(Array.isArray(events), "MGD sheets.Events missing");
  const p06 = events.find((row) => row.CARD_ID === "EV-P06");
  invariant(p06 && p06["Название"] === "Холодная война",
    "EVENT-ID guard: EV-P06 must remain «Холодная война» until an authoritative card registry resolves «Съезд заложников»");

  return out;
}

function extractCanonicalPrisonerSection(markdown) {
  const marker = "После захвата сторона-победитель получает ровно четыре варианта:";
  const start = markdown.indexOf(marker);
  invariant(start >= 0, "canonical prisoner body marker not found");

  let body = markdown.slice(start).trimEnd();
  body = body.replace(/^## /gm, "#### ").replace(/^### /gm, "##### ");

  return [
    "### 20.2. Решение стороны, захватившей персонажа",
    "",
    "<!-- GENERATED FROM rules/source/02d_prisoners_ransom.md by tools/reconcile_v5_7_2.js -->",
    "",
    body,
    "",
  ].join("\n");
}

function reconcileRules(baseRules, canonicalPrisoners) {
  const replacement = extractCanonicalPrisonerSection(canonicalPrisoners);
  const pattern = /### 20\.2\. Решение стороны, захватившей персонажа[\s\S]*?(?=\n## 21\. Брак, рождение и взросление)/;
  invariant(pattern.test(baseRules), "base rules section 20.2 not found");
  return baseRules.replace(pattern, replacement.trimEnd());
}

function stableStringify(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function main() {
  const prisoners = readJson(PATHS.prisoners);
  canonicalPrisonerFacts(prisoners);

  const mgdOriginalText = fs.readFileSync(PATHS.mgd, "utf8");
  const mgd = JSON.parse(mgdOriginalText);
  const mgdExpected = reconcileMgd(mgd, prisoners);
  const mgdExpectedText = stableStringify(mgdExpected);

  const rulesOriginal = fs.readFileSync(PATHS.rulesBase, "utf8");
  const rulesCanonical = fs.readFileSync(PATHS.rulesPrisoners, "utf8");
  const rulesExpected = reconcileRules(rulesOriginal, rulesCanonical);

  const changes = [];
  if (mgdOriginalText !== mgdExpectedText) changes.push("data/master_game_data_v5.7.2-dev.json");
  if (rulesOriginal !== rulesExpected) changes.push("rules/source/02_diplomacy_dynasty_characters.md");

  if (write) {
    if (changes.includes("data/master_game_data_v5.7.2-dev.json")) writeJson(PATHS.mgd, mgdExpected);
    if (changes.includes("rules/source/02_diplomacy_dynasty_characters.md")) {
      fs.writeFileSync(PATHS.rulesBase, rulesExpected, "utf8");
    }
    console.log(changes.length ? `Reconciled: ${changes.join(", ")}` : "Already reconciled.");
    return;
  }

  if (check && changes.length) {
    die(`Canonical rebuild required for: ${changes.join(", ")}. Run: node tools/reconcile_v5_7_2.js --write`);
    return;
  }

  console.log("Canonical prisoner/ransom consistency check: OK");
}

try {
  main();
} catch (error) {
  die(error && error.stack ? error.stack : String(error));
}
