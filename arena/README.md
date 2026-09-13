# Arena V5.7.2

## Current build

The active source-matching build is:

`arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.html`

Build it deterministically from repository source:

```bash
node tools/build_arena_v5_7_2.js
```

The generated manifest stores its byte count, SHA-256, source version, capabilities, map/card counts and build command.

## Source layout

- `source/current/recovery/engine_runtime_recovered_prefix.js` — retained engine prefix promoted into the tracked current source line;
- `source/current/engine_runtime_tail.part-00.js` … `part-02.js` — completed runtime;
- `source/current/current_parity_patch.js` — House rules, commanders and human prisoner choices;
- `source/current/physical_components_patch.js` — physical decks/markets;
- `source/current/intrigue_runtime_patch.js` — 40-card Intrigue/Trace/Investigation runtime;
- `source/current/ai_strategy_patch.js` and `ai_adapter.js` — current AI integration;
- `source/current/ui_runtime.js` — standalone browser UI.

Historical `source/rc1/`, `.b64` fragments and old diagnostic patches are retained only for provenance. They are not required by the current builder.

## Verification

```bash
node qa/rules/tabletop_components.test.js
node qa/rules/current_engine_invariants.test.js
node qa/game-master/game_master_runner.js arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.html 500 58001
```

The invariant suite covers all 18 MGD action/procedure capabilities, port-only sea launch, no inland teleport, family commander constraints, every prisoner decision branch and succession after execution.

## Status

`V5.7.2-PLAYABLE-CURRENT-DEV` is deployable for private digital testing. It is not marked STABLE or print-ready until the remaining browser and physical release gates are complete.
