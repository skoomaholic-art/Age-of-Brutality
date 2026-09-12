(()=>{'use strict';
const E=window.ArenaEngine;if(!E)return;const P=E.prototype;
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const deep=v=>JSON.parse(JSON.stringify(v));
const houseNames=e=>e.data.houses.map(h=>h.name);
const adviserType=row=>String(row?.['Тип']||row?.type||'');
P.initPhysicalComponents=function(){
 const physical=[];
 for(const row of this.data.advisors||[]){const type=adviserType(row),copies=Math.max(1,Math.trunc(n(row?.['Копий'],2)));for(let i=1;i<=copies;i++)physical.push({physicalId:`ADV:${type}:${i}`,type,row:deep(row)})}
 this.advisorDeck=this.shuffle(physical);this.advisorMarket=this.advisorDeck.splice(0,Math.min(4,this.advisorDeck.length));
 const cats=['Война','Власть','Династия'],pools=Object.fromEntries(cats.map(c=>[c,this.shuffle((this.data.ambitions||[]).filter(a=>String(a['Категория'])===c))]));
 houseNames(this).forEach((h,i)=>{const offer=cats.map(c=>pools[c][i]).filter(Boolean);this.houses[h].ambitionOffer=deep(offer);if(offer.length)this.houses[h].ambition=deep(offer[Math.floor(this.rand()*offer.length)])});
 this.log('setup','Физические компоненты подготовлены',{advisorDeck:this.advisorDeck.length,advisorMarket:this.advisorMarket.map(x=>x.physicalId),ambitionsDealt:houseNames(this).reduce((s,h)=>s+(this.houses[h].ambitionOffer?.length||0),0)});
};
const _reset=P.reset;P.reset=function(seed=57001,rounds=6){_reset.call(this,seed,rounds);this.initPhysicalComponents();return this.exportData()};
const _legal=P.legalActions;P.legalActions=function(h){const out=_legal.call(this,h).filter(a=>a.type!=='adviser'),hs=this.houses[h],cost=n(this.stateFlags.adviserCost,2),owned=new Set((hs.advisers||[]).map(adviserType));if(hs.gold>=Math.max(1,cost)){const seen=new Set();for(const c of this.advisorMarket||[]){if(seen.has(c.type)||owned.has(c.type))continue;seen.add(c.type);out.push({id:`ADVISER:${c.physicalId}`,type:'adviser',label:`Нанять Советника: ${c.type}`,adviserType:c.type,physicalId:c.physicalId,cost,baseScore:4,legal:true})}}return out};
const _adviser=P.doAdviser;P.doAdviser=function(h,a){const idx=(this.advisorMarket||[]).findIndex(c=>c.physicalId===a.physicalId&&c.type===a.adviserType);if(idx<0)throw new Error('Adviser is not in physical market');_adviser.call(this,h,a);const card=this.advisorMarket.splice(idx,1)[0],added=this.houses[h].advisers[this.houses[h].advisers.length-1];if(added)added.physicalId=card.physicalId;if(this.advisorDeck.length)this.advisorMarket.push(this.advisorDeck.shift());this.log('component',`${h}: советник ${card.type} перемещён с рынка к Дому`,{house:h,physicalId:card.physicalId,market:this.advisorMarket.map(x=>x.physicalId)});return{valid:true}};
P.chooseAmbition=function(h,cardId){const hs=this.houses[h],offer=hs?.ambitionOffer||[],card=offer.find(a=>String(a.CARD_ID)===String(cardId));if(!card)return{valid:false};hs.ambition=deep(card);this.log('setup',`${h}: выбрана Амбиция ${card['Название']||card.CARD_ID}`,{house:h,cardId:card.CARD_ID});return{valid:true}};
const _export=P.exportData;P.exportData=function(){const x=_export.call(this);x.physicalComponents={advisorDeckCount:(this.advisorDeck||[]).length,advisorMarket:deep(this.advisorMarket||[]),ambitionOffers:Object.fromEntries(houseNames(this).map(h=>[h,deep(this.houses[h].ambitionOffer||[])]))};return x};
if(window.arenaEngine&&!window.arenaEngine.advisorMarket)window.arenaEngine.initPhysicalComponents();
window.ARENA_V572_CURRENT_PATCH_PHYSICAL={advisorDeck:true,advisorMarket:true,uniqueAmbitionDeal:true};
})();
