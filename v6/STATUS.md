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
| Time | 6 game days in real time, income at each day change, tempo chosen per game |
| Game end | Automatic after round 6; winner taken from the standings |
| AI | Every House without a player is played by the House AI, solo and multiplayer |
| Combat | No dice: the numbers decide |
| Fog of war | Armies out of sight are hidden |
| Online | Profiles, lobby, public/private rooms, friends, messages, spectators, stats |

`npm run check` passes: map/state validation and 140 tests.

## How a game runs

New games are played in real time over six game days (`src/online/rounds.mjs`,
mode `days`), in the manner of persistent browser strategy games:

1. Income is paid to every House when a game day starts.
2. Orders are not limited in number. They take time instead: one road is a
   sixth of a game day, recruitment and forts scale the same way.
3. The day changes on the clock, whether or not anyone is online. Armies on
   the march keep marching.
4. After the sixth day the game finishes itself and the winner is taken from
   the standings. A single winner is ranked for multiplayer games.

The tempo is chosen when the game is created: a day in 10 minutes, in an hour,
or in 24 hours.

**No dice.** The core rules still take dice, so the online layer feeds them an
average throw (`src/online/orders.mjs`): a neutral land falls when the warriors
outnumber its resistance; in a battle the larger force wins and a tie goes to
the defender; a beaten commander's Fate depends on how heavy the defeat was.
The Fate rule is an online adaptation, not a tabletop rule.

**Fog of war** (`src/online/fog.mjs`). A House sees its own lands, their
neighbours and the sea around its ports and fleets. Who owns a land is public;
armies, commanders, marches, levies and building out of sight are not sent to
the client. A finished game is shown in full.

**House AI** (`src/online/ai.mjs`) plays every House without a player, in solo
and in multiplayer; two players are enough to start a room. It issues ordinary
commands through the same path as a player. It sees the whole map.

The older `rounds` mode (three actions per House, simultaneous rounds) is still
in the code and is used by games started before the switch. Games created
before rounds existed keep the original real-time behaviour.

## Not migrated from the tabletop rules

Diplomacy and pacts, dynasty (marriages, births), prisoners and ransom,
advisers, events, intrigues, ambitions, raids. Victory points cover only the
first war achievements (VP-W1, W2, W3A, W3B).

Of the four round phases in Rules §4, Event and Dynasty are skipped.

## Open questions

- A march costs time by distance but automatic routing can cross a whole chain
  of own territories or a sea lane in one order. The tabletop limit is two land
  edges or one sea route per action.
- An army on the march stays at its origin until it arrives; it cannot be met
  or intercepted on the road.
- The House AI is not bound by the fog of war.
- A player who leaves a multiplayer game is not replaced by the AI.
- A captured capital is checked for "held" at the House's next order.
- Standings show every House's gold and influence.

## Local run

    npm run dev:local

starts the real server on an in-memory stand-in for Firestore
(`tools/dev/`), at http://localhost:8787. Nothing is persisted. Set
`AOB_TEST_DAY_MS` to shorten the game day, for example `AOB_TEST_DAY_MS=40000`.
