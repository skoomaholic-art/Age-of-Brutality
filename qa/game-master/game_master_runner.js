#!/usr/bin/env node
'use strict';
const fs=require('fs');
const vm=require('vm');

const arena=process.argv[2];
const games=Number(process.argv[3]||100);
const startSeed=Number(process.argv[4]||57001);
if(!arena){console.error('Usage: node game_master_runner.js <arena.html> [games=100] [startSeed=57001]');process.exit(2)}
const html=fs.readFileSync(arena,'utf8');
const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const data=scripts.find(s=>s.includes('window.ARENA_DATA='));
const engineSrc=scripts.find(s=>s.includes('class ArenaEngine'));
const enginePatches=scripts.filter(s=>s.includes('window.ARENA_V572')&&(s.includes('rc2Delta:true')||s.includes('rc3Delta:true')));
const marker='window.arenaEngine=new ArenaEngine(DATA);';
if(!data||!engineSrc||!engineSrc.includes(marker))throw new Error('Arena data/engine not found');
globalThis.window=globalThis;
vm.runInThisContext(data,{filename:'arena-data.js'});
vm.runInThisContext(engineSrc.slice(0,engineSrc.indexOf(marker)+marker.length)+'\n})();',{filename:'arena-engine.js'});
for(let i=0;i<enginePatches.length;i++)vm.runInThisContext(enginePatches[i],{filename:`arena-engine-patch-${i+1}.js`});
const engineAuditSrc=engineSrc+'\n'+enginePatches.join('\n');

