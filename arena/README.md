# Arena

## Текущий играбельный билд

**V5.7.2-PLAYABLE-RC2**

Build SHA-256: `65028a031ec391a3057a4550e926ffcae4141eb1c7407cae84482b0491b80749`.

Manifest: `arena/builds/V5.7.2_PLAYABLE_RC2.manifest.json`.

QA: `qa/reports/Game_Master_Report_V5.7.2_RC2_500seeds.md`.

RC2 предназначен для реального цифрового плейтеста. Он не имеет статуса STABLE и не является print-ready релизом.

## Что исправлено относительно V5.7.1/RC1

- полный цикл плена и выкупа;
- Human prisoner UI;
- хранение `heldBy`;
- смерть отделена от `ПЛЕН`;
- освобождение/выкуп возвращают персонажа в столицу владельца;
- ближайшая Крепость считается по каноническому графу land + direct sea edges;
- семейные командиры доступны через Human UI и AI;
- AI использует династические действия, рождения и набеги;
- событие «Съезд заложников» распознаётся по названию, чтобы не конфликтовать с `EV-P06` монолитного MGD.

## QA RC2

500/500 партий завершились на R6, 0 engine errors, 0 invalid actions, 0 prisoner-state invariant errors, 0 unresolved prisoner queues.

Targeted: prisoners 9/9; Human UI 6/6; commanders 6/6; nearest-fort sea routing 1/1.

## Source

- `arena/source/patches/v5.7.2_rc2_engine_delta.js`
- `arena/source/patches/v5.7.2_rc2_human_ui.js`

Исторический `V5.7.1-STABLE` остаётся только baseline и больше не считается текущим executable release.
