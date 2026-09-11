(()=>{'use strict';
const A=window.UNIFIED_ARENA;if(!A||!window.arenaEngine)return;
const E=()=>window.arenaEngine,U=A.state,D=window.ARENA_DATA;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]||c));
const root=()=>document.getElementById('uv-modal-root');
function modal(html){const r=root();if(r)r.innerHTML=`<div class="uv-overlay" data-blocking="1"><div class="uv-modal wide">${html}</div></div>`}
function close(){const r=root();if(r)r.innerHTML=''}
function syncController(){E().controllerResolver=h=>U.controllers?.[h]||'ai'}
syncController();

function finishPending(){
  const prompt=E().currentPrisonerPrompt?.();
  if(prompt){U.pending={type:'prisoner',stage:prompt.type};showPrisoner();return}
  if(U.pending?.type==='prisoner')U.pending=null;
  close();A.render?.();A.advanceUntilHuman?.();
}
function submit(choice,amount=null,response=null,detentionChoice=null){
  const r=E().submitPrisonerChoice(choice,amount,response,detentionChoice);
  if(r?.valid===false){alert(r.detail||'Недопустимое решение');return r}
  queueMicrotask(finishPending);return r;
}
function showPrisoner(){
  syncController();const e=E(),p=e.currentPrisonerPrompt?.();
  if(!p){finishPending();return}
  const rec=p.record,c=p.character,holder=e.houses[rec.captor],owner=e.houses[rec.owner];
  if(p.type==='captor'){
    const opts=e.nearestDetentionLocations(rec.captor,rec.location)||[];
    const tie=opts.length>1;
    const fixed=e.stateFlags?.ransomFixed;
    modal(`<h2>ПЛЕН · РЕШЕНИЕ ПЛЕНИТЕЛЯ</h2>
      <p><b>${esc(rec.captor)}</b> захватил персонажа <b>${esc(c.name)}</b> Дома <b>${esc(rec.owner)}</b> в ${esc(rec.location)}.</p>
      <div class="uv-cardbox"><b>Допустимые варианты:</b> отпустить / взять в плен / требовать выкуп N / казнить.</div>
      ${tie?`<label>Если берёте в плен, выберите одну из равноудалённых ближайших крепостей:<select class="uv-input" id="v572-det">${opts.map(x=>`<option>${esc(x)}</option>`).join('')}</select></label>`:''}
      <div class="uv-formgrid"><label>Сумма выкупа<input class="uv-input" id="v572-ransom" type="number" min="1" step="1" value="${fixed||Math.max(1,Math.min(5,owner.gold||1))}" ${fixed?'disabled':''}></label>
      <div class="uv-cardbox">${fixed?`«Съезд заложников»: выкуп фиксирован — <b>2 золота</b>.`:'Для людей фиксированного диапазона нет: пленитель вводит N.'}</div></div>
      <div class="uv-buttons"><button class="uv-btn primary" id="v572-release">Отпустить</button><button class="uv-btn" id="v572-hold">Взять в плен</button><button class="uv-btn" id="v572-demand">Требовать выкуп</button><button class="uv-btn danger" id="v572-execute" ${holder.influence<3||e.availableActions(rec.captor)<=0?'disabled':''}>Казнить</button></div>
      <p class="uv-mini">Отпущенный или выкупленный персонаж возвращается в столицу своего Дома.</p>`);
    document.getElementById('v572-release').onclick=()=>submit('release');
    document.getElementById('v572-hold').onclick=()=>submit('hold',null,null,document.getElementById('v572-det')?.value||null);
    document.getElementById('v572-demand').onclick=()=>submit('ransom',Number(document.getElementById('v572-ransom').value));
    const ex=document.getElementById('v572-execute');if(ex)ex.onclick=()=>submit('execute');
  }else if(p.type==='ransom_response'){
    const N=Number(p.amount||c.ransomOffer||0),can=owner.gold>=N;
    modal(`<h2>ВЫКУП · РЕШЕНИЕ ВЛАДЕЛЬЦА ПЛЕННИКА</h2>
      <p>Дом <b>${esc(rec.captor)}</b> требует <b>${N} золота</b> за <b>${esc(c.name)}</b> (${esc(rec.owner)}).</p>
      <p>Казна ${esc(rec.owner)}: <b>${owner.gold}</b>. При согласии золото передаётся пленителю, персонаж возвращается в столицу своего Дома.</p>
      <div class="uv-buttons"><button class="uv-btn primary" id="v572-accept" ${can?'':'disabled'}>Принять</button><button class="uv-btn" id="v572-reject">Отказать</button></div>`);
    const a=document.getElementById('v572-accept');if(a)a.onclick=()=>submit('ransom',N,true);
    document.getElementById('v572-reject').onclick=()=>submit('ransom',N,false);
  }
}

