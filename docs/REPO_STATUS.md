# Repository status

## Active development

**V5.7.2-DEV**

GitHub `main` является единственным source of truth для новых решений, исходников, QA и release status.

## Historical baselines

- **V5.7.1-STABLE** — больше не считается прошедшим release gates. Сохранён как исторический executable/data baseline, на котором Game Master выявил критические дефекты.
- **V5.7.0 baseline QA** — историческое свидетельство структурного завершения партий; не является regression для V5.7.1 или V5.7.2.
- Experimental 30-VP / `RULE_PENDING` branch исключён из активной шестираундовой линии.

## Текущие blockers

См. `docs/PROJECT_AUDIT.md` и `docs/KNOWN_ISSUES.md`.

Главные: полный цикл плена, корректные состояния смерти/плена, семейные командиры, нормализация Айреля, AI-доступ к династическим союзам, source migration в GitHub, coverage и print package.

До прохождения release gates слово `STABLE` для текущей версии не используется.
