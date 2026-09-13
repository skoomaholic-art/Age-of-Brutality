  const raw=this.stateFlags.ransomFixed!=null?this.stateFlags.ransomFixed:amount;
  const N=Number(raw);
  if(!Number.isInteger(N)||N<1)return{valid:false,detail:'Выкуп N должен быть положительным целым'};
  c.ransomOffer=N;
  const ownerState=this.houses[rec.owner];
  let finalResponse=response;
  if(finalResponse==null)finalResponse=this.aiRansomAcceptance(rec.owner,c,rec.captor,N).decision;
  if(finalResponse==='accept'&&ownerState.gold>=N){
   ownerState.gold-=N;this.houses[rec.captor].gold+=N;c.ransomResponse='accept';this.metrics.total.ransoms++;
   this.logPrisoner('ransom_paid',rec.owner,c,rec.captor,{amount:N,detail:`${rec.owner} платит ${N} золота за ${c.name}`});
   return this.releasePrisoner(rec.owner,c,rec.captor,'ransom')
  }
  c.ransomResponse=ownerState.gold<N?'unaffordable':'reject';
  this.logPrisoner('ransom_rejected',rec.owner,c,rec.captor,{amount:N,response:c.ransomResponse,detail:`Выкуп ${N} за ${c.name} не принят`});
  return this.detainPrisoner(rec.owner,c,rec.captor,rec.location,detentionChoice)
 }
 characterByUid(h,uid){return this.allCharacters(h).find(c=>String(c.uid)===String(uid))||null}
 logPrisoner(kind,owner,c,captor,meta={}){const row={round:this.round,kind:'prisoner',event:kind,owner,captor,character:c?.uid,name:c?.name,...meta};this.prisonerHistory.push(row);this.logs.push(row);return row}
 prisonerValue(c){if(!c)return 0;let v=1;if(c.type==='Правитель')v+=5;if(c.type==='Законный ребёнок')v+=3;v+=num(c.attack)+num(c.defense)+num(c.survival)+num(c.diplomacy)+num(c.intrigue)+num(c.management);return v}
 aiRansomAcceptance(owner,c,captor,N){const affordable=this.houses[owner].gold>=N,value=this.prisonerValue(c),acceptScore=value, rejectScore=N*2;const decision=affordable&&acceptScore>=rejectScore?'accept':'reject';const out={house:owner,available_options:['accept','reject'],factor_scores:{specific_prisoner_value:value,owner_gold:this.houses[owner].gold},offered_N:N,decision,reason:!affordable?`Недостаточно золота: ${this.houses[owner].gold} < ${N}`:`implementation scores: accept=${acceptScore}, reject=${rejectScore}`,policy:'IMPLEMENTATION_BALANCE_TEST'};this.logPrisoner('ransom_response',owner,c,captor,{amount:N,ai:out,detail:`${owner}: ${decision} выкуп ${N}`});return out}
 resolvePrisonerAI(owner,c,captor,location){
  const rec={owner,uid:c.uid,captor,location};
  const value=this.prisonerValue(c),captorState=this.houses[captor],ownerState=this.houses[owner],fixed=this.stateFlags.ransomFixed;
  const ransomN=fixed!=null?num(fixed,2):Math.max(1,Math.min(ownerState.gold,Math.max(1,Math.round(value/3))));
  const available=[
   {id:'release',scoreComponents:{mercy:captorState.influence<=1?5:0,lowValue:value<=3?2:0}},
   {id:'hold',scoreComponents:{leverage:value/2,poorOwner:ownerState.gold<ransomN?4:0}},
   {id:'ransom',amount:ransomN,scoreComponents:{goldNeed:captorState.gold<6?4:0,affordability:ownerState.gold>=ransomN?4:-8,prisonerValue:value/4}},
   {id:'execute',scoreComponents:{ruler:c.type==='Правитель'?6:0,threat:ownerState.influence>captorState.influence+3?3:0,cost:captorState.influence>=3&&this.futureActionSlots(captor)>0?-2:-99}}
  ];
  const ranked=available.map(o=>({option:o,score:Object.values(o.scoreComponents).reduce((s,v)=>s+num(v),0)})).sort((a,b)=>b.score-a.score||a.option.id.localeCompare(b.option.id,'ru'));
  const selected=ranked[0].option;
  const ai={house:captor,available_options:available.map(o=>o.id),factor_scores:{specific_prisoner_value:value,prisoner_house_gold:ownerState.gold,captor_gold:captorState.gold,captor_influence:captorState.influence},offered_N:selected.id==='ransom'?ransomN:null,decision:selected.id,reason:`implementation score ${ranked[0].score}`,ranked_options:ranked.map(x=>({id:x.option.id,score:x.score,components:x.option.scoreComponents})),policy:'IMPLEMENTATION_BALANCE_TEST'};
  this.logPrisoner('decision',owner,c,captor,{ai,detail:`${captor}: ${selected.id} для ${c.name}`});
  return this.resolvePrisonerDecision(rec,selected.id,selected.id==='ransom'?ransomN:null,null,null)
 }
 killCharacter(owner,c,reason='death'){
  if(!c||!c.alive)return false;const hs=this.houses[owner];const wasRuler=hs.ruler?.uid===c.uid;c.alive=false;c.health='Мёртв';c.mode='Мёртв';c.heldBy=null;c.captiveLocation=null;c.armyLocation=null;c.ransomOffer=null;c.ransomResponse=null;
  for(const r of this.relationships){if(r.active&&Array.isArray(r.characters)&&r.characters.includes(c.uid)){r.active=false;r.endedReason='death';r.endedRound=this.round}}
  this.log('death',`${c.name} (${owner}) погиб: ${reason}`,{house:owner,character:c.uid});
  if(wasRuler)this.resolveSuccession(owner,c);return true
 }
 resolveSuccession(h,dead){
  const hs=this.houses[h],legal=[hs.heir,...(hs.activeYoung||[]),...(hs.reserveChildren||[])].filter(c=>c&&c.alive&&c.uid!==dead.uid),legit=(hs.legitimizedBastards||[]).filter(c=>c?.alive),next=[...legal,...legit][0]||null;
  if(!next){hs.regency=true;hs.ruler=null;this.log('dynasty',`${h}: Регентство — нет доступного наследника`,{house:h});return}
  hs.ruler=next;hs.regency=Boolean(next.young||next.mode==='ПЛЕН');if(next.type==='Законный ребёнок'&&!hs.achievements.heirRuler){hs.score+=2;hs.achievements.heirRuler=true;hs.newRulerPending={uid:next.uid,round:this.round};this.log('vp',`${h}: +2 ОП — законный наследник стал правителем`,{house:h})}
  this.log('dynasty',`${h}: новый правитель ${next.name}${hs.regency?' (Регентство)':''}`,{house:h,character:next.uid})
 }

