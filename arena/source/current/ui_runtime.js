(()=>{
  'use strict';
  if(typeof document==='undefined'||!window.arenaEngine)return;

  const e=window.arenaEngine,D=window.ARENA_DATA;
  const n=v=>Number(v)||0;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const root=document.createElement('div');root.id='arena-app';document.body.innerHTML='';document.body.appendChild(root);
  const style=document.createElement('style');
  style.textContent=`
    body{margin:0;background:#15120e;color:#eadfc7;font:16px system-ui,Arial;line-height:1.45}
    button,input,select{font:inherit}
    #arena-app{max-width:1500px;margin:auto;padding:16px}
    .bar,.tabs,.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .card{background:#211c16;border:1px solid #554631;border-radius:8px;padding:12px;margin:10px 0;overflow:auto}
    .tabs button.active{outline:2px solid #d6b777}
    button{min-height:42px;background:#3a3024;color:#f2e5c8;border:1px solid #725e43;border-radius:6px;padding:8px 11px;cursor:pointer}
    button.primary{background:#79502c;border-color:#d6b777;font-weight:700}
    button:hover{border-color:#d6b777;background:#4a3b2a}
    button.primary:hover{background:#93643a}
    button:active{transform:translateY(1px)}
    button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #d6b777;outline-offset:2px}
    button:disabled{opacity:.45;cursor:not-allowed}
    table{width:100%;border-collapse:collapse}
    th,td{border-bottom:1px solid #40362b;padding:7px;text-align:left;vertical-align:top}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px}
    .territory{background:#292218;border:1px solid #4e412f;border-radius:6px;padding:9px}
    .muted{color:#b7a98d;font-size:14px}.warn{color:#ffd38b}.bad{color:#ff9a8f}.good{color:#a9dda1}
    .notice{min-height:24px;margin-top:5px;color:#a9dda1;font-weight:650}
    .map-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
    .legend{display:flex;gap:8px;flex-wrap:wrap}.legend span{display:inline-flex;gap:5px;align-items:center;font-size:13px;color:#cfc1a5}
    .legend i{width:11px;height:11px;border-radius:3px;border:1px solid #d6b777}
    .map-wrap{overflow:auto;border:1px solid #554631;border-radius:8px;background:#171d20}
    .map-svg{display:block;width:100%;min-width:980px;height:auto}
    .map-node rect{transition:filter .15s ease,stroke-width .15s ease}.map-node:hover rect{filter:brightness(1.2);stroke-width:3}
    summary{cursor:pointer;font-weight:700;padding:4px 0}pre{white-space:pre-wrap;word-break:break-word}.log{max-height:58vh;overflow:auto}
    .top{display:flex;justify-content:space-between;gap:15px;align-items:flex-start}
    @media(max-width:700px){#arena-app{padding:10px}.top{display:block}.grid{grid-template-columns:1fr}h1{font-size:1.65rem}.map-svg{min-width:860px}}
  `;
  document.head.appendChild(style);
  let tab='MAP',uiNotice='';
  const HOUSE_COLORS={'Варкайр':'#9b3f36','Сайрвен':'#3b6f9e','Ортайн':'#697d3a','Эркай':'#8a579e','Тасвар':'#a46b2f','Айрель':'#247f76'};

  function state(){return e.exportData()}
  function download(name,obj){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
  function territoryCard(id,x){
    const units=Object.entries(x.units||{}).filter(([,v])=>n(v)>0).map(([h,v])=>`${esc(h)}: ${v}`).join(' · ')||'—';
    const cmd=Object.keys(e.houses||{}).map(h=>e.commanderAt?.(h,id)).filter(Boolean).map(c=>c.name).join(', ');
    const land=(e.land[id]||[]).join(', '),sea=(e.sea[id]||[]).join(', ');
    return `<div class="territory"><b>${esc(id)}</b> <span class="muted">${esc(x.type||'')}</span><br>Контроль: ${esc(x.owner||'нейтрал')}<br>Воины: ${units}<br>Крепость: ${x.fort?'да':'—'}${cmd?`<br>Командир: ${esc(cmd)}`:''}<div class="muted">Суша: ${esc(land||'—')}<br>Море: ${esc(sea||'—')}</div></div>`;
  }
  function mapPosition(id){
    const mainland=/^([WE])([1-3])-(\d)$/.exec(id);
    if(mainland){
      const side=mainland[1],sector=n(mainland[2]),slot=n(mainland[3]),y=130+(sector-1)*245;
      const west={1:[80,0],2:[175,-68],3:[175,0],4:[400,0],5:[285,-68],6:[285,0],7:[400,68]},east={1:[840,0],2:[955,-68],3:[955,0],4:[1065,0],5:[1170,-68],6:[1065,68],7:[1170,68]};
      const p=(side==='W'?west:east)[slot];return[p[0],y+p[1]];
    }
    const island=/^S0([1-5])-([AB])$/.exec(id);
    if(island){const row=n(island[1]),side=island[2],y=105+(row-1)*135;if(row===3)return[side==='A'?555:685,y];return[side==='A'?505:735,y]}
    return[620,370];
  }
  function topologyMap(x){
    const positions=Object.fromEntries(Object.keys(x.territories||{}).map(id=>[id,mapPosition(id)]));
    const line=([a,b],sea=false)=>{const p=positions[a],q=positions[b];return p&&q?`<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${sea?'#57a3c7':'#71644f'}" stroke-width="${sea?2.2:1.5}" ${sea?'stroke-dasharray="8 7"':''} opacity="${sea?.78:.55}"/>`:''};
    const nodes=Object.entries(x.territories||{}).map(([id,t])=>{const p=positions[id],m=(D.map.territoryMeta||[]).find(z=>z.id===id)||{},owner=t.owner||'',fill=HOUSE_COLORS[owner]||'#302d28',units=Object.values(t.units||{}).reduce((s,v)=>s+n(v),0),port=(D.map.ports||[]).includes(id),capital=m.type==='Столица',title=`${id} · ${m.name||''} · ${owner||'нейтрал'} · воинов: ${units}${t.fort?' · крепость':''}`;return `<g class="map-node" data-map-territory="${esc(id)}" transform="translate(${p[0]} ${p[1]})"><title>${esc(title)}</title><rect x="-39" y="-24" width="78" height="48" rx="8" fill="${fill}" stroke="${port?'#70c5e8':'#c5ad78'}" stroke-width="${capital?3:1.5}"/><text y="-3" fill="#fff7e5" text-anchor="middle" font-size="14" font-weight="750">${capital?'★ ':''}${esc(id)}</text><text y="15" fill="#eee0c4" text-anchor="middle" font-size="11">${port?'ПОРТ · ':''}${units} войск</text></g>`}).join('');
    return `<div class="map-wrap"><svg class="map-svg" viewBox="0 0 1250 760" role="img" aria-labelledby="map-title map-desc"><title id="map-title">Игровая карта Жестокого Века</title><desc id="map-desc">52 территории с текущим контролем и численностью войск. Сплошные линии показывают сухопутные связи, пунктирные — морские маршруты между портами.</desc><rect width="1250" height="760" fill="#151b1e"/><rect x="25" y="25" width="410" height="710" rx="38" fill="#24231e" stroke="#554631"/><rect x="815" y="25" width="410" height="710" rx="38" fill="#24231e" stroke="#554631"/><path d="M470 25h310v710H470z" fill="#14242b" opacity=".9"/><text x="55" y="55" fill="#a99b80" font-size="18" font-weight="700">ЗАПАДНЫЙ МАТЕРИК</text><text x="1195" y="55" fill="#a99b80" font-size="18" font-weight="700" text-anchor="end">ВОСТОЧНЫЙ МАТЕРИК</text><text x="625" y="55" fill="#78bad5" font-size="18" font-weight="700" text-anchor="middle">ЦЕНТРАЛЬНЫЕ ОСТРОВА</text>${(D.map.land_edges||[]).map(edge=>line(edge,false)).join('')}${(D.map.sea_edges||[]).map(edge=>line(edge,true)).join('')}${nodes}</svg></div>`;
  }
  function mapView(x){
    const groups={};for(const [id,t] of Object.entries(x.territories||{})){const m=(D.map.territoryMeta||[]).find(z=>z.id===id),g=id.startsWith('S')?'Центральные острова':m?.house_sector||e.homeHouseFor?.(id)||'Материк';(groups[g]??=[]).push([id,t])}
    const legend=Object.entries(HOUSE_COLORS).map(([h,color])=>`<span><i style="background:${color}"></i>${esc(h)}</span>`).join('');
    const cards=Object.entries(groups).map(([g,rows])=>`<h3>${esc(g)}</h3><div class="grid">${rows.sort((a,b)=>a[0].localeCompare(b[0])).map(([id,t])=>territoryCard(id,t)).join('')}</div>`).join('');
    return `<div class="card"><div class="map-head"><div><h3 style="margin:0 0 4px">Игровая карта</h3><div class="muted">52 территории · сплошные линии — суша · голубой пунктир — морские маршруты между портами</div></div><div class="legend">${legend}</div></div>${topologyMap(x)}<div class="muted" style="margin-top:8px">★ — столица. Голубая рамка — порт. Цвет территории показывает текущий контроль, число — суммарные войска.</div></div><details class="card"><summary>Подробный список территорий</summary>${cards}</details>`;
  }
  function housesView(x){return `<div class="card"><table><thead><tr><th>Дом</th><th>ОП</th><th>Влияние</th><th>Золото</th><th>Территории</th><th>Правитель / наследник</th><th>Плен</th><th>Амбиция</th></tr></thead><tbody>${Object.entries(x.houses||{}).map(([h,s])=>{const terr=Object.values(x.territories||{}).filter(t=>t.owner===h).length,pr=e.allCharacters(h).filter(c=>c.alive&&c.mode==='ПЛЕН').map(c=>c.name);return `<tr><td><b>${esc(h)}</b></td><td>${n(s.score)}</td><td>${n(s.influence)}</td><td>${n(s.gold)}</td><td>${terr}</td><td>${esc(s.ruler?.name||'—')} / ${esc(s.heir?.name||'—')}</td><td>${esc(pr.join(', ')||'—')}</td><td>${esc(s.ambition?.['Название']||s.ambition?.CARD_ID||'—')}</td></tr>`}).join('')}</tbody></table></div>`}
  function diplomacyView(x){const active=(x.relationships||[]).filter(r=>r.active),battles=(x.logs||[]).filter(l=>l.kind==='battle').slice(-30);return `<div class="card"><h3>Действующие отношения</h3>${active.length?`<table><tr><th>Тип</th><th>Стороны</th><th>С раунда</th><th>Полных раундов</th></tr>${active.map(r=>`<tr><td>${esc(r.kind)}</td><td>${esc(r.a)} ↔ ${esc(r.b)}</td><td>${r.createdRound}</td><td>${n(r.fullRounds)}</td></tr>`).join('')}</table>`:'Нет действующих отношений.'}<p class="warn">Формального отдельного статуса «Война» текущие правила не задают; Arena не изобретает его. Ниже показаны фактические боевые столкновения.</p></div><div class="card"><h3>Последние столкновения</h3>${battles.length?battles.map(l=>`<div>R${l.round}: ${esc(l.detail)}</div>`).join(''):'Столкновений пока нет.'}</div>`}
  function journalView(x){return `<div class="card log"><table><tr><th>R</th><th>Тип</th><th>Дом</th><th>Событие</th><th>AI / легальность</th></tr>${(x.logs||[]).slice().reverse().map(l=>`<tr><td>${l.round}</td><td>${esc(l.kind)}</td><td>${esc(l.house||l.attacker||'')}</td><td>${esc(l.detail||l.event||l.action||'')}</td><td><pre>${esc(l.meta?.ai?JSON.stringify(l.meta.ai):'')}</pre></td></tr>`).join('')}</table></div>`}
  function gmView(x){const c=x.capabilities||{},m=x.statistics?.game?.metrics?.total||{};return `<div class="card"><h3>Game Master / Auditor</h3><p>Статус: <b>${esc(x.meta.status)}</b>; seed ${x.meta.seed}; раунд ${x.meta.rounds?e.round:'—'}; действий ${x.meta.actionTotal}</p><p class="${x.errors?.length?'bad':'good'}">Engine errors: ${x.errors?.length||0}</p><p>Реализованные действия: ${esc((c.implementedNormalActions||[]).join(', '))}</p><p>Свободные процедуры: ${esc((c.implementedFreeProcedures||[]).join(', '))}</p><p class="${(c.sourceBlockedActions||[]).length?'warn':'good'}">Заблокированные действия: ${esc((c.sourceBlockedActions||[]).join(', ')||'нет')}</p><p class="muted">${esc(c.note||'')}</p><p class="muted">«Симуляция до конца» запускает одну полную партию (6 раундов / 108 слотов). Пакетный Game Master на 100/500 партий запускается командой из qa/game-master/README.md.</p><pre>${esc(JSON.stringify(m,null,2))}</pre></div>`}
  function actions(){
    const h=e.currentHouse?.(),p=e.currentPrisonerPrompt?.(),d=e.currentDiplomacyPrompt?.();
    if(p)return `<div class="card"><b>Решение по пленнику: ${esc(p.name)}</b><div class="actions"><button data-pr="release">Отпустить</button><button data-pr="hold">Взять в плен</button><button data-pr="ransom">Требовать выкуп N</button><button data-pr="execute">Казнить</button></div></div>`;
    if(d)return `<div class="card"><b>Дипломатическое предложение</b><p>${esc(d.house)} предлагает Дому ${esc(d.other)}: <strong>${esc(d.label)}</strong>.</p><p class="warn">Партия остановлена до решения принимающей стороны. Действие и ресурсы списываются только при согласии.</p><div class="actions"><button class="primary" data-dip="accept">Принять</button><button data-dip="reject">Отклонить</button></div></div>`;
    if(!h||e.status!=='playing')return'';
    const a=e.availableActions(h),human=e.controllerResolver(h)==='HUMAN',commanders=human?(e.commanderEntries?.(h)||[]):[];
    const commanderButtons=commanders.map(c=>c.canAssign?`<button data-cmd-assign="${esc(c.uid)}">В армию: ${esc(c.name)}</button>`:c.canReturn?`<button data-cmd-return="${esc(c.uid)}">Ко двору: ${esc(c.name)}</button>`:'').join('');
    const commanderPanel=human?`<div class="muted">Командиры до действия: ${commanderButtons||'нет доступных переключений'}</div>`:'';
    return `<div class="card"><b>Текущий Дом: ${esc(h)}</b><div class="actions">${(a.actions||[]).map(x=>`<button data-act="${esc(x.id)}">${esc(x.label||x.id)}</button>`).join('')}</div><div class="muted">Свободные процедуры: ${(a.freeProcedures||[]).map(x=>`<button data-free="${esc(x.id)}">${esc(x.label||x.id)}</button>`).join(' ')||'—'}</div>${commanderPanel}</div>`;
  }
  function render(){
    const x=state();
    root.innerHTML=`<div class="top"><div><h1>Жестокий Век — Arena V5.7.2 DEV</h1><div class="muted">${esc(D.version)} · source-matching build</div><div class="notice" aria-live="polite">${esc(uiNotice||`Партия готова · seed ${x.meta.seed}`)}</div></div><div class="bar"><label>Seed <input id="seed" type="number" min="1" value="${x.meta.seed}"></label><button type="button" class="primary" id="reset">Новая партия</button><button type="button" id="step">Шаг AI</button><button type="button" id="run" aria-label="Запустить текущую партию до конца">Симуляция до конца</button></div></div><div class="tabs">${['MAP','HOUSES','DIPLOMACY','JOURNAL','GAME_MASTER'].map(t=>`<button type="button" data-tab="${t}" class="${tab===t?'active':''}">${t}</button>`).join('')}</div>${actions()}<div>${tab==='MAP'?mapView(x):tab==='HOUSES'?housesView(x):tab==='DIPLOMACY'?diplomacyView(x):tab==='JOURNAL'?journalView(x):gmView(x)}</div><div class="card bar"><button type="button" id="full">Скачать Full State</button><button type="button" id="journal">Journal JSON</button><button type="button" id="houses">Houses JSON</button><button type="button" id="dip">Diplomacy JSON</button><label>Ручной Дом <select id="human"><option value="">все AI</option>${Object.keys(e.houses).map(h=>`<option ${e.controllerResolver(h)==='HUMAN'?'selected':''}>${esc(h)}</option>`).join('')}</select></label></div>`;
    root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render()});
    const reset=root.querySelector('#reset');reset.onclick=()=>{const current=n(x.meta.seed)||57001,requested=Number(root.querySelector('#seed').value),seed=Number.isInteger(requested)&&requested>0&&requested!==current?requested:current+1;e.pendingPrisoner=null;e.pendingDiplomacy=null;e.reset(seed,6);uiNotice=`Новая партия начата · seed ${seed}`;render()};
    root.querySelector('#step').onclick=()=>{e.step();const p=e.currentPrisonerPrompt?.()||e.currentDiplomacyPrompt?.();uiNotice=p?'Ожидается решение игрока':'Выполнен шаг AI';render()};
    root.querySelector('#run').onclick=()=>{e.runGame();const p=e.currentPrisonerPrompt?.()||e.currentDiplomacyPrompt?.();uiNotice=p?'Симуляция остановлена: ожидается решение игрока':e.status==='finished'?`Партия завершена · seed ${state().meta.seed}`:'Партия остановлена';render()};
    root.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{e.step(b.dataset.act);render()});
    root.querySelectorAll('[data-free]').forEach(b=>b.onclick=()=>{const p=e.availableActions(e.currentHouse()).freeProcedures.find(x=>x.id===b.dataset.free);if(p)e.applyFreeProcedure(e.currentHouse(),p);render()});
    root.querySelectorAll('[data-cmd-assign]').forEach(b=>b.onclick=()=>{e.assignCommander(e.currentHouse(),b.dataset.cmdAssign);render()});
    root.querySelectorAll('[data-cmd-return]').forEach(b=>b.onclick=()=>{e.returnCommander(e.currentHouse(),b.dataset.cmdReturn);render()});
    root.querySelectorAll('[data-pr]').forEach(b=>b.onclick=()=>{let amount=null,response=null;if(b.dataset.pr==='ransom'){amount=Number(prompt('Выкуп N (положительное целое):','2'));response=confirm('Владелец пленника принимает выкуп?')?'accept':'reject'}e.submitPrisonerChoice(b.dataset.pr,amount,response);render()});
    root.querySelectorAll('[data-dip]').forEach(b=>b.onclick=()=>{const out=e.submitDiplomacyChoice(b.dataset.dip);uiNotice=out?.accepted?'Предложение принято':out?.valid?'Предложение отклонено':out?.detail||'Предложение не выполнено';render()});
    root.querySelector('#full').onclick=()=>download(`Zhestokiy_Vek_Full_${x.meta.seed}.json`,state());root.querySelector('#journal').onclick=()=>download(`Journal_${x.meta.seed}.json`,state().logs);root.querySelector('#houses').onclick=()=>download(`Houses_${x.meta.seed}.json`,state().houses);root.querySelector('#dip').onclick=()=>download(`Diplomacy_${x.meta.seed}.json`,state().relationships);
    root.querySelector('#human').onchange=ev=>{if(e.pendingDiplomacy||e.pendingPrisoner)return;for(const h of Object.keys(e.houses))e.setController(h,h===ev.target.value?'HUMAN':'AI');render()};
  }
  render();
})();
