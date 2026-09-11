# Release Manifest

## Current source line

**Project/source:** `V5.7.2-DEV`  
**Status:** SOURCE RECONCILED / NO SOURCE-MATCHING EXECUTABLE / NOT STABLE / NOT PRINT-READY

Canonical gameplay sources include reconciled Rules/Data, generated card registry and V5.7.2 map topology.

## Last verified executable evidence

`V5.7.2-PLAYABLE-RC2` remains the last executable with recorded regression QA.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `Жестокий_Век_Arena_V5.7.2_PLAYABLE_RC2.html` | 470775 | `65028a031ec391a3057a4550e926ffcae4141eb1c7407cae84482b0491b80749` |

QA record: `qa/reports/Game_Master_Report_V5.7.2_RC2_500seeds.md`.

**Important:** the exact HTML is not stored in GitHub. The compressed RC1 source chunks stored in `arena/source/rc1/` are incomplete and end before the Arena engine. Source fixes made after RC2 QA therefore require a fresh executable build from a complete migrated baseline before a new RC can be certified.

## Canonical generated data

- `cards/canonical_registry_v5.7.2.json` — 96 objects / 48 CARD_ID.
- `map/canonical_topology_v5.7.2.json` — 52 territories / 81 land / 23 sea / 16 ports.

## Historical V5.7.1 baseline

V5.7.1 hashes remain historical references only and are not promoted into current V5.7.2 source by their existence.

## Promotion rule

A new executable can be promoted only after:

`COMPLETE SOURCE → REPRODUCIBLE BUILD → STATIC CHECKS → GAME MASTER REGRESSION → REAL-BROWSER SMOKE → MANIFEST/HASH → RELEASE`.