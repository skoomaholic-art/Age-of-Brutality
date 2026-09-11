# Game Master Report — V5.7.2 PLAYABLE RC2 CANDIDATE

**Build SHA-256:** `b0284f42bf033c0ae46a28f82b4c5bdb43281285f89f2f1406b4ebdca087cad6`  
**Seeds:** 57001–57500 (500 games)

## Structural regression

- Finished: 500/500
- Round 6: 500/500
- 108 actions: 500/500
- Engine error games: 0
- Invalid actions: 0
- Prisoner-state invariant errors: 0
- Unresolved prisoner queues: 0

## Prisoner coverage

- capture: 48
- hold: 28
- ransom_offer: 30
- ransom_accept: 13
- ransom_reject: 17
- release: 13
- execute: 7

## Other coverage

- raids: 725
- births: 929
- capital captures: 73
- dynastic relations observed: 1244

## Targeted prisoner tests

9/9 passed. Verified: release to owner capital; human-human ransom pending response; no duplicate ransom offer; accepted ransom transfers gold and returns to owner capital; rejected ransom detains; execution terminal state and cost; P-06 numeric ID alone does not trigger the hostage-congress exception; event name `Съезд заложников` does trigger fixed ransom 2.

## Human UI logic smoke

6/6 passed in a deterministic DOM harness: blocking captor modal; all four captor controls; release click; Human ransom-response modal; accepted ransom without duplicate offer; top-level Commander/Prisoner buttons installed.

## Release blockers still open

1. Canonical algorithm for **nearest captor fortress** is not yet approved. Current candidate engine still uses the temporary land-edge BFS from RC1 and MUST NOT be promoted as final rule.
2. Event registry conflict: current monolithic MGD uses `EV-P06` for `Холодная война`, while the Arena baseline contains `П-06 Съезд заложников`. Exception logic in RC2 is name-based to avoid applying ransom=2 to the wrong event. Registry still requires sync.
3. Real Chromium visual smoke is still pending because headless Chromium hangs in the local container. Deterministic Human UI logic smoke is green (6/6).
