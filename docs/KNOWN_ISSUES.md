# Known Issues — V5.7.2-DEV

Этот файл содержит только подтверждённые проблемы. Предположения без фактической проверки сюда не вносятся как баги.

| ID | Severity | Категория | Проблема | Статус |
|---|---|---|---|---|
| PRISON-001 | CRITICAL | ARENA_ERROR | После пленения нет полного выбора: отпустить / взять в плен / требовать выкуп N / казнить | OPEN |
| PRISON-002 | CRITICAL | STATE_CORRUPTION | Пленник не хранит захвативший Дом | OPEN |
| DEATH-001 | CRITICAL | STATE_CORRUPTION | Мёртвый персонаж получает `mode=ПЛЕН` | OPEN |
| RANSOM-001 | HIGH | RULES/DATA | Старый фиксированный выкуп 3 конфликтует с подтверждённым `N` | OPEN — ждёт диапазон N |
| COMMANDER-001 | HIGH | RULES/DATA/ARENA/AI | Семейные командиры реализованы несогласованно | OPEN |
| HOUSE-ID-001 | HIGH | DATA | `Айрельь` в MGD не совпадает с `Айрель` в остальных источниках | OPEN |
| AYREL-001 | HIGH | DATA/RULES/ARENA/CARDS | Способность/слабость Айреля теряются между источниками; слабость отсутствует в Arena, House card неполон | OPEN |
| DYNASTY-001 | HIGH | AI | AI не добавляет династический союз в `chooseAction` | OPEN |
| DIVORCE-001 | MEDIUM | RULES | Развод есть в Data/Arena, но не описан полной процедурой в rulebook | OPEN |
| MAP-VERSION-001 | MEDIUM | DATA | topology JSON V5.7.1 содержит внутреннюю версию V5.6.6 | OPEN |
| BIRTH-COVER-001 | MEDIUM | AI/COVERAGE | 0 рождений в 100 seeds; причина требует точного определения | INVESTIGATE |
| RAID-COVER-001 | MEDIUM | AI/COVERAGE | 0 набегов в 100 seeds; причина требует точного определения | INVESTIGATE |
| REPO-SOURCE-001 | CRITICAL | PROCESS/DATA | GitHub пока содержит manifest/QA, но не полный редактируемый набор канонических game sources | OPEN |
| PRINT-001 | HIGH | PRINT | Нет сертифицированного print-ready комплекта | OPEN |
| COMPONENTS-001 | HIGH | COMPONENTS | Нет утверждённого точного BOM физических компонентов | OPEN |

## Правило закрытия

Issue/запись закрывается только после:

`FIX → SYNC DEPENDENCIES → GAME MASTER / STATIC VALIDATION → REGRESSION → COMMIT`

Если исправление меняет правило, связанное число или state-transition, должны быть проверены все зависимые источники.
