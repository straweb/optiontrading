'use strict';
/* ============ core — commands, broker routing, panels, boot ============ */
let CFG=Object.assign({cap:100000,deployMode:'pct',deployVal:75,src:'sim',defLots:1,brokers:{}},
  JSON.parse(localStorage.getItem('scalping_cfg')||'{}'));
function saveCfg(){localStorage.setItem('scalping_cfg',JSON.stringify(CFG));}
const bcfg=id=>CFG.brokers[id]||(CFG.brokers[id]={});
let SRC=CFG.src||'sim', apiOK=false, apiPolling=false;
const activeBroker=()=>BROKERS[SRC]||BROKERS.sim;
function usableFunds(){ return CFG.deployMode==='pct'?CFG.cap*(+CFG.deployVal||0)/100:(+CFG.deployVal||0); }
let SYM=null, ticketKey=null, ordType='MKT', PRD='MIS', editRowId=null;

/* ---------- broker source ---------- */
const srcSeg=$('#srcSeg');
function buildSrcSeg(){ srcSeg.innerHTML='';
  Object.values(BROKERS).forEach(b=>{
    const bt=document.createElement('button');bt.textContent=b.label;bt.dataset.s=b.id;
    bt.classList.toggle('on',b.id===SRC);
    bt.addEventListener('click',()=>selectSrc(b.id));
    srcSeg.appendChild(bt); }); }
function setSrcDot(){ const d=$('#srcDot');
  d.className=SRC==='sim'?'':(apiOK?'api':'err');
  $('#srcLbl').textContent=SRC==='sim'?'SIM':(apiOK?BROKERS[SRC].label+' · LIVE':BROKERS[SRC].label+' · NO LINK'); }
function selectSrc(id){
  SRC=id; CFG.src=id; saveCfg();
  buildSrcSeg(); setSrcDot();
  clearChart();                                  /* never keep stale feed data */
  if(id==='sim'){ loadSymbol(SYM?SYM.key:'NSE:NIFTY'); }
  else{
    const cfgd=!!(bcfg(id).key||bcfg(id).uid||bcfg(id).url);
    if(!cfgd){ toast(BROKERS[id].label+' not configured — chart cleared','err'); $('#setBtn').click(); }
    else if(SYM) loadSymbol(SYM.key);
    else toast(BROKERS[id].label+' selected — load a symbol');
  }
  updateAcct(); refreshStrikes(); refreshPositions(); }

