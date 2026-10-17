'use strict';
/* ═══════════ config / broker routing ═══════════ */
let CFG=Object.assign({cap:100000,deployMode:'pct',deployVal:75,src:'sim',defLots:1,brokers:{},layout:'2x2'},
  JSON.parse(localStorage.getItem('scalping_cfg')||'{}'));
function saveCfg(){localStorage.setItem('scalping_cfg',JSON.stringify(CFG));}
const bcfg=id=>CFG.brokers[id]||(CFG.brokers[id]={});
let SRC=CFG.src||'sim', apiOK=false, apiPolling=false;
const activeBroker=()=>BROKERS[SRC]||BROKERS.sim;
function usableFunds(){ return CFG.deployMode==='pct'?CFG.cap*(+CFG.deployVal||0)/100:(+CFG.deployVal||0); }
let SYM=null, ticketKey=null, ordType='MKT', PRD='MIS', editRowId=null;
let lastRoot=null, curSpot=null, curOptExp=0;

function buildSrcSeg(){
  const seg=qs('#srcSeg'); if(!seg)return;
  seg.innerHTML='';
  Object.values(BROKERS).forEach(b=>{
    const bt=document.createElement('button');bt.textContent=b.label;bt.dataset.s=b.id;
    bt.classList.toggle('on',b.id===SRC);
    on(bt,'click',()=>selectSrc(b.id));
    seg.appendChild(bt); });
  if(Object.keys(BROKERS).length<3)
    console.warn('[scalping] brokers missing — check js/brokers/* (Network tab for 404)'); }
function setSrcDot(){ const d=qs('#srcDot'); if(!d)return;
  d.className=SRC==='sim'?'':(apiOK?'api':'err');
  qs('#srcLbl').textContent=SRC==='sim'?'SIM':(apiOK?BROKERS[SRC].label+' · LIVE':BROKERS[SRC].label+' · NO LINK'); }
function selectSrc(id){
  SRC=id; CFG.src=id; saveCfg();
  buildSrcSeg(); setSrcDot();
  clearAllPanes();
  if(id==='sim'){ if(SYM)loadSymbol(SYM.key); }
  else{
    const cfgd=!!(bcfg(id).key||bcfg(id).uid||bcfg(id).url);
    if(!cfgd){ toast(BROKERS[id].label+' not configured — chart cleared','err'); qs('#setBtn').click(); }
    else if(SYM)loadSymbol(SYM.key);
    else toast(BROKERS[id].label+' selected — load a symbol'); }
  updateAcct(); refreshStrikes(); refreshPositions(); }
/* pane wiring — self-healing override of chart.js's bindPaneEvents */
function bindPaneEvents(){
  panes.forEach((p,idx)=>{
    if(!p)return;
    /* self-heal: guarantee a real canvas inside the pane box */
    let cvEl=p.cv;
    if(!(cvEl instanceof Element)&&p.box){
      cvEl=p.box.querySelector('canvas');
      if(!cvEl){ cvEl=document.createElement('canvas'); p.box.appendChild(cvEl); }
      p.cv=cvEl; p.ctx=cvEl.getContext('2d');
    }
    if(!(cvEl instanceof Element)){ console.warn('[pane '+(idx+1)+'] no canvas — skipped'); return; }
    p.cv=cvEl; p.ctx=p.ctx||cvEl.getContext('2d');
    const ro=new ResizeObserver(()=>{
      p.dpr=window.devicePixelRatio||1;
      p.W=cvEl.clientWidth; p.H=cvEl.clientHeight;
      cvEl.width=Math.round(p.W*p.dpr); cvEl.height=Math.round(p.H*p.dpr);
      if(p.key)p.aggDirty=true;
    });
    ro.observe(cvEl);
    cvEl.addEventListener('pointerdown',e=>{ e.preventDefault();
      if(activePane!==idx){activePane=idx;layoutUI();syncPaneUI();syncGhostUI();mountOverlays();}
      const v=view0(p);
      p._drag={x:e.offsetX,y:e.offsetY,r:v.r,lo:p.yLo,hi:p.yHi};
      try{cvEl.setPointerCapture(e.pointerId);}catch(_){}
    });
    cvEl.addEventListener('pointermove',e=>{
      p.mouse={x:e.offsetX,y:e.offsetY,in:true};
      const d=p._drag;
      if(d){ const v=view0(p);
        v.r=clampPaneR(p,d.r-(e.offsetX-d.x)/paneSp(p));
        const dy=e.offsetY-d.y;
        if(Math.abs(dy)>2&&p.yLo!=null){
          const R=p.yHi-p.yLo;
          p.mLo=d.lo+dy*R/p.priceH; p.mHi=d.hi+dy*R/p.priceH; p.pMode='manual'; } } });
    const end=()=>{ p._drag=null; };
    cvEl.addEventListener('pointerup',end); cvEl.addEventListener('pointercancel',end);
    cvEl.addEventListener('pointerleave',()=>{ p.mouse.in=false; });
    cvEl.addEventListener('wheel',e=>{ e.preventDefault();
      const v=view0(p), sp=paneSp(p), plotW=p.W-AXIS_W;
      const nv=clamp(v.v*Math.exp(e.deltaY*0.0011),40,2400);
      const anchor=v.r-(plotW-e.offsetX)/sp;
      v.r=clampPaneR(p,anchor+(plotW-e.offsetX)/(plotW/nv)); v.v=nv; },{passive:false});
    cvEl.addEventListener('dblclick',()=>{ p.view=null;p.yLo=p.yHi=null;p.pMode='auto'; });
  });
}
/* ═══════════ layout: rows × cols, splitters, maximize, overlays ═══════════ */
let panes=[], activePane=0, layout={r:2,c:2}, colFr=[], rowFr=[], maxPane=null;
function paneTitle(k){ if(!k)return '—';
  const m=resolveMeta(k);
  return m.type==='OPT'?`${m.root} ${m.strike}${m.optSide}`:m.type==='FUT'?m.root+' F':m.sym; }
function buildLayout(r,c){
  r=clamp(r||2,1,5); c=clamp(c||2,1,5);
  layout={r,c}; CFG.layout=r+'x'+c; saveCfg();
  const grid=qs('#grid'); if(!grid)return;
  const old=panes;
  grid.style.gridTemplateColumns=`repeat(${c},1fr)`;
  grid.style.gridTemplateRows=`repeat(${r},1fr)`;
  grid.innerHTML='';
  panes=[];
  for(let i=0;i<r*c;i++){
    const prev=old[i];
    const box=document.createElement('div');box.className='paneBox';
    box.innerHTML=`<div class="ph"><span class="pn">—</span><span class="pl">—</span><span class="mx" title="maximize / restore (Esc)">⤢</span><span class="px" title="clear pane">✕</span></div><canvas></canvas>`;
    grid.appendChild(box);
    const cv2=box.querySelector('canvas');
    panes.push(prev?{...prev,box,cv:cv2,ctx:cv2.getContext('2d')}
      :{key:null,tf:5,ghost:true,ghostStyle:'hollow',drawings:[],uidC:1,undo:[],selId:null,
        view:null,pctBase:null,pMode:'auto',mLo:0,mHi:1,
        dpr:1,W:0,H:0,yLo:null,yHi:null,volMax:null,volMax1:null,
        aggDirty:true,aggCache:new Map(),indCache:null,dataVer:0,
        mouse:{x:0,y:0,in:false},_drag:null,_fvgVer:-1,_fvg:[]}); }
  colFr=Array(c).fill(1); rowFr=Array(r).fill(1); maxPane=null;
  bindPaneEvents(); layoutUI(); syncPaneUI(); applyGridTemplate(); }
