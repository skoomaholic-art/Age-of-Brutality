# Release Manifest

## Current source line

**Project/source:** `V5.7.2-DEV`  
**Status:** PLAYABLE CURRENT DEV / REPOSITORY INCOMPLETE / NOT STABLE / NOT PRINT-READY

Current gameplay sources include reconciled Rules/Data, the composite card set, map topology/metadata, normalized AI and a reproducible standalone Arena.

## Current Arena artifact

| Artifact | Bytes | SHA-256 | Build |
|---|---:|---|---|
| `arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.html` | 233356 | `55770cb56b2043eba79128bb66b74aacec81ff31ae9a551d18a381b761abfbc0` | `node tools/build_arena_v5_7_2.js` |

Machine manifest: `arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.manifest.json`.

The artifact embeds current canonical data, 40 Intrigues, the technical map, engine, AI adapter and UI. It reports 16 implemented normal actions, 2 implemented free procedures and no source-blocked actions.

## Canonical generated data

- `cards/canonical_registry_v5.7.2.json` — 111 base designs / 120 base physical copies.
- `data/intrigues_v5.7.2.json` — 40 designs / 40 physical copies; explicit new canonical design, not a recovered historical sheet.
- `cards/canonical_card_set_v5.7.2.json` — **151 designs / 160 known physical copies**.
- `map/canonical_topology_v5.7.2.json` — 52 territories / 81 land / 23 sea / 16 ports.
- `ai/config/canonical_v5.7.2.json` — normalized current AI configuration.

## QA evidence

Current gates include deterministic reconciliation, generated-registry parity, map/metadata/AI checks, JavaScript syntax, House-agent tests, tabletop component tests, explicit current-engine invariants and 100/500-seed Game Master regression.

The current regression gate requires every game to finish on round 6 with 108 action slots, zero engine errors, zero invalid actions, zero source-blocked actions and non-zero Intrigue/Trace/Investigation coverage.

## Repository completeness

`release/repository_completeness_v5.7.2.json` tracks repository-wide completeness. The current digital Arena is reproducible; the repository remains incomplete because approved editable map art, consolidated print masters, complete component BOM and current physical/manual proof are missing.

Historical RC2 and Visual RC1 binaries remain absent. Their recorded hashes are provenance references, not dependencies of the current build.

## Promotion rule

`REPRODUCIBLE SOURCE → STATIC CHECKS → ARENA BUILD → INVARIANTS → 500+ SEEDS → REAL-BROWSER SMOKE → RELEASE ARTIFACT/MANIFEST`

Print-ready promotion additionally requires approved art, BOM, prepress outputs and physical proof.
