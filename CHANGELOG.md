# Changelog

Все изменения проекта фиксируются в GitHub до выдачи пользовательского билда.

## [V5.7.2-DEV] — Unreleased

### Added
- `docs/PROJECT_AUDIT.md` — стартовая полная инвентаризация и release gates.
- `docs/KNOWN_ISSUES.md` — единый реестр подтверждённых проблем.
- Каноническое решение по post-capture вариантам: отпустить / взять в плен / требовать выкуп N / казнить.

### Changed
- Активная линия разработки переведена с V5.7.1-STABLE на **V5.7.2-DEV**.
- V5.7.1 демотирована до исторического baseline: диагностический Game Master выявил CRITICAL defects.
- GitHub `main` закреплён как единственный source of truth для дальнейших изменений.

### Fixed
- Пока нет закрытых gameplay fixes в V5.7.2-DEV; текущий этап — подтверждение и трассировка дефектов до исправления.

### Balance
- Win rate V5.7.1 не используется как чистая оценка Домов, пока AI profiles фиксированно привязаны к Houses.

### Rules
- Зафиксирован приоритет нового `Требовать выкуп N` над старым общим фиксированным ransom=3.
- Обнаружено отсутствие полной процедуры `Развод` при наличии action в Data/Arena.

### Arena
- Подтверждены defects: captor не хранится; post-capture executor отсутствует; death смешан с `ПЛЕН`; commander model неполон.
- Подтверждено, что AI не выбирает действие династического союза.

### AI
- Нулевые births/raids/dynastic alliances вынесены в coverage investigation; запрещено объяснять их фразой «ИИ так решил».

### Print
- Print-ready package ещё не сертифицирован и не является релизным артефактом.

### QA
- Historical Game Master V1: 100/100 structurally completed on R6, 0 engine errors, 0 invalid; при этом 3 CRITICAL и coverage gaps.

### Known Issues
См. `docs/KNOWN_ISSUES.md`.

## [V5.7.1] — Historical baseline

Собранная шестираундовая версия, ранее маркированная STABLE. Сохранена как исходная точка диагностики и не считается текущим релизом после обнаружения CRITICAL defects.

## [V5.7.0] — Historical QA baseline

Старый 100-seed QA сохранён только как историческое свидетельство и не переименовывается в regression более новых версий.
