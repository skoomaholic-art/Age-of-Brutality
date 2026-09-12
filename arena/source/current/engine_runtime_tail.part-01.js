 updateRelationsAtRoundStart(){
  for(const r of this.relationships){if(!r.active||r.createdRound>=this.round)continue;r.fullRounds=num(r.fullRounds)+1;
   for(const h of [r.a,r.b]){const hs=this.houses[h];if(r.kind==='Официальный Пакт'&&!r.rewarded?.[h]){hs.score+=1;hs.achievements.pact=true;r.rewarded[h]=true;this.log('vp',`${h}: +1 ОП — Пакт пережил полный раунд`,{house:h})}
    if(r.kind==='Династический союз'&&!r.rewarded?.[h]){hs.score+=1;hs.influence+=1;hs.achievements.dynastic=true;r.rewarded[h]=true;this.log('vp',`${h}: +1 ОП и +1 Влияние — династический союз пережил полный раунд`,{house:h})}
    if(r.kind==='Официальный Пакт'||r.kind==='Династический союз'){hs.survivedRelationPartners.add(r.a===h?r.b:r.a);if(hs.survivedRelationPartners.size>=3&&!hs.achievements.threeRelations){hs.score+=1;hs.achievements.threeRelations=true;this.log('vp',`${h}: +1 ОП — отношения с 3 Домами пережили полный раунд`,{house:h})}}
   }
  }
  for(const h of HOUSES)this.checkPowerAchievements(h)
 }
 checkPowerAchievements(h){const hs=this.houses[h];if(hs.influence>=7&&hs.influenceSpent>=2&&!hs.achievements.power1){hs.score+=1;hs.achievements.power1=true;this.log('vp',`${h}: +1 ОП — Влияние 7+ после расхода 2+`,{house:h})}if(hs.influence>=11&&hs.influenceSpent>=4&&!hs.achievements.power2){hs.score+=2;hs.achievements.power2=true;this.log('vp',`${h}: +2 ОП — Влияние 11+ после расхода 4+`,{house:h})}}
 dynastyPhase(){
  for(const h of HOUSES){const hs=this.houses[h];for(const c of hs.activeYoung||[]){if(!c.alive||!c.young)continue;if(c.bornRound==null){c.bornRound=this.round;continue}if(this.round>c.bornRound)c.youngPhases=num(c.youngPhases)+1;if(c.youngPhases>=2){c.young=false;c.mode='ДВОР';this.log('dynasty',`${c.name} (${h}) достиг совершеннолетия`,{house:h,character:c.uid})}}
   if(this.legalChildrenAlive(h)>=3&&!hs.achievements.threeChildren){hs.score+=1;hs.achievements.threeChildren=true;this.log('vp',`${h}: +1 ОП — 3 живых законных ребёнка`,{house:h})}
   if(hs.newRulerPending&&this.round>hs.newRulerPending.round){const c=this.characterByUid(h,hs.newRulerPending.uid);if(c?.alive){hs.score+=1;this.log('vp',`${h}: +1 ОП — новый правитель пережил полный раунд`,{house:h})}hs.newRulerPending=null}
   if(h==='Сайрвен'&&hs.gold<=2)hs.influence=Math.max(0,hs.influence-1);
   if(h==='Тасвар'&&this.activeOfficialRelations(h)===0)hs.influence=Math.max(0,hs.influence-1);
   this.checkPowerAchievements(h)
  }
 }
 ambitionCompleted(h){const hs=this.houses[h],a=hs.ambition,id=String(field(a,'CARD_ID')||'');if(!a)return false;const terr=this.totalTerritories(h),home=Object.values(this.territories).filter(t=>this.homeHouseFor(t.id)===h&&t.owner===h).length,foreignMain=Object.values(this.territories).filter(t=>!t.id.startsWith('S')&&t.owner===h&&this.homeHouseFor(t.id)!==h).length,enemyCap=Object.entries(CAPS).some(([x,id])=>x!==h&&this.territories[id]?.owner===h),fullIslands=[1,2,3,4,5].filter(i=>this.territories[`S0${i}-A`]?.owner===h&&this.territories[`S0${i}-B`]?.owner===h).length;
  if(id==='AMB-W01')return terr>=10&&foreignMain>=3;if(id==='AMB-W02')return enemyCap;if(id==='AMB-W03')return fullIslands>=2;if(id==='AMB-W04')return hs.pvpWins>=3;if(id==='AMB-W05')return home===7&&hs.fortsBuilt>=2&&Object.values(this.territories).filter(t=>t.fortOwner===h&&t.owner===h).length>=2;if(id==='AMB-W06')return hs.defeatedHouses.size>=3;
  if(id==='AMB-P01')return hs.influence>=10&&hs.influenceSpent>=3;if(id==='AMB-P02')return this.relationships.filter(r=>r.active&&r.kind==='Официальный Пакт'&&r.fullRounds>=1&&(r.a===h||r.b===h)).length>=2;if(id==='AMB-P03')return this.relationships.some(r=>r.active&&r.kind==='Династический союз'&&r.fullRounds>=2&&(r.a===h||r.b===h));if(id==='AMB-P04')return hs.gold>=30&&terr>=5&&hs.advisers.length>=1;if(id==='AMB-P05')return hs.fortsBuilt>=2&&Object.values(this.territories).filter(t=>t.fortOwner===h&&t.owner===h).length>=2;if(id==='AMB-P06')return hs.survivedRelationPartners.size>=3;
  const adultLegal=[hs.heir,...hs.activeYoung,...hs.reserveChildren].filter(c=>c?.alive&&!c.young).length;if(id==='AMB-D01')return adultLegal>=3;if(id==='AMB-D02')return Boolean(hs.achievements.heirRuler&&!hs.newRulerPending);if(id==='AMB-D03')return hs.legitimizedBastards.some(c=>c.alive&&(hs.heir?.uid===c.uid||hs.ruler?.uid===c.uid));if(id==='AMB-D04')return this.relationships.some(r=>r.active&&r.kind==='Династический союз'&&r.fullRounds>=1&&r.characters?.includes(hs.heir?.uid));if(id==='AMB-D05')return Boolean(hs.achievements.heirRuler&&[hs.heir,...hs.legitimizedBastards].some(c=>c?.alive));if(id==='AMB-D06')return hs.ruler?.original&&hs.ruler.alive&&hs.dynastyActions.size>=2;return false
 }
 finalizeGame(){
  for(const h of HOUSES){const hs=this.houses[h],terr=this.totalTerritories(h),foreignMain=Object.values(this.territories).filter(t=>!t.id.startsWith('S')&&t.owner===h&&this.homeHouseFor(t.id)!==h).length,enemyCap=Object.entries(CAPS).some(([x,id])=>x!==h&&this.territories[id]?.owner===h);if(terr>=9&&foreignMain>=2)hs.score+=2;if(enemyCap)hs.score+=2;const mature=this.relationships.filter(r=>r.active&&(r.kind==='Официальный Пакт'||r.kind==='Династический союз')&&r.fullRounds>=1&&(r.a===h||r.b===h)).length;if(mature>=2)hs.score+=1;if(this.ambitionCompleted(h)){hs.score+=3;hs.ambitionCompleted=true}}
  const maxInf=Math.max(...HOUSES.map(h=>this.houses[h].influence));for(const h of HOUSES)if(this.houses[h].influence===maxInf)this.houses[h].score+=1;
  this.status='finished';this.finishedRound=this.round;const standings=this.standings();this.winner=standings[0]?.house||null;this.log('phase',`Партия завершена: ${this.winner}`,{winner:this.winner})
 }
 standings(){return HOUSES.map(h=>({house:h,score:this.houses[h].score,influence:this.houses[h].influence,territories:this.totalTerritories(h),gold:this.houses[h].gold})).sort((a,b)=>b.score-a.score||b.influence-a.influence||b.territories-a.territories||b.gold-a.gold||a.house.localeCompare(b.house,'ru'))}
 allHouseCharacters(h){return deep(this.allCharacters(h))}
 commanderEntries(h){return this.allCharacters(h).filter(c=>c.alive&&c.health==='Здоров'&&(c.mode==='ДВОР'||c.mode==='АРМИЯ')).map(c=>({uid:c.uid,name:c.name,mode:c.mode,armyLocation:c.armyLocation,canAssign:c.mode==='ДВОР'&&!this.houses[h].regency,canReturn:c.mode==='АРМИЯ'}))}
 assignCommander(h,uid,loc=CAPS[h]){const c=this.characterByUid(h,uid);if(!c?.alive||c.health!=='Здоров'||c.mode!=='ДВОР'||this.houses[h].regency)return{valid:false};if(loc!==CAPS[h]||num(this.territories[loc]?.units[h])<=0||this.commanderAt(h,loc)||this.allCharacters(h).filter(x=>x.alive&&x.mode==='АРМИЯ').length>=2)return{valid:false};c.mode='АРМИЯ';c.armyLocation=loc;this.log('commander',`${h}: ${c.name} назначен командиром`,{house:h,character:uid,location:loc});return{valid:true}}
 returnCommander(h,uid){const c=this.characterByUid(h,uid);if(!c?.alive||c.mode!=='АРМИЯ'||c.armyLocation!==CAPS[h])return{valid:false};c.mode='ДВОР';c.armyLocation=null;return{valid:true}}
 availableActions(h=this.currentHouse()){return{actions:this.legalActions(h),freeProcedures:this.freeProcedures(h),blocked:this.sourceBlockedActions()}}
 controllerResolver(){return'AI'}
 currentPrisonerPrompt(){return null}
 submitPrisonerChoice(){return{valid:false,detail:'Current headless build resolves prisoner decisions immediately for AI controllers'}}
 resolvePendingPrisoners(){return{valid:true,pending:0}}
 exportData(){
  const houses={};for(const h of HOUSES){const x=this.houses[h];houses[h]={...deep({...x,dynastyActions:[...x.dynastyActions],defeatedHouses:[...x.defeatedHouses],survivedRelationPartners:[...x.survivedRelationPartners]})}}
  const standings=this.standings(),lead=standings[0]||null;return{meta:{version:this.data.version,status:this.status,seed:this.seed,rounds:this.rounds,actionTotal:this.actionTotal},errors:[...this.errors],statistics:{game:{round:this.round,metrics:deep(this.metrics),leader:lead?.house||null,standings}},relationships:deep(this.relationships),logs:deep(this.logs),prisonerHistory:deep(this.prisonerHistory),houses,territories:deep(this.territories),capabilities:this.capabilityReport()}
 }
 capabilityReport(){return{implementedNormalActions:['ACT-MARCH','ACT-RECRUIT','ACT-FORT','ACT-ADVISER','ACT-MARR-NEUT','ACT-MARR-DYN','ACT-BIRTH','ACT-LEGIT','ACT-DIVORCE','ACT-RETURN','ACT-ACCESS','ACT-RAID'],implementedFreeProcedures:['PROC-BREAK','PROC-GOLD'],sourceBlockedActions:this.sourceBlockedActions(),note:'Интриги/Следы не реконструируются без отсутствующего canonical Intrigue card master.'}}
 sourceBlockedActions(){return['ACT-DRAW','ACT-INTRIGUE','ACT-INVEST']}
}

const _legalActions=ArenaEngine.prototype.legalActions;
