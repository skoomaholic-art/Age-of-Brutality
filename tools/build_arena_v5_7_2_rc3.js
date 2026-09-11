#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "arena", "source", "rc1");
const ENGINE_PATCH = path.join(ROOT, "arena", "source", "patches", "v5.7.2_rc3_engine_delta.js");
const HUMAN_UI_PATCH = path.join(ROOT, "arena", "source", "patches", "v5.7.2_rc2_human_ui.js");
const BUILD_DIR = path.join(ROOT, "arena", "builds");
const QA_DIR = path.join(ROOT, "qa", "reports");
const VERSION = "V5.7.2-PLAYABLE-RC3";
const ARTIFACT_NAME = "Жестокий_Век_Arena_V5.7.2_PLAYABLE_RC3.html";
const ARTIFACT = path.join(BUILD_DIR, ARTIFACT_NAME);
const MANIFEST = path.join(BUILD_DIR, "V5.7.2_PLAYABLE_RC3.manifest.json");
const QA_JSON = path.join(QA_DIR, "Game_Master_Summary_V5.7.2_RC3_500seeds.json");
const QA_MD = path.join(QA_DIR, "Game_Master_Report_V5.7.2_RC3_500seeds.md");
const RUNNER = path.join(ROOT, "qa", "game-master", "game_master_runner.js");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readChunk(name) {
  return fs.readFileSync(path.join(SOURCE_DIR, name), "utf8").replace(/\s+/g, "");
}

