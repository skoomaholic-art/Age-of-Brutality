# Жестокий Век

**«Жестокий Век»** — настольная стратегия на 3–6 Домов о войне, дипломатии, династии и интригах. Партия длится ровно 6 раундов.

## Текущий статус

- **Project/source:** `V5.7.2-DEV`.
- **Current Arena:** воспроизводимый `V5.7.2-PLAYABLE-CURRENT-DEV`.
- **Rules/Data:** синхронизированы детерминированным reconciler.
- **Карты:** 151 дизайн / 160 физических карт, включая новый канонический модуль из 40 Интриг.
- **Карта:** 52 территории / 81 сухопутное ребро / 23 морских маршрута / 16 портов.
- **Automated QA:** current build проходит static checks, tabletop/invariant tests и 100/500-seed Game Master regression.
- **STABLE:** нет — это проверяемая DEV-линия, а не финальный релиз.
- **Print-ready/PnP:** нет — остаются art/prepress, полный BOM и физическая проба.

GitHub `main` — единственный MASTER проекта. Исторические RC1/RC2 и recovery-фрагменты сохранены только как справочный материал и больше не блокируют текущую цифровую сборку.

Актуальная сводка: `docs/CURRENT_PROJECT_STATE.md`. Подтверждённые незакрытые проблемы: `docs/KNOWN_ISSUES.md`.

## Быстрый старт Arena

```bash
node tools/reconcile_v5_7_2.js --check
node tools/generate_card_registry_v5_7_2.js --check
node tools/build_arena_v5_7_2.js
node qa/rules/tabletop_components.test.js
node qa/rules/current_engine_invariants.test.js
```

Откройте `arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.html`. Сборка автономна: карта, данные, движок, AI и UI встроены в один HTML.

## Канонические источники

- `rules/source/` — правила;
- `data/master_game_data_v5.7.2-dev.json` — основной MGD;
- `data/prisoners_v5.7.2-dev.json` — плен, выкуп, казнь и освобождение;
- `data/intrigues_v5.7.2.json` — 40 Интриг нового канонического дизайна;
- `cards/canonical_card_set_v5.7.2.json` — состав полного карточного набора;
- `map/canonical_topology_v5.7.2.json` и `map/territory_metadata_v5.7.2.json` — игровая карта;
- `arena/source/current/` — собираемый runtime/UI;
- `ai/` — canonical AI config и агенты;
- `qa/` — проверки и Game Master harness.

## Что приведено в порядок

- восстановлен и зафиксирован собираемый current Arena runtime;
- синхронизированы все 18 записей MGD: 16 обычных действий и 2 свободные процедуры;
- добавлены 40 Интриг, Следы и Расследования без подмены их утраченным историческим каноном;
- исправлены восточные порты на `E1-1`, `E2-1`, `E3-1`;
- добавлены проверки морского движения, семейных командиров, всех веток плена и наследования;
- recovery/forensic workflows переведены в ручной режим, чтобы они не создавали bot-коммиты на каждый push;
- статусы и release metadata отделяют работоспособность цифровой Arena от незавершённого физического издания.

## Workflow

`RULES/DATA → GENERATED REGISTRIES → STATIC CHECKS → ARENA BUILD → INVARIANTS → 100/500-SEED QA → DEPLOY`

Версия получает статус STABLE только после выполнения критериев из `docs/CURRENT_PROJECT_STATE.md`.
