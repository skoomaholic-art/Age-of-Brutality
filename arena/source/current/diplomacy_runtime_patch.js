(()=>{'use strict';
const E=window.ArenaEngine;if(!E)return;const P=E.prototype;
const deep=v=>JSON.parse(JSON.stringify(v));
const CONSENT_TYPES=new Set(['pact','dynastic','access']);

// A tabletop proposal is not a mutation. It becomes a pending decision when
// the receiving House is controlled by a human player; only acceptance spends
// resources/actions and creates the relationship.
P.requiresDiplomacyConsent=function(action){
 return Boolean(action&&CONSENT_TYPES.has(action.type)&&action.other&&this.houses[action.other]&&this.controllerResolver(action.other)==='HUMAN');
};
P.currentDiplomacyPrompt=function(){
 const p=this.pendingDiplomacy;if(!p)return null;
 const action=p.action||{};
 return {house:p.house,other:p.other,type:p.type,label:action.label||action.type,actionId:action.id,choices:['accept','reject'],createdRound:p.createdRound};
};
P.submitDiplomacyChoice=function(choice){
 const p=this.pendingDiplomacy;if(!p)return{valid:false,detail:'Нет ожидающего дипломатического предложения'};
 const accept=choice===true||choice==='accept'||choice==='Принять';
 if(!accept){this.log('diplomacy_response',`${p.other} отклоняет предложение ${p.action?.label||p.type} от ${p.house}`,{house:p.other,other:p.house,actionId:p.action?.id,response:'reject'});this.pendingDiplomacy=null;return{valid:true,accepted:false}}
 const action=this.legalActions(p.house).find(a=>a.id===p.action?.id);
 if(!action){this.log('diplomacy_response',`Предложение ${p.action?.label||p.type} устарело и отклонено`,{house:p.other,other:p.house,actionId:p.action?.id,response:'stale'});this.pendingDiplomacy=null;return{valid:false,detail:'Предложение больше недействительно'};}
 this.pendingDiplomacy=null;this._committingDiplomacy=true;
 try{return this.step(action.id)}finally{this._committingDiplomacy=false}
};
const _reset=P.reset;P.reset=function(...args){this.pendingDiplomacy=null;this._committingDiplomacy=false;return _reset.apply(this,args)};
const _step=P.step;P.step=function(actionId=null){if(this.pendingDiplomacy&&!this._committingDiplomacy)return this.exportData();return _step.call(this,actionId)};
const _export=P.exportData;P.exportData=function(){const x=_export.call(this);x.pendingDiplomacy=this.currentDiplomacyPrompt();return x};
window.ARENA_V572_CURRENT_PATCH_DIPLOMACY={humanConsent:true,pendingProposal:true,types:[...CONSENT_TYPES]};
})();
