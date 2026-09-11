# Жестокий Век

**«Жестокий Век»** — настольная стратегическая игра на 3–6 Домов о войне, дипломатии, династии, интригах и борьбе за Очки Победы. Партия длится **ровно 6 раундов**.

## Текущий статус

- **Project/source:** `V5.7.2-DEV`
- **Rules/Data:** reconciled
- **Card game-data registry:** generated from active MGD
- **Map topology:** canonical V5.7.2 source present
- **Current source-matching executable:** нет — требуется миграция полного Arena baseline/HTML и новый build
- **Last verified executable evidence:** `V5.7.2-PLAYABLE-RC2`, исторический QA 500/500
- **STABLE:** нет
- **Print-ready/PnP:** нет

GitHub `main` — единственный MASTER проекта. Исторический RC2 нельзя считать executable текущего source: после его QA исправлены event registry, prisoner detention, execution modifier и ransom validation.

## Канонические источники V5.7.2

- `rules/source/` — правила;
- `data/master_game_data_v5.7.2-dev.json` — активный MGD;
- `data/prisoners_v5.7.2-dev.json` — canonical prisoner/ransom module;
- `cards/canonical_registry_v5.7.2.json` — машинный card/game-data registry, генерируется из MGD;
- `map/canonical_topology_v5.7.2.json` — topology: 52 территории / 81 land / 23 sea / 16 ports;
- `arena/source/patches/` — текущие Arena source fixes;
- `qa/` — QA tooling и исторические проверенные отчёты;
- `docs/` — решения, аудит, status и known issues.

## Что исправлено в rebuild 2026-09-11

- `EV-P06 = «Съезд заложников»`;
- фиксированный выкуп события = 2 золота;
- лишний `-1 Влияние` за казнь при событии удалён;
- direct hold и ransom reject используют единый detention rule;
- ransom `N` — положительное целое; фиксированного диапазона для людей нет;
- execution = 1 действие / -3 Влияния;
- MGD и Rules §20.2 синхронизированы детерминированным reconciler;
- создан canonical card registry из активного MGD;
- создан canonical topology JSON карты.

## Последний проверенный executable

`V5.7.2-PLAYABLE-RC2` ранее прошёл 500-seed Game Master: 500/500 партий завершились на R6, 0 engine errors, 0 invalid actions, 0 prisoner-state invariant errors и 0 unresolved prisoner queues.

Но exact RC2 HTML отсутствует в GitHub, а сохранённый compressed RC1 source неполон и обрывается до engine. Поэтому этот QA — историческое свидетельство, а не подтверждение текущих post-rebuild source fixes.

## Что осталось мигрировать

Это уже не неизвестные игровые правила, а отсутствующие исходники/артефакты:

- complete Arena HTML/baseline для нового executable build;
- editable card print/layout/art masters;
- illustrated map PNG/SVG master;
- последние raw Journal/Diplomacy/Houses JSON ручных плейтестов;
- полный Components/BOM;
- полный Visual V2/V2.1 source/generator/assets;
- воспроизводимый print-ready package.

Точный список: `docs/KNOWN_ISSUES.md`.

## Workflow

`ФИДБЭК → RULES/DATA/CARDS/MAP/ARENA/AI SYNC → STATIC CHECK → QA → BUILD → PLAYTEST → COMMIT/RELEASE`

Нельзя объявлять STABLE файл, который не воспроизводится из зафиксированного GitHub source.