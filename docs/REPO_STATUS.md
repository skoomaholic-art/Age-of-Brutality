# Repository status — V5.7.2-DEV

Дата: 2026-09-13.

| Область | Статус | Факт |
|---|---|---|
| Rules/Data | GREEN | deterministic reconciliation |
| Prisoner/ransom | GREEN | 4 choices, N validation, detention, execution, succession |
| Card data | GREEN | 151 designs / 160 physical copies |
| Map game data | GREEN | 52 / 81 / 23 / 16; east ports fixed |
| Arena source/build | GREEN DEV | reproducible standalone current HTML |
| LEGAL_ACTIONS | GREEN | 16 normal + 2 free; blocked = 0 |
| AI | GREEN | canonical config, six agents, deterministic tests |
| Automated QA | GREEN | invariants + 100/500 seeds |
| Human UI controls | GREEN DEV | New Game, full-party simulation, map, Houses, Diplomacy, Journal and Game Master panel |
| Human diplomacy | GREEN DEV | Pact/dynastic/access proposals pause for receiver consent |
| Player count | OPEN | rules permit 3–6; current reference run is six Houses until 3–5 setup is approved |
| Legacy recovery | ARCHIVED/MANUAL | retained for provenance, no push bot-commits |
| Browser validation | OPEN | required before STABLE promotion |
| Art/BOM/print | INCOMPLETE | blocks print-ready/STABLE, not current digital deploy |

## Release verdict

Текущая цифровая Arena работоспособна и воспроизводима, поэтому её можно публиковать как приватный `V5.7.2-PLAYABLE-CURRENT-DEV` deployment. Репозиторий в целом остаётся `REPOSITORY INCOMPLETE / NOT STABLE / NOT PRINT-READY` до закрытия физического контура и browser proof.
