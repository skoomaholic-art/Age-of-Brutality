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
const historicalArenaManifest = readJson('arena/builds/V5.7.2_PLAYABLE_RC2.manifest.json');
const currentArenaManifest = readJson('arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.manifest.json');
const visualManifest = readJson('visual/docs/Repo_Release_Manifest.json');
const registry = readJson('cards/canonical_registry_v5.7.2.json');
const cardSet = readJson('cards/canonical_card_set_v5.7.2.json');
const releaseManifest = readText('RELEASE_MANIFEST.md');

if (completeness.repository_complete !== false && completeness.historical_generated_artifacts_missing_from_repository.length) {
  fail.push('repository_complete cannot be true while missing historical artifacts are listed');
}

const byFile = new Map(
  completeness.historical_generated_artifacts_missing_from_repository.map(x => [x.file, x])
);

if (historicalArenaManifest.artifact_in_repository === false) {
  const rec = byFile.get(historicalArenaManifest.artifact);
  if (!rec) fail.push(`Historical Arena manifest missing artifact is not tracked: ${historicalArenaManifest.artifact}`);
  if (rec && rec.sha256 !== historicalArenaManifest.sha256) fail.push('Historical Arena missing-artifact SHA does not match its manifest');
  if (rec && rec.bytes !== historicalArenaManifest.bytes) fail.push('Historical Arena missing-artifact byte count does not match its manifest');
}

const currentArenaPath = path.join(ROOT, 'arena/builds', currentArenaManifest.artifact || '');
if (!currentArenaManifest.artifactInRepository || !fs.existsSync(currentArenaPath)) {
  fail.push('Current Arena manifest must point to a stored repository artifact');
} else {
  const buf = fs.readFileSync(currentArenaPath);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (buf.length !== currentArenaManifest.bytes) fail.push('Current Arena byte count does not match its manifest');
  if (sha !== currentArenaManifest.sha256) fail.push('Current Arena SHA does not match its manifest');
}
if (currentArenaManifest.reproducibleBuildCommand !== 'node tools/build_arena_v5_7_2.js') {
  fail.push('Current Arena manifest must record its deterministic build command');
}
if (currentArenaManifest.actionsInMGD !== 18) fail.push('Current Arena must cover all 18 MGD action/procedure records');
if ((currentArenaManifest.sourceBlockedActions || []).length) fail.push('Current Arena must not have source-blocked actions');

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

const baseDesignCount = Number(registry.object_count);
let basePhysicalCount = 0;
for (const rows of Object.values(registry.sheets || {})) {
  for (const row of rows) {
    const copies = Number(row['Копий']);
    basePhysicalCount += Number.isInteger(copies) && copies > 0 ? copies : 1;
  }
}
const designCount = Number(cardSet.design_count);
const physicalCount = Number(cardSet.physical_copy_count);

if (baseDesignCount !== 111 || basePhysicalCount !== 120) {
  fail.push(`Unexpected base MGD card inventory: ${baseDesignCount} designs / ${basePhysicalCount} physical copies`);
}
if (designCount !== baseDesignCount + 40 || physicalCount !== basePhysicalCount + 40) {
  fail.push('Composite card set must add exactly 40 canonical Intrigue designs/copies');
}
if (completeness.current_reproducible_sources.canonical_card_designs !== designCount) {
  fail.push('Completeness inventory card design count is stale');
}
if (completeness.current_reproducible_sources.known_physical_card_copies !== physicalCount) {
  fail.push('Completeness inventory physical card count is stale');
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

const statusLine = releaseManifest.split(/\r?\n/).find(line => line.startsWith('**Status:**')) || '';
if (completeness.repository_complete === false) {
  if (!statusLine.includes('REPOSITORY INCOMPLETE')) {
    fail.push('RELEASE_MANIFEST.md status must explicitly say REPOSITORY INCOMPLETE');
  }
  if (!statusLine.includes('NOT STABLE')) {
    fail.push('RELEASE_MANIFEST.md status must explicitly say NOT STABLE while repository is incomplete');
  }
  if (!statusLine.includes('NOT PRINT-READY')) {
    fail.push('RELEASE_MANIFEST.md status must explicitly say NOT PRINT-READY while repository is incomplete');
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
