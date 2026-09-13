# Release

The repository now contains a reproducible current executable: `arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.html`.

Its status is **PLAYABLE CURRENT DEV**, not STABLE: the build is source-matching,
but real-browser smoke and the physical print package are still release gates.

Rebuild and verify it with:

1. `node tools/reconcile_v5_7_2.js --check`;
2. `node tools/build_arena_v5_7_2.js`;
3. `node qa/rules/current_ui_smoke.test.js`;
4. `node qa/game-master/game_master_runner.js arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.html 500 58001`;
5. commit artifact + manifest + hash + QA.

`V5.7.2-PLAYABLE-RC2` remains historical provenance only; it is not a
dependency of the current DEV build.

Physical/PnP STABLE additionally requires migrated card layout/art masters, illustrated map master, Components/BOM and a reproducible print package.