/* ---------- orders (command layer) ---------- */
let positions=[], trades=[], posId=1;
const realized={};
function currentPriceOf(key){ return key===(SYM&&SYM.key)?price:(quotes.get(key)?.ltp??resolveMeta(key).basePrice); }
function ticketLot(){ return SYM&&SYM.root&&LOTS[SYM.root]?LOTS[SYM.root]:1; }
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
  }catch(e){ toast('broker order failed: '+e.message,'err'); return false; }
}
async function placeKeyOrder(key,side,qty,px){
  if(!key||qty<=0)return;
  const live=px??currentPriceOf(key); ensureQuote(key);
  const fill=resolveFill(live);
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
  refreshPositions(); refreshStrikes(); updateAcct();
}
async function squareOff(id){
  const i=positions.findIndex(p=>p.id===id); if(i<0)return;
  const p=positions[i]; const ltp=currentPriceOf(p.key);
  await routeOrder(p.key,-p.side,p.qty,ltp);
  const pnl=(ltp-p.avg)*p.side*p.qty;
  realized[p.key]=(realized[p.key]||0)+pnl;
  trades.unshift({t:ts(),key:p.key,side:-p.side,qty:p.qty,price:ltp,pnl});
  positions.splice(i,1); refreshPositions(); refreshStrikes(); updateAcct();
}
window.squareOff=squareOff;
function editPosition(id){ editRowId=id; refreshPositions(); }
window.editPosition=editPosition;
function cancelEdit(){ editRowId=null; refreshPositions(); }
window.cancelEdit=cancelEdit;
async function saveEdit(id){
  const tr=document.querySelector(`#tbPos tr[data-id="${id}"]`); if(!tr)return;
  const nq=Math.max(0,Math.round(+tr.querySelector('.eq').value||0));
  const na=Math.max(0,+tr.querySelector('.ea').value||0);
  const p=positions.find(x=>x.id===id); if(!p)return;
  const key=p.key, ltp=currentPriceOf(key);
  if(nq===0){ editRowId=null; await squareOff(id); return; }
  const d=nq-p.qty;
  if(d!==0) await routeOrder(key,d>0?p.side:-p.side,Math.abs(d),ltp);
  if(d<0){ const pnl=(ltp-p.avg)*p.side*(-d);
    realized[key]=(realized[key]||0)+pnl;
    trades.unshift({t:ts(),key,side:-p.side,qty:-d,price:ltp,pnl}); }
  else if(d>0){ p.avg=(p.avg*p.qty+ltp*d)/nq; }
  p.qty=nq; if(na>0)p.avg=na;
  editRowId=null; refreshPositions(); refreshStrikes(); updateAcct();
}
window.saveEdit=saveEdit;
function repeatPos(id){
  const p=positions.find(x=>x.id===id); if(!p)return;
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

function refreshPositions(){
  const tb=$('#tbPos');
  /* frozen while editing — only live cells update, inputs survive */
  if(editRowId!=null){
    const p=positions.find(x=>x.id===editRowId);
    if(!p){ editRowId=null; }
    else{
      const tr=tb.querySelector(`tr[data-id="${p.id}"]`);
      if(tr&&tr.querySelector('.eq')){
        const ltp=currentPriceOf(p.key);
        const pnl=(ltp-p.avg)*p.side*p.qty, net=pnl+(realized[p.key]||0);
        tr.cells[4].textContent=fmtP(ltp);
        tr.cells[5].textContent=(pnl>=0?'+':'')+pnl.toFixed(2); tr.cells[5].className=pnl>=0?'u':'d';
        tr.cells[6].textContent=(net>=0?'+':'')+net.toFixed(2); tr.cells[6].className=net>=0?'u':'d';
        return; }
      /* fall through: render the edit row now */
    } }
  if(!positions.length){
    editRowId=null;
    tb.innerHTML='<tr class="emptyRow"><td colspan="8">no open positions — BUY/SELL ticket, DEPLOY / SWAP quick actions, or strike-row B/S</td></tr>';
  }else{
    tb.innerHTML=positions.map(p=>{
      const ltp=currentPriceOf(p.key);
      const pnl=(ltp-p.avg)*p.side*p.qty, net=pnl+(realized[p.key]||0);
      if(p.id===editRowId){
        return `<tr data-id="${p.id}"><td><b>${disp(p.key)}</b></td>
          <td class="${p.side>0?'u':'d'}">${p.side>0?'BUY':'SELL'}</td>
          <td class="ed"><input class="eq" type="number" min="0" value="${p.qty}"></td>
          <td class="ed"><input class="ea" type="number" step="0.05" value="${p.avg.toFixed(2)}"></td>
          <td>${fmtP(ltp)}</td>
          <td class="${pnl>=0?'u':'d'}">${pnl>=0?'+':''}${pnl.toFixed(2)}</td>
          <td class="${net>=0?'u':'d'}">${net>=0?'+':''}${net.toFixed(2)}</td>
          <td><button class="pb" onclick="saveEdit(${p.id})">SAVE</button><button class="sq" onclick="cancelEdit()">CANCEL</button></td></tr>`;
      }
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
    <td><button class="pb" onclick="repeatTrade(${i})">REPEAT</button></td></tr>`).join('');
}
 $('#tbPos').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&e.target.classList&&(e.target.classList.contains('eq')||e.target.classList.contains('ea'))){
    const tr=e.target.closest('tr'); if(tr&&tr.dataset.id)saveEdit(+tr.dataset.id); } });

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
  $('#capPct').textContent=CFG.deployMode==='pct'?Math.round(CFG.deployVal)+'%':fmtInr(CFG.deployVal);
}
 $('#capSlider').addEventListener('input',e=>{
  CFG.deployVal=+e.target.value; saveCfg(); updateAcct(); refreshStrikes(); });
 $('#defLots').addEventListener('change',e=>{
  CFG.defLots=Math.max(1,Math.round(+e.target.value||1)); e.target.value=CFG.defLots;
  saveCfg(); refreshStrikes(); });
 $('#prdSel').addEventListener('change',e=>{ PRD=e.target.value; });

/* ---------- watchlist ---------- */
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
    wRefs.set(key,{px:row.querySelector('.px b'),pc:row.querySelector('.px i'),row});
  });
  refreshWatch();
}
function refreshWatch(){
  for(const [key,r] of wRefs){ const q=ensureQuote(key);
    const chg=(q.ltp-q.prevClose)/q.prevClose*100;
    r.px.textContent=fmtP(q.ltp);
    r.pc.textContent=(chg>=0?'+':'')+chg.toFixed(2)+'%';
    r.pc.style.color=chg>=0?'var(--up)':'var(--dn)';
    r.row.classList.toggle('on',!!SYM&&key===SYM.key); } }
function persistWatch(){localStorage.setItem('scalping_watch',JSON.stringify(watch));}

/* ---------- FNO selector ---------- */
let inst='spot', expIdx=0;
function rootOf(){ if(!SYM)return null;
  if(SYM.type==='OPT'||SYM.type==='FUT')return SYM.root;
  return FNO_SET.has(SYM.sym)?SYM.sym:null; }
function buildExpSel(){ const sel=$('#expSel'); sel.innerHTML='';
  expFmts.forEach((f,i)=>{const o=document.createElement('option');o.value=i;o.textContent=f;sel.appendChild(o);}); }
function applyFnoUI(){
  const root=rootOf(); const hasFno=!!root;
  $('#instSeg').querySelectorAll('button').forEach(b=>b.disabled=!hasFno);
  $('#expSel').disabled=!hasFno||inst==='spot';
  if(hasFno){
    $('#instSeg').querySelectorAll('button').forEach(b=>
      b.classList.toggle('on',b.dataset.i===(SYM.type==='OPT'?'opt':SYM.type==='FUT'?'fut':'spot')));
    if(SYM.exp){const i=expFmts.indexOf(SYM.exp);if(i>=0){expIdx=i;$('#expSel').value=i;}}
  }else $('#instSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.i==='spot')); }
 $('#instSeg').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
  if(b.disabled)return; inst=b.dataset.i;
  if(inst==='opt'){ if(!SYM||SYM.type!=='OPT')loadAtmChart(); ensureAtmRow(); }
  else if(rootOf()) loadSymbol(inst==='fut'?'NFO:'+rootOf()+expFmts[expIdx]+'FUT':'NSE:'+rootOf());
  refreshStrikes();
}));
 $('#expSel').addEventListener('change',e=>{ expIdx=+e.target.value;
  if(!rootOf())return;
  if(inst==='fut')loadSymbol('NFO:'+rootOf()+expFmts[expIdx]+'FUT');
  else {strikeSig='';refreshStrikes();} });
function loadAtmChart(){ const root=rootOf(); if(!root)return;
  const spot=liveSpot(root), st=strikeStep(root,spot);
  loadSymbol('NFO:'+root+expFmts[expIdx]+Math.round(spot/st)*st+(SYM&&SYM.type==='OPT'?SYM.optSide:'CE')); }
function updateStrikesVis(){
  const root=rootOf(); const show=!!root&&inst==='opt';
  $('#strikes').style.display=show?'flex':'none';
  return show?root:null; }

/* ---------- strike panel ---------- */
let optSide='CE', optRole='buyer', offDir=1, strikeSig='';
const strikeLists=new Map();
const rowRefs=new Map();
let stSort='K', stFilt='ALL';
function listFor(){ const root=rootOf(); if(!root)return null;
  const k=root+'|'+expFmts[expIdx];
  if(!strikeLists.has(k))strikeLists.set(k,[]);
  return strikeLists.get(k); }
function optLtp(root,K,side){
  return bs(liveSpot(root),K,tym(expFmts[expIdx]),IDX[root]?0.13:0.22,side==='CE'); }
function optKey(root,K,side){ return 'NFO:'+root+expFmts[expIdx]+K+side; }
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
  list.sort((a,b)=>a.K-b.K); strikeSig=''; refreshStrikes(); }   /* never touches the chart */
function ensureAtmRow(){
  const root=rootOf(); if(!root||inst!=='opt')return;
  if(listFor().length)return;
  const spot=liveSpot(root), step=strikeStep(root,spot);
  addStrike(Math.round(spot/step)*step,'CE','buyer'); }
function loadOffset(n){                                  /* adds a row only */
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

/* allocation: per-side normalization — CE rows sum to 100%, PE rows to 100% */
function normalizeAlloc(side,changedK,newPct){
  const root=rootOf(); if(!root)return;
  const others=(strikeLists.get(root+'|'+expFmts[expIdx])||[])
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
  const list=(strikeLists.get(root+'|'+expFmts[expIdx])||[]).filter(r=>r.side===side);
  let amt=0,lots=0;
  list.forEach(r=>{ amt+=rowAmt(r,root); lots+=rowLots(r,root); });
  return{n:list.length,amt,lots}; }

function deploy(sideOpt){
  const root=rootOf(); if(!root){toast('load an FNO underlying / option first','err');return;}
  const list=(strikeLists.get(root+'|'+expFmts[expIdx])||[]).filter(r=>r.on&&r.side===sideOpt);
  if(!list.length){toast(`no enabled ${sideOpt} strikes (☑)`,'err');return;}
  let n=0,sk=0;
  list.forEach(r=>{
    const lots=rowLots(r,root), lot=LOTS[root]||1;
    if(lots<1){sk++;return;}
    placeKeyOrder(optKey(root,r.K,r.side),r.role==='buyer'?1:-1,lots*lot,optLtp(root,r.K,r.side));
    n++; });
  toast(`DEPLOY ${sideOpt} · ${n} strike(s) · ${PRD}${sk?` · ${sk} skipped`:''}`,'ok');
}
function deployAtm(sideOpt){
  const root=rootOf(); if(!root){toast('load an FNO underlying first','err');return;}
  const spot=liveSpot(root), step=strikeStep(root,spot);
  const K=Math.round(spot/step)*step;
  const r=listFor().find(x=>x.K===K);
  if(r){ r.side=sideOpt; r.on=true; }
  else addStrike(K,sideOpt,optRole);
  strikeSig=''; refreshStrikes(); deploy(sideOpt); }
function closeSide(sideOpt){
  const root=rootOf(); if(!root)return;
  const list=(strikeLists.get(root+'|'+expFmts[expIdx])||[]).filter(r=>r.on&&r.side===sideOpt);
  let n=0;
  list.forEach(r=>positions.filter(p=>p.key===optKey(root,r.K,r.side)).forEach(p=>{squareOff(p.id);n++;}));
  toast(n?`closed ${n} ${sideOpt} position(s)`:`no open ${sideOpt} on enabled strikes`); }
async function swapQuick(from){
  const to=from==='CE'?'PE':'CE';
  const root=rootOf(); if(!root){toast('load an FNO underlying first','err');return;}
  const list=(strikeLists.get(root+'|'+expFmts[expIdx])||[]).filter(r=>r.on&&r.side===from);
  if(!list.length){toast(`no enabled ${from} rows to swap`,'err');return;}
  let n=0;
  for(const r of list){
    for(const p of [...positions.filter(p=>p.key===optKey(root,r.K,from))]) await squareOff(p.id);
    r.side=to;
    const lots=rowLots(r,root), lot=LOTS[root]||1;
    if(lots>=1){ await placeKeyOrder(optKey(root,r.K,to),r.role==='buyer'?1:-1,lots*lot,optLtp(root,r.K,to)); n++; } }
  strikeSig=''; refreshStrikes();
  toast(`SWAP ${from}→${to} · closed + deployed ${n} strike(s)`,'ok'); }
 $('#qDCE').addEventListener('click',()=>deploy('CE'));
 $('#qDPE').addEventListener('click',()=>deploy('PE'));
 $('#qSCP').addEventListener('click',()=>swapQuick('CE'));
 $('#qSPC').addEventListener('click',()=>swapQuick('PE'));
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
        <input type="checkbox" data-act="en" ${r.on?'checked':''} title="enable for deploy/close">
        <button class="mv" data-act="dn">−</button>
        <span class="k" title="open in chart + ticket">${r.K}</span>
        <button class="mv" data-act="up">+</button>
        <span class="tg side"><button data-tg="side" data-v="CE" class="${r.side==='CE'?'on':''}">C</button><button data-tg="side" data-v="PE" class="${r.side==='PE'?'on':''}">P</button></span>
        <span class="tg"><button data-tg="role" data-v="buyer" class="${r.role==='buyer'?'on':''}">BY</button><button data-tg="role" data-v="seller" class="${r.role==='seller'?'on':''}">SL</button></span>
        <span class="lpx">—</span>
        <button class="mv" data-act="rm" title="remove">✕</button>
      </div>
      <div class="l2"><span class="hl">—</span><span style="margin-left:auto"><b class="amtB">—</b> · <span class="lotB">—</span></span></div>
      <div class="l3">
        <span class="lbl">E</span><input class="tin" data-f="ent" value="${r.ent}" placeholder="—">
        <span class="lbl">SL</span><input class="tin" data-f="sl" value="${r.sl}" placeholder="—">
        <span class="lbl">TP</span><input class="tin" data-f="tp" value="${r.tp}" placeholder="—">
        <button class="mb buy" data-act="buy">B</button>
        <button class="mb sell" data-act="sell">S</button>
      </div>
      <div class="l4">
        <button class="mb" data-act="am" title="allocation mode">${amLabel(r.amode)}</button>
        <input type="range" class="als" min="0" max="${r.amode==='amt'?Math.max(1,Math.round(usableFunds())):100}" step="${r.amode==='amt'?1000:1}" value="${r.aval||0}" ${r.amode==='auto'?'disabled':''}>
        <input class="tin wide" data-f="qty" type="number" min="0" placeholder="lots" title="override lots">
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
    updateStrikeCells(root,expFmts[expIdx],listFor()); return; }
  /* clicking strike or its LTP → load into chart + ticket */
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
    ticketKey=key; $('#tkSym').textContent=disp(key);
    toast(`${act==='buy'?'BUY':'SELL'} ${lots} lot (${lots*lot}) ${disp(key)} @ ${fmtP(resolveFill(optLtp(root,K,r.side)))}`,'ok');
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
    if(r.amode==='pct')normalizeAlloc(r.side,r.K,r.aval);   /* auto-balance the side */
    strikeSig=''; refreshStrikes(); return; }
  const f=e.target.dataset.f;
  if(f==='sl')r.sl=e.target.value;
  else if(f==='tp')r.tp=e.target.value;
  else if(f==='ent')r.ent=e.target.value;
  else if(f==='qty'){
    const lot=LOTS[root]||1, key=optKey(root,K,r.side);
    const ps=positions.filter(p=>p.key===key);
    const curQty=ps.reduce((a,p)=>a+p.side*p.qty,0);
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
  else{
    const d=nq-curQty;
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
        <input class="tin posI" data-f="pq" type="number" value="${qty}" title="edit qty">
        <input class="tin posI" data-f="pa" type="number" step="0.05" value="${avg.toFixed(2)}" title="edit avg">`);
      setCell(ref.pnl,`<span class="${open>=0?'u':'d'}">${open>=0?'+':''}${open.toFixed(0)}</span>
        <span class="${net>=0?'u':'d'}" title="MTM + realized">/${net>=0?'+':''}${net.toFixed(0)}</span>`);
      ref.exit.disabled=false;
    }else{
      setCell(ref.pos,`<span style="color:var(--faint)">${entPx?'E '+entPx.toFixed(1):'—'}</span>`);
      setCell(ref.pnl,`<span style="color:var(--faint)">—</span>`);
      ref.exit.disabled=true; } } }

function refreshStrikes(){
  const root=updateStrikesVis(); if(!root)return;
  const list=listFor(), exp=expFmts[expIdx];
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
  const c=sideInfo('CE'), p=sideInfo('PE');
  const nCE=list.filter(r=>r.side==='CE').length, nPE=list.length-nCE;
  const nB=list.filter(r=>r.role==='buyer').length, nS=list.length-nB;
  $('#stStats').innerHTML=`CE <b>${nCE}</b>/${c.n} · ${c.lots}L · ${fmtInr(c.amt)} &nbsp;|&nbsp; PE <b>${nPE}</b>/${p.n} · ${p.lots}L · ${fmtInr(p.amt)} &nbsp;|&nbsp; B${nB}/S${nS}`;
  $('#stCnt').textContent=`${view.length}/${list.length}`; }

function checkSLTP(){
  for(const p of [...positions]){
    const m=/^NFO:([A-Z]+)(\d{2}[A-Z]{3}\d{2})(\d+)(CE|PE)$/.exec(p.key); if(!m)continue;
    const row=(strikeLists.get(m[1]+'|'+m[2])||[]).find(r=>r.K===+m[3]&&r.side===m[4]); if(!row)continue;
    const sl=parseFloat(row.sl), tp=parseFloat(row.tp);
    if(!isFinite(sl)&&!isFinite(tp))continue;
    const ltp=currentPriceOf(p.key); if(!isFinite(ltp))continue;
    let hit=null;
    if(p.side>0){ if(isFinite(sl)&&ltp<=sl)hit='SL'; else if(isFinite(tp)&&ltp>=tp)hit='TARGET'; }
    else{ if(isFinite(sl)&&ltp>=sl)hit='SL'; else if(isFinite(tp)&&ltp<=tp)hit='TARGET'; }
    if(hit){ toast(`${hit} hit · ${disp(p.key)} @ ${fmtP(ltp)}`, hit==='SL'?'err':'ok'); squareOff(p.id); } } }

/* ---------- scheduler (⏰) ---------- */
let sched=[], schedSeq=1;
const ACTS={
  deployCE:()=>deploy('CE'), deployPE:()=>deploy('PE'),
  deployAtmCE:()=>deployAtm('CE'), deployAtmPE:()=>deployAtm('PE'),
  exitCE:()=>closeSide('CE'), exitPE:()=>closeSide('PE'),
  exitAll:()=>{[...positions].forEach(p=>squareOff(p.id));} };
function localDT(ms){ const d=new Date(ms),p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
const ACTLBL={deployCE:'DEPLOY CE',deployPE:'DEPLOY PE',deployAtmCE:'ATM CE',deployAtmPE:'ATM PE',
  exitCE:'EXIT CE',exitPE:'EXIT PE',exitAll:'EXIT ALL'};
function renderSched(){
  const el=$('#schedList'); el.innerHTML='';
  $('#schedN').textContent=sched.length?`(${sched.filter(t=>!t.done).length} pending)`:'';
  $('#schedCnt').textContent=sched.filter(t=>!t.done).length?`(${sched.filter(t=>!t.done).length})`:'';
  if(!sched.length){el.innerHTML='<div class="stask">no scheduled actions</div>';return;}
  sched.forEach(t=>{
    const d=document.createElement('div');d.className='stask'+(t.done?' done':'');
    d.innerHTML=`<b>${ACTLBL[t.act]||t.act}</b><span>${new Date(t.at).toLocaleString('en-IN',{hour12:false})}</span>${t.done?'<span>✓</span>':''}<button class="rm2" data-id="${t.id}">✕</button>`;
    d.querySelector('.rm2').addEventListener('click',()=>{sched=sched.filter(x=>x.id!==t.id);renderSched();});
    el.appendChild(d); }); }
 $('#qSched').addEventListener('click',()=>{
  const pop=$('#schedPop'); pop.hidden=!pop.hidden;
  if(!pop.hidden){ $('#scAt').value=localDT(Date.now()+60000); renderSched(); } });
 $('#scAdd').addEventListener('click',()=>{
  const ms=new Date($('#scAt').value).getTime();
  if(!isFinite(ms)){toast('pick a valid date & time','err');return;}
  if(ms<Date.now()){toast('time is in the past','err');return;}
  sched.push({id:schedSeq++,at:ms,act:$('#scAct').value,done:false});
  renderSched();
  toast(`⏰ scheduled ${ACTLBL[$('#scAct').value]} at ${new Date(ms).toLocaleTimeString('en-IN')}`,'ok'); });
setInterval(()=>{ let fired=false; const now=Date.now();
  for(const t of sched){ if(!t.done&&t.at<=now){ t.done=true; fired=true;
    try{ACTS[t.act]();}catch(e){}
    toast(`⏰ ${ACTLBL[t.act]||t.act} fired`,'ok'); } }
  if(fired)renderSched(); },250);

/* ---------- quote loops ---------- */
function simTickOthers(){
  for(const [key,q] of quotes){
    if(SYM&&key===SYM.key)continue;
    const m=metaCache.get(key);
    if(m&&m.type==='OPT')
      q.ltp=bs(liveSpot(m.root),m.strike,tym(m.exp),m.iv,m.optSide==='CE')*(1+(rng()-.5)*0.012);
    else q.ltp=Math.max(1,q.ltp*(1+gauss()*0.0006)); } }
let tickN=0;
setInterval(()=>{ if(SRC!=='sim'||paused||!SYM||!bars.length)return;
  tickN++; tick(); if(tickN%21===0)newBar(); simTickOthers(); },280);
setInterval(()=>{ if(SRC!=='sim')return;
  refreshWatch(); refreshStrikes(); refreshPositions(); checkSLTP(); updateAcct(); },1000);
async function brokerPoll(){
  if(SRC==='sim'||apiPolling)return; apiPolling=true;
  try{
    let ok=0;
    await Promise.all([...quotes.keys()].map(async k=>{
      try{ const q=await activeBroker().quote(bcfg(SRC),k);
        if(q.ltp>0){ ok++;
          const qr=quotes.get(k);
          if(q.prevClose)qr.prevClose=q.prevClose;
          qr.ltp=q.ltp;
          if(SYM&&k===SYM.key){ const b=bars[bars.length-1];
            b.c=q.ltp; if(q.ltp>b.h)b.h=q.ltp; if(q.ltp<b.l)b.l=q.ltp;
            price=q.ltp; aggDirty=true; dataVer++; renderHeader(); } } }catch(e){} }));
    apiOK=ok>0; setSrcDot();
    refreshWatch(); refreshStrikes(); refreshPositions(); checkSLTP(); updateAcct();
  }finally{apiPolling=false;} }
setInterval(brokerPoll,3000);

/* ---------- load (NO sim fallback) ---------- */
async function loadSymbol(key){
  key=normKey(key);
  const meta=resolveMeta(key);
  let sd=null;
  if(SRC==='sim'){ sd=await BROKERS.sim.history({},key); apiOK=true; }
  else{
    try{ sd=await activeBroker().history(bcfg(SRC),key); apiOK=true; }
    catch(e){
      apiOK=false; setSrcDot(); clearChart();
      toast(`${BROKERS[SRC].label} data failed: ${e.message} — chart cleared (no SIM fallback)`,'err');
      return; } }
  setSrcDot();
  if(!quotes.has(key))ensureQuote(key);
  quotes.get(key).ltp=sd.price; quotes.get(key).prevClose=sd.prevClose;
  SYM=meta;
  installData(sd);
  pctBase=prevCloseRef();
  if(SYM.type==='OPT')optSide=SYM.optSide;
  applyFnoUI(); updateSymbolUI(); buildWatch(); ensureAtmRow();
  strikeSig=''; refreshStrikes(); refreshPositions(); updateAcct();
  ticketKey=key; $('#tkSym').textContent=SYM.disp;
  $('#tkQty').value=1; updateLotLbl();
  syncTabMeta();
}
function updateLotLbl(){
  const lot=ticketLot();
  $('#lotLbl').textContent=lot>1?'LOT':'SH';
  $('#tkQty').title=lot>1?`lots · 1 lot = ${lot}`:'shares (no lot size)'; }
function updateSymbolUI(){
  if(!SYM)return;
  $('#symName').textContent=SYM.disp;
  $('#symSub').textContent=`${SYM.exch} · ${SYM.type}${SYM.exp?' · '+SYM.exp:''}${SYM.type==='OPT'?' · '+SYM.strike+' '+SYM.optSide:''}`;
  wm1.textContent=SYM.type==='OPT'?SYM.root+' '+SYM.strike:SYM.sym;
  wm2.textContent=`${SYM.disp} · ${SRC==='sim'?'SIM':BROKERS[SRC].label}`;
  document.title=`${SYM.disp} · Scalping Tool`; }

/* ---------- topbar / ticket ---------- */
 $('#loadBtn').addEventListener('click',()=>{ const k=$('#symIn').value.trim();
  if(k)loadSymbol(normKey(k)); });
 $('#symIn').addEventListener('keydown',e=>{ if(e.key==='Enter')$('#loadBtn').click(); });
 $('#addWatchBtn').addEventListener('click',()=>{ if(!SYM)return;
  if(!watch.includes(SYM.key)){watch.push(SYM.key);persistWatch();buildWatch();toast(SYM.disp+' added to watchlist','ok');} });
 $('#tkBuy').addEventListener('click',()=>{
  const key=ticketKey||(SYM&&SYM.key); if(!key)return;
  const lots=Math.max(1,+$('#tkQty').value||1), lot=ticketLot();
  placeKeyOrder(key,1,lots*lot);
  toast(`BUY ${lots}${lot>1?' lot ('+lots*lot+')':''} ${disp(key)} @ ${fmtP(resolveFill(currentPriceOf(key)))}`,'ok'); });
 $('#tkSell').addEventListener('click',()=>{
  const key=ticketKey||(SYM&&SYM.key); if(!key)return;
  const lots=Math.max(1,+$('#tkQty').value||1), lot=ticketLot();
  placeKeyOrder(key,-1,lots*lot);
  toast(`SELL ${lots}${lot>1?' lot ('+lots*lot+')':''} ${disp(key)} @ ${fmtP(resolveFill(currentPriceOf(key)))}`,'ok'); });
 $('#tkFlat').addEventListener('click',()=>{ [...positions].forEach(p=>squareOff(p.id)); });
 $('#ordType').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
  ordType=b.dataset.o;
  $('#ordType').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
  $('#ordPx').style.display=ordType==='LMT'?'':'none';
  if(ordType==='LMT'){ const key=ticketKey||(SYM&&SYM.key);
    $('#ordPx').value=key?currentPriceOf(key).toFixed(2):''; } }));