function layoutUI(){
  const pt=qs('#paneTabs'); if(!pt)return;
  pt.innerHTML=panes.map((p,i)=>`<span class="ptab${i===activePane?' on':''}" data-i="${i}">P${i+1} · ${paneTitle(p.key)}</span>`).join('');
  qsa('#paneTabs .ptab').forEach(t=>on(t,'click',()=>{activePane=+t.dataset.i;layoutUI();syncPaneUI();syncGhostUI();}));
  mountOverlays(); }
function mountOverlays(){
  const p=activeP(); if(!p||!p.box)return;
  ['#tools','#legend','#latestBtn','#toolChip','#axMenu','#txtIn'].forEach(id=>{
    const el=qs(id); if(el&&el.parentElement!==p.box)p.box.appendChild(el); }); }
function activeP(){ return panes[activePane]||null; }
function syncPaneUI(){ panes.forEach((p,i)=>{
  if(!p||!p.box)return;
  p.box.classList.toggle('activePane',i===activePane);
  p.box.querySelector('.pn').textContent='P'+(i+1)+' · '+paneTitle(p.key);
  const q=p.key?quotes.get(p.key):null;
  const pl=p.box.querySelector('.pl');
  pl.textContent=q?fmtP(q.ltp):'—';
  pl.style.color=q&&q.prevClose&&q.ltp<q.prevClose?'var(--dn)':'var(--up)';
  p.box.querySelector('.px').style.visibility=p.key?'visible':'hidden'; }); }
on(document,'click',e=>{
  const px=e.target.closest?.('.paneBox .px'); if(!px)return;
  const i=panes.findIndex(p=>p.box===px.closest('.paneBox'));
  if(i>=0){ const p=panes[i]; p.key=null;p.drawings=[];p.undo=[];p.selId=null;
    p.yLo=p.yHi=null;p.aggCache.clear();p.indCache=null;p.dataVer++;syncPaneUI();layoutUI(); } });
function paneLoadSymbol(key){
  key=normKey(key);
  const p=activeP(); if(!p)return;
  p.key=key; p.pctBase=null; p.view=null; p.drawings=[]; p.undo=[]; p.selId=null;
  p.yLo=p.yHi=null; p.aggCache.clear(); p.indCache=null; p.dataVer++;
  ensureQuote(key);
  if(SRC==='sim')symbolData(key);
  syncPaneUI(); layoutUI(); refreshWatch(); refreshStrikes(); }
function paneSetTF(t){ const p=activeP(); if(!p)return;
  p.tf=t; syncGhostUI(); }
function syncGhostUI(){ const p=activeP(); if(!p)return;
  qsa('#tfSeg button').forEach(b=>b.classList.toggle('on',+b.dataset.tf===p.tf));
  const gc=qs('#ghostCtl'); if(gc)gc.classList.toggle('dis',p.tf===1);
  const gt=qs('#ghostToggle'); if(gt)gt.classList.toggle('on',p.ghost);
  qsa('#styleSeg button').forEach(x=>x.classList.toggle('on',x.dataset.s===p.ghostStyle)); }
qsa('#tfSeg button').forEach(b=>on(b,'click',()=>paneSetTF(+b.dataset.tf)));
on('#ghostToggle','click',()=>{ const p=activeP(); if(p){p.ghost=!p.ghost;syncGhostUI();} });
qsa('#styleSeg button').forEach(b=>on(b,'click',()=>{
  const p=activeP(); if(p)p.ghostStyle=b.dataset.s; syncGhostUI(); }));
/* layout picker: hover rows × cols */
on('#layBtn','click',e=>{ e.stopPropagation(); const pop=qs('#layPop'); if(pop)pop.hidden=!pop.hidden; });
document.addEventListener('click',e=>{ const pop=qs('#layPop');
  if(pop&&!pop.hidden&&!pop.contains(e.target)&&e.target!==qs('#layBtn'))pop.hidden=true; });
function buildLayPop(){
  const pop=qs('#layPop'); if(!pop)return;
  pop.innerHTML='';
  const tbl=document.createElement('div'); tbl.className='layM';
  for(let r=1;r<=5;r++)for(let c=1;c<=5;c++){
    const cell=document.createElement('i'); cell.dataset.r=r; cell.dataset.c=c;
    tbl.appendChild(cell); }
  const lbl=document.createElement('div'); lbl.className='layLbl2';
  pop.appendChild(tbl); pop.appendChild(lbl);
  const paint=(r,c)=>{ qsa('#layPop .layM i').forEach(el=>{
      el.classList.toggle('f',+el.dataset.r<=r&&+el.dataset.c<=c); });
    lbl.textContent=r+' rows × '+c+' cols'; };
  on(tbl,'mousemove',e=>{ const el=e.target.closest('i'); if(el)paint(+el.dataset.r,+el.dataset.c); });
  on(tbl,'mouseleave',()=>paint(layout.r,layout.c));
  on(tbl,'click',e=>{ const el=e.target.closest('i'); if(!el)return;
    qs('#layPop').hidden=true;
    setLayout(+el.dataset.r,+el.dataset.c); });
  paint(layout.r,layout.c); }
function setLayout(r,c){
  const keys=panes.map(p=>p.key);
  buildLayout(r,c);
  panes.forEach((p,i)=>{ if(keys[i]){ p.key=keys[i];
    ensureQuote(p.key); if(SRC==='sim')symbolData(p.key); } });
  if(curSpot&&!panes.some(p=>p.key===curSpot)&&panes[0])panes[0].key=curSpot;
  syncPaneUI(); layoutUI(); }
/* splitters + maximize */
function applyGridTemplate(){
  const grid=qs('#grid'); if(!grid)return;
  grid.style.gridTemplateColumns=colFr.map(f=>f+'fr').join(' ');
  grid.style.gridTemplateRows=rowFr.map(f=>f+'fr').join(' ');
  grid.classList.toggle('maxed',maxPane!=null);
  panes.forEach((p,i)=>p.box.classList.toggle('max',i===maxPane));
  placeSplitters(); }
function placeSplitters(){
  qsa('#wrap .spl').forEach(e=>e.remove());
  if(maxPane!=null||!panes.length)return;
  const wrap=qs('#wrap'); if(!wrap)return;
  const totC=colFr.reduce((a,b)=>a+b,0), totR=rowFr.reduce((a,b)=>a+b,0);
  for(let j=1;j<colFr.length;j++){
    const pct=colFr.slice(0,j).reduce((a,b)=>a+b,0)/totC*100;
    const s=document.createElement('div'); s.className='spl v';
    s.style.left=pct+'%'; s.dataset.j=j; wrap.appendChild(s); }
  for(let i=1;i<rowFr.length;i++){
    const pct=rowFr.slice(0,i).reduce((a,b)=>a+b,0)/totR*100;
    const s=document.createElement('div'); s.className='spl h';
    s.style.top=pct+'%'; s.dataset.i=i; wrap.appendChild(s); } }
