# Arena

## Active source status

The active V5.7.2 source fixes live in:

- `arena/source/patches/v5.7.2_rc2_engine_delta.js`
- `arena/source/patches/v5.7.2_rc2_human_ui.js`

The engine delta is synchronized with the current canonical prisoner/event rules:

- `EV-P06 = «Съезд заложников»`;
- event ransom = 2 gold;
- no extra event Influence penalty on execution;
- direct hold and rejected ransom share the same detention pipeline;
- human ransom `N` requires a positive integer.

## Last verified executable

`V5.7.2-PLAYABLE-RC2` is the last executable with preserved 500-seed green QA evidence.

Manifest: `arena/builds/V5.7.2_PLAYABLE_RC2.manifest.json`.

QA: `qa/reports/Game_Master_Report_V5.7.2_RC2_500seeds.md`.

That HTML is **not stored in the repository**, and current source fixes are newer than it. Do not describe RC2 as the executable of the current source line.

## Baseline reconstruction status

`arena/source/rc1/*.b64` is an incomplete historical compressed source. Tolerant gzip recovery yields a partial HTML containing `window.ARENA_DATA`, but the stored stream ends before `class ArenaEngine` and before `</body>`.

Therefore:

- the repository cannot reconstruct RC1/RC2 exact HTML from these chunks;
- a new RC must not be fabricated from the partial stream;
- the complete baseline HTML or missing compressed chunks must be migrated first;
- after migration, build + Game Master + browser smoke must be rerun.

See `arena/source/rc1/README.md` and `docs/KNOWN_ISSUES.md`.