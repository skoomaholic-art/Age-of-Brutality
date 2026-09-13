# V6 architecture

The rebuild separates tabletop truth from presentation.

## Layers

1. `src/data/` — versioned immutable game facts and constants.
2. `src/core/map.mjs` — graph construction and structural invariants.
3. `src/core/state.mjs` — game state and state invariants.
4. `src/core/movement.mjs` — March legality/resolution primitives.
5. `src/core/legal-actions.mjs` — legal March action enumeration; every future action family must expose the same kind of legal-action surface.
6. `src/core/neutral.mjs`, `combat.mjs`, `retreat.mjs` — deterministic encounter procedures.
7. `src/core/engine.mjs` — atomic action boundary: validate/list → resolve on cloned state → state invariant check → spend one action → commit returned state.
8. `src/core/turns.mjs` — round/action-slot sequencing.
9. Future domain modules — economy, diplomacy, dynasty, prisoners, cards, victory.
10. Future AI — scoring of already-legal actions only.
11. Future Arena UI — adapter/client of the core; never a second rules engine.

## Non-negotiable invariants

- Rules legality is deterministic and side-effect free before action commit.
- Illegal visible actions spend no action/resource and cannot mutate caller state.
- A resolution error cannot partially apply an action.
- AI cannot bypass legality by calling low-level state mutation.
- UI cannot contain alternate map/movement/combat rules.
- Every migrated subsystem gets positive and negative tests.
- Every committed state mutation is journaled in the completed engine.
- Six-House reference mode is implemented first. 3–5 Houses remain blocked until setup is explicitly designed.

## Migration order

Map/state → movement → neutral capture/combat/retreat → economy/recruitment/forts → relations/diplomacy → characters/dynasty/prisoners → advisers/events/intrigues/ambitions → victory → AI → full simulation → browser Arena.
