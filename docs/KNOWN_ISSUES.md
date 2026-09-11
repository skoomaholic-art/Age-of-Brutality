# Known Issues — V5.7.2-DEV

Этот файл содержит только подтверждённые проблемы. Предположения без фактической проверки сюда не вносятся как баги.

| ID | Severity | Категория | Проблема | Статус |
|---|---|---|---|---|
| RC1-RULE-001 | CRITICAL | RULES/ARENA | В RC1 были без подтверждения зашиты три решения. Исключение события «Съезд заложников» с выкупом 2 подтверждено; возврат отпущенного/выкупленного теперь канонически идёт в столицу владельца. Не утверждён только алгоритм определения ближайшей крепости | OPEN — 1 RULE BLOCKER |
| EVENT-ID-001 | HIGH | DATA/RULES/CARDS | Prisoner rules называют `П-06` событием «Съезд заложников», но текущий MGD использует `EV-P06` для «Холодной войны» | OPEN — REGISTRY SYNC |
| PRISON-001 | CRITICAL | ARENA/UI | RC1 не имел Human UI плена. RC2 candidate добавляет blocking Human UI; deterministic UI smoke 6/6, требуется реальный browser smoke перед release | FIXED IN RC2 / BROWSER VERIFY |
| PRISON-002 | CRITICAL | STATE_CORRUPTION | Baseline не хранил захвативший Дом. RC2 сохраняет `heldBy`; 500/500 regression без prisoner-state invariant errors | FIXED / VERIFIED RC2 |
| DEATH-001 | CRITICAL | STATE_CORRUPTION | Baseline позволял мёртвому персонажу остаться `ПЛЕН`. RC2 разделяет терминальное состояние смерти и плен; 500/500 regression без invariant errors | FIXED / VERIFIED RC2 |
| RANSOM-001 | HIGH | RULES/DATA | Старый фиксированный выкуп 3 конфликтует с подтверждённым переговорным `N`; диапазон N НЕ требуется. Canonical prisoner module синхронизирован, монолитный MGD ещё требует обновления | OPEN — MGD SYNC |
| COMMANDER-001 | HIGH | RULES/DATA/ARENA/AI | Baseline семейных командиров был несогласован. RC2 содержит engine model и Human UI; требуется отдельный commander UI/action smoke перед закрытием | FIXED IN RC2 / VERIFY |
| HOUSE-ID-001 | HIGH | DATA | `Айрельь` в baseline MGD не совпадал с `Айрель`; V5.7.2 source нормализован до `Айрель` | FIXED SOURCE / VERIFY |
| AYREL-001 | HIGH | DATA/RULES/ARENA/CARDS | Способность/слабость Айреля терялись между источниками; требуется финальная проверка Cards и Arena после синхронизации | OPEN |
| DYNASTY-001 | HIGH | AI | Baseline AI не добавлял династический союз в `chooseAction`; RC2 regression показывает ненулевые династические союзы | FIXED / VERIFIED RC2 |
| DIVORCE-001 | MEDIUM | RULES | Развод отсутствовал как полная процедура; V5.7.2 rules source содержит процедуру | FIXED SOURCE / VERIFY |
| MAP-VERSION-001 | MEDIUM | DATA | topology JSON V5.7.1 содержит внутреннюю версию V5.6.6 | OPEN |
| BIRTH-COVER-001 | MEDIUM | AI/COVERAGE | Baseline: 0 рождений; RC2 500-seed regression: 929 | FIXED / VERIFIED RC2 |
| RAID-COVER-001 | MEDIUM | AI/COVERAGE | Baseline: 0 набегов; RC2 500-seed regression: 725 | FIXED / VERIFIED RC2 |
| REPO-SOURCE-001 | CRITICAL | PROCESS/DATA | GitHub содержит RC2 delta/UI source и QA, но ещё не содержит полностью восстановленный exact-build Arena base и полный канонический набор Cards/Map/print sources | OPEN |
| PRINT-001 | HIGH | PRINT | Нет сертифицированного print-ready комплекта | OPEN |
| COMPONENTS-001 | HIGH | COMPONENTS | Нет утверждённого точного BOM физических компонентов | OPEN |

## Правило закрытия

Issue/запись закрывается только после:

`FIX → SYNC DEPENDENCIES → GAME MASTER / STATIC VALIDATION → REGRESSION → COMMIT`

Если исправление меняет правило, связанное число или state-transition, должны быть проверены все зависимые источники.
