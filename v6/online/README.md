# Жестокий Век - persistent online prototype

This directory is the first browser-facing vertical slice for a persistent online version of the existing game.

It deliberately does not replace the tabletop V6 rules engine.

## What works in this prototype

- one persistent game state stored as JSON;
- six existing Houses and the canonical 52-territory V6 map;
- browser map based on canonical territory coordinates and graph;
- House selection;
- legal March discovery through the V6 rules engine;
- timed March orders;
- warrior reservation while an order is pending;
- order resolution after ETA even if the browser was closed;
- friendly movement;
- deterministic neutral capture;
- deterministic PvP combat;
- failed stale orders do not partially mutate state;
- reset endpoint for development.
- six rounds with three actions per House, income at the start of each round;
- automatic finish after round 6 with the winner taken from the standings;
- House AI for the unclaimed Houses of a solo game.

## Run

From the `v6` directory, against real Firestore:

```bash
npm install
node src/online/server.mjs
```

Or locally with an in-memory stand-in for Firestore (nothing is persisted):

```bash
npm run dev:local
```

Open:

```text
http://localhost:8787
```

## Prototype timing

Current values are intentionally fast for development and are not canon:

- land segment: 3 seconds, sea segment: 5 seconds (`src/online/orders.mjs`);
- recruit: 4 seconds, fort: 5 seconds (`src/online/economy.mjs`);
- multiplayer round deadline: 5 minutes, AI pause between actions: 1.5 seconds
  (`src/online/rounds.mjs`).

## Production boundary

This is a vertical slice, not production multiplayer infrastructure.

Persistence is Firestore, with authentication and per-player House ownership. Still open before public multiplayer: a transactional worker for due orders and moving the browser client to the final web stack.
