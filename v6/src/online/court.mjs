// What a lord gives and what he costs, at court or with an army.
//
// At court his gifts of peace work: stewardship fills the treasury, speech
// sways other Houses, intrigue makes spies cheaper. A warlike lord kept at
// court frets and stirs up the court. With an army his gifts of war work
// (attack, defence and survival in battle, as before), his gifts of peace
// sleep, and his retinue must be fed. The ruler weighs more: on the throne he
// is worth influence, with an army his men fight harder, but the empty throne
// costs influence.

export function courtEffects(character) {
  const s = character?.stats || {};
  const ruler = character?.role === 'RULER';
  const court = [];
  const army = [];
  if (Number(s.stewardship) > 0) court.push({ kind: 'gold', value: Number(s.stewardship), text: `+${s.stewardship} золота с рассветом (хозяйственность)` });
  if (Number(s.diplomacy) > 0) court.push({ kind: 'deals', value: Number(s.diplomacy), text: `Дома под ИИ уступают в договорах ${s.diplomacy * 2} золота (речи)` });
  if (Number(s.intrigue) > 0) court.push({ kind: 'spy', value: Number(s.intrigue), text: `шпион дешевле на ${s.intrigue} золота (козни)` });
  if (ruler) court.push({ kind: 'influence', value: 1, text: '+1 влияния с рассветом (государь на троне)' });
  if (Number(s.attack) >= 2) court.push({ kind: 'influence', value: -1, text: '−1 влияния с рассветом (рвётся в бой и мутит двор)', bad: true });

  army.push({ kind: 'attack', value: Number(s.attack || 0), text: `+${Number(s.attack || 0)} к силе в бою (натиск)` });
  army.push({ kind: 'defense', value: Number(s.defense || 0), text: `+${Number(s.defense || 0)} к защите в бою (стойкость)` });
  if (ruler) army.push({ kind: 'attack', value: 1, text: '+1 к силе: государь ведёт сам' });
  army.push({ kind: 'gold', value: -1, text: '−1 золота с рассветом (содержание свиты)', bad: true });
  if (ruler) army.push({ kind: 'influence', value: -1, text: '−1 влияния с рассветом (трон пустует)', bad: true });
  army.push({ kind: 'none', value: 0, text: 'в своей столице свиту кормить не надо и трон не пустует' });
  if (Number(s.stewardship) > 0 || Number(s.diplomacy) > 0 || Number(s.intrigue) > 0) {
    army.push({ kind: 'none', value: 0, text: 'дары мира (хозяйство, речи, козни) дремлют, пока он в походе', bad: true });
  }
  return { court, army };
}

function whereIs(character) {
  if (!character?.alive || character.mode === 'CAPTIVE' || character.mode === 'DEAD') return null;
  if (character.mode === 'ARMY') return 'army';
  if (character.mode === 'COURT' && character.status === 'ACTIVE' && character.location?.kind !== 'ROAD') return 'court';
  return null;
}

// The sum of what a House's lords give or cost now.
// An army standing in its own capital is at home: no retinue to feed, the throne not empty.
function atHome(state, character, capitals) {
  const army = state?.armies?.[character.army_id];
  return Boolean(army && !army.moving_order_id && capitals?.[character.house] && army.territory === capitals[character.house]);
}

export function houseCourtTotals(state, house, capitals = null) {
  const totals = { gold: 0, influence: 0, deals: 0, spy: 0 };
  // Nobody on the throne: the Houses watch, and the realm loses face every dawn.
  if (state?.interregnum?.[house]) totals.influence -= 1;
  for (const character of Object.values(state?.characters || {})) {
    if (character.house !== house) continue;
    const where = whereIs(character);
    if (!where) continue;
    const home = where === 'army' && atHome(state, character, capitals);
    for (const effect of courtEffects(character)[where]) {
      if (home && effect.bad) continue;
      if (effect.kind in totals) totals[effect.kind] += effect.value;
    }
  }
  return totals;
}

// A ruler leading his army in person adds to its strength.
export function rulerLeadBonus(character) {
  return character?.role === 'RULER' && character?.mode === 'ARMY' ? 1 : 0;
}

// Applied at every dawn, after the lands have paid. Mutates `state`.
export function applyCourtDawn(state, houses, capitals = null) {
  const gains = {};
  for (const house of houses) {
    const purse = state.houses?.[house];
    if (!purse) continue;
    const totals = houseCourtTotals(state, house, capitals);
    purse.gold = Math.max(0, Number(purse.gold || 0) + totals.gold);
    purse.influence = Math.max(0, Number(purse.influence || 0) + totals.influence);
    gains[house] = { gold: totals.gold, influence: totals.influence };
  }
  return gains;
}