on(document,'pointerdown',e=>{
  const s=e.target.closest?.('.spl'); if(!s)return;
  e.preventDefault(); s.classList.add('act');
  const grid=qs('#grid'), rect=grid.getBoundingClientRect();
  let move;
  if(s.classList.contains('v')){
    const j=+s.dataset.j, a0=colFr[j-1], b0=colFr[j], tot=a0+b0;
    const pxPerFr=rect.width/colFr.reduce((x,y)=>x+y,0);
    const x0=e.clientX;
    move=ev=>{ const d=(ev.clientX-x0)/pxPerFr;
      colFr[j-1]=clamp(a0+d,0.3,tot-0.3); colFr[j]=tot-colFr[j-1];
      applyGridTemplate(); };
  }else{
    const i=+s.dataset.i, a0=rowFr[i-1], b0=rowFr[i], tot=a0+b0;
    const pxPerFr=rect.height/rowFr.reduce((x,y)=>x+y,0);
    const y0=e.clientY;
    move=ev=>{ const d=(ev.clientY-y0)/pxPerFr;
      rowFr[i-1]=clamp(a0+d,0.3,tot-0.3); rowFr[i]=tot-rowFr[i-1];
      applyGridTemplate(); }; }
  const up=()=>{ s.classList.remove('act');
    document.removeEventListener('pointermove',move);
    document.removeEventListener('pointerup',up); };
  document.addEventListener('pointermove',move);
  document.addEventListener('pointerup',up); });
function toggleMaxPane(i){
  maxPane=maxPane===i?null:i;
  applyGridTemplate();
  panes.forEach(p=>{ if(p.key)p.aggDirty=true; }); }
on(document,'click',e=>{
  const mx=e.target.closest?.('.paneBox .mx'); if(!mx)return;
  const i=panes.findIndex(p=>p.box===mx.closest('.paneBox'));
  if(i>=0)toggleMaxPane(i); });
on(document,'keydown',e=>{
  if(e.key==='Escape'&&maxPane!=null){ maxPane=null; applyGridTemplate(); } });
qsa('#sclPop input').forEach(cb=>on(cb,'change',()=>{
  scales[cb.dataset.scale]=cb.checked;
  if(!SORDER.some(s=>scales[s]))scales.price=true;
  syncScalesUI(); }));
function syncScalesUI(){ qsa('#sclPop input').forEach(cb=>cb.checked=!!scales[cb.dataset.scale]); }
qsa('#indPop input').forEach(cb=>on(cb,'change',()=>{
  PANE_DEFS.find(x=>x.id===cb.dataset.pane).on=cb.checked; }));
function clearAllPanes(){ panes.forEach(p=>{ if(!p)return;
  p.key=null;p.yLo=p.yHi=null;p.aggCache.clear();p.indCache=null;p.dataVer++; });
  bars.length=0; syncPaneUI(); layoutUI(); }

/* ═══════════ orders / positions / trades ═══════════ */
let positions=[], trades=[], posId=1;
const realized={};
function currentPriceOf(key){ const q=quotes.get(key); return q?q.ltp:resolveMeta(key).basePrice; }
function ticketLot(){ const m=ticketKey||(SYM&&SYM.key);
  if(!m)return 1; const mm=resolveMeta(m);
  return (mm.root&&LOTS[mm.root])?LOTS[mm.root]:1; }
function updateLotLbl(){ const lot=ticketLot();
  const l=qs('#lotLbl'); if(l){l.textContent=lot>1?'LOT':'SH';
    qs('#tkQty').title=lot>1?`lots · 1 lot = ${lot}`:'shares';} }
function resolveFill(live){
  if(ordType==='LMT'){ const v=+qs('#ordPx').value; return isFinite(v)&&v>0?v:live; }
  return live; }
async function routeOrder(key,side,qty,px){
  if(SRC==='sim')return true;
  const {exch,sym}=parseKey(key);
  try{
    await activeBroker().placeOrder(bcfg(SRC),{key,exch,sym,side,qty,
      priceType:ordType,price:ordType==='LMT'?px:0,product:PRD});
    return true;
  }catch(e){ toast('broker order failed: '+e.message,'err'); return false; } }
async function placeKeyOrder(key,side,qty,px){
  if(!key||qty<=0)return;
  ensureQuote(key);
  const fill=resolveFill(px??currentPriceOf(key));
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
function editPosition(id){ editRowId=id; refreshPositions(); }
window.editPosition=editPosition;
function cancelEdit(){ editRowId=null; refreshPositions(); }
window.cancelEdit=cancelEdit;
async function saveEdit(id){
  const tr=qs(`#tbPos tr[data-id="${id}"]`); if(!tr)return;
  const nq=Math.max(0,Math.round(+tr.querySelector('.eq').value||0));
  const na=Math.max(0,+tr.querySelector('.ea').value||0);
  const p=positions.find(x=>x.id===id); if(!p)return;
  const key=p.key, ltp=currentPriceOf(key);
  if(nq===0){ editRowId=null; await squareOff(id); return; }
  const d=nq-p.qty;
  if(d!==0)await routeOrder(key,d>0?p.side:-p.side,Math.abs(d),ltp);
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
function posRow(p){
  const ltp=currentPriceOf(p.key);
  const pnl=(ltp-p.avg)*p.side*p.qty, net=pnl+(realized[p.key]||0);
  return `<tr data-id="${p.id}"><td><b>${disp(p.key)}</b></td>
    <td class="${p.side>0?'u':'d'}">${p.side>0?'BUY':'SELL'}</td><td>${p.qty}</td>
    <td>${fmtP(p.avg)}</td><td>${fmtP(ltp)}</td>
    <td class="${pnl>=0?'u':'d'}">${pnl>=0?'+':''}${pnl.toFixed(2)}</td>
    <td class="${net>=0?'u':'d'}">${net>=0?'+':''}${net.toFixed(2)}</td>
    <td><button class="pb" onclick="editPosition(${p.id})">EDIT</button><button class="pb" onclick="repeatPos(${p.id})">REPEAT</button><button class="pb" onclick="swapPos(${p.id})">SWAP</button><button class="sq dz" onclick="squareOff(${p.id})">SQ-OFF</button></td></tr>`; }
function refreshPositions(){
  const tb=qs('#tbPos'); if(!tb)return;
  if(editRowId!=null){
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
        renderTrades(); return; } } }
  if(!positions.length){ editRowId=null;
    tb.innerHTML='<tr class="emptyRow"><td colspan="8">no open positions</td></tr>'; }
  else if(editRowId!=null){
    const p=positions.find(x=>x.id===editRowId);
    const ltp=currentPriceOf(p.key);
    const pnl=(ltp-p.avg)*p.side*p.qty, net=pnl+(realized[p.key]||0);
    tb.innerHTML=positions.map(x=>x.id===editRowId?
      `<tr data-id="${x.id}"><td><b>${disp(x.key)}</b></td>
        <td class="${x.side>0?'u':'d'}">${x.side>0?'BUY':'SELL'}</td>
        <td class="ed"><input class="eq" type="number" min="0" value="${x.qty}"></td>
        <td class="ed"><input class="ea" type="number" step="0.05" value="${x.avg.toFixed(2)}"></td>
        <td>${fmtP(ltp)}</td>
        <td class="${pnl>=0?'u':'d'}">${pnl>=0?'+':''}${pnl.toFixed(2)}</td>
        <td class="${net>=0?'u':'d'}">${net>=0?'+':''}${net.toFixed(2)}</td>
        <td><button class="pb" onclick="saveEdit(${x.id})">SAVE</button><button class="sq" onclick="cancelEdit()">CANCEL</button></td></tr>`
      :posRow(x)).join('');
    const tr=tb.querySelector(`tr[data-id="${p.id}"]`);
    if(tr){ tr.querySelector('.eq').focus(); tr.querySelector('.eq').select(); } }
  else tb.innerHTML=positions.map(posRow).join('');
  renderTrades(); }
