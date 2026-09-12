# Release Manifest

## Current source line

**Project/source:** `V5.7.2-DEV`  
**Status:** SOURCE RECONCILED / REPOSITORY INCOMPLETE / NO SOURCE-MATCHING EXECUTABLE / NOT STABLE / NOT PRINT-READY

Canonical gameplay sources include reconciled Rules/Data, generated card registry, normalized AI layer and V5.7.2 map topology.

Repository completeness is tracked mechanically in `release/repository_completeness_v5.7.2.json` and checked by CI. Hashes, manifests and QA records do not count as storage of the underlying artifact.

## Last verified executable evidence

`V5.7.2-PLAYABLE-RC2` remains the last executable with recorded regression QA.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `Жестокий_Век_Arena_V5.7.2_PLAYABLE_RC2.html` | 470775 | `65028a031ec391a3057a4550e926ffcae4141eb1c7407cae84482b0491b80749` |

QA record: `qa/reports/Game_Master_Report_V5.7.2_RC2_500seeds.md`.

**Critical:** the exact HTML is not stored in GitHub. The compressed RC1 source chunks stored in `arena/source/rc1/` are incomplete and end before the Arena engine. Source fixes made after RC2 QA therefore require a complete migrated baseline before a new RC can be certified.

The historical Visual RC manifest also records generated artifacts that are not physically stored in the current repository: Visual Print-and-Play ZIP, styled Arena HTML, styled map SVG, print map PDF and full card-pack PDF. Exact filenames, sizes and SHA-256 values are recorded in `release/repository_completeness_v5.7.2.json`.

## Canonical generated data

- `cards/canonical_registry_v5.7.2.json` — **111 designs / 120 known physical copies / 48 unique CARD_ID**.
- `map/canonical_topology_v5.7.2.json` — **52 territories / 81 land / 23 sea / 16 ports**.
- `ai/config/canonical_v5.7.2.json` — normalized current AI configuration with six House agents and deterministic checks.

The historical visual pack reported 160 physical cards. The current canonical source reconstructs only 120 known physical copies because the canonical 40-card Intrigue source is absent; those 40 cards must not be recreated from memory without an explicit new-design decision.

## Repository completeness rule

A project state may be called complete only when `release/repository_completeness_v5.7.2.json` has no unresolved critical/high missing artifact or source entries and all stored release artifacts match their recorded byte counts and SHA-256 values.

CI must fail if:
- a manifest declares an artifact absent but the absence is not tracked;
- a restored artifact does not match its recorded bytes/SHA;
- a restored artifact is still incorrectly marked missing;
- this manifest drifts from the generated card counts;
- the repository is described as complete while the completeness inventory says otherwise.

## Historical V5.7.1 baseline

V5.7.1 hashes remain historical references only and are not promoted into current V5.7.2 source by their existence.

## Promotion rule

A new executable can be promoted only after:

`COMPLETE SOURCE → REPRODUCIBLE BUILD → STATIC CHECKS → GAME MASTER REGRESSION → REAL-BROWSER SMOKE → COMMIT ARTIFACT → MANIFEST/HASH → RELEASE`
