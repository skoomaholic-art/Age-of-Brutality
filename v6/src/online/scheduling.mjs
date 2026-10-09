import { nextRanksDueAt } from './ranks.mjs';
import { nextRiderDueAt } from './riders.mjs';
import { roundsNextDueAt } from './rounds.mjs';
import { nextEncounterAt } from './encounters.mjs';
import { nextCharacterDueAt } from './fate.mjs';
import { nextAgentDueAt } from './agents.mjs';
import { nextHordeDueAt } from './heart.mjs';
import { nextBridgeDueAt } from './bridges.mjs';

export function calculateNextDueAt(game) {
  if (game.lifecycle?.status !== 'RUNNING') return null;

  const candidates = [];
  if (game.next_income_at) candidates.push(game.next_income_at);

  const roundsDue = roundsNextDueAt(game);
  if (roundsDue) candidates.push(roundsDue);

  const agentAt = nextAgentDueAt(game);
  if (agentAt) candidates.push(agentAt);

  const characterAt = nextCharacterDueAt(game);
  if (characterAt) candidates.push(characterAt);

  const ranksAt = nextRanksDueAt(game);
  if (ranksAt) candidates.push(ranksAt);
  const hordeAt = nextHordeDueAt(game);
  if (hordeAt) candidates.push(hordeAt);
  const bridgeAt = nextBridgeDueAt(game);
  if (bridgeAt) candidates.push(bridgeAt);
  const riderAt = nextRiderDueAt(game);
  if (riderAt) candidates.push(riderAt);

  const encounterAt = nextEncounterAt(game);
  if (encounterAt) candidates.push(encounterAt);

  for (const order of game.orders || []) {
    if (order.status === 'PENDING' && order.due_at) candidates.push(order.due_at);
  }

  for (const job of game.jobs || []) {
    if (job.status === 'PENDING' && job.due_at) candidates.push(job.due_at);
    if (job.status === 'PENDING' && job.cancel_at) candidates.push(job.cancel_at);
  }

  const valid = candidates
    .map(value => String(value))
    .filter(value => Number.isFinite(Date.parse(value)))
    .sort();

  return valid[0] || null;
}
