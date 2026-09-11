#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INPUT = path.join(ROOT, "data", "master_game_data_v5.7.2-dev.json");
const OUTPUT = path.join(ROOT, "cards", "canonical_registry_v5.7.2.json");
const PHYSICAL_CARD_SHEETS = new Set(["Events", "Houses", "Characters", "Advisors", "Ambitions", "Intrigues"]);
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
    if (!Array.isArray(rows) || !PHYSICAL_CARD_SHEETS.has(sheet)) continue;
    const selected = rows.filter((row) => row && typeof row === "object");
    if (!selected.length) continue;

    groups[sheet] = selected;
    total += selected.length;
    selected.forEach((row, index) => {
      const key = ID_KEYS.find((k) => row[k] != null && row[k] !== "");
      if (key) {
        const id = String(row[key]);
        namespacedIds.add(`${sheet}:${key}:${id}`);
        if (key === "CARD_ID") {
          const prior = globalCardIds.get(id);
          invariant(!prior || prior === sheet, `Duplicate CARD_ID ${id}: ${prior || "unknown"} and ${sheet}`);
          globalCardIds.set(id, sheet);
        }
      } else {
        // Internal registry identity only; it is not written into gameplay data and is not a new game ID.
        namespacedIds.add(`${sheet}:ROW:${index}`);
      }
    });
  }

  invariant(total > 0, "No physical card-design rows found in MGD");
  const out = {
    game: "Жестокий Век",
    version: mgd.version || "V5.7.2-DEV",
    status: "GENERATED_CANONICAL_CARD_REGISTRY",
    source: "data/master_game_data_v5.7.2-dev.json",
    policy: "Generated verbatim from active MGD physical card-design sheets. Internal ROW identities are registry-only and are not gameplay IDs. This registry does not substitute for missing card sources such as an absent Intrigues sheet or for print art masters.",
    object_count: total,
    namespaced_id_count: namespacedIds.size,
    unique_card_id_count: globalCardIds.size,
    sheets: groups
  };

  const text = JSON.stringify(out, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : "";
    invariant(current === text, "cards/canonical_registry_v5.7.2.json is stale; regenerate it");
    console.log(`Card registry check OK: ${total} designs / ${globalCardIds.size} CARD_IDs`);
    return;
  }

  fs.writeFileSync(OUTPUT, text, "utf8");
  console.log(`Generated ${path.relative(ROOT, OUTPUT)}: ${total} designs / ${globalCardIds.size} CARD_IDs`);
}

main();
