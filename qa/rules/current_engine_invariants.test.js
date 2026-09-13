#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const arena = path.resolve(__dirname, '../../arena/builds/V5.7.2_PLAYABLE_CURRENT_DEV.html');
const html = fs.readFileSync(arena, 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const data = scripts.find(script => script.includes('window.ARENA_DATA='));
const engine = scripts.find(script => script.includes('class ArenaEngine'));
const patches = scripts.filter(script => script.includes('ARENA_V572_CURRENT_PATCH'));

if (!data || !engine) throw new Error('Arena scripts missing');
globalThis.window = globalThis;
vm.runInThisContext(data);
const bootstrap = 'window.arenaEngine=new ArenaEngine(DATA);';
vm.runInThisContext(engine.slice(0, engine.indexOf(bootstrap) + bootstrap.length) + '\n})();');
for (const patch of patches) vm.runInThisContext(patch);

const e = window.arenaEngine;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function testCapabilities() {
  e.reset(63001, 6);
  const report = e.capabilityReport();
  const normal = [
    'ACT-MARCH', 'ACT-RECRUIT', 'ACT-FORT', 'ACT-ADVISER', 'ACT-DRAW',
    'ACT-INTRIGUE', 'ACT-PACT', 'ACT-MARR-NEUT', 'ACT-MARR-DYN',
    'ACT-BIRTH', 'ACT-LEGIT', 'ACT-DIVORCE', 'ACT-INVEST', 'ACT-RETURN',
    'ACT-ACCESS', 'ACT-RAID'
  ];
  const free = ['PROC-BREAK', 'PROC-GOLD'];
  for (const id of normal) assert(report.implementedNormalActions.includes(id), `${id} is absent from capability report`);
  for (const id of free) assert(report.implementedFreeProcedures.includes(id), `${id} is absent from capability report`);
  assert(report.implementedNormalActions.length === normal.length, 'Capability report has an unexpected normal-action count');
  assert((report.sourceBlockedActions || []).length === 0, 'Current Arena must not expose source-blocked actions');
  assert(report.humanCommanderManagement === true, 'Current Arena must expose human commander management');
}

function testPortMovement() {
  e.reset(63002, 6);
  const house = 'Варкайр';
  const port = 'W1-4';
  const seaDestinations = [...e.sea[port]].sort();
  e.territories[port].owner = house;
  e.territories[port].units = { [house]: 2 };

  const legalSea = e.marchCandidates(house)
    .filter(action => action.source === port && action.route.length === 2 && seaDestinations.includes(action.dest))
    .map(action => `${action.dest}:${action.amount}`)
    .sort();
  const expectedSea = seaDestinations.flatMap(dest => [1, 2].map(amount => `${dest}:${amount}`)).sort();
  assert(JSON.stringify(legalSea) === JSON.stringify(expectedSea), 'Owned port must expose only its printed sea links and all legal army sizes');

  e.territories[port].owner = null;
  const unownedLaunch = e.marchCandidates(house)
    .some(action => action.source === port && seaDestinations.includes(action.dest));
  assert(!unownedLaunch, 'Units may not launch by sea from a port the House does not control');

  const inland = 'W1-3';
  e.territories[inland].owner = house;
  e.territories[inland].units = { [house]: 2 };
  const inlandTeleport = e.marchCandidates(house)
    .some(action => action.source === inland && action.dest.startsWith('S'));
  assert(!inlandTeleport, 'Inland armies may not teleport through a nearby port in one March');

  e.reset(63005, 6);
  const capital = e.data.map.capitals[house];
  const neutral = e.land[capital].find(id => !e.territories[id].owner);
  const sizes = e.marchCandidates(house)
    .filter(action => action.source === capital && action.dest === neutral && action.route.length === 2)
    .map(action => action.amount)
    .sort((a, b) => a - b);
  assert(JSON.stringify(sizes) === JSON.stringify([1, 2, 3, 4]), 'March must expose every army size up to the source count');

  const owned = e.land[capital].find(id => id !== neutral);
  e.territories[owned].owner = house;
  e.territories[owned].units[house] = 7;
  const capped = e.marchCandidates(house).filter(action => action.source === capital && action.dest === owned);
  assert(capped.length === 1 && capped[0].amount === 1, 'March into an owned territory must respect the warrior cap of 8');
  let capRejected = false;
  try { e.doMarch(house, { source: capital, dest: owned, amount: 2 }, false); } catch (_) { capRejected = true; }
  assert(capRejected, 'Direct March must reject a move that would exceed the territory warrior cap');
}

function testHumanDiplomacyConsent() {
  e.reset(63006, 6);
  const proposer = 'Варкайр';
  const receiver = 'Сайрвен';
  e.setController(proposer, 'HUMAN');
  e.setController(receiver, 'HUMAN');
  const pact = e.legalActions(proposer).find(action => action.type === 'pact' && action.other === receiver);
  assert(pact, 'A legal Pact proposal must be available in the initial state');
  const beforeInfluence = e.houses[proposer].influence;
  const pending = e.step(pact.id);
  assert(pending.pendingDiplomacy?.other === receiver, 'Human diplomacy must create a blocking proposal');
  assert(e.actionTotal === 0 && e.relationships.length === 0, 'An unaccepted proposal must not spend an action or mutate relations');
  let out = e.submitDiplomacyChoice('reject');
  assert(out.valid && out.accepted === false && !e.currentDiplomacyPrompt(), 'Reject must clear the proposal without spending the proposer action');
  const pactAgain = e.legalActions(proposer).find(action => action.type === 'pact' && action.other === receiver);
  assert(pactAgain, 'The proposer must be able to choose another action after a rejection');
  e.step(pactAgain.id);
  out = e.submitDiplomacyChoice('accept');
  assert(out.meta.status === 'playing' && e.relationships.some(r => r.kind === 'Официальный Пакт' && r.a === proposer && r.b === receiver), 'Accept must create the Pact');
  const proposerCost = Math.max(0, 1 - Number(e.stateFlags.pactDiscount || 0));
  assert(e.actionTotal === 1 && e.houses[proposer].influence === beforeInfluence - proposerCost && e.houses[receiver].influence === 3 && e.houses[receiver].reserved === 1, 'Accept must apply the tabletop Pact costs and reserve the partner action');
}

function testFamilyCommanders() {
  e.reset(63003, 6);
  const house = 'Сайрвен';
  const state = e.houses[house];
  const capital = e.data.map.capitals[house];
  const heir = state.heir;

  heir.young = true;
  assert(!e.commanderEntries(house).find(entry => entry.uid === heir.uid).canAssign, 'Commander UI model must disable a young character');
  assert(!e.assignCommander(house, heir.uid, capital).valid, 'A young character may not become a commander');
  heir.young = false;
  assert(e.assignCommander(house, heir.uid, capital).valid, 'An adult healthy family member must be assignable in the capital');

  const [firstDestination, secondDestination] = e.land[capital].slice(0, 2);
  for (const id of [firstDestination, secondDestination]) {
    e.territories[id].owner = house;
    e.territories[id].units[house] = 0;
  }
  e.doMarch(house, { source: capital, dest: firstDestination, amount: 1 }, false);
  assert(heir.armyLocation === firstDestination, 'Commander must move with the assigned army');
  assert(!e.returnCommander(house, heir.uid).valid, 'Commander may return to Court only from the capital');

  const ruler = state.ruler;
  assert(e.assignCommander(house, ruler.uid, capital).valid, 'A second family commander must be assignable');
  e.doMarch(house, { source: capital, dest: secondDestination, amount: 1 }, false);
  assert(ruler.armyLocation === secondDestination, 'Second commander must move with their army');

  const third = state.reserveChildren[0];
  Object.assign(third, { alive: true, young: false, health: 'Здоров', mode: 'ДВОР', armyLocation: null });
  assert(!e.assignCommander(house, third.uid, capital).valid, 'A House may not have more than two characters in armies');

  e.doMarch(house, { source: firstDestination, dest: capital, amount: 1 }, false);
  assert(e.returnCommander(house, heir.uid).valid, 'Commander in the capital must be returnable to Court');
  heir.health = 'Ослаблен';
  assert(!e.assignCommander(house, heir.uid, capital).valid, 'A weakened character may not become a commander');
}

function prepareCapture(owner = 'Сайрвен', captor = 'Варкайр', ruler = false) {
  e.reset(63004, 6);
  e.setController(captor, 'HUMAN');
  const character = ruler ? e.houses[owner].ruler : e.houses[owner].heir;
  const location = e.data.map.capitals[captor];
  const result = e.captureCharacter(owner, character, captor, location);
  assert(result?.pending && e.currentPrisonerPrompt()?.uid === character.uid, 'Human captor must receive a pending prisoner choice');
  return { owner, captor, character, location };
}

function testPrisonerLifecycle() {
  let capture = prepareCapture();
  let out = e.submitPrisonerChoice('release');
  assert(out.valid && capture.character.mode === 'ДВОР' && capture.character.heldBy === null, 'Release must clear captivity and return the character to Court');

  capture = prepareCapture();
  out = e.submitPrisonerChoice('hold');
  assert(out.valid && capture.character.mode === 'ПЛЕН' && capture.character.heldBy === capture.captor, 'Hold must preserve a live captive with a captor');
  assert(capture.character.captiveLocation, 'Held prisoner must have a detention location');

  capture = prepareCapture();
  e.houses[capture.owner].gold = 10;
  const captorGold = e.houses[capture.captor].gold;
  out = e.submitPrisonerChoice('ransom', 3, 'accept');
  assert(out.valid && capture.character.mode === 'ДВОР' && capture.character.heldBy === null, 'Accepted ransom must release the prisoner');
  assert(e.houses[capture.owner].gold === 7 && e.houses[capture.captor].gold === captorGold + 3, 'Accepted ransom must transfer exactly N gold');

  capture = prepareCapture();
  out = e.submitPrisonerChoice('ransom', 0, 'accept');
  assert(!out.valid && e.currentPrisonerPrompt(), 'Ransom N must be a positive integer and an invalid choice must remain pending');
  e.submitPrisonerChoice('hold');

  capture = prepareCapture();
  e.houses[capture.owner].gold = 10;
  out = e.submitPrisonerChoice('ransom', 3, 'reject');
  assert(out.valid && capture.character.mode === 'ПЛЕН' && capture.character.heldBy === capture.captor, 'Rejected ransom must route to detention');

  capture = prepareCapture('Сайрвен', 'Варкайр', true);
  e.houses[capture.captor].influence = 10;
  const influence = e.houses[capture.captor].influence;
  const reserved = e.houses[capture.captor].reserved;
  const heirUid = e.houses[capture.owner].heir.uid;
  out = e.submitPrisonerChoice('execute');
  assert(out.valid, 'Execution must be legal with 3 Influence and a future action slot');
  assert(!capture.character.alive && capture.character.mode === 'Мёртв' && capture.character.heldBy === null, 'Execution must produce death, not a captive state');
  assert(e.houses[capture.captor].influence === influence - 3 && e.houses[capture.captor].reserved === reserved + 1, 'Execution must cost 3 Influence and reserve one future action');
  assert(e.houses[capture.owner].ruler?.uid === heirUid, 'Executing a ruler must immediately resolve succession');
}

testCapabilities();
testPortMovement();
testHumanDiplomacyConsent();
testFamilyCommanders();
testPrisonerLifecycle();

console.log('Current engine invariant tests OK', {
  normalActions: 16,
  freeProcedures: 2,
  portMovement: 'OK',
  familyCommanders: 'OK',
  humanDiplomacyConsent: 'OK',
  prisonerBranches: 6,
  succession: 'OK'
});
