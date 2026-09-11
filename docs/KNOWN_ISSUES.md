# Known Issues — V5.7.2 / Arena RC2

Этот файл содержит только подтверждённые проблемы. Предположения без фактической проверки сюда не вносятся как баги.

| ID | Severity | Категория | Проблема | Статус |
|---|---|---|---|---|
| EVENT-ID-001 | HIGH | DATA/RULES/CARDS | В текущем MGD `EV-P06` = «Холодная война», тогда как «Съезд заложников» не имеет синхронизированного canonical `CARD_ID`. RC2 применяет исключение по названию события | OPEN — REGISTRY SYNC |
| PRISON-HOLD-001 | HIGH | RULES/DATA/ARENA | Для прямого выбора «Взять в плен» без отказа от выкупа каноническое правило не определяет место содержания; Arena RC2 делегирует `hold` в `detainPrisoner(...)` | OPEN — ТРЕБУЕТ РЕШЕНИЯ |
| EVENT-EXEC-001 | HIGH | RULES/CARDS/ARENA | Arena RC2 во время «Съезда заложников» дополнительно снимает -1 Влияние за казнь; доступный канон подтверждает для события только фиксированный выкуп 2 золота | OPEN — VERIFY CARD SOURCE / DO NOT CANONIZE SILENTLY |
| AYREL-001 | HIGH | DATA/RULES/ARENA/CARDS | Способность/слабость Айреля требуют финальной проверки по карточному source после его миграции в GitHub | OPEN — CARD SOURCE MISSING |
| MAP-VERSION-001 | MEDIUM | DATA/MAP | Исторический topology JSON V5.7.1 имеет внутреннюю версию V5.6.6 | OPEN — SOURCE MIGRATION |
| CARD-SOURCE-001 | HIGH | CARDS/REPO | В `cards/` пока только README и SHA исторических XLSX; редактируемый/бинарный card source текущей линии не хранится в репозитории | OPEN |
| MAP-SOURCE-001 | HIGH | MAP/REPO | В canonical `map/` пока только README/хэши; сами master PNG/SVG/topology текущей линии не хранятся в репозитории | OPEN |
| PLAYTEST-RAW-001 | HIGH | PLAYTEST/LOGGING | `playtest/` не содержит полного актуального набора ручных Journal/Diplomacy/Houses JSON | OPEN — RAW DATA MIGRATION |
| COMPONENTS-001 | HIGH | COMPONENTS | Нет утверждённого и сохранённого в GitHub полного BOM/print source физических компонентов | OPEN |
| PRINT-001 | HIGH | PRINT | Нет сертифицированного print-ready комплекта в каноническом release source | OPEN |
| ARENA-VISUAL-001 | MEDIUM | ARENA/UI | Real Chromium visual smoke текущего RC2 не завершён; deterministic Human UI logic smoke = 6/6 | OPEN — MANUAL/REAL BROWSER VERIFY |
| REPO-BUILD-001 | HIGH | PROCESS/ARENA | Source patches и manifest RC2 в GitHub есть, но exact HTML artifact с зафиксированным SHA-256 не хранится в репозитории как reconstructable build | OPEN |
| VISUAL-REPO-001 | HIGH | VISUAL/REPO | Visual RC1 manifest/QA фиксируют ранее собранные ZIP/Arena/map/card artifacts, но в текущем GitHub нет `visual/build/`, standalone HTML V2/V2.1, styled map и полного generated print pack | OPEN — VISUAL SOURCE/ARTIFACT MIGRATION |
| AI-SOURCE-001 | MEDIUM | AI/DATA/ARENA | AI V5.7.2 распределён между MGD и Arena patches; отдельный нормализованный canonical AI config/source ещё не выделен | OPEN — SOURCE NORMALIZATION |

## Исправлено в этой пересборке

### MGD-SYNC-001 — FIXED / RECONCILED

`master_game_data_v5.7.2-dev.json` содержал унаследованные prisoner/ransom pending-поля. Они пересобраны из `data/prisoners_v5.7.2-dev.json`:

- Human↔Human выкуп = переговорный `N`, без фиксированного диапазона;
- `RANSOM` = 0 действий + `N` золота;
- `EXECUTION` = 1 действие / -3 Влияния;
- release destination и prisoner state schema синхронизированы;
- «Съезд заложников» сохраняет подтверждённое исключение `N=2`, но его event ID остаётся unresolved;
- direct `hold` destination намеренно оставлен `ТРЕБУЕТ РЕШЕНИЯ`.

### RULES-SYNC-001 — FIXED / REGENERATED

Основной `rules/source/02_diplomacy_dynasty_characters.md` имел stale section 20.2. Теперь section 20.2 генерируется из canonical `02d_prisoners_ransom.md` и сохраняет подтверждённую цену казни, negotiated ransom, release/reject routing и явные unresolved discrepancies.

Дополнительно устранены устаревшие входные ссылки на V5.7.1 как текущий master, отсутствующий Cards XLSX и несуществующий DEV Arena filename.

## Исправлено и проверено в Arena V5.7.2-PLAYABLE-RC2

- Полный post-capture цикл: отпустить / взять в плен / требовать выкуп N / казнить.
- `heldBy` и корректные взаимоисключающие состояния смерти/плена.
- Отпущенный и выкупленный персонаж возвращается в столицу владельца.
- Ближайшая Крепость **после отказа от выкупа** определяется по минимальному числу канонических сухопутных + прямых морских рёбер; land=1, sea=1, контроль/армии не учитываются.
- Human prisoner UI: 6/6 deterministic smoke.
- Prisoner targeted: 9/9.
- Семейные командиры: 6/6 targeted smoke.
- AI династические союзы, рождения и набеги имеют ненулевое coverage.
- 500/500 партий завершились на R6; 0 engine errors; 0 invalid; 0 prisoner-state invariant errors; 0 unresolved prisoner queues.

Эти результаты относятся к зафиксированному RC2 artifact и подтверждают структурную играбельность. Они не закрывают `PRISON-HOLD-001`, `EVENT-EXEC-001` и другие cross-source вопросы, найденные при последующем аудите.

## Rebuild tooling

- `data/canonical_manifest_v5.7.2.json` фиксирует порядок источников и unresolved conflicts.
- `tools/reconcile_v5_7_2.js --write` синхронизирует дублируемые prisoner/ransom поля MGD, подтверждённую цену казни и связанные rule metadata.
- `tools/reconcile_v5_7_2.js --check` проверяет idempotence/необходимость регенерации.
- Tool намеренно **не** назначает новый ID событию «Съезд заложников», не утверждает direct-hold detention rule, не легализует Arena-only `-1` при событии и не создаёт отсутствующие Cards/Map/Playtest/Visual источники.

## Правило закрытия

Issue/запись закрывается только после:

`FIX → SYNC DEPENDENCIES → GAME MASTER / STATIC VALIDATION → REGRESSION → COMMIT`

Если исправление меняет правило, связанное число или state-transition, должны быть проверены все зависимые источники.