const H=window.ARENA_DATA.houses.map(h=>h.name);
const wins=Object.fromEntries(H.map(h=>[h,0]));
const sum=Object.fromEntries(H.map(h=>[h,{score:0,influence:0,gold:0}]));
const actions={},metrics={},relations={},fates={},prisonerProcedures={};
const rows=[];const findings=[];
let finished=0,round6=0,actions108=0,errorGames=0,invalid=0,captures=0,captureGames=0,livePrisoners=0,prisonerGames=0,peakInfluence=-Infinity;
const add=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const livePrisonerCount=h=>{
  const seen=new Set();let n=0;const visit=c=>{if(!c||seen.has(c.uid))return;seen.add(c.uid);if(c.alive&&c.mode==='ПЛЕН')n++};
  visit(h.ruler);visit(h.heir);visit(h.spouse);(h.reserveChildren||[]).forEach(visit);(h.activeYoung||[]).forEach(visit);(h.knownBastards||[]).forEach(visit);(h.legitimizedBastards||[]).forEach(visit);return n;
};
for(let i=0;i<games;i++){
  const seed=startSeed+i,e=window.arenaEngine;e.reset(seed,6);e.runGame();const x=e.exportData(),g=x.statistics.game;
  if(x.meta.status==='finished')finished++;if(g?.round===6)round6++;if(x.meta.actionTotal===108)actions108++;if(x.errors.length)errorGames++;
  const inv=g?.metrics?.total?.invalidActions||0;invalid+=inv;if(g?.leader)wins[g.leader]++;
  for(const [k,v] of Object.entries(g?.metrics?.total||{}))if(typeof v==='number')add(metrics,k,v);
  for(const st of g?.standings||[]){sum[st.house].score+=st.score;sum[st.house].influence+=st.influence;sum[st.house].gold+=st.gold;peakInfluence=Math.max(peakInfluence,st.influence)}
  for(const r of x.relationships||[])add(relations,r.kind);
  let cap=0;for(const l of x.logs){if(l.kind==='action')add(actions,l.action);const fate=l?.meta?.fate;if(fate){const k=String(fate).split(' ')[0];add(fates,k);if(String(fate).startsWith('Плен')){captures++;cap++}}for(const snap of [l.before,l.after])for(const hs of Object.values(snap?.houses||{}))peakInfluence=Math.max(peakInfluence,Number(hs.influence)||0)}
  for(const p of x.prisonerHistory||[])if(['release','hold','ransom_paid','ransom_rejected','execute'].includes(p.event))add(prisonerProcedures,p.event);
  if(cap)captureGames++;let lp=0;for(const h of Object.values(x.houses))lp+=livePrisonerCount(h);livePrisoners+=lp;if(lp)prisonerGames++;
  rows.push({seed,status:x.meta.status,round:g?.round,actions:x.meta.actionTotal,errors:x.errors.length,invalid:inv,winner:g?.leader,captures:cap,livePrisoners:lp});
}
const expected=['Отпустить пленника','Взять в плен','Требовать выкуп N','Казнить'];
const has=s=>html.toLowerCase().includes(s.toLowerCase());
if(expected.some(x=>!has(x.replace(' N',''))))findings.push({severity:'CRITICAL',id:'GM-PRISON-001',problem:'Arena не реализует полный выбор после пленения',expected});
if(!/(capturedBy|prisonerHolder|heldBy|captorHouse)/i.test(engineAuditSrc))findings.push({severity:'CRITICAL',id:'GM-PRISON-002',problem:'State пленника не хранит захвативший Дом'});
if(captures>0&&Object.values(prisonerProcedures).reduce((a,b)=>a+b,0)===0)findings.push({severity:'CRITICAL',id:'GM-COVER-001',problem:`Плен возник ${captures} раз в ${captureGames}/${games} партиях, но ни одной post-capture процедуры нет`});
if(/Выкуп 3 золота/.test(html))findings.push({severity:'HIGH',id:'GM-PRISON-003',problem:'Embedded rules всё ещё фиксируют выкуп 3 золота, что конфликтует с последним решением «Требовать выкуп N»'});
if(/alive=false;h\.ruler\.mode="ПЛЕН"/.test(engineAuditSrc)||/alive=false;c\.mode="ПЛЕН"/.test(engineAuditSrc))findings.push({severity:'HIGH',id:'GM-STATE-001',problem:'Смерть кодируется mode="ПЛЕН" при alive=false'});
if(/commanderAttack\(n,loc\).*?h\.ruler/s.test(engineAuditSrc))findings.push({severity:'HIGH',id:'GM-CMD-001',problem:'Боевой бонус командира читается только из h.ruler; другие персонажи-командиры не поддержаны полноценно'});
if(window.ARENA_DATA.version==='V5.7.2-PLAYABLE-RC3'){
  const p06=window.ARENA_DATA.events?.find(c=>c.id==='EV-P06');
  if(p06?.name!=='Съезд заложников')findings.push({severity:'CRITICAL',id:'GM-EVENT-001',problem:'RC3: EV-P06 не нормализован в «Съезд заложников»'});
  if(!engineAuditSrc.includes('Number.isInteger(raw)'))findings.push({severity:'HIGH',id:'GM-RANSOM-N-001',problem:'RC3: отсутствует строгая проверка положительного целого N'});
  if(engineAuditSrc.includes('дополнительная цена казни'))findings.push({severity:'HIGH',id:'GM-EVENT-EXEC-001',problem:'RC3: остался дополнительный штраф казни при «Съезде заложников»'});
  if(!engineAuditSrc.includes("if(choice==='hold')return this.detainPrisoner"))findings.push({severity:'HIGH',id:'GM-HOLD-001',problem:'RC3: прямой hold не использует канонический detention pipeline'});
}
for(const [k,label] of [['raids','Набег'],['births','Рождения'],['capitalCaptures','Захват столиц']])if((metrics[k]||0)===0)findings.push({severity:'MEDIUM',id:'GM-DEAD-'+k.toUpperCase(),problem:`${label}: нулевое покрытие в ${games} партиях`});
if((relations['Династический союз']||0)===0)findings.push({severity:'MEDIUM',id:'GM-DEAD-DYNASTIC',problem:`Династический союз не появился ни разу в ${games} партиях`});
const houseSummary=Object.fromEntries(H.map(h=>[h,{wins:wins[h],winRate:+(wins[h]*100/games).toFixed(1),avgScore:+(sum[h].score/games).toFixed(2),avgInfluence:+(sum[h].influence/games).toFixed(2),avgGold:+(sum[h].gold/games).toFixed(2)}]));
const out={game:'Жестокий Век',version:window.ARENA_DATA.version,gameMaster:'Rule Auditor v2',enginePatchesExecuted:enginePatches.length,games,seeds:[startSeed,startSeed+games-1],confirmedPrisonerChoices:expected,structural:{finished,round6,actions108,errorGames,invalid,peakInfluence},coverage:{captures,captureGames,livePrisoners,prisonerGames,prisonerProcedures,metrics,relations,fates,actions},houseSummary,findings,rows};
console.log(JSON.stringify(out,null,2));
