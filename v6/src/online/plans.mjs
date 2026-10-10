// How a host is told to fight when it gets there.
//
// A march carries a plan with it. Press the attack and the host hits harder
// and bleeds for it; go carefully and it spares its men but strikes softer.
// Nobody rolls dice over it: both sides of the bargain are written down.

export const PLANS = Object.freeze({
  CHARGE: { name: 'Натиском', strength: 2, losses: 1.4, lore: 'Бить сразу, не разворачиваясь: +2 к силе, но своих ляжет в полтора раза больше.' },
  EVEN: { name: 'Как придётся', strength: 0, losses: 1, lore: 'Обычный бой: ни прибавки, ни убавки.' },
  CAREFUL: { name: 'Осторожно', strength: -1, losses: 0.7, lore: 'Беречь людей: −1 к силе, зато своих ляжет на треть меньше.' }
});

export function planOf(action) {
  const key = String(action?.plan || 'EVEN').toUpperCase();
  return PLANS[key] ? key : 'EVEN';
}

export function planStrength(action) {
  return PLANS[planOf(action)].strength;
}

export function planLosses(action, lost) {
  const share = PLANS[planOf(action)].losses;
  if (share === 1) return lost;
  return share > 1 ? Math.ceil(lost * share) : Math.floor(lost * share);
}
