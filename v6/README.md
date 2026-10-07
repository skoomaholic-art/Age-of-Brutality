# Жестокий Век — V6 clean rebuild

V6 is a clean tabletop rules-engine rebuild isolated from the V5.7.2 recovered runtime.

Current milestone: **online prototype, playable from start to automatic finish, partial rules / NOT STABLE**. See `STATUS.md` for what is and is not migrated.

What is already implemented and tested:

- provenance-locked 52-territory map;
- restored capitals and mainland ports;
- restored 96-land / 20-sea pre-regression graph;
- initial six-House setup;
- warrior caps and state invariants;
- land March: max two printed edges, legal intermediate only;
- sea March: one direct printed port-to-port route only;
- `LEGAL_ACTIONS` enumeration for March;
- atomic March executor: an illegal or failed-to-resolve action cannot mutate caller state or consume an action slot;
- three action cycles per House and rotating first player;
- neutral resistance/capture with VP-W1;
- deterministic House-vs-House battle core with simultaneous losses, terrain/fort defense, support, post-battle defender retreat and VP-W2/VP-W3A;
- voluntary pre-battle retreat chain: first retreat loses 1 warrior, second loses 2, third consecutive retreat is forbidden until the House's next own action.

Run:

```bash
cd v6
npm run check
```

The checks need no package install. The online server needs `npm install` (Firestore client); `npm run dev:local` runs it on an in-memory stand-in instead.

The gates in `GATES.md` remain the acceptance contract for a full tabletop-faithful V6. Diplomacy, dynasty, prisoners, cards and the remaining victory rules are still migration work.
