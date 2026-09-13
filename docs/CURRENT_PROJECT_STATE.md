# Current project state — V5.7.2-DEV

Дата сверки: 2026-09-13.

## Вердикт

Текущая цифровая линия снова воспроизводима из tracked source. `node tools/build_arena_v5_7_2.js` создаёт автономный `arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.html`, соответствующий текущим Rules/Data/Card/Map/AI источникам.

Это **рабочий DEV candidate**, а не STABLE и не print-ready релиз. Исторический RC2 остаётся справочным QA-артефактом, но больше не является единственным исполняемым доказательством проекта.

## Матрица состояния

| Область | Статус | Проверяемый факт |
|---|---|---|
| Rules ↔ Data | GREEN | `reconcile_v5_7_2.js --check` |
| Карточные данные | GREEN | 151 дизайн / 160 физических карт |
| Интриги | GREEN, NEW DESIGN | 40 карт, Следы и Расследования из explicit canonical module |
| Карта | GREEN | 52 territories / 81 land / 23 sea / 16 ports |
| Восточные порты | GREEN | `E1-1`, `E2-1`, `E3-1` |
| AI | GREEN | six House agents, deterministic config/tests, LEGAL_ACTIONS only |
| Current Arena source | GREEN | tracked prefix + tails + parity/physical/intrigue/strategy/UI patches |
| Current Arena build | GREEN | deterministic standalone HTML + manifest/hash |
| Действия | GREEN | 16 normal actions + 2 free procedures, blocked actions = 0; Марш exposes all legal army sizes and enforces cap 8; AI force score saturates at 3 without changing the tabletop choice |
| Командиры | GREEN | adult/healthy, capital assignment/return, 1 per army, 2 per House, movement with army |
| Плен | GREEN | release / hold / ransom accept/reject / execute + succession |
| Game Master | GREEN | 100/100 и 500/500, R6/108 actions, 0 engine errors, 0 invalid |
| Human diplomacy | GREEN | Pact / dynastic / access proposals pause on human consent and spend only after acceptance |
| Player count | OPEN | Rules allow 3–6 Houses; current reference Arena/GM run is fixed six-House until a 3–5 setup rule is approved |
| Browser UX smoke | OPEN | выполнить перед продвижением из DEV |
| Print/art/BOM | OPEN | не блокирует цифровой DEV deploy, блокирует print-ready/STABLE |

## Current Arena

Сборка:

```bash
node tools/build_arena_v5_7_2.js
```

Выход:

- `arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.html`;
- `arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.manifest.json`.

В HTML встроены canonical data, stateful SVG-карта из topology, engine, AI adapter и UI. Доступны рабочая `Новая партия` с видимым feedback, ручной выбор Дома/действия, AI step, `Симуляция до конца` одной партии, четыре решения по пленнику, блокирующее согласие по дипломатии, вкладки Map/Houses/Diplomacy/Journal/Game Master и выгрузка state JSON.

## QA

Обязательные проверки:

```bash
node tools/reconcile_v5_7_2.js --check
node tools/generate_card_registry_v5_7_2.js --check
node tools/check_map_topology_v5_7_2.js
node tools/check_ai_config_v5_7_2.js
python3 tools/check_territory_metadata_v5_7_2.py
node tools/check_tabletop_integrity_v5_7_2.js
node ai/tests/house_agents.test.js
node tools/build_arena_v5_7_2.js
node qa/rules/tabletop_components.test.js
node qa/rules/current_engine_invariants.test.js
```

Game Master gates:

- 100 seeds: все партии завершены на R6 с 108 action slots;
- 500 seeds: все партии завершены на R6 с 108 action slots;
- `engine errors = 0`, `invalid actions = 0`, `sourceBlockedActions = []`;
- draw/play/trace/investigation имеют ненулевое покрытие.
- Стартовая рука Интриг — 0 карт; это задано параметром `INTRIGUE_START_HAND = 0` и новым canonical module.

## Что больше не является блокером

- отсутствие exact historical RC2 HTML;
- неполные RC1/RC3 forensic fragments;
- отсутствие исторического Intrigues sheet;
- прежние 120-card status notes.

Текущая линия не выдаёт новый модуль Интриг за найденный исторический источник: это явно зарегистрированный новый дизайн от 2026-09-12.

## Открытый физический контур

Репозиторий всё ещё нельзя считать полностью готовым физическим изданием:

1. нет утверждённого editable illustrated map master;
2. нет полного approved component BOM и всех production masters;
3. нет сертифицированного consolidated 160-card PDF/print package;
4. нет свежего полного набора ручного playtest raw state;
5. не выполнена физическая пробная печать/сборка.

Для режима 3–5 Домов также отсутствует отдельное утверждённое setup-решение;
поэтому current Arena и batch Game Master используют полный набор из шести
Домов и не маскируют это как готовую вариативную настройку.

Эти пункты перечислены в `docs/KNOWN_ISSUES.md` и `release/repository_completeness_v5.7.2.json`.

## Definition of STABLE

`V5.7.2` можно продвигать из DEV только если одновременно:

- current build воспроизводится без diff;
- canonical и Arena CI зелёные;
- 500+ seed regression зелёный;
- реальный browser smoke подтверждает основной human flow;
- все заявленные release artifacts сохранены и совпадают с manifest/hash;
- для заявления print-ready закрыты art/BOM/prepress/physical proof;
- `docs/KNOWN_ISSUES.md` не содержит блокера выбранного типа релиза.

До этого корректная маркировка: `V5.7.2-PLAYABLE-CURRENT-DEV / NOT STABLE / NOT PRINT-READY`.
