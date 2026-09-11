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
  core: path.join(ROOT, "rules", "source", "00_core_setup.md"),
  events: path.join(ROOT, "rules", "source", "03a_advisors_intrigue_events_exile.md"),
  quickRef: path.join(ROOT, "rules", "source", "03c_quick_reference_end_cases.md"),
  arenaTech: path.join(ROOT, "rules", "source", "04_arena_technical_appendix.md"),
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

function replaceRequired(text, search, replacement, label) {
  if (text.includes(replacement)) return text;
  invariant(text.includes(search), `${label}: expected source text not found`);
  return text.replace(search, replacement);
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

  out.source_policy = "GitHub main is canonical. Precedence: explicit confirmed decisions → canonical modules → active V5.7.2 Rules/Data → historical baselines. A canonical module supersedes stale monolithic fields until regeneration.";
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
  ransomRow["Цена действий"] = "0 действий";
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
  return baseRules.replace(pattern, replacement.trimEnd() + "\n");
}

function reconcileCore(text) {
  text = replaceRequired(
    text,
    "| **Важно: MASTER GAME DATA является техническим источником истины. Если число или допустимое значение в другом компоненте расходится с 02_Жестокий_Век_Master_Game_Data_V5.7.1_STABLE.xlsx, применяется MASTER GAME DATA. Текст конкретной карты имеет приоритет над базовым правилом только в пределах явно описанного исключения.** |",
    "| **Важно: канонический порядок источников V5.7.2 — последнее явно подтверждённое решение → canonical module → активные Rules/Data → historical baseline. Монолитный Master Game Data не имеет приоритета над более новым canonical module. Текст конкретной карты изменяет базовое правило только в пределах явно описанного исключения.** |",
    "core source precedence"
  );
  text = replaceRequired(
    text,
    "> СТАТУС СБОРКИ: стабильная плейтестовая ветка. Механическая база",
    "> СТАТУС СБОРКИ: V5.7.2-DEV; цифровая Arena — V5.7.2-PLAYABLE-RC2; статус STABLE не присвоен. Механическая база",
    "core build status"
  );
  return text;
}

function reconcileEvents(text) {
  return replaceRequired(
    text,
    "Точные тексты\nСобытий находятся на картах и в файле\n03_Жестокий_Век_Карточки_V5.7.2-DEV.xlsx.",
    "Точные тексты Событий должны подтверждаться каноническим Cards source.\nПолный редактируемый Cards master V5.7.2 пока не мигрирован в GitHub;\nдо его миграции расхождение между Rules/Data/Arena и текстом карты считается\nблокером STABLE, а отсутствующий текст нельзя восстанавливать по памяти.",
    "events card-source reference"
  );
}

function reconcileArenaTech(text) {
  return replaceRequired(
    text,
    "- Актуальный цифровой клиент проекта — только `10_Жестокий_Век_Unified_Arena_V5.7.2-DEV.html`. Отдельные AI Arena, Human Arena и Observer Arena не являются частью актуального билда.",
    "- Актуальная цифровая линия проекта — **V5.7.2-PLAYABLE-RC2**; manifest: `arena/builds/V5.7.2_PLAYABLE_RC2.manifest.json`. Exact HTML указан в manifest по имени/размеру/SHA-256, но пока не хранится в GitHub как полноценный reconstructable artifact. Отдельные historical AI/Human/Observer Arena не считаются текущим release.",
    "Arena current-client reference"
  );
}

function reconcileQuickReference(text) {
  if (text.includes("| Выкуп пленного")) return text;
  const marker = "\n\n# 35. Конец игры";
  invariant(text.includes(marker), "quick reference end marker not found");
  const rows = [
    "| Выкуп пленного          | 0            | N золота   | 0           | Пленитель предлагает N; владелец принимает/отклоняет. Не входит в лимит подарков. При «Съезде заложников» в его раунд N=2. |",
    "| Казнь пленного          | 1            | 0          | -3          | После оплаты персонаж становится Мёртв; статус ПЛЕН и heldBy очищаются. Дополнительный -1 при «Съезде заложников» в Arena RC2 не канонизирован и требует сверки Cards source. |",
  ].join("\n");
  return text.replace(marker, `\n${rows}${marker}`);
}

function stableStringify(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function main() {
  const prisoners = readJson(PATHS.prisoners);
  canonicalPrisonerFacts(prisoners);

  const originals = {
    mgd: fs.readFileSync(PATHS.mgd, "utf8"),
    rulesBase: fs.readFileSync(PATHS.rulesBase, "utf8"),
    core: fs.readFileSync(PATHS.core, "utf8"),
    events: fs.readFileSync(PATHS.events, "utf8"),
    quickRef: fs.readFileSync(PATHS.quickRef, "utf8"),
    arenaTech: fs.readFileSync(PATHS.arenaTech, "utf8"),
  };
  const canonicalRules = fs.readFileSync(PATHS.rulesPrisoners, "utf8");

  const mgdExpected = stableStringify(reconcileMgd(JSON.parse(originals.mgd), prisoners));
  const expected = {
    mgd: mgdExpected,
    rulesBase: reconcileRules(originals.rulesBase, canonicalRules),
    core: reconcileCore(originals.core),
    events: reconcileEvents(originals.events),
    quickRef: reconcileQuickReference(originals.quickRef),
    arenaTech: reconcileArenaTech(originals.arenaTech),
  };

  const files = {
    mgd: "data/master_game_data_v5.7.2-dev.json",
    rulesBase: "rules/source/02_diplomacy_dynasty_characters.md",
    core: "rules/source/00_core_setup.md",
    events: "rules/source/03a_advisors_intrigue_events_exile.md",
    quickRef: "rules/source/03c_quick_reference_end_cases.md",
    arenaTech: "rules/source/04_arena_technical_appendix.md",
  };
  const changes = Object.keys(files).filter((k) => originals[k] !== expected[k]);

  if (write) {
    for (const key of changes) fs.writeFileSync(PATHS[key], expected[key], "utf8");
    console.log(changes.length ? `Reconciled: ${changes.map((k) => files[k]).join(", ")}` : "Already reconciled.");
    return;
  }

  if (check && changes.length) {
    die(`Canonical rebuild required for: ${changes.map((k) => files[k]).join(", ")}. Run: node tools/reconcile_v5_7_2.js --write`);
    return;
  }

  console.log("V5.7.2 canonical consistency check: OK");
}

try {
  main();
} catch (error) {
  die(error && error.stack ? error.stack : String(error));
}
