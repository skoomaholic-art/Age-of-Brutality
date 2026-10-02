# V6 source provenance

V6 is a clean implementation, not a continuation of the V5.7.2 runtime.

## Trusted baseline

- Territory identity, names, classes, income and central-island structure: `Zhestokiy_Vek_Step9_52_Territories.json`, V5.4.3 Step 9.
- Pre-regression graph, coordinates, ports and sea routes: `Zhestokiy_Vek_Arena_V5.4.3.html` → `ARENA_DATA.map`.
- Visual sanity check: project map image with six Houses around the central sea.
- Explicit owner review on 2026-10-02 overrides the older west-center sea-route placement for Туман A and Короны A.
- Current V5.7.2 rules/data are migration candidates for mechanics only; they are not allowed to override a conflicting older map fact merely because they are newer.

## Confirmed map facts

- 52 territories: 42 mainland + 10 central halves.
- Capitals: Варкайр W01; Сайрвен W08; Ортайн W15; Эркай E01; Тасвар E08; Айрель E15.
- Mainland sea-route endpoints after the approved 2026-10-02 correction: W05, W07, W12, W14, W18, E05, E12, E19.
- Central ports: all ten S01-A…S05-B halves.
- Graph remains 96 land edges and 20 direct sea edges.
- Туман A (S04-A) connects to Эйрвик (W18) and Келвар (W14), not Селвар (W19) or Вельмар (W12).
- Короны A (S03-A) connects to Эйрвик (W18), Келвар (W14) and Нордмар (W07), plus Короны B (S03-B), Вейр B (S01-B) and Туман B (S04-B). The stale west links to Скархольм (W05), Вельмар (W12) and Селвар (W19) are removed.
- A/B halves of one central island are connected by land.
- Visual proximity never creates a route.

## Why V5.7.2 topology is rejected as the V6 base

V5.7.2 changed the six mainland ports to W1-4/W2-4/W3-4 and E1-1/E2-1/E3-1 and replaced the older irregular land graph with a normalized sector graph. This is a mechanical geography change, not an ID-only migration. It also puts eastern ports on capital nodes, contradicting the earlier tested Arena/map placement.

V6 starts from the earlier provenance, but explicit owner corrections supersede that baseline. The 2026-10-02 Туман A / Короны A correction is such an approved topology change. Future topology changes still require explicit approval.

## Conflict policy

When sources disagree:
1. explicit owner decision;
2. verified project artifact closest to the original tabletop design;
3. newer rule text only when it does not silently rewrite a previously approved physical fact;
4. unresolved conflict remains a gate — no invention by code or AI.
