#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MGD = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "master_game_data_v5.7.2-dev.json"), "utf8"));
const PRISONERS = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "prisoners_v5.7.2-dev.json"), "utf8"));
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "ai", "config", "canonical_v5.7.2.json"), "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sheet(name) {
  const rows = MGD?.sheets?.[name];
  assert(Array.isArray(rows), `Missing MGD sheet: ${name}`);
  return rows;
}

function rowByParam(name, id) {
  const row = sheet(name).find(item => item?.PARAM_ID === id);
  assert(row, `Missing ${name}/${id}`);
  return row;
}

function numberFrom(value) {
  if (typeof value === "number") return value;
  const match = String(value ?? "").match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

function assertEq(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function main() {
  assertEq(CONFIG.houses, sheet("Houses").map(row => row["Дом"]), "House IDs");

  const target = CONFIG.canonical_target_scoring;
  const tw = "AI Target Weights";
  assert(String(rowByParam(tw, "AI_ROUTE_NEUTRAL")["Значение"]).includes("base 6"), "AI_ROUTE_NEUTRAL base drift");
  assert(String(rowByParam(tw, "AI_ROUTE_ENEMY")["Значение"]).includes("base 5"), "AI_ROUTE_ENEMY base drift");
  assertEq(target.neutral_base, 6, "neutral_base");
  assertEq(target.enemy_base, 5, "enemy_base");
  assertEq(target.recapture_home_bonus, numberFrom(rowByParam(tw, "AI_RECAPTURE_HOME")["Значение"]), "AI_RECAPTURE_HOME");
  assertEq(target.recapture_capital_bonus, numberFrom(rowByParam(tw, "AI_RECAPTURE_CAPITAL")["Значение"]), "AI_RECAPTURE_CAPITAL");
  assertEq(target.complete_island_bonus, numberFrom(rowByParam(tw, "AI_COMPLETE_ISLAND")["Значение"]), "AI_COMPLETE_ISLAND");
  assertEq(target.first_center_half_bonus, numberFrom(rowByParam(tw, "AI_FIRST_CENTER_HALF")["Значение"]), "AI_FIRST_CENTER_HALF");
  assertEq(target.mainland_port_bonus, numberFrom(rowByParam(tw, "AI_PORT_VALUE")["Значение"]), "AI_PORT_VALUE");
  assertEq(target.enemy_capital_bonus, numberFrom(rowByParam(tw, "AI_CAPITAL_ENEMY")["Значение"]), "AI_CAPITAL_ENEMY");
  assertEq(target.defended_penalty_per_defender, numberFrom(rowByParam(tw, "AI_DEFENDED_PENALTY")["Значение"]), "AI_DEFENDED_PENALTY");

  const rounds = sheet("AI Round Escalation");
  for (const row of rounds) {
    const cfg = CONFIG.canonical_round_escalation[String(row.ROUND)];
    assert(cfg, `Missing round escalation ${row.ROUND}`);
    assertEq(cfg.pvp_bonus, row.PVP_BONUS, `R${row.ROUND} PVP_BONUS`);
    assertEq(cfg.late_neutral_penalty, row.LATE_NEUTRAL_PENALTY, `R${row.ROUND} LATE_NEUTRAL_PENALTY`);
  }

  const plans = sheet("AI Strategic Plans");
  assertEq(CONFIG.canonical_strategic_plans.map(x => x.id), plans.map(x => x.PLAN_ID), "Strategic plan IDs");
  assertEq(CONFIG.canonical_strategic_plans.map(x => x.max_steps), plans.map(x => x.MAX_STEPS), "Strategic plan MAX_STEPS");

  const naval = "AI Naval & Center";
  assertEq(CONFIG.canonical_naval_center.direct_sea_edge_only,
    String(rowByParam(naval, "AI_NAVAL_DIRECT_ONLY")["Значение"]).includes("DIRECT SEA EDGE"), "AI_NAVAL_DIRECT_ONLY");
  assertEq(CONFIG.canonical_naval_center.source_rule, rowByParam(naval, "AI_NAVAL_SOURCE_RULE")["Значение"], "AI_NAVAL_SOURCE_RULE");
  assertEq(CONFIG.canonical_naval_center.center_complete_weight, rowByParam(naval, "AI_CENTER_COMPLETE_WEIGHT")["Значение"], "AI_CENTER_COMPLETE_WEIGHT");
  assertEq(CONFIG.canonical_naval_center.center_first_weight, rowByParam(naval, "AI_CENTER_FIRST_WEIGHT")["Значение"], "AI_CENTER_FIRST_WEIGHT");
  assertEq(CONFIG.canonical_naval_center.port_preparation_weight, rowByParam(naval, "AI_PORT_PREP_WEIGHT")["Значение"], "AI_PORT_PREP_WEIGHT");
  assertEq(CONFIG.canonical_naval_center.plan_chain_max, rowByParam(naval, "AI_NAVAL_CHAIN_MAX")["Значение"], "AI_NAVAL_CHAIN_MAX");

  const dip = "AI Diplomacy";
  assertEq(CONFIG.canonical_diplomacy.official_relation_soft_cap_default, rowByParam(dip, "AI_REL_CAP_DEFAULT")["Значение"], "AI_REL_CAP_DEFAULT");
  assertEq(CONFIG.canonical_diplomacy.official_relation_soft_cap_by_house["Ортайн"], rowByParam(dip, "AI_REL_CAP_ORTAYN")["Значение"], "AI_REL_CAP_ORTAYN");
  assertEq(CONFIG.canonical_diplomacy.break_hostility_threshold, rowByParam(dip, "AI_BREAK_HOSTILITY")["Значение"], "AI_BREAK_HOSTILITY");
  assertEq(CONFIG.canonical_diplomacy.transfer_gold_max, rowByParam(dip, "AI_TRANSFER_GOLD_MAX")["Значение"], "AI_TRANSFER_GOLD_MAX");

  assertEq(CONFIG.canonical_prisoner_ai.offer_is_random, PRISONERS.ransom.ai.offer_is_random, "prisoner offer_is_random");
  assertEq(CONFIG.canonical_prisoner_ai.offer_factors, PRISONERS.ransom.ai.offer_factors, "prisoner offer_factors");
  assertEq(CONFIG.canonical_prisoner_ai.logging_required, PRISONERS.ransom.ai.logging_required, "prisoner logging_required");
  assertEq(CONFIG.canonical_prisoner_ai.numeric_weights_status, PRISONERS.ransom.ai.numeric_weights_status, "prisoner numeric_weights_status");

  const congress = PRISONERS.ransom.special_event_exceptions.find(x => x.event_id === "EV-P06");
  assert(congress, "EV-P06 prisoner exception missing");
  assertEq(CONFIG.canonical_prisoner_ai.hostage_congress.event_id, congress.event_id, "hostage congress ID");
  assertEq(CONFIG.canonical_prisoner_ai.hostage_congress.fixed_ransom_gold, congress.fixed_ransom_gold, "hostage congress ransom");

  assert(CONFIG.decision_policy.legal_actions_only === true, "AI must consume LEGAL_ACTIONS only");
  assert(CONFIG.decision_policy.status === "IMPLEMENTATION_NOT_HUMAN_RULE", "decision policy must be labelled implementation-only");

  console.log("AI config check OK: MGD/prisoner sources synchronized");
}

main();
