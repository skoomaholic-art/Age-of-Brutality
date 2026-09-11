# Game Master Report — V5.7.2-PLAYABLE-RC1 — 200 seeds

**Artifact SHA-256:** `35302ce62f4daa60f107cb44da7c7f2c71be723218795a0fc784341bc88749d9`  
**Seeds:** 57001–57200  
**Mode:** all Houses controlled by AI; fixed 6 rounds.  
**Status:** RC1 engine regression PASS, release gate FAIL.

## Engine regression

- completed: **200/200**;
- finished on round 6: **200/200**;
- exactly 108 House actions: **200/200**;
- engine errors: **0**;
- invalid actions: **0**;
- prisoner/death state invariant violations at game end: **0**;
- pending prisoner decisions at game end: **0**.

## Prisoner coverage

Across 200 runs the prisoner history contains:

- capture: **22**;
- hold/detain: **12**;
- AI decisions: **22**;
- ransom offers: **12**;
- ransom accepted: **7**;
- ransom rejected: **5**;
- release records: **7**;
- executions: **3**;
- prisoners remaining at game end: **12**.

## Other mechanic coverage

Log-level coverage is non-zero for births, raids and dynastic actions. The former V5.7.1 dead-mechanic symptom (0 births / 0 raids / 0 dynastic alliances) is therefore not reproduced in RC1.

## CRITICAL blockers found by audit

### RC1-RULE-001 — unapproved rules were hardcoded

RC1 currently hardcodes three items that are **not approved project rules**:

1. `П-06 «Съезд заложников»` is treated as a special exception fixing ransom at 2 gold;
2. voluntary release sends a prisoner to abstract `ДВОР`;
3. “nearest captor fortress” is calculated only by number of land edges.

These were implementation assumptions and must not be promoted to canonical rules without an explicit user decision.

### RC1-UI-001 — Human prisoner UI is missing

The RC1 engine exposes `currentPrisonerPrompt()` and `submitPrisonerChoice()`, including the four post-capture branches and human ransom response. However the current UI script contains no calls to these methods and no controls for:

- `Отпустить пленника`;
- `Взять в плен`;
- `Требовать выкуп N`;
- `Казнить`;
- accept/reject ransom.

Therefore a Human-controlled House cannot complete the full prisoner cycle through the visible Arena interface.

## Release conclusion

**DO NOT PROMOTE RC1 TO STABLE / FINAL.**

The simulation engine is structurally stable, but the current artifact fails the release gate because of unapproved rule assumptions and missing Human prisoner UI. Required order:

`RULE DECISIONS → UI FIX → DATA/RULES SYNC → EXACT-BUILD REGRESSION → RELEASE`.
