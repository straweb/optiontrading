'use strict';
let CFG=Object.assign({cap:100000,deployMode:'pct',deployVal:75,src:'sim',defLots:1,brokers:{},layout:'2v'},
  JSON.parse(localStorage.getItem('scalping_cfg')||'{}'));
function saveCfg(){localStorage.setItem('scalping_cfg',JSON.stringify(CFG));}
const bcfg=id=>CFG.brokers[id]||(CFG.brokers[id]={});
let SRC=CFG.src||'sim', apiOK=false, apiPolling=false;
const activeBroker=()=>BROKERS[SRC]||BROKERS.sim;
function usableFunds(){ return CFG.deployMode==='pct'?CFG.cap*(+CFG.deployVal||0)/100:(+CFG.deployVal||0); }
let SYM=null, ticketKey=null, ordType='MKT', PRD='MIS', editRowId=null;

/* ================================================================
   MULTI-PANE CHART LAYOUT
   Each pane is an independent {key,tf,ghost,drawings,view...} slot;
   the ACTIVE pane receives watchlist clicks / strike loads / TF seg.
   ================================================================ */
let panes=[], activePane=0, layout=CFG.layout||'2v';
const PANE_TOOLS=['cursor'];                       // tools shared across panes
function paneCount(){ return layout==='1'?1:layout==='2v'||layout==='2h'?2:layout==='3'?3:4; }
function paneTitle(k){ if(!k)return '—';
  const m=resolveMeta(k);
  return m.type==='OPT'?`${m.root} ${m.strike}${m.optSide}`:m.type==='FUT'?m.root+' F':m.sym; }
function newPaneState(){ return {key:null,tf:5,ghost:true,ghostStyle:'hollow',
  drawings:[],uidC:1,undo:[],selId:null,view:null,pctBase:null,pMode:'auto',mLo:0,mHi:1,pzR0:1}; }
function buildLayout(){
  const n=paneCount(), grid=$('#grid');
  grid.className='g'+layout; grid.innerHTML='';
  panes.length=0;
  for(let i=0;i<n;i++){
    const box=document.createElement('div');box.className='paneBox';
    box.innerHTML=`<div class="ph"><span class="pn">—</span><span class="pl">—</span><span class="px" title="clear pane">✕</span></div>
      <canvas></canvas>`;
    grid.appendChild(box);
    const cv=box.querySelector('canvas'), ctx=cv.getContext('2d');
    panes.push({...newPaneState(),box,cv,ctx,dpr:1,W:0,H:0,
      yLo:null,yHi:null,volMax:null,volMax1:null,
      aggDirty:true,aggCache:new Map(),indCache:null,dataVer:0,geo:null,mouse:{x:0,y:0,in:false}});
  }
  bindPaneEvents();
  layoutUI(); }
function layoutUI(){
  $('#paneTabs').innerHTML=panes.map((p,i)=>
    `<span class="ptab${i===activePane?' on':''}" data-i="${i}">P${i+1} · ${paneTitle(p.key)}</span>`).join('');
  $('#paneTabs').querySelectorAll('.ptab').forEach(t=>
    t.addEventListener('click',()=>{activePane=+t.dataset.i;layoutUI();syncPaneUI();})); }
function activeP(){ return panes[activePane]; }
function syncPaneUI(){ panes.forEach((p,i)=>{
  p.box.classList.toggle('activePane',i===activePane);
  p.box.querySelector('.pn').textContent='P'+(i+1)+' · '+paneTitle(p.key);
  const q=p.key?quotes.get(p.key):null;
  const pc=p.key?resolveMeta(p.key):null;
  const chg=q&&q.prevClose?((q.ltp-q.prevClose)/q.prevClose*100):0;
  const pl=p.box.querySelector('.pl');
  pl.textContent=q?fmtP(q.ltp):'—';
  pl.style.color=chg>=0?'var(--up)':'var(--dn)';
  p.box.querySelector('.px').style.visibility=p.key?'visible':'hidden'; }); }
function paneLoadSymbol(key){                      /* load into ACTIVE pane only */
  key=normKey(key);
  const p=activeP();
  p.key=key;
  p.pctBase=null; p.view=null; p.drawings=[]; p.undo=[]; p.selId=null;
  p.yLo=p.yHi=null; p.aggCache.clear(); p.indCache=null;
  ensureQuote(key);
  syncPaneUI(); refreshWatch(); refreshStrikes();
  if(SRC==='sim')symbolData(key);
  toast(`P${activePane+1} ← ${disp(key)}`); }
function paneSetTF(t){ const p=activeP();
  p.tf=t; $('#tfSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('on',+b.dataset.tf===t));
  $('#ghostCtl').classList.toggle('dis',t===1); }
 $('#tfSeg').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>paneSetTF(+b.dataset.tf)));
 $('#ghostToggle').addEventListener('click',()=>{ const p=activeP();
  p.ghost=!p.ghost; $('#ghostToggle').classList.toggle('on',p.ghost); });
 $('#styleSeg').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
  activeP().ghostStyle=b.dataset.s;
  $('#styleSeg').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); }));
 $('#laySel').addEventListener('change',e=>{ layout=e.target.value; CFG.layout=layout; saveCfg(); buildLayout(); });
 $('#paneAdd').addEventListener('click',()=>{
  const order=['2v','2h','3','4','1'];
  const next=order[(order.indexOf(layout)+1)%order.length];
  $('#laySel').value=next; $('#laySel').dispatchEvent(new Event('change')); });
 $('#sclPop').querySelectorAll('input').forEach(cb=>cb.addEventListener('change',()=>{
  scales[cb.dataset.scale]=cb.checked;
  if(!SORDER.some(s=>scales[s]))scales.price=true;
  syncScalesUI(); }));
function syncScalesUI(){ $('#sclPop').querySelectorAll('input').forEach(cb=>cb.checked=!!scales[cb.dataset.scale]); }
 $('#indPop').querySelectorAll('input').forEach(cb=>cb.addEventListener('change',()=>{
  PANE_DEFS.find(x=>x.id===cb.dataset.pane).on=cb.checked; }));