// Wrap engine blocker so a capture involving a Human controller becomes a true blocking UI decision.
const baseResolve=E().resolvePendingPrisoners.bind(E());
E().resolvePendingPrisoners=function(){syncController();const r=baseResolve();if(r?.pending){U.pending={type:'prisoner',stage:r.pending};queueMicrotask(showPrisoner)}return r};

function allChars(h){const seen=new Set(),out=[];for(const c of [h.ruler,h.heir,h.spouse,...(h.reserveChildren||[]),...(h.activeYoung||[]),...(h.knownBastards||[]),...(h.legitimizedBastards||[])])if(c?.uid&&!seen.has(c.uid)){seen.add(c.uid);out.push(c)}return out}
function showCommanders(){
  const e=E(),human=Object.keys(U.controllers||{}).filter(h=>U.controllers[h]==='human');
  const blocks=human.map(n=>{const h=e.houses[n],chars=allChars(h),assigned=e.commanderEntries(n);return `<div class="uv-cardbox"><h3>${esc(n)}</h3><div class="uv-mini">В АРМИИ: ${assigned.map(x=>`${esc(x.char.name)} → ${esc(x.location)}`).join(', ')||'нет'}</div>${chars.filter(c=>c.alive&&!c.young&&c.health!=='Ослаблен').map(c=>{const loc=h.commanderAssignments?.[c.uid];return loc?`<button class="uv-btn" data-ret-house="${esc(n)}" data-ret-uid="${esc(c.uid)}">Вернуть: ${esc(c.name)}</button>`:`<button class="uv-btn" data-asg-house="${esc(n)}" data-asg-uid="${esc(c.uid)}">Назначить: ${esc(c.name)}</button>`}).join(' ')}</div>`}).join('');
  modal(`<h2>КОМАНДИРЫ СЕМЬИ</h2><p>Назначение идёт через столицу; максимум два персонажа Дома в армиях и один командир на армию.</p>${blocks}<div class="uv-buttons"><button class="uv-btn" id="v572-close">Закрыть</button></div>`);
  document.getElementById('v572-close').onclick=()=>{U.pending=null;close()};
  document.querySelectorAll('[data-asg-house]').forEach(b=>b.onclick=()=>{const r=e.assignCommander(b.dataset.asgHouse,b.dataset.asgUid);if(r.valid)showCommanders();else alert(r.detail)});
  document.querySelectorAll('[data-ret-house]').forEach(b=>b.onclick=()=>{const r=e.returnCommander(b.dataset.retHouse,b.dataset.retUid);if(r.valid)showCommanders();else alert(r.detail)});
}
function showPrisoners(){
  const e=E(),rows=[];for(const n of D.houses.map(x=>x.name)){for(const c of e.allHouseCharacters?.(n)||[])if(c.alive&&c.heldBy)rows.push(`<div class="uv-cardbox"><b>${esc(c.name)}</b> · ${esc(n)}<br>Пленитель: ${esc(c.heldBy)} · место: ${esc(c.captiveLocation||'решение ожидается')}<br>Выкуп: ${c.ransomOffer??'—'} · ответ: ${esc(c.ransomResponse??'—')}</div>`)}
  modal(`<h2>ПЛЕННИКИ</h2>${rows.join('')||'<p>Сейчас пленных нет.</p>'}<div class="uv-buttons"><button class="uv-btn" id="v572-close">Закрыть</button></div>`);document.getElementById('v572-close').onclick=close;
}
function addTopButton(id,text,fn,beforeId='uv-journal'){if(document.getElementById(id))return;const b=document.createElement('button');b.className='uv-topbtn';b.id=id;b.textContent=text;b.onclick=fn;const before=document.getElementById(beforeId);before?.parentNode?.insertBefore(b,before)}
addTopButton('v572-commanders','Командиры',showCommanders);
addTopButton('v572-prisoners','Пленники',showPrisoners);

// Controller switches can happen after load/setup; keep resolver pointed at current UI state.
new MutationObserver(syncController).observe(document.getElementById('uv-root')||document.body,{subtree:true,childList:true,attributes:true});
})();