function renderTrades(){
  const tb=qs('#tbTrd'); if(!tb)return;
  if(!trades.length){tb.innerHTML='<tr class="emptyRow"><td colspan="7">no trades yet</td></tr>';return;}
  tb.innerHTML=trades.slice(0,80).map((t,i)=>`<tr><td>${t.t}</td><td><b>${disp(t.key)}</b></td>
    <td class="${t.side>0?'u':'d'}">${t.side>0?'BUY':'SELL'}</td><td>${t.qty}</td><td>${fmtP(t.price)}</td>
    <td class="${(t.pnl??0)>=0?'u':'d'}">${t.pnl==null?'—':(t.pnl>=0?'+':'')+t.pnl.toFixed(2)}</td>
    <td><button class="pb" onclick="repeatTrade(${i})">REPEAT</button></td></tr>`).join(''); }
on('#tbPos','keydown',e=>{
  if(e.key==='Enter'&&e.target.classList&&e.target.classList.contains('eq')){
    const tr=e.target.closest('tr'); if(tr&&tr.dataset.id)saveEdit(+tr.dataset.id); } });
function updateAcct(){
  let mtm=0,used=0;
  for(const p of positions){
    const ltp=currentPriceOf(p.key);
    mtm+=(ltp-p.avg)*p.side*p.qty;
    used+=p.avg*p.qty*(p.side>0?1:0.12); }
  for(const k in realized)mtm+=realized[k];
  const cc=qs('#capChip'),pc=qs('#pnlChip');
  if(cc)cc.innerHTML=`CAP <b>${fmtInr(usableFunds())}</b> · USED <b>${fmtInr(used)}</b>`;
  if(pc)pc.innerHTML=`P&amp;L <b class="${mtm>=0?'u':'d'}">${mtm>=0?'+':''}${fmtInr(mtm)}</b>`;
  const cs=qs('#capSlider');
  if(cs){ cs.max=CFG.deployMode==='pct'?100:Math.max(1,Math.round(CFG.cap));
    cs.value=Math.round(CFG.deployVal); }
  const cp=qs('#capPct');
  if(cp)cp.textContent=CFG.deployMode==='pct'?Math.round(CFG.deployVal)+'%':fmtInr(CFG.deployVal); }
on('#capSlider','input',e=>{ CFG.deployVal=+e.target.value; saveCfg(); updateAcct(); refreshStrikes(); });
on('#defLots','change',e=>{ CFG.defLots=Math.max(1,Math.round(+e.target.value||1));
  e.target.value=CFG.defLots; saveCfg(); refreshStrikes(); });
on('#prdSel','change',e=>{ PRD=e.target.value; });

/* ═══════════ watchlist ═══════════ */
let watch=JSON.parse(localStorage.getItem('scalping_watch')||
  '["NSE:NIFTY","NSE:BANKNIFTY","NSE:RELIANCE","NSE:HDFCBANK","NSE:TCS"]');
