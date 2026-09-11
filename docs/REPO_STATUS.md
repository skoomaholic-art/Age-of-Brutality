# Repository status — V5.7.2 rebuild

Дата: 2026-09-11.

| Область | Статус | Факт |
|---|---|---|
| Rules | VERIFIED SOURCE | §20.2 синхронизирован из canonical prisoner module |
| Prisoner/ransom | VERIFIED SOURCE | 4 choices, N, detention, execution, event exception согласованы |
| Master Game Data | RECONCILED | stale prisoner/event fields устранены |
| Card game-data | GENERATED | `cards/canonical_registry_v5.7.2.json`: 96 объектов / 48 CARD_ID |
| Card physical masters | MISSING SOURCE | layout/art/XLSX V5.7.2 не мигрированы |
| Map topology | VERIFIED | 52 territories / 81 land / 23 sea / 16 ports |
| Map illustrated master | MISSING SOURCE | актуальные PNG/SVG master не мигрированы |
| Arena source | FIXED | текущий RC2 delta source содержит event/prisoner/ransom fixes |
| Arena executable | REBUILD BLOCKED | exact RC2 HTML отсутствует; RC1 compressed baseline неполон |
| AI | PARTIAL CANONICAL | поведение/weights в MGD + Arena patches; отдельного AI config нет |
| Automated QA | HISTORICAL GREEN | RC2 500/500 green; post-fix executable ещё не собран |
| Manual playtest raw | MISSING | latest Journal/Diplomacy/Houses JSON не в repo |
| Visual source | INCOMPLETE | docs/templates есть, но V2/V2.1 executable/generator/generated pack отсутствуют |
| Components/BOM | MISSING | блокирует PnP/STABLE |
| Print-ready | NOT READY | блокирует STABLE |

## Release verdict

Текущая механическая source-линия V5.7.2 внутренне согласована по Rules ↔ Data ↔ card registry ↔ map topology. Старый executable RC2 остаётся последним проверенным историческим артефактом, но **не соответствует текущему source после rebuild fixes**.

Новый цифровой RC разрешено объявлять только после миграции complete Arena baseline/HTML, сборки из repo, Game Master regression и browser smoke.