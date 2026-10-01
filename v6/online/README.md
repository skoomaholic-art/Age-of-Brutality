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

## Run

From the `v6` directory:

```bash
node src/online/server.mjs
```

Open:

```text
http://localhost:8787
```

Optional environment variables:

```text
PORT=8787
AOB_ONLINE_STATE_FILE=/persistent/path/online-game.json
```

## Prototype timing

Current values are intentionally fast for development:

- land edge: 30 seconds;
- direct sea route: 45 seconds.

These are not canon and are isolated in `src/online/orders.mjs`.

## Production boundary

This is a vertical slice, not production multiplayer infrastructure.

Before public multiplayer, replace the JSON store with PostgreSQL, add authentication and per-player House ownership, use a transactional worker/queue for due orders, add concurrency locks/idempotency and move the browser client to the final web stack.
