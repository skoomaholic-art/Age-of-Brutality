# Changelog

Все изменения проекта фиксируются в GitHub до выдачи пользовательского билда.

## [V5.7.2-PLAYABLE-CURRENT-DEV] — Current Arena cleanup 2026-09-13

### Fixed

- Hotfix: `Новая партия` now starts a visibly new seed and reports success in the UI.
- Hotfix: the corrupt technical PNG is no longer embedded; Arena renders a live 52-territory SVG map from canonical topology instead.
- Восстановленные current engine fragments собраны в воспроизводимый standalone Arena artifact.
- Восточные материковые порты исправлены на `E1-1`, `E2-1`, `E3-1` в Rules и topology.
- Capability report больше не показывает Интриги как заблокированные: загружен explicit 40-card canonical new-design module.
- Статусы README/docs/release inventory синхронизированы с фактическим current source.
- Legacy recovery/diagnostic workflows переведены в manual-only режим, чтобы исключить автоматические bot-коммиты.
- Human diplomacy now pauses on explicit Accept/Reject for Pact, dynastic and access proposals; no action or resource is spent before acceptance.
- March exposes every legal army quantity up to the territory cap; AI-only force scoring saturates at three warriors, so the tabletop choice is unchanged.

### Added

- Current Arena manifest with deterministic build command, byte count and SHA-256.
- 151-design / 160-copy composite card inventory.
- Explicit invariant tests for 16 normal actions, 2 free procedures, port movement, family commanders, prisoner decisions and succession.
- Current 100/500-seed Game Master gates.
- Embedded favicon, metadata, responsive typography and accessible focus states for web deployment.
- Full-party simulation button, Game Master panel and a source-to-runtime tabletop integrity checker.
- Canonical zero-card Intrigue setup and a draft physical component BOM with unresolved production quantities marked TBD.

### Status

Digital DEV deployment is allowed. `STABLE` and `PRINT-READY` remain blocked by browser proof and the physical art/BOM/prepress track.

## [V5.7.2-DEV] — Rebuild reconciliation 2026-09-11

### Fixed

- `EV-P06` канонизирован как событие **«Съезд заложников»**.
- В раунд события выкуп фиксирован на **2 золота**.
- Удалён неподтверждённый дополнительный `-1 Влияние` за казнь при «Съезде заложников»; каноническая цена казни остаётся **1 действие / -3 Влияния**.
- Прямой выбор **«Взять в плен»** и отказ от выкупа используют одну detention procedure: nearest captor fort → captor capital, captor chooses on tie.
- Выкуп `N` валидируется как положительное целое число; фиксированного диапазона для живых игроков нет.
- Monolithic MGD синхронизирован с canonical prisoner module.
- Основной Rules §20.2 генерируется из canonical prisoner module.
- Исправлены stale source/status ссылки на V5.7.1 и несуществующие V5.7.2 artifacts.

### Added

- `tools/reconcile_v5_7_2.js` + canonical consistency checks.
- `cards/canonical_registry_v5.7.2.json`, generated from active MGD: 111 base designs / 48 CARD_ID.
- `tools/generate_card_registry_v5_7_2.js` + idempotence check.
- `map/canonical_topology_v5.7.2.json`: 52 territories / 81 land / 23 sea / 16 ports.
- repo-level source graph and rebuild audit.

### Release note

`V5.7.2-PLAYABLE-RC2` remains the last historically verified executable (500/500 regression), but its exact HTML is absent from GitHub and current source fixes are newer. The stored RC1 compressed baseline is incomplete and ends before `class ArenaEngine`, so no new executable RC is claimed until the complete baseline/HTML is migrated and QA rerun.

### Remaining source-availability blockers

- complete Arena baseline/HTML;
- physical card layout/art masters;
- illustrated map master;
- latest manual playtest raw JSON;
- Visual V2/V2.1 full source/generated pack;
- Components/BOM;
- reproducible print-ready package.

## [V5.7.2-PLAYABLE-RC2] — Historical executable evidence

Previous digital playtest artifact. Preserved QA evidence: 500/500 finished on R6, 0 engine errors, 0 invalid actions, 0 prisoner-state invariant errors and 0 unresolved prisoner queues. It is not promoted as the executable of the post-rebuild source line.

## [V5.7.1] — Historical baseline

Previously marked STABLE; retained only as a historical baseline after later defects and source divergence were identified.

## [V5.7.0] — Historical QA baseline

Structural historical evidence only; not the active regression target for current V5.7.2 source.
