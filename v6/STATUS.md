# V6 status

Date: 2026-10-07
Branch: `feature/v6-persistent-prototype`

V6 is a persistent online prototype: a clean rules core, an online layer on
Firestore, and a browser client deployed to Cloud Run. It is playable from
start to automatic finish, but it covers only part of the tabletop game.

## What works

| Area | State |
|---|---|
| Map | 52 territories, land graph, sea lanes with occupiable waypoints |
| March | Land and sea, automatic routing, timed resolution, animation |
| Combat | Neutral capture, House-vs-House battle, retreats, empty occupation |
| Economy | Income, recruitment, forts |
| Characters | Commander assignment to an army, return to court, commander Fate |
| Rounds | 6 rounds, income at the start of each, 3 actions per House |
| Game end | Automatic after round 6; winner taken from the standings |
| Solo | The five Houses the player did not take are played by the House AI |
| Online | Profiles, lobby, public/private rooms, friends, messages, spectators, stats |

`npm run check` passes: map/state validation and 129 tests.

## How a game runs

Games started from this version are played in rounds (`src/online/rounds.mjs`):

1. Income is paid to every House at the start of the round.
2. Each House has 3 actions (march, recruit, fort). Houses act at the same
   time, not in table order.
3. The round ends when every House has used its actions or ended its round and
   no order is still resolving. A multiplayer round also ends at its deadline
   (5 minutes, a prototype value). A solo round has no deadline.
4. After round 6 the game finishes itself. Ranked results are recorded for
   multiplayer games.

An order that fails to resolve gives its action back. Games created before
rounds existed have no `rounds` field and keep the old real-time behaviour.

The House AI (`src/online/ai.mjs`) issues ordinary commands through the same
path as a player, so it cannot make an illegal move.

## Not migrated from the tabletop rules

Diplomacy and pacts, dynasty (marriages, births), prisoners and ransom,
advisers, events, intrigues, ambitions, raids. Victory points cover only the
first war achievements (VP-W1, W2, W3A, W3B).

Of the four round phases in Rules §4, Event and Dynasty are skipped.

## Open questions

- A march costs one action whatever its length, because automatic routing can
  cross a whole chain of own territories or a sea lane. The tabletop limit is
  two land edges or one sea route per action.
- A captured capital is checked for "held" at the House's next action. A
  capture made with a House's last action of round 6 is never checked.
- 3–5 House games have no approved setup rule; multiplayer needs all six.

## Local run

    npm run dev:local

starts the real server on an in-memory stand-in for Firestore
(`tools/dev/`), at http://localhost:8787. Nothing is persisted.
