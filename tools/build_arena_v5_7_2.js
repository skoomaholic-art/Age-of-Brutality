#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..');
const readJSON=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const mgd=readJSON('data/master_game_data_v5.7.2-dev.json');
const topo=readJSON('map/canonical_topology_v5.7.2.json');
const meta=readJSON('map/territory_metadata_v5.7.2.json');
const ai=readJSON('ai/config/canonical_v5.7.2.json');
const sheets=mgd.sheets;
const param=Object.fromEntries(sheets['Global Parameters'].map(r=>[r.PARAM_ID,r['По умолчанию']]));
const typeCode={'Столица':'CAPITAL','Город':'CITY','Деревня':'VILLAGE','Дикая земля':'WILD','Половина центрального острова':'ISLAND_HALF'};
const territoryMeta=meta.territories.map(r=>({id:r.id,name:r.name,house_sector:r.house_sector,type:typeCode[r.type],resistance:r.resistance,legacy_arena_id:r.legacy_arena_id,icon:r.icon}));
if(territoryMeta.some(r=>!r.type))throw new Error('Unknown territory type in metadata');
const houses=sheets.Houses.map(r=>({name:r['Дом'],ruler:r['Правитель'],ability:r['Способность'],weakness:r['Слабость']}));
const events=sheets.Events.map(r=>({id:r.CARD_ID,name:r['Название'],...r}));
const data={
 game:'Жестокий Век',version:'V5.7.2-PLAYABLE-CURRENT-DEV',sourceVersion:mgd.version,
 params:param,actions:sheets.Actions,economy:sheets.Economy,houses,characters:sheets.Characters,
 advisors:sheets.Advisors,ambitions:sheets.Ambitions,events,aiConfig:ai,
 map:{territories:topo.territories,capitals:topo.capitals,ports:topo.ports,land_edges:topo.land_edges,sea_edges:topo.sea_edges,territoryMeta},
 sourceBlockedActions:['ACT-DRAW','ACT-INTRIGUE','ACT-INVEST']
};
const aiAdapter=fs.readFileSync(path.join(ROOT,'arena/source/current/ai_adapter.js'),'utf8');
const prefix=fs.readFileSync(path.join(ROOT,'arena/source/current/recovery/engine_runtime_recovered_prefix.js'),'utf8');
const tail=[0,1,2].map(i=>fs.readFileSync(path.join(ROOT,`arena/source/current/engine_runtime_tail.part-0${i}.js`),'utf8')).join('');
const engine=prefix+tail;
const prisonerLabels=['Отпустить пленника','Взять в плен','Требовать выкуп N','Казнить'];
const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Жестокий Век — Arena V5.7.2 current dev</title></head><body>
<main><h1>Жестокий Век — Arena V5.7.2 current dev</h1><p>Source-reproducible current runtime. Prisoner choices: ${prisonerLabels.join(' / ')}.</p><p>Source-blocked: ACT-DRAW / ACT-INTRIGUE / ACT-INVEST until canonical Intrigue master is restored.</p></main>
<script>window.ARENA_DATA=${JSON.stringify(data)};</script>
<script>${aiAdapter}\n${engine}</script>
</body></html>\n`;
const outDir=path.join(ROOT,'arena/builds');fs.mkdirSync(outDir,{recursive:true});
const out=path.join(outDir,'V5.7.2_PLAYABLE_CURRENT_DEV.html');fs.writeFileSync(out,html);
const hash=crypto.createHash('sha256').update(html).digest('hex');
const manifest={game:data.game,version:data.version,sourceVersion:data.sourceVersion,sha256:hash,bytes:Buffer.byteLength(html),sourceBlockedActions:data.sourceBlockedActions,territories:topo.territories.length,actionsInMGD:sheets.Actions.length,builtAtPolicy:'deterministic tracked-source build'};
fs.writeFileSync(path.join(outDir,'V5.7.2_PLAYABLE_CURRENT_DEV.manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
