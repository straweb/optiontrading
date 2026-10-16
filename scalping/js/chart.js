'use strict';
/* chart engine — candles, ghosts, scales, overlays, panes, interactions */
const COL={bg:'#0a0c10',grid:'rgba(255,255,255,.045)',gridStrong:'rgba(255,255,255,.11)',
  ink:'#d6dae0',dim:'#8b95a1',up:'#2fbf7f',dn:'#e5484d',acc:'#e0a63f'};
const AXIS_W=92, MCOLW=40, TIME_H=26;
let tf=5, ghostOn=true, ghostStyle='hollow', paused=false;
let fvgOn=true, vwOn=true;
const bars=[], dayLbl=[];
let price=0, lastPrice=0, liveDrift=0, dataVer=0;
let bornGM=-1, bornAt=0, switchT0=performance.now();
const prevCloseRef=()=>{const day=Math.floor((bars.length-1)/SESSION);return day>0?bars[day*SESSION-1].c:bars[0].o;};
let aggDirty=true; const aggCache=new Map();
function buildAgg(t){
  const arr=[], n=Math.ceil(bars.length/t);
  for(let b=0;b<n;b++){
    const g0=b*t, g1=Math.min(g0+t,bars.length);
    let h=-1e18,l=1e18,v=0;
    for(let g=g0;g<g1;g++){const x=bars[g]; if(x.h>h)h=x.h; if(x.l<l)l=x.l; v+=x.v;}
    arr.push({g0,g1,o:bars[g0].o,h,l,c:bars[g1-1].c,v});
  }
  return arr;
}
function getAgg(t){ if(aggDirty){aggCache.clear();aggDirty=false;} if(!aggCache.has(t))aggCache.set(t,buildAgg(t)); return aggCache.get(t); }
let indCache={tf:-1,ver:-1,d:null};
function getInd(){ if(indCache.tf===tf&&indCache.ver===dataVer&&indCache.d)return indCache.d;
  const A=getAgg(tf);const c=A.map(k=>k.c),h=A.map(k=>k.h),l=A.map(k=>k.l);
  const d={rsi:rsiArr(c,14),macd:macdArr(c),adx:adxArr(h,l,c,14)};
  indCache={tf,ver:dataVer,d};return d;}
const view={r:400,v:260};
let viewAnim=null;
function animateView(tr,tv){viewAnim={t0:performance.now(),dur:520,fr:view.r,fv:view.v,tr,tv};}
const clampR=r=>{const hi=bars.length+90;return clamp(r,Math.min(view.v-30,hi),hi);};
let pMode='auto', mLo=0, mHi=1, pzR0=1;
const scales={price:true,pct:true,inv:false,pts:false};
const SORDER=['price','pct','inv','pts'];
const primScale=()=>SORDER.find(s=>scales[s])||'price';
const anyRel=()=>scales.pct||scales.inv||scales.pts;
let pctBase=null, baseDrag=false, directScale=false;
function enterManual(){ if(pMode==='manual'||yLo==null)return;
  pMode='manual'; mLo=yLo; mHi=yHi; pzR0=Math.max(1e-9,yHi-yLo); }
function priceAuto(){ pMode='auto'; }
function priceZoomAt(ypix,k){
  if(!geo.priceH)return; const R=yHi-yLo; if(!(R>0))return;
  enterManual(); if(pMode!=='manual')return;
  const pc=priceAtY(ypix);
  const nR=clamp((mHi-mLo)*k, price*0.0006, price*1.5);
  const kk=nR/(mHi-mLo);
  mHi=pc+(mHi-pc)*kk; mLo=pc-(pc-mLo)*kk; }
function resetAll(){ animateView(bars.length+42,260); priceAuto(); }
const pctOf=p=>(p-pctBase)/pctBase*100;
function labelPct(v){ const s=v>=0?'+':'−', a=Math.abs(v);
  return s+(a>=100?a.toFixed(0):a>=10?a.toFixed(1):a.toFixed(2))+'%'; }
function labelPts(v){ const s=v>=0?'+':'−', a=Math.abs(v);
  return s+(a>=1000?a.toFixed(0):a>=100?a.toFixed(1):a.toFixed(2)); }
function scaleLabel(s,p){
  if(s==='price')return fmtP(p);
  if(s==='pts')return labelPts(p-pctBase);
  const v=pctOf(p); return labelPct(s==='inv'?-v:v); }
function priceAtY(y){ return yHi-(y/geo.priceH)*(yHi-yLo); }
function fmtDur(dmin){dmin=Math.max(0,Math.round(dmin));
  const d=Math.floor(dmin/375),r=dmin%375,h=Math.floor(r/60),m=r%60;
  if(d>0)return d+'d'+(h?' '+h+'h':'');
  if(h>0)return h+'h'+(m?' '+m+'m':'');
  return m+'m';}
const MONO='"IBM Plex Mono", monospace';
const PCT_STEPS2=PCT_STEPS, PTS_STEPS2=PTS_STEPS;
const cv=document.querySelector('#chart'), ctx=cv.getContext('2d');
let W=0,H=0,dpr=1;
function resize(){dpr=window.devicePixelRatio||1;W=cv.clientWidth;H=cv.clientHeight;cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);}
new ResizeObserver(resize).observe(document.querySelector('#wrap')); resize();
const geo={sp:0,plotW:1,priceH:1,volH:1,volBot:1,X:x=>x,Y:y=>y,yLo:0,yHi:1,badge:null,addBtn:null};
let mouse={x:0,y:0,in:false}, dragging=false, dragX=0, dragR=0, dragY0=0, vBase=null;
let axisDrag=null, suppressUp=false;
let tool='cursor', pending=null, selId=null, drag=null, downPt=null;
let drawings=[], uidC=1;
const undoStack=[];
function pushUndo(){undoStack.push(drawings.slice());if(undoStack.length>80)undoStack.shift();}
function dataAt(x,y){ if(!geo.sp)return{gm:0,p:0};
  const yy=clamp(y,0,Math.max(1,geo.priceH-1));
  return {gm:view.r-(geo.plotW-x)/geo.sp, p:yHi-(yy/geo.priceH)*(yHi-yLo)}; }
