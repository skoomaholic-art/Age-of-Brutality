# Repository status

## Active line

- Project/source: **V5.7.2-DEV**
- Digital Arena: **V5.7.2-PLAYABLE-RC2**
- STABLE: **нет**
- Print-ready: **нет**

GitHub `main` является единственным source of truth для новых решений, исходников, QA и release status.

## Arena readiness

Arena RC2 признана **играбельной для цифрового плейтеста**.

Game Master 500 seeds 57001–57500:

- 500/500 finished;
- R6: 500/500;
- 108 actions: 500/500;
- engine errors: 0;
- invalid actions: 0;
- prisoner state invariant errors: 0;
- unresolved prisoner queues: 0.

Targeted QA: prisoners 9/9; Human UI 6/6; commanders 6/6; nearest-fort canonical land+sea routing 1/1.

## Remaining blockers to STABLE/PnP

- canonical event-ID sync for «Съезд заложников» vs current monolithic `EV-P06 = Холодная война`;
- regeneration of monolithic MGD from canonical modules;
- migration of full Cards sources into GitHub;
- migration of map PNG/SVG/topology masters into GitHub;
- complete Components/BOM and print package;
- real-browser visual smoke.

See `docs/KNOWN_ISSUES.md`.

## Historical baselines

- **V5.7.1-STABLE** — historical executable/data baseline; no longer considered release-gated STABLE after Game Master findings.
- **V5.7.0 baseline QA** — historical structural evidence only.
- Experimental 30-VP / `RULE_PENDING` line is excluded from the active six-round branch.