const wRefs=new Map();
function buildWatch(){
  const body=qs('#wBody'); if(!body)return;
  body.innerHTML=''; wRefs.clear();
  const wc=qs('#wCnt'); if(wc)wc.textContent=watch.length;
  watch.forEach(key=>{
    const m=resolveMeta(key); ensureQuote(key);
    const row=document.createElement('div');row.className='wrow';
    row.innerHTML=`<span class="typ ${m.type}">${m.type[0]}</span>
      <span class="nm"><b>${m.type==='OPT'?m.disp:m.sym}</b><i>${m.exch}${m.exp?' · '+m.exp:''}</i></span>
      <span class="px"><b>—</b><i>—</i></span><button class="rm">✕</button>`;
    on(row,'click',e=>{ if(e.target.classList.contains('rm'))return; loadSymbol(key); });
    on(row.querySelector('.rm'),'click',e=>{e.stopPropagation();
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
on('#wCol','click',()=>{
  const w=qs('#watch'); if(!w)return; w.classList.toggle('min');
  const b=qs('#wCol'); if(b)b.textContent=w.classList.contains('min')?'»':'«'; });

/* ═══════════ EQ / FNO + dual expiries + FNO auto-grid ═══════════ */
let inst='eq', expSpotIdx=0, expOptIdx=0;
function rootOf(){
  if(SYM){ if(SYM.type==='OPT'||SYM.type==='FUT')return SYM.root;
    if(FNO_SET.has(SYM.sym))return SYM.sym; }
  return lastRoot; }
function buildExpSels(){
  const ss=qs('#expSpot'), so=qs('#expOpt');
  if(!ss||!so)return;
  ss.innerHTML=''; so.innerHTML='';
  expAll.forEach((e,i)=>{
    let o=document.createElement('option');o.value=i;
    o.textContent=e.f+(e.kind==='monthly'?' ·M':'');
    ss.appendChild(o);
    o=document.createElement('option');o.value=i;
    o.textContent=e.f+(e.kind==='monthly'?' ·M':'');
    so.appendChild(o); });
  const wk=expAll.findIndex(e=>e.kind==='weekly');
  expSpotIdx=0; expOptIdx=wk>=0?wk:0;
  ss.value=expSpotIdx; so.value=expOptIdx; }
function applySegUI(){
  const root=rootOf(); const isFno=inst==='fno'&&!!root;
  const ss=qs('#expSpot'), so=qs('#expOpt');
  if(ss)ss.style.display=isFno?'':'none';
  if(so)so.style.display=isFno?'':'none';
  qsa('#instSeg button').forEach(b=>b.classList.toggle('on',b.dataset.i===inst)); }
qsa('#instSeg button').forEach(b=>on(b,'click',()=>{
  inst=b.dataset.i;
  if(inst==='fno'){
    if(!rootOf()){ toast('search & load an FNO symbol (index / F&O stock) first','err');
      inst='eq'; applySegUI(); return; }
    applySegUI(); setupFnoPanes(); }
  else{ applySegUI(); const st=qs('#strikes'); if(st)st.style.display='none';
    if(SYM&&(SYM.type==='OPT'||SYM.type==='FUT'))loadSymbol(SYM.underlying||'NSE:'+(SYM.root||SYM.sym)); }
  refreshStrikes(); }));
on('#expSpot','change',e=>{
  expSpotIdx=+e.target.value; const root=rootOf(); if(!root)return;
  paneLoadSymbol('NSE:'+root); });
on('#expOpt','change',e=>{
  expOptIdx=+e.target.value; curOptExp=expOptIdx;
  strikeSig=''; refreshStrikes(); setupFnoPanes(); });
function setupFnoPanes(){
  const root=rootOf(); if(!root)return;
  if(panes.length<3)buildLayout(2,2);
  const spot=liveSpot(root), step=strikeStep(root,spot);
  const atm=Math.round(spot/step)*step;
  curSpot='NSE:'+root;
  panes[0].key=curSpot;
  panes[1].key=optKey(root,atm,'CE');
  panes[2].key=optKey(root,atm,'PE');
  panes.slice(0,3).forEach(p=>{ p.view=null;p.yLo=p.yHi=null;p.aggCache.clear();p.indCache=null;p.dataVer++;
    ensureQuote(p.key); if(SRC==='sim')symbolData(p.key); });
  curOptExp=expOptIdx;
  activePane=0; layoutUI(); syncPaneUI(); syncGhostUI(); mountOverlays(); refreshStrikes();
  ticketKey=curSpot; const t=qs('#tkSym'); if(t)t.textContent=disp(curSpot);
  updateLotLbl();
  toast(`FNO: spot P1 · ATM ${atm} CE P2 · PE P3 (${expAll[curOptExp].f})`,'ok'); }
function updateStrikesVis(){
  const root=rootOf(); const show=inst==='fno'&&!!root;
  const st=qs('#strikes'); if(st)st.style.display=show?'flex':'none';
  return show?root:null; }

/* ═══════════ strike panel ═══════════ */
let optSide='CE', optRole='buyer', offDir=1, strikeSig='';
const strikeLists=new Map();
const rowRefs=new Map();
let stSort='K', stFilt='ALL';
function listFor(){ const root=rootOf(); if(!root)return null;
  const k=root+'|'+expAll[curOptExp].f;
  if(!strikeLists.has(k))strikeLists.set(k,[]);
  return strikeLists.get(k); }
function optLtp(root,K,side){
  return bs(liveSpot(root),K,tym(expAll[curOptExp].f),IDX[root]?0.13:0.22,side==='CE'); }
function optKey(root,K,side){ return 'NFO:'+root+expAll[curOptExp].f+K+side; }
function netQty(key){ return positions.filter(p=>p.key===key).reduce((a,p)=>a+p.side*p.qty,0); }
function syncDefaults(){
  qsa('#cpSeg button').forEach(b=>b.classList.toggle('on',b.dataset.s===optSide));
  qsa('#bsSeg button').forEach(b=>b.classList.toggle('on',b.dataset.s===optRole));
  const sp=qs('#sgnP'),sm=qs('#sgnM');
  if(sp)sp.classList.toggle('on',offDir>0);
  if(sm)sm.classList.toggle('on',offDir<0); }
qsa('#cpSeg button').forEach(b=>on(b,'click',()=>{optSide=b.dataset.s;syncDefaults();}));
qsa('#bsSeg button').forEach(b=>on(b,'click',()=>{optRole=b.dataset.s;syncDefaults();}));
on('#sgnP','click',()=>{offDir=1;syncDefaults();});
on('#sgnM','click',()=>{offDir=-1;syncDefaults();});
function addStrike(K,side,role){
  const list=listFor(); if(!list)return;
  K=Math.round(K); if(list.some(r=>r.K===K))return;
  list.push({K,side:side||optSide,role:role||optRole,on:true,sl:'',tp:'',ent:'',amode:'auto',aval:0});
  list.sort((a,b)=>a.K-b.K); strikeSig=''; refreshStrikes(); }
function ensureAtmRow(){
  const root=rootOf(); if(!root||inst!=='fno')return;
  if(listFor().length)return;
  const spot=liveSpot(root), step=strikeStep(root,spot);
  addStrike(Math.round(spot/step)*step,'CE','buyer'); }
function loadOffset(n){
  const root=rootOf(); if(!root){toast('switch to FNO first','err');return;}
  const spot=liveSpot(root), step=strikeStep(root,spot);
  addStrike(Math.round(spot/step)*step+(n?offDir*n*step:0),optSide,optRole); }
on('#qAtm','click',()=>loadOffset(null));
qsa('.qb.num').forEach(b=>on(b,'click',()=>loadOffset(+b.dataset.n)));
on('#stAdd','click',()=>{ const K=+qs('#stIn').value;
  if(K>0&&rootOf()){addStrike(K,optSide,optRole);qs('#stIn').value='';} });
on('#stIn','keydown',e=>{if(e.key==='Enter')qs('#stAdd').click();});
on('#stSort','change',e=>{stSort=e.target.value;strikeSig='';refreshStrikes();});
on('#stFilt','change',e=>{stFilt=e.target.value;strikeSig='';refreshStrikes();});
function normalizeAlloc(side,changedK,newPct){
  const root=rootOf(); if(!root)return;
  const others=(strikeLists.get(root+'|'+expAll[curOptExp].f)||[])
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
  const list=(strikeLists.get(root+'|'+expAll[curOptExp].f)||[]).filter(r=>r.side===side);
  let amt=0,lots=0;
  list.forEach(r=>{ amt+=rowAmt(r,root); lots+=rowLots(r,root); });
  return{n:list.length,amt,lots}; }
function deploy(sideOpt){
  const root=rootOf(); if(!root){toast('switch to FNO first','err');return;}
  const list=(strikeLists.get(root+'|'+expAll[curOptExp].f)||[]).filter(r=>r.on&&r.side===sideOpt);
  if(!list.length){toast(`no enabled ${sideOpt} strikes (☑)`,'err');return;}
  let n=0,sk=0;
  list.forEach(r=>{
    const lots=rowLots(r,root), lot=LOTS[root]||1;
    if(lots<1){sk++;return;}
    placeKeyOrder(optKey(root,r.K,r.side),r.role==='buyer'?1:-1,lots*lot,optLtp(root,r.K,r.side));
    n++; });
  toast(`DEPLOY ${sideOpt} · ${n} strike(s) · ${PRD}${sk?` · ${sk} skipped`:''}`,'ok'); }
function deployAtm(sideOpt){
  const root=rootOf(); if(!root){toast('switch to FNO first','err');return;}
  const spot=liveSpot(root), step=strikeStep(root,spot);
  const K=Math.round(spot/step)*step;
  const r=listFor().find(x=>x.K===K);
  if(r){ r.side=sideOpt; r.on=true; } else addStrike(K,sideOpt,optRole);
  strikeSig=''; refreshStrikes(); deploy(sideOpt); }
function closeSide(sideOpt){
  const root=rootOf(); if(!root)return;
  const list=(strikeLists.get(root+'|'+expAll[curOptExp].f)||[]).filter(r=>r.on&&r.side===sideOpt);
  let n=0;
  list.forEach(r=>positions.filter(p=>p.key===optKey(root,r.K,r.side)).forEach(p=>{squareOff(p.id);n++;}));
  toast(n?`closed ${n} ${sideOpt} position(s)`:`no open ${sideOpt} on enabled strikes`); }
async function swapQuick(){
  const root=rootOf(); if(!root)return;
  const list=(strikeLists.get(root+'|'+expAll[curOptExp].f)||[]).filter(r=>r.on);
  if(!list.length){toast('no enabled rows to swap','err');return;}
  let n=0;
  for(const r of list){
    await Promise.all([...positions.filter(p=>p.key===optKey(root,r.K,r.side))].map(p=>squareOff(p.id)));
    if(r.side==='CE')r.side='PE';
    else if(r.side==='PE')r.side='CE';
    else r.role=r.role==='buyer'?'seller':'buyer';
    const lots=rowLots(r,root), lot=LOTS[root]||1;
    if(lots>=1){ await placeKeyOrder(optKey(root,r.K,r.side),r.role==='buyer'?1:-1,lots*lot,optLtp(root,r.K,r.side)); n++; } }
  strikeSig=''; refreshStrikes();
  toast(`SWAP · closed + flipped + deployed ${n}`,'ok'); }
on('#qDCE','click',()=>deploy('CE'));
on('#qDPE','click',()=>deploy('PE'));
on('#qSW','click',swapQuick);
on('#qCCE','click',()=>closeSide('CE'));
on('#qCPE','click',()=>closeSide('PE'));
on('#qCA','click',()=>{ const n=positions.length;
  [...positions].forEach(p=>squareOff(p.id)); toast(n?`closed all (${n})`:'no open positions'); });
on('#qCXL','click',()=>{
  const list=listFor(); if(list)list.forEach(r=>r.on=false);
  ticketKey=null; const t=qs('#tkSym'); if(t)t.textContent=SYM?SYM.disp:'—';
  refreshStrikes(); toast('cancelled selections'); });
const amLabel=m=>m==='auto'?'AUTO':m==='pct'?'%':'₹';
function renderStrikeRows(root,exp,list){
  const body=qs('#stBody'); if(!body)return;
  body.innerHTML=''; rowRefs.clear();
  if(!list.length){ body.innerHTML='<div class="pempty">no strikes yet<br>ATM · ±1…7 · custom input</div>'; return; }
  list.forEach(r=>{
    const row=document.createElement('div');row.className='srow';row.dataset.k=r.K;
    row.innerHTML=`
      <div class="l1">
        <input type="checkbox" data-act="en" ${r.on?'checked':''}>
        <button class="mv" data-act="dn">−</button>
        <span class="k">${r.K}</span>
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
on('#stBody','click',e=>{
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
    updateStrikeCells(root,expAll[curOptExp].f,listFor()); return; }
  if(e.target.classList.contains('k')||e.target.classList.contains('lpx')){
    const key=optKey(root,K,r.side);
    ticketKey=key; qs('#tkSym').textContent=disp(key);
    qs('#tkQty').value=1; updateLotLbl();
    qsa('.srow').forEach(x=>x.classList.toggle('selRow',x===row));
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
    ticketKey=key; qs('#tkSym').textContent=disp(key); updateLotLbl();
    toast(`${act==='buy'?'BUY':'SELL'} ${lots} lot (${lots*lot}) ${disp(key)}`,'ok');
    return; }
  if(act==='exit'){ positions.filter(p=>p.key===optKey(root,K,r.side)).forEach(p=>squareOff(p.id)); return; } });
on('#stBody','input',e=>{
  const row=e.target.closest('.srow'); if(!row)return;
  const K=+row.dataset.k, root=rootOf(); const r=listFor().find(x=>x.K===K); if(!r)return;
  if(e.target.classList.contains('als')){
    r.aval=+e.target.value;
    const ref=rowRefs.get(K);
    if(ref){ ref.amt.textContent=fmtInr(rowAmt(r,root));
      ref.lot.textContent=rowLots(r,root)+'L · '+fmtInr(optLtp(root,K,r.side)*(LOTS[root]||1))+'/lot'; } } });
on('#stBody','change',e=>{
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
    ref.hl.innerHTML=`H <b>${hi>=100?hi.toFixed(1):hi.toFixed(2)}</b> L <b>${lo>=100?lo.toFixed(1):lo.toFixed(2)}</b>`;
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
  const list=listFor(), exp=expAll[curOptExp].f;
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
  const st=qs('#stStats');
  if(st)st.innerHTML=`CE <b>${nCE}</b> · ${c.lots}L · ${fmtInr(c.amt)} | PE <b>${nPE}</b> · ${p2.lots}L · ${fmtInr(p2.amt)} | B${nB}/S${nS}`;
  const sc=qs('#stCnt'); if(sc)sc.textContent=`${view.length}/${list.length}`; }
function checkSLTP(){
  for(const p of [...positions]){
    const m=/^NFO:([A-Z]+)(\d{2}[A-Z]{3}\d{2})(\d+)(CE|PE)$/.exec(p.key); if(!m)continue;
    const rows=strikeLists.get(m[1]+'|'+m[2])||[];
    const row=rows.find(r=>r.K===+m[3]&&r.side===m[4]); if(!row)continue;
    const sl=parseFloat(row.sl), tp=parseFloat(row.tp);
    if(!isFinite(sl)&&!isFinite(tp))continue;
    const ltp=currentPriceOf(p.key); if(!isFinite(ltp))continue;
    let hit=null;
    if(p.side>0){ if(isFinite(sl)&&ltp<=sl)hit='SL'; else if(isFinite(tp)&&ltp>=tp)hit='TARGET'; }
    else{ if(isFinite(sl)&&ltp>=sl)hit='SL'; else if(isFinite(tp)&&ltp<=tp)hit='TARGET'; }
    if(hit){ toast(`${hit} hit · ${disp(p.key)} @ ${fmtP(ltp)}`, hit==='SL'?'err':'ok'); squareOff(p.id); } } }

/* ═══════════ scheduler ═══════════ */
let sched=[], schedSeq=1;
const ACTS={
  deployCE:()=>deploy('CE'), deployPE:()=>deploy('PE'),
  deployAtmCE:()=>deployAtm('CE'), deployAtmPE:()=>deployAtm('PE'),
  exitCE:()=>closeSide('CE'), exitPE:()=>closeSide('PE'),
  exitAll:()=>{[...positions].forEach(p=>squareOff(p.id));},
  exitSym:k=>{[...positions.filter(p=>p.key===k)].forEach(p=>squareOff(p.id));},
  buySym:k=>{ const lot=ticketLot(); placeKeyOrder(k,1,Math.max(1,+qs('#tkQty').value||1)*lot); },
  sellSym:k=>{ const lot=ticketLot(); placeKeyOrder(k,-1,Math.max(1,+qs('#tkQty').value||1)*lot); } };
const ACTLBL={deployCE:'DEPLOY CE',deployPE:'DEPLOY PE',deployAtmCE:'ATM CE',deployAtmPE:'ATM PE',
  exitCE:'EXIT CE',exitPE:'EXIT PE',exitAll:'EXIT ALL',exitSym:'EXIT SYMBOL',buySym:'BUY SYMBOL',sellSym:'SELL SYMBOL'};
function renderSched(){
  const tb=qs('#tbSch'); if(!tb)return;
  if(!sched.length){tb.innerHTML='<tr class="emptyRow"><td colspan="5">no scheduled actions — add below</td></tr>';return;}
  tb.innerHTML=sched.map(t=>{
    const tgt=t.sym?disp(t.sym):(t.act.includes('Atm')?'current ATM':'enabled ☑ strikes');
    const pend=!t.done&&t.at>Date.now();
    return `<tr><td><b>${new Date(t.at).toLocaleString('en-IN',{hour12:false})}</b></td>
      <td>${ACTLBL[t.act]||t.act}</td><td>${tgt}</td>
      <td class="${t.done?'':(pend?'u':'d')}">${t.done?'✓ fired':pend?'pending':'missed'}</td>
      <td>${!t.done?`<button class="pb" onclick="schedFire(${t.id})">RUN NOW</button>`:''}<button class="pb" onclick="schedEdit(${t.id})">EDIT</button><button class="sq" onclick="schedDel(${t.id})">✕</button></td></tr>`;}).join(''); }
function schedFire(id){ const t=sched.find(x=>x.id===id); if(!t||t.done)return;
  t.done=true;
  try{t.sym?ACTS[t.act](t.sym):ACTS[t.act]();}catch(e){}
  renderSched(); toast('⏰ '+(ACTLBL[t.act]||t.act)+' fired','ok'); }
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
qsa('.tabs button').forEach(b=>on(b,'click',()=>{
  qsa('.tabs button').forEach(x=>x.classList.toggle('on',x===b));
  qs('#tblPos').style.display=b.dataset.t==='pos'?'':'none';
  qs('#tblTrd').style.display=b.dataset.t==='trd'?'':'none';
  qs('#tblSch').style.display=b.dataset.t==='sch'?'':'none';
  if(b.dataset.t==='sch')renderSched(); }));
on('#scAdd2','click',()=>{
  const act=qs('#scAct').value, at=new Date(qs('#scAt').value).getTime();
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

/* ═══════════ quotes / sim ticks ═══════════ */
function simTickOthers(){
  for(const [key,q] of quotes){
    if(panes.some(p=>p.key===key))continue;
    const m=metaCache.get(key);
    if(m&&m.type==='OPT')
      q.ltp=bs(liveSpot(m.root),m.strike,tym(m.exp),m.iv,m.optSide==='CE')*(1+(rng()-.5)*0.012);
    else q.ltp=Math.max(1,q.ltp*(1+gauss()*0.0006)); } }
let tickN=0;
setInterval(()=>{ if(SRC!=='sim'||paused)return;
  tickN++;
  const keys=new Set(panes.filter(p=>p&&p.key).map(p=>p.key));
  keys.forEach(k=>{
    const sd=dataCache.get(k); if(!sd||!sd.bars.length)return;
    const arr=k===(SYM&&SYM.key)?bars:sd.bars;
    const b=arr[arr.length-1], m=(arr.length-1)%SESSION;
    const smile=1+1.2*Math.exp(-m/45)+0.8*Math.exp(-(SESSION-m)/55);
    const nc=b.c*(1+gauss()*0.00042*smile*0.36);
    b.c=nc; if(nc>b.h)b.h=nc; if(nc<b.l)b.l=nc;
    b.v+=Math.round(50+rng()*180);
    const q=quotes.get(k); if(q)q.ltp=nc;
    panes.forEach(p=>{ if(p&&p.key===k){p.aggDirty=true;p.dataVer++;} }); });
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
          panes.forEach(p=>{ if(p&&p.key===k){p.aggDirty=true;p.dataVer++;} }); } }catch(e){} }));
    apiOK=ok>0; setSrcDot();
    refreshWatch(); refreshStrikes(); refreshPositions(); checkSLTP(); updateAcct(); syncPaneUI(); }
  finally{apiPolling=false;} }
setInterval(brokerPoll,3000);

/* ═══════════ load (no sim fallback) ═══════════ */
async function loadSymbol(key){
  key=normKey(key);
  const {exch}=parseKey(key);
  const es=qs('#exchSel');
  if(es&&[...es.options].some(o=>o.value===exch||o.textContent===exch))es.value=exch;
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
  dataCache.set(key,sd);
  if(meta.root)lastRoot=meta.root;
  SYM=meta;
  bars.length=0; for(const b of sd.bars)bars.push(b);
  price=sd.price;
  paneLoadSymbol(key);
  if(SYM.type==='OPT'){optSide=SYM.optSide;syncDefaults();}
  inst=SYM.type==='EQ'||SYM.type==='INDEX'?'eq':'fno';
  if(inst==='fno'&&panes.length>=3&&!panes[1].key)setupFnoPanes();
  applySegUI(); updateSymbolUI(); buildWatch(); ensureAtmRow();
  strikeSig=''; refreshStrikes(); refreshPositions(); updateAcct();
  ticketKey=key; qs('#tkSym').textContent=SYM.disp;
  qs('#tkQty').value=1; updateLotLbl(); }
function updateSymbolUI(){
  if(!SYM)return;
  const s1=qs('#symName'),s2=qs('#symSub');
  if(s1)s1.textContent=SYM.disp;
  if(s2)s2.textContent=`${SYM.exch} · ${SYM.type}${SYM.exp?' · '+SYM.exp:''}${SYM.type==='OPT'?' · '+SYM.strike+' '+SYM.optSide:''}`;
  document.title=`${SYM.disp} · Scalping Tool`; }
on('#loadBtn','click',()=>{ const k=qs('#symIn').value.trim(); if(k)loadSymbol(normKey(k)); });
on('#symIn','keydown',e=>{ if(e.key==='Enter'&&qs('#acDrop').hidden){const k=qs('#symIn').value.trim();if(k)loadSymbol(normKey(k));} });
on('#addWatchBtn','click',()=>{ const k=ticketKey||(SYM&&SYM.key); if(!k)return;
  if(!watch.includes(k)){watch.push(k);persistWatch();buildWatch();toast(disp(k)+' added to watchlist','ok');} });
on('#tkBuy','click',()=>{
  const key=ticketKey||(SYM&&SYM.key); if(!key)return;
  const lots=Math.max(1,+qs('#tkQty').value||1), lot=ticketLot();
  placeKeyOrder(key,1,lots*lot);
  toast(`BUY ${lots}${lot>1?' lot ('+lots*lot+')':''} ${disp(key)}`,'ok'); });
on('#tkSell','click',()=>{
  const key=ticketKey||(SYM&&SYM.key); if(!key)return;
  const lots=Math.max(1,+qs('#tkQty').value||1), lot=ticketLot();
  placeKeyOrder(key,-1,lots*lot);
  toast(`SELL ${lots}${lot>1?' lot ('+lots*lot+')':''} ${disp(key)}`,'ok'); });
on('#tkFlat','click',()=>{ [...positions].forEach(p=>squareOff(p.id)); });
qsa('#ordType button').forEach(b=>on(b,'click',()=>{
  ordType=b.dataset.o;
  qsa('#ordType button').forEach(x=>x.classList.toggle('on',x===b));
  qs('#ordPx').style.display=ordType==='LMT'?'':'none';
  if(ordType==='LMT'){ const key=ticketKey||(SYM&&SYM.key);
    qs('#ordPx').value=key?currentPriceOf(key).toFixed(2):''; } }));
on('#botMin','click',()=>{ const bd=qs('#bottom'); bd.classList.toggle('min');
  qs('#botMin').textContent=bd.classList.contains('min')?'▴':'▾'; });

/* ═══════════ settings ═══════════ */
on('#setBtn','click',()=>{
  const b=activeBroker();
  qs('#setTitle').textContent=b.label+' · SETTINGS';
  qs('#setWarn').style.display=SRC==='sim'?'none':'';
  const f=qs('#bkFields'); f.innerHTML='';
  (b.fields||[]).forEach(fd=>{
    const l=document.createElement('label');l.textContent=fd.l;
    const i=document.createElement('input');
    i.type=(fd.k==='pwd'||fd.k==='key'||fd.k==='secret'||fd.k==='totp')?'password':'text';
    i.placeholder=fd.ph||''; i.value=bcfg(b.id)[fd.k]||''; i.dataset.bk=fd.k;
    f.appendChild(l);f.appendChild(i); });
  qs('#setCap').value=CFG.cap;qs('#setMode').value=CFG.deployMode;qs('#setVal').value=CFG.deployVal;
  qs('#setModal').classList.add('show'); });
on('#setCancel','click',()=>qs('#setModal').classList.remove('show'));
on('#setSave','click',()=>{
  const b=activeBroker();
  qsa('#bkFields input').forEach(i=>{bcfg(b.id)[i.dataset.bk]=i.value.trim();});
  CFG.cap=Math.max(0,+qs('#setCap').value||CFG.cap);
  CFG.deployMode=qs('#setMode').value;
  CFG.deployVal=Math.max(0,+qs('#setVal').value||CFG.deployVal);
  saveCfg(); qs('#setModal').classList.remove('show');
  updateAcct(); refreshStrikes(); toast('settings saved','ok'); });
on('#setTest','click',async()=>{
  const b=activeBroker();
  qsa('#bkFields input').forEach(i=>{bcfg(b.id)[i.dataset.bk]=i.value.trim();});
  saveCfg();
  try{ await b.test(bcfg(b.id)); toast(b.label+' reachable ✓ session stored','ok'); }
  catch(e){ toast('TEST failed: '+e.message,'err'); } });

/* ═══════════ boot (single, authoritative) ═══════════ */
buildSrcSeg(); setSrcDot();
buildLayout(2,2);
buildToolbar(); setTool('cursor');
syncDefaults(); buildWatch(); buildExpSels();
on('#exchSel','change',e=>{ CUR_EXCH=e.target.value; });
wireAutocomplete(qs('#symIn'),qs('#acDrop'),k=>loadSymbol(k));
qs('#defLots').value=CFG.defLots||1;
loadSymbol('NSE:NIFTY');
popWire('#sclBtn','#sclPop');
popWire('#indBtn','#indPop');
syncScalesUI(); syncGhostUI(); refreshPositions(); updateAcct();
requestAnimationFrame(frame);

/* ═══ pane-guard layer — paste at the VERY END of core.js ═══ */
(function(){
  /* normalize layout shape (older code paths may have left a string/number) */
  if(typeof layout==='string'){ const m=layout.match(/(\d+)\D+(\d+)/);
    layout=m?{r:+m[1],c:+m[2]}:{r:2,c:2}; }
  if(typeof layout==='number'){ const n=layout; layout={r:n,c:n}; }

  let _fixing=false;
  const sane=()=>{
    if(!Array.isArray(panes))panes=[];
    const good=panes.filter(p=>p&&p.box instanceof Element);
    if(good.length!==panes.length){
      console.warn('[layout] dropped '+(panes.length-good.length)+
        ' malformed pane(s) — a stale fragment is still in core.js. Run __diag() and search the file for: _keep / paneCount / resetSplitters / installData / clearChart / tick( / newBar( / renderHeader(');
      panes=good;
      if(!_fixing&&panes.length){
        _fixing=true;
        try{ buildLayout(layout.r||2,layout.c||2); }catch(e){}
        _fixing=false;
        return sane();
      }
    }
    if(activePane>=panes.length)activePane=Math.max(0,panes.length-1);
    return panes.length>0;
  };

  applyGridTemplate=function(){
    const grid=qs('#grid'); if(!grid)return;
    if(!sane())return;
    grid.style.gridTemplateColumns=colFr.map(f=>f+'fr').join(' ');
    grid.style.gridTemplateRows=rowFr.map(f=>f+'fr').join(' ');
    grid.classList.toggle('maxed',maxPane!=null);
    panes.forEach((p,i)=>p.box.classList.toggle('max',i===maxPane));
    placeSplitters();
  };

  syncPaneUI=function(){ if(!sane())return;
    panes.forEach((p,i)=>{
      p.box.classList.toggle('activePane',i===activePane);
      const pn=p.box.querySelector('.pn');
      if(pn)pn.textContent='P'+(i+1)+' · '+paneTitle(p.key);
      const q=p.key?quotes.get(p.key):null;
      const pl=p.box.querySelector('.pl');
      if(pl){ pl.textContent=q?fmtP(q.ltp):'—';
        pl.style.color=q&&q.prevClose&&q.ltp<q.prevClose?'var(--dn)':'var(--up)'; }
      const px=p.box.querySelector('.px');
      if(px)px.style.visibility=p.key?'visible':'hidden';
    });
  };

  placeSplitters=function(){
    qsa('#wrap .spl').forEach(e=>e.remove());
    if(maxPane!=null||!panes.length)return;
    const wrap=qs('#wrap'); if(!wrap)return;
    const totC=colFr.reduce((a,b)=>a+b,0)||1, totR=rowFr.reduce((a,b)=>a+b,0)||1;
    for(let j=1;j<colFr.length;j++){
      const s=document.createElement('div'); s.className='spl v';
      s.style.left=(colFr.slice(0,j).reduce((a,b)=>a+b,0)/totC*100)+'%';
      s.dataset.j=j; wrap.appendChild(s); }
    for(let i=1;i<rowFr.length;i++){
      const s=document.createElement('div'); s.className='spl h';
      s.style.top=(rowFr.slice(0,i).reduce((a,b)=>a+b,0)/totR*100)+'%';
      s.dataset.i=i; wrap.appendChild(s); }
  };

  mountOverlays=function(){
    const p=activeP(); if(!p||!(p.box instanceof Element))return;
    ['#tools','#legend','#latestBtn','#toolChip','#axMenu','#txtIn'].forEach(id=>{
      const el=qs(id); if(el&&el.parentElement!==p.box)p.box.appendChild(el); });
  };

  layoutUI=function(){
    const pt=qs('#paneTabs'); if(!pt)return;
    if(!sane()){pt.innerHTML='';return;}
    pt.innerHTML=panes.map((p,i)=>
      `<span class="ptab${i===activePane?' on':''}" data-i="${i}">P${i+1} · ${paneTitle(p.key)}</span>`).join('');
    qsa('#paneTabs .ptab').forEach(t=>on(t,'click',()=>{
      activePane=+t.dataset.i;layoutUI();syncPaneUI();syncGhostUI();}));
    mountOverlays();
  };

  clearAllPanes=function(){
    panes.forEach(p=>{ if(!p)return;
      p.key=null;p.yLo=p.yHi=null;
      if(p.aggCache)p.aggCache.clear();
      p.indCache=null;p.dataVer=(p.dataVer||0)+1; });
    bars.length=0;
    if(sane()){syncPaneUI();layoutUI();}
  };

  /* diagnostics */
  window.__diag=()=>{
    const stale=['paneCount','resetSplitters','snapshotTab','restoreTab','switchTab',
      'installData','clearChart','tick','newBar','renderHeader','flashHeader','fmtEnd'];
    const found=stale.filter(f=>typeof window[f]==='function');
    console.table(found.map(f=>({staleFunction:f})));
    console.log('applyGridTemplate guarded:',/sane/.test(applyGridTemplate.toString()));
    console.log('panes:',panes.length,'| active:',activePane,'| layout:',JSON.stringify(layout));
    return found.length?('STALE FRAGMENTS PRESENT — delete the blocks defining: '+found.join(', '))
                       :'core.js looks clean';
  };
  console.log('%c[layout guard] active — run __diag() to find stale fragments','color:#e0a63f');
})();
