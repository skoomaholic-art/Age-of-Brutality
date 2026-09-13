# Project Status — V5.7.2 source / historical Arena RC2

> **Historical RC2 status.** Current source и executable описаны в
> `docs/CURRENT_PROJECT_STATE.md`; этот файл сохранён только для provenance.

Дата: 2026-09-11.

## Что означает RC2 сейчас

`V5.7.2-PLAYABLE-RC2` — последний executable, для которого сохранено подтверждение QA: 500/500 партий завершились на R6, 0 engine errors, 0 invalid actions, 0 prisoner-state invariant errors и 0 unresolved prisoner queues.

После этого QA source-линия была дополнительно исправлена. Поэтому RC2 считается **историческим проверенным executable**, а не текущей сборкой V5.7.2 source.

## Текущий source закрывает

- `EV-P06 = Съезд заложников`;
- fixed ransom события = 2 золота;
- отсутствие дополнительного event-штрафа за казнь;
- direct hold = тот же nearest-fort/captor-capital detention pipeline, что ransom reject;
- Human ransom `N` = положительное целое;
- execution = 1 action / -3 Influence;
- MGD ↔ prisoner module ↔ Rules §20.2 consistency;
- card game-data registry из MGD;
- canonical map topology V5.7.2.

## Почему новый RC ещё не объявлен

Exact RC2 HTML не хранится в repo. `arena/source/rc1/*.b64` удалось распаковать лишь частично: поток содержит `ARENA_DATA`, но обрывается до `class ArenaEngine` и закрытия HTML. Поэтому накладывать current source patch на этот baseline и называть результат рабочим RC нельзя.

## Открытые source-availability blockers

- complete Arena baseline/HTML;
- card print/layout/art masters;
- illustrated map master;
- raw manual playtest JSON;
- Visual V2/V2.1 full source/generator/generated pack;
- Components/BOM;
- print-ready package.

Подробно: `docs/KNOWN_ISSUES.md`.
