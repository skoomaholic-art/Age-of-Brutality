# Known Issues — V5.7.2 rebuild

Дата сверки: 2026-09-12.

Этот файл содержит только подтверждённые проблемы текущего состояния репозитория.

## Открытые проблемы

| ID | Severity | Категория | Проблема | Статус |
|---|---|---|---|---|
| ARENA-ARTIFACT-001 | HIGH | ARENA/REPO | Exact HTML V5.7.2-PLAYABLE-RC2 отсутствует в GitHub. Сохранённые `arena/source/rc1/*.b64` обрываются до `class ArenaEngine` и `</body>` | OPEN — MIGRATE COMPLETE BASELINE/HTML |
| CARD-INTRIGUE-001 | HIGH | CARDS/DATA/PRINT | Исторический Visual RC имел 160 физических карт; current canonical MGD восстанавливает 120. В MGD отсутствует `Intrigues` sheet; полные тексты/состав 40 недостающих карт не определены текущими sources | OPEN — SOURCE/DECISION REQUIRED |
| CARD-ART-001 | HIGH | CARDS/PRINT | HTML layout/editor восстановлен, но утверждённые иллюстрации, backs и финальный art-master полного набора не собраны в reproducible package | OPEN — ART/PREPRESS |
| MAP-ART-001 | HIGH | MAP/PRINT | Каноническая topology V5.7.2 хранится в GitHub, но illustrated PNG/SVG master карты не мигрирован | OPEN — SOURCE MIGRATION |
| PLAYTEST-RAW-001 | HIGH | PLAYTEST/LOGGING | `playtest/` не содержит полного актуального набора ручных Journal/Diplomacy/Houses JSON | OPEN — RAW DATA MIGRATION |
| COMPONENTS-001 | HIGH | COMPONENTS | Нет полного утверждённого BOM и редактируемых source физических компонентов | OPEN — SOURCE MIGRATION |
| PRINT-001 | HIGH | PRINT | Нет воспроизводимого сертифицированного print-ready package из текущих canonical sources и physical proof | OPEN |
| VISUAL-SOURCE-001 | MEDIUM | VISUAL/REPO | Новая карточная HTML-линия `visual/html_v22/` восстановлена; исторические full Visual V2/V2.1 pack/map/generator остаются немигрированными | PARTIAL — CARD HTML RESTORED |
| ARENA-VISUAL-001 | MEDIUM | ARENA/UI | Real-browser smoke нужен на новом executable после текущих source fixes; такого executable в repo пока нет | BLOCKED BY ARENA-ARTIFACT-001 |
| AI-ARENA-INTEGRATION-001 | MEDIUM | AI/ARENA | Нормализованные House/Prisoner agents созданы и покрыты CI, но не подключены к source-matching Arena executable, потому что полный Arena baseline отсутствует | BLOCKED BY ARENA-ARTIFACT-001 |

## Исправлено в текущем rebuild / preprint / AI pass

- `EV-P06` закреплён за событием **«Съезд заложников»**; выкуп = **2 золота** в текущем раунде; цена казни не меняется.
- Прямой **«Взять в плен»** и отказ от выкупа используют одну detention procedure.
- Human ransom `N` — положительное целое; казнь = **1 действие / -3 Влияния**.
- MGD и основной §20.2 правил синхронизированы с canonical prisoner module.
- `cards/canonical_registry_v5.7.2.json` исправлен: **111 дизайнов** / **48 CARD_ID**; Houses и Advisors больше не выпадают из генератора.
- Из current data известно **120 физических экземпляров**: Events 30, Houses 6, Characters 48, Advisors 18, Ambitions 18.
- Добавлены `visual/html_v22/card_editor.html` и `print_studio.html`; Print Studio разворачивает `Копий` автоматически.
- Print geometry: 69×94 мм full / 63×88 мм trim / bleed 3 мм / A4 3×3.
- `map/canonical_topology_v5.7.2.json`: 52 территории / 81 land / 23 sea / 16 ports.
- `AI-CONFIG-001` закрыт: `ai/config/canonical_v5.7.2.json` нормализует текущие AI target weights, round escalation, strategic plans, naval/center, diplomacy и prisoner factors.
- Созданы шесть House Agents, Prisoner Agent и `MultiAgentCoordinator`; AI принимает только `LEGAL_ACTIONS` и пишет объяснимый score/reason log.
- Добавлен `tools/check_ai_config_v5_7_2.js`; CI проверяет AI config ↔ MGD ↔ prisoners и запускает deterministic agent tests.

## Важное ограничение QA

Исторический RC2 QA 500 seeds относится к историческому executable. Текущие source fixes и новый AI-слой новее этого HTML.

Card/AI CI подтверждает текущие Rules/Data/Card registry/Map topology/HTML/AI source, но не заменяет физическую пробную печать, не восстанавливает отсутствующие 40 Intrigues и не является browser-smoke нового Arena executable.

## Правило закрытия

`FIX → SYNC RULES/DATA/CARDS/MAP/ARENA/AI → STATIC CHECK → GAME MASTER → BROWSER/PHYSICAL SMOKE → COMMIT`

Если исходник физически отсутствует, проблема закрывается только после фактической миграции или воспроизводимой регенерации, а не записью README.
