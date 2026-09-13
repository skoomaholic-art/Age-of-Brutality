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
const ui = scripts.find(script => script.includes('function topologyMap'));

if (!data || !engine || !ui) throw new Error('Arena data, engine or UI script is missing');

globalThis.window = globalThis;
vm.runInThisContext(data);
const bootstrap = 'window.arenaEngine=new ArenaEngine(DATA);';
vm.runInThisContext(engine.slice(0, engine.indexOf(bootstrap) + bootstrap.length) + '\n})();');
for (const patch of patches) vm.runInThisContext(patch);

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.value = '';
    this._innerHTML = '';
    this._controls = [];
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this._controls = [];
    const tagPattern = /<(button|input|select)\b([^>]*)>/g;
    for (const match of this._innerHTML.matchAll(tagPattern)) {
      const control = new FakeElement(match[1]);
      const attrs = match[2];
      const id = /\bid="([^"]+)"/.exec(attrs);
      const valueAttr = /\bvalue="([^"]*)"/.exec(attrs);
      if (id) control.id = id[1];
      if (valueAttr) control.value = valueAttr[1];
      for (const dataAttr of attrs.matchAll(/\bdata-([a-z0-9-]+)="([^"]*)"/g)) {
        const key = dataAttr[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        control.dataset[key] = dataAttr[2];
      }
      this._controls.push(control);
    }
  }

  get innerHTML() { return this._innerHTML; }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    if (selector.startsWith('#')) return this._controls.find(control => control.id === selector.slice(1)) || null;
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const dataSelector = /^\[data-([a-z0-9-]+)\]$/.exec(selector);
    if (!dataSelector) return [];
    const key = dataSelector[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return this._controls.filter(control => Object.hasOwn(control.dataset, key));
  }
}

const body = new FakeElement('body');
const head = new FakeElement('head');
globalThis.document = {
  body,
  head,
  createElement: tagName => new FakeElement(tagName)
};

vm.runInThisContext(ui);

const root = body.children.find(child => child.id === 'arena-app');
if (!root) throw new Error('Arena UI root was not mounted');
if (!root.innerHTML.includes('<svg class="map-svg"')) throw new Error('Canonical topology SVG was not rendered');
if ((root.innerHTML.match(/data-map-territory=/g) || []).length !== 52) throw new Error('Map must render all 52 territories');
if (root.innerHTML.includes('data:image/png')) throw new Error('UI must not depend on the rejected corrupt PNG');

const reset = root.querySelector('#reset');
if (!reset || typeof reset.onclick !== 'function') throw new Error('New Game button is not clickable');
const beforeSeed = Number(window.arenaEngine.exportData().meta.seed);
reset.onclick();
const afterSeed = Number(window.arenaEngine.exportData().meta.seed);
if (afterSeed !== beforeSeed + 1) throw new Error('New Game must visibly start the next seed when the field is unchanged');
if (!root.innerHTML.includes(`Новая партия начата · seed ${afterSeed}`)) throw new Error('New Game must expose visible success feedback');

const run = root.querySelector('#run');
if (!run || typeof run.onclick !== 'function') throw new Error('Full-party simulation button is not clickable');
run.onclick();
if (window.arenaEngine.status !== 'finished') throw new Error('Full-party simulation must finish an all-AI party');
if (!root.innerHTML.includes('Партия завершена')) throw new Error('Full-party simulation must expose completion feedback');

const gmTab = root.querySelectorAll('[data-tab]').find(control => control.dataset.tab === 'GAME_MASTER');
if (!gmTab || typeof gmTab.onclick !== 'function') throw new Error('Game Master tab is not clickable');
gmTab.onclick();
if (!root.innerHTML.includes('Game Master / Auditor')) throw new Error('Game Master panel is missing');

console.log('Current UI smoke tests OK', {
  territoriesRendered: 52,
  mapRenderer: 'INLINE_CANONICAL_TOPOLOGY_SVG',
  newGameClickable: true,
  fullPartySimulation: 'finished',
  gameMasterPanel: true,
  beforeSeed,
  afterSeed
});
