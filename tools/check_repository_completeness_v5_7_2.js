#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const readText = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const fail = [];

const completeness = readJson('release/repository_completeness_v5.7.2.json');
const arenaManifest = readJson('arena/builds/V5.7.2_PLAYABLE_RC2.manifest.json');
const visualManifest = readJson('visual/docs/Repo_Release_Manifest.json');
const registry = readJson('cards/canonical_registry_v5.7.2.json');
const releaseManifest = readText('RELEASE_MANIFEST.md');

if (completeness.repository_complete !== false && completeness.historical_generated_artifacts_missing_from_repository.length) {
  fail.push('repository_complete cannot be true while missing historical artifacts are listed');
}

const byFile = new Map(
  completeness.historical_generated_artifacts_missing_from_repository.map(x => [x.file, x])
);

if (arenaManifest.artifact_in_repository === false) {
  const rec = byFile.get(arenaManifest.artifact);
  if (!rec) fail.push(`Arena manifest missing artifact is not tracked: ${arenaManifest.artifact}`);
  if (rec && rec.sha256 !== arenaManifest.sha256) fail.push('Arena missing-artifact SHA does not match Arena manifest');
  if (rec && rec.bytes !== arenaManifest.bytes) fail.push('Arena missing-artifact byte count does not match Arena manifest');
}

for (const artifact of Object.values(visualManifest.artifacts || {})) {
  if (artifact.stored_in_repository === false) {
    const rec = byFile.get(artifact.file);
    if (!rec) fail.push(`Visual manifest missing artifact is not tracked: ${artifact.file}`);
    if (rec && rec.sha256 !== artifact.sha256) fail.push(`Visual SHA mismatch for ${artifact.file}`);
    if (rec && rec.bytes !== artifact.bytes) fail.push(`Visual byte-count mismatch for ${artifact.file}`);
  }
}

for (const rec of completeness.historical_generated_artifacts_missing_from_repository) {
  const abs = path.join(ROOT, rec.expected_repository_path);
  if (fs.existsSync(abs)) {
    const buf = fs.readFileSync(abs);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (buf.length !== rec.bytes || sha !== rec.sha256) {
      fail.push(`Artifact exists but does not match recorded bytes/SHA: ${rec.expected_repository_path}`);
    } else {
      fail.push(`Artifact has been restored but inventory still marks it missing: ${rec.expected_repository_path}`);
    }
  }
}

const designCount = Number(registry.object_count);
let physicalCount = 0;
for (const rows of Object.values(registry.sheets || {})) {
  for (const row of rows) {
    const copies = Number(row['Копий']);
    physicalCount += Number.isInteger(copies) && copies > 0 ? copies : 1;
  }
}

if (!releaseManifest.includes(`${designCount} designs`)) {
  fail.push(`RELEASE_MANIFEST.md must state current card design count: ${designCount} designs`);
}
if (!releaseManifest.includes(`${physicalCount} known physical copies`)) {
  fail.push(`RELEASE_MANIFEST.md must state current known physical count: ${physicalCount} known physical copies`);
}
if (/\b96 objects\b/.test(releaseManifest)) {
  fail.push('RELEASE_MANIFEST.md still contains stale 96-object card count');
}

const forbiddenCompletenessClaims = [
  'REPOSITORY COMPLETE',
  'REPOSITORY-COMPLETE',
  'FULLY REPRODUCIBLE',
  'PRINT-READY / STABLE'
];
for (const claim of forbiddenCompletenessClaims) {
  if (releaseManifest.toUpperCase().includes(claim) && completeness.repository_complete === false) {
    fail.push(`Release manifest makes forbidden completeness claim while repository is incomplete: ${claim}`);
  }
}

if (fail.length) {
  console.error('Repository completeness check FAILED');
  for (const e of fail) console.error(`- ${e}`);
  process.exit(1);
}

console.log('Repository completeness check OK');
console.log(`Repository complete: ${completeness.repository_complete}`);
console.log(`Tracked missing historical artifacts: ${completeness.historical_generated_artifacts_missing_from_repository.length}`);
console.log(`Tracked missing/incomplete sources: ${completeness.missing_or_incomplete_sources.length}`);
console.log(`Canonical cards: ${designCount} designs / ${physicalCount} known physical copies`);
