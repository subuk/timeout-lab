const {t:T,template:TT,name:modelName}=I18n;
const $=id=>document.getElementById(id), fmt=(n,d=0)=>Number(n||0).toLocaleString(I18n.locale(),{maximumFractionDigits:d,minimumFractionDigits:d});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const worker=new Worker('./worker.js?v=0fe5c4b81ce9');
let state=null,config=null,initial=null,selected='db-1',scope='node',graphKey='',paused=false,traceID=null,traceCache=[],traceAutoAt=-1,toastTimer,inspectorKey='',autoGroupKey='';
const reasons={ok:'success',request_timeout:'call timeout',client_deadline:'user deadline',connect_timeout:'connect timeout',connection_refused:'connection refused',connection_reset:'connection reset',queue_full:'queue full',cancelled:'cancelled'};
const clone=o=>structuredClone(o);
function send(data){worker.postMessage(data);}
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4000);}
function change(mutator,{reset=false}={}){if(!config)return;const next=clone(config);mutator(next);config=next;send({type:reset?'reset':'config',config:next});if(reset){clearTraces();graphKey='';}}
function sliderFill(input){const min=+input.min||0,max=+input.max||100;input.style.setProperty('--fill',`${Math.max(0,Math.min(100,(+input.value-min)/(max-min)*100))}%`);}
function inputValue(id,value){const el=$(id);if(document.activeElement!==el)el.value=value;if(el.type==='range'){if(value>+el.max)el.max=Math.ceil(value/100)*100;sliderFill(el);}}
function globalControls(){renderModelDescription();renderRequestLocality();renderLocalityHint();for(const id of ['rps','weight','network','deadline','spread','jitter','seed'])inputValue(id,config[id]);$('cancel').checked=config.cancel;renderClientConnections();$('rps-out').textContent=fmt(config.rps)+' req/s';$('weight-out').textContent=fmt(config.weight,1)+'×';$('network-out').textContent=fmt(config.network)+T(' ms');$('deadline-out').textContent=fmt(config.deadline)+T(' ms');const entry=config.groups.find(g=>g.id===config.entry);$('entry-flow').textContent=entry?TT`Total traffic into “${modelName(entry)}”. Nodes: ${entry.count}, nominally ${fmt(config.rps/entry.count,1)} req/s per node.`:T('Total traffic into the entry group');$('entry-flow').title=T('The generator sends requests only to the entry group. Downstream traffic is determined by outgoing calls, fan-out and routing.');}

function clearTraces(){boxLocalityDirty=false;requestLocalityDirty=false;lastTraceMarkup='';expandedSpans.clear();traceID=null;traceCache=[];traceAutoAt=-3000;$('trace-list').innerHTML='';$('trace-detail').innerHTML=T('<p class="muted">Waiting for the first completed requests…</p>');}
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
function inspector(){const n=node(),g=group();if(!n||!g)return;$('selected-id').textContent=scope==='group'?g.id:n.id;$('selected-name').textContent=modelName(g);$('selected-subtitle').textContent=scope==='group'?TT`${g.count} nodes · whole-group settings`:(n.draining?T('Draining · finishing accepted work'):TT`Node ${n.index} of ${g.count} · FIFO queue`);$('selected-symbol').textContent=g.edges.length?'◇':'▤';
 const service=scope==='group'?g.service:n.service,workers=scope==='group'?g.workers:n.workers;inputValue('service',service);inputValue('workers',workers);$('service-out').textContent=fmt(service)+T(' ms');$('workers-out').textContent=fmt(workers);inputValue('node-count',g.count);renderDownstreamControls(n,g);inputValue('fanout',g.edges[0]?.calls||1);inputValue('route',g.edges[0]?.route||'round_robin');inputValue('join',g.join);inputValue('quorum',g.quorum);$('quorum-row').hidden=g.join!=='quorum';inputValue('fault',n.state);
 const leaf=g.edges.length===0;if(inspectorKey!==g.id){document.querySelector('.timeout-settings').open=!leaf;inspectorKey=g.id;}for(const id of ['timeout','connect','fanout','route','join','quorum'])$(id).disabled=leaf||((id==='timeout'||id==='connect')&&scope!=='group'&&n.draining);$('leaf-note').textContent=leaf?T('Leaf node: no children, so call settings do not apply.'):TT`Full budget for each child call. Workers stay occupied until it completes. Edges: ${g.edges.length}.`;
 document.querySelectorAll('[data-scope]').forEach(b=>b.classList.toggle('active',b.dataset.scope===scope));renderAutoScale();renderResourceInspector();
}
function renderSelection(){document.querySelectorAll('.box').forEach(b=>{const n=state.nodes.find(n=>n.id===b.dataset.node);b.classList.toggle('selected',scope==='group'?n?.group===node()?.group:n?.id===selected);b.setAttribute('aria-pressed',String(b.classList.contains('selected')));});}
function drawWires(){if(!state)return;const area=$('topology'),rect=area.getBoundingClientRect(),svg=$('wires');svg.setAttribute('width',area.scrollWidth);svg.style.width=area.scrollWidth+'px';svg.innerHTML='<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" style="fill:#a9b8d3;stroke:none"/></marker></defs>';
 const boxes=new Map([...document.querySelectorAll('.group')].map(el=>[el.dataset.group,el]));
 for(const g of config.groups)for(const e of g.edges){const a=boxes.get(g.id)?.getBoundingClientRect(),b=boxes.get(e.target)?.getBoundingClientRect();if(!a||!b)continue;const x1=a.right-rect.left+area.scrollLeft,y1=a.top+a.height/2-rect.top,x2=b.left-rect.left+area.scrollLeft,y2=b.top+b.height/2-rect.top;const d=`M${x1},${y1} C${x1+25},${y1} ${x2-25},${y2} ${x2},${y2}`;svg.insertAdjacentHTML('beforeend',`<path d="${d}" marker-end="url(#arrow)"/><path class="flow" d="${d}"/>`);}}
