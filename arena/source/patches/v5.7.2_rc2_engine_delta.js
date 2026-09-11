(()=>{'use strict';
const E=window.ArenaEngine,D=window.ARENA_DATA;if(!E||!D)return;
const V='V5.7.2-PLAYABLE-RC2-CANDIDATE',CAPS=D.map.capitals;
D.version=V;
const prevReset=E.prototype.reset,prevStartRound=E.prototype.startRound,prevApplyEvent=E.prototype.applyEvent;
E.prototype.reset=function(seed=57001,rounds=6){const r=prevReset.call(this,seed,rounds);this.stateFlags.ransomFixed=null;this.stateFlags.hostageCongress=false;delete this.stateFlags.ransom;return r};
E.prototype.startRound=function(){if(this.stateFlags){this.stateFlags.ransomFixed=null;this.stateFlags.hostageCongress=false;delete this.stateFlags.ransom}const r=prevStartRound.call(this);const card=D.events?.find(c=>c.id===this.stateFlags?.event);const congress=card?.name==='Съезд заложников';this.stateFlags.hostageCongress=!!congress;this.stateFlags.ransomFixed=congress?2:null;delete this.stateFlags.ransom;return r};
E.prototype.applyEvent=function(card){const r=prevApplyEvent.call(this,card);const congress=card?.name==='Съезд заложников';this.stateFlags.hostageCongress=!!congress;this.stateFlags.ransomFixed=congress?2:null;delete this.stateFlags.ransom;return r};
E.prototype.releasePrisoner=function(owner,c,captor,reason='release'){const loc=CAPS[owner];c.heldBy=null;c.captiveLocation=null;c.ransomOffer=null;c.ransomResponse=reason==='ransom'?'paid_and_released':'released';c.mode='ДВОР';c.returnLocation=loc;if(c===this.houses[owner].ruler)this.houses[owner].regency=false;this.logPrisoner('release',owner,c,captor,{location:loc,reason,detail:`${c.name} (${owner}) освобождён и возвращается в столицу своего Дома: ${loc}`});return{valid:true,location:loc}};
E.prototype.executePrisoner=function(owner,c,captor){const h=this.houses[captor];if(h.influence<3||this.availableActions(captor)<=0)return{valid:false,detail:'Казнь недоступна: требуется 1 будущий слот действия и 3 Влияния'};h.reserved++;this.spendPoliticalInfluence(captor,3,'Казнь пленника');if(this.stateFlags.hostageCongress)this.adjustInfluence(captor,-1,'Съезд заложников: дополнительная цена казни');this.logPrisoner('execute',owner,c,captor,{detail:`${captor} казнит ${c.name} (${owner}); зарезервировано 1 действие, потеряно 3 Влияния${this.stateFlags.hostageCongress?' +1 по событию «Съезд заложников»':''}`});this.killCharacter(owner,c,'казнь в плену');return{valid:true}};
E.prototype.resolvePrisonerDecision=function(rec,choice,amount=null,response=null,detentionChoice=null){
 const c=this.characterByUid(rec.owner,rec.uid);if(!c?.alive||c.heldBy!==rec.captor)return{valid:false,detail:'Пленный более не является законной целью'};
 if(choice==='release')return this.releasePrisoner(rec.owner,c,rec.captor,'release');
 if(choice==='hold')return this.detainPrisoner(rec.owner,c,rec.captor,rec.location,detentionChoice);
 if(choice==='execute')return this.executePrisoner(rec.owner,c,rec.captor);
 if(choice!=='ransom')return{valid:false,detail:'Неизвестное решение по пленнику'};
 const finish=(N,ans)=>{c.ransomResponse=ans?'accepted':'rejected';if(ans){const vh=this.houses[rec.owner],ch=this.houses[rec.captor];if(vh.gold<N){c.ransomResponse='rejected';this.logPrisoner('ransom_reject',rec.owner,c,rec.captor,{amount:N,detail:`${rec.owner} не может оплатить ${N} золота`});return this.detainPrisoner(rec.owner,c,rec.captor,rec.location,detentionChoice)}vh.gold-=N;ch.gold+=N;this.logPrisoner('ransom_accept',rec.owner,c,rec.captor,{amount:N,detail:`${rec.owner} платит ${N} золота Дому ${rec.captor} за ${c.name}`});return this.releasePrisoner(rec.owner,c,rec.captor,'ransom')}this.logPrisoner('ransom_reject',rec.owner,c,rec.captor,{amount:N,detail:`${rec.owner} отклоняет выкуп ${N} за ${c.name}`});return this.detainPrisoner(rec.owner,c,rec.captor,rec.location,detentionChoice)};
 if(c.ransomOffer!=null&&c.ransomResponse==null&&response!=null)return finish(Number(c.ransomOffer),!!response);
 const N=this.stateFlags.ransomFixed?Number(this.stateFlags.ransomFixed):Math.max(1,Math.floor(Number(amount)||0));if(!N)return{valid:false,detail:'Сумма выкупа должна быть положительным целым числом'};
 c.ransomOffer=N;c.ransomResponse=null;this.logPrisoner('ransom_offer',rec.owner,c,rec.captor,{amount:N,detail:`${rec.captor} требует ${N} золота за ${c.name}`});let ans=response;if(ans==null&&this.controllerResolver(rec.owner)!=='human')ans=this.aiRansomAcceptance(rec.owner,c,rec.captor,N).accept;if(ans==null)return{valid:true,pendingResponse:true,record:rec,amount:N};return finish(N,!!ans)
};
window.ARENA_V572={...(window.ARENA_V572||{}),version:V,rc2Delta:true};
})();
