# Жестокий Век

**«Жестокий Век»** — настольная стратегическая игра на 3–6 Домов о войне, дипломатии, династии, интригах и борьбе за Очки Победы. Партия длится **ровно 6 раундов**.

## Текущий статус

- **Project/source:** `V5.7.2-DEV`
- **Rules/Data:** reconciled
- **Card game-data registry:** generated from active MGD
- **Map topology:** canonical V5.7.2 source present
- **Current source-matching executable:** нет — требуется восстановление полного Arena source/runtime и новый воспроизводимый build
- **Last verified executable evidence:** `V5.7.2-PLAYABLE-RC2`, исторический QA 500/500
- **STABLE:** нет
- **Print-ready/PnP:** нет

GitHub `main` — единственный MASTER проекта. Исторический RC2 нельзя считать executable текущего source: после его QA исправлены event registry, prisoner detention, execution modifier и ransom validation.

**Актуальная точка входа по состоянию проекта:** `docs/CURRENT_PROJECT_STATE.md`.

**Сверка последних подтверждённых решений проекта:** `docs/decisions/2026-09-12_project_chat_reconciliation.md`.

## Канонические источники V5.7.2

- `rules/source/` — правила;
- `data/master_game_data_v5.7.2-dev.json` — активный MGD;
- `data/prisoners_v5.7.2-dev.json` — canonical prisoner/ransom module;
- `cards/canonical_registry_v5.7.2.json` — машинный card/game-data registry, генерируется из MGD;
- `map/canonical_topology_v5.7.2.json` — topology: 52 территории / 81 land / 23 sea / 16 ports;
- `arena/source/patches/` и `arena/source/current/` — текущие Arena fixes/recovery source;
- `ai/` — canonical AI config и agents;
- `qa/` — QA tooling и исторические проверенные отчёты;
- `docs/` — решения, аудит, current state и known issues.

## Что исправлено в rebuild 2026-09-11/12

- `EV-P06 = «Съезд заложников»`;
- фиксированный выкуп события = 2 золота;
- лишний `-1 Влияние` за казнь при событии удалён;
- direct hold и ransom reject используют единый detention rule;
- ransom `N` — положительное целое; фиксированного диапазона для людей нет;
- execution = 1 действие / -3 Влияния;
- MGD и Rules §20.2 синхронизированы детерминированным reconciler;
- создан canonical card registry из активного MGD;
- создан canonical topology JSON карты;
- нормализован AI config, созданы House/Prisoner agents и deterministic tests;
- recovered RC3 engine prefix диагностирован: текущий bootstrap/source доказан как неполный;
- зафиксирован единый ledger актуальных решений и current project state.

## Последний проверенный executable

`V5.7.2-PLAYABLE-RC2` ранее прошёл 500-seed Game Master: 500/500 партий завершились на R6, 0 engine errors, 0 invalid actions, 0 prisoner-state invariant errors и 0 unresolved prisoner queues.

Но exact RC2 HTML отсутствует в GitHub, а текущий RC3 source bundle повреждён/обрезан. Поэтому этот QA — историческое свидетельство, а не подтверждение текущих post-rebuild source fixes.

## Главные открытые блокеры

1. **P0 Arena:** восстановить полный tracked engine/runtime и source-matching executable (`#9`).
2. **P1 LEGAL_ACTIONS:** синхронизировать все 18 MGD actions/procedures с Engine → Journal → UI → AI (`#10`).
3. **40 карт Интриг:** найти канонический source или вынести новый дизайн на отдельное решение; не придумывать старый канон (`#11`).
4. После Arena — свежий reproducible 100/500+ seed regression (`#1`) и end-to-end проверка семейных командиров/плена (`#2`, `#3`).
5. Финальные art/map/component/BOM/print masters и physical proof.

Полный список: `docs/CURRENT_PROJECT_STATE.md` и `docs/KNOWN_ISSUES.md`.

## Workflow

`ФИДБЭК → RULES/DATA/CARDS/MAP/ARENA/AI SYNC → STATIC CHECK → QA → BUILD → PLAYTEST → COMMIT/RELEASE`

Нельзя объявлять STABLE файл, который не воспроизводится из зафиксированного GitHub source.