function snap(d){return JSON.parse(JSON.stringify(d));}
function finishD(d){d.id=uidC++;pushUndo();drawings.push(d);selId=d.id;setTool('cursor');}
let axisTags=[];
function line(x1,y1,x2,y2){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
function rr(x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function pill(x,y,w,h,txt){ctx.fillStyle='#171c23';ctx.strokeStyle='rgba(255,255,255,.16)';
  rr(x,y,w,h,4);ctx.fill();ctx.stroke();
  ctx.fillStyle=COL.ink;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(txt,x+w/2,y+h/2+0.5);}
function tick(){
  const b=bars[bars.length-1], m=(bars.length-1)%SESSION;
  const smile=1+1.2*Math.exp(-m/45)+0.8*Math.exp(-(SESSION-m)/55);
  const step=price*0.00042*smile*0.36;
  const nc=b.c+liveDrift*price*0.3+gauss()*step;
  b.c=nc; if(nc>b.h)b.h=nc; if(nc<b.l)b.l=nc;
  b.v+=Math.round(50+rng()*180);
  price=nc; aggDirty=true; dataVer++; renderHeader(); }
function newBar(){
  const last=bars[bars.length-1];
  let o;
  if(bars.length%SESSION===0){
    dayLbl.push(fmtDate(new Date(Date.now()+864e5)));
    o=last.c*(1+gauss()*0.0011);
    liveDrift=(rng()-0.48)*0.0009;
  }else{
    if(rng()<0.05)liveDrift=(rng()-0.48)*0.0011;
    o=last.c; }
  bars.push({o,h:o,l:o,c:o,v:Math.round(300+rng()*350)});
  bornGM=bars.length-1; bornAt=performance.now();
  aggDirty=true; dataVer++; }
function installData(sd){
  bars.length=0; for(const b of sd.bars)bars.push(b);
  dayLbl.length=0; for(const d of sd.dayLbl)dayLbl.push(d);
  price=sd.price; liveDrift=0; bornGM=-1;
  aggDirty=true; aggCache.clear(); dataVer++;
  fvgCache={ver:-1,list:[]}; indCache={tf:-1,ver:-1,d:null};
  yLo=yHi=null; volMax=volMax1=null;
  view.r=bars.length+42; view.v=Math.min(260,Math.max(60,bars.length)); viewAnim=null;
  selId=null; pending=null; drawings=[]; undoStack.length=0;
  directScale=false; vBase=null; pMode='auto';
  switchT0=performance.now();
}
function clearChart(){
  bars.length=0; dayLbl.length=0; price=0; lastPrice=0; liveDrift=0; bornGM=-1;
  aggDirty=true; aggCache.clear(); dataVer++;
  fvgCache={ver:-1,list:[]}; indCache={tf:-1,ver:-1,d:null};
  yLo=yHi=null; volMax=volMax1=null; viewAnim=null; }
/* header DOM */
const tfSeg=document.querySelector('#tfSeg'), ghostCtl=document.querySelector('#ghostCtl');
const ltpEl=document.querySelector('#ltp'),chgEl=document.querySelector('#chg'),liveEl=document.querySelector('#live'),liveTxt=document.querySelector('#liveTxt');
const lgTf=document.querySelector('#lgTf'),lgO=document.querySelector('#lgO'),lgH=document.querySelector('#lgH'),lgL=document.querySelector('#lgL'),lgC=document.querySelector('#lgC'),lgChg=document.querySelector('#lgChg'),lgV=document.querySelector('#lgV'),lgRow2=document.querySelector('#lgRow2');
const wm1=document.querySelector('#wm1'),wm2=document.querySelector('#wm2'),latestBtn=document.querySelector('#latestBtn');
const ghostToggle=document.querySelector('#ghostToggle'),styleSeg=document.querySelector('#styleSeg');
function renderHeader(){
  if(!bars.length)return;
  ltpEl.textContent=fmtP(price);
  const pc=prevCloseRef(),d=price-pc;
  chgEl.textContent=`${d>=0?'+':'−'}${fmtP(Math.abs(d))} · ${d>=0?'+':'−'}${Math.abs(d/pc*100).toFixed(2)}%`;
  chgEl.className='chg '+(d>=0?'up':'dn');
  if(SYM){ const q=quotes.get(SYM.key); if(q)q.ltp=price; } }
function flashHeader(){
  renderHeader();
  ltpEl.style.color=price>=lastPrice?COL.up:COL.dn;
  setTimeout(()=>ltpEl.style.color='',260);
  lastPrice=price; }
function setTF(t){
  if(t===tf)return; tf=t; switchT0=performance.now();
  tfSeg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',+b.dataset.tf===t));
  ghostCtl.classList.toggle('dis',t===1);
  wm2.textContent=`${SYM?SYM.disp:''} · ${t}m`; }
tfSeg.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>setTF(+b.dataset.tf)));
ghostToggle.addEventListener('click',()=>{ ghostOn=!ghostOn; ghostToggle.classList.toggle('on',ghostOn); switchT0=performance.now(); });
styleSeg.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
  ghostStyle=b.dataset.s; switchT0=performance.now();
  styleSeg.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); }));
document.querySelector('#pauseBtn').addEventListener('click',()=>{
  paused=!paused;
  document.querySelector('#icPause').style.display=paused?'none':'block';
  document.querySelector('#icPlay').style.display=paused?'block':'none';
  liveEl.classList.toggle('paused',paused);
  liveTxt.textContent=paused?'PAUSED':'LIVE'; });
document.querySelector('#resetBtn').addEventListener('click',resetAll);
latestBtn.addEventListener('click',()=>animateView(bars.length+42,260));
document.querySelector('#ovSeg').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
  if(b.dataset.o==='fvg'){fvgOn=!fvgOn;b.classList.toggle('on',fvgOn);}
  else{vwOn=!vwOn;b.classList.toggle('on',vwOn);} }));
