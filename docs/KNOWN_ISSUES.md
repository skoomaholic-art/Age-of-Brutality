# Known Issues — V5.7.2-DEV

Этот файл содержит только подтверждённые проблемы. Предположения без фактической проверки сюда не вносятся как баги.

| ID | Severity | Категория | Проблема | Статус |
|---|---|---|---|---|
| RC1-RULE-001 | CRITICAL | RULES/ARENA | В RC1 без подтверждения пользователя зашиты: П-06 как исключение `выкуп=2`, возврат освобождённого в Двор и вычисление ближайшей крепости только по сухопутным рёбрам | OPEN — RC1 запрещено повышать до release до решения |
| PRISON-001 | CRITICAL | ARENA/UI | Движок RC1 содержит 4 post-capture варианта, но Human UI этих процедур ещё должен быть подтверждён отдельным smoke-test | VERIFY |
| PRISON-002 | CRITICAL | STATE_CORRUPTION | Baseline не хранил захвативший Дом; RC1 добавляет `heldBy`, требуется финальный regression exact-build | FIXED IN RC1 / VERIFY |
| DEATH-001 | CRITICAL | STATE_CORRUPTION | Baseline позволял мёртвому персонажу остаться `ПЛЕН`; RC1 вводит взаимоисключающие state, требуется финальный regression exact-build | FIXED IN RC1 / VERIFY |
| RANSOM-001 | HIGH | RULES/DATA | Старый фиксированный выкуп 3 конфликтует с подтверждённым переговорным `N`; диапазон N НЕ требуется. Канонический prisoner-module уже содержит новое решение, монолитный MGD ещё должен быть полностью синхронизирован | OPEN — DATA SYNC |
| COMMANDER-001 | HIGH | RULES/DATA/ARENA/AI | Семейные командиры реализованы несогласованно в baseline; RC1 содержит новую модель, требуется UI/AI regression exact-build | FIXED IN RC1 / VERIFY |
| HOUSE-ID-001 | HIGH | DATA | `Айрельь` в baseline MGD не совпадал с `Айрель`; V5.7.2 source нормализован до `Айрель` | FIXED SOURCE / VERIFY |
| AYREL-001 | HIGH | DATA/RULES/ARENA/CARDS | Способность/слабость Айреля терялись между источниками; требуется финальная проверка Cards и Arena после синхронизации | OPEN |
| DYNASTY-001 | HIGH | AI | Baseline AI не добавлял династический союз в `chooseAction`; RC1 добавляет действие | FIXED IN RC1 / VERIFY |
| DIVORCE-001 | MEDIUM | RULES | Развод отсутствовал как полная процедура; V5.7.2 rules source содержит процедуру | FIXED SOURCE / VERIFY |
| MAP-VERSION-001 | MEDIUM | DATA | topology JSON V5.7.1 содержит внутреннюю версию V5.6.6 | OPEN |
| BIRTH-COVER-001 | MEDIUM | AI/COVERAGE | Baseline: 0 рождений; RC1 regression показывает ненулевое покрытие, нужен финальный exact-build отчёт | FIXED IN RC1 / VERIFY |
| RAID-COVER-001 | MEDIUM | AI/COVERAGE | Baseline: 0 набегов; RC1 regression показывает ненулевое покрытие, нужен финальный exact-build отчёт | FIXED IN RC1 / VERIFY |
| REPO-SOURCE-001 | CRITICAL | PROCESS/DATA | GitHub ещё не содержит полностью восстановленный exact-build Arena RC1 и полный канонический набор Cards/Map/print sources | OPEN |
| PRINT-001 | HIGH | PRINT | Нет сертифицированного print-ready комплекта | OPEN |
| COMPONENTS-001 | HIGH | COMPONENTS | Нет утверждённого точного BOM физических компонентов | OPEN |

## Правило закрытия

Issue/запись закрывается только после:

`FIX → SYNC DEPENDENCIES → GAME MASTER / STATIC VALIDATION → REGRESSION → COMMIT`

Если исправление меняет правило, связанное число или state-transition, должны быть проверены все зависимые источники.