function renderNodes(){for(const n of state.nodes){const box=[...document.querySelectorAll('.box')].find(b=>b.dataset.node===n.id);if(!box)continue;box.classList.toggle('unhealthy',n.state!=='healthy');box.classList.toggle('draining',n.draining);box.querySelector('.box-title span').textContent=n.id+(n.draining?' · drain':'');box.querySelector('.box-placement').textContent=labelsText(n.labels);box.title=TT`${n.id} · ${fmt(n.rps,1)} departures/s · ${fmt(n.w)} ms in box · errors ${fmt(n.errorRate,1)}%`;const count=Math.min(n.workers,48),grid=box.querySelector('.worker-grid');let cells='';for(let i=0;i<count;i++){const index=n.workers>48?Math.floor(i*n.workers/count):i;const phase=index<n.active?(n.phases[Math.min(index,n.phases.length-1)]||'local'):'';cells+=`<i class="worker-cell ${phase}" title="${phase||T('idle')}"></i>`;}grid.innerHTML=cells;const values=box.querySelectorAll('.box-stats span');values[0].textContent=TT`${n.active}/${n.workers} busy`;values[1].textContent=n.queue?`Q ${n.queue}`:TT`${fmt(n.rps)} /s`;values[1].classList.toggle('has-queue',n.queue>0);box.querySelector('.queue-track span').style.width=Math.min(100,n.queue/Math.max(n.workers,1)*20)+'%';fillResourceBars(box,config.groups.find(g=>g.id===n.group),n);}
 for(const el of document.querySelectorAll('.group-summary')){const gid=el.parentElement.dataset.group,g=config.groups.find(g=>g.id===gid),ns=state.nodes.filter(n=>n.group===gid&&!n.retired),v=combineViews(ns);el.querySelector('p').textContent=`${v.active}/${v.workers} · Q ${v.queue}`;fillResourceBars(el,g,ns[0],true);}
 renderSelection();}
