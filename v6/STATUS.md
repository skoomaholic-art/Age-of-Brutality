# V6 status

Date: 2026-10-10
Branch: `claude/v6-supremacy-mode`

V6 is a persistent online prototype: a clean rules core, an online layer on
Firestore, and a browser client deployed to Cloud Run. A game runs from the
first march to an automatic end, with or without anyone watching. It is played
in the manner of Supremacy 1914 rather than of the tabletop turn order, and it
covers part of the tabletop game.

## What works

| Area | State |
|---|---|
| Map | Generated per game: 2–6 Houses, eight shapes, four sizes, equal starts; the hand-made 52-territory map stays for tests |
| Ground | Mountains, marshes, deserts, snows; walls of rock that no road crosses; rivers crossed only at bridges; ports for any water |
| Weather | Summer or winter per map; reefs and wandering storms at sea |
| March | Land and sea, routing, timed arrival, field battles on the road |
| Combat | No dice: the numbers decide. Six kinds of men, experience, walls, retreats |
| Attrition | Rough ground wears a host down — never in the House's own realm; the sea takes men after too many dawns afloat |
| Economy | Income, hiring by kind, upkeep and desertion, forts, ports, bridges, yards, growth |
| People and order | Every land has people and order; a stripped or newly taken land may rise in revolt |
| The Heart | Hidden Hearts rise between the Houses on day 3; decoys wake the Horde; spies and rumours tell true from false |
| The Horde | Wakes at a decoy, marches on a capital, sacks it and burns half the treasury |
| Characters | Commanders lead armies, are wounded, captured, ransomed, imprisoned, executed, or come ashore from a lost fleet |
| Diplomacy | Only with Houses met on the map: war, peace by letter, truce, alliance; allies share the whole map |
| Secrets | Spies, rumours, riders that may be caught |
| Time | Game days in real time; the server wakes sleeping games by itself |
| Game end | The Heart taken, or the standings after the last day |
| AI | Every House without a player is played by the House AI — it aims at the Heart, holds ground that does not eat men, and asks for peace when losing |
| Fog of war | By exploration: what is unseen is not sent to the client at all |
| Sound | Effects, four themes (summer, winter, battle, victory) and a theme at the gates; hosts answer when touched |
| Online | Profiles, menu with every lobby section, public/private rooms, friends, messages, spectators, stats |
| Phone | The map opens on the House's own realm, the panes fold, the controls sit under the thumb |

`npm run check` passes: map/state validation and 347 tests.
`node tools/check-browser-html.mjs` checks the scripts of all three pages.

## How a game runs

Games are played in real time over game days (`src/online/rounds.mjs`), in the
manner of persistent browser strategy games:

1. Income is paid to every House when a game day starts, with a treasurer's
   report in the dawn's notice.
2. Orders are not limited in number. They take time instead: one road is a
   fraction of a game day, and rough ground makes it longer.
3. The day changes on the clock, whether or not anyone is online. Armies on
   the march keep marching, storms wander, the Horde walks its road.
4. A game ends when a House holds the Heart of the Century, or after the last
   day by the standings.

The tempo is chosen when the game is created: a day in 10 minutes, in an hour,
or in 24 hours.

**No dice.** Strength decides: the numbers of men by kind, their experience,
the walls, the ground. A tie goes to the defender.

**Fog of war** (`src/online/fog.mjs`). A House sees its own lands, their
neighbours, the sea around its ports and fleets, and everything its allies see.
Private tidings — attrition, storms, lost marches, a lord come ashore — reach
only the House they befell. A finished game is shown in full.

**House AI** (`src/online/ai.mjs`, `ai-heart.mjs`) plays every House without a
player. It issues ordinary commands through the same path as a player.

**Developer mode** belongs to one account (`AOB_DEV_HANDLE`, by default
`skoomaholic`) and only in solo games. For everyone else nothing of it is sent
to the page.

## Not migrated from the tabletop rules

Dynasty (marriages, births), advisers, events, intrigues, ambitions, raids.
Victory points cover only the first war achievements (VP-W1, W2, W3A, W3B).

## Known gaps

- The House AI is not bound by the fog of war.
- A march cannot be intercepted between two lands outside a field battle.
- A player who leaves a multiplayer game is marked abandoned, not replaced.
- Voices for the hosts are not recorded yet: a horn answers instead.

## Local run

    npm run dev:local

starts the real server on an in-memory stand-in for Firestore
(`tools/dev/`), at http://localhost:8787. Nothing is persisted. Set
`AOB_TEST_DAY_MS` to shorten the game day, for example `AOB_TEST_DAY_MS=40000`.
