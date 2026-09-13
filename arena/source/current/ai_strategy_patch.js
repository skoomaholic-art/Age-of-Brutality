(()=>{'use strict';
const E=window.ArenaEngine;if(!E)return;const P=E.prototype;
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const _legal=P.legalActions;
P.legalActions=function(h){const out=_legal.call(this,h);if(h==='Тасвар'&&this.activeOfficialRelations(h)===0){for(const a of out){if(a.type==='pact'||a.type==='dynastic'){a.baseScore=Math.max(n(a.baseScore),12);a.planId='HOUSE_SURVIVAL_RELATION';a.planMatch=true;a.goalCritical=true;a.scoreComponents={...(a.scoreComponents||{}),houseWeaknessAvoided:8}}else if(a.type==='intrigueDraw'||a.type==='intrigue')a.scoreComponents={...(a.scoreComponents||{}),relationEmergencyDelay:-3}}}return out};
if(window.ArenaHouseAgent){const _decide=window.ArenaHouseAgent.prototype.decide;window.ArenaHouseAgent.prototype.decide=function(ctx={}){if(this.houseId==='Тасвар'&&Number(ctx.activeOfficialRelations||0)===0&&(ctx.legalActions||[]).some(a=>a.planId==='HOUSE_SURVIVAL_RELATION'))ctx={...ctx,activePlan:'HOUSE_SURVIVAL_RELATION'};return _decide.call(this,ctx)}}
const _dynasty=P.dynastyPhase;
P.dynastyPhase=function(){const t=this.houses['Тасвар'],s=this.houses['Сайрвен'],tasNo=this.activeOfficialRelations('Тасвар')===0,sayLow=n(s?.gold)<=2,t0=n(t?.influence),s0=n(s?.influence);const out=_dynasty.call(this);if(tasNo&&n(t?.influence)<t0)this.log('house_weakness','Тасвар: -1 Влияние — конец раунда без Официального Пакта или Династического союза',{house:'Тасвар',before:t0,after:n(t.influence),source:'HOUSE_WEAKNESS'});if(sayLow&&n(s?.influence)<s0)this.log('house_weakness','Сайрвен: -1 Влияние — конец раунда с 2 золотом или меньше',{house:'Сайрвен',before:s0,after:n(s.influence),source:'HOUSE_WEAKNESS'});return out};
window.ARENA_V572_CURRENT_PATCH_STRATEGY={tasvarRelationEmergency:true,houseWeaknessLogging:true};
})();

