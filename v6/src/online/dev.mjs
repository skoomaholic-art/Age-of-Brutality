// Developer mode, for the game's author: only in a solo game, only with the
// developer key. It can lift the fog, make building and hiring instant, and
// fill the treasury. Nothing here touches games with other people.
import crypto from 'node:crypto';

const DEV_KEY_SHA256 = '9b96ba110300bbe482e70e521228d6857b1a723d6aa58cfe2a1b094da224a22c';

export function devKeyValid(key) {
  if (!key) return false;
  const digest = crypto.createHash('sha256').update(String(key)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(DEV_KEY_SHA256));
}

export function devAllowed(game, key) {
  return devKeyValid(key) && game?.lifecycle?.game_mode === 'SOLO';
}

const iso = ms => new Date(ms).toISOString();

// Everything this House is waiting for is done now.
export function devFastForward(game, nowMs = Date.now()) {
  const house = game?.dev?.instant ? game.dev.house : null;
  if (!house) return game;
  const now = iso(nowMs);
  let next = null;
  const edit = () => (next ||= structuredClone(game));
  for (const [i, job] of (game.jobs || []).entries()) {
    if (job.status === 'PENDING' && job.house === house && job.due_at > now) edit().jobs[i].due_at = now;
  }
  for (const [id, land] of Object.entries(game.state?.territories || {})) {
    if (land.port_ready_at && land.port_ready_at > now && (land.port_builder || land.owner) === house) edit().state.territories[id].port_ready_at = now;
  }
  for (const [key, bridge] of Object.entries(game.state?.bridges || {})) {
    if (!bridge.built && bridge.ready_at > now && bridge.builder === house) edit().state.bridges[key].ready_at = now;
  }
  if (game.yards?.[house] && game.yards[house].ready_at > now) edit().yards[house].ready_at = now;
  for (const [i, drill] of (game.drills?.[house] || []).entries()) {
    if (drill.due_at > now) edit().drills[house][i].due_at = now;
  }
  // The old levy: every land has its men ready.
  for (const [id, land] of Object.entries(game.state?.territories || {})) {
    if (land.owner === house && game.levy?.[id]) edit().levy[id] = { stock: 99, at: now };
  }
  return next || game;
}

export function devAction(game, house, action, value, { nowMs = Date.now() } = {}) {
  const next = structuredClone(game);
  next.dev ||= {};
  next.dev.house = house;
  if (action === 'REVEAL') next.dev.reveal = Boolean(value);
  else if (action === 'INSTANT') next.dev.instant = Boolean(value);
  else if (action === 'GOLD') {
    const amount = Math.max(1, Math.min(10000, Math.floor(Number(value) || 100)));
    next.state.houses[house].gold = Number(next.state.houses[house].gold || 0) + amount;
  } else throw new Error('unknown dev action');
  next.updated_at = iso(nowMs);
  return devFastForward(next, nowMs);
}
