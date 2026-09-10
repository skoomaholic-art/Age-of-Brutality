# Rules source — V5.7.2-DEV

Эти Markdown-файлы являются редактируемым source правил активной DEV-линии. Порядок сборки:

1. `00_core_setup.md`
2. `01_map_movement_combat.md`
3. `02_diplomacy_dynasty_characters.md`
4. `03a_advisors_intrigue_events_exile.md`
5. `03b_victory_ambitions_houses_balance.md`
6. `03c_quick_reference_end_cases.md`
7. `04_arena_technical_appendix.md`

До прохождения release gates эти файлы имеют статус **DEV**, не FINAL/STABLE.

## Последние синхронизированные решения

- Плен: победитель выбирает `Отпустить пленника` / `Взять в плен` / `Требовать выкуп N` / `Казнить`.
- `N` и процедура принятия/отказа от выкупа пока `ТРЕБУЕТ РЕШЕНИЯ`.
- Старое общее правило фиксированного выкупа 3 золота больше не канонично.
- `Айрель` — каноническое написание идентификатора Дома.
- Развод: 1 действие +3 Влияния по существующим Data/Arena; полная процедура добавлена в DEV rule source.

## Build policy

Print DOCX/PDF генерируются из согласованного source только после проверки Rules ↔ Data ↔ Cards ↔ Arena ↔ AI. Экспортированный документ не является самостоятельным master-файлом.
