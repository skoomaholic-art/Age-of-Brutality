# Known Issues — V5.7.2 rebuild

Дата сверки: 2026-09-11.

Этот файл содержит только подтверждённые проблемы текущего состояния репозитория. Исправленные рассинхроны вынесены отдельно и больше не считаются открытыми.

## Открытые проблемы

| ID | Severity | Категория | Проблема | Статус |
|---|---|---|---|---|
| ARENA-ARTIFACT-001 | HIGH | ARENA/REPO | Exact HTML V5.7.2-PLAYABLE-RC2 отсутствует в GitHub. Сохранённые `arena/source/rc1/*.b64` обрываются до `class ArenaEngine` и `</body>`, поэтому из них нельзя честно пересобрать исполняемый клиент | OPEN — MIGRATE COMPLETE BASELINE/HTML |
| CARD-PRINT-001 | HIGH | CARDS/PRINT | Игровой card registry V5.7.2 восстановлен из MGD, но редактируемая физическая верстка/арт-master карточек не хранится в GitHub | OPEN — SOURCE MIGRATION |
| MAP-ART-001 | HIGH | MAP/PRINT | Каноническая topology V5.7.2 хранится в GitHub, но illustrated PNG/SVG master карты не мигрирован | OPEN — SOURCE MIGRATION |
| PLAYTEST-RAW-001 | HIGH | PLAYTEST/LOGGING | `playtest/` не содержит полного актуального набора ручных Journal/Diplomacy/Houses JSON | OPEN — RAW DATA MIGRATION |
| COMPONENTS-001 | HIGH | COMPONENTS | Нет полного утверждённого BOM и редактируемых source физических компонентов | OPEN — SOURCE MIGRATION |
| PRINT-001 | HIGH | PRINT | Нет воспроизводимого сертифицированного print-ready package из текущих canonical sources | OPEN |
| VISUAL-SOURCE-001 | HIGH | VISUAL/REPO | Документы и SHA предыдущего Visual RC существуют, но standalone HTML V2/V2.1, generated visual pack и их полный генератор/ассеты не хранятся в GitHub | OPEN — SOURCE MIGRATION |
| ARENA-VISUAL-001 | MEDIUM | ARENA/UI | Real-browser smoke должен выполняться уже на новом executable, собранном после текущих source fixes; такого executable в repo пока нет | BLOCKED BY ARENA-ARTIFACT-001 |
| AI-CONFIG-001 | MEDIUM | AI/REPO | AI-параметры присутствуют в MGD/Arena source, но ещё не выделены в самостоятельный нормализованный canonical AI config | OPEN — NORMALIZATION |

## Исправлено в текущем rebuild

- `EV-P06` закреплён за событием **«Съезд заложников»**.
- В раунд «Съезда заложников» выкуп фиксирован на **2 золота**.
- «Съезд заложников» **не меняет цену казни**; неподтверждённый дополнительный `-1 Влияние` удалён из Arena source.
- Прямой выбор **«Взять в плен»** и отказ от выкупа используют одну процедуру содержания: ближайшая Крепость пленителя → столица пленителя; при ничьей Крепость выбирает пленитель.
- Human ransom `N` валидируется как положительное целое число; фиксированного верхнего лимита нет.
- Казнь: **1 действие / -3 Влияния**; смерть и `ПЛЕН` взаимоисключающие состояния.
- Монолитный MGD регенерирован по canonical prisoner module.
- Основной §20.2 правил генерируется из `rules/source/02d_prisoners_ransom.md`.
- Добавлен machine-readable card registry: `cards/canonical_registry_v5.7.2.json` — 96 объектов / 48 `CARD_ID`.
- Добавлен `map/canonical_topology_v5.7.2.json`: 52 территории / 81 land edges / 23 sea edges / 16 ports.
- Старый V5.7.1 topology больше не является текущим техническим master.

## Важное ограничение QA

Отчёт RC2 на 500 seeds остаётся валидным свидетельством для **исторического RC2 executable**, который тогда был протестирован. Текущие source fixes новее этого HTML. Пока complete Arena baseline/HTML не мигрирован и не собран заново, нельзя выдавать старый RC2 hash как executable, соответствующий текущему source.

## Правило закрытия

`FIX → SYNC RULES/DATA/CARDS/MAP/ARENA/AI → STATIC CHECK → GAME MASTER → BROWSER SMOKE → COMMIT`

Если исходник физически отсутствует в репозитории, проблема закрывается только после его фактической миграции или воспроизводимой регенерации, а не записью README.