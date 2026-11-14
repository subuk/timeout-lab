const {t:T,template:TT,name:modelName}=I18n;
const $=id=>document.getElementById(id), fmt=(n,d=0)=>Number(n||0).toLocaleString(I18n.locale(),{maximumFractionDigits:d,minimumFractionDigits:d});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const worker=new Worker('./worker.js?v=18c444abc02f');
let state=null,config=null,initial=null,selected='db-1',scope='node',graphKey='',paused=false,traceID=null,traceCache=[],traceAutoAt=-1,toastTimer,inspectorKey='',autoGroupKey='';
const reasons={quorum_unreachable:'not enough matching calls for quorum',resource_unavailable:'internal box unavailable',ok:'success',request_timeout:'call timeout',client_deadline:'user deadline',connect_timeout:'connect timeout',connection_refused:'connection refused',connection_reset:'connection reset',queue_full:'queue full',cancelled:'cancelled'};
const clone=o=>structuredClone(o);
let requestSequence=0,pendingResetID=0;
function send(data){const requestId=++requestSequence;if(data.type==='reset'||data.type==='preset')pendingResetID=requestId;worker.postMessage({...data,requestId});return requestId;}
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4000);}
function change(mutator,{reset=false}={}){if(!config)return;const next=clone(config);mutator(next);config=next;const requestId=send({type:reset?'reset':'config',config:next});if(reset){clearTraces();graphKey='';}return requestId;}
function sliderFill(input){const min=+input.min||0,max=+input.max||100;input.style.setProperty('--fill',`${Math.max(0,Math.min(100,(+input.value-min)/(max-min)*100))}%`);}
function inputValue(id,value){const el=$(id);if(document.activeElement!==el)el.value=value;if(el.type==='range'){if(value>+el.max)el.max=Math.ceil(value/100)*100;sliderFill(el);}}
function globalControls(){renderRequestMode();renderModelDescription();renderRequestLocality();renderLocalityHint();for(const id of ['rps','weight','network','deadline','spread','jitter','seed'])inputValue(id,config[id]);$('cancel').checked=config.cancel;renderClientConnections();$('rps-out').textContent=state.manualMode?T('Stopped'):fmt(config.rps)+' req/s';$('weight-out').textContent=fmt(config.weight,1)+'×';$('network-out').textContent=fmt(config.network)+T(' ms');$('deadline-out').textContent=fmt(config.deadline)+T(' ms');const entry=config.groups.find(g=>g.id===config.entry);$('entry-flow').textContent=state.manualMode?T('Single request · background arrivals stopped'):entry?TT`Total traffic into “${modelName(entry)}”. Nodes: ${entry.count}, nominally ${fmt(config.rps/entry.count,1)} req/s per node.`:T('Total traffic into the entry group');$('entry-flow').title=T('The generator sends requests only to the entry group. Downstream traffic is determined by outgoing calls, fan-out and routing.');}

function clearTraces(){lastFocusID=null;boxLocalityDirty=false;requestLocalityDirty=false;lastTraceMarkup='';expandedSpans.clear();traceID=null;traceCache=[];traceAutoAt=-3000;$('trace-list').innerHTML='';$('trace-detail').innerHTML=T('<p class="muted">Waiting for the first completed requests…</p>');}
function node(){return state?.nodes.find(n=>n.id===selected&&!n.retired)||state?.nodes.find(n=>!n.retired);}
function group(){return config?.groups.find(g=>g.id===node()?.group);}
const autoFields={
 'auto-min':['min',1], 'auto-max':['max',1], 'auto-up-queue':['upQueue',1],
 'auto-down-util':['downUtilization',1], 'auto-up-delay':['upDelay',1000],
 'auto-up-util':['upUtilization',1], 'auto-window':['window',1000],
 'auto-down-delay':['downDelay',1000], 'auto-cooldown':['cooldown',1000]
};
function renderAutoScale(){
 const g=group();if(!g)return;const p=g.autoscale;renderAutoSource();
 $('auto-enabled').checked=p.enabled;
 for(const [id,[key,factor]] of Object.entries(autoFields))inputValue(id,p[key]/factor);
 if(autoGroupKey!==g.id){$('auto-controls').open=p.enabled;autoGroupKey=g.id;}
 const v=state.autoscalers?.find(a=>a.group===g.id);
 const status=$('auto-status');status.classList.toggle('enabled',p.enabled);
 const hold=v?.mode==='holding_up'||v?.mode==='holding_down';
 status.textContent=!p.enabled?T('Disabled'):v?`${T(v.message)}${hold?TT` · in ${fmt(v.remaining/1000,1)} s → ${v.target}`:v.mode==='cooldown'?TT` · ${fmt(v.remaining/1000,1)} s`:''}`:T('Waiting for the first sample');
 $('auto-sensors').textContent=TT`Queue / node: ${fmt(v?.queue,1)} · utilization: ${fmt(v?.utilization,1)}%. Checked every 0.5 s.`;
 const events=(state.scaleEvents||[]).filter(e=>e.group===g.id).slice(0,4);
 $('auto-events').innerHTML=events.length?T('<span class="auto-event-heading">RECENT DECISIONS</span>')+events.map(e=>TT`<div><b>${fmt(e.t/1000,1)} s · ${e.from} → ${e.to}</b><span>${esc(T(e.reason))}</span></div>`).join(''):'';
}
function inspector(){const n=node(),g=group();if(!n||!g)return;$('selected-id').textContent=scope==='group'?g.id:n.id;$('selected-name').textContent=modelName(g);$('selected-subtitle').textContent=scope==='group'?TT`${g.count} nodes · whole-group settings`:(n.draining?T('Draining · finishing accepted work'):TT`Node ${n.index} of ${g.count} · FIFO queue`);$('selected-symbol').textContent=ownOutgoing(g).length?'◇':'▤';
 const service=scope==='group'?g.service:n.service,workers=scope==='group'?g.workers:n.workers;inputValue('service',service);inputValue('workers',workers);$('service-out').textContent=fmt(service)+T(' ms');$('workers-out').textContent=fmt(workers);inputValue('node-count',g.count);inputValue('fault',n.state);
 const ik=g.id+'/'+selectedResource;if(inspectorKey!==ik){document.querySelector('.timeout-settings').open=ownOutgoing(resourceDef()||g).length>0;inspectorKey=ik;}
 document.querySelectorAll('[data-scope]').forEach(b=>b.classList.toggle('active',b.dataset.scope===scope));renderAutoScale();renderResourceInspector();
}
function renderSelection(){document.querySelectorAll('.box').forEach(b=>{const n=state.nodes.find(n=>n.id===b.dataset.node);b.classList.toggle('selected',scope==='group'?n?.group===node()?.group:n?.id===selected);b.setAttribute('aria-pressed',String(b.classList.contains('selected')));});}
function drawWires(){if(!state)return;const area=$('topology'),rect=area.getBoundingClientRect(),svg=$('wires');svg.setAttribute('width',area.scrollWidth);svg.style.width=area.scrollWidth+'px';svg.innerHTML='<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" style="fill:#a9b8d3;stroke:none"/></marker></defs>';
 const boxes=new Map([...document.querySelectorAll('.group')].map(el=>[el.dataset.group,el]));
 for(const g of config.groups)for(const e of allOutgoing(g).filter(e=>e.target)){const a=boxes.get(g.id)?.getBoundingClientRect(),b=boxes.get(e.target)?.getBoundingClientRect();if(!a||!b)continue;const x1=a.right-rect.left+area.scrollLeft,y1=a.top+a.height/2-rect.top,x2=b.left-rect.left+area.scrollLeft,y2=b.top+b.height/2-rect.top;const d=`M${x1},${y1} C${x1+25},${y1} ${x2-25},${y2} ${x2},${y2}`;svg.insertAdjacentHTML('beforeend',`<path d="${d}" marker-end="url(#arrow)"/><path class="flow" d="${d}"/>`);}}
function renderNodes(){for(const n of state.nodes){const box=[...document.querySelectorAll('.box')].find(b=>b.dataset.node===n.id);if(!box)continue;box.classList.toggle('unhealthy',n.state!=='healthy');box.classList.toggle('draining',n.draining);box.querySelector('.box-title span').textContent=n.id+(n.draining?' · drain':'');box.querySelector('.box-placement').textContent=labelsText(n.labels);box.title=TT`${n.id} · ${fmt(n.rps,1)} departures/s · ${fmt(n.w)} ms in box · errors ${fmt(n.errorRate,1)}%`;const count=Math.min(n.workers,48),grid=box.querySelector('.worker-grid');let cells='';for(let i=0;i<count;i++){const index=n.workers>48?Math.floor(i*n.workers/count):i;const phase=index<n.active?(n.phases[Math.min(index,n.phases.length-1)]||'local'):'';cells+=`<i class="worker-cell ${phase}" title="${phase||T('idle')}"></i>`;}grid.innerHTML=cells;const values=box.querySelectorAll('.box-stats span');values[0].textContent=TT`${n.active}/${n.workers} busy`;values[1].textContent=n.queue?`Q ${n.queue}`:TT`${fmt(n.rps)} /s`;values[1].classList.toggle('has-queue',n.queue>0);box.querySelector('.queue-track span').style.width=Math.min(100,n.queue/Math.max(n.workers,1)*20)+'%';fillResourceBars(box,config.groups.find(g=>g.id===n.group),n);}
 for(const el of document.querySelectorAll('.group-summary')){const gid=el.parentElement.dataset.group,g=config.groups.find(g=>g.id===gid),ns=state.nodes.filter(n=>n.group===gid&&!n.retired),v=combineViews(ns);el.querySelector('p').textContent=`${v.active}/${v.workers} · Q ${v.queue}`;fillResourceBars(el,g,ns[0],true);}
 renderSelection();}