function aggregate(){const n=node();if(selectedResource){const r=resourceDef();return r?combineViews(resourceViews(group(),n,r,scope==='group',true)):n;}if(scope==='node')return n;const ns=state.nodes.filter(v=>v.group===n.group),o={...n};for(const k of ['active','workers','queue','rps','l','lambda','little','unfinished','exited'])o[k]=ns.reduce((s,n)=>s+(k==='workers'&&n.retired?0:n[k]),0);o.meanW=o.exited?ns.reduce((s,n)=>s+n.meanW*n.exited,0)/o.exited:0;for(const k of ['w','wQueue','wLocal','wChildren'])o[k]=o.rps?ns.reduce((s,n)=>s+n[k]*n.rps,0)/o.rps:0;return o;}
function renderLittle(){const n=aggregate();if(!n)return;$('little-l').textContent=fmt(n.l,2);$('little-lambda').textContent=fmt(n.lambda,1);$('little-w').textContent=fmt(n.meanW/1000,3);$('little-accounting').textContent=TT`${fmt(n.l,2)} = ${fmt(n.little,2)} + ${fmt(n.unfinished,2)} unfinished`;const total=n.w||1;const data=[[T('Queue'),n.wQueue,'#d99b35'],[T('Local processing'),n.wLocal,'#4464e8'],[T('Waiting for children'),n.wChildren,'#aebde9']];$('residence-bar').innerHTML=data.map(([l,v,c])=>TT`<span style="width:${v/total*100}%;background:${c}" title="${l}: ${fmt(v)} ms"></span>`).join('');$('residence-values').innerHTML=data.map(([l,v,c])=>TT`<div><span><i class="dot" style="background:${c};margin-right:5px"></i>${l}</span><b>${fmt(v,1)} ms</b></div>`).join('');}
function insight(){const m=state.metrics,ns=[...state.nodes,...(state.resources||[])];let title=T('The system keeps up with traffic'),text=T('Increase database processing time or request weight. Watch queues and child wait time in upstream boxes.'),warning=false;const worst=[...ns].sort((a,b)=>b.queue-a.queue)[0];if(m.ghosts){title=TT`${m.ghosts} workers are still running after the user response`;text=T('Cancellation is disabled: a short timeout ends the wait but leaves work running. Enable cancellation propagation and compare.');warning=true;}else if(worst?.queue>3){title=TT`Queue at ${worst.id}: ${worst.queue} requests`;text=TT`Busy: ${worst.active} of ${worst.workers} workers. The oldest request has waited ${fmt(worst.oldest)} ms. Check processing and downstream wait time.`;warning=true;}else if(m.errorRate>2){title=TT`${fmt(m.errorRate,1)}% of users receive an error`;text=T('Compare the call budget with network, queue and processing time. Open a failed trace to find where it breaks.');warning=true;}else if(ns.some(n=>!n.retired&&n.state!=='healthy')){title=T('The system has an unhealthy node');text=T('Traffic continues. This model does not automatically remove unhealthy nodes: routing and timeouts determine the impact.');warning=true;}const el=$('insight');el.classList.toggle('warning',warning);el.querySelector('strong').textContent=title;el.querySelector('p').textContent=text;}
function canvasContext(id){const c=$(id),r=c.getBoundingClientRect(),d=devicePixelRatio||1;if(c.width!==Math.round(r.width*d)||c.height!==Math.round(r.height*d)){c.width=Math.round(r.width*d);c.height=Math.round(r.height*d);}const ctx=c.getContext('2d');ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,r.width,r.height);return {ctx,w:r.width,h:r.height};}
function spark(id,key,color){const {ctx,w,h}=canvasContext(id);const data=(state.history||[]).slice(-50);if(data.length<2)return;const max=Math.max(...data.map(p=>p[key]),1);ctx.beginPath();data.forEach((p,i)=>{const x=i/(data.length-1)*w,y=h-3-p[key]/max*(h-7);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.stroke();}
function charts(){spark('spark-goodput','goodput','#15957e');spark('spark-p95','p95','#4464e8');spark('spark-error','errorRate','#d26462');spark('spark-pending','pending','#d99b35');const {ctx,w,h}=canvasContext('load-chart');const data=state.history||[];if(!data.length)return;const left=30,right=w-8,top=8,bottom=h-23,max=Math.max(10,...data.flatMap(p=>[p.queue,p.busy]));ctx.font='9px ui-monospace,monospace';ctx.textBaseline='middle';for(let i=0;i<=3;i++){const y=top+(bottom-top)*i/3;ctx.strokeStyle='#edf0f5';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle='#9ca6b6';ctx.fillText(fmt(max*(1-i/3)),0,y);}const start=Math.max(0,state.t-60000),span=Math.max(1000,state.t-start);for(const [key,color]of [['busy','#4464e8'],['queue','#d99b35']]){ctx.beginPath();data.forEach((p,i)=>{const x=left+(p.t-start)/span*(right-left),y=bottom-p[key]/max*(bottom-top);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.strokeStyle=color;ctx.lineWidth=1.7;ctx.stroke();}ctx.fillStyle='#9ca6b6';ctx.fillText(TT`${fmt(start/1000)} s`,left,h-6);ctx.textAlign='right';ctx.fillText(TT`${fmt(state.t/1000)} s`,right,h-6);ctx.textAlign='left';}
function traces(force=false){if(force||(!traceID&&state.t-traceAutoAt>2000)){traceAutoAt=state.t;traceCache=clone(state.recent||[]).slice(0,10);if(traceCache.length){if(!traceID)traceID=traceCache[0].id;renderTraceList();}}const newer=(state.recent||[]).find(t=>t.id===traceID);if(newer){const i=traceCache.findIndex(t=>t.id===traceID);if(i>=0)traceCache[i]=clone(newer);}renderTrace();}
function renderTraceList(){$('trace-list').innerHTML=traceCache.map(t=>TT`<button class="trace-chip ${t.ok?'':'error'} ${t.id===traceID?'active':''}" data-trace="${t.id}"><i class="dot ${t.ok?'green':'red'}"></i>#${t.id} <span>${fmt(t.end-t.start)} ms</span></button>`).join('');$('trace-list').querySelectorAll('button').forEach(b=>b.onclick=()=>{traceID=+b.dataset.trace;expandedSpans.clear();renderTraceList();renderTrace();});}
function renderTrace(){
 const trace=traceCache.find(t=>t.id===traceID);if(!trace)return;
 const end=Math.max(trace.end,...trace.spans.map(s=>Math.max(s.end,s.reply))),duration=Math.max(1,end-trace.start);
 const resourceParents=new Set(trace.spans.filter(s=>s.resource).map(s=>s.parent));
 const visible=trace.spans.filter(s=>!s.resource||expandedSpans.has(s.parent));
 const rows=visible.slice(0,64).map(s=>{
  const finish=s.end<0?Math.min(state.t,end):s.end,start=s.arrive<0?finish:s.arrive,work=s.workStart<0?finish:s.workStart,local=s.localEnd<0?finish:s.localEnd;
  const pieces=[['network',s.start,start],['queue',start,work],['local',work,local],['children',local,finish]];if(s.reply>finish)pieces.push(['network',finish,s.reply]);
  const segments=pieces.filter(p=>p[2]>p[1]).map(([kind,a,b])=>`<span class="trace-segment trace-${kind}" style="left:${Math.max(0,(a-trace.start)/duration*100)}%;width:${Math.min(100,(b-a)/duration*100)}%" title="${kind}: ${fmt(b-a,1)}${T(' ms')}"></span>`).join('');
  const expand=resourceParents.has(s.id)?`<button class="trace-expand" data-span="${s.id}" aria-expanded="${expandedSpans.has(s.id)}" aria-label="${esc(T('Show resources'))}">${expandedSpans.has(s.id)?'▾':'▸'}</button>`:'';
  const label=s.resource?modelName({name:s.resourceName||s.resource,i18n:s.resourceI18n}):s.node;
  return `<div class="trace-row ${s.resource?'resource-row':''}" title="${esc(s.node)} · ${esc(T(reasons[s.status]||s.status))}"><span>${expand}${s.resource?'↳ ':s.parent?'↳ ':''}${esc(label)}${s.attempt>1?' ↻'+s.attempt:''}</span><div class="trace-track">${segments}</div><span>${fmt(Math.max(0,finish-start))}${T(' ms')}</span></div>${traceConnection(s)}${traceLocality(s)}`;
 }).join('');
 const markup=`<div class="trace-summary"><strong>trace #${trace.id}</strong><span class="trace-tags">${esc(labelsText(trace.labels))}</span><span>${T('Request weight')} ${fmt(trace.weight,2)}×</span><span>${fmt(trace.end-trace.start,1)}${T(' ms')}</span><span class="result ${trace.ok?'':'error'}">${esc(T(reasons[trace.reason]||trace.reason))}</span></div>${rows}<div class="trace-legend"><span><i class="dot" style="background:#dce3ef"></i>${T('Network / connect')}</span><span><i class="dot amber"></i>${T('Queue')}</span><span><i class="dot blue"></i>${T('Processing')}</span><span><i class="dot" style="background:#aebde9"></i>${T('Waiting for children')}</span></div><div class="trace-caption">${T('Click ▸ next to a service to reveal its internal resources. Nested row durations must not be added together.')}${visible.length>64?' · 64 / '+visible.length:''}</div>`;
 if(markup===lastTraceMarkup)return;lastTraceMarkup=markup;$('trace-detail').innerHTML=markup;
 for(const b of $('trace-detail').querySelectorAll('[data-span]'))b.onclick=()=>{const id=+b.dataset.span;expandedSpans.has(id)?expandedSpans.delete(id):expandedSpans.add(id);renderTrace();};
}
function render(){if(!state)return;const m=state.metrics;document.body.classList.toggle('paused',paused);$('live-state').textContent=paused?T('Paused'):T('Simulation running');$('live-state').classList.toggle('paused',paused);$('pause').textContent=paused?T('▶ Resume'):T('Ⅱ Pause');const sec=state.t/1000;$('clock').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${(sec%60).toFixed(1).padStart(4,'0')}`;$('goodput').textContent=fmt(m.goodput,1);$('p95').textContent=m.goodput?fmt(m.p95):'—';$('error-rate').textContent=fmt(m.errorRate,1);$('error-rate').style.color=m.errorRate>1?'var(--red)':'';$('pending').textContent=fmt(m.pending);$('rps-foot').textContent=TT`out of ${fmt(config.rps)} incoming /s`;$('queue-foot').textContent=TT`Queued: ${fmt(m.queue)}`;$('ghost-foot').textContent=m.ghosts?TT` · ${m.ghosts} after response`:'';globalControls();buildGraph();renderNodes();inspector();renderLittle();insight();charts();traces();}
worker.onmessage=({data})=>{if(data.type==='error'){if($('resources-dialog').dataset.pending){delete $('resources-dialog').dataset.pending;$('resources-error').textContent=T(data.message);}toast(T(data.message));$('config-error').textContent=T(data.message);delete $('config-dialog').dataset.pending;if(state)config=clone(state.config);return;}if(data.type!=='snapshot')return;if($('resources-dialog').dataset.pending){delete $('resources-dialog').dataset.pending;$('resources-dialog').close();toast(T('Structure applied. Experiment restarted.'));}if($('config-dialog').dataset.pending==='true'){delete $('config-dialog').dataset.pending;$('config-dialog').close();toast(T('Model applied.'));}const selectedGroup=node()?.group;state=data.data;config=clone(state.config);I18n.setModelLanguages(config);if(!initial){initial=clone(config);document.querySelectorAll('[data-scenario]').forEach(b=>b.disabled=false);selectScenario(scenarioFromURL(),{historyMode:'replace',notify:false});return;}if(!state.nodes.some(n=>n.id===selected&&!n.retired))selected=(state.nodes.find(n=>n.group===selectedGroup&&!n.retired)||state.nodes.find(n=>!n.retired)).id;paused=data.paused;render();};worker.onerror=e=>{toast(T('Engine startup error: ')+e.message);$('live-state').textContent=T('Loading failed');};
for(const id of ['rps','weight','network','deadline'])$(id).addEventListener('input',()=>{sliderFill($(id));change(c=>c[id]=+$(id).value);});
for(const id of ['spread','jitter'])$(id).addEventListener('change',()=>{change(c=>c[id]=+$(id).value);});$('seed').addEventListener('change',()=>{change(c=>c.seed=+$('seed').value);toast(T('Seed saved; press ↺ to start a new experiment.'));});
$('cancel').onchange=()=>change(c=>c.cancel=$('cancel').checked);
$('pause').onclick=()=>send({type:'pause'});$('step').onclick=()=>send({type:'step'});$('speed').onchange=()=>send({type:'speed',value:+$('speed').value});$('reset').onclick=()=>{change(()=>{},{reset:true});toast(T('Experiment restarted with the current settings.'));};
$('scope').querySelectorAll('button').forEach(b=>b.onclick=()=>{scope=b.dataset.scope;inspector();renderSelection();renderLittle();});
for(const id of ['service','workers'])$(id).oninput=()=>{const n=node(),g=group(),value=+$(id).value;sliderFill($(id));if(scope==='group')change(c=>{c.groups.find(v=>v.id===g.id)[id]=value;for(const n of state.nodes.filter(n=>n.group===g.id&&!n.retired)){if(c.overrides?.[n.id])delete c.overrides[n.id][id];}});else send({type:'node',id:n.id,[id]:value});};
$('node-count').onchange=()=>{const id=group().id,value=+$('node-count').value;if(!Number.isInteger(value)||value<1||value>16){toast(T('A group can contain between 1 and 16 nodes.'));$('node-count').value=group().count;return;}change(c=>{c.groups.find(g=>g.id===id).count=value;});};
for(const id of ['fanout','route','join','quorum'])$(id).addEventListener('change',()=>{const gid=group().id;change(c=>{const g=c.groups.find(g=>g.id===gid);if(id==='timeout')g.timeout=+$(id).value;if(id==='connect')g.connectTimeout=+$(id).value;if(id==='fanout')g.edges.forEach(e=>e.calls=+$(id).value);if(id==='route')g.edges.forEach(e=>e.route=$(id).value);if(id==='join')g.join=$(id).value;if(id==='quorum')g.quorum=+$(id).value;});});
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
 const c=clone(initial);clearTraces();selectedResource='';collapsedGroups.clear();graphKey='';autoGroupKey='';
 if(which==='az'||which==='numa'){
  selected=which==='numa'?'cpu-1':'lb-1';scope='node';send({type:'preset',preset:which});return;
 }
 if(which==='slow')c.groups.find(g=>g.id==='db').resources.find(r=>r.id==='storage').service=600;
 if(which==='fanout'){c.name='Three database calls per request';c.description="Each API sends three parallel database calls per user request and waits for all three responses. Initially, 200 incoming requests/s imply 600 database calls/s before capacity limits, and disk work is set to 50 ms per visit. Watch the database queue grow and the API and load balancer workers wait for downstream responses.";c.i18n={ru:{name:'Три вызова БД на один запрос',description:"На один пользовательский запрос API делает три параллельных вызова базы и ждёт все три ответа. Начальные настройки: 200 запросов/с на входе — номинально 600 вызовов БД/с до ограничения пропускной способностью; работа диска — 50 мс за посещение. Следите за очередью базы и за тем, как ожидание ответов занимает воркеры API и балансера."}};c.groups.find(g=>g.id==='api').edges[0].calls=3;c.groups.find(g=>g.id==='db').resources.find(r=>r.id==='storage').service=50;}
 if(which==='hang')c.cancel=false;
 if(which==='autoscale'){const g=c.groups.find(g=>g.id==='api');g.count=1;g.workers=32;g.service=0;g.resources.find(r=>r.id==='compute').service=12;g.autoscale={enabled:true,min:1,max:8,resource:'compute',signal:'both',upUtilization:70,window:5000,upQueue:2,downUtilization:30,upDelay:2000,downDelay:10000,cooldown:3000};}
 config=c;selectedResource=which==='slow'?'storage':'';selected=(which==='hang'||which==='autoscale')?'api-1':'db-1';scope=which==='autoscale'?'group':'node';
 send({type:'reset',config:c});if(which==='hang')send({type:'node',id:'api-1',state:'hang'});
 if(notify)toast(T('Scenario started with the original seed.'));
}
document.querySelectorAll('[data-scenario]').forEach(b=>b.onclick=()=>selectScenario(b.dataset.scenario));
function restoreScenarioFromURL(){const which=scenarioFromURL();if(initial&&which!==selectedScenario)selectScenario(which,{historyMode:'replace',notify:false});}
window.addEventListener('popstate',restoreScenarioFromURL);
window.addEventListener('hashchange',restoreScenarioFromURL);

$('edit-config').onclick=()=>{$('config-editor').value=JSON.stringify(config,null,2);$('config-error').textContent=T('Import restarts the experiment.');$('config-dialog').showModal();};$('apply-config').onclick=()=>{try{const c=JSON.parse($('config-editor').value);send({type:'reset',config:c});clearTraces();graphKey='';$('config-dialog').dataset.pending='true';}catch(e){$('config-error').textContent=T('Invalid JSON: ')+e.message;}};
$('model-info').onclick=()=>$('info-dialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('export').onclick=()=>{if(!config)return;const blob=new Blob([JSON.stringify(config,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='boxes-model.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(T('Model saved: groups and per-node settings.'));};
let resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{drawWires();if(state)charts();},100);});
document.querySelectorAll('input[type=range]').forEach(sliderFill);
document.querySelector('.center-column').insertBefore(document.querySelector('.little-panel'),document.querySelector('.chart-panel'));


// Composition is configured per group; inspection can select one owned resource
// or aggregate all copies. Shared resources appear once in group metrics.
let selectedResource='',resourceTabsKey='',autoSourceKey='',resourceDraft=null,lastTraceMarkup='';
const collapsedGroups=new Map(), expandedSpans=new Set();
function resourceDef(){return group()?.resources?.find(r=>r.id===selectedResource);}
function resourceViews(g,n,r,all=false,history=false){return (state.resources||[]).filter(v=>v.group===g.id&&v.resource===r.id&&(history||!v.retired)&&(r.scope==='shared'||all||v.owner===n.id));}
function combineViews(ns){
 const o={active:0,workers:0,queue:0,rps:0,l:0,lambda:0,little:0,unfinished:0,exited:0,meanW:0,w:0,wQueue:0,wLocal:0,wChildren:0,utilization:0,errorRate:0};
 for(const n of ns){for(const k of ['active','queue','rps','l','lambda','little','unfinished','exited'])o[k]+=n[k]||0;if(!n.retired)o.workers+=n.workers;}
 o.meanW=o.exited?ns.reduce((sum,n)=>sum+n.meanW*n.exited,0)/o.exited:0;
 for(const k of ['w','wQueue','wLocal','wChildren','errorRate'])o[k]=o.rps?ns.reduce((sum,n)=>sum+n[k]*n.rps,0)/o.rps:0;
 const capacity=ns.reduce((sum,n)=>sum+(n.loadCapacity||0),0);o.utilization=capacity?ns.reduce((sum,n)=>sum+(n.loadBusy||0),0)/capacity*100:0;
 return o;
}
function stagePlan(g){return g.stages||[...(g.resources||[]).map(r=>({resource:r.id})),...(g.edges.length?[{downstream:true}]:[])];}
function stageName(g,s){return s.downstream?'Downstream':modelName(g.resources?.find(r=>r.id===s.resource))||s.resource;}
function resourceBars(g){return (g.resources||[]).map(r=>`<button class="resource-bar" data-resource="${esc(r.id)}" title="${esc(T(r.scope==='shared'?'Shared group resource':'Per-instance resource'))}"><span>${esc(modelName(r))}${r.scope==='shared'?' ◇':''}</span><span class="meter"><i></i></span><b>—</b></button>`).join('');}
function fillResourceBars(root,g,n,all=false){for(const bar of root.querySelectorAll('.resource-bar')){
 const r=g.resources.find(r=>r.id===bar.dataset.resource),ns=resourceViews(g,n,r,all),v=combineViews(ns),max=Math.max(0,...ns.map(v=>v.utilization));
 bar.querySelector('.meter i').style.width=Math.min(100,v.utilization)+'%';bar.classList.toggle('hot',v.utilization>80||v.queue>0);
 bar.querySelector('b').textContent=`${fmt(v.utilization)}%${all?' / '+fmt(max)+'%':''}${v.queue?' · Q '+v.queue:''}`;
 bar.title=`${modelName(r)} · ${T('Utilization')}: ${fmt(v.utilization,1)}%${all?' · max '+fmt(max,1)+'%':''} · Q ${v.queue}`;
}}
function bindResourceBars(root,g,n,all=false){for(const b of root.querySelectorAll('.resource-bar'))b.onclick=e=>{e.stopPropagation();selected=n.id;selectedResource=b.dataset.resource;if(all)scope='group';inspector();renderSelection();renderLittle();};}
function buildGraph(){
 const key=JSON.stringify([I18n.locale(),config.name,config.i18n,config.groups.map(g=>[g.id,g.count,g.name,g.i18n,g.edges,g.resources?.map(r=>[r.id,r.name,r.i18n,r.scope]),g.id===config.entry,g.autoscale?.enabled,collapsedGroups.get(g.id)]),state.nodes.filter(n=>!n.retired).map(n=>[n.id,n.draining])]);
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
  const foot=document.createElement('div');foot.className='group-foot';foot.textContent=g.edges.length?g.edges.map(e=>`→ ${e.target} ×${e.calls}${e.route==='broadcast'?T(' / each'):''}`).join(' · '):T('return response ↩');el.append(foot);root.append(el);
 }
 document.querySelector('.topology-loading')?.remove();requestAnimationFrame(drawWires);
}
function renderResourceInspector(){
 const g=group(),n=node();if(!g||!n)return;
 if(selectedResource&&!g.resources?.some(r=>r.id===selectedResource))selectedResource='';
 const key=JSON.stringify([g.id,g.resources?.map(r=>[r.id,r.name,r.i18n]),selectedResource,I18n.locale()]);
 if(key!==resourceTabsKey){resourceTabsKey=key;$('resource-tabs').innerHTML=[{id:'',name:T('Requests')},...(g.resources||[])].map(r=>`<button role="tab" aria-selected="${selectedResource===r.id}" class="${selectedResource===r.id?'active':''}" data-tab-resource="${esc(r.id)}">${esc(modelName(r))}</button>`).join('');
  for(const b of $('resource-tabs').querySelectorAll('button'))b.onclick=()=>{selectedResource=b.dataset.tabResource;renderResourceInspector();renderLittle();};
 }
 const plan=stagePlan(g).map(s=>stageName(g,s));$('execution-path').textContent=plan.length?plan.join(' → '):T('No internal resources');
 $('request-settings').hidden=!!selectedResource;$('resource-panel').hidden=!selectedResource;
 const littleTitle=document.querySelector('.little-panel h2');littleTitle.textContent=T('Little’s law')+(selectedResource?' · '+modelName(resourceDef()):'');
 renderLocalityInspector();
 if(!selectedResource)return;
 const r=resourceDef(),ns=resourceViews(g,n,r,scope==='group'),one=ns[0],v=combineViews(ns);
 $('resource-ownership').textContent=T(r.scope==='shared'?'Shared group resource — scaling the group does not add capacity here.':scope==='group'?'A private resource per instance. Settings apply to the whole group.':'A private resource of the selected instance.');
 inputValue('resource-name',r.name);inputValue('resource-work',scope==='group'||r.scope==='shared'?r.service:one?.service??r.service);inputValue('resource-workers',scope==='group'||r.scope==='shared'?r.workers:one?.workers??r.workers);inputValue('resource-fault',one?.state||'healthy');
 $('resource-work-out').textContent=fmt(+$('resource-work').value,1)+T(' ms');$('resource-workers-out').textContent=fmt(+$('resource-workers').value);
 $('resource-util').textContent=fmt(v.utilization,1)+'%';$('resource-queue').textContent=fmt(v.queue);$('resource-latency').textContent=fmt(v.w,1);
}
function updateResourceSetting(field,value){
 const r=resourceDef(),g=group(),n=node();if(!r)return;
 if(field==='name'||scope==='group'||r.scope==='shared')change(c=>{c.groups.find(v=>v.id===g.id).resources.find(v=>v.id===r.id)[field]=value;
  if(field!=='name')for(const v of resourceViews(g,n,r,true))if(c.overrides?.[v.id])delete c.overrides[v.id][field];
 });else{const v=resourceViews(g,n,r)[0];if(v)send({type:'node',id:v.id,[field]:value});}
}
$('resource-name').onchange=()=>{const value=$('resource-name').value.trim();if(value)updateResourceSetting('name',value);else $('resource-name').value=resourceDef().name;};
for(const [id,field]of [['resource-work','service'],['resource-workers','workers']])$(id).oninput=()=>{sliderFill($(id));updateResourceSetting(field,+$(id).value);};
$('resource-fault').onchange=()=>{for(const n of resourceViews(group(),node(),resourceDef(),scope==='group'))send({type:'node',id:n.id,state:$('resource-fault').value});};
function renderAutoSource(){
 const g=group(),p=g.autoscale,key=JSON.stringify([g.id,g.resources?.map(r=>[r.id,r.name,r.i18n]),I18n.locale()]);
 if(autoSourceKey!==key){autoSourceKey=key;$('auto-resource').innerHTML='<option value="">'+esc(T('Request handlers'))+'</option>'+(g.resources||[]).map(r=>`<option value="${esc(r.id)}">${esc(modelName(r))}</option>`).join('');}
 inputValue('auto-resource',p.resource||'');inputValue('auto-signal',p.signal||'queue');
 const r=g.resources?.find(r=>r.id===p.resource);
 $('auto-source-note').textContent=T(r?.scope==='shared'?'This resource is shared: adding service instances does not increase its capacity.':r?'The entire group scales together with its per-instance resources.':'Queue and utilization of the group’s request handlers.');
 $('auto-up-util').disabled=p.signal==='queue';$('auto-up-queue').disabled=p.signal==='utilization';
}
for(const [id,key]of [['auto-resource','resource'],['auto-signal','signal']])$(id).onchange=()=>{const gid=group().id,value=$(id).value;change(c=>{c.groups.find(g=>g.id===gid).autoscale[key]=value;});};
function openResourceEditor(){const g=group();resourceDraft={group:g.id,resources:clone(g.resources||[]),stages:clone(stagePlan(g)),hasDownstream:!!g.edges.length};renderResourceEditor();$('resources-error').textContent=T('Changing the structure restarts the experiment. Edit values and names live in the tabs.');$('resources-dialog').showModal();}
function renderResourceEditor(){
 $('resource-editor').innerHTML=resourceDraft.resources.map(r=>`<div class="resource-edit-row" data-resource-id="${esc(r.id)}"><label>${T('Default name (EN)')}<input data-field="name" maxlength="100" value="${esc(r.name)}"></label><label>${T('Ownership')}<select data-field="scope"><option value="instance" ${r.scope==='instance'?'selected':''}>${T('Per instance')}</option><option value="shared" ${r.scope==='shared'?'selected':''}>${T('Shared by group')}</option></select></label><label>${T('Slots')}<input type="number" min="1" max="512" data-field="workers" value="${r.workers}"></label><label>${T('Work, ms')}<input type="number" min="0" max="10000" data-field="service" value="${r.service}"></label><button data-remove-resource="${esc(r.id)}" aria-label="${T('Remove resource')}">×</button></div>`).join('');
 for(const row of $('resource-editor').querySelectorAll('.resource-edit-row'))for(const input of row.querySelectorAll('[data-field]'))input.onchange=()=>{const r=resourceDraft.resources.find(r=>r.id===row.dataset.resourceId);r[input.dataset.field]=input.type==='number'?+input.value:input.value;renderStageEditor();};
 for(const b of $('resource-editor').querySelectorAll('[data-remove-resource]'))b.onclick=()=>{resourceDraft.resources=resourceDraft.resources.filter(r=>r.id!==b.dataset.removeResource);resourceDraft.stages=resourceDraft.stages.filter(s=>s.resource!==b.dataset.removeResource);renderResourceEditor();};
 $('add-resource').disabled=resourceDraft.resources.length>=8;renderStageEditor();
}
function renderStageEditor(){
 const options=resourceDraft.resources.map(r=>({value:'r:'+r.id,name:modelName(r)}));if(resourceDraft.hasDownstream)options.push({value:'downstream',name:'Downstream'});
 $('stage-editor').innerHTML=resourceDraft.stages.map((s,i)=>`<div class="stage-edit-row" data-index="${i}"><span>${i+1}</span><select aria-label="${T('Stage')} ${i+1}">${options.map(o=>`<option value="${esc(o.value)}" ${(s.downstream?'downstream':'r:'+s.resource)===o.value?'selected':''}>${esc(o.name)}</option>`).join('')}</select><button data-move="-1" ${i===0?'disabled':''} aria-label="${T('Move earlier')}">↑</button><button data-move="1" ${i===resourceDraft.stages.length-1?'disabled':''} aria-label="${T('Move later')}">↓</button><button data-remove-stage aria-label="${T('Remove stage')}">×</button></div>`).join('');
 for(const row of $('stage-editor').querySelectorAll('.stage-edit-row')){const i=+row.dataset.index;row.querySelector('select').onchange=e=>{resourceDraft.stages[i]=e.target.value==='downstream'?{downstream:true}:{resource:e.target.value.slice(2)};};for(const b of row.querySelectorAll('[data-move]'))b.onclick=()=>{const j=i+(+b.dataset.move);[resourceDraft.stages[i],resourceDraft.stages[j]]=[resourceDraft.stages[j],resourceDraft.stages[i]];renderStageEditor();};row.querySelector('[data-remove-stage]').onclick=()=>{resourceDraft.stages.splice(i,1);renderStageEditor();};}
 $('add-stage').disabled=!options.length||resourceDraft.stages.length>=16;
}
$('edit-resources').onclick=openResourceEditor;
$('add-resource').onclick=()=>{let i=1;while(resourceDraft.resources.some(r=>r.id==='r'+i))i++;const r={id:'r'+i,name:'Resource '+i,scope:'instance',workers:1,service:5,queueLimit:500};resourceDraft.resources.push(r);if(resourceDraft.stages.length<16)resourceDraft.stages.push({resource:r.id});renderResourceEditor();};
$('add-stage').onclick=()=>{resourceDraft.stages.push(resourceDraft.resources.length?{resource:resourceDraft.resources[0].id}:{downstream:true});renderStageEditor();};
$('apply-resources').onclick=()=>{
 const d=resourceDraft,down=d.stages.filter(s=>s.downstream).length;
 if(d.resources.some(r=>!r.name.trim()||!Number.isInteger(r.workers)||r.workers<1||r.workers>512||!Number.isFinite(r.service)||r.service<0||r.service>10000)||down!==(d.hasDownstream?1:0)){$('resources-error').textContent=T('Check names, slots and work time. Outgoing edges require exactly one Downstream stage.');return;}
 change(c=>{const g=c.groups.find(g=>g.id===d.group);g.resources=clone(d.resources);g.stages=clone(d.stages);if(g.autoscale.resource&&!g.resources.some(r=>r.id===g.autoscale.resource)){g.autoscale.resource='';g.autoscale.signal='queue';}for(const id of Object.keys(c.overrides||{}))if((state.resources||[]).some(r=>r.id===id&&r.group===g.id))delete c.overrides[id];},{reset:true});
 $('resources-dialog').dataset.pending='true';
};

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
 const g=group(),r=resourceDef(),n=node();if(!g||!n)return null;const one=r?resourceViews(g,n,r)[0]:n;return {g,r,n,one,def:r||g,all:scope==='group'||r?.scope==='shared'};
}
function renderLocalityInspector(){
 const target=localityTarget();if(!target?.one)return;const {g,r,n,one,def,all}=target;
 const key=JSON.stringify([g.id,one.id,selectedResource,scope,g.edges.map(e=>e.target),I18n.locale()]);
 if(key!==boxLocalityKey){const open=$('box-locality-details')?.open||false;boxLocalityKey=key;boxLocalityDirty=false;
 $('box-locality').innerHTML=`<details id="box-locality-details" ${open?'open':''}><summary>${T('Locality')}</summary><p id="effective-labels" class="field-note"></p><label class="locality-label">${T('Own labels · key=value')}<textarea id="box-labels" rows="2" spellcheck="false"></textarea></label><p class="field-note">${T('Instances inherit group labels; owned resources inherit instance labels. key= removes an inherited label. Individual overrides take precedence.')}</p><h4>${T('Processing time of this box')}</h4>${ruleEditor('box-cost',true)}<p class="field-note">${T('Base time × weight × multiplier. A missing label means ×1. Resources do not inherit their service’s processing multiplier.')}</p><p id="locality-stats" class="field-note"></p>${!r?g.edges.map((edge,i)=>`<div class="edge-locality"><h4>→ ${esc(edge.target)} · ${T('whole group')}</h4>${ruleEditor('edge-affinity-'+i)}<h4>${T('Link delay')}</h4>${ruleEditor('edge-cost-'+i,true)}<p class="field-note">${T('Multiplier of this link’s one-way delay, including reply and handshake. With base delay 0, the penalty is also 0.')}</p></div>`).join(''):''}<p class="field-note">${T('Preference ignores queue length: matching nodes first. On connection failure, retries try matching nodes, then others, within the call budget. Broadcast visits every node.')}</p><div class="locality-actions"><button id="apply-box-locality">${T('Apply without reset')}</button>${!all?`<button id="inherit-box-locality">${T('Inherit')}</button>`:''}</div></details>`;
 $('box-locality').oninput=()=>boxLocalityDirty=true;
 $('apply-box-locality').onclick=()=>{try{
 const labels=parseLabels($('box-labels').value),cost=readRule('box-cost',true),edges=!r?g.edges.map((_,i)=>({affinity:readRule('edge-affinity-'+i),networkCost:readRule('edge-cost-'+i,true)})):null;
 boxLocalityDirty=false;change(c=>{const cg=c.groups.find(v=>v.id===g.id);if(all){const d=r?cg.resources.find(v=>v.id===r.id):cg;d.labels=labels;d.cost=cost;}else{c.overrides??={};c.overrides[one.id]??={};c.overrides[one.id].labels=labels;c.overrides[one.id].cost=cost;}if(edges)cg.edges.forEach((e,i)=>Object.assign(e,edges[i]));});
 }catch(e){toast(e.message);}};
 if($('inherit-box-locality'))$('inherit-box-locality').onclick=()=>{boxLocalityDirty=false;change(c=>{if(c.overrides?.[one.id]){delete c.overrides[one.id].labels;delete c.overrides[one.id].cost;}});};
 }
 const ns=all?(r?resourceViews(g,n,r,true,true):state.nodes.filter(v=>v.group===g.id)):[one],sum=k=>ns.reduce((a,n)=>a+(n[k]||0),0),rate=(a,b)=>b?fmt(a/b*100,1)+'% ('+a+'/'+b+')':'—';
 $('effective-labels').textContent=T('Effective labels: ')+(labelsText(one.labels)||'—')+(all?' · '+T('first instance shown'):'');
 $('locality-stats').textContent=T('Mismatches since start. Processing: ')+rate(sum('costRemote'),sum('costKnown'))+T('; incoming attempts: ')+rate(sum('hopRemote'),sum('hopKnown'));
 if(boxLocalityDirty)return;inputValue('box-labels',labelsLines(all?def.labels:config.overrides?.[one.id]?.labels));fillRule('box-cost',all?def.cost:one.cost,true,'request');if(!r)g.edges.forEach((edge,i)=>{fillRule('edge-affinity-'+i,edge.affinity);fillRule('edge-cost-'+i,edge.networkCost,true);});
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
 const n=node(),gid=group().id;
 change(c=>{if(scope==='group'){c.groups.find(g=>g.id===gid)[field]=value;for(const v of state.nodes.filter(v=>v.group===gid&&!v.retired&&!v.draining))if(c.overrides?.[v.id])delete c.overrides[v.id][field];}
 else {c.overrides??={};c.overrides[n.id]??={};c.overrides[n.id][field]=value;}});
}
function renderDownstreamControls(n,g){
 const p=scope==='group'?g:(n.downstream||g),leaf=!g.edges.length,locked=scope!=='group'&&n.draining;
 $('keepalive').checked=p.keepalive;inputValue('keepalive-timeout',p.keepaliveTimeout/1000);inputValue('connect',p.connectTimeout);inputValue('timeout',p.timeout);$('timeout-out').textContent=fmt(p.timeout)+T(' ms');$('retry-connect').checked=p.retryConnect!==false;
 $('downstream-scope').textContent=scope==='group'?T('GROUP'):n.id;
 $('downstream-note').textContent=scope==='group'?T('Connections and timeouts for every instance. Editing a field replaces its individual overrides.'):T('Outgoing connections of this box. Settings inherit from its group by default.');
 for(const id of ['keepalive','retry-connect'])$(id).disabled=leaf||locked;
 $('keepalive-timeout').disabled=leaf||locked||!p.keepalive;
 $('inherit-downstream').hidden=scope==='group'||leaf||!downstreamFields.some(k=>config.overrides?.[n.id]?.[k]!==undefined);
 $('inherit-downstream').disabled=locked;
}
$('keepalive').onchange=()=>setDownstream('keepalive',$('keepalive').checked);
$('keepalive-timeout').onchange=()=>{const el=$('keepalive-timeout');if(el.value!==''&&el.checkValidity())setDownstream('keepaliveTimeout',el.valueAsNumber*1000);else toast(T('Idle timeout: 0 to 3600 seconds.'));};
$('connect').onchange=()=>{const el=$('connect');if(el.value!==''&&el.checkValidity())setDownstream('connectTimeout',el.valueAsNumber);else toast(T('Connect timeout: 1 to 60000 ms.'));};
$('timeout').oninput=()=>{sliderFill($('timeout'));setDownstream('timeout',+$('timeout').value);};
$('inherit-downstream').onclick=()=>{const id=node().id;change(c=>{if(c.overrides?.[id])for(const k of downstreamFields)delete c.overrides[id][k];});};
function renderClientConnections(){const p=config.client;if(!p)return;$('client-keepalive').checked=p.keepalive;inputValue('client-idle',p.keepaliveTimeout/1000);inputValue('client-connect',p.connectTimeout);$('client-idle').disabled=!p.keepalive;}
$('client-keepalive').onchange=()=>change(c=>c.client.keepalive=$('client-keepalive').checked);
for(const [id,key,mul] of [['client-idle','keepaliveTimeout',1000],['client-connect','connectTimeout',1]])$(id).onchange=()=>{const el=$(id);if(el.value!==''&&el.checkValidity())change(c=>c.client[key]=el.valueAsNumber*mul);else toast(T('Check the generator connection settings.'));};
