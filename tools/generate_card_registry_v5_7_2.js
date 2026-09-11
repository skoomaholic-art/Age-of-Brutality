#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INPUT = path.join(ROOT, "data", "master_game_data_v5.7.2-dev.json");
const OUTPUT = path.join(ROOT, "cards", "canonical_registry_v5.7.2.json");
const CARDISH = /(event|intrigue|advisor|adviser|ambition|house|character|card|собы|интриг|совет|амби|дом|персонаж|карт)/i;
const ID_KEYS = ["CARD_ID", "AMBITION_ID", "CHARACTER_ID", "HOUSE_ID", "ID"];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const mgd = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  invariant(mgd && mgd.sheets && typeof mgd.sheets === "object", "MGD sheets missing");

  const groups = {};
  const namespacedIds = new Set();
  const globalCardIds = new Map();
  let total = 0;

  for (const [sheet, rows] of Object.entries(mgd.sheets)) {
    if (!Array.isArray(rows)) continue;
    const selected = rows.filter((row) => {
      if (!row || typeof row !== "object") return false;
      if (Object.prototype.hasOwnProperty.call(row, "CARD_ID")) return true;
      return CARDISH.test(sheet) && ID_KEYS.some((key) => row[key] != null && row[key] !== "");
    });
    if (!selected.length) continue;

    groups[sheet] = selected;
    total += selected.length;
    for (const row of selected) {
      const key = ID_KEYS.find((k) => row[k] != null && row[k] !== "");
      if (!key) continue;
      const id = String(row[key]);
      namespacedIds.add(`${sheet}:${key}:${id}`);
      if (key === "CARD_ID") {
        const prior = globalCardIds.get(id);
        invariant(!prior || prior === sheet, `Duplicate CARD_ID ${id}: ${prior || "unknown"} and ${sheet}`);
        globalCardIds.set(id, sheet);
      }
    }
  }

  invariant(total > 0, "No card-like objects found in MGD");
  const out = {
    game: "Жестокий Век",
    version: mgd.version || "V5.7.2-DEV",
    status: "GENERATED_CANONICAL_CARD_REGISTRY",
    source: "data/master_game_data_v5.7.2-dev.json",
    policy: "Generated verbatim from active MGD. It is a machine-readable game-data registry, not a substitute for missing print layout/art masters.",
    object_count: total,
    namespaced_id_count: namespacedIds.size,
    unique_card_id_count: globalCardIds.size,
    sheets: groups
  };

  const text = JSON.stringify(out, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : "";
    invariant(current === text, "cards/canonical_registry_v5.7.2.json is stale; regenerate it");
    console.log(`Card registry check OK: ${total} objects / ${globalCardIds.size} CARD_IDs`);
    return;
  }

  fs.writeFileSync(OUTPUT, text, "utf8");
  console.log(`Generated ${path.relative(ROOT, OUTPUT)}: ${total} objects / ${globalCardIds.size} CARD_IDs`);
}

main();