document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('on',x===b));
  $('#tblPos').style.display=b.dataset.t==='pos'?'':'none';
  $('#tblTrd').style.display=b.dataset.t==='trd'?'':'none'; }));
 $('#botMin').addEventListener('click',()=>{ const bd=$('#bottom'); bd.classList.toggle('min');
  $('#botMin').textContent=bd.classList.contains('min')?'▴':'▾'; });

/* ---------- settings ---------- */
 $('#setBtn').addEventListener('click',()=>{
  const b=activeBroker();
  $('#setTitle').textContent=b.label+' · SETTINGS';
  $('#setWarn').style.display=SRC==='sim'?'none':'';
  const f=$('#bkFields'); f.innerHTML='';
  b.fields.forEach(fd=>{
    const l=document.createElement('label');l.textContent=fd.l;
    const i=document.createElement('input');i.type=(fd.k==='pwd'||fd.k==='key'||fd.k==='secret')?'password':'text';
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
  updateAcct(); refreshStrikes(); toast('settings saved — reload the symbol to pull broker data','ok'); });
 $('#setTest').addEventListener('click',async()=>{
  const b=activeBroker();
  document.querySelectorAll('#bkFields input').forEach(i=>{bcfg(b.id)[i.dataset.bk]=i.value.trim();});
  saveCfg();
  try{ await b.test(bcfg(b.id)); toast(b.label+' reachable ✓','ok'); }
  catch(e){ toast('TEST failed: '+e.message,'err'); } });

/* ---------- chart tabs ---------- */
let tabs=[{id:'t1',key:null,title:'—',state:null}], activeTab='t1', tabSeq=2;
function shortTitle(key){ const m=resolveMeta(key);
  if(m.type==='OPT')return m.root+' '+m.strike+m.optSide;
  if(m.type==='FUT')return m.root+' F';
  return m.sym; }
function closeTab(id){ if(tabs.length<=1)return;
  const i=tabs.findIndex(t=>t.id===id); if(i<0)return;
  const was=activeTab===id;
  tabs.splice(i,1);
  if(was)switchTab(tabs[Math.max(0,i-1)].id); else renderTabs(); }
function snapshotTab(){ const t=tabs.find(x=>x.id===activeTab); if(!t)return;
  t.state={bars:bars.map(b=>({...b})),dayLbl:[...dayLbl],price,lastPrice,liveDrift,
    view:{r:view.r,v:view.v},tf,ghostOn,ghostStyle,drawings,uidC,undo:undoStack.slice(),
    selId,pctBase,pMode,mLo,mHi,pzR0,bornGM,bornAt,switchT0,directScale};
  t.key=SYM?SYM.key:null; t.title=t.key?shortTitle(t.key):'—'; }
function restoreTab(t){
  activeTab=t.id;
  const s=t.state;
  if(!s||!s.bars.length){ renderTabs(); loadSymbol(t.key||(SYM?SYM.key:'NSE:NIFTY')); return; }
  bars.length=0; for(const b of s.bars)bars.push(b);
  dayLbl.length=0; for(const d of s.dayLbl)dayLbl.push(d);
  price=s.price; lastPrice=s.lastPrice||s.price; liveDrift=s.liveDrift||0;
  view.r=s.view.r; view.v=s.view.v; viewAnim=null;
  tf=s.tf; ghostOn=s.ghostOn; ghostStyle=s.ghostStyle;
  drawings=s.drawings; uidC=s.uidC;
  undoStack.length=0; for(const u of s.undo)undoStack.push(u);
  selId=s.selId; pending=null;
  pctBase=s.pctBase||prevCloseRef(); pMode=s.pMode; mLo=s.mLo; mHi=s.mHi; pzR0=s.pzR0;
  bornGM=s.bornGM; bornAt=s.bornAt||0; switchT0=s.switchT0||performance.now();
  directScale=s.directScale||false; vBase=null; axisDrag=null; baseDrag=false;
  aggDirty=true; aggCache.clear(); dataVer++;
  fvgCache={ver:-1,list:[]}; indCache={tf:-1,ver:-1,d:null};
  yLo=yHi=null; volMax=volMax1=null;
  SYM=t.key?resolveMeta(t.key):null;
  renderTabs();
  tfSeg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',+b.dataset.tf===tf));
  ghostToggle.classList.toggle('on',ghostOn);
  ghostCtl.classList.toggle('dis',tf===1);
  styleSeg.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.s===ghostStyle));
  applyFnoUI(); updateSymbolUI(); updateLotLbl(); strikeSig=''; refreshStrikes(); refreshPositions();
  ticketKey=t.key||null; $('#tkSym').textContent=SYM?SYM.disp:'—'; }
