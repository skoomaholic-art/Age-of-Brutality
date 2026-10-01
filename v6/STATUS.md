# V6 rebuild status

Date: 2026-09-14
Branch: `rebuild/v6-clean-core`

## Complete in this milestone

- Clean V6 directory created; no V5 runtime code imported.
- Map provenance investigation completed.
- Step 9 capitals restored.
- Pre-regression V5.4.3 mainland ports and graph restored as V6 baseline.
- Core constants, state, movement, legal-action and turn modules implemented.
- Neutral capture and deterministic PvP battle core implemented.
- Voluntary pre-battle retreat chain implemented.
- Atomic March executor implemented: reject-before-commit and no slot loss on illegal/failed resolution.
- Legacy V5 automatic recovery/build/package workflows removed from the rebuild branch.
- Replacement V6 CI is read-only and PR/manual only.
- **28 foundational tests pass locally; 0 failures.**

## Deliberately not claimed complete

V6 is not yet a playable replacement. Remaining gates cover commander Fate, economy/recruitment/forts, diplomacy, dynasty/prisoners, advisers/events/intrigues/ambitions, remaining victory rules, full-game simulation, AI strategy, Arena UI and an explicit 3–5 House setup rule.

## Next implementation leaf

Migrate economy + income/occupation + recruitment + fort construction from verified rule/data sources and put every new action behind the same atomic `LEGAL_ACTIONS` boundary. Commander Fate stays blocked until character state is migrated.
