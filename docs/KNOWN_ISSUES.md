# Known Issues — V5.7.2 / Arena RC2

Этот файл содержит только подтверждённые проблемы. Предположения без фактической проверки сюда не вносятся как баги.

| ID | Severity | Категория | Проблема | Статус |
|---|---|---|---|---|
| EVENT-ID-001 | HIGH | DATA/RULES/CARDS | В монолитном MGD `EV-P06` = «Холодная война», тогда как legacy Arena/card layer содержит «Съезд заложников». RC2 применяет исключение по названию события | OPEN — REGISTRY SYNC |
| MGD-SYNC-001 | HIGH | DATA | `master_game_data_v5.7.2-dev.json` всё ещё содержит унаследованные prisoner/ransom pending-поля и требует полной регенерации из канонического prisoner module | OPEN — REGENERATE MGD |
| AYREL-001 | HIGH | DATA/RULES/ARENA/CARDS | Способность/слабость Айреля требуют финальной проверки по карточному source после его миграции в GitHub | OPEN — CARD SOURCE MISSING |
| MAP-VERSION-001 | MEDIUM | DATA/MAP | Исторический topology JSON V5.7.1 имеет внутреннюю версию V5.6.6 | OPEN — SOURCE MIGRATION |
| CARD-SOURCE-001 | HIGH | CARDS/REPO | В `cards/` пока только README и SHA исторических XLSX; редактируемый/бинарный card source не хранится в репозитории | OPEN |
| MAP-SOURCE-001 | HIGH | MAP/REPO | В `map/` пока только README и SHA исторических PNG/SVG/topology; сами master-файлы не хранится в репозитории | OPEN |
| COMPONENTS-001 | HIGH | COMPONENTS | Нет утверждённого и сохранённого в GitHub полного BOM/print source физических компонентов | OPEN |
| PRINT-001 | HIGH | PRINT | Нет сертифицированного print-ready комплекта | OPEN |
| ARENA-VISUAL-001 | MEDIUM | ARENA/UI | Real Chromium visual smoke не завершён в локальном контейнере; deterministic Human UI logic smoke 6/6 | OPEN — MANUAL/REAL BROWSER VERIFY |
| REPO-BUILD-001 | MEDIUM | PROCESS/ARENA | Source patches и manifest RC2 в GitHub есть; exact HTML ещё должен храниться/восстанавливаться в репозитории как полноценный build artifact | OPEN |

## Исправлено и проверено в Arena V5.7.2-PLAYABLE-RC2

- Полный post-capture цикл: отпустить / взять в плен / требовать выкуп N / казнить.
- `heldBy` и корректные взаимоисключающие состояния смерти/плена.
- Отпущенный и выкупленный персонаж возвращается в столицу владельца.
- Ближайшая Крепость определяется по минимальному числу канонических сухопутных + прямых морских рёбер; land=1, sea=1, контроль/армии не учитываются.
- Human prisoner UI: 6/6 deterministic smoke.
- Prisoner targeted: 9/9.
- Семейные командиры: 6/6 targeted smoke.
- AI династические союзы, рождения и набеги имеют ненулевое coverage.
- 500/500 партий завершились на R6; 0 engine errors; 0 invalid; 0 prisoner-state invariant errors; 0 unresolved prisoner queues.

## Правило закрытия

Issue/запись закрывается только после:

`FIX → SYNC DEPENDENCIES → GAME MASTER / STATIC VALIDATION → REGRESSION → COMMIT`

Если исправление меняет правило, связанное число или state-transition, должны быть проверены все зависимые источники.
