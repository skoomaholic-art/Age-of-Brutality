# V6 rebuild gates

This ledger is the acceptance contract for the clean rebuild. A green legacy V5.7.2 check is not evidence for V6.

## G1 — Map provenance is locked — PASS
Observable outcome: V6 uses Step 9 territory identity/economy and the pre-regression V5.4.3 Arena graph/coordinates; V5.7.2 normalized topology is not silently inherited.

CHECK: `npm run validate`
EXPECT: `V6_VALIDATION_OK`

## G2 — Capitals and ports are mechanically protected — PASS
Observable outcome: six capitals are W01/W08/W15/E01/E08/E15; six mainland ports are W05/W12/W19/E05/E12/E19; no capital is a mainland port.

CHECK: `node --test tests/map.test.mjs`
EXPECT: `# fail 0`

## G3 — Initial setup matches the tabletop rule — PASS
Observable outcome: only six capitals are controlled at setup, each with four warriors; all other territories are neutral; each House starts with 8 gold, 3 Influence, 0 Intrigues.

CHECK: `node --test tests/state.test.mjs`
EXPECT: `# fail 0`

## G4 — Movement cannot teleport — PASS
Observable outcome: land March is max two printed land edges with a controlled/passage intermediate; sea March is exactly one printed direct sea route from a controlled port to a port; non-port capitals cannot launch sea movement.

CHECK: `node --test tests/movement.test.mjs`
EXPECT: `# fail 0`

## G5 — Action economy is exact — PASS
Observable outcome: six-House reference game has three action cycles per round and 18 paid action slots; first player rotates by one House each round.

CHECK: `node --test tests/turns.test.mjs`
EXPECT: `# fail 0`

## G6 — AI/action callers are downstream of legality — PASS for March
Observable outcome: callers receive March actions only from `LEGAL_ACTIONS`; an unlisted action cannot execute; an illegal or failed resolution cannot mutate caller state or consume a slot.

CHECK: `node --test tests/movement.test.mjs tests/engine.test.mjs`
EXPECT: `# fail 0`

This gate must be extended to every new action family as it is migrated.

## G7 — Neutral capture and combat core are deterministic — PASS
Observable outcome: neutral capture uses strict `2d6 + warriors > 7 + resistance`; PvP uses simultaneous damage, defender wins ties, terrain/fort defense uses the highest base value, support is bounded, and early War VP are idempotent.

CHECK: `node --test tests/neutral.test.mjs tests/combat.test.mjs`
EXPECT: `# fail 0`

## G8 — Voluntary retreat chain is exact — PASS
Observable outcome: first consecutive voluntary retreat loses 1 warrior, second loses 2, third is forbidden; retreat must leave at least one warrior and end in an adjacent owned territory within stack cap; the series resets at the beginning of that House's next own action; a voluntary retreat is not a dice battle and therefore does not award VP-W2.

CHECK: `node --test tests/retreat.test.mjs tests/engine.test.mjs`
EXPECT: `# fail 0`

## G9 — Remaining mechanics are migrated without invention — OPEN
Manual gate: commander Fate, occupation/income, recruitment/economy, fort construction, diplomacy, dynasty, prisoners, advisers, events, intrigues, ambitions and remaining victory rules must each be migrated from verified source and receive dedicated positive/negative tests before V6 can be called playable.

Unresolved rule cases are recorded as blockers rather than guessed.

## G10 — Full-game simulation proves rules compliance — OPEN
Manual until engine migration is complete: 100 then 500 deterministic six-House seeds must finish at R6 with zero invalid actions, zero engine errors, and exported audit logs.

## G11 — Human Arena is a client, not the rules engine — OPEN
Manual until UI phase: browser Arena must consume the same core engine/legal-actions API; no duplicate movement/combat legality in UI code.

## G12 — No automatic deployment/writeback — PASS on rebuild branch
Repository gate: legacy V5 build/recovery/package workflows are absent from `rebuild/v6-clean-core`. The V6 workflow is validation-only, has `contents: read`, and triggers only on pull requests or manual dispatch. It does not deploy, publish, upload packages or modify repository contents.

## G13 — 3–5 House setup is not guessed — OPEN DESIGN GATE
V6 stays six-House reference mode until an explicit 3/4/5-House setup rule defines inactive capitals/territories/cards and balance changes.
