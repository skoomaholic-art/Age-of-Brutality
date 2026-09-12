(()=>{'use strict';
function finite(value,fallback=0){return Number.isFinite(Number(value))?Number(value):fallback}
function roundPolicy(config,round){const key=String(Math.max(1,Math.min(6,Math.trunc(finite(round,1)))));return config.canonical_round_escalation[key]||{pvp_bonus:0,late_neutral_penalty:0}}
function relationCap(config,houseId){return config.canonical_diplomacy.official_relation_soft_cap_by_house?.[houseId]??config.canonical_diplomacy.official_relation_soft_cap_default}
function sumExternalComponents(components={}){const out=[];let total=0;for(const[name,raw]of Object.entries(components||{})){const value=finite(raw,0);if(value===0)continue;total+=value;out.push({source:`external:${name}`,value})}return{total,out}}
function scoreAction(config,houseId,context,action){
 const contributions=[];let score=finite(action.baseScore,0);if(score!==0)contributions.push({source:'action.baseScore',value:score});
 const ext=sumExternalComponents(action.scoreComponents);score+=ext.total;contributions.push(...ext.out);
 const target=action.target||{},weights=config.canonical_target_scoring,escalation=roundPolicy(config,context.round);
 if(target.ownership==='neutral'){score+=weights.neutral_base;contributions.push({source:'AI_ROUTE_NEUTRAL:base',value:weights.neutral_base});const income=finite(target.income,0);if(income){score+=income;contributions.push({source:'AI_ROUTE_NEUTRAL:income',value:income})}const resistance=finite(target.resistance,0);if(resistance){score-=resistance;contributions.push({source:'AI_ROUTE_NEUTRAL:resistance',value:-resistance})}if(escalation.late_neutral_penalty){score-=escalation.late_neutral_penalty;contributions.push({source:'AI_ROUND:late_neutral_penalty',value:-escalation.late_neutral_penalty})}}
 if(target.ownership==='enemy'){score+=weights.enemy_base;contributions.push({source:'AI_ROUTE_ENEMY:base',value:weights.enemy_base});const income=finite(target.income,0);if(income){score+=income;contributions.push({source:'AI_ROUTE_ENEMY:income',value:income})}if(escalation.pvp_bonus){score+=escalation.pvp_bonus;contributions.push({source:'AI_ROUND:pvp_bonus',value:escalation.pvp_bonus})}}
 if(target.recaptureCapital){score+=weights.recapture_capital_bonus;contributions.push({source:'AI_RECAPTURE_CAPITAL',value:weights.recapture_capital_bonus})}
 else if(target.recaptureHome){score+=weights.recapture_home_bonus;contributions.push({source:'AI_RECAPTURE_HOME',value:weights.recapture_home_bonus})}
 if(target.completesIsland){score+=weights.complete_island_bonus;contributions.push({source:'AI_COMPLETE_ISLAND',value:weights.complete_island_bonus})}
 else if(target.firstCenterHalf){score+=weights.first_center_half_bonus;contributions.push({source:'AI_FIRST_CENTER_HALF',value:weights.first_center_half_bonus})}
 if(target.isMainlandPort){score+=weights.mainland_port_bonus;contributions.push({source:'AI_PORT_VALUE',value:weights.mainland_port_bonus})}
 if(target.isEnemyCapital){score+=weights.enemy_capital_bonus;contributions.push({source:'AI_CAPITAL_ENEMY',value:weights.enemy_capital_bonus})}
 const defenders=Math.max(0,Math.trunc(finite(target.defenders,0)));if(defenders){const value=defenders*weights.defended_penalty_per_defender;score+=value;contributions.push({source:'AI_DEFENDED_PENALTY',value})}
 if(action.planId==='PORT_PREPARATION'&&action.planMatch){const value=config.canonical_naval_center.port_preparation_weight;score+=value;contributions.push({source:'AI_PORT_PREP_WEIGHT',value})}
 const activePlanMatch=Boolean(context.activePlan&&action.planId===context.activePlan&&action.planMatch!==false);
 const diplomacy=action.diplomacy||null,cap=relationCap(config,houseId),activeRelations=Math.max(0,Math.trunc(finite(context.activeOfficialRelations,0))),relationDelta=diplomacy?Math.trunc(finite(diplomacy.officialRelationDelta,0)):0;
 const diplomacySoftCapOk=relationDelta<=0||activeRelations+relationDelta<=cap||Boolean(action.goalCritical);
 return{id:String(action.id),type:action.type||'unknown',score,activePlanMatch,diplomacySoftCapOk,relationCap:cap,contributions,action};
}
function compareScored(a,b){if(a.activePlanMatch!==b.activePlanMatch)return a.activePlanMatch?-1:1;if(a.diplomacySoftCapOk!==b.diplomacySoftCapOk)return a.diplomacySoftCapOk?-1:1;if(a.score!==b.score)return b.score-a.score;return a.id.localeCompare(b.id,'ru')}
class ArenaHouseAgent{
 constructor(houseId,config){if(!config?.houses?.includes(houseId))throw new Error(`Unknown House: ${houseId}`);this.houseId=houseId;this.config=config}
 decide(context={}){
  const legalActions=Array.isArray(context.legalActions)?context.legalActions.filter(a=>a&&a.legal!==false&&a.id!=null):[];
  if(!legalActions.length)return{house:this.houseId,decision:null,reason:'NO_LEGAL_ACTIONS',evaluated:[],policy:this.config.decision_policy.status};
  const evaluated=legalActions.map(a=>scoreAction(this.config,this.houseId,context,a)).sort(compareScored),selected=evaluated[0];
  return{house:this.houseId,decision:selected.action,decisionId:selected.id,score:selected.score,reason:selected.contributions,activePlanMatch:selected.activePlanMatch,diplomacySoftCapOk:selected.diplomacySoftCapOk,relationCap:selected.relationCap,evaluated:evaluated.map(i=>({id:i.id,type:i.type,score:i.score,activePlanMatch:i.activePlanMatch,diplomacySoftCapOk:i.diplomacySoftCapOk,contributions:i.contributions})),policy:this.config.decision_policy.status};
 }
}
window.ArenaHouseAgent=ArenaHouseAgent;
window.ARENA_AI_ADAPTER={scoreAction,roundPolicy,relationCap};
})();
