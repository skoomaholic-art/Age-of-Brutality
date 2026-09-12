(()=>{'use strict';
const DATA=window.ARENA_DATA;
const HOUSES=DATA.houses.map(h=>h.name);
const CAPS=DATA.map.capitals;
const PORTS=new Set(DATA.map.ports||[]);
const TERR_META=Object.fromEntries((DATA.map.territoryMeta||[]).map(t=>[t.id,t]));
const PARAM=DATA.params||{};
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const deep=v=>JSON.parse(JSON.stringify(v));
const capOwner=Object.fromEntries(Object.entries(CAPS).map(([h,id])=>[id,h]));
const prefixOwner=Object.fromEntries(Object.entries(CAPS).map(([h,id])=>[id.split('-')[0],h]));
function field(r,...keys){for(const k of keys)if(r&&r[k]!=null&&r[k]!=="")return r[k];return null}
function charFromRow(r,mode='ДВОР'){return{uid:String(field(r,'ID','CHARACTER_ID')||`${field(r,'Дом/резерв')||'X'}:${field(r,'Имя')||'Character'}`),name:String(field(r,'Имя')||'Персонаж'),house:String(field(r,'Дом/резерв')||''),type:String(field(r,'Тип')||''),attack:num(field(r,'Атк.')),defense:num(field(r,'Защ.')),survival:num(field(r,'Выж.')),diplomacy:num(field(r,'Дип.')),intrigue:num(field(r,'Интр.')),management:num(field(r,'Упр.')),alive:true,health:'Здоров',mode,heldBy:null,captiveLocation:null,ransomOffer:null,ransomResponse:null,armyLocation:null,spouseOf:null,youngPhases:0,original:true}}
class ArenaEngine{
 constructor(data){this.data=data;this.land=this.graph(data.map.land_edges||[]);this.sea=this.graph(data.map.sea_edges||[]);this.reset(57001,6)}
 graph(edges){const g={};for(const[a,b]of edges){(g[a]??=[]).push(b);(g[b]??=[]).push(a)}return g}
 reset(seed=57001,rounds=6){
  this.seed=Number(seed)||57001;this.rngState=this.seed>>>0;this.rounds=Math.max(1,Math.min(6,Number(rounds)||6));this.round=0;this.turnIndex=0;this.roundTurns=[];this.status='playing';this.actionTotal=0;this.errors=[];this.logs=[];this.relationships=[];this.prisonerHistory=[];this.stateFlags={};this.eventDeck=this.shuffle((this.data.events||[]).map(e=>e.id));this.eventPos=0;
  this.metrics={total:{invalidActions:0,neutralCaptures:0,battles:0,pvpWins:0,raids:0,births:0,capitalCaptures:0,fortsBuilt:0,pacts:0,dynasticAlliances:0,accessRights:0,prisonerCaptures:0,ransoms:0,executions:0,releases:0}};
  this.territories={};for(const id of this.data.map.territories){const owner=capOwner[id]||null;this.territories[id]={id,type:TERR_META[id]?.type||null,resistance:TERR_META[id]?.resistance,owner,fort:false,fortOwner:null,units:{}};if(owner)this.territories[id].units[owner]=num(PARAM.START_WARRIORS,4)}
  this.houses={};for(const hd of this.data.houses){const name=hd.name,rows=(this.data.characters||[]).filter(r=>field(r,'Дом/резерв')===name);const rr=rows.find(r=>field(r,'Тип')==='Правитель')||rows[0],children=rows.filter(r=>field(r,'Тип')==='Законный ребёнок');const heirRow=children.find(r=>String(field(r,'Стартовый статус')).includes('Взрослый'))||children[0];const rulerMode=String(hd.ability||'').includes('СТАРТ: АРМИЯ')?'АРМИЯ':'ДВОР';const ruler=charFromRow(rr,rulerMode);if(rulerMode==='АРМИЯ')ruler.armyLocation=CAPS[name];const heir=charFromRow(heirRow,'ДВОР');const reserve=children.filter(r=>r!==heirRow).map(r=>{const c=charFromRow(r,'РЕЗЕРВ');c.alive=false;c.health='Резерв';c.activated=false;return c});
   this.houses[name]={name,gold:num(PARAM.START_GOLD,8),influence:num(PARAM.START_INFLUENCE,3),score:0,influenceSpent:0,ruler,heir,spouse:null,reserveChildren:reserve,activeYoung:[],knownBastards:[],legitimizedBastards:[],advisers:[],regency:false,reserved:0,turnsTaken:0,fortsBuilt:0,neutralMarriage:false,dynastyActions:new Set(),roundFlags:{},achievements:{neutral:false,pvp:false,capitalA:false,capitalB:false,power1:false,power2:false,birth:false,threeChildren:false,pact:false,dynastic:false,threeRelations:false},pendingCapitalHold:null,pvpWins:0,defeatedHouses:new Set(),survivedRelationPartners:new Set(),ambition:this.pickAmbition(name)};
  }
  this.startRound();return this.exportData()
 }
 rand(){this.rngState=(Math.imul(1664525,this.rngState)+1013904223)>>>0;return this.rngState/4294967296}
 d6(){return 1+Math.floor(this.rand()*6)}
 d2d6(){return this.d6()+this.d6()}
 shuffle(arr){arr=[...arr];for(let i=arr.length-1;i>0;i--){const j=Math.floor(this.rand()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]]}return arr}
 pickAmbition(house){const cats=['Война','Власть','Династия'];const offered=cats.map(c=>this.shuffle((this.data.ambitions||[]).filter(a=>field(a,'Категория')===c))[0]).filter(Boolean);return offered.length?deep(offered[Math.floor(this.rand()*offered.length)]):null}
 snapshot(){return{round:this.round,houses:Object.fromEntries(HOUSES.map(h=>[h,{gold:this.houses[h].gold,influence:this.houses[h].influence,score:this.houses[h].score}]))}}
 log(kind,detail,extra={}){this.logs.push({round:this.round,kind,detail,...extra})}
 logAction(house,action,before,meta={}){this.logs.push({round:this.round,kind:'action',house,action,detail:meta.detail||action,before,after:this.snapshot(),meta})}
 startRound(){
  this.round++;this.stateFlags={event:null,hostageCongress:false,ransomFixed:null,incomeGoldMod:0,recruitExtraCost:0,adviserCost:null,birthGoldCost:1,pactDiscount:0,dynasticDiscount:0,neutralMarriageDiscount:0,fortDefenseBonus:0};
  for(const h of HOUSES){const hs=this.houses[h];hs.turnsTaken=0;hs.reserved=0;hs.roundFlags={recruited:false,drew:false,born:false,raided:false,cheapRecruit:false,pactDiscount:false,dynasticDiscount:false,neutralMarriageDiscount:false,pvpAttacks:0,warBoost:false,defBoost:false,seaAttempt:false};for(const c of this.allCharacters(h))if(c.alive&&c.health!=='Мёртв')c.usedCourt=false}
  this.updateRelationsAtRoundStart();
  const eventId=this.eventDeck[this.eventPos++%this.eventDeck.length],event=this.data.events.find(e=>e.id===eventId);this.stateFlags.event=eventId;this.applyEvent(event);
  this.incomePhase();
  const first=(this.round-1)%HOUSES.length,order=[...HOUSES.slice(first),...HOUSES.slice(0,first)];this.roundTurns=[];for(let cycle=0;cycle<3;cycle++)this.roundTurns.push(...order);this.turnIndex=0;
  this.log('phase',`Начат раунд ${this.round}`,{event:event?.name||eventId})
 }
 applyEvent(card){
  if(!card)return;
  const id=card.id;this.log('event',card.name,{eventId:id});
  if(id==='EV-E01')this.stateFlags.incomeGoldMod=-1;
  else if(id==='EV-E02')this.stateFlags.incomeGoldMod=1;
  else if(id==='EV-E03')this.stateFlags.recruitExtraCost=1;
  else if(id==='EV-E08')this.stateFlags.adviserCost=3;
  else if(id==='EV-P01')this.stateFlags.pactDiscount=1;
  else if(id==='EV-P04')this.stateFlags.breakExtraInfluence=1;
  else if(id==='EV-P05')this.stateFlags.dynasticDiscount=1;
  else if(id==='EV-P06'){this.stateFlags.hostageCongress=true;this.stateFlags.ransomFixed=2}
  else if(id==='EV-W02')this.stateFlags.fortDefenseBonus=1;
  else if(id==='EV-D01')this.stateFlags.birthGoldCost=0;
  else if(id==='EV-D06')this.stateFlags.neutralMarriageDiscount=1;
  else if(id==='EV-C02'){this.stateFlags.incomeGoldMod=-2;this.stateFlags.recruitExtraCost=1}
  else if(id==='EV-E06'){const max=Math.max(...HOUSES.map(h=>this.houses[h].gold));for(const h of HOUSES)if(this.houses[h].gold===max)this.houses[h].gold=Math.max(0,this.houses[h].gold-2)}
  else if(id==='EV-P02'){const max=Math.max(...HOUSES.map(h=>this.houses[h].influence));for(const h of HOUSES)if(this.houses[h].influence===max)this.houses[h].influence=Math.max(0,this.houses[h].influence-1)}
  else if(id==='EV-P07'){for(const h of HOUSES)if(this.activeOfficialRelations(h)>=2)this.houses[h].influence++}
  else if(id==='EV-W07'){for(const h of HOUSES)if(this.totalWarriors(h)>=10){const loc=this.ownedUnitLocations(h)[0];if(loc)this.territories[loc].units[h]=Math.max(0,num(this.territories[loc].units[h])-1)}}
  else if(id==='EV-D02'){for(const h of HOUSES){const pool=this.allCharacters(h).filter(c=>c.alive&&c.mode==='ДВОР'&&c.health==='Здоров');if(pool.length)this.resolveDisease(h,pool[Math.floor(this.rand()*pool.length)],0)}}
  else if(id==='EV-C01'){for(const h of HOUSES){const c=this.houses[h].ruler;if(c?.alive)this.resolveDisease(h,c,-1)}}
 }
 resolveDisease(house,c,mod){const roll=this.d2d6()+num(mod);if(roll>=7)return;if(c.health==='Ослаблен')this.killCharacter(house,c,'болезнь');else c.health='Ослаблен'}
 terrainRow(id){return TERR_META[id]||{}}
 economyRow(type){return(this.data.economy||[]).find(r=>String(r.ID)===String(type))}
 parseIncome(text){text=String(text??'');const gold=Number((text.match(/([+-]?\d+)\s*золот/i)||[])[1]||0),infl=Number((text.match(/([+-]?\d+)\s*Влия/i)||[])[1]||0);return{gold,influence:infl}}
 homeHouseFor(id){return capOwner[id]||prefixOwner[String(id).split('-')[0]]||null}
 incomeFor(id,owner){const t=this.territories[id],type=t.type,row=this.economyRow(type);if(!row)return{gold:0,influence:0};const native=this.homeHouseFor(id)===owner||id.startsWith('S');return this.parseIncome(native?row['Доход владельца']:row['Доход оккупанта'])}
 incomePhase(){for(const h of HOUSES){let gold=0,influence=0;for(const t of Object.values(this.territories))if(t.owner===h){const x=this.incomeFor(t.id,h);gold+=x.gold;influence+=x.influence}for(let i=1;i<=5;i++){const a=`S0${i}-A`,b=`S0${i}-B`;if(this.territories[a]?.owner===h&&this.territories[b]?.owner===h){const x=this.parseIncome(this.economyRow(`S0${i}`)?.['Доход владельца']);gold+=x.gold;influence+=x.influence}}
   gold=Math.max(0,gold+num(this.stateFlags.incomeGoldMod));this.houses[h].gold+=gold;this.houses[h].influence=Math.max(0,this.houses[h].influence+influence);this.log('income',`${h}: +${gold} золота, +${influence} Влияния`,{house:h,gold,influence})}
 }
 allCharacters(h){const x=this.houses[h],arr=[x.ruler,x.heir,x.spouse,...(x.reserveChildren||[]),...(x.activeYoung||[]),...(x.knownBastards||[]),...(x.legitimizedBastards||[])];const seen=new Set();return arr.filter(c=>c&&!seen.has(c.uid)&&(seen.add(c.uid),true))}
 ownedUnitLocations(h){return Object.values(this.territories).filter(t=>num(t.units[h])>0).map(t=>t.id)}
 totalWarriors(h){return Object.values(this.territories).reduce((s,t)=>s+num(t.units[h]),0)}
 totalTerritories(h){return Object.values(this.territories).filter(t=>t.owner===h).length}
 activeOfficialRelations(h){return this.relationships.filter(r=>r.active&&(r.kind==='Официальный Пакт'||r.kind==='Династический союз')&&(r.a===h||r.b===h)).length}
 relationBetween(a,b,kinds=null){return this.relationships.find(r=>r.active&&(r.a===a&&r.b===b||r.a===b&&r.b===a)&&(!kinds||kinds.includes(r.kind)))||null}
 hasAccess(a,b){return Boolean(this.relationBetween(a,b,['Право прохода']))}
 hostileBlocked(a,b){return Boolean(this.relationBetween(a,b,['Официальный Пакт','Династический союз']))}
 remainingPartnerSlots(h){return Math.max(0,3-this.houses[h].turnsTaken-this.houses[h].reserved)}
 spendInfluence(h,n,reason){const hs=this.houses[h];if(hs.influence<n)return false;hs.influence-=n;hs.influenceSpent+=n;this.log('resource',`${h}: -${n} Влияния (${reason})`,{house:h});return true}
 spendGold(h,n,reason){const hs=this.houses[h];if(hs.gold<n)return false;hs.gold-=n;this.log('resource',`${h}: -${n} золота (${reason})`,{house:h});return true}
 currentHouse(){return this.status==='playing'?this.roundTurns[this.turnIndex]||null:null}
 beginOwnAction(h){
  const hs=this.houses[h];const p=hs.pendingCapitalHold;if(p){if(this.territories[p.territory]?.owner===h&&!hs.achievements.capitalB){hs.score+=1;hs.achievements.capitalB=true;this.log('vp',`${h}: +1 ОП за удержание столицы`,{house:h})}hs.pendingCapitalHold=null}
  if(!this.commanderAt(h,CAPS[h])){const c=this.allCharacters(h).filter(c=>c.alive&&c.health==='Здоров'&&c.mode==='ДВОР'&&(c.type==='Правитель'||c.type==='Законный ребёнок')).sort((a,b)=>(b.attack+b.defense)-(a.attack+a.defense))[0];if(c&&num(this.territories[CAPS[h]]?.units[h])>0){const inArmy=this.allCharacters(h).filter(x=>x.alive&&x.mode==='АРМИЯ').length;if(inArmy<2){c.mode='АРМИЯ';c.armyLocation=CAPS[h];this.log('commander',`${h}: ${c.name} назначен командиром в ${CAPS[h]}`,{house:h,character:c.uid})}}}
 }
 commanderAt(h,loc){return this.allCharacters(h).find(c=>c.alive&&c.mode==='АРМИЯ'&&c.armyLocation===loc)||null}
 neighbors(id){return[...(this.land[id]||[]),...(this.sea[id]||[])]}
 landPaths(h,source){
  const out=[];const q=[[source,[source]]];const seen=new Map([[source,0]]);
  while(q.length){const[cur,path]=q.shift(),d=path.length-1;if(d>=2)continue;for(const nx of this.land[cur]||[]){if(path.includes(nx))continue;const t=this.territories[nx],owner=t.owner;const np=[...path,nx];if(owner===h||owner&&this.hasAccess(h,owner)){if(d+1<2){const prior=seen.get(nx);if(prior==null||prior>d+1){seen.set(nx,d+1);q.push([nx,np])}}continue}out.push(np)}}
  return out
 }
 marchCandidates(h){
  const acts=[];for(const source of this.ownedUnitLocations(h)){const count=num(this.territories[source].units[h]);if(count<=0)continue;const paths=this.landPaths(h,source);if(PORTS.has(source)&&this.territories[source].owner===h)for(const dest of this.sea[source]||[])paths.push([source,dest]);
   for(const route of paths){const dest=route[route.length-1],t=this.territories[dest],owner=t.owner;if(owner&&owner!==h&&this.hostileBlocked(h,owner))continue;const max=Math.min(count,num(PARAM.TERRITORY_WARRIOR_CAP,8));for(const amount of [Math.min(3,max)].filter(n=>n>0)){const ownership=!owner?'neutral':owner===h?'self':'enemy';const target={ownership,income:this.targetIncomeValue(dest,h),resistance:num(t.resistance,0),defenders:owner&&owner!==h?num(t.units[owner]):0,recaptureHome:this.homeHouseFor(dest)===h&&owner!==h,recaptureCapital:CAPS[h]===dest&&owner!==h,completesIsland:this.completesIsland(h,dest),firstCenterHalf:dest.startsWith('S')&&!this.controlsAnyIslandHalf(h),isMainlandPort:PORTS.has(dest)&&!dest.startsWith('S'),isEnemyCapital:Boolean(capOwner[dest]&&capOwner[dest]!==h)};
     acts.push({id:`MARCH:${source}:${dest}:${amount}`,type:'march',label:`Марш ${source} → ${dest} (${amount})`,route,source,dest,amount,target,scoreComponents:{force:amount/2},legal:true})}}
  }return acts
 }
 targetIncomeValue(id,h){const row=this.economyRow(this.territories[id].type);const txt=row?.['Доход владельца'];return this.parseIncome(txt).gold+this.parseIncome(txt).influence}
 controlsAnyIslandHalf(h){return Object.values(this.territories).some(t=>t.id.startsWith('S')&&t.owner===h)}
 completesIsland(h,id){if(!id.startsWith('S'))return false;const pair=id.endsWith('-A')?id.replace('-A','-B'):id.replace('-B','-A');return this.territories[pair]?.owner===h}
 legalActions(h){
  const hs=this.houses[h],a=[];a.push(...this.marchCandidates(h));
  const cap=this.territories[CAPS[h]],total=this.totalWarriors(h),space=Math.min(num(PARAM.HOUSE_WARRIOR_CAP,12)-total,num(PARAM.TERRITORY_WARRIOR_CAP,8)-num(cap?.units[h]));const recruitCostExtra=num(this.stateFlags.recruitExtraCost);const maxRecruit=Math.min(3,space,Math.floor(hs.gold/Math.max(1,1+recruitCostExtra)));if(maxRecruit>0)a.push({id:`RECRUIT:${maxRecruit}`,type:'recruit',label:`Найм ${maxRecruit} в ${CAPS[h]}`,amount:maxRecruit,scoreComponents:{armyNeed:Math.max(0,6-total)},legal:true});
  if(hs.gold>=3&&hs.fortsBuilt<num(PARAM.OWN_FORT_CAP,2)){for(const t of Object.values(this.territories))if(t.owner===h&&!capOwner[t.id]&&!t.fort)a.push({id:`FORT:${t.id}`,type:'fort',label:`Крепость: ${t.id}`,territory:t.id,baseScore:2,legal:true})}
  const adviserCost=num(this.stateFlags.adviserCost,2);if(hs.gold>=adviserCost&&hs.advisers.length<num(PARAM.ADVISER_CAP,3)){const owned=new Set(hs.advisers.map(x=>field(x,'Тип'))),av=(this.data.advisors||[]).find(x=>!owned.has(field(x,'Тип')));if(av)a.push({id:`ADVISER:${field(av,'Тип')}`,type:'adviser',label:`Нанять Советника: ${field(av,'Тип')}`,adviserType:field(av,'Тип'),cost:adviserCost,baseScore:1,legal:true})}
  if(!hs.spouse&&hs.influence>=Math.max(0,1-num(this.stateFlags.neutralMarriageDiscount))){const pool=(this.data.characters||[]).filter(r=>field(r,'Тип')==='Нейтральный супруг');const used=new Set(HOUSES.map(x=>this.houses[x].spouse?.uid).filter(Boolean)),r=pool.find(x=>!used.has(String(field(x,'ID'))));if(r)a.push({id:`MARR-NEUT:${field(r,'ID')}`,type:'neutralMarriage',label:`Нейтральный брак: ${field(r,'Имя')}`,characterId:field(r,'ID'),baseScore:this.round<=2?9:3,legal:true})}
  if(hs.spouse&&!hs.roundFlags.born&&hs.gold>=num(this.stateFlags.birthGoldCost,1)&&this.legalChildrenAlive(h)<3)a.push({id:'BIRTH',type:'birth',label:'Продолжить род',baseScore:11,legal:true});
  for(const other of HOUSES){if(other===h)continue;const oh=this.houses[other];if(this.remainingPartnerSlots(other)<=0)continue;if(!this.relationBetween(h,other,['Официальный Пакт'])&&hs.influence>=Math.max(0,1-num(this.stateFlags.pactDiscount))&&oh.influence>=1)a.push({id:`PACT:${other}`,type:'pact',label:`Официальный Пакт с ${other}`,other,diplomacy:{officialRelationDelta:1},baseScore:this.round<=3?4:1,legal:true});
    if(!this.relationBetween(h,other,['Династический союз'])&&!this.hasDynasticMarriage(h,other)&&hs.influence>=Math.max(0,1-num(this.stateFlags.dynasticDiscount))&&oh.influence>=1&&this.freeDynasticCharacter(h)&&this.freeDynasticCharacter(other))a.push({id:`DYNASTIC:${other}`,type:'dynastic',label:`Династический брак с ${other}`,other,diplomacy:{officialRelationDelta:1},baseScore:this.round<=2?10:3,legal:true});
    if(!this.relationBetween(h,other,['Право прохода']))a.push({id:`ACCESS:${other}`,type:'access',label:`Право прохода: ${other}`,other,baseScore:1,legal:true});
  }
  for(const m of this.marchCandidates(h)){const owner=this.territories[m.dest].owner;if(owner&&owner!==h&&num(this.territories[m.dest].units[owner])>0&&!hs.roundFlags.raided){a.push({...m,id:`RAID:${m.source}:${m.dest}:${m.amount}`,type:'raid',label:`Набег ${m.source} → ${m.dest}`,baseScore:this.round>=3?4:0})}}
  for(const c of this.allCharacters(h).filter(c=>c.alive&&c.mode==='ПЛЕН'&&c.heldBy===h)){void c}
  return a
 }
 legalChildrenAlive(h){return[this.houses[h].heir,...this.houses[h].reserveChildren,...this.houses[h].activeYoung].filter(c=>c?.alive).length}
 freeDynasticCharacter(h){return this.allCharacters(h).find(c=>c.alive&&c.health!=='Мёртв'&&c.type==='Законный ребёнок'&&!c.spouseOf&&c.mode!=='ПЛЕН')}
 hasDynasticMarriage(a,b){return Boolean(this.relationBetween(a,b,['Династический союз']))}
 step(actionId=null){
  if(this.status!=='playing')return this.exportData();const h=this.currentHouse();if(!h){this.errors.push('No current house while playing');this.status='error';return this.exportData()}
  const hs=this.houses[h],before=this.snapshot();this.beginOwnAction(h);
  try{
   if(hs.reserved>0){hs.reserved--;this.logAction(h,'Зарезервированное действие',before,{detail:'Действие зарезервировано двусторонней дипломатией'})}
   else{const legal=this.legalActions(h);let action=null,decision=null;if(actionId){action=legal.find(a=>a.id===actionId);if(!action){this.metrics.total.invalidActions++;throw new Error(`Illegal manual action ${actionId} for ${h}`)}}else{const agent=new window.ArenaHouseAgent(h,this.data.aiConfig);decision=agent.decide({round:this.round,legalActions:legal,activeOfficialRelations:this.activeOfficialRelations(h)});action=decision.decision}
    if(!action)this.logAction(h,'Пропуск',before,{detail:'Нет законных действий'});
    else{this.applyAction(h,action);this.logAction(h,action.label||action.type,before,{actionId:action.id,ai:decision?{decisionId:decision.decisionId,score:decision.score,reason:decision.reason}:null})}}
  }catch(err){this.errors.push(String(err.stack||err));this.metrics.total.invalidActions++;this.log('error',String(err.message||err),{house:h})}
  hs.turnsTaken++;this.actionTotal++;this.turnIndex++;
  if(this.turnIndex>=this.roundTurns.length){this.dynastyPhase();if(this.round>=this.rounds)this.finalizeGame();else this.startRound()}
  return this.exportData()
 }
 runGame(){let guard=0;while(this.status==='playing'&&guard++<200)this.step();if(guard>=200&&this.status==='playing'){this.errors.push('Runaway game guard');this.status='error'}return this.exportData()}
 applyAction(h,a){if(a.type==='recruit')return this.doRecruit(h,a);if(a.type==='fort')return this.doFort(h,a);if(a.type==='adviser')return this.doAdviser(h,a);if(a.type==='neutralMarriage')return this.doNeutralMarriage(h,a);if(a.type==='birth')return this.doBirth(h,a);if(a.type==='pact')return this.doRelation(h,a,'Официальный Пакт');if(a.type==='dynastic')return this.doDynastic(h,a);if(a.type==='access')return this.doAccess(h,a);if(a.type==='raid')return this.doMarch(h,a,true);if(a.type==='march')return this.doMarch(h,a,false);throw new Error(`Unknown action type ${a.type}`)}
 doRecruit(h,a){const extra=num(this.stateFlags.recruitExtraCost),cost=a.amount+extra;if(!this.spendGold(h,cost,'Найм'))throw new Error('Recruit cost became illegal');this.territories[CAPS[h]].units[h]=num(this.territories[CAPS[h]].units[h])+a.amount}
 doFort(h,a){const t=this.territories[a.territory];if(!t||t.owner!==h||capOwner[t.id]||t.fort||this.houses[h].fortsBuilt>=2||!this.spendGold(h,3,'Крепость'))throw new Error('Fort became illegal');t.fort=true;t.fortOwner=h;this.houses[h].fortsBuilt++;this.metrics.total.fortsBuilt++}
 doAdviser(h,a){if(!this.spendGold(h,a.cost,'Советник'))throw new Error('Adviser cost illegal');const row=(this.data.advisors||[]).find(x=>field(x,'Тип')===a.adviserType);if(row)this.houses[h].advisers.push(deep(row))}
 doNeutralMarriage(h,a){const cost=Math.max(0,1-num(this.stateFlags.neutralMarriageDiscount));if(cost&&!this.spendInfluence(h,cost,'Нейтральный брак'))throw new Error('Marriage influence illegal');const row=(this.data.characters||[]).find(r=>String(field(r,'ID'))===String(a.characterId));const c=charFromRow(row,'ДВОР');c.house=h;c.spouseOf=this.houses[h].ruler.uid;this.houses[h].spouse=c;this.houses[h].neutralMarriage=true;this.houses[h].dynastyActions.add('брак')}
 doBirth(h,a){const hs=this.houses[h],cost=num(this.stateFlags.birthGoldCost,1);if(cost&&!this.spendGold(h,cost,'Продолжить род'))throw new Error('Birth gold illegal');const c=hs.reserveChildren.find(x=>!x.activated);if(!c)throw new Error('No canonical reserve child available');c.activated=true;c.alive=true;c.health='Здоров';c.mode='ДВОР';c.young=true;c.youngPhases=0;if(!hs.activeYoung.some(x=>x.uid===c.uid))hs.activeYoung.push(c);hs.roundFlags.born=true;hs.dynastyActions.add('Продолжить род');this.metrics.total.births++;if(!hs.achievements.birth){hs.score++;hs.achievements.birth=true;this.log('vp',`${h}: +1 ОП за первого рождённого законного ребёнка`,{house:h})}}
 doRelation(h,a,kind){const other=a.other,oh=this.houses[other],discount=kind==='Официальный Пакт'?num(this.stateFlags.pactDiscount):0,cost=Math.max(0,1-discount);if(cost&&!this.spendInfluence(h,cost,kind))throw new Error('Relation cost illegal');if(!this.spendInfluence(other,1,kind))throw new Error('Partner relation cost illegal');oh.reserved++;this.relationships.push({id:`${kind}:${h}:${other}:${this.round}:${this.actionTotal}`,kind,a:h,b:other,active:true,createdRound:this.round,fullRounds:0,rewarded:{[h]:false,[other]:false}});if(kind==='Официальный Пакт')this.metrics.total.pacts++}
 doDynastic(h,a){const other=a.other,c1=this.freeDynasticCharacter(h),c2=this.freeDynasticCharacter(other);if(!c1||!c2)throw new Error('Dynastic characters unavailable');const cost=Math.max(0,1-num(this.stateFlags.dynasticDiscount));if(cost&&!this.spendInfluence(h,cost,'Династический брак'))throw new Error('Dynastic cost illegal');if(!this.spendInfluence(other,1,'Династический брак'))throw new Error('Partner dynastic cost illegal');this.houses[other].reserved++;c1.spouseOf=c2.uid;c2.spouseOf=c1.uid;this.houses[h].dynastyActions.add('династический брак');this.houses[other].dynastyActions.add('династический брак');this.relationships.push({id:`DYN:${h}:${other}:${this.round}:${this.actionTotal}`,kind:'Династический союз',a:h,b:other,active:true,createdRound:this.round,fullRounds:0,rewarded:{[h]:false,[other]:false},characters:[c1.uid,c2.uid]});this.metrics.total.dynasticAlliances++}
 doAccess(h,a){this.relationships.push({id:`ACCESS:${h}:${a.other}:${this.round}:${this.actionTotal}`,kind:'Право прохода',a:h,b:a.other,active:true,createdRound:this.round,fullRounds:0,rewarded:{}});this.metrics.total.accessRights++;if(this.stateFlags.event==='EV-P03'&&!this.houses[a.other].roundFlags.accessReward){this.houses[a.other].influence++;this.houses[a.other].roundFlags.accessReward=true}}
 doMarch(h,a,raid=false){
  const source=this.territories[a.source],dest=this.territories[a.dest],amount=Math.min(a.amount,num(source.units[h]));if(amount<=0)throw new Error('No marching units');const owner=dest.owner;
  if(!owner){source.units[h]-=amount;const success=this.d2d6()+amount>7+num(dest.resistance,0);if(success){dest.owner=h;dest.units[h]=num(dest.units[h])+amount;this.metrics.total.neutralCaptures++;if(!this.houses[h].achievements.neutral){this.houses[h].score++;this.houses[h].achievements.neutral=true;this.log('vp',`${h}: +1 ОП за первый нейтральный захват`,{house:h})}this.moveCommanderWithArmy(h,a.source,a.dest)}else{const loss=Math.min(1,amount);source.units[h]+=amount-loss;this.log('battle',`${h} не захватывает ${a.dest}; потеря ${loss}`,{house:h})}return}
  if(owner===h){source.units[h]-=amount;dest.units[h]=num(dest.units[h])+amount;this.moveCommanderWithArmy(h,a.source,a.dest);return}
  if(this.hostileBlocked(h,owner))throw new Error('Attack forbidden by official relation');
  return this.resolvePvp(h,owner,a,raid)
 }
 moveCommanderWithArmy(h,source,dest){const c=this.commanderAt(h,source);if(c)c.armyLocation=dest}
 baseDefense(t){if(capOwner[t.id])return 5;let b=t.type==='CITY'?2:t.type==='VILLAGE'?1:0;if(t.fort)b=Math.max(b,3+num(this.stateFlags.fortDefenseBonus));return b}
 support(h,target,exclude){return(this.land[target]||[]).some(id=>id!==exclude&&this.territories[id]?.owner===h&&num(this.territories[id]?.units[h])>0)?1:0}
 resolvePvp(attacker,defender,a,raid){
  const s=this.territories[a.source],t=this.territories[a.dest],amount=Math.min(a.amount,num(s.units[attacker])),defenders=num(t.units[defender]);if(defenders<=0){s.units[attacker]-=amount;t.owner=attacker;t.units[attacker]=num(t.units[attacker])+amount;this.moveCommanderWithArmy(attacker,a.source,a.dest);this.onCaptureTerritory(attacker,defender,t);return}
  const ac=this.commanderAt(attacker,a.source),dc=this.commanderAt(defender,a.dest),as=amount+this.d6()+num(ac?.attack)+this.support(attacker,a.dest,a.source),ds=defenders+this.d6()+num(dc?.attack)+this.support(defender,a.dest,null),attackerWins=as>ds;
  const ad=num(ac?.defense),dd=this.baseDefense(t)+num(dc?.defense),damageToDef=Math.max(0,Math.ceil(as/2)-dd),damageToAtk=Math.max(0,Math.ceil(ds/2)-ad),atkSurv=Math.max(0,amount-damageToAtk),defSurv=Math.max(0,defenders-damageToDef);
  this.metrics.total.battles++;this.houses[attacker].roundFlags.pvpAttacks++;
  if(attackerWins)this.recordPvpWin(attacker,defender);else this.recordPvpWin(defender,attacker);
  if(raid){this.metrics.total.raids++;this.houses[attacker].roundFlags.raided=true;if(attackerWins&&atkSurv>0){const loot=Math.min(2,this.houses[defender].gold);this.houses[defender].gold-=loot;this.houses[attacker].gold+=loot}s.units[attacker]=num(s.units[attacker])-amount+atkSurv;t.units[defender]=defSurv;if(!attackerWins&&ac)this.resolveFate(attacker,ac,defender,atkSurv===0,a.dest);if(attackerWins&&dc)this.resolveFate(defender,dc,attacker,defSurv===0,a.dest);return}
  if(attackerWins&&atkSurv>0){s.units[attacker]=num(s.units[attacker])-amount;t.units[defender]=0;t.units[attacker]=num(t.units[attacker])+atkSurv;t.owner=attacker;this.moveCommanderWithArmy(attacker,a.source,a.dest);if(defSurv>0)this.retreatSurvivors(defender,a.dest,defSurv);if(dc)this.resolveFate(defender,dc,attacker,defSurv===0,a.dest);this.onCaptureTerritory(attacker,defender,t)}
  else{s.units[attacker]=num(s.units[attacker])-amount+atkSurv;t.units[defender]=defSurv;if(ac)this.resolveFate(attacker,ac,defender,atkSurv===0,a.dest)}
  this.log('battle',`${attacker} ${attackerWins?'побеждает':'проигрывает'} ${defender} в ${a.dest}`,{attacker,defender,attackerStrength:as,defenderStrength:ds,damageToDef,damageToAtk})
 }
 retreatSurvivors(h,from,count){for(const id of this.land[from]||[]){const t=this.territories[id];if(t.owner===h&&num(t.units[h])+count<=num(PARAM.TERRITORY_WARRIOR_CAP,8)){t.units[h]=num(t.units[h])+count;return}}}
 recordPvpWin(winner,loser){const hs=this.houses[winner];hs.pvpWins++;hs.defeatedHouses.add(loser);this.metrics.total.pvpWins++;if(!hs.achievements.pvp){hs.score++;hs.achievements.pvp=true;this.log('vp',`${winner}: +1 ОП за первую PvP-победу`,{house:winner})}}
 onCaptureTerritory(h,former,t){if(capOwner[t.id]&&capOwner[t.id]!==h){const hs=this.houses[h];if(!hs.achievements.capitalA){hs.score++;hs.achievements.capitalA=true;this.metrics.total.capitalCaptures++;hs.pendingCapitalHold={territory:t.id};this.log('vp',`${h}: +1 ОП за первый захват столицы`,{house:h,territory:t.id})}}}
 resolveFate(owner,c,captor,fullDestroyed,location){const total=this.d2d6()+num(c.survival)-(fullDestroyed?1:0);let fate='';if(total>=10)fate='Спасён';else if(total>=7){fate='Ослаблен';c.health='Ослаблен';c.mode='ДВОР';c.armyLocation=null}else if(total>=5){fate='Плен';this.captureCharacter(owner,c,captor,location)}else{fate='Смерть';this.killCharacter(owner,c,'Судьба после боя')}this.log('fate',`${c.name}: ${fate}`,{house:owner,meta:{fate:`${fate} (${total})`}})}
 captureCharacter(owner,c,captor,location){c.alive=true;c.mode='ПЛЕН';c.heldBy=captor;c.armyLocation=null;c.captiveLocation=location;c.ransomOffer=null;c.ransomResponse=null;this.metrics.total.prisonerCaptures++;this.logPrisoner('capture',owner,c,captor,{location,detail:`${c.name} (${owner}) попал в плен к ${captor}`});this.resolvePrisonerAI(owner,c,captor,location)}
 nearestDetentionLocations(captor,from){const forts=Object.values(this.territories).filter(t=>t.owner===captor&&t.fort&&t.fortOwner===captor).map(t=>t.id);if(!forts.length)return[CAPS[captor]];const q=[[from,0]],seen=new Set([from]);let best=Infinity,out=[];while(q.length){const[cur,d]=q.shift();if(d>best)continue;if(forts.includes(cur)){if(d<best){best=d;out=[cur]}else if(d===best)out.push(cur);continue}for(const nx of this.neighbors(cur))if(!seen.has(nx)){seen.add(nx);q.push([nx,d+1])}}return out.length?out:[CAPS[captor]]}
 detainPrisoner(owner,c,captor,from,choice=null){const locs=this.nearestDetentionLocations(captor,from||c.captiveLocation||CAPS[captor]),loc=choice&&locs.includes(choice)?choice:locs.sort()[0];c.heldBy=captor;c.captiveLocation=loc;c.mode='ПЛЕН';c.ransomOffer=null;this.logPrisoner('hold',owner,c,captor,{location:loc,detail:`${c.name} содержится: ${loc}`});return{valid:true,location:loc}}
 releasePrisoner(owner,c,captor,reason='release'){const loc=CAPS[owner];c.heldBy=null;c.captiveLocation=null;c.ransomOffer=null;c.ransomResponse=reason==='ransom'?'paid_and_released':'released';c.mode='ДВОР';c.armyLocation=null;c.returnLocation=loc;this.metrics.total.releases++;this.logPrisoner('release',owner,c,captor,{location:loc,reason,detail:`${c.name} (${owner}) освобождён и возвращается в столицу своего Дома: ${loc}`});return{valid:true,location:loc}}
 executePrisoner(owner,c,captor){const h=this.houses[captor];if(h.influence<3||this.remainingPartnerSlots(captor)<=0)return{valid:false,detail:'Казнь недоступна: требуется 1 будущий слот действия и 3 Влияния'};h.reserved++;this.spendInfluence(captor,3,'Казнь пленника');this.logPrisoner('execute',owner,c,captor,{detail:`${captor} казнит ${c.name} (${owner}); зарезервировано 1 действие, потеряно 3 Влияния`});this.metrics.total.executions++;this.killCharacter(owner,c,'казнь в плену');return{valid:true}}
 resolvePrisonerDecision(rec,choice,amount=null,response=null,detentionChoice=null){
  const c=this.characterByUid(rec.owner,rec.uid);if(!c?.alive||c.heldBy!==rec.captor)return{valid:false,detail:'Пленный более не является законной целью'};
  if(choice==='release')return this.releasePrisoner(rec.owner,c,rec.captor,'release');
  if(choice==='hold')return this.detainPrisoner(rec.owner,c,rec.captor,rec.location,detentionChoice);
  if(choice==='execute')return this.executePrisoner(rec.owner,c,rec.captor);
  if(choice!=='ransom')return{valid:false,detail:'Неизвестное решение по пленнику'};