function tolerantGunzip(gz) {
  try {
    return { html: zlib.gunzipSync(gz).toString("utf8"), tolerant: false };
  } catch (strictError) {
    const html = zlib.gunzipSync(gz, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString("utf8");
    return { html, tolerant: true, strictError: strictError.message };
  }
}

function reconstructBaseline() {
  const names = fs.readdirSync(SOURCE_DIR).filter((x) => x.endsWith(".b64"));
  invariant(names.length >= 2, "RC1 source chunks missing");

  const numbered = names.filter((x) => /^part-\d+\.b64$/.test(x)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const tails = names.filter((x) => /tail\.b64$/.test(x)).sort();
  const lexical = [...names].sort();
  const candidates = [
    [numbered[0], ...tails, ...numbered.slice(1)].filter(Boolean),
    [...numbered, ...tails],
    lexical,
  ];

  const seen = new Set();
  const failures = [];
  for (const order of candidates) {
    const key = order.join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const b64 = order.map(readChunk).join("");
      const gz = Buffer.from(b64, "base64");
      const decoded = tolerantGunzip(gz);
      const html = decoded.html;
      if (!html.includes("window.ARENA_DATA=") || !html.includes("class ArenaEngine") || !html.includes("</body>")) {
        throw new Error(`decoded payload incomplete: bytes=${Buffer.byteLength(html)} data=${html.includes("window.ARENA_DATA=")} engine=${html.includes("class ArenaEngine")} bodyClose=${html.includes("</body>")}`);
      }
      return { html, order, compressedBytes: gz.length, tolerantInflate: decoded.tolerant, strictInflateError: decoded.strictError || null };
    } catch (error) {
      failures.push(`${order.join(",")}: ${error.message}`);
    }
  }
  throw new Error(`Unable to reconstruct RC1 baseline. ${failures.join(" | ")}`);
}

function injectPatch(html, script, label) {
  invariant(!script.includes("</script>"), `${label} contains literal </script>`);
  const marker = "</body>";
  invariant(html.includes(marker), "HTML body close marker missing");
  return html.replace(marker, `\n<script data-v572-patch="${label}">\n${script}\n</script>\n${marker}`);
}

function buildHtml() {
  const baseline = reconstructBaseline();
  let html = baseline.html.replaceAll("V5.7.2-PLAYABLE-RC1", VERSION);
  html = injectPatch(html, fs.readFileSync(ENGINE_PATCH, "utf8"), "rc3-engine");
  html = injectPatch(html, fs.readFileSync(HUMAN_UI_PATCH, "utf8"), "rc3-human-ui");

  invariant(html.includes("V5.7.2-PLAYABLE-RC3"), "RC3 version marker missing");
  invariant(html.includes("HOSTAGE_EVENT_ID='EV-P06'"), "RC3 hostage event patch missing");
  invariant(html.includes("Number.isInteger(raw)"), "RC3 ransom integer validation missing");
  invariant(!html.includes("Съезд заложников: дополнительная цена казни"), "stale execution penalty remains in built HTML");

  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(ARTIFACT, html, "utf8");
  return { baseline, html };
}

function runQa() {
  fs.mkdirSync(QA_DIR, { recursive: true });
  const output = cp.execFileSync(process.execPath, [RUNNER, ARTIFACT, "500", "57001"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.writeFileSync(QA_JSON, output, "utf8");
  const qa = JSON.parse(output);
  invariant(qa.version === VERSION, `Game Master ran wrong version: ${qa.version}`);
  invariant(qa.structural.finished === 500, `Only ${qa.structural.finished}/500 games finished`);
  invariant(qa.structural.round6 === 500, `Only ${qa.structural.round6}/500 reached R6`);
  invariant(qa.structural.actions108 === 500, `Only ${qa.structural.actions108}/500 have 108 actions`);
  invariant(qa.structural.errorGames === 0, `${qa.structural.errorGames} games have engine errors`);
  invariant(qa.structural.invalid === 0, `${qa.structural.invalid} invalid actions detected`);
  const critical = (qa.findings || []).filter((x) => x.severity === "CRITICAL" || x.severity === "HIGH");
  invariant(critical.length === 0, `Game Master critical/high findings: ${JSON.stringify(critical)}`);

  const md = `# Game Master Report — ${VERSION}\n\n` +
    `Seeds: **57001–57500** · Games: **500**\n\n` +
    `- Finished: **${qa.structural.finished}/500**\n` +
    `- R6: **${qa.structural.round6}/500**\n` +
    `- 108 actions: **${qa.structural.actions108}/500**\n` +
    `- Engine error games: **${qa.structural.errorGames}**\n` +
    `- Invalid actions: **${qa.structural.invalid}**\n` +
    `- Peak Influence observed: **${qa.structural.peakInfluence}**\n` +
    `- Critical/HIGH findings: **${critical.length}**\n\n` +
    `## RC3 canonical fixes under test\n\n` +
    `- EV-P06 = «Съезд заложников»; ransom fixed at 2 gold for the event round.\n` +
    `- Execution remains 1 action / -3 Influence; no event-specific -1 penalty.\n` +
    `- Direct hold and rejected ransom use the same nearest-fort → captor-capital detention procedure.\n` +
    `- Human ransom N must be a positive integer.\n\n` +
    `Machine-readable output: \`${path.relative(ROOT, QA_JSON)}\`.\n`;
  fs.writeFileSync(QA_MD, md, "utf8");
  return { qa, critical };
}

function writeManifest(build, qaResult) {
  const bytes = fs.readFileSync(ARTIFACT);
  const manifest = {
    version: VERSION,
    status: "PLAYABLE_RC_NOT_STABLE",
    artifact: ARTIFACT_NAME,
    bytes: bytes.length,
    sha256: sha256(bytes),
    source: {
      baseline: "arena/source/rc1/*.b64 reconstructed gzip/base64 baseline",
      baseline_chunk_order: build.baseline.order,
      baseline_compressed_bytes: build.baseline.compressedBytes,
      baseline_tolerant_inflate: build.baseline.tolerantInflate,
      baseline_strict_inflate_error: build.baseline.strictInflateError,
      engine_patch: path.relative(ROOT, ENGINE_PATCH),
      human_ui_patch: path.relative(ROOT, HUMAN_UI_PATCH),
      build_script: "tools/build_arena_v5_7_2_rc3.js",
      source_commit: process.env.GITHUB_SHA || null
    },
    canonical_fixes: [
      "EV-P06=Съезд заложников",
      "hostage_congress_ransom=2_gold",
      "hostage_congress_execution_extra_influence=0",
      "hold_and_ransom_reject_share_detention_rule",
      "ransom_N_positive_integer_validation"
    ],
    qa: {
      games: 500,
      seeds: [57001, 57500],
      finished: qaResult.qa.structural.finished,
      round6: qaResult.qa.structural.round6,
      action108: qaResult.qa.structural.actions108,
      errorGames: qaResult.qa.structural.errorGames,
      invalid: qaResult.qa.structural.invalid,
      critical_high_findings: qaResult.critical.length,
      report: path.relative(ROOT, QA_MD),
      summary: path.relative(ROOT, QA_JSON)
    }
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}

function main() {
  const build = buildHtml();
  const qa = runQa();
  const manifest = writeManifest(build, qa);
  console.log(JSON.stringify({
    artifact: path.relative(ROOT, ARTIFACT),
    bytes: manifest.bytes,
    sha256: manifest.sha256,
    qa: manifest.qa
  }, null, 2));
}

main();