const fmtHM=gm=>{const m=((gm%SESSION)+SESSION)%SESSION,t=OPEN_MIN+m;
  return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');};
const fmtEnd=gm=>gm%SESSION===0?'15:30':fmtHM(gm);
let yLo=null,yHi=null,volMax=null,volMax1=null;
const inBtn=(mx,my,b)=>b&&mx>=b.x&&mx<=b.x+b.w&&my>=b.y&&my<=b.y+b.h;
const nearBaseline=(mx,my)=>anyRel()&&pctBase!=null&&geo.priceH&&mx<=geo.plotW&&
  my>=0&&my<=geo.priceH&&Math.abs(my-geo.Y(pctBase))<6;
function setCursor(c){ if(cv.style.cursor!==c)cv.style.cursor=c; }
function updateCursorStyle(mx,my){
  const hit=hitTopmost(mx,my);
  setCursor(hit?(hit.h?'pointer':'move'):'crosshair'); }
cv.addEventListener('pointerdown',e=>{
  e.preventDefault(); viewAnim=null;
  const mx=e.offsetX,my=e.offsetY;
  if(inBtn(mx,my,geo.addBtn)){ axMenuOpen?closeAxMenu():openAxMenu(); return; }
  if(axMenuOpen){ closeAxMenu(); return; }
  if(inBtn(mx,my,geo.badge)){ if(pMode==='manual')priceAuto(); return; }
  if(placing&&mx<geo.plotW&&my<=geo.priceH){ downPt={x:mx,y:my}; cv.setPointerCapture(e.pointerId); return; }
  if(mx>=geo.plotW||my>=H-TIME_H){
    if(!pending&&yLo!==null){
      suppressUp=true;cv.classList.add('grabbing');cv.setPointerCapture(e.pointerId);
      if(mx>=geo.plotW){
        if(anyRel()&&mx<geo.plotW+MCOLW) axisDrag={type:'base',base0:pctBase,py0:priceAtY(my)};
        else{ enterManual(); axisDrag={type:'price',y0:my,lo:mLo,hi:mHi,R:(mHi-mLo)||1}; }
      }else axisDrag={type:'time',x0:mx,r0:view.r}; }
    return; }
  if(tool==='cursor'){
    const hit=hitTopmost(mx,my);
    if(hit){ selId=hit.d.id; pushUndo();
      drag={d:hit.d,h:hit.h||null,ox:mx,oy:my,orig:snap(hit.d),moved:false};
    }else if(nearBaseline(mx,my)){ baseDrag=true;
    }else{ selId=null; dragging=true; dragX=mx; dragY0=my; dragR=view.r; vBase=null; }
    cv.classList.add('grabbing'); cv.setPointerCapture(e.pointerId); return; }
  if(tool==='free'){ pending={type:'free',pts:[dataAt(mx,my)],_lx:mx,_ly:my};
    cv.setPointerCapture(e.pointerId); return; }
  if(['text','comment','pin','pricenote','table','hline','hray','long','short'].includes(tool)){
    downPt={x:mx,y:my}; cv.setPointerCapture(e.pointerId); return; }
  if(NPTS[tool]){
    const md=dataAt(mx,my), k=NPTS[tool];
    if(pending&&pending.type===tool&&pending.n<k){
      pending.pts[pending.n]=md; pending.n++;
      if(pending.n>=k) commitPending();
    }else if(!pending||pending.type!==tool) pending={type:tool,pts:Array(k).fill(md),n:1};
    chipTxt();
    cv.setPointerCapture(e.pointerId); } });
cv.addEventListener('pointermove',e=>{
  const mx=e.offsetX,my=e.offsetY;
  mouse.x=mx;mouse.y=my;mouse.in=true;
  if(baseDrag){ pctBase=clamp(priceAtY(my),price*0.2,price*5); return; }
  if(axisDrag){
    if(axisDrag.type==='price'){ const d=(my-axisDrag.y0)/geo.priceH*axisDrag.R;
      mLo=axisDrag.lo+d; mHi=axisDrag.hi+d; }
    else if(axisDrag.type==='base') pctBase=clamp(axisDrag.base0+(priceAtY(my)-axisDrag.py0),price*0.2,price*5);
    else view.r=clampR(axisDrag.r0-(mx-axisDrag.x0)/geo.sp);
    return; }
  if(drag&&drag.d){
    if(drag.h){ applyHandle(drag.d,drag.h,dataAt(mx,my)); drag.moved=true; }
    else{ const dgm=(mx-drag.ox)/geo.sp, dp=-(my-drag.oy)/geo.priceH*(yHi-yLo);
      if(applyMove(drag.d,drag.orig,dgm,dp))drag.moved=true; }
    return; }
  if(dragging){
    view.r=clampR(dragR-(mx-dragX)/geo.sp);
    const dy=my-dragY0;
    if(Math.abs(dy)>2){
      if(!vBase){ if(pMode!=='manual')enterManual(); vBase={lo:mLo,hi:mHi,R:(mHi-mLo)||1}; }
      const s=dy*vBase.R/geo.priceH;
      mLo=vBase.lo+s; mHi=vBase.hi+s; directScale=true; }
    return; }
  if(tool==='free'&&pending){
    if(Math.hypot(mx-pending._lx,my-pending._ly)>3){ pending.pts.push(dataAt(mx,my));pending._lx=mx;pending._ly=my; }
    return; }
  if(pending&&NPTS[pending.type]&&pending.n<NPTS[pending.type]) pending.pts[pending.n]=dataAt(mx,my);
  if(inBtn(mx,my,geo.addBtn)||inBtn(mx,my,geo.badge))setCursor('pointer');
  else if(mx>=geo.plotW)setCursor('ns-resize');
  else if(my>=H-TIME_H)setCursor('ew-resize');
  else if(tool==='cursor'){
    if(placing||nearBaseline(mx,my))setCursor(placing?'crosshair':'ns-resize');
    else updateCursorStyle(mx,my);
  }else setCursor('crosshair'); });
cv.addEventListener('pointerup',e=>{
  if(suppressUp){suppressUp=false;axisDrag=null;cv.classList.remove('grabbing');return;}
  const mx=e.offsetX,my=e.offsetY;
  if(baseDrag){ baseDrag=false; cv.classList.remove('grabbing'); return; }
  if(drag){ if(!drag.moved)undoStack.pop(); drag=null; cv.classList.remove('grabbing'); return; }
  if(dragging){ dragging=false;vBase=null;directScale=false;cv.classList.remove('grabbing'); return; }
  if(placing){ if(downPt&&Math.hypot(mx-downPt.x,my-downPt.y)<6) placeAt(dataAt(mx,my));
    else cancelPlacing(); downPt=null; return; }
  if(tool==='free'&&pending){ if(pending.pts.length>1)finishD({type:'free',pts:pending.pts}); pending=null; return; }
  if(downPt){
    if(Math.hypot(mx-downPt.x,my-downPt.y)<6){
      const md=dataAt(mx,my);
      if(tool==='hline')finishD({type:'hline',pts:[md]});
      else if(tool==='hray')finishD({type:'hray',pts:[md]});
      else if(tool==='long'||tool==='short'){
        const dir=tool==='long'?1:-1, pE=md.p;
        finishD({type:'pos',dir,gm0:clamp(md.gm-40,0,bars.length),
          gm1:clamp(md.gm+40,0,bars.length+240),pE,
          pS:dir>0?pE*0.996:pE*1.004,pT:dir>0?pE*1.008:pE*0.992}); }
      else if(tool==='text') openText(md,null,'');
      else if(tool==='comment') openText(md,null,'note');
      else if(tool==='pin') openText(md,null,'');
      else if(tool==='pricenote') openText(md,null,'');
      else if(tool==='table') openText(md,null,'COL1 | COL2 ;A | B'),txtCtx.kind='table'; }
    downPt=null; return; }
  if(pending&&NPTS[pending.type]===2&&pending.n===1){
    const a=pending.pts[0];
    if(Math.hypot(mx-geo.X(a.gm),my-geo.Y(a.p))>24){ pending.pts[1]=dataAt(mx,my); pending.n=2; commitPending(); } } });
function commitPending(){
  const d=pending; pending=null; chipTxt();
  if(!d)return;
  const P=d.pts;
  if(d.type==='vprofile'||d.type==='vbs'){
    const gm0=Math.min(P[0].gm,P[1].gm),gm1=Math.max(P[0].gm,P[1].gm);
    if(gm1-gm0<3){setTool('cursor');return;}
    d.pts=[{gm:gm0,p:0},{gm:gm1,p:0}];
  }else{
    if(P.every(q=>Math.abs(q.gm-P[0].gm)<1e-6&&Math.abs(q.p-P[0].p)<1e-9)){setTool('cursor');return;}
    if(['fib','fibext','fan','pricerange','pricedate','forecast'].includes(d.type)&&Math.abs(P[0].p-P[1].p)<1e-9){setTool('cursor');return;}
    if(['daterange','tzones'].includes(d.type)&&Math.abs(P[0].gm-P[1].gm)<1e-6){setTool('cursor');return;} }
  finishD(d); }
cv.addEventListener('pointercancel',()=>{drag=null;dragging=false;downPt=null;axisDrag=null;suppressUp=false;baseDrag=false;vBase=null;directScale=false;cancelPlacing();cv.classList.remove('grabbing');});
cv.addEventListener('pointerleave',()=>{mouse.in=false;});
cv.addEventListener('wheel',e=>{
  e.preventDefault(); if(!geo.sp)return; viewAnim=null;
  const x=e.offsetX,y=e.offsetY;
  if(x>=geo.plotW||e.altKey){
    if(anyRel()&&x<geo.plotW+MCOLW&&!e.altKey){
      pctBase=clamp(pctBase-(yHi-yLo)/geo.priceH*0.22*e.deltaY,price*0.2,price*5); return; }
    priceZoomAt(y,Math.exp(e.deltaY*0.0012)); return; }
  if(y>=H-TIME_H){
    const t=view.r-(geo.plotW-x)/geo.sp;
    const nv=clamp(view.v*Math.exp(e.deltaY*0.0011),40,2400);
    view.r=clampR(t+(geo.plotW-x)/(geo.plotW/nv)); view.v=nv; return; }
  if(e.shiftKey){view.r=clampR(view.r+(e.deltaY+e.deltaX)*0.6/geo.sp);return;}
  const anchor=view.r-(geo.plotW-x)/geo.sp;
  const nv=clamp(view.v*Math.exp(e.deltaY*0.0011),40,2400);
  view.r=clampR(anchor+(geo.plotW-x)/(geo.plotW/nv)); view.v=nv; },{passive:false});
cv.addEventListener('dblclick',e=>{
  const x=e.offsetX,y=e.offsetY;
  if(x>=geo.plotW){
    if(anyRel()&&x<geo.plotW+MCOLW){ pctBase=bars[clamp(Math.floor(view.r-view.v),0,bars.length-1)].c; return; }
    priceAuto(); return; }
  if(y>=H-TIME_H){ animateView(bars.length+42,260); return; }
  if(nearBaseline(x,y)){ pctBase=bars[clamp(Math.floor(view.r-view.v),0,bars.length-1)].c; return; }
  if(tool==='cursor'&&!pending){
    const hit=hitTopmost(e.offsetX,e.offsetY);
    if(hit&&EDITABLE.has(hit.d.type)){
      const d=hit.d;
      openText(d.pts[0],d,d.type==='table'?d.rows.map(r=>r.join(' | ')).join(' ; '):(d.text||''));
      return; } }
  resetAll(); });
cv.addEventListener('contextmenu',e=>{
  e.preventDefault();
  if(txtCtx){closeText(false);return;}
  if(flyEl){closeFly();return;}
  if(axMenuOpen){closeAxMenu();return;}
  if(placing){cancelPlacing();return;}
  if(pending){pending=null;chipTxt();}
  else if(tool!=='cursor')setTool('cursor');
  else selId=null; });
const txtIn=document.querySelector('#txtIn'); let txtCtx=null;
function openText(md,editD,val){
  txtCtx={pt:md,editD:editD||null};
  txtIn.style.display='block';
  txtIn.style.left=clamp(geo.X(md.gm),4,geo.plotW-210)+'px';
  txtIn.style.top=clamp(geo.Y(md.p)+(editD?-30:8),4,H-44)+'px';
  txtIn.value=val||'';txtIn.focus();txtIn.select(); }
function closeText(commit){
  if(!txtCtx)return; const v=txtIn.value.trim();
  if(commit&&v){
    if(txtCtx.editD){ pushUndo(); const d=txtCtx.editD;
      if(d.type==='table'){ const rows=v.split(';').map(r=>r.split('|').map(c=>c.trim())).filter(r=>r.length&&r.some(c=>c));
        if(rows.length)d.rows=rows; }
      else d.text=v; }
    else if(txtCtx.kind==='table') finishD({type:'table',pts:[txtCtx.pt],
      rows:v.split(';').map(r=>r.split('|').map(c=>c.trim()))});
    else if(txtCtx.kind) finishD({type:txtCtx.kind,pts:[txtCtx.pt],text:v});
    else finishD({type:'text',pts:[txtCtx.pt],text:v}); }
  txtIn.style.display='none';txtCtx=null; }
txtIn.addEventListener('keydown',e=>{ e.stopPropagation();
  if(e.key==='Enter')closeText(true); else if(e.key==='Escape')closeText(false); });
txtIn.addEventListener('blur',()=>closeText(false));
addEventListener('keydown',e=>{
  if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='SELECT'))return;
  if(e.key==='1')setTF(1); else if(e.key==='2')setTF(3);
  else if(e.key==='3')setTF(5); else if(e.key==='4')setTF(15);
  else if(e.key==='g'||e.key==='G'){if(tf>1)ghostToggle.click();}
  else if(e.key===' '){e.preventDefault();document.querySelector('#pauseBtn').click();}
  else if(e.key==='a'||e.key==='A')priceAuto();
  else if(e.key==='p'||e.key==='P'){scales.pct=!scales.pct;ensureScale();}
  else if(e.key==='i'||e.key==='I'){scales.inv=!scales.inv;ensureScale();}
  else if(e.key==='t'||e.key==='T'){scales.pts=!scales.pts;ensureScale();}
  else if(e.key==='r'||e.key==='R')resetAll();
  else if(e.key==='Escape'){
    if(txtCtx)closeText(false);
    else if(flyEl)closeFly();
    else if(axMenuOpen)closeAxMenu();
    else if(placing)cancelPlacing();
    else if(pending){pending=null;chipTxt();}
    else if(tool!=='cursor')setTool('cursor');
    else selId=null; }
  else if((e.key==='Delete'||e.key==='Backspace')&&selId!=null){
    pushUndo();drawings=drawings.filter(d=>d.id!==selId);selId=null; }
  else if((e.key==='z'||e.key==='Z')&&(e.ctrlKey||e.metaKey)){
    e.preventDefault();
    if(undoStack.length){drawings=undoStack.pop();selId=null;pending=null;chipTxt();} } });
