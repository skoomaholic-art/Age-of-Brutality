# Current Source Pointer — V5.7.2-DEV

Дата: 2026-09-12

Текущий MASTER проекта — ветка `main`.

Перед сборкой/плейтестом читать в таком порядке:

1. `docs/CURRENT_PROJECT_STATE.md` — фактическое текущее состояние и критический путь.
2. `docs/decisions/2026-09-12_project_chat_reconciliation.md` — последние подтверждённые решения проекта.
3. `docs/KNOWN_ISSUES.md` — подтверждённые открытые проблемы.
4. `rules/source/` — правила.
5. `data/master_game_data_v5.7.2-dev.json` и canonical data modules.
6. `cards/canonical_registry_v5.7.2.json`.
7. `map/canonical_topology_v5.7.2.json`.
8. `ai/`.
9. `arena/` — только с учётом P0: текущий source-matching executable ещё не восстановлен.
10. `qa/` — исторические отчёты не считать текущим regression без нового executable.

Версию нельзя маркировать STABLE до выполнения Definition of STABLE из `docs/CURRENT_PROJECT_STATE.md`.
