# Changelog

Все изменения проекта фиксируются в GitHub до выдачи пользовательского билда.

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
- `cards/canonical_registry_v5.7.2.json`, generated from active MGD: 96 objects / 48 CARD_ID.
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