/* axis menus */
const axMenu=document.querySelector('#axMenu');
let placing=null, axMenuOpen=false;
function openAxMenu(){ axMenu.style.left=Math.max(4,W-180)+'px'; axMenu.style.top='24px';
  axMenu.hidden=false; axMenuOpen=true; }
function closeAxMenu(){ axMenu.hidden=true; axMenuOpen=false; }
function chipPlacing(){
  if(!placing){toolChip.style.display='none';return;}
  toolChip.textContent={buy:'BUY MARKER — click a price level · ESC cancels',
    sell:'SELL MARKER — click a price level · ESC cancels',
    base:'SET BASELINE — click a price to anchor 0 · ESC cancels'}[placing];
  toolChip.style.display='block'; }
function startPlacing(kind){
  if(kind==='base'&&!anyRel()){ scales.pct=true; ensureScale(); }
  placing=kind; closeAxMenu(); chipPlacing(); }
function cancelPlacing(){ if(!placing)return; placing=null; chipPlacing(); }
function placeAt(md){
  if(placing==='buy'||placing==='sell')
    finishD({type:'mark',side:placing,pts:[{gm:md.gm,p:md.p}]});
  else if(placing==='base') pctBase=clamp(md.p,price*0.2,price*5);
  placing=null; chipPlacing(); }
axMenu.querySelectorAll('button').forEach(b=>
  b.addEventListener('click',e=>{e.stopPropagation();startPlacing(b.dataset.act);}));
document.addEventListener('click',e=>{
  if(axMenuOpen&&!axMenu.contains(e.target)&&e.target!==cv)closeAxMenu(); });
