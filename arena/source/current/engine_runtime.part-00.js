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