function switchTab(id){ if(id===activeTab)return;
  snapshotTab(); restoreTab(tabs.find(t=>t.id===id)); }
function renderTabs(){ const c=$('#ctabs'); c.innerHTML='';
  tabs.forEach(t=>{ const d=document.createElement('div');
    d.className='ctab'+(t.id===activeTab?' on':'');
    d.innerHTML=`<span>${t.title}</span>${tabs.length>1?'<span class="x">✕</span>':''}`;
    d.addEventListener('click',e=>{ if(e.target.classList.contains('x'))closeTab(t.id);
      else if(t.id!==activeTab)switchTab(t.id); });
    c.appendChild(d); });
  const add=document.createElement('div');add.className='ctab add';add.textContent='+ chart';
  add.addEventListener('click',()=>{ snapshotTab();
    const t={id:'t'+(tabSeq++),key:null,title:'—',state:null};
    tabs.push(t); restoreTab(t); });
  c.appendChild(add); }
function syncTabMeta(){ const t=tabs.find(x=>x.id===activeTab); if(!t)return;
  t.key=SYM?SYM.key:null; t.title=t.key?shortTitle(t.key):'—'; renderTabs(); }

/* ---------- boot ---------- */
buildSrcSeg(); setSrcDot();
buildExpSel(); buildToolbar(); setTool('cursor');
syncDefaults(); renderTabs(); buildWatch();
 $('#defLots').value=CFG.defLots||1;
loadSymbol('NSE:NIFTY');
setTF(5); refreshPositions(); updateAcct();
const sclPop=popWire('#sclBtn','#sclPop');
function syncScales(){ sclPop.querySelectorAll('input').forEach(cb=>cb.checked=!!scales[cb.dataset.scale]); }
function ensureScale(){ if(!SORDER.some(s=>scales[s]))scales.price=true; syncScales(); }
sclPop.querySelectorAll('input').forEach(cb=>cb.addEventListener('change',()=>{
  scales[cb.dataset.scale]=cb.checked; ensureScale(); }));
const indPop=popWire('#indBtn','#indPop');
indPop.querySelectorAll('input').forEach(cb=>cb.addEventListener('change',()=>{
  PANE_DEFS.find(p=>p.id===cb.dataset.pane).on=cb.checked; }));
syncScales();
requestAnimationFrame(frame);