/* ===== render loop ===== */
function frame(now){
  requestAnimationFrame(frame);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle=COL.bg; ctx.fillRect(0,0,W,H);
  if(W<60||H<60)return;
  if(!bars.length){
    ctx.fillStyle='rgba(214,218,224,.28)'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font='700 15px '+MONO; ctx.fillText('NO DATA',W/2,H/2-14);
    ctx.font='500 10.5px '+MONO; ctx.fillStyle='rgba(214,218,224,.14)';
    ctx.fillText(SRC!=='sim'?(BROKERS[SRC].label+' · configure ⚙ or load a symbol'):'load a symbol from the top bar',W/2,H/2+10);
    return; }
  // if(W<60||H<60||!bars.length)return;
  const plotW=W-AXIS_W, plotH=H-TIME_H;
  const volH=Math.max(30,plotH*0.15);
  const act=PANE_DEFS.filter(p=>p.on);
  let PH=0;
  if(act.length){ PH=clamp(Math.round((plotH-volH)*0.16),54,120);
    const avail=plotH-volH-150;
    if(act.length*PH>avail)PH=Math.max(36,Math.floor(avail/act.length)); }
  let indH=PH*act.length;
  const avail2=plotH-volH-120;
  if(indH>avail2){ indH=Math.max(0,avail2); PH=act.length?indH/act.length:0; }
  const priceH=Math.max(120,plotH-volH-indH);
  const volBot=priceH+volH;
  if(viewAnim){const p=Math.min(1,(now-viewAnim.t0)/viewAnim.dur),e=easeOut(p);
    view.r=lerp(viewAnim.fr,viewAnim.tr,e);view.v=lerp(viewAnim.fv,viewAnim.tv,e);
    if(p>=1)viewAnim=null;}
  const sp=plotW/view.v;
  const agg=getAgg(tf), leftGM=view.r-view.v;
  const effGhost=ghostOn&&tf>1;
  const gmAt=view.r-(plotW-mouse.x)/sp;
  const inPlot=mouse.in&&!dragging&&!drag&&!axisDrag&&!baseDrag&&mouse.x>=0&&mouse.x<=plotW&&mouse.y>=0&&mouse.y<=plotH;
  const sb=inPlot?clamp(Math.floor(gmAt/tf),0,agg.length-1):-1;
  const gi=(tf>1&&sb>=0)?clamp(Math.floor(gmAt),0,bars.length-1):-1;
  const la=clamp((sp-1.5)/1.8,0,1);
  const gw=Math.max(1.2,sp*0.46);
  const bp=easeOut(clamp((now-switchT0)/420,0,1));
  const gA=Math.max(0,Math.floor(leftGM)), gB=Math.min(bars.length-1,Math.ceil(view.r));
  let lo=1e18,hi=-1e18,vmax=0,vmax1=0;
  for(let g=gA;g<=gB;g++){const x=bars[g];if(x.l<lo)lo=x.l;if(x.h>hi)hi=x.h;if(effGhost&&x.v>vmax1)vmax1=x.v;}
  const b0=Math.max(0,Math.floor(leftGM/tf)), b1=Math.min(agg.length-1,Math.floor(view.r/tf));
  for(let b=b0;b<=b1;b++){if(agg[b].v>vmax)vmax=agg[b].v;}
  const manual=pMode==='manual';
  const direct=directScale||(axisDrag&&axisDrag.type==='price');
  const pad=(hi-lo)*0.08+price*0.0003;
  const tLo=manual?mLo:lo-pad, tHi=manual?mHi:hi+pad;
  if(yLo===null){yLo=tLo;yHi=tHi;volMax=vmax||1;volMax1=vmax1||1;}
  else{const sm=manual?(direct?1:0.5):0.22;
    yLo+=(tLo-yLo)*sm;yHi+=(tHi-yHi)*sm;
    volMax+=((vmax||1)-volMax)*0.22;volMax1+=((vmax1||1)-volMax1)*0.22;}
  const Y=p=>(1-(p-yLo)/(yHi-yLo))*priceH;
  const X=gm=>plotW-(view.r-gm)*sp;
  geo.sp=sp;geo.plotW=plotW;geo.priceH=priceH;geo.volH=volH;geo.volBot=volBot;
  geo.X=X;geo.Y=Y;geo.yLo=yLo;geo.yHi=yHi;
  const rel=anyRel(), prim=primScale();
  const primX0=rel?plotW+MCOLW:plotW;
  ctx.fillStyle='rgba(255,255,255,.014)';
  ctx.fillRect(plotW,0,AXIS_W,plotH); ctx.fillRect(0,plotH,W,TIME_H);
  if(rel){ ctx.fillStyle='rgba(224,166,63,.025)'; ctx.fillRect(plotW,0,MCOLW,priceH); }
  ctx.font='10px '+MONO; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.lineWidth=1;
  const gridCol=manual?'#c9a45c':COL.dim;
  const tickPts=[];
  if(prim==='price'){
    const raw=(yHi-yLo)/6, pow=Math.pow(10,Math.floor(Math.log10(raw)));
    const step=(raw/pow<1.5?1:raw/pow<3.5?2:raw/pow<7.5?5:10)*pow;
    ctx.strokeStyle=COL.grid; ctx.fillStyle=gridCol;
    for(let i=Math.ceil(yLo/step);i*step<=yHi;i++){
      const p=i*step, gy=cr(Y(p));
      line(0,gy,plotW,gy); ctx.fillText(p.toFixed(2),primX0+8,gy);
      tickPts.push({gy,p}); }
  }else{
    const isPts=prim==='pts';
    const valOf=p=>isPts?p-pctBase:pctOf(p);
    const priceOf=v=>isPts?pctBase+v:pctBase*(1+v/100);
    const span=Math.max(1e-9,valOf(yHi)-valOf(yLo));
    const st=(isPts?PTS_STEPS:PCT_STEPS).find(s=>span/s<=8)||1e7;
    ctx.strokeStyle=COL.grid; ctx.fillStyle=gridCol;
    for(let k=Math.ceil(valOf(yLo)/st);k<=Math.floor(valOf(yHi)/st);k++){
      if(k===0)continue;
      const v=k*st, gy=cr(Y(priceOf(v)));
      if(gy<-1||gy>priceH+1)continue;
      line(0,gy,plotW,gy);
      const dv=prim==='inv'?-v:v;
      ctx.fillText(isPts?labelPts(dv):labelPct(dv),primX0+8,gy);
      tickPts.push({gy,p:priceOf(v)}); } }
  if(rel){
    const others=SORDER.filter(s=>scales[s]&&s!==prim).slice(0,3);
    if(pctBase){ const zy=Y(pctBase);
      if(zy>20&&zy<priceH-8) tickPts.push({gy:zy,p:pctBase}); }
    if(others.length){
      ctx.font='8.5px '+MONO;
      for(const t of tickPts){ if(t.gy<20||t.gy>priceH-8)continue;
        others.forEach((s,i)=>{ ctx.fillStyle='rgba(154,163,174,.65)';
          ctx.fillText(scaleLabel(s,t.p),plotW+5,t.gy+(i-(others.length-1)/2)*10); });} }
    if(pctBase){ const zy=cr(Y(pctBase));
      if(zy>-1&&zy<priceH+1){
        ctx.strokeStyle=baseDrag?'rgba(224,166,63,1)':'rgba(224,166,63,.75)';
        ctx.setLineDash([6,4]); line(0,zy,plotW,zy); ctx.setLineDash([]);
        ctx.font='500 9.5px '+MONO; ctx.fillStyle='rgba(224,166,63,.9)';
        ctx.fillText(`0 · ${fmtP(pctBase)}${baseDrag?' · drag':''}`,6,zy-6);
        ctx.fillStyle=COL.acc; rr(plotW+3,zy-9,MCOLW-6,18,4); ctx.fill();
        ctx.fillStyle='#10131a'; ctx.font='600 10px '+MONO; ctx.textAlign='center';
        ctx.fillText('0',plotW+3+(MCOLW-6)/2,zy); ctx.textAlign='left'; } } }
  const dayXs=[];
  for(let d=Math.max(0,Math.ceil(leftGM/SESSION));d*SESSION<bars.length&&d*SESSION<=view.r;d++)
    dayXs.push({gm:d*SESSION,xi:X(d*SESSION),d});
  const stepT=[5,10,15,30,60,120,240,480].find(s=>s*sp>=64)||480;
  ctx.textAlign='center';
  for(let gmT=Math.max(0,Math.ceil(leftGM/stepT)*stepT);gmT<=view.r;gmT+=stepT){
    if(gmT>=bars.length)break;
    const xi=X(gmT);
    if(dayXs.some(o=>Math.abs(o.xi-xi)<30))continue;
    ctx.strokeStyle=COL.grid; line(cr(xi),0,cr(xi),plotH);
    ctx.fillStyle=COL.dim; ctx.fillText(fmtHM(gmT),xi,plotH+TIME_H/2+1); }
  for(const o of dayXs){
    ctx.strokeStyle=COL.gridStrong; line(cr(o.xi),0,cr(o.xi),plotH);
    if(dayLbl[o.d]){ctx.fillStyle='#9aa3ae';ctx.font='600 10px '+MONO;ctx.textAlign='left';
      ctx.fillText(dayLbl[o.d],o.xi+5,plotH+TIME_H/2+1);ctx.textAlign='center';} }
  if(fvgOn){
    const list=getFVG();
    ctx.save(); ctx.beginPath(); ctx.rect(0,0,plotW,priceH); ctx.clip();
    let drawn=0;
    for(let i=list.length-1;i>=0&&drawn<80;i--){
      const f=list[i]; if(f.gone)continue;
      const xs=X(f.gm); if(xs>plotW)continue;
      const xe=f.fill?X(f.fill):Math.min(plotW,X(bars.length-1)+sp*0.6);
      if(xe<0)continue;
      const yT=Y(f.top), yB=Y(f.bot); if(yB-yT<1.5)continue;
      const a=f.fill?0.055:0.11;
      ctx.fillStyle=f.dir===1?`rgba(47,191,127,${a})`:`rgba(229,72,77,${a})`;
      ctx.fillRect(xs,yT,Math.max(2,xe-xs),yB-yT);
      ctx.strokeStyle=f.dir===1?'rgba(47,191,127,.2)':'rgba(229,72,77,.2)';
      ctx.strokeRect(xs,cr(yT),Math.max(2,xe-xs),cr(yB)-cr(yT));
      drawn++; }
    ctx.restore(); }
  if(vwOn){
    ctx.save(); ctx.beginPath(); ctx.rect(0,0,plotW,priceH); ctx.clip();
    const wMax=clamp(sp*10,26,110);
    const wick=(cx,hw,bar,vn)=>{
      const r=bar.h-bar.l, bf=r>0?(bar.c-bar.l)/r:0.5;
      const relv=clamp(bar.v/Math.max(1e-9,vn*0.85),0,1);
      if(relv<=0.02)return;
      const ty=Y((bar.h+bar.l+bar.c)/3), bw2=relv*wMax;
      ctx.lineWidth=2.4; ctx.lineCap='round';
      ctx.strokeStyle='rgba(47,191,127,.75)'; line(cx-hw-3,ty,cx-hw-3-bw2*bf,ty);
      ctx.strokeStyle='rgba(229,72,77,.75)'; line(cx+hw+3,ty,cx+hw+3+bw2*(1-bf),ty); };
    if(effGhost&&la>0.02){
      const win=30; let sIdx=Math.max(0,gA-win), sSum=0;
      for(let k=sIdx;k<gA;k++)sSum+=bars[k].v;
      for(let g=gA;g<=gB;g++){
        const bar=bars[g];
        const avg=sSum/Math.max(1,g-sIdx);
        sSum+=bar.v; if(g-sIdx>=win){sSum-=bars[sIdx].v;sIdx++;}
        if(bar.v<=avg*1.8)continue;
        const cx=X(g+0.5); if(cx<-4||cx>plotW+4)continue;
        wick(cx,gw/2,bar,volMax1); }
    }else{
      const win=20; let sIdx=Math.max(0,b0-win), sSum=0;
      for(let k=sIdx;k<b0;k++)sSum+=agg[k].v;
      for(let b=b0;b<=b1;b++){
        const k2=agg[b];
        const avg=sSum/Math.max(1,b-sIdx);
        sSum+=k2.v; if(b-sIdx>=win){sSum-=agg[sIdx].v;sIdx++;}
        if(k2.v<=avg*1.8)continue;
        const cx=(X(k2.g0)+X(k2.g1))/2; if(cx<-4||cx>plotW+4)continue;
        wick(cx,(X(k2.g1)-X(k2.g0))*0.33,k2,volMax); } }
    ctx.restore(); }
  const ghostVol=effGhost&&la>0.02;
  const aggA=ghostVol?0.22*(1-la):0.22;
  if(aggA>0.012){
    ctx.globalAlpha=aggA;
    for(let b=b0;b<=b1;b++){
      const k=agg[b], x0=X(k.g0), x1=X(k.g1), ins=(x1-x0)*0.17;
      ctx.fillStyle=k.c>=k.o?COL.up:COL.dn;
      ctx.fillRect(x0+ins,volBot-Math.max(1,k.v/volMax*(volH-8)),Math.max(1,(x1-x0)*0.66),Math.max(1,k.v/volMax*(volH-8))); } }
  if(ghostVol){
    for(let b=b0;b<=b1;b++){
      const e0=agg[b].g0;
      for(let g=Math.max(gA,e0),ge=Math.min(gB,agg[b].g1-1);g<=ge;g++){
        const bar=bars[g], cx=X(g+0.5);
        if(cx<-4||cx>plotW+4)continue;
        const cascade=clamp((now-switchT0-(g-e0)*16)/200,0,1)*bp;
        const a=(g===gi?0.85:0.38)*la*cascade; if(a<=0.015)continue;
        ctx.globalAlpha=a; ctx.fillStyle=bar.c>=bar.o?COL.up:COL.dn;
        const vh=Math.max(1,bar.v/volMax1*(volH-8));
        ctx.fillRect(cx-gw/2,volBot-vh,gw,vh); } } }
  ctx.globalAlpha=1;
  if(effGhost&&la>0.02){
    for(let b=b0;b<=b1;b++){
      const emph=(b===sb);
      for(let g=Math.max(gA,agg[b].g0),e0=agg[b].g0;g<=Math.min(gB,agg[b].g1-1);g++){
        const bar=bars[g], cx=X(g+0.5);
        if(cx<-6||cx>plotW+6)continue;
        const up2=bar.c>=bar.o, col=up2?COL.up:COL.dn;
        const cascade=clamp((now-switchT0-(g-e0)*16)/200,0,1)*bp;
        const a=((g===gi)?1:emph?0.85:0.62)*la*cascade; if(a<=0.015)continue;
        const yH=Y(bar.h),yL=Y(bar.l),yO=Y(bar.o),yC=Y(bar.c);
        const top=Math.min(yO,yC), bot=Math.max(yO,yC), bh=Math.max(1,bot-top);
        ctx.globalAlpha=a; ctx.strokeStyle=col; ctx.fillStyle=col;
        ctx.lineWidth=(g===gi)?1.8:emph?1.4:1;
        if(gw>=2.6){
          if(top-yH>0.3) line(cr(cx),yH,cr(cx),top+0.5);
          if(yL-bot>0.3) line(cr(cx),bot-0.5,cr(cx),yL);
          if(ghostStyle==='fade'){ctx.globalAlpha=a*0.16;ctx.fillRect(cx-gw/2,top,gw,bh);ctx.globalAlpha=a;}
          ctx.strokeRect(cx-gw/2,top,gw,bh);
        }else ctx.fillRect(cx-gw/2,top,gw,bh); } }
    ctx.globalAlpha=1; }
  for(let b=b0;b<=b1;b++){
    const k=agg[b];
    const born=(bornGM>=0&&b===Math.floor(bornGM/tf))?easeOut(clamp((now-bornAt)/380,0,1)):1;
    const e=clamp(bp*born,0,1);
    const oV=lerp(k.c,k.o,e), hV=lerp(k.c,k.h,e), lV=lerp(k.c,k.l,e);
    const up2=k.c>=k.o, col=up2?COL.up:COL.dn;
    const x0=X(k.g0), x1=X(k.g1), ins=(x1-x0)*0.17;
    const bx=x0+ins, bw=Math.max(1,(x1-x0)*0.66), cx=(x0+x1)/2;
    const emph=effGhost&&b===sb;
    const yHv=Y(hV), yLv=Y(lV);
    const top=Y(Math.max(oV,k.c)), yBo=Y(Math.min(oV,k.c)), bh=Math.max(1,yBo-top);
    ctx.strokeStyle=col; ctx.fillStyle=col;
    ctx.lineWidth=1; ctx.globalAlpha=effGhost?(emph?1:0.85):1;
    if(bw<2.6){
      line(cr(cx),yHv,cr(cx),yLv);
      ctx.lineWidth=Math.max(2,bw);
      line(cr(cx),top,cr(cx),top+bh);
    }else if(effGhost){
      if(top-yHv>0.3) line(cr(cx),yHv,cr(cx),top+0.5);
      if(yLv-yBo>0.3) line(cr(cx),yBo-0.5,cr(cx),yLv);
      ctx.globalAlpha=emph?0.34:0.17; ctx.fillRect(bx,top,bw,bh);
      ctx.globalAlpha=emph?1:0.9; ctx.lineWidth=emph?2:1.5;
      ctx.strokeRect(bx,top,bw,bh);
    }else{
      ctx.globalAlpha=1;
      line(cr(cx),yHv,cr(cx),yLv);
      ctx.fillRect(bx,top,bw,bh); } }
  ctx.globalAlpha=1;
  if(tf>1&&sb>=0&&agg[sb]&&agg[sb].g0<bars.length){
    const k=agg[sb], x0=X(k.g0), x1=X(k.g1), ins=(x1-x0)*0.17;
    ctx.strokeStyle=COL.acc; ctx.lineWidth=1.4; ctx.globalAlpha=.9;
    rr(x0+ins-5,Y(k.h)-5,(x1-x0-2*ins)+10,(Y(k.l)-Y(k.h))+10,6); ctx.stroke();
    ctx.globalAlpha=1; }
  if(tf>1&&sb>=0&&!effGhost&&gi>=0){
    const ib=bars[gi], cxm=X(gi+0.5);
    ctx.fillStyle='rgba(224,166,63,.055)'; ctx.fillRect(X(gi),0,sp,priceH);
    const yH=Y(ib.h),yL=Y(ib.l),yO=Y(ib.o),yC=Y(ib.c);
    const t2=Math.min(yO,yC), b2=Math.max(yO,yC);
    const wb=Math.max(3,Math.min(gw*1.3,sp*0.7));
    ctx.strokeStyle=COL.acc; ctx.lineWidth=1.5;
    if(t2-yH>0.3) line(cr(cxm),yH,cr(cxm),t2+0.5);
    if(yL-b2>0.3) line(cr(cxm),b2-0.5,cr(cxm),yL);
    ctx.strokeRect(cxm-wb/2,t2,wb,Math.max(1,b2-t2)); }
  axisTags=[];
  ctx.save(); ctx.beginPath(); ctx.rect(0,0,plotW,priceH); ctx.clip();
  for(const d of drawings) renderDrawing(d,{});
  if(pending) renderDrawing(pending,{preview:true});
  if(selId!=null){ const sd=drawings.find(d=>d.id===selId);
    if(sd) for(const h of handlesOf(sd)){
      ctx.fillStyle='#e8ecf1'; ctx.strokeStyle='#0c0e11'; ctx.lineWidth=1.2;
      ctx.fillRect(h.x-3.5,h.y-3.5,7,7); ctx.strokeRect(h.x-2.5,h.y-2.5,5,5); } }
  ctx.restore();
  for(const t of axisTags){
    ctx.fillStyle=t.c; rr(primX0+2,t.y-9,W-primX0-4,18,4); ctx.fill();
    ctx.fillStyle='#0c0e11'; ctx.font='600 9.5px '+MONO;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(t.text,primX0+2+(W-primX0-4)/2,t.y); }
  const lp=bars[bars.length-1].c, ly=Y(lp);
  if(ly>-8&&ly<priceH+8){
    ctx.strokeStyle=COL.acc; ctx.globalAlpha=.55; ctx.setLineDash([3,4]);
    line(0,cr(ly),plotW,cr(ly)); ctx.setLineDash([]); ctx.globalAlpha=1;
    ctx.fillStyle=COL.acc; rr(primX0+2,ly-9,W-primX0-4,18,4); ctx.fill();
    ctx.fillStyle='#10131a'; ctx.font='600 10px '+MONO;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(scaleLabel(prim,lp),primX0+2+(W-primX0-4)/2,ly+0.5); }
  if(placing&&mouse.in&&mouse.x<plotW&&mouse.y<priceH){
    const pv2=priceAtY(mouse.y), py2=cr(Y(pv2));
    const pc2=placing==='buy'?COL.up:placing==='sell'?COL.dn:COL.acc;
    ctx.strokeStyle=pc2; ctx.globalAlpha=.8; ctx.setLineDash([5,4]);
    line(0,py2,plotW,py2); ctx.setLineDash([]); ctx.globalAlpha=1;
    ctx.font='600 10px '+MONO; ctx.fillStyle=pc2; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(placing==='base'?`0 → ${fmtP(pv2)}`:(placing==='buy'?'BUY ':'SELL ')+fmtP(pv2),8,py2-7); }
  if(act.length){
    const IND=getInd();
    let top=volBot;
    for(const p of act){
      ctx.strokeStyle='#1d232c'; line(0,cr(top),W,cr(top));
      const padT=9,padB=7, ph=PH-padT-padB;
      let plo=0,phi=1,levels=[],series=[],histD=null;
      if(p.id==='rsi'){ plo=0;phi=100;
        levels=[{v:70,dash:[3,4],c:'rgba(229,72,77,.35)',l:'70'},{v:50,c:'rgba(255,255,255,.05)'},{v:30,dash:[3,4],c:'rgba(47,191,127,.35)',l:'30'}];
        series=[{d:IND.rsi,c:COL.acc,w:1.4}]; }
      else if(p.id==='macd'){ let m=1e-9;
        for(let b=b0;b<=b1;b++)m=Math.max(m,Math.abs(IND.macd.m[b]||0),Math.abs(IND.macd.s[b]||0),Math.abs(IND.macd.h[b]||0));
        plo=-m*1.18;phi=m*1.18;levels=[{v:0,c:'rgba(255,255,255,.10)'}];
        histD=IND.macd.h;
        series=[{d:IND.macd.m,c:'#5fb0d8',w:1.3},{d:IND.macd.s,c:COL.acc,w:1.1}]; }
      else{ let m=1e-9;
        for(let b=b0;b<=b1;b++)m=Math.max(m,IND.adx.a[b]||0,IND.adx.p[b]||0,IND.adx.m[b]||0);
        plo=0;phi=Math.max(30,m*1.18);
        levels=[{v:20,c:'rgba(255,255,255,.05)',l:'20'},{v:40,c:'rgba(255,255,255,.05)',l:'40'}];
        series=[{d:IND.adx.p,c:COL.up,w:1.1},{d:IND.adx.m,c:COL.dn,w:1.1},{d:IND.adx.a,c:COL.acc,w:1.5}]; }
      const PY=v=>top+padT+(1-(v-plo)/(phi-plo))*ph;
      ctx.font='9.5px '+MONO; ctx.textAlign='left'; ctx.textBaseline='middle';
      for(const L of levels){ const y=cr(PY(L.v));
        ctx.strokeStyle=L.c; ctx.setLineDash(L.dash||[]); line(0,y,plotW,y); ctx.setLineDash([]);
        if(L.l){ctx.fillStyle='#4a525d';ctx.fillText(L.l,plotW+8,y);} }
      ctx.save(); ctx.beginPath(); ctx.rect(0,top+1,plotW,PH-1); ctx.clip();
      if(histD){ for(let b=b0;b<=b1;b++){ const v=histD[b]; if(v==null)continue;
          const w=Math.max(1,(X(agg[b].g1)-X(agg[b].g0))*0.42);
          const y0=PY(0),y1=PY(v);
          ctx.fillStyle=v>=0?'rgba(47,191,127,.45)':'rgba(229,72,77,.45)';
          ctx.fillRect(X(agg[b].g0+tf/2)-w/2,Math.min(y0,y1),w,Math.max(1,Math.abs(y1-y0))); } }
      for(const s of series){ ctx.strokeStyle=s.c; ctx.lineWidth=s.w;
        ctx.beginPath(); let st=false;
        for(let b=b0;b<=b1;b++){ const v=s.d[b]; if(v==null){st=false;continue;}
          const x=X(agg[b].g0+tf/2), y=PY(v);
          if(!st){ctx.moveTo(x,y);st=true;} else ctx.lineTo(x,y); }
        ctx.stroke(); }
      ctx.restore();
      const idx=sb>=0?sb:agg.length-1;
      const fv=a=>{for(let i=Math.min(idx,a.length-1);i>=0;i--)if(a[i]!=null)return a[i];return null;};
      let vs='',vc=COL.ink;
      if(p.id==='rsi'){ const v=fv(IND.rsi); vs=v==null?'—':v.toFixed(2);
        vc=v==null?COL.ink:v>70?COL.dn:v<30?COL.up:COL.ink; }
      else if(p.id==='macd'){ const m=fv(IND.macd.m),s=fv(IND.macd.s),h=fv(IND.macd.h);
        vs=`M ${m==null?'—':m.toFixed(2)}  S ${s==null?'—':s.toFixed(2)}  H ${h==null?'—':h.toFixed(2)}`;
        vc=h==null?COL.ink:h>=0?COL.up:COL.dn; }
      else{ const a=fv(IND.adx.a),pp=fv(IND.adx.p),mm=fv(IND.adx.m);
        vs=`ADX ${a==null?'—':a.toFixed(1)}  +DI ${pp==null?'—':pp.toFixed(1)}  −DI ${mm==null?'—':mm.toFixed(1)}`; }
      ctx.font='600 10px '+MONO;
      const tw=ctx.measureText(p.title).width, vw2=ctx.measureText(vs).width;
      ctx.fillStyle='rgba(12,14,17,.72)'; rr(6,top+4,tw+vw2+26,16,4); ctx.fill();
      ctx.fillStyle='#8b95a1'; ctx.fillText(p.title,12,top+12);
      ctx.fillStyle=vc; ctx.fillText(vs,12+tw+8,top+12);
      if(inPlot&&mouse.y>top&&mouse.y<top+PH){
        const v=plo+(1-(mouse.y-top-padT)/ph)*(phi-plo);
        pill(plotW+3,clamp(mouse.y,top+2,top+PH-20),AXIS_W-7,18,clamp(v,plo,phi).toFixed(2)); }
      top+=PH; } }
  if(inPlot&&sb>=0){
    const cgm=tf>1?gi:agg[sb].g0;
    const sx=cr(X(cgm+0.5));
    ctx.strokeStyle='rgba(255,255,255,.22)'; ctx.setLineDash([4,4]);
    line(sx,0,sx,plotH);
    if(mouse.y<=priceH){
      line(0,cr(mouse.y),plotW,cr(mouse.y));
      const pv=clamp(priceAtY(mouse.y),Math.min(yLo,yHi),Math.max(yLo,yHi));
      const parts=[scaleLabel(prim,pv)];
      for(const s of SORDER){ if(s!==prim&&scales[s])parts.push(scaleLabel(s,pv)); }
      const txt=parts.join('  ·  ');
      const pw=ctx.measureText(txt).width+14;
      pill(Math.max(2,W-2-pw),mouse.y-9,pw,18,txt); }
    ctx.setLineDash([]);
    const txt=fmtHM(cgm), w=ctx.measureText(txt).width+14;
    pill(clamp(X(cgm+0.5)-w/2,2,plotW-w-2),plotH+4,w,TIME_H-8,txt); }
  ctx.strokeStyle='#20262f';
  line(cr(plotW),0,cr(plotW),H); line(0,cr(plotH),W,cr(plotH));
  if(rel) line(cr(primX0),0,cr(primX0),H);
  geo.badge={x:primX0+2,y:H-TIME_H-20,w:W-primX0-4,h:15};
  const fac=pzR0/((mHi-mLo)||1);
  ctx.font='600 9px '+MONO;
  ctx.fillStyle=manual?'rgba(224,166,63,.14)':'rgba(255,255,255,.04)';
  ctx.strokeStyle=manual?'rgba(224,166,63,.55)':'rgba(255,255,255,.12)';
  rr(geo.badge.x,geo.badge.y,geo.badge.w,geo.badge.h,4);ctx.fill();ctx.stroke();
  ctx.fillStyle=manual?COL.acc:'#5a626d';
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(manual?('×'+fac.toFixed(2)):'AUTO',geo.badge.x+geo.badge.w/2,geo.badge.y+8);
  geo.addBtn={x:W-20,y:4,w:16,h:16};
  const ab=geo.addBtn;
  ctx.fillStyle=axMenuOpen?'rgba(224,166,63,.16)':inBtn(mouse.x,mouse.y,ab)?'rgba(255,255,255,.08)':'rgba(255,255,255,.045)';
  ctx.strokeStyle=axMenuOpen?'rgba(224,166,63,.6)':'rgba(255,255,255,.14)';
  rr(ab.x,ab.y,ab.w,ab.h,4);ctx.fill();ctx.stroke();
  ctx.strokeStyle=axMenuOpen?COL.acc:'#9aa3ae'; ctx.lineWidth=1.3;
  const acx=ab.x+8, acy=ab.y+8;
  line(acx-3.5,acy,acx+3.5,acy); line(acx,acy-3.5,acx,acy+3.5);
  ctx.lineWidth=1;
  const show=sb>=0?agg[sb]:agg[agg.length-1];
  const up3=show.c>=show.o, cc=up3?COL.up:COL.dn;
  const prevC=sb>0?agg[sb-1].c:show.o, dC=show.c-prevC, dP=prevC?dC/prevC*100:0;
  lgTf.textContent=tf+'m';
  lgO.textContent=fmtP(show.o); lgH.textContent=fmtP(show.h);
  lgL.textContent=fmtP(show.l); lgC.textContent=fmtP(show.c);
  lgChg.textContent=(dC>=0?'+':'−')+Math.abs(dP).toFixed(2)+'%';
  lgV.textContent=fmtV(show.v);
  [lgO,lgH,lgL,lgC,lgChg,lgV].forEach(el=>el.style.color=cc);
  const relTags=v=>{ if(!pctBase)return ''; let s='';
    if(scales.pct){const dv=pctOf(v); s+=` · <b class="${dv>=0?'u':'d'}">${labelPct(dv)}</b>`;}
    if(scales.inv){const dv=-pctOf(v); s+=` · <b class="${dv>=0?'u':'d'}">${labelPct(dv)}</b>`;}
    if(scales.pts){const dv=v-pctBase; s+=` · <b class="${dv>=0?'u':'d'}">${labelPts(dv)}</b>`;}
    return s; };
  let html;
  if(tf>1&&sb>=0){
    const ib=bars[gi], iu=ib.c>=ib.o?'u':'d';
    html=`INNER 1m · <b>${fmtHM(gi)}</b> · O <b>${fmtP(ib.o)}</b> H <b class="${iu}">${fmtP(ib.h)}</b> L <b class="${iu}">${fmtP(ib.l)}</b> C <b class="${iu}">${fmtP(ib.c)}</b> · VOL <b>${fmtV(ib.v)}</b>${relTags(ib.c)} · SHELL ${tf}m ${fmtHM(agg[sb].g0)}–${fmtEnd(agg[sb].g1)}`;
  }else if(sb>=0){
    html=tf>1?`SHELL ${tf}m · <b>${fmtHM(agg[sb].g0)}</b> → <b>${fmtEnd(agg[sb].g1)}</b>${relTags(show.c)}`
             :`1m · <b>${fmtHM(agg[sb].g0)}</b> → <b>${fmtEnd(agg[sb].g0+1)}</b>${relTags(show.c)}`;
  }else html=`hover any candle for details`;
  if(lgRow2.dataset.h!==html){lgRow2.innerHTML=html;lgRow2.dataset.h=html;}
  latestBtn.classList.toggle('show',view.r<bars.length-2); }
