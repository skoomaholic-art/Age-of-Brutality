# Game Master Report — V5.7.2 PLAYABLE RC2

**Build SHA-256:** `65028a031ec391a3057a4550e926ffcae4141eb1c7407cae84482b0491b80749`  
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

## Targeted tests

- Prisoner flow: **9/9**
- Human prisoner UI logic: **6/6**
- Family commanders: **6/6**
- Canonical nearest-fort routing with direct sea edges: **1/1**

Verified: release/ransom return to owner capital; Human ransom response creates no duplicate offer; accepted ransom transfers gold; rejected ransom detains; execution terminal state/cost; «Съезд заложников» exception is bound by event name; nearest fortress uses unweighted canonical land + direct-sea graph; family commanders assign/move/return and respect caps.

## Release status

**PLAYABLE RC for digital Arena testing. Not STABLE and not print-ready.**

Remaining project-level debts do not block Arena playtest but block STABLE/PnP certification:

1. Event registry conflict: monolithic MGD uses `EV-P06` for «Холодная война», while legacy Arena/card layer contains «Съезд заложников». RC2 resolves behavior by event name; registry still needs canonical ID synchronization.
2. Monolithic MGD still contains inherited prisoner/ransom fields and must be regenerated from canonical modules.
3. Cards/map binary editable sources and full component/print package are not yet stored in GitHub.
4. Real Chromium visual smoke was not completed in the local container; deterministic UI logic smoke is green.
