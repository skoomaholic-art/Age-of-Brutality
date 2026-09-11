# Known Issues — V5.7.2 / Arena RC2

Этот файл содержит только подтверждённые проблемы. Предположения без фактической проверки сюда не вносятся как баги.

| ID | Severity | Категория | Проблема | Статус |
|---|---|---|---|---|
| EVENT-ID-001 | HIGH | DATA/RULES/CARDS | В монолитном MGD `EV-P06` = «Холодная война», тогда как legacy Arena/card layer содержит «Съезд заложников». RC2 применяет исключение по названию события | OPEN — REGISTRY SYNC |
| MGD-SYNC-001 | HIGH | DATA | `master_game_data_v5.7.2-dev.json` всё ещё содержит унаследованные prisoner/ransom pending-поля | OPEN — deterministic reconcile tool added; generated monolith still must be committed |
| RULES-SYNC-001 | MEDIUM | RULES | Основной `02_diplomacy_dynasty_characters.md` содержит унаследованный текст 20.2, который канонический `02d_prisoners_ransom.md` уже заменяет | OPEN — deterministic reconcile tool added |
| AYREL-001 | HIGH | DATA/RULES/ARENA/CARDS | Способность/слабость Айреля требуют финальной проверки по карточному source после его миграции в GitHub | OPEN — CARD SOURCE MISSING |
| MAP-VERSION-001 | MEDIUM | DATA/MAP | Исторический topology JSON V5.7.1 имеет внутреннюю версию V5.6.6 | OPEN — SOURCE MIGRATION |
| CARD-SOURCE-001 | HIGH | CARDS/REPO | В `cards/` пока только README и SHA исторических XLSX; редактируемый/бинарный card source не хранится в репозитории | OPEN |
| MAP-SOURCE-001 | HIGH | MAP/REPO | В `map/` пока только README и SHA исторических PNG/SVG/topology; сами master-файлы не хранятся в каноническом каталоге | OPEN |
| PLAYTEST-RAW-001 | HIGH | PLAYTEST/LOGGING | `playtest/` не содержит полного актуального набора ручных Journal/Diplomacy/Houses JSON | OPEN — RAW DATA MIGRATION |
| COMPONENTS-001 | HIGH | COMPONENTS | Нет утверждённого и сохранённого в GitHub полного BOM/print source физических компонентов | OPEN |
| PRINT-001 | HIGH | PRINT | Нет сертифицированного print-ready комплекта | OPEN |
| ARENA-VISUAL-001 | MEDIUM | ARENA/UI | Real Chromium visual smoke не завершён; deterministic Human UI logic smoke 6/6 | OPEN — MANUAL/REAL BROWSER VERIFY |
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
- `rules/source/README.md` больше не называет уже утверждённые release/nearest-fort правила нерешёнными.
- `playtest/README.md` переведён с устаревшей V5.7.1 формулировки на текущую V5.7.2/RC2 политику.

## Rebuild tooling

- `data/canonical_manifest_v5.7.2.json` фиксирует порядок источников и unresolved conflicts.
- `tools/reconcile_v5_7_2.js --write` синхронизирует дублируемые prisoner/ransom поля MGD и section 20.2 правил с каноническим модулем.
- `tools/reconcile_v5_7_2.js --check` проверяет, требуется ли регенерация.
- Tool намеренно **не** назначает новый ID событию «Съезд заложников» и не создаёт отсутствующие Cards/Map/Playtest источники.

## Правило закрытия

Issue/запись закрывается только после:

`FIX → SYNC DEPENDENCIES → GAME MASTER / STATIC VALIDATION → REGRESSION → COMMIT`

Если исправление меняет правило, связанное число или state-transition, должны быть проверены все зависимые источники.
