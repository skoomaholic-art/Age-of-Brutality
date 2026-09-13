# Game Master Report — V5.7.2 CURRENT DEV

Дата прогона: 2026-09-13  
Arena: `arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.html`  
SHA-256: `db4e464b14a77967c3ea77f1cc351f2dd1996e6bc4882f5f87a874ea121424f9`

## Verdict

**GREEN для current digital DEV candidate.** Ни один structural, legality или capability gate не сработал. Это не является browser UX smoke или физическим playtest/print proof.

## Commands

```bash
node qa/game-master/game_master_runner.js arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.html 100 57001
node qa/game-master/game_master_runner.js arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.html 500 58001
```

## Structural gates

| Gate | 100 seeds | 500 seeds |
|---|---:|---:|
| Finished | 100/100 | 500/500 |
| Round 6 | 100/100 | 500/500 |
| 108 action slots | 100/100 | 500/500 |
| Games with engine errors | 0 | 0 |
| Invalid actions | 0 | 0 |
| Findings | 0 | 0 |

500-seed range: `58001–58500`.

## 500-seed coverage

| Metric | Count |
|---|---:|
| Neutral captures | 17,148 |
| Battles / PvP wins | 3,194 / 3,194 |
| Raids | 2,917 |
| Births | 37 |
| Capital captures | 1,179 |
| Forts built | 1,105 |
| Official Pacts | 2,366 |
| Dynastic alliances | 77 |
| Access rights | 1,595 |
| Prisoner captures | 519 |
| Ransoms / executions / releases | 514 / 5 / 514 |
| Intrigue draws / plays / successes / discards | 3,676 / 1,203 / 661 / 3,685 |
| Traces / investigations / proven | 1,203 / 370 / 214 |

Fate outcomes: 949 weakened, 519 captured, 327 deaths, 456 saved.

## Capabilities

- 16 implemented normal actions;
- 2 implemented free procedures;
- `sourceBlockedActions = []`;
- human action control and prisoner choice enabled;
- human diplomacy consent enabled for Pact, dynastic and access proposals;
- legal March quantities include 4-warrior choices; AI force scoring saturates at 3 without changing the tabletop rule;
- 40-card Intrigue deck enabled;
- UI panels: Map, Houses, Diplomacy, Journal, Game Master.

## House results

| House | Wins | Win rate | Avg score |
|---|---:|---:|---:|
| Варкайр | 141 | 28.2% | 5.58 |
| Сайрвен | 56 | 11.2% | 3.84 |
| Ортайн | 79 | 15.8% | 4.53 |
| Эркай | 97 | 19.4% | 5.25 |
| Тасвар | 71 | 14.2% | 5.09 |
| Айрель | 56 | 11.2% | 3.90 |

Разброс win rate: 17.0 percentage points, ниже текущего automated finding threshold в 25 points.

## Targeted invariants

`qa/rules/current_engine_invariants.test.js` отдельно подтверждает:

- все 18 MGD action/procedure capabilities;
- море только из контролируемого порта по direct sea edge;
- отсутствие inland-to-island teleport;
- ограничения и движение семейных командиров;
- release, hold, invalid ransom, accepted/rejected ransom, execute;
- наследование после казни правителя.