function aggregate(){const n=node();if(selectedResource){const r=resourceDef();return r?combineViews(resourceViews(group(),n,r,scope==='group',true)):n;}if(scope==='node')return n;const ns=state.nodes.filter(v=>v.group===n.group),o={...n};for(const k of ['active','workers','queue','rps','l','lambda','little','unfinished','exited'])o[k]=ns.reduce((s,n)=>s+(k==='workers'&&n.retired?0:n[k]),0);o.meanW=o.exited?ns.reduce((s,n)=>s+n.meanW*n.exited,0)/o.exited:0;for(const k of ['w','wQueue','wLocal','wChildren'])o[k]=o.rps?ns.reduce((s,n)=>s+n[k]*n.rps,0)/o.rps:0;return o;}
function renderLittle(){const n=aggregate();if(!n)return;$('little-l').textContent=fmt(n.l,2);$('little-lambda').textContent=fmt(n.lambda,1);$('little-w').textContent=fmt(n.meanW/1000,3);$('little-accounting').textContent=TT`${fmt(n.l,2)} = ${fmt(n.little,2)} + ${fmt(n.unfinished,2)} unfinished`;const total=n.w||1;const data=[[T('Queue'),n.wQueue,'#d99b35'],[T('Local processing'),n.wLocal,'#4464e8'],[T('Waiting for children'),n.wChildren,'#aebde9']];$('residence-bar').innerHTML=data.map(([l,v,c])=>TT`<span style="width:${v/total*100}%;background:${c}" title="${l}: ${fmt(v)} ms"></span>`).join('');$('residence-values').innerHTML=data.map(([l,v,c])=>TT`<div><span><i class="dot" style="background:${c};margin-right:5px"></i>${l}</span><b>${fmt(v,1)} ms</b></div>`).join('');}
function insight(){const m=state.metrics,ns=[...state.nodes,...(state.resources||[])];let title=T('The system keeps up with traffic'),text=T('Increase database processing time or request weight. Watch queues and child wait time in upstream boxes.'),warning=false;const worst=[...ns].sort((a,b)=>b.queue-a.queue)[0];if(m.ghosts){title=TT`${m.ghosts} workers are still running after the user response`;text=T('Cancellation is disabled: a short timeout ends the wait but leaves work running. Enable cancellation propagation and compare.');warning=true;}else if(worst?.queue>3){title=TT`Queue at ${worst.id}: ${worst.queue} requests`;text=TT`Busy: ${worst.active} of ${worst.workers} workers. The oldest request has waited ${fmt(worst.oldest)} ms. Check processing and downstream wait time.`;warning=true;}else if(m.errorRate>2){title=TT`${fmt(m.errorRate,1)}% of users receive an error`;text=T('Compare the call budget with network, queue and processing time. Open a failed trace to find where it breaks.');warning=true;}else if(ns.some(n=>!n.retired&&n.state!=='healthy')){title=T('The system has an unhealthy node');text=T('Traffic continues. This model does not automatically remove unhealthy nodes: routing and timeouts determine the impact.');warning=true;}const el=$('insight');el.classList.toggle('warning',warning);el.querySelector('strong').textContent=title;el.querySelector('p').textContent=text;}
function canvasContext(id){const c=$(id),r=c.getBoundingClientRect(),d=devicePixelRatio||1;if(c.width!==Math.round(r.width*d)||c.height!==Math.round(r.height*d)){c.width=Math.round(r.width*d);c.height=Math.round(r.height*d);}const ctx=c.getContext('2d');ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,r.width,r.height);return {ctx,w:r.width,h:r.height};}
function spark(id,key,color){const {ctx,w,h}=canvasContext(id);const data=(state.history||[]).slice(-50);if(data.length<2)return;const max=Math.max(...data.map(p=>p[key]),1);ctx.beginPath();data.forEach((p,i)=>{const x=i/(data.length-1)*w,y=h-3-p[key]/max*(h-7);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.stroke();}
function charts(){spark('spark-goodput','goodput','#15957e');spark('spark-p95','p95','#4464e8');spark('spark-error','errorRate','#d26462');spark('spark-pending','pending','#d99b35');const {ctx,w,h}=canvasContext('load-chart');const data=state.history||[];if(!data.length)return;const left=30,right=w-8,top=8,bottom=h-23,max=Math.max(10,...data.flatMap(p=>[p.queue,p.busy]));ctx.font='9px ui-monospace,monospace';ctx.textBaseline='middle';for(let i=0;i<=3;i++){const y=top+(bottom-top)*i/3;ctx.strokeStyle='#edf0f5';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle='#9ca6b6';ctx.fillText(fmt(max*(1-i/3)),0,y);}const start=Math.max(0,state.t-60000),span=Math.max(1000,state.t-start);for(const [key,color]of [['busy','#4464e8'],['queue','#d99b35']]){ctx.beginPath();data.forEach((p,i)=>{const x=left+(p.t-start)/span*(right-left),y=bottom-p[key]/max*(bottom-top);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.strokeStyle=color;ctx.lineWidth=1.7;ctx.stroke();}ctx.fillStyle='#9ca6b6';ctx.fillText(TT`${fmt(start/1000)} s`,left,h-6);ctx.textAlign='right';ctx.fillText(TT`${fmt(state.t/1000)} s`,right,h-6);ctx.textAlign='left';}
let lastFocusID=null,manualInputsReady=false;
function renderRequestMode(){
 const manual=!!state.manualMode;
 $('request-mode').value=manual?'single':'load';
 $('single-request').hidden=!manual;
 for(const id of ['rps','weight','spread','deadline'])$(id).disabled=manual;
  if(!manualInputsReady){$('single-weight').value=config.weight;$('single-deadline').value=config.deadline;$('single-labels').value=labelsLines(config.requestLabels);manualInputsReady=true;}
 $('send-request').disabled=!manual||state.focusRunning;
 $('request-status').textContent=!state.focus?T('Ready to send one request.'):state.focusRunning?(state.focus.end>=0?T('User response received; downstream work is still running.'):T('Request in progress. Pause or step to inspect.')):T('Request finished. Send another to reuse connections.');
}
$('request-mode').onchange=()=>send({type:'mode',manual:$('request-mode').value==='single'});
$('single-request').onsubmit=event=>{
 event.preventDefault();if(!config||!$('single-request').reportValidity())return;
 try{const request={weight:$('single-weight').valueAsNumber,deadline:$('single-deadline').valueAsNumber,labels:parseLabels($('single-labels').value)};$('send-request').disabled=true;send({type:'request',request});}
 catch(error){toast(error.message);$('send-request').disabled=!!state.focusRunning;}
};
$('request-step').onclick=()=>send({type:'step',ms:10});
function traces(force=false){
 if(force||(!traceID&&state.t-traceAutoAt>2000)){
  traceAutoAt=state.t;traceCache=clone(state.recent||[]).slice(0,10);
  if(traceCache.length&&!traceID)traceID=traceCache[0].id;
 }
 if(state.focus){
  if(!traceID&&state.manualMode)traceID=state.focus.id;
  if(lastFocusID!==state.focus.id){lastFocusID=state.focus.id;traceID=state.focus.id;expandedSpans.clear();}
  const i=traceCache.findIndex(t=>t.id===state.focus.id);
  if(i>=0)traceCache[i]=clone(state.focus);else {traceCache.unshift(clone(state.focus));traceCache=traceCache.slice(0,24);}
 }
 const newer=(state.recent||[]).find(t=>t.id===traceID);
 if(newer){const i=traceCache.findIndex(t=>t.id===traceID);if(i>=0)traceCache[i]=clone(newer);}
 renderTraceList();renderTrace();
}
function renderTraceList(){
 const list=$('trace-list'),buttons=new Map([...list.children].map(b=>[+b.dataset.trace,b]));
 // Keep each button alive across snapshots so pointer presses and keyboard focus survive.
 traceCache.forEach((t,index)=>{
  let button=buttons.get(t.id);
  if(!button){
   button=document.createElement('button');button.type='button';button.dataset.trace=t.id;
   button.append(document.createElement('i'),document.createTextNode(`#${t.id} `),document.createElement('span'));
   button.onclick=()=>{traceID=t.id;expandedSpans.clear();renderTraceList();renderTrace();};
  }
  button.className=`trace-chip ${t.end<0?'pending':t.ok?'':'error'} ${t.id===traceID?'active':''}`;
  button.setAttribute('aria-pressed',String(t.id===traceID));
  button.firstElementChild.className=`dot ${t.end<0?'blue':t.ok?'green':'red'}`;
  const duration=`${fmt((t.end<0?state.t:t.end)-t.start)}${T(' ms')}`;
  if(button.lastElementChild.textContent!==duration)button.lastElementChild.textContent=duration;
  if(list.children[index]!==button)list.insertBefore(button,list.children[index]||null);
  buttons.delete(t.id);
 });
 for(const button of buttons.values())button.remove();
}
function renderTrace(){
 const trace=traceCache.find(t=>t.id===traceID);
 for(const box of document.querySelectorAll('.box'))box.classList.toggle('trace-path',!!(state.manualMode&&trace?.manual&&trace.spans.some(s=>s.node===box.dataset.node)));
 if(!trace)return;
 const end=Math.max(trace.end<0?state.t:trace.end,...trace.spans.map(s=>Math.max(s.end<0?state.t:s.end,s.reply))),duration=Math.max(1,end-trace.start);
 const resourceParents=new Set(trace.spans.filter(s=>s.resource).map(s=>s.parent));
 const ordered=[];
 const children=new Map();for(const span of trace.spans){if(!children.has(span.parent))children.set(span.parent,[]);children.get(span.parent).push(span);}
 const visit=(parent,depth)=>{for(const span of children.get(parent)||[]){ordered.push({...span,depth});visit(span.id,depth+1);}};visit(0,0);
 const visible=trace.manual?ordered:trace.spans.filter(s=>!s.resource||expandedSpans.has(s.parent));
 const rows=visible.slice(0,trace.manual?visible.length:64).map(s=>{
  const finish=s.end<0?Math.min(state.t,end):s.end,start=s.arrive<0?finish:s.arrive,work=s.workStart<0?finish:s.workStart,local=s.localEnd<0?finish:s.localEnd;
  const pieces=[['network',s.start,start],['queue',start,work],['local',work,local],['children',local,finish]];if(s.reply>finish)pieces.push(['network',finish,s.reply]);
  const segments=pieces.filter(p=>p[2]>p[1]).map(([kind,a,b])=>`<span class="trace-segment trace-${kind}" style="left:${Math.max(0,(a-trace.start)/duration*100)}%;width:${Math.min(100,(b-a)/duration*100)}%" title="${kind}: ${fmt(b-a,1)}${T(' ms')}"></span>`).join('');
  const expand=!trace.manual&&resourceParents.has(s.id)?`<button class="trace-expand" data-span="${s.id}" aria-expanded="${expandedSpans.has(s.id)}" aria-label="${esc(T('Show resources'))}">${expandedSpans.has(s.id)?'▾':'▸'}</button>`:'';
  const label=s.resource?modelName({name:s.resourceName||s.resource,i18n:s.resourceI18n}):s.node;
  return `<div class="trace-row ${s.resource?'resource-row':''}" title="${esc(s.node)} · ${esc(T(reasons[s.status]||s.status))}"><span style="padding-left:${trace.manual?Math.min(s.depth,8)*8:0}px">${trace.manual?`<small>#${s.id} </small>`:''}${expand}${s.resource?'↳ ':s.parent?'↳ ':''}${esc(label)}${s.attempt>1?' ↻'+s.attempt:''}</span><div class="trace-track">${segments}</div><span>${fmt(Math.max(0,finish-start))}${T(' ms')}</span></div>${traceConnection(s)}${traceLocality(s)}`;
 }).join('');
 const markup=`<div class="trace-summary"><strong>trace #${trace.id}</strong><span class="trace-tags">${esc(labelsText(trace.labels))}</span><span>${T('Request weight')} ${fmt(trace.weight,2)}×</span><span>${fmt((trace.end<0?state.t:trace.end)-trace.start,1)}${T(' ms')}</span><span class="result ${trace.end<0?'':trace.ok?'':'error'}">${esc(T(trace.end<0?'In progress':reasons[trace.reason]||trace.reason))}</span></div>${rows}<div class="trace-legend"><span><i class="dot" style="background:#dce3ef"></i>${T('Network / connect')}</span><span><i class="dot amber"></i>${T('Queue')}</span><span><i class="dot blue"></i>${T('Processing')}</span><span><i class="dot" style="background:#aebde9"></i>${T('Waiting for children')}</span></div><div class="trace-caption">${T(trace.manual?'All service and resource visits are shown. Nested row durations must not be added together.':'Click ▸ next to a service to reveal its internal resources. Nested row durations must not be added together.')}${!trace.manual&&visible.length>64?' · 64 / '+visible.length:''}</div>${trace.manual?renderTraceEvents(trace):''}`;
 if(markup===lastTraceMarkup)return;lastTraceMarkup=markup;const scroll=$('trace-events')?.scrollTop||0;$('trace-detail').innerHTML=markup;if($('trace-events'))$('trace-events').scrollTop=scroll;
 for(const b of $('trace-detail').querySelectorAll('[data-span]'))b.onclick=()=>{const id=+b.dataset.span;expandedSpans.has(id)?expandedSpans.delete(id):expandedSpans.add(id);renderTrace();};
}
function render(){if(!state)return;const m=state.metrics;document.body.classList.toggle('paused',paused);$('live-state').textContent=paused?T('Paused'):T('Simulation running');$('live-state').classList.toggle('paused',paused);$('pause').textContent=paused?T('▶ Resume'):T('Ⅱ Pause');const sec=state.t/1000;$('clock').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${(sec%60).toFixed(1).padStart(4,'0')}`;$('goodput').textContent=fmt(m.goodput,1);$('p95').textContent=m.goodput?fmt(m.p95):'—';$('error-rate').textContent=fmt(m.errorRate,1);$('error-rate').style.color=m.errorRate>1?'var(--red)':'';$('pending').textContent=fmt(m.pending);$('rps-foot').textContent=state.manualMode?T('Single request · background arrivals stopped'):TT`out of ${fmt(config.rps)} incoming /s`;$('queue-foot').textContent=TT`Queued: ${fmt(m.queue)}`;$('ghost-foot').textContent=m.ghosts?TT` · ${m.ghosts} after response`:'';globalControls();buildGraph();renderNodes();inspector();renderLittle();insight();charts();traces();}
worker.onmessage=({data})=>{
 const resourceReply=$('resources-dialog').dataset.pending&&data.requestId===Number($('resources-dialog').dataset.requestId);
 const configReply=$('config-dialog').dataset.pending&&data.requestId===Number($('config-dialog').dataset.requestId);
 if(data.type==='error'){
  if(data.requestId===pendingResetID)pendingResetID=0;
  if(resourceReply){delete $('resources-dialog').dataset.pending;$('resources-error').textContent=T(data.message);}
  if(configReply)delete $('config-dialog').dataset.pending;
  toast(T(data.message));$('config-error').textContent=T(data.message);
  if(state){config=clone(state.config);renderRequestMode();}return;
 }
 if(data.type!=='snapshot')return;
 if(data.requestId===pendingResetID){pendingResetID=0;clearTraces();graphKey='';}
 if(resourceReply){const restart=$('resources-dialog').dataset.pending==='restart';delete $('resources-dialog').dataset.pending;$('resources-dialog').close();toast(T(restart?'Structure applied. Experiment restarted.':'Changes applied without reset.'));}
 if(configReply){delete $('config-dialog').dataset.pending;$('config-dialog').close();toast(T('Model applied.'));}
 const selectedGroup=node()?.group;state=data.data;config=clone(state.config);I18n.setModelLanguages(config);
 if(!initial){initial=clone(config);document.querySelectorAll('[data-scenario]').forEach(b=>b.disabled=false);selectScenario(scenarioFromURL(),{historyMode:'replace',notify:false});return;}
 if(!state.nodes.some(n=>n.id===selected&&!n.retired))selected=(state.nodes.find(n=>n.group===selectedGroup&&!n.retired)||state.nodes.find(n=>!n.retired)).id;
 paused=data.paused;render();
};worker.onerror=e=>{toast(T('Engine startup error: ')+e.message);$('live-state').textContent=T('Loading failed');};
for(const id of ['rps','weight','network','deadline'])$(id).addEventListener('input',()=>{sliderFill($(id));change(c=>c[id]=+$(id).value);});
for(const id of ['spread','jitter'])$(id).addEventListener('change',()=>{change(c=>c[id]=+$(id).value);});$('seed').addEventListener('change',()=>{change(c=>c.seed=+$('seed').value);toast(T('Seed saved; press ↺ to start a new experiment.'));});
$('cancel').onchange=()=>change(c=>c.cancel=$('cancel').checked);
$('pause').onclick=()=>send({type:'pause'});$('step').onclick=()=>send({type:'step'});$('speed').onchange=()=>send({type:'speed',value:+$('speed').value});$('reset').onclick=()=>{change(()=>{},{reset:true});toast(T('Experiment restarted with the current settings.'));};
$('scope').querySelectorAll('button').forEach(b=>b.onclick=()=>{scope=b.dataset.scope;inspector();renderSelection();renderLittle();});
for(const id of ['service','workers'])$(id).oninput=()=>{const n=node(),g=group(),value=+$(id).value;sliderFill($(id));if(scope==='group')change(c=>{c.groups.find(v=>v.id===g.id)[id]=value;for(const n of state.nodes.filter(n=>n.group===g.id&&!n.retired)){if(c.overrides?.[n.id])delete c.overrides[n.id][id];}});else send({type:'node',id:n.id,[id]:value});};
$('node-count').onchange=()=>{const id=group().id,value=+$('node-count').value;if(!Number.isInteger(value)||value<1||value>16){toast(T('A group can contain between 1 and 16 nodes.'));$('node-count').value=group().count;return;}change(c=>{c.groups.find(g=>g.id===id).count=value;});};
$('retry-connect').onchange=()=>setDownstream('retryConnect',$('retry-connect').checked);
$('fault').onchange=()=>{const targets=scope==='group'?state.nodes.filter(n=>n.group===node().group&&!n.retired):[node()];for(const n of targets)send({type:'node',id:n.id,state:$('fault').value});};
$('auto-enabled').onchange=()=>{const gid=group().id,enabled=$('auto-enabled').checked;$('auto-controls').open=enabled;change(c=>{c.groups.find(g=>g.id===gid).autoscale.enabled=enabled;});};
for(const [id,[key,factor]] of Object.entries(autoFields))$(id).onchange=()=>{
 const el=$(id),value=el.valueAsNumber;
 if(!el.value||!el.checkValidity()||!Number.isFinite(value)){toast(T('Check the autoscaler setting value.'));el.value=group().autoscale[key]/factor;return;}
 const gid=group().id;change(c=>{c.groups.find(g=>g.id===gid).autoscale[key]=value*factor;});
};
$('refresh-traces').onclick=()=>{traceID=null;traces(true);};
// Only the preset is shared; live experiment settings remain in the JSON export.
const scenarioIDs=new Set([...document.querySelectorAll('[data-scenario]')].map(b=>b.dataset.scenario));
let selectedScenario=null;
function scenarioFromURL(){const id=new URLSearchParams(location.hash.slice(1)).get('template');return scenarioIDs.has(id)?id:'normal';}
function updateScenarioURL(which,mode){
 const url=new URL(location.href);const hash=new URLSearchParams(url.hash.slice(1));hash.set('template',which);url.hash=hash.toString();
 if(url.href!==location.href)history[mode==='push'?'pushState':'replaceState'](null,'',url);
}
function selectScenario(which,{historyMode='push',notify=true}={}){
 if(!initial||!scenarioIDs.has(which))return;
 selectedScenario=which;updateScenarioURL(which,historyMode);
 document.querySelectorAll('[data-scenario]').forEach(b=>b.classList.toggle('active',b.dataset.scenario===which));
 clearTraces();selectedResource=which==='slow'?'storage':'';collapsedGroups.clear();graphKey='';autoGroupKey='';
 selected=which==='numa'?'cpu-1':which==='az'?'lb-1':['hang','autoscale','composition'].includes(which)?'api-1':'db-1';scope=which==='autoscale'?'group':'node';
 send({type:'preset',preset:which});
 if(notify)toast(T('Scenario started with the original seed.'));
}
document.querySelectorAll('[data-scenario]').forEach(b=>b.onclick=()=>selectScenario(b.dataset.scenario));
function restoreScenarioFromURL(){const which=scenarioFromURL();if(initial&&which!==selectedScenario)selectScenario(which,{historyMode:'replace',notify:false});}
window.addEventListener('popstate',restoreScenarioFromURL);
window.addEventListener('hashchange',restoreScenarioFromURL);

$('edit-config').onclick=()=>{$('config-editor').value=JSON.stringify(config,null,2);$('config-error').textContent=T('Import restarts the experiment.');$('config-dialog').showModal();};$('apply-config').onclick=()=>{try{const c=JSON.parse($('config-editor').value);const requestId=send({type:'reset',config:c});clearTraces();graphKey='';$('config-dialog').dataset.pending='true';$('config-dialog').dataset.requestId=requestId;}catch(e){$('config-error').textContent=T('Invalid JSON: ')+e.message;}};
$('model-info').onclick=()=>$('info-dialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('export').onclick=()=>{if(!config)return;const blob=new Blob([JSON.stringify(config,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='boxes-model.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(T('Model saved: groups and per-node settings.'));};
let resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{drawWires();if(state)charts();},100);});
document.querySelectorAll('input[type=range]').forEach(sliderFill);
document.querySelector('.center-column').insertBefore(document.querySelector('.little-panel'),document.querySelector('.chart-panel'));


// Composition is configured per group; inspection can select one owned resource
// or aggregate all copies. Shared resources appear once in group metrics.
let selectedResource='',resourceTabsKey='',autoSourceKey='',resourceDraft=null,lastTraceMarkup='';
const collapsedGroups=new Map(), expandedSpans=new Set();
function resourceEntries(g,prefix='',shared=false,depth=0){return (g?.resources||[]).flatMap(r=>{const path=prefix?prefix+'/'+r.id:r.id,common=shared||r.scope==='shared';return [{path,def:r,shared:common,depth},...resourceEntries(r,path,common,depth+1)];});}
function definitionAt(g,path){for(const id of path.split('/').filter(Boolean)){g=g?.resources?.find(r=>r.id===id);}return g;}
function allOutgoing(g){return [...ownOutgoing(g),...(g.resources||[]).flatMap(allOutgoing)];}
function ownOutgoing(g){return g.stages.flatMap(s=>s.calls);}
function resourceDef(){return selectedResource?definitionAt(group(),selectedResource):null;}
function resourceViews(g,n,r,all=false,history=false){const entry=resourceEntries(g).find(e=>e.def===r);return entry?(state.resources||[]).filter(v=>v.group===g.id&&v.resource===entry.path&&(history||!v.retired)&&(v.index===0||all||v.index===n.index)):[];}
function isSharedResource(){return resourceEntries(group()).find(e=>e.path===selectedResource)?.shared||false;}
function combineViews(ns){
 const o={active:0,workers:0,queue:0,rps:0,l:0,lambda:0,little:0,unfinished:0,exited:0,meanW:0,w:0,wQueue:0,wLocal:0,wChildren:0,utilization:0,errorRate:0};
 for(const n of ns){for(const k of ['active','queue','rps','l','lambda','little','unfinished','exited'])o[k]+=n[k]||0;if(!n.retired)o.workers+=n.workers;}
 o.meanW=o.exited?ns.reduce((sum,n)=>sum+n.meanW*n.exited,0)/o.exited:0;
 for(const k of ['w','wQueue','wLocal','wChildren','errorRate'])o[k]=o.rps?ns.reduce((sum,n)=>sum+n[k]*n.rps,0)/o.rps:0;
 const capacity=ns.reduce((sum,n)=>sum+(n.loadCapacity||0),0);o.utilization=capacity?ns.reduce((sum,n)=>sum+(n.loadBusy||0),0)/capacity*100:0;
 return o;
}

function stageName(s){return s.calls.map(e=>(e.target||e.resource)+(Object.keys(e.when||{}).length?' ['+labelsText(e.when)+']':'')).join(' ∥ ')+(Object.keys(s.when||{}).length?' ['+labelsText(s.when)+']':'');}
function resourceBars(g){return resourceEntries(g).map(({path,def:r,shared,depth})=>`<button class="resource-bar" data-resource="${esc(path)}" title="${esc(path)}"><span>${'↳ '.repeat(depth)}${esc(modelName(r))}${shared?' ◇':''}</span><span class="meter"><i></i></span><b>—</b></button>`).join('');}
function fillResourceBars(root,g,n,all=false){for(const bar of root.querySelectorAll('.resource-bar')){
 const r=definitionAt(g,bar.dataset.resource),ns=resourceViews(g,n,r,all),v=combineViews(ns),max=Math.max(0,...ns.map(v=>v.utilization));
 bar.querySelector('.meter i').style.width=Math.min(100,v.utilization)+'%';bar.classList.toggle('hot',v.utilization>80||v.queue>0);
 bar.querySelector('b').textContent=`${fmt(v.utilization)}%${all?' / '+fmt(max)+'%':''}${v.queue?' · Q '+v.queue:''}`;
 bar.title=`${modelName(r)} · ${T('Utilization')}: ${fmt(v.utilization,1)}%${all?' · max '+fmt(max,1)+'%':''} · Q ${v.queue}`;
}}
function bindResourceBars(root,g,n,all=false){for(const b of root.querySelectorAll('.resource-bar'))b.onclick=e=>{e.stopPropagation();selected=n.id;selectedResource=b.dataset.resource;if(all)scope='group';inspector();renderSelection();renderLittle();};}
function buildGraph(){
 const key=JSON.stringify([I18n.locale(),config.name,config.i18n,config.groups.map(g=>[g.id,g.count,g.name,g.i18n,allOutgoing(g),resourceEntries(g).map(({path,def:r})=>[path,r.name,r.i18n,r.scope]),g.id===config.entry,g.autoscale?.enabled,collapsedGroups.get(g.id)]),state.nodes.filter(n=>!n.retired).map(n=>[n.id,n.draining])]);
 if(key===graphKey)return;graphKey=key;$('topology-name').textContent=modelName(config);const root=$('groups');root.innerHTML='';
 const multi=config.groups.length>3;root.style.minWidth=multi?config.groups.length*180+'px':'';$('topology').style.overflowX=multi?'auto':'';
 for(const g of config.groups){
  const ns=state.nodes.filter(n=>n.group===g.id&&!n.retired),fold=collapsedGroups.has(g.id)?collapsedGroups.get(g.id):ns.length>6;
  const el=document.createElement('section');el.className='group';el.dataset.group=g.id;el.style.width=`${100/config.groups.length}%`;
  el.innerHTML=`<div class="group-title">${esc(modelName(g))}<span>${g.autoscale?.enabled?T('AUTO · '):''}${g.id===config.entry?T('ENTRY · '):''}×${g.count}</span>${ns.length>1?`<button class="group-toggle" aria-label="${esc(T(fold?'Show nodes':'Collapse group'))}" aria-expanded="${!fold}">${fold?'＋':'−'}</button>`:''}</div>`;
  const toggle=el.querySelector('.group-toggle');if(toggle)toggle.onclick=()=>{collapsedGroups.set(g.id,!fold);graphKey='';buildGraph();renderNodes();};
  if(fold){
   const card=document.createElement('div');card.className='group-summary';card.innerHTML=`<button>${esc(modelName(g))} ×${g.count}</button><p></p><div class="resource-bars">${resourceBars(g)}</div>`;
   card.querySelector('button').onclick=()=>{selected=ns[0].id;selectedResource='';scope='group';inspector();renderSelection();renderLittle();};bindResourceBars(card,g,ns[0],true);el.append(card);
  }else for(const n of ns){
   const box=document.createElement('div');box.className='box';box.dataset.node=n.id;
   box.innerHTML='<button class="node-select"><div class="box-title"><span></span><i class="health"></i></div></button><div class="box-placement"></div><div class="worker-grid"></div><div class="box-stats"><span></span><span></span></div><div class="queue-track"><span></span></div>'+((g.resources||[]).length?'<div class="resource-bars">'+resourceBars(g)+'</div>':'');
   box.querySelector('.node-select').setAttribute('aria-label',TT`Settings for ${n.id}`);
   box.onclick=()=>{selected=n.id;selectedResource='';renderSelection();inspector();renderLittle();};bindResourceBars(box,g,n);el.append(box);
  }
  const foot=document.createElement('div');foot.className='group-foot';foot.textContent=allOutgoing(g).some(e=>e.target)?allOutgoing(g).filter(e=>e.target).map(e=>`→ ${e.target} ×${e.calls}${Object.keys(e.when||{}).length?' ['+labelsText(e.when)+']':''}`).join(' · '):T('return response ↩');el.append(foot);root.append(el);
 }
 document.querySelector('.topology-loading')?.remove();requestAnimationFrame(drawWires);
}
function renderResourceInspector(){
 const g=group(),n=node();if(!g||!n)return;
 if(selectedResource&&!definitionAt(g,selectedResource))selectedResource='';
 const key=JSON.stringify([g.id,resourceEntries(g).map(({path,def:r})=>[path,r.name,r.i18n]),selectedResource,I18n.locale()]);
 if(key!==resourceTabsKey){resourceTabsKey=key;$('resource-tabs').innerHTML=[{id:'',name:T('Requests')},...resourceEntries(g).map(({path,def:r,depth})=>({id:path,name:'↳ '.repeat(depth)+modelName(r)}))].map(r=>`<button role="tab" aria-selected="${selectedResource===r.id}" class="${selectedResource===r.id?'active':''}" data-tab-resource="${esc(r.id)}">${esc(modelName(r))}</button>`).join('');
  for(const b of $('resource-tabs').querySelectorAll('button'))b.onclick=()=>{selectedResource=b.dataset.tabResource;inspector();renderLittle();};
 }
 const def=resourceDef()||g,plan=def.stages.map(s=>stageName(s));$('execution-path').textContent=plan.length?plan.join(' → '):T('Return after local processing');
 $('request-settings').hidden=!!selectedResource;$('resource-panel').hidden=!selectedResource;
 const littleTitle=document.querySelector('.little-panel h2');littleTitle.textContent=T('Little’s law')+(selectedResource?' · '+modelName(resourceDef()):'');
 renderLocalityInspector();
 renderDownstreamControls(n,g);
 if(!selectedResource)return;
 const r=resourceDef(),ns=resourceViews(g,n,r,scope==='group'),one=ns[0],v=combineViews(ns);
 $('resource-ownership').textContent=T(isSharedResource()?'Shared group resource — scaling the group does not add capacity here.':scope==='group'?'A private resource per instance. Settings apply to the whole group.':'A private resource of the selected instance.');
 inputValue('resource-name',r.name);inputValue('resource-work',scope==='group'||isSharedResource()?r.service:one?.service??r.service);inputValue('resource-workers',scope==='group'||isSharedResource()?r.workers:one?.workers??r.workers);inputValue('resource-fault',one?.state||'healthy');
 $('resource-work-out').textContent=fmt(+$('resource-work').value,1)+T(' ms');$('resource-workers-out').textContent=fmt(+$('resource-workers').value);
 $('resource-util').textContent=fmt(v.utilization,1)+'%';$('resource-queue').textContent=fmt(v.queue);$('resource-latency').textContent=fmt(v.w,1);
}
function updateResourceSetting(field,value){
 const r=resourceDef(),g=group(),n=node();if(!r)return;
 if(field==='name'||scope==='group'||isSharedResource())change(c=>{definitionAt(c.groups.find(v=>v.id===g.id),selectedResource)[field]=value;
  if(field!=='name')for(const v of resourceViews(g,n,r,true))if(c.overrides?.[v.id])delete c.overrides[v.id][field];
 });else{const v=resourceViews(g,n,r)[0];if(v)send({type:'node',id:v.id,[field]:value});}
}
$('resource-name').onchange=()=>{const value=$('resource-name').value.trim();if(value)updateResourceSetting('name',value);else $('resource-name').value=resourceDef().name;};
for(const [id,field]of [['resource-work','service'],['resource-workers','workers']])$(id).oninput=()=>{sliderFill($(id));updateResourceSetting(field,+$(id).value);};
$('resource-fault').onchange=()=>{for(const n of resourceViews(group(),node(),resourceDef(),scope==='group'))send({type:'node',id:n.id,state:$('resource-fault').value});};
function renderAutoSource(){
 const g=group(),p=g.autoscale,key=JSON.stringify([g.id,resourceEntries(g).map(({path,def:r})=>[path,r.name,r.i18n]),I18n.locale()]);
 if(autoSourceKey!==key){autoSourceKey=key;$('auto-resource').innerHTML='<option value="">'+esc(T('Request handlers'))+'</option>'+resourceEntries(g).map(({path,def:r})=>`<option value="${esc(path)}">${esc(path)} · ${esc(modelName(r))}</option>`).join('');}
 inputValue('auto-resource',p.resource||'');inputValue('auto-signal',p.signal||'queue');
 const r=p.resource?definitionAt(g,p.resource):null,shared=resourceEntries(g).find(e=>e.path===p.resource)?.shared;
 $('auto-source-note').textContent=T(shared?'This resource is shared: adding service instances does not increase its capacity.':r?'The entire group scales together with its per-instance resources.':'Queue and utilization of the group’s request handlers.');
 $('auto-up-util').disabled=p.signal==='queue';$('auto-up-queue').disabled=p.signal==='utilization';
}
for(const [id,key]of [['auto-resource','resource'],['auto-signal','signal']])$(id).onchange=()=>{const gid=group().id,value=$(id).value;change(c=>{c.groups.find(g=>g.id===gid).autoscale[key]=value;});};
function draftBox(){const def=definitionAt(resourceDraft.definition,resourceDraft.path);def.resources??=[];return def;}
function openResourceEditor(){const g=group();resourceDraft={group:g.id,definition:clone(g),path:selectedResource};renderResourceEditor();$('resources-error').textContent=T('Edit values live, or apply structural changes with a restart.');$('resources-dialog').showModal();}
function renderResourceEditor(){
 const d=resourceDraft,def=draftBox(),entries=[{path:'',def:d.definition,depth:0},...resourceEntries(d.definition)];
 $('program-box').innerHTML=entries.map(e=>`<option value="${esc(e.path)}" ${e.path===d.path?'selected':''}>${esc(e.path||d.group)} · ${esc(modelName(e.def))}</option>`).join('');
 $('resource-editor').innerHTML=def.resources.map(r=>`<div class="resource-edit-row" data-resource-id="${esc(r.id)}"><label>${T('Default name (EN)')}<input data-field="name" required maxlength="100" value="${esc(r.name)}"></label><label>${T('Ownership')}<select data-field="scope"><option value="instance" ${r.scope==='instance'?'selected':''}>${T('Per instance')}</option><option value="shared" ${r.scope==='shared'?'selected':''}>${T('Shared by group')}</option></select></label><label>${T('Slots')}<input type="number" required min="1" max="512" data-field="workers" value="${r.workers}"></label><label>${T('Work, ms')}<input type="number" required min="0" max="10000" step="any" data-field="service" value="${r.service}"></label><button data-open-resource="${esc(r.id)}" title="${T('Open this box')}">↳</button><button data-remove-resource="${esc(r.id)}" aria-label="${T('Remove resource')}">×</button></div>`).join('');
 for(const row of $('resource-editor').querySelectorAll('.resource-edit-row'))for(const input of row.querySelectorAll('[data-field]'))input.onchange=()=>{const r=def.resources.find(r=>r.id===row.dataset.resourceId);r[input.dataset.field]=input.type==='number'?input.valueAsNumber:input.value;};
 for(const b of $('resource-editor').querySelectorAll('[data-open-resource]'))b.onclick=()=>{d.path=[d.path,b.dataset.openResource].filter(Boolean).join('/');renderResourceEditor();};
 for(const b of $('resource-editor').querySelectorAll('[data-remove-resource]'))b.onclick=()=>{def.resources=def.resources.filter(r=>r.id!==b.dataset.removeResource);def.stages=def.stages.map(s=>({...s,calls:s.calls.filter(c=>c.resource!==b.dataset.removeResource)})).filter(s=>s.calls.length);renderResourceEditor();};
 $('add-resource').disabled=def.resources.length>=8;renderStageEditor();
}
function relativeResource(from,to){const a=from.split('/').filter(Boolean),b=to.split('/');while(a.length&&b.length&&a[0]===b[0]){a.shift();b.shift();}return [...a.map(()=>'..'),...b].join('/')||'.';}
function targetOptions(edge){
 const options=[...config.groups.map(g=>({value:'g:'+g.id,name:modelName(g)+' · '+g.id})),...resourceEntries(resourceDraft.definition).map(({path,def})=>({value:'r:'+relativeResource(resourceDraft.path,path),name:path+' · '+modelName(def)}))];
 const value=edge.resource?'r:'+edge.resource:'g:'+edge.target;
 if(!options.some(o=>o.value===value))options.push({value,name:value});
 return options.map(o=>`<option value="${esc(o.value)}" ${o.value===value?'selected':''}>${esc(o.name)}</option>`).join('');
}
function programConditionInput(when,field){return `<label>${T('Request tags · key=value')}<textarea data-condition="${field}" rows="2" spellcheck="false" placeholder="${esc(T('Empty: every request'))}">${esc(labelsLines(when))}</textarea></label>`;}
function bindCondition(input,obj){input.onchange=()=>{try{const tags=parseLabels(input.value);obj.when=tags;input.removeAttribute('aria-invalid');$('resources-error').textContent=T('Edit values live, or apply structural changes with a restart.');}catch(e){input.setAttribute('aria-invalid','true');$('resources-error').textContent=e.message;}};}
function defaultProgramCall(){const def=draftBox();return def.resources.length?{resource:def.resources[0].id,calls:1,route:'round_robin',transport:'ideal'}:{target:config.groups.find(g=>g.id!==resourceDraft.group)?.id||resourceDraft.group,calls:1,route:'round_robin',transport:'network'};}
function renderStageEditor(){
 const def=draftBox();
 $('stage-editor').innerHTML=def.stages.map((s,i)=>`<section class="program-stage" data-stage="${i}"><div class="stage-edit-row"><b>${i+1} · ${T('Parallel calls')}</b><button data-move="-1" ${i===0?'disabled':''} aria-label="${T('Move earlier')}">↑</button><button data-move="1" ${i===def.stages.length-1?'disabled':''} aria-label="${T('Move later')}">↓</button><button data-remove-stage aria-label="${T('Remove stage')}">×</button></div>
 <div class="program-fields">${programConditionInput(s.when,'stage')}<label>${T('Wait for')}<select data-join>${['all','any','quorum'].map(v=>`<option value="${v}" ${s.join===v?'selected':''}>${T(v==='all'?'All responses':v==='any'?'First success':'Quorum')}</option>`).join('')}</select></label><label>${T('Successful responses')}<input data-quorum type="number" required min="1" max="128" value="${s.quorum||1}" ${s.join!=='quorum'?'disabled':''}></label></div>
 ${s.calls.map((e,j)=>`<div class="program-call" data-call="${j}"><div class="program-fields"><label class="program-target">${T('Call target')}<select data-target>${targetOptions(e)}</select></label><label>${T('Calls')}<input data-calls type="number" required min="1" max="16" value="${e.calls}"></label><label>${T('Routing')}<select data-route>${['round_robin','random','least_busy','broadcast'].map(v=>`<option value="${v}" ${e.route===v?'selected':''}>${T({round_robin:'Round robin',random:'Random node',least_busy:'Least busy',broadcast:'Every node'}[v])}</option>`).join('')}</select></label></div><div class="program-fields"><label>${T('Link')}<select data-transport>${[['network','Network connection'],['ideal','Ideal · zero delay']].map(([v,label])=>`<option value="${v}" ${e.transport===v?'selected':''}>${T(label)}</option>`).join('')}</select></label><label>${T('One-way delay, ms')}<input data-network type="number" min="0" max="5000" step="any" placeholder="${esc(T('Model default'))}" value="${e.network??''}" ${e.transport==='ideal'?'disabled':''}></label><label>${T('Call timeout, ms')}<input data-timeout type="number" min="0" max="60000" step="any" placeholder="${esc(T('Caller default'))}" value="${e.timeout??''}" title="${esc(T('Empty inherits the caller budget. 0 adds no timeout; outer calls and the user deadline still apply.'))}"></label></div><div class="program-fields">${programConditionInput(e.when,'call')}<button data-remove-call aria-label="${T('Remove call')}" ${s.calls.length===1?'disabled':''}>×</button></div></div>`).join('')}<button data-add-call ${s.calls.length>=8?'disabled':''}>${T('+ Call')}</button></section>`).join('');
 for(const row of $('stage-editor').querySelectorAll('[data-stage]')){
  const i=+row.dataset.stage,s=def.stages[i];
  bindCondition(row.querySelector('[data-condition="stage"]'),s);
  const join=row.querySelector('[data-join]');join.onchange=()=>{s.join=join.value;if(s.join==='quorum')s.quorum=s.quorum||1;else delete s.quorum;renderStageEditor();};
  const quorum=row.querySelector('[data-quorum]');quorum.onchange=()=>s.quorum=quorum.valueAsNumber;
  for(const b of row.querySelectorAll('[data-move]'))b.onclick=()=>{const j=i+(+b.dataset.move);[def.stages[i],def.stages[j]]=[def.stages[j],def.stages[i]];renderStageEditor();};
  row.querySelector('[data-remove-stage]').onclick=()=>{def.stages.splice(i,1);renderStageEditor();};
  row.querySelector('[data-add-call]').onclick=()=>{s.calls.push(defaultProgramCall());renderStageEditor();};
  for(const call of row.querySelectorAll('[data-call]')){
   const j=+call.dataset.call,e=s.calls[j];bindCondition(call.querySelector('[data-condition="call"]'),e);
   call.querySelector('[data-target]').onchange=event=>{const [kind,...rest]=event.target.value.split(':');delete e.target;delete e.resource;e[kind==='r'?'resource':'target']=rest.join(':');};
   for(const key of ['calls','route','transport','network','timeout']){const input=call.querySelector('[data-'+key+']');input.onchange=()=>{if((key==='network'||key==='timeout')&&input.value==='')delete e[key];else e[key]=input.type==='number'?input.valueAsNumber:input.value;if(key==='transport')call.querySelector('[data-network]').disabled=input.value==='ideal';};}
   call.querySelector('[data-remove-call]').onclick=()=>{s.calls.splice(j,1);renderStageEditor();};
  }
 }
 $('add-stage').disabled=def.stages.length>=16;
}
$('program-box').onchange=()=>{resourceDraft.path=$('program-box').value;renderResourceEditor();};
$('edit-resources').onclick=openResourceEditor;
$('add-resource').onclick=()=>{const def=draftBox();let i=1;while(def.resources.some(r=>r.id==='r'+i))i++;const r={id:'r'+i,name:'Box '+i,scope:'instance',workers:1,service:5,queueLimit:500,stages:[]};def.resources.push(r);if(def.stages.length<16)def.stages.push({calls:[{resource:r.id,calls:1,route:'round_robin',transport:'ideal'}],join:'all'});renderResourceEditor();};
$('add-stage').onclick=()=>{draftBox().stages.push({calls:[defaultProgramCall()],join:'all'});renderStageEditor();};
function applyProgram(reset){
 if($('resources-dialog').querySelector('[aria-invalid="true"]'))return;
 for(const input of $('resources-dialog').querySelectorAll('input'))if(!input.reportValidity())return;
 const d=resourceDraft;
 const requestId=change(c=>{const index=c.groups.findIndex(g=>g.id===d.group),next=clone(d.definition);next.autoscale=c.groups[index].autoscale;if(next.autoscale.resource&&!definitionAt(next,next.autoscale.resource)){next.autoscale.resource='';next.autoscale.signal='queue';}c.groups[index]={...c.groups[index],resources:next.resources,stages:next.stages};
 if(reset)for(const n of state.resources||[])if(n.group===d.group){const old=resourceEntries(state.config.groups.find(g=>g.id===d.group)).find(e=>e.path===n.resource),fresh=resourceEntries(next).find(e=>e.path===n.resource);if(!fresh||old?.shared!==fresh.shared)delete c.overrides?.[n.id];}
 },{reset});
 $('resources-dialog').dataset.pending=reset?'restart':'live';$('resources-dialog').dataset.requestId=requestId;
}
$('apply-resources').onclick=()=>applyProgram(true);
$('apply-program-live').onclick=()=>applyProgram(false);

I18n.onChange(()=>{graphKey="";renderTraceList();render();$("toast").classList.remove("show");});

document.querySelectorAll('[data-scenario]').forEach(b=>b.disabled=!initial);

// The same locality editor applies to services and their internal resources.
const labelsText=m=>Object.entries(m||{}).filter(([,v])=>v!=='').sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join(' · ');
const labelsLines=m=>Object.entries(m||{}).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
let boxLocalityKey='',boxLocalityDirty=false,requestLocalityKey='',requestLocalityDirty=false;
function parseLabels(text){const m={};for(const line of text.split('\n')){if(!line.trim())continue;const i=line.indexOf('=');if(i<1)throw Error(T('Labels: one key=value per line.'));const k=line.slice(0,i).trim(),v=line.slice(i+1).trim();if(!/^[a-zA-Z0-9_.-]{1,40}$/.test(k)||v.length>80||Object.hasOwn(m,k))throw Error(T('Check label names and duplicate keys.'));Object.defineProperty(m,k,{value:v,enumerable:true,writable:true,configurable:true});}return m;}
function ruleEditor(id,cost=false){return `<div class="locality-rule"><label class="switch-row"><span>${cost?T('Adjust cost'):T('Prefer matching labels')}</span><input id="${id}-enabled" type="checkbox" role="switch"></label><label class="select-row">${T('Label source')}<select id="${id}-source"><option value="request">${T('Request')}</option><option value="caller">${T('Calling box')}</option></select></label><label class="number-row">${T('Label key')}<input id="${id}-key" type="text" maxlength="40" placeholder="az"></label>${cost?`<div class="auto-bounds"><label>${T('Match ×')}<input id="${id}-match" type="number" min="0" max="100" step="0.1"></label><label>${T('Mismatch ×')}<input id="${id}-mismatch" type="number" min="0" max="100" step="0.1"></label></div>`:''}</div>`;}
function fillRule(id,r,cost=false,source='caller'){const v=r||{enabled:false,source,key:'az',match:1,mismatch:3};$(id+'-enabled').checked=!!v.enabled;inputValue(id+'-source',v.source||source);inputValue(id+'-key',v.key||'az');if(cost){inputValue(id+'-match',v.match??1);inputValue(id+'-mismatch',v.mismatch??3);}}
function readRule(id,cost=false){const r={enabled:$(id+'-enabled').checked,source:$(id+'-source').value,key:$(id+'-key').value.trim()};if(cost){r.match=$(id+'-match').valueAsNumber;r.mismatch=$(id+'-mismatch').valueAsNumber;if(!Number.isFinite(r.match)||!Number.isFinite(r.mismatch))throw Error(T('Enter numeric multipliers.'));}return r;}
function renderRequestLocality(){
 const key=I18n.locale();if(key!==requestLocalityKey){const open=$('request-label-details')?.open||false;requestLocalityKey=key;requestLocalityDirty=false;
 $('request-locality').innerHTML=`<details id="request-label-details" ${open?'open':''}><summary>${T('Request labels')}</summary><label class="locality-label">${T('Fixed labels · key=value')}<textarea id="request-labels" rows="2" spellcheck="false"></textarea></label><label class="switch-row"><span>${T('Distribute one label')}</span><input id="request-tag-enabled" type="checkbox" role="switch"></label><label class="number-row">${T('Key')}<input id="request-tag-key" type="text" maxlength="40"></label><label class="number-row">${T('Value A')}<input id="request-tag-a" type="text" maxlength="80"></label><label class="number-row">${T('Value B')}<input id="request-tag-b" type="text" maxlength="80"></label><label class="number-row">${T('Share of A, %')}<input id="request-tag-percent" type="number" min="0" max="100" step="5"></label><p class="field-note">${T('Share of B = 100% − A. All child calls inherit the labels.')}</p><h4>${T('Entry box selection')}</h4>${ruleEditor('entry-affinity')}<p class="field-note">${T('The generator has no calling box: select Request here.')}</p><button id="apply-request-labels">${T('Apply without reset')}</button></details>`;
 $('request-locality').oninput=()=>requestLocalityDirty=true;
 $('apply-request-labels').onclick=()=>{try{const labels=parseLabels($('request-labels').value),tag=$('request-tag-enabled').checked?{key:$('request-tag-key').value.trim(),a:$('request-tag-a').value.trim(),b:$('request-tag-b').value.trim(),percent:$('request-tag-percent').valueAsNumber}:null,affinity=readRule('entry-affinity');if(tag&&!Number.isFinite(tag.percent))throw Error(T('Enter the share of A.'));requestLocalityDirty=false;change(c=>{c.requestLabels=labels;c.requestTag=tag;c.entryAffinity=affinity;});}catch(e){toast(e.message);}};
 }
 if(requestLocalityDirty)return;inputValue('request-labels',labelsLines(config.requestLabels));const r=config.requestTag||{key:'az',a:'az1',b:'az2',percent:50};$('request-tag-enabled').checked=!!config.requestTag;for(const k of ['key','a','b','percent'])inputValue('request-tag-'+k,r[k]);fillRule('entry-affinity',config.entryAffinity,false,'request');
}
function localityTarget(){
 const g=group(),r=resourceDef(),n=node();if(!g||!n)return null;const one=r?resourceViews(g,n,r)[0]:n;return {g,r,n,one,def:r||g,all:scope==='group'||isSharedResource()};
}
function renderLocalityInspector(){
 const target=localityTarget();if(!target?.one)return;const {g,r,n,one,def,all}=target;
 const key=JSON.stringify([g.id,one.id,selectedResource,scope,def.stages.map(s=>s.calls.map(c=>[c.target,c.resource])),I18n.locale()]);
 if(key!==boxLocalityKey){const open=$('box-locality-details')?.open||false;boxLocalityKey=key;boxLocalityDirty=false;
 $('box-locality').innerHTML=`<details id="box-locality-details" ${open?'open':''}><summary>${T('Locality')}</summary><p id="effective-labels" class="field-note"></p><label class="locality-label">${T('Own labels · key=value')}<textarea id="box-labels" rows="2" spellcheck="false"></textarea></label><p class="field-note">${T('Instances inherit group labels; owned resources inherit instance labels. key= removes an inherited label. Individual overrides take precedence.')}</p><h4>${T('Processing time of this box')}</h4>${ruleEditor('box-cost',true)}<p class="field-note">${T('Base time × weight × multiplier. A missing label means ×1. Resources do not inherit their service’s processing multiplier.')}</p><p id="locality-stats" class="field-note"></p>${ownOutgoing(def).map((edge,i)=>`<div class="edge-locality"><h4>→ ${esc(edge.target||edge.resource)} · ${T('whole group')}</h4>${ruleEditor('edge-affinity-'+i)}<h4>${T('Link delay')}</h4>${ruleEditor('edge-cost-'+i,true)}<p class="field-note">${T('Multiplier of this link’s one-way delay, including reply and handshake. With base delay 0, the penalty is also 0.')}</p></div>`).join('')}<p class="field-note">${T('Preference ignores queue length: matching nodes first. On connection failure, retries try matching nodes, then others, within the call budget. Broadcast visits every node.')}</p><div class="locality-actions"><button id="apply-box-locality">${T('Apply without reset')}</button>${!all?`<button id="inherit-box-locality">${T('Inherit')}</button>`:''}</div></details>`;
 $('box-locality').oninput=()=>boxLocalityDirty=true;
 $('apply-box-locality').onclick=()=>{try{
 const labels=parseLabels($('box-labels').value),cost=readRule('box-cost',true),calls=ownOutgoing(def).map((_,i)=>({affinity:readRule('edge-affinity-'+i),networkCost:readRule('edge-cost-'+i,true)}));
 boxLocalityDirty=false;change(c=>{const cg=c.groups.find(v=>v.id===g.id);if(all){const d=r?definitionAt(cg,selectedResource):cg;d.labels=labels;d.cost=cost;}else{c.overrides??={};c.overrides[one.id]??={};c.overrides[one.id].labels=labels;c.overrides[one.id].cost=cost;}ownOutgoing(definitionAt(cg,selectedResource)).forEach((e,i)=>Object.assign(e,calls[i]));});
 }catch(e){toast(e.message);}};
 if($('inherit-box-locality'))$('inherit-box-locality').onclick=()=>{boxLocalityDirty=false;change(c=>{if(c.overrides?.[one.id]){delete c.overrides[one.id].labels;delete c.overrides[one.id].cost;}});};
 }
 const ns=all?(r?resourceViews(g,n,r,true,true):state.nodes.filter(v=>v.group===g.id)):[one],sum=k=>ns.reduce((a,n)=>a+(n[k]||0),0),rate=(a,b)=>b?fmt(a/b*100,1)+'% ('+a+'/'+b+')':'—';
 $('effective-labels').textContent=T('Effective labels: ')+(labelsText(one.labels)||'—')+(all?' · '+T('first instance shown'):'');
 $('locality-stats').textContent=T('Mismatches since start. Processing: ')+rate(sum('costRemote'),sum('costKnown'))+T('; incoming attempts: ')+rate(sum('hopRemote'),sum('hopKnown'));
 if(boxLocalityDirty)return;inputValue('box-labels',labelsLines(all?def.labels:config.overrides?.[one.id]?.labels));fillRule('box-cost',all?def.cost:one.cost,true,'request');ownOutgoing(def).forEach((edge,i)=>{fillRule('edge-affinity-'+i,edge.affinity);fillRule('edge-cost-'+i,edge.networkCost,true);});
}
function traceLocality(s){
 const explain=d=>`${d.source==='caller'?T('calling box'):T('request')}.${esc(d.key)}: ${esc(d.from||'∅')} → ${esc(d.to||'∅')} · ${d.result==='match'?T('match'):d.result==='mismatch'?T('mismatch'):T('missing label, no penalty')}`;
 const lines=[];
 if(s.routingLocality)lines.push(T('Routing: ')+explain(s.routingLocality));
 if(s.networkLocality)lines.push(T('Link: ')+explain(s.networkLocality)+` · ${fmt(s.networkBase,2)} × ${fmt(s.networkLocality.factor,2)} = ${fmt(s.networkDelay,2)}${T(' ms')}`);
 const w=s.workCost;if(w?.locality)lines.push(T('Processing: ')+explain(w.locality)+` · ${fmt(w.base,2)} × ${fmt(w.weight,2)} × ${fmt(w.factor,2)} = ${fmt(w.nominal,2)}${T(' ms')}`+(Math.abs(w.duration-w.nominal)>.01?T(' · with jitter ')+fmt(w.duration,2)+T(' ms'):''));
 return lines.length?`<div class="trace-locality">${lines.map(line=>`<div>${line}</div>`).join('')}</div>`:'';
}

function renderLocalityHint(){
 const el=$('locality-hint'),numa=config.entry==='cpu'&&config.groups.some(g=>g.id==='memory'),az=config.name==='Two zones · locality';el.hidden=!numa&&!az;
 el.textContent=numa?T('NUMA: by default, data is distributed 50/50 across nodes. The request label selects the memory holding the data. Access from another CPU node costs ×3. Under Request labels, enable entry preference by request.numa and compare. Times are illustrative; bandwidth and cache coherence are not modeled.'):az?T('Two zones: each LB prefers backends in its AZ. Select an LB → Locality, disable matching preference and compare cross-zone calls and latency. Scaling inherits group labels; placement of new nodes across zones is manual.'):'';
}

function traceConnection(s){
 if(!s.connection)return '';
 const reused=s.connection==='reused';
 const label=reused?T('reused · keep-alive'):T('new');
 const state=s.connectionClosed?T(' · closed'):!s.connectionEstablished?(s.status==='pending'?T(' · connecting'):T(' · not established')):'';
 const hint=reused?T('The connection was already open. Connect timeout does not apply here.'):T('A new connection attempt is bounded by connect timeout.');
 return `<div class="trace-connection" title="${esc(hint)}">${T('Connection: ')}<b>${label}</b>${state}</div>`;
}

function renderModelDescription(){const el=$('model-description'),text=I18n.description(config);el.hidden=!text;el.textContent=text;}

const downstreamFields=['keepalive','keepaliveTimeout','connectTimeout','timeout','retryConnect'];
function setDownstream(field,value){
 const r=resourceDef(),g=group(),n=r?resourceViews(g,node(),r)[0]:node(),path=selectedResource;
 change(c=>{if(scope==='group'||isSharedResource()){const def=definitionAt(c.groups.find(v=>v.id===g.id),path);def[field]=value;const nodes=r?resourceViews(g,node(),r,true):state.nodes.filter(v=>v.group===g.id&&!v.retired&&!v.draining);for(const v of nodes)if(c.overrides?.[v.id])delete c.overrides[v.id][field];}
 else if(n){c.overrides??={};c.overrides[n.id]??={};c.overrides[n.id][field]=value;}});
}
function renderDownstreamControls(n,g){
 const r=resourceDef(),def=r||g,one=r?resourceViews(g,n,r)[0]:n,all=scope==='group'||isSharedResource(),p=all?effectiveDefinition(g,selectedResource):(one?.downstream||g),leaf=!ownOutgoing(def).length,locked=!all&&one?.draining;
 $('keepalive').checked=p.keepalive;inputValue('keepalive-timeout',p.keepaliveTimeout/1000);inputValue('connect',p.connectTimeout);inputValue('timeout',p.timeout);$('timeout-out').textContent=fmt(p.timeout)+T(' ms');$('retry-connect').checked=p.retryConnect!==false;
 $('downstream-scope').textContent=all?T('GROUP')+(selectedResource?' / '+selectedResource:''):one?.id||n.id;
 $('downstream-note').textContent=all?T('Connections and timeouts for every instance. Editing a field replaces its individual overrides.'):T('Outgoing connections of this box. Settings inherit from its group by default.');
 for(const id of ['keepalive','retry-connect','timeout','connect'])$(id).disabled=leaf||locked;
 $('keepalive-timeout').disabled=leaf||locked||!p.keepalive;
 $('inherit-downstream').hidden=all||leaf||!downstreamFields.some(k=>config.overrides?.[one?.id]?.[k]!==undefined);
 $('inherit-downstream').disabled=locked;
 $('leaf-note').textContent=leaf?T('Leaf node: no children, so call settings do not apply.'):T('Edit sequential steps, parallel calls and request conditions in Boxes and paths. Workers stay occupied while waiting.');
}
function effectiveDefinition(g,path){let out={...g};for(const id of path.split('/').filter(Boolean)){const child=out.resources.find(r=>r.id===id);out={...out,...child,resources:child.resources||[],stages:child.stages};}return out;}
$('keepalive').onchange=()=>setDownstream('keepalive',$('keepalive').checked);
$('keepalive-timeout').onchange=()=>{const el=$('keepalive-timeout');if(el.value!==''&&el.checkValidity())setDownstream('keepaliveTimeout',el.valueAsNumber*1000);else toast(T('Idle timeout: 0 to 3600 seconds.'));};
$('connect').onchange=()=>{const el=$('connect');if(el.value!==''&&el.checkValidity())setDownstream('connectTimeout',el.valueAsNumber);else toast(T('Connect timeout: 1 to 60000 ms.'));};
$('timeout').oninput=()=>{sliderFill($('timeout'));setDownstream('timeout',+$('timeout').value);};
$('inherit-downstream').onclick=()=>{const r=resourceDef(),id=(r?resourceViews(group(),node(),r)[0]:node())?.id;change(c=>{if(c.overrides?.[id])for(const k of downstreamFields)delete c.overrides[id][k];});};
function renderClientConnections(){const p=config.client;if(!p)return;$('client-keepalive').checked=p.keepalive;inputValue('client-idle',p.keepaliveTimeout/1000);inputValue('client-connect',p.connectTimeout);$('client-idle').disabled=!p.keepalive;}
$('client-keepalive').onchange=()=>change(c=>c.client.keepalive=$('client-keepalive').checked);
for(const [id,key,mul] of [['client-idle','keepaliveTimeout',1000],['client-connect','connectTimeout',1]])$(id).onchange=()=>{const el=$(id);if(el.value!==''&&el.checkValidity())change(c=>c.client[key]=el.valueAsNumber*mul);else toast(T('Check the generator connection settings.'));};

function renderTraceEvents(trace){
 const spans=new Map(trace.spans.map(s=>[s.id,s]));
 const rows=(trace.events||[]).map(event=>{
  const span=spans.get(event.span);
  let detail=event.reason?T(reasons[event.reason]||event.reason):'';
  if(['Stage started','Stage skipped'].includes(event.kind))detail+=(detail?' · ':'')+T('Stage')+' '+event.value;
  if(['Call started','Processing started','Connection ready'].includes(event.kind))detail+=(detail?' · ':'')+T(event.kind==='Call started'?'Budget':event.kind==='Connection ready'?'One-way network':'Duration')+': '+fmt(event.value||0,3)+T(' ms');
  if(['Queued','Connection retry'].includes(event.kind))detail+=(detail?' · ':'')+T(event.kind==='Queued'?'Queue depth':'Attempt')+': '+fmt(event.value);
  return `<tr><td>+${fmt(event.at-trace.start,3)}</td><td>${span?`#${span.id} · ${esc(span.node)}<small>${span.parent?'← #'+span.parent:T('Client')}</small>`:T('Client')}</td><td>${esc(T(event.kind))}${detail?`<small>${esc(detail)}</small>`:''}</td></tr>`;
 }).join('');
 return `<div class="event-heading"><h3>${T('Detailed events')}</h3><span>${T('Deadline, ms')}: ${fmt(trace.deadline)}</span></div><p class="field-note">${T('Times are relative to sending. Span IDs and parent IDs connect parallel calls, retries and resource visits.')}</p><div id="trace-events" class="trace-events"><table><thead><tr><th>${T('Time, ms')}</th><th>${T('Span / parent')}</th><th>${T('Event')}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

$('resource-panel').after(document.querySelector('.timeout-settings'));