function syncGhostUI(){ const p=activeP();
  $('#ghostToggle').classList.toggle('on',p.ghost);
  $('#ghostCtl').classList.toggle('dis',p.tf===1);
  $('#styleSeg').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.s===p.ghostStyle));
  $('#tfSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('on',+b.dataset.tf===p.tf)); }

/* ============ orders / positions ============ */
let positions=[], trades=[], posId=1;
const realized={};
function currentPriceOf(key){ const q=quotes.get(key); return q?q.ltp:resolveMeta(key).basePrice; }
function ticketLot(){ const m=ticketKey||SYM?.key;
  if(!m)return 1; const mm=resolveMeta(m);
  return (mm.root&&LOTS[mm.root])?LOTS[mm.root]:1; }
function updateLotLbl(){ const lot=ticketLot();
  $('#lotLbl').textContent=lot>1?'LOT':'SH';
  $('#tkQty').title=lot>1?`lots · 1 lot = ${lot}`:'shares'; }
function resolveFill(live){
  if(ordType==='LMT'){ const v=+$('#ordPx').value; return isFinite(v)&&v>0?v:live; }
  return live; }
async function routeOrder(key,side,qty,px){
  if(SRC==='sim')return true;
  const {exch,sym}=parseKey(key);
  try{
    await activeBroker().placeOrder(bcfg(SRC),{key,exch,sym,side,qty,
      priceType:ordType,price:ordType==='LIMIT'?px:0,product:PRD});
    return true;
  }catch(e){ toast('broker order failed: '+e.message,'err'); return false; } }
async function placeKeyOrder(key,side,qty,px){
  if(!key||qty<=0)return;
  ensureQuote(key);
  const live=px??currentPriceOf(key), fill=resolveFill(live);
  if(await routeOrder(key,side,qty,fill)===false)return;
  let rem=qty;
  for(const p of positions.filter(p=>p.key===key&&p.side!==side&&p.qty>0)){
    const take=Math.min(p.qty,rem);
    if(take>0){ const pnl=(fill-p.avg)*p.side*take;
      realized[key]=(realized[key]||0)+pnl;
      trades.unshift({t:ts(),key,side:-p.side,qty:take,price:fill,pnl});
      p.qty-=take; rem-=take; } }
  positions=positions.filter(p=>p.qty>1e-9);
  if(rem>0){ const same=positions.find(p=>p.key===key&&p.side===side);
    if(same){ const tq=same.qty+rem; same.avg=(same.avg*same.qty+fill*rem)/tq; same.qty=tq; }
    else positions.push({id:posId++,key,side,qty:rem,avg:fill}); }
  trades.unshift({t:ts(),key,side,qty,price:fill,pnl:null});
  refreshPositions(); refreshStrikes(); updateAcct(); }
async function squareOff(id){
  const i=positions.findIndex(p=>p.id===id); if(i<0)return;
  const p=positions[i]; const ltp=currentPriceOf(p.key);
  await routeOrder(p.key,-p.side,p.qty,ltp);
  const pnl=(ltp-p.avg)*p.side*p.qty;
  realized[p.key]=(realized[p.key]||0)+pnl;
  trades.unshift({t:ts(),key:p.key,side:-p.side,qty:p.qty,price:ltp,pnl});
  positions.splice(i,1); refreshPositions(); refreshStrikes(); updateAcct(); }
window.squareOff=squareOff;
function editPosition(id){ editRowId=id; renderPosEdit(); }
window.editPosition=editPosition;
function cancelEdit(){ editRowId=null; refreshPositions(); }
window.cancelEdit=cancelEdit;
function saveEdit(id){
  const tr=document.querySelector(`#tbPos tr[data-id="${id}"]`); if(!tr)return;
  const nq=Math.max(0,Math.round(+tr.querySelector('.eq').value||0));
  const na=Math.max(0,+tr.querySelector('.ea').value||0);
  const p=positions.find(x=>x.id===id); if(!p)return;
  const key=p.key, ltp=currentPriceOf(key);
  if(nq===0){ editRowId=null; squareOff(id); return; }
  const d=nq-p.qty;
  if(d!==0) routeOrder(key,d>0?p.side:-p.side,Math.abs(d),ltp);
  if(d<0){ const pnl=(ltp-p.avg)*p.side*(-d);
    realized[key]=(realized[key]||0)+pnl;
    trades.unshift({t:ts(),key,side:-p.side,qty:-d,price:ltp,pnl}); }
  else if(d>0){ p.avg=(p.avg*p.qty+ltp*d)/nq; }
  p.qty=nq; if(na>0)p.avg=na;
  editRowId=null; refreshPositions(); refreshStrikes(); updateAcct(); }
window.saveEdit=saveEdit;
function repeatPos(id){ const p=positions.find(x=>x.id===id); if(!p)return;
  placeKeyOrder(p.key,p.side,p.qty);
  toast(`repeat ${p.side>0?'BUY':'SELL'} ${p.qty} ${disp(p.key)}`,'ok'); }
window.repeatPos=repeatPos;
async function swapPos(id){
  const p=positions.find(x=>x.id===id); if(!p)return;
  const m=/(CE|PE)$/.exec(p.key);
  await squareOff(id);
  if(m){ const nk=p.key.replace(/(CE|PE)$/,m[1]==='CE'?'PE':'CE');
    await placeKeyOrder(nk,p.side,p.qty);
    toast(`swapped → ${disp(nk)} ${p.qty}`,'ok');
  }else{ await placeKeyOrder(p.key,-p.side,p.qty);
    toast(`swapped → ${p.side>0?'SELL':'BUY'} ${p.qty} ${disp(p.key)}`,'ok'); } }
window.swapPos=swapPos;
function repeatTrade(i){ const t=trades[i]; if(!t)return;
  placeKeyOrder(t.key,t.side,t.qty);
  toast(`repeat ${t.side>0?'BUY':'SELL'} ${t.qty} ${disp(t.key)}`,'ok'); }
window.repeatTrade=repeatTrade;

function renderPosEdit(){                             /* draw the edit row once */
  const tb=$('#tbPos'); const p=positions.find(x=>x.id===editRowId);
  if(!p){editRowId=null;refreshPositions();return;}
  const ltp=currentPriceOf(p.key);
  const pnl=(ltp-p.avg)*p.side*p.qty, net=pnl+(realized[p.key]||0);
  tb.innerHTML=positions.map(x=>{
    if(x.id!==editRowId)return posRowHTML(x,false);
    return `<tr data-id="${x.id}"><td><b>${disp(x.key)}</b></td>
      <td class="${x.side>0?'u':'d'}">${x.side>0?'BUY':'SELL'}</td>
      <td class="ed"><input class="eq" type="number" min="0" value="${x.qty}"></td>
      <td class="ed"><input class="ea" type="number" step="0.05" value="${x.avg.toFixed(2)}"></td>
      <td>${fmtP(ltp)}</td>
      <td class="${pnl>=0?'u':'d'}">${pnl>=0?'+':''}${pnl.toFixed(2)}</td>
      <td class="${net>=0?'u':'d'}">${net>=0?'+':''}${net.toFixed(2)}</td>
      <td><button class="pb" onclick="saveEdit(${x.id})">SAVE</button><button class="sq" onclick="cancelEdit()">CANCEL</button></td></tr>`;
  }).join('');
  const tr=tb.querySelector(`tr[data-id="${p.id}"]`);
  tr.querySelector('.eq').focus(); tr.querySelector('.eq').select(); }
function posRowHTML(p,editable){ return editable?'':''; }
function refreshPositions(){
  const tb=$('#tbPos');
  if(editRowId!=null){                               /* frozen: only live cells */
    const p=positions.find(x=>x.id===editRowId);
    if(!p){editRowId=null;}
    else{
      const tr=tb.querySelector(`tr[data-id="${p.id}"]`);
      if(tr&&tr.querySelector('.eq')){
        const ltp=currentPriceOf(p.key);
        const pnl=(ltp-p.avg)*p.side*p.qty, net=pnl+(realized[p.key]||0);
        tr.cells[4].textContent=fmtP(ltp);
        tr.cells[5].textContent=(pnl>=0?'+':'')+pnl.toFixed(2); tr.cells[5].className=pnl>=0?'u':'d';
        tr.cells[6].textContent=(net>=0?'+':'')+net.toFixed(2); tr.cells[6].className=net>=0?'u':'d';
        return; } } }
  if(!positions.length){
    editRowId=null;
    tb.innerHTML='<tr class="emptyRow"><td colspan="8">no open positions</td></tr>';
  }else{
    tb.innerHTML=positions.map(p=>{
      const ltp=currentPriceOf(p.key);
      const pnl=(ltp-p.avg)*p.side*p.qty, net=pnl+(realized[p.key]||0);
      return `<tr data-id="${p.id}"><td><b>${disp(p.key)}</b></td>
        <td class="${p.side>0?'u':'d'}">${p.side>0?'BUY':'SELL'}</td><td>${p.qty}</td>
        <td>${fmtP(p.avg)}</td><td>${fmtP(ltp)}</td>
        <td class="${pnl>=0?'u':'d'}">${pnl>=0?'+':''}${pnl.toFixed(2)}</td>
        <td class="${net>=0?'u':'d'}">${net>=0?'+':''}${net.toFixed(2)}</td>
        <td><button class="pb" onclick="editPosition(${p.id})">EDIT</button><button class="pb" onclick="repeatPos(${p.id})">REPEAT</button><button class="pb" onclick="swapPos(${p.id})">SWAP</button><button class="sq dz" onclick="squareOff(${p.id})">SQ-OFF</button></td></tr>`;
    }).join(''); }
  const tb2=$('#tbTrd');
  if(!trades.length){tb2.innerHTML='<tr class="emptyRow"><td colspan="7">no trades yet</td></tr>';}
  else tb2.innerHTML=trades.slice(0,80).map((t,i)=>`<tr><td>${t.t}</td><td><b>${disp(t.key)}</b></td>
    <td class="${t.side>0?'u':'d'}">${t.side>0?'BUY':'SELL'}</td><td>${t.qty}</td><td>${fmtP(t.price)}</td>
    <td class="${(t.pnl??0)>=0?'u':'d'}">${t.pnl==null?'—':(t.pnl>=0?'+':'')+t.pnl.toFixed(2)}</td>
    <td><button class="pb" onclick="repeatTrade(${i})">REPEAT</button></td></tr>').join(''); }
 $('#tbPos').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&e.target.classList.contains('eq')){
    const tr=e.target.closest('tr'); saveEdit(+tr.dataset.id); } });

function updateAcct(){
  let mtm=0,used=0;
  for(const p of positions){
    const ltp=currentPriceOf(p.key);
    mtm+=(ltp-p.avg)*p.side*p.qty;
    used+=p.avg*p.qty*(p.side>0?1:0.12); }
  for(const k in realized)mtm+=realized[k];
  $('#capChip').innerHTML=`CAP <b>${fmtInr(usableFunds())}</b> · USED <b>${fmtInr(used)}</b>`;
  $('#pnlChip').innerHTML=`P&amp;L <b class="${mtm>=0?'u':'d'}">${mtm>=0?'+':''}${fmtInr(mtm)}</b>`;
  const cs=$('#capSlider');
  cs.max=CFG.deployMode==='pct'?100:Math.max(1,Math.round(CFG.cap));
  cs.value=Math.round(CFG.deployVal);
  $('#capPct').textContent=CFG.deployMode==='pct'?Math.round(CFG.deployVal)+'%':fmtInr(CFG.deployVal); }
 $('#capSlider').addEventListener('input',e=>{
  CFG.deployVal=+e.target.value; saveCfg(); updateAcct(); refreshStrikes(); });
 $('#defLots').addEventListener('change',e=>{
  CFG.defLots=Math.max(1,Math.round(+e.target.value||1)); e.target.value=CFG.defLots;
  saveCfg(); refreshStrikes(); });
 $('#prdSel').addEventListener('change',e=>{ PRD=e.target.value; });

/* ============ watchlist ============ */
let watch=JSON.parse(localStorage.getItem('scalping_watch')||
  '["NSE:NIFTY","NSE:BANKNIFTY","NSE:RELIANCE","NSE:HDFCBANK","NSE:TCS"]');
const wRefs=new Map();
function buildWatch(){
  const body=$('#wBody'); body.innerHTML=''; wRefs.clear();
  $('#wCnt').textContent=watch.length;
  watch.forEach(key=>{
    const m=resolveMeta(key); ensureQuote(key);
    const row=document.createElement('div');row.className='wrow'+(SYM&&key===SYM.key?' on':'');
    row.innerHTML=`<span class="typ ${m.type}">${m.type[0]}</span>
      <span class="nm"><b>${m.type==='OPT'?m.disp:m.sym}</b><i>${m.exch}${m.exp?' · '+m.exp:''}</i></span>
      <span class="px"><b>—</b><i>—</i></span><button class="rm">✕</button>`;
    row.addEventListener('click',e=>{ if(e.target.classList.contains('rm'))return; loadSymbol(key); });
    row.querySelector('.rm').addEventListener('click',e=>{e.stopPropagation();
      watch=watch.filter(k=>k!==key); persistWatch(); buildWatch(); });
    body.appendChild(row);
    wRefs.set(key,{px:row.querySelector('.px b'),pc:row.querySelector('.px i'),row}); });
  refreshWatch(); }
function refreshWatch(){
  for(const [key,r] of wRefs){ const q=ensureQuote(key);
    const chg=(q.ltp-q.prevClose)/q.prevClose*100;
    r.px.textContent=fmtP(q.ltp);
    r.pc.textContent=(chg>=0?'+':'')+chg.toFixed(2)+'%';
    r.pc.style.color=chg>=0?'var(--up)':'var(--dn)';
    r.row.classList.toggle('on',!!SYM&&key===SYM.key); } }
function persistWatch(){localStorage.setItem('scalping_watch',JSON.stringify(watch));}

/* ============ segments, expiries ============ */
let inst='spot', expIdx=0, expFor='opt';
function rootOf(){ if(!SYM)return null;
  if(SYM.type==='OPT'||SYM.type==='FUT')return SYM.root;
  return FNO_SET.has(SYM.sym)?SYM.sym:null; }
function buildExpSel(){
  const sel=$('#expSel'); sel.innerHTML='';
  const isFut=inst==='fut';
  const list=expAll.filter(e=>isFut?true:e.kind==='weekly'||e.date-expAll[0].date<21e8*8);
  const opts=isFut?expAll:expAll.filter(e=>e.kind==='weekly'||e.kind==='monthly');
  opts.forEach((e,i)=>{ const o=document.createElement('option');
    o.value=expAll.indexOf(e); o.textContent=e.f+(e.kind==='monthly'?' ·M':'');
    sel.appendChild(o); });
  const def=nextWeekly();
  expIdx=expAll.indexOf(def); sel.value=expIdx; }
function applyFnoUI(){
  const root=rootOf(); const hasFno=!!root;
  document.querySelectorAll('#instSeg button').forEach(b=>{
    b.classList.toggle('on',b.dataset.i===inst);
    b.disabled=!hasFno&&b.dataset.i!=='spot'; });
  const sel=$('#expSel');
  sel.style.display=hasFno?'':'none';
  sel.disabled=!hasFno||inst==='spot';
  if(hasFno) buildExpSel(); }
document.querySelectorAll('#instSeg button').forEach(b=>b.addEventListener('click',()=>{
  inst=b.dataset.i;
  applyFnoUI();
  if(inst==='spot'){ if(SYM&&SYM.type!=='INDEX')loadSymbol(rootOf()?'NSE:'+rootOf():(SYM?SYM.key:'NSE:NIFTY')); }
  else if(inst==='fut'&&rootOf()) loadSymbol('NFO:'+rootOf()+expAll[expIdx].f+'FUT');
  else if(inst==='opt'&&rootOf()) loadAtmChart();
  ensureAtmRow(); refreshStrikes(); }));
 $('#expSel').addEventListener('change',e=>{
  expIdx=+e.target.value; if(!rootOf())return;
  if(inst==='fut')loadSymbol('NFO:'+rootOf()+expAll[expIdx].f+'FUT');
  else {strikeSig='';refreshStrikes();} });
function loadAtmChart(){ const root=rootOf(); if(!root)return;
  const spot=liveSpot(root), st=strikeStep(root,spot);
  loadSymbol('NFO:'+root+expAll[expIdx].f+Math.round(spot/st)*st+(SYM&&SYM.type==='OPT'?SYM.optSide:'CE')); }
function updateStrikesVis(){
  const root=rootOf(); const show=!!root&&inst==='opt';
  $('#strikes').style.display=show?'flex':'none';
  return show?root:null; }

/* ============ strike panel ============ */
let optSide='CE', optRole='buyer', offDir=1, strikeSig='';
const strikeLists=new Map();
const rowRefs=new Map();
let stSort='K', stFilt='ALL';
function listFor(){ const root=rootOf(); if(!root)return null;
  const k=root+'|'+expAll[expIdx].f;
  if(!strikeLists.has(k))strikeLists.set(k,[]);
  return strikeLists.get(k); }
function optLtp(root,K,side){
  return bs(liveSpot(root),K,tym(expAll[expIdx].f),IDX[root]?0.13:0.22,side==='CE'); }
function optKey(root,K,side){ return 'NFO:'+root+expAll[expIdx].f+K+side; }
function netQty(key){ return positions.filter(p=>p.key===key).reduce((a,p)=>a+p.side*p.qty,0); }
function syncDefaults(){
  $('#cpSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.s===optSide));
  $('#bsSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.s===optRole));
  $('#sgnP').classList.toggle('on',offDir>0);
  $('#sgnM').classList.toggle('on',offDir<0); }
 $('#cpSeg').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{optSide=b.dataset.s;syncDefaults();}));
 $('#bsSeg').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{optRole=b.dataset.s;syncDefaults();}));
 $('#sgnP').addEventListener('click',()=>{offDir=1;syncDefaults();});
 $('#sgnM').addEventListener('click',()=>{offDir=-1;syncDefaults();});
function addStrike(K,side,role){
  const list=listFor(); if(!list)return;
  K=Math.round(K); if(list.some(r=>r.K===K))return;
  list.push({K,side:side||optSide,role:role||optRole,on:true,sl:'',tp:'',ent:'',amode:'auto',aval:0});
  list.sort((a,b)=>a.K-b.K); strikeSig=''; refreshStrikes(); }
function ensureAtmRow(){
  const root=rootOf(); if(!root||inst!=='opt')return;
  if(listFor().length)return;
  const spot=liveSpot(root), step=strikeStep(root,spot);
  addStrike(Math.round(spot/step)*step,'CE','buyer'); }
function loadOffset(n){
  const root=rootOf(); if(!root){toast('load an FNO underlying first (OPT mode)','err');return;}
  const spot=liveSpot(root), step=strikeStep(root,spot);
  addStrike(Math.round(spot/step)*step+(n?offDir*n*step:0),optSide,optRole); }
 $('#qAtm').addEventListener('click',()=>loadOffset(null));
document.querySelectorAll('.qb.num').forEach(b=>b.addEventListener('click',()=>loadOffset(+b.dataset.n)));
 $('#stAdd').addEventListener('click',()=>{ const K=+$('#stIn').value;
  if(K>0&&rootOf()){addStrike(K,optSide,optRole);$('#stIn').value='';} });
 $('#stIn').addEventListener('keydown',e=>{if(e.key==='Enter')$('#stAdd').click();});
 $('#stSort').addEventListener('change',e=>{stSort=e.target.value;strikeSig='';refreshStrikes();});
 $('#stFilt').addEventListener('change',e=>{stFilt=e.target.value;strikeSig='';refreshStrikes();});
function normalizeAlloc(side,changedK,newPct){
  const root=rootOf(); if(!root)return;
  const others=(strikeLists.get(root+'|'+expAll[expIdx].f)||[])
    .filter(r=>r.side===side&&r.amode==='pct'&&r.K!==changedK);
  const sum=others.reduce((s,r)=>s+(+r.aval||0),0);
  const rest=Math.max(0,100-newPct);
  others.forEach(r=>{ r.aval=sum>0?Math.round(rest*(+r.aval||0)/sum*100)/100:0; }); }
function rowLots(r,root){
  if(r.amode==='auto')return Math.max(1,Math.round(+CFG.defLots||1));
  const lot=LOTS[root]||1, px=optLtp(root,r.K,r.side);
  if(r.amode==='amt')return Math.max(0,Math.floor((+r.aval||0)/(px*lot)));
  return Math.max(0,Math.floor(usableFunds()*(+r.aval||0)/100/(px*lot))); }
function rowAmt(r,root){
  if(r.amode==='amt')return +r.aval||0;
  if(r.amode==='pct')return usableFunds()*(+r.aval||0)/100;
  return rowLots(r,root)*optLtp(root,r.K,r.side)*(LOTS[root]||1); }
function sideInfo(side){
  const root=rootOf(); if(!root)return{n:0,amt:0,lots:0};
  const list=(strikeLists.get(root+'|'+expAll[expIdx].f)||[]).filter(r=>r.side===side);
  let amt=0,lots=0;
  list.forEach(r=>{ amt+=rowAmt(r,root); lots+=rowLots(r,root); });
  return{n:list.length,amt,lots}; }
function deploy(sideOpt){
  const root=rootOf(); if(!root){toast('load an FNO underlying / option first','err');return;}
  const list=(strikeLists.get(root+'|'+expAll[expIdx].f)||[]).filter(r=>r.on&&r.side===sideOpt);
  if(!list.length){toast(`no enabled ${sideOpt} strikes (☑)`,'err');return;}
  let n=0,sk=0;
  list.forEach(r=>{
    const lots=rowLots(r,root), lot=LOTS[root]||1;
    if(lots<1){sk++;return;}
    placeKeyOrder(optKey(root,r.K,r.side),r.role==='buyer'?1:-1,lots*lot,optLtp(root,r.K,r.side));
    n++; });
  toast(`DEPLOY ${sideOpt} · ${n} strike(s) · ${PRD}${sk?` · ${sk} skipped`:''}`,'ok'); }
function deployAtm(sideOpt){
  const root=rootOf(); if(!root){toast('load an FNO underlying first','err');return;}
  const spot=liveSpot(root), step=strikeStep(root,spot);
  const K=Math.round(spot/step)*step;
  const r=listFor().find(x=>x.K===K);
  if(r){ r.side=sideOpt; r.on=true; } else addStrike(K,sideOpt,optRole);
  strikeSig=''; refreshStrikes(); deploy(sideOpt); }
function closeSide(sideOpt){
  const root=rootOf(); if(!root)return;
  const list=(strikeLists.get(root+'|'+expAll[expIdx].f)||[]).filter(r=>r.on&&r.side===sideOpt);
  let n=0;
  list.forEach(r=>positions.filter(p=>p.key===optKey(root,r.K,r.side)).forEach(p=>{squareOff(p.id);n++;}));
  toast(n?`closed ${n} ${sideOpt} position(s)`:`no open ${sideOpt} on enabled strikes`); }
async function swapQuick(){
  const root=rootOf(); if(!root)return;
  const list=(strikeLists.get(root+'|'+expAll[expIdx].f)||[]).filter(r=>r.on);
  if(!list.length){toast('no enabled rows to swap','err');return;}
  let n=0;
  for(const r of list){
    await Promise.all([...positions.filter(p=>p.key===optKey(root,r.K,r.side))].map(p=>squareOff(p.id)));
    if(r.side==='CE')r.side='PE'; else if(r.side==='PE')r.side='CE';
    else r.role=r.role==='buyer'?'seller':'buyer';   /* non-option rows flip BUY/SELL role */
    const key=optKey(root,r.K,r.side), lot=LOTS[root]||1;
    const lots=rowLots(r,root);
    if(lots>=1){ await placeKeyOrder(key,r.role==='buyer'?1:-1,lots*lot,optLtp(root,r.K,r.side)); n++; } }
  strikeSig=''; refreshStrikes();
  toast(`SWAP executed · closed + flipped + deployed ${n}`,'ok'); }
 $('#qDCE').addEventListener('click',()=>deploy('CE'));
 $('#qDPE').addEventListener('click',()=>deploy('PE'));
 $('#qSW').addEventListener('click',swapQuick);
 $('#qCCE').addEventListener('click',()=>closeSide('CE'));
 $('#qCPE').addEventListener('click',()=>closeSide('PE'));
 $('#qCA').addEventListener('click',()=>{ const n=positions.length;
  [...positions].forEach(p=>squareOff(p.id)); toast(n?`closed all (${n})`:'no open positions'); });
 $('#qCXL').addEventListener('click',()=>{
  const list=listFor(); if(list)list.forEach(r=>r.on=false);
  ticketKey=null; $('#tkSym').textContent=SYM?SYM.disp:'—';
  refreshStrikes(); toast('cancelled selections'); });
const amLabel=m=>m==='auto'?'AUTO':m==='pct'?'%':'₹';
function renderStrikeRows(root,exp,list){
  const body=$('#stBody'); body.innerHTML=''; rowRefs.clear();
  if(!list.length){ body.innerHTML='<div class="pempty">no strikes yet<br>ATM · ±1…7 · or custom input</div>'; return; }
  list.forEach(r=>{
    const row=document.createElement('div');row.className='srow';row.dataset.k=r.K;
    row.innerHTML=`
      <div class="l1">
        <input type="checkbox" data-act="en" ${r.on?'checked':''}>
        <button class="mv" data-act="dn">−</button>
        <span class="k" title="open in active pane + ticket">${r.K}</span>
        <button class="mv" data-act="up">+</button>
        <span class="tg side"><button data-tg="side" data-v="CE" class="${r.side==='CE'?'on':''}">C</button><button data-tg="side" data-v="PE" class="${r.side==='PE'?'on':''}">P</button></span>
        <span class="tg"><button data-tg="role" data-v="buyer" class="${r.role==='buyer'?'on':''}">BY</button><button data-tg="role" data-v="seller" class="${r.role==='seller'?'on':''}">SL</button></span>
        <span class="lpx">—</span>
        <button class="mv" data-act="rm">✕</button>
      </div>
      <div class="l2"><span class="hl">—</span><span style="margin-left:auto"><b class="amtB">—</b> · <span class="lotB">—</span></span></div>
      <div class="l3">
        <span class="lbl">E</span><input class="tin" data-f="ent" value="${r.ent}">
        <span class="lbl">SL</span><input class="tin" data-f="sl" value="${r.sl}">
        <span class="lbl">TP</span><input class="tin" data-f="tp" value="${r.tp}">
        <button class="mb buy" data-act="buy">B</button>
        <button class="mb sell" data-act="sell">S</button>
      </div>
      <div class="l4">
        <button class="mb" data-act="am">${amLabel(r.amode)}</button>
        <input type="range" class="als" min="0" max="${r.amode==='amt'?Math.max(1,Math.round(usableFunds())):100}" step="${r.amode==='amt'?1000:1}" value="${r.aval||0}" ${r.amode==='auto'?'disabled':''}>
        <input class="tin wide" data-f="qty" type="number" min="0" placeholder="lots">
        <button class="mb exit" data-act="exit" disabled>EXIT</button>
      </div>
      <div class="l5"><span class="pos">—</span><span class="pnl">—</span></div>`;
    body.appendChild(row);
    rowRefs.set(r.K,{row,lpx:row.querySelector('.lpx'),
      hl:row.querySelector('.hl'),amt:row.querySelector('.amtB'),lot:row.querySelector('.lotB'),
      pos:row.querySelector('.pos'),pnl:row.querySelector('.pnl'),
      exit:row.querySelector('[data-act="exit"]')}); }); }
 $('#stBody').addEventListener('click',e=>{
  const row=e.target.closest('.srow'); if(!row)return;
  const K=+row.dataset.k, root=rootOf(); const r=listFor().find(x=>x.K===K); if(!r)return;
  const act=e.target.dataset.act, tg=e.target.dataset.tg;
  if(tg==='side'){ if(r.side!==e.target.dataset.v){r.side=e.target.dataset.v;strikeSig='';refreshStrikes();} return; }
  if(tg==='role'){ if(r.role!==e.target.dataset.v){r.role=e.target.dataset.v;strikeSig='';refreshStrikes();} return; }
  if(act==='am'){ r.amode=r.amode==='auto'?'pct':r.amode==='pct'?'amt':'auto';
    e.target.textContent=amLabel(r.amode);
    const als=row.querySelector('.als');
    als.disabled=r.amode==='auto';
    als.max=r.amode==='amt'?Math.max(1,Math.round(usableFunds())):100;
    als.step=r.amode==='amt'?1000:1;
    updateStrikeCells(root,expAll[expIdx].f,listFor()); return; }
  if(e.target.classList.contains('k')||e.target.classList.contains('lpx')){
    const key=optKey(root,K,r.side);
    ticketKey=key; $('#tkSym').textContent=disp(key);
    $('#tkQty').value=1; updateLotLbl();
    document.querySelectorAll('.srow').forEach(x=>x.classList.toggle('selRow',x===row));
    loadSymbol(key); return; }
  const step=strikeStep(root,liveSpot(root));
  if(act==='en'){ r.on=e.target.checked; return; }
  if(act==='up'||act==='dn'){ r.K=K+(act==='up'?step:-step);
    listFor().sort((a,b)=>a.K-b.K); strikeSig=''; refreshStrikes(); return; }
  if(act==='rm'){ const list=listFor(); list.splice(list.findIndex(x=>x.K===K),1);
    strikeSig=''; refreshStrikes(); return; }
  if(act==='buy'||act==='sell'){
    const key=optKey(root,K,r.side), lot=LOTS[root]||1;
    const lots=Math.max(1,rowLots(r,root));
    placeKeyOrder(key,act==='buy'?1:-1,lots*lot,optLtp(root,K,r.side));
    ticketKey=key; $('#tkSym').textContent=disp(key); updateLotLbl();
    toast(`${act==='buy'?'BUY':'SELL'} ${lots} lot (${lots*lot}) ${disp(key)}`,'ok');
    return; }
  if(act==='exit'){ positions.filter(p=>p.key===optKey(root,K,r.side)).forEach(p=>squareOff(p.id)); return; } });
 $('#stBody').addEventListener('input',e=>{
  const row=e.target.closest('.srow'); if(!row)return;
  const K=+row.dataset.k, root=rootOf(); const r=listFor().find(x=>x.K===K); if(!r)return;
  if(e.target.classList.contains('als')){
    r.aval=+e.target.value;
    const ref=rowRefs.get(K);
    if(ref){ ref.amt.textContent=fmtInr(rowAmt(r,root));
      ref.lot.textContent=rowLots(r,root)+'L · '+fmtInr(optLtp(root,K,r.side)*(LOTS[root]||1))+'/lot'; } } });
 $('#stBody').addEventListener('change',e=>{
  const row=e.target.closest('.srow'); if(!row)return;
  const K=+row.dataset.k, root=rootOf(); const r=listFor().find(x=>x.K===K); if(!r)return;
  if(e.target.classList.contains('als')){
    r.aval=+e.target.value||0;
    if(r.amode==='pct')normalizeAlloc(r.side,r.K,r.aval);
    strikeSig=''; refreshStrikes(); return; }
  const f=e.target.dataset.f;
  if(f==='sl')r.sl=e.target.value;
  else if(f==='tp')r.tp=e.target.value;
  else if(f==='ent')r.ent=e.target.value;
  else if(f==='qty'){
    const lot=LOTS[root]||1, key=optKey(root,K,r.side);
    const curQty=positions.filter(p=>p.key===key).reduce((a,p)=>a+p.side*p.qty,0);
    const nq=(Math.max(0,+e.target.value||0))*lot;
    if(nq!==curQty)editKeyPosition(key,nq,0); }
  else if(f==='pq'||f==='pa'){
    editKeyPosition(optKey(root,K,r.side),
      +row.querySelector('[data-f="pq"]').value||0,
      +row.querySelector('[data-f="pa"]').value||0); } });
function editKeyPosition(key,nq,na){
  const ps=positions.filter(p=>p.key===key);
  const curQty=ps.reduce((a,p)=>a+p.side*p.qty,0);
  const totQ=ps.reduce((a,p)=>a+p.qty,0);
  const curAvg=totQ>0?ps.reduce((a,p)=>a+p.avg*p.qty,0)/totQ:0;
  const ltp=currentPriceOf(key);
  if(nq===curQty){ if(na>0)ps.forEach(p=>p.avg=na); }
  else{ const d=nq-curQty;
    if(d<0){ let closed=-d; const pnl=(ltp-curAvg)*Math.sign(curQty)*closed;
      realized[key]=(realized[key]||0)+pnl;
      trades.unshift({t:ts(),key,side:-Math.sign(curQty),qty:closed,price:ltp,pnl});
      for(const p of ps){const t=Math.min(p.qty,closed);p.qty-=t;closed-=t;if(closed<=0)break;}
      positions=positions.filter(p=>p.qty>1e-9);
      if(na>0)positions.filter(p=>p.key===key).forEach(p=>p.avg=na);
    }else{
      positions.push({id:posId++,key,side:Math.sign(nq)||1,qty:Math.abs(d),avg:na>0?na:ltp});
      if(na>0)positions.filter(p=>p.key===key).forEach(p=>p.avg=na); } }
  refreshPositions(); refreshStrikes(); updateAcct(); }
function setCell(el,html){
  if(el.contains(document.activeElement))return;
  if(el.dataset.h!==html){el.innerHTML=html;el.dataset.h=html;} }
function updateStrikeCells(root,exp,list){
  const S=liveSpot(root), iv=IDX[root]?0.13:0.22, T=tym(exp), lot=LOTS[root]||1;
  const atm=Math.round(S/strikeStep(root,S))*strikeStep(root,S);
  for(const r of list){
    const ref=rowRefs.get(r.K); if(!ref)continue;
    const ltp=optLtp(root,r.K,r.side);
    const hi=bs(S*1.004,r.K,T,iv,r.side==='CE'), lo=bs(S*0.996,r.K,T,iv,r.side==='CE');
    const key=optKey(root,r.K,r.side);
    const ps=positions.filter(p=>p.key===key);
    const qty=ps.reduce((a,p)=>a+p.side*p.qty,0);
    const tq=ps.reduce((a,p)=>a+p.qty,0);
    const avg=tq>0?ps.reduce((a,p)=>a+p.avg*p.qty,0)/tq:0;
    const open=ps.reduce((a,p)=>a+(ltp-p.avg)*p.side*p.qty,0);
    const net=open+(realized[key]||0);
    ref.lpx.textContent=ltp>=100?ltp.toFixed(1):ltp.toFixed(2);
    ref.hl.innerHTML=`H <b>${hi>=100?hi.toFixed(1):hi.toFixed(2)}</b> L <b>${lo>=100?hi.toFixed(1):lo.toFixed(2)}</b>`;
    ref.amt.textContent=fmtInr(rowAmt(r,root));
    ref.lot.textContent=rowLots(r,root)+'L · '+fmtInr(ltp*lot)+'/lot';
    ref.row.querySelector('.k').style.color=r.K===atm?'var(--acc)':'';
    const ent=parseFloat(r.ent);
    const entPx=isFinite(ent)&&ent>0?ent:(qty?avg:null);
    if(qty){
      setCell(ref.pos,`<span class="${qty>0?'u':'d'}">${qty>0?'+':''}${qty}${entPx?' @ '+entPx.toFixed(1):''}</span>
        <input class="tin posI" data-f="pq" type="number" value="${qty}">
        <input class="tin posI" data-f="pa" type="number" step="0.05" value="${avg.toFixed(2)}">`);
      setCell(ref.pnl,`<span class="${open>=0?'u':'d'}">${open>=0?'+':''}${open.toFixed(0)}</span>
        <span class="${net>=0?'u':'d'}">/${net>=0?'+':''}${net.toFixed(0)}</span>`);
      ref.exit.disabled=false;
    }else{
      setCell(ref.pos,`<span style="color:var(--faint)">${entPx?'E '+entPx.toFixed(1):'—'}</span>`);
      setCell(ref.pnl,`<span style="color:var(--faint)">—</span>`);
      ref.exit.disabled=true; } } }
function refreshStrikes(){
  const root=updateStrikesVis(); if(!root)return;
  const list=listFor(), exp=expAll[expIdx].f;
  const view=list.filter(r=>stFilt==='ALL'||(stFilt==='B'?r.role==='buyer':stFilt==='S'?r.role==='seller':r.side===stFilt));
  if(stSort==='L')view.sort((a,b)=>optLtp(root,b.K,b.side)-optLtp(root,a.K,a.side));
  else if(stSort==='P')view.sort((a,b)=>{
    const pa=positions.filter(p=>p.key===optKey(root,a.K,a.side)).reduce((s,p)=>s+(currentPriceOf(p.key)-p.avg)*p.side*p.qty,0);
    const pb=positions.filter(p=>p.key===optKey(root,b.K,b.side)).reduce((s,p)=>s+(currentPriceOf(p.key)-p.avg)*p.side*p.qty,0);
    return pb-pa; });
  else view.sort((a,b)=>a.K-b.K);
  const sig=root+'|'+exp+'|'+stSort+stFilt+'|'+list.map(r=>`${r.K}${r.side[0]}${r.role[0]}${netQty(optKey(root,r.K,r.side))?'*':''}`).join(',');
  if(sig!==strikeSig){ strikeSig=sig; renderStrikeRows(root,exp,view); }
  updateStrikeCells(root,exp,view);
  const c=sideInfo('CE'), p2=sideInfo('PE');
  const nCE=list.filter(r=>r.side==='CE').length, nPE=list.length-nCE;
  const nB=list.filter(r=>r.role==='buyer').length, nS=list.length-nB;
  $('#stStats').innerHTML=`CE <b>${nCE}</b>/${c.n} · ${c.lots}L · ${fmtInr(c.amt)} | PE <b>${nPE}</b>/${p2.n} · ${p2.lots}L · ${fmtInr(p2.amt)} | B${nB}/S${nS}`;
  $('#stCnt').textContent=`${view.length}/${list.length}`; }
function checkSLTP(){
  for(const p of [...positions]){
    const m=/^NFO:([A-Z]+)(\d{2}[A-Z]{3}\d{2})(\d+)(CE|PE)$/.exec(p.key); if(!m)continue;
    const row=(strikeLists.get(m[1]+'|'+expAll.find(e=>e.f===m[2])?'':'')||[]);
    const rows=strikeLists.get(m[1]+'|'+m[2])||[];
    const row=rows.find(r=>r.K===+m[3]&&r.side===m[4]); if(!row)continue;
    const sl=parseFloat(row.sl), tp=parseFloat(row.tp);
    if(!isFinite(sl)&&!isFinite(tp))continue;
    const ltp=currentPriceOf(p.key); if(!isFinite(ltp))continue;
    let hit=null;
    if(p.side>0){ if(isFinite(sl)&&ltp<=sl)hit='SL'; else if(isFinite(tp)&&ltp>=tp)hit='TARGET'; }
    else{ if(isFinite(sl)&&ltp>=sl)hit='SL'; else if(isFinite(tp)&&ltp<=tp)hit='TARGET'; }
    if(hit){ toast(`${hit} hit · ${disp(p.key)}`, hit==='SL'?'err':'ok'); squareOff(p.id); } } }

/* ============ scheduler (table tab) ============ */
let sched=[], schedSeq=1;
const ACTS={
  deployCE:()=>deploy('CE'), deployPE:()=>deploy('PE'),
  deployAtmCE:()=>deployAtm('CE'), deployAtmPE:()=>deployAtm('PE'),
  exitCE:()=>closeSide('CE'), exitPE:()=>closeSide('PE'),
  exitAll:()=>{[...positions].forEach(p=>squareOff(p.id));},
  exitSym:k=>{[...positions.filter(p=>p.key===k)].forEach(p=>squareOff(p.id));},
  buySym:k=>{ const lot=ticketLot(); placeKeyOrder(k,1,Math.max(1,+$('#tkQty').value||1)*lot); },
  sellSym:k=>{ const lot=ticketLot(); placeKeyOrder(k,-1,Math.max(1,+$('#tkQty').value||1)*lot); } };
const ACTLBL={deployCE:'DEPLOY CE',deployPE:'DEPLOY PE',deployAtmCE:'ATM CE',deployAtmPE:'ATM PE',
  exitCE:'EXIT CE',exitPE:'EXIT PE',exitAll:'EXIT ALL',exitSym:'EXIT SYMBOL',buySym:'BUY SYMBOL',sellSym:'SELL SYMBOL'};
function renderSched(){
  const tb=$('#tbSch');
  if(!sched.length){tb.innerHTML='<tr class="emptyRow"><td colspan="5">no scheduled actions — add below</td></tr>';return;}
  tb.innerHTML=sched.map(t=>{
    const tgt=t.sym?disp(t.sym):(t.act.startsWith('exit')?'enabled ☑ strikes':t.act.includes('Atm')?'current ATM':'enabled ☑ strikes');
    const pend=!t.done&&t.at>Date.now();
    return `<tr class="${t.done?'':'pend'}"><td><b>${new Date(t.at).toLocaleString('en-IN',{hour12:false})}</b></td>
      <td>${ACTLBL[t.act]||t.act}</td><td>${tgt}</td>
      <td class="${t.done?'':(pend?'u':'d')}">${t.done?'✓ fired':pend?'pending':'missed'}</td>
      <td>${!t.done?`<button class="pb" onclick="schedFire(${t.id})">RUN NOW</button>`:''}<button class="pb" onclick="schedEdit(${t.id})">EDIT</button><button class="sq" onclick="schedDel(${t.id})">✕</button></td></tr>`;}).join(''); }
function schedFire(id){ const t=sched.find(x=>x.id===id); if(!t||t.done)return;
  t.done=true;
  if(t.sym)ACTS[t.act](t.sym); else ACTS[t.act]();
  renderSched(); toast('⏰ '+ACTLBL[t.act]+' fired','ok'); }
window.schedFire=schedFire;
function schedEdit(id){
  const t=sched.find(x=>x.id===id); if(!t)return;
  const v=prompt('New date & time (YYYY-MM-DD HH:MM:SS)',fmtDT(t.at));
  if(!v)return;
  const ms=new Date(v.replace(' ','T')).getTime();
  if(!isFinite(ms)){toast('invalid date','err');return;}
  t.at=ms; t.done=false; renderSched(); }
window.schedEdit=schedEdit;
function schedDel(id){ sched=sched.filter(x=>x.id!==id); renderSched(); }
window.schedDel=schedDel;
function fmtDT(ms){ const d=new Date(ms),p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('on',x===b));
  $('#tblPos').style.display=b.dataset.t==='pos'?'':'none';
  $('#tblTrd').style.display=b.dataset.t==='trd'?'':'none';
  $('#tblSch').style.display=b.dataset.t==='sch'?'':'none';
  if(b.dataset.t==='sch')renderSched(); }));
 $('#scAdd2').addEventListener('click',()=>{
  const act=$('#scAct').value, at=new Date($('#scAt').value.replace(' ','T')).getTime();
  let sym=null;
  if(act==='exitSym'||act==='buySym'||act==='sellSym')sym=ticketKey||(SYM&&SYM.key);
  if(!isFinite(at)){toast('pick a valid date & time','err');return;}
  if(at<Date.now()){toast('time is in the past','err');return;}
  sched.push({id:schedSeq++,at,act,sym,done:false});
  renderSched();
  toast(`⏰ scheduled ${ACTLBL[act]}${sym?' · '+disp(sym):''}`,'ok'); });
setInterval(()=>{ let fired=false; const now=Date.now();
  for(const t of sched){ if(!t.done&&t.at<=now){ t.done=true; fired=true;
    try{t.sym?ACTS[t.act](t.sym):ACTS[t.act]();}catch(e){}
    toast(`⏰ ${ACTLBL[t.act]||t.act} fired`,'ok'); } }
  if(fired)renderSched(); },250);

/* ============ quotes ============ */
function simTickOthers(){
  for(const [key,q] of quotes){
    const m=metaCache.get(key);
    if(m&&m.type==='OPT')
      q.ltp=bs(liveSpot(m.root),m.strike,tym(m.exp),m.iv,m.optSide==='CE')*(1+(rng()-.5)*0.012);
    else if(key!==(SYM&&SYM.key)) q.ltp=Math.max(1,q.ltp*(1+gauss()*0.0006)); } }
let tickN=0;
setInterval(()=>{ if(SRC!=='sim'||paused)return;
  tickN++;
  panes.forEach(p=>{ if(!p.key)return;
    const sd=symbolData(p.key);
    const arr=p.key===(SYM&&SYM.key)?bars:dataCache.get(p.key).bars;
    const b=arr[arr.length-1], m=(arr.length-1)%SESSION;
    const smile=1+1.2*Math.exp(-m/45)+0.8*Math.exp(-(SESSION-m)/55);
    const step=b.c*0.00042*smile*0.36;
    const nc=b.c+gauss()*step;
    b.c=nc; if(nc>b.h)b.h=nc; if(nc<b.l)b.l=nc;
    b.v+=Math.round(50+rng()*180);
    const q=quotes.get(p.key); if(q)q.ltp=nc;
    p.aggDirty=true; p.dataVer++; });
  if(SYM&&bars.length){ const b=bars[bars.length-1]; price=b.c; }
  simTickOthers(); },280);
setInterval(()=>{ if(SRC!=='sim')return;
  refreshWatch(); refreshStrikes(); refreshPositions(); checkSLTP(); updateAcct(); syncPaneUI(); },1000);
async function brokerPoll(){
  if(SRC==='sim'||apiPolling)return; apiPolling=true;
  try{ let ok=0;
    await Promise.all([...quotes.keys()].map(async k=>{
      try{ const q=await activeBroker().quote(bcfg(SRC),k);
        if(q.ltp>0){ ok++;
          const qr=quotes.get(k);
          if(q.prevClose)qr.prevClose=q.prevClose;
          qr.ltp=q.ltp;
          panes.forEach(p=>{ if(p.key!==k)return;
            p.aggDirty=true; p.dataVer++; }); } }catch(e){} }));
    apiOK=ok>0; setSrcDot();
    refreshWatch(); refreshStrikes(); refreshPositions(); checkSLTP(); updateAcct(); syncPaneUI(); }
  finally{apiPolling=false;} }
setInterval(brokerPoll,3000);

/* ============ load / clear ============ */
async function loadSymbol(key){
  key=normKey(key);
  const meta=resolveMeta(key);
  let sd=null;
  if(SRC==='sim'){ sd=await BROKERS.sim.history({},key); apiOK=true; }
  else{
    try{ sd=await activeBroker().history(bcfg(SRC),key); apiOK=true; }
    catch(e){ apiOK=false; setSrcDot();
      toast(`${BROKERS[SRC].label} data failed: ${e.message}`,'err');
      return; } }
  setSrcDot();
  if(!quotes.has(key))ensureQuote(key);
  quotes.get(key).ltp=sd.price; quotes.get(key).prevClose=sd.prevClose;
  dataCache.set(key,sd);                      /* cache broker data for panes */
  SYM=meta;
  paneLoadSymbol(key);
  if(SYM.type==='OPT'){optSide=SYM.optSide;}
  bars.length=0; for(const b of sd.bars)bars.push(b);
  price=sd.price;
  applyFnoUI(); updateSymbolUI(); buildWatch(); ensureAtmRow();
  strikeSig=''; refreshStrikes(); refreshPositions(); updateAcct();
  ticketKey=key; $('#tkSym').textContent=SYM.disp;
  $('#tkQty').value=1; updateLotLbl(); }
function clearChart(){ panes.forEach(p=>{ p.key=null; p.yLo=p.yHi=null;
  p.aggCache.clear(); p.indCache=null; p.dataVer++; });
  bars.length=0; syncPaneUI(); }
function updateSymbolUI(){
  if(!SYM)return;
  $('#symName').textContent=SYM.disp;
  $('#symSub').textContent=`${SYM.exch} · ${SYM.type}${SYM.exp?' · '+SYM.exp:''}${SYM.type==='OPT'?' · '+SYM.strike+' '+SYM.optSide:''}`;
  document.title=`${SYM.disp} · Scalping Tool`; }
 $('#loadBtn').addEventListener('click',()=>{ const k=$('#symIn').value.trim();
  if(k)loadSymbol(normKey(k)); });
 $('#symIn').addEventListener('keydown',e=>{ if(e.key==='Enter'&&$('#acDrop').hidden)$('#loadBtn').click(); });
 $('#addWatchBtn').addEventListener('click',()=>{ const k=ticketKey||(SYM&&SYM.key); if(!k)return;
  if(!watch.includes(k)){watch.push(k);persistWatch();buildWatch();toast(disp(k)+' added to watchlist','ok');} });
 $('#tkBuy').addEventListener('click',()=>{
  const key=ticketKey||(SYM&&SYM.key); if(!key)return;
  const lots=Math.max(1,+$('#tkQty').value||1), lot=ticketLot();
  placeKeyOrder(key,1,lots*lot);
  toast(`BUY ${lots}${lot>1?' lot':''} ${disp(key)}`,'ok'); });
 $('#tkSell').addEventListener('click',()=>{
  const key=ticketKey||(SYM&&SYM.key); if(!key)return;
  const lots=Math.max(1,+$('#tkQty').value||1), lot=ticketLot();
  placeKeyOrder(key,-1,lots*lot);
  toast(`SELL ${lots}${lot>1?' lot':''} ${disp(key)}`,'ok'); });
 $('#tkFlat').addEventListener('click',()=>{ [...positions].forEach(p=>squareOff(p.id)); });
 $('#ordType').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
  ordType=b.dataset.o;
  $('#ordType').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
  $('#ordPx').style.display=ordType==='LMT'?'':'none';
  if(ordType==='LMT'){ const key=ticketKey||(SYM&&SYM.key);
    $('#ordPx').value=key?currentPriceOf(key).toFixed(2):''; } }));
 $('#botMin').addEventListener('click',()=>{ const bd=$('#bottom'); bd.classList.toggle('min');
  $('#botMin').textContent=bd.classList.contains('min')?'▴':'▾'; });

/* ============ settings ============ */
 $('#setBtn').addEventListener('click',()=>{
  const b=activeBroker();
  $('#setTitle').textContent=b.label+' · SETTINGS';
  $('#setWarn').style.display=SRC==='sim'?'none':'';
  const f=$('#bkFields'); f.innerHTML='';
  b.fields.forEach(fd=>{
    const l=document.createElement('label');l.textContent=fd.l;
    const i=document.createElement('input');
    i.type=(fd.k==='pwd'||fd.k==='key'||fd.k==='secret')?'password':'text';
    i.placeholder=fd.ph||''; i.value=bcfg(b.id)[fd.k]||''; i.dataset.bk=fd.k;
    f.appendChild(l);f.appendChild(i); });
  $('#setCap').value=CFG.cap;$('#setMode').value=CFG.deployMode;$('#setVal').value=CFG.deployVal;
  $('#setModal').classList.add('show'); });
 $('#setCancel').addEventListener('click',()=>$('#setModal').classList.remove('show'));
 $('#setSave').addEventListener('click',()=>{
  const b=activeBroker();
  document.querySelectorAll('#bkFields input').forEach(i=>{bcfg(b.id)[i.dataset.bk]=i.value.trim();});
  CFG.cap=Math.max(0,+$('#setCap').value||CFG.cap);
  CFG.deployMode=$('#setMode').value;
  CFG.deployVal=Math.max(0,+$('#setVal').value||CFG.deployVal);
  saveCfg(); $('#setModal').classList.remove('show');
  updateAcct(); refreshStrikes(); toast('settings saved','ok'); });
 $('#setTest').addEventListener('click',async()=>{
  const b=activeBroker();
  document.querySelectorAll('#bkFields input').forEach(i=>{bcfg(b.id)[i.dataset.bk]=i.value.trim();});
  saveCfg();
  try{ await b.test(bcfg(b.id)); toast(b.label+' reachable ✓','ok'); }
  catch(e){ toast('TEST failed: '+e.message,'err'); } });

/* ============ boot ============ */
buildSrcSeg(); setSrcDot(); buildExpSel();
buildToolbar(); setTool('cursor');
syncDefaults();
buildLayout();                                  /* panes + canvas events */
wireAutocomplete($('#symIn'),$('#acDrop'),k=>loadSymbol(k));
buildWatch();
loadSymbol('NSE:NIFTY');
refreshPositions(); updateAcct();
syncScalesUI(); syncGhostUI();
requestAnimationFrame(frame);
