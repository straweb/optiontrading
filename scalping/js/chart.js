'use strict';
/* ═══════════ chart.js — multi-pane engine (authoritative) ═══════════ */
const COL={bg:'#0a0c10',grid:'rgba(255,255,255,.045)',gridStrong:'rgba(255,255,255,.11)',
  ink:'#d6dae0',dim:'#8b95a1',up:'#2fbf7f',dn:'#e5484d',acc:'#e0a63f'};
const AXIS_W=92, MCOLW=40, TIME_H=26;
const scales={price:true,pct:true,inv:false,pts:false};
const SORDER=['price','pct','inv','pts'];
const MONO='"IBM Plex Mono", monospace';
let paused=false, fvgOn=true, vwOn=true;
const bars=[];
let price=0, lastPrice=0;
const geo={sp:0,plotW:1,priceH:1,X:x=>x,Y:y=>y,yLo:0,yHi:1,badge:null,addBtn:null};
var cv={style:{}}, ctx=null, W=0, H=0;
let tool='cursor', pending=null, drag=null, downPt=null;
let drawings=[], uidC=1;
const undoStack=[];
let axisTags=[];
let lockCross=true, masterPane=-1;

on('#ovSeg','click',e=>{ const b=e.target.closest('button'); if(!b)return;
  if(b.dataset.o==='fvg'){fvgOn=!fvgOn;b.classList.toggle('on',fvgOn);}
  else{vwOn=!vwOn;b.classList.toggle('on',vwOn);} });
on('#pauseBtn','click',()=>{
  paused=!paused;
  const ip=qs('#icPause'),iy=qs('#icPlay');
  if(ip)ip.style.display=paused?'none':'block';
  if(iy)iy.style.display=paused?'block':'none';
  const lv=qs('#live'); if(lv)lv.classList.toggle('paused',paused);
  const lt=qs('#liveTxt'); if(lt)lt.textContent=paused?'PAUSED':'LIVE'; });

/* ── per-pane data ── */
function paneBars(p){ return p.key===SYM?.key?bars:(dataCache.get(p.key)?.bars||[]); }
function paneAgg(p,t){
  if(p.aggDirty){p.aggCache.clear();p.aggDirty=false;}
  if(!p.aggCache.has(t)){
    const src=paneBars(p), arr=[], n=Math.ceil(src.length/t);
    for(let b=0;b<n;b++){
      const g0=b*t,g1=Math.min(g0+t,src.length);
      let h=-1e18,l=1e18,v=0;
      for(let g=g0;g<g1;g++){const x=src[g];if(x.h>h)h=x.h;if(x.l<l)l=x.l;v+=x.v;}
      arr.push({g0,g1,o:src[g0].o,h,l,c:src[g1-1].c,v}); }
    p.aggCache.set(t,arr); }
  return p.aggCache.get(t); }
function paneInd(p){
  if(p.indCache&&p.indCache.ver===p.dataVer)return p.indCache.d;
  const A=paneAgg(p,p.tf),c=A.map(k=>k.c),h=A.map(k=>k.h),l=A.map(k=>k.l);
  const d={rsi:rsiArr(c,14),macd:macdArr(c),adx:adxArr(h,l,c,14)};
  p.indCache={ver:p.dataVer,d};return d; }
function paneFVG(p){
  if(p._fvgVer===p.dataVer)return p._fvg||[];
  const src=paneBars(p), list=[];
  for(let i=1;i<src.length-1;i++){
    const a=src[i-1],b=src[i+1];
    if(b.l>a.h)list.push({top:b.l,bot:a.h,gm:i+1,dir:1,fill:0,gone:false});
    else if(b.h<a.l)list.push({top:a.l,bot:b.h,gm:i+1,dir:-1,fill:0,gone:false}); }
  for(const f of list){ for(let j=f.gm+1;j<src.length;j++){const x=src[j];
    if(f.dir===1){ if(x.l<=f.bot){f.gone=true;break;} if(!f.fill&&x.l<f.top)f.fill=j; }
    else{ if(x.h>=f.top){f.gone=true;break;} if(!f.fill&&x.h>f.bot)f.fill=j; } } }
  p._fvgVer=p.dataVer;p._fvg=list;return list; }
function view0(p){
  const src=paneBars(p), n=src.length||100;
  if(!p.view)p.view={r:n+6,v:Math.min(260,Math.max(40,n))};
  if(p.autoFollow!==false&&n&&Math.abs(p.view.r-(n+3))>2)p.view.r=n+3;
  return p.view; }
function paneSp(p){ return (p.W-AXIS_W)/view0(p).v; }
function clampPaneR(p,r){ const src=paneBars(p);
  return clamp(r,view0(p).v-30,src.length+90); }
function la0(sp){ return clamp((sp-1.5)/1.8,0,1); }
const fmtHM=gm=>{const m=((gm%SESSION)+SESSION)%SESSION,t=OPEN_MIN+m;
  return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');};
function fmtDur(dmin){dmin=Math.max(0,Math.round(dmin));
  const d=Math.floor(dmin/375),r=dmin%375,h=Math.floor(r/60),m=r%60;
  if(d>0)return d+'d'+(h?' '+h+'h':'');
  if(h>0)return h+'h'+(m?' '+m+'m':'');
  return m+'m';}
function relLabel(v,isPts){ const s=v>=0?'+':'−',a=Math.abs(v);
  return s+(isPts?(a>=1000?a.toFixed(0):a>=100?a.toFixed(1):a.toFixed(2))
                 :(a>=100?a.toFixed(0):a>=10?a.toFixed(1):a.toFixed(2))+'%'); }
const pctOf=(p,base)=>(p-base)/base*100;
function labelPct(v){ const s=v>=0?'+':'−',a=Math.abs(v);
  return s+(a>=100?a.toFixed(0):a>=10?a.toFixed(1):a.toFixed(2))+'%'; }
function labelPts(v){ const s=v>=0?'+':'−',a=Math.abs(v);
  return s+(a>=1000?a.toFixed(0):a>=100?a.toFixed(1):a.toFixed(2)); }
function scaleLabel(s,p,base){
  if(s==='price')return fmtP(p);
  if(s==='pts')return labelPts(p-base);
  const v=pctOf(p,base); return labelPct(s==='inv'?-v:v); }

function line(x1,y1,x2,y2){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
function rr(x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function pill(x,y,w,h,txt){ctx.fillStyle='#171c23';ctx.strokeStyle='rgba(255,255,255,.16)';
  rr(x,y,w,h,4);ctx.fill();ctx.stroke();
  ctx.fillStyle=COL.ink;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(txt,x+w/2,y+h/2+0.5);}

/* ── drawing glue (per active pane) ── */
function pushUndo(){ const p=activeP(); if(!p)return;
  p.undo.push(p.drawings.slice()); if(p.undo.length>80)p.undo.shift(); }
function finishD(d){ const p=activeP(); if(!p)return;
  d.id=p.uidC++; pushUndo(); p.drawings.push(d); p.selId=d.id; setTool('cursor'); }
function hitTopmost(mx,my){
  const p=activeP(); if(!p||!p.geo||mx>p.geo.plotW||mx<0||my<0||my>p.priceH)return null;
  const save=drawings; drawings=p.drawings;
  for(let i=p.drawings.length-1;i>=0;i--){
    const r=hitDrawing(p.drawings[i],mx,my);
    if(r){drawings=save;return{d:p.drawings[i],...r};} }
  drawings=save; return null; }
const txtIn=qs('#txtIn'); let txtCtx=null;
function openText(md,editD,val){
  if(!txtIn)return; txtCtx={pt:md,editD:editD||null};
  txtIn.style.display='block';
  txtIn.style.left=clamp(geo.X(md.gm),4,geo.plotW-210)+'px';
  txtIn.style.top=clamp(geo.Y(md.p)+(editD?-30:8),4,(activeP()?.H||400)-44)+'px';
  txtIn.value=val||'';txtIn.focus();txtIn.select(); }
function closeText(commit){
  if(!txtCtx)return; const v=txtIn.value.trim();
  if(commit&&v){
    if(txtCtx.editD){ pushUndo(); txtCtx.editD.text=v; }
    else if(txtCtx.kind) finishD({type:txtCtx.kind,pts:[txtCtx.pt],text:v});
    else finishD({type:'text',pts:[txtCtx.pt],text:v}); }
  txtIn.style.display='none';txtCtx=null; }
on(txtIn,'keydown',e=>{e.stopPropagation();
  if(e.key==='Enter')closeText(true);else if(e.key==='Escape')closeText(false);});
on(txtIn,'blur',()=>closeText(false));
addEventListener('keydown',e=>{
  if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='SELECT'))return;
  if(e.key==='1')paneSetTF(1); else if(e.key==='2')paneSetTF(3);
  else if(e.key==='3')paneSetTF(5); else if(e.key==='4')paneSetTF(15);
  else if(e.key===' '){e.preventDefault();const b=qs('#pauseBtn');if(b)b.click();}
  else if(e.key==='r'||e.key==='R'){ const p=activeP(); if(p){p.view=null;p.yLo=p.yHi=null;p.autoFollow=true;} }
  else if(e.key==='Escape'){ if(txtCtx)closeText(false);
    else if(pending){pending=null;chipTxt();}
    else if(tool!=='cursor')setTool('cursor');
    else{ const p=activeP(); if(p)p.selId=null; } }
  else if((e.key==='Delete'||e.key==='Backspace')){
    const p=activeP();
    if(p&&p.selId!=null){pushUndo();p.drawings=p.drawings.filter(d=>d.id!==p.selId);p.selId=null;} }
  else if((e.key==='z'||e.key==='Z')&&(e.ctrlKey||e.metaKey)){
    e.preventDefault(); const p=activeP();
    if(p&&p.undo.length){p.drawings=p.undo.pop();p.selId=null;pending=null;chipTxt();} } });

/* ── axis + add(+) menu ── */
const axMenu=qs('#axMenu');
let placing=null, axMenuOpen=false;
function openAxMenu(){ if(!axMenu)return;
  axMenu.style.left=Math.max(4,(activeP()?.W||600)-180)+'px'; axMenu.style.top='24px';
  axMenu.hidden=false; axMenu.style.display='block'; axMenuOpen=true; }
function closeAxMenu(){ if(axMenu){axMenu.hidden=true;axMenu.style.display='none';} axMenuOpen=false; }
function chipPlacing(){ const tc=qs('#toolChip'); if(!tc)return;
  if(!placing){tc.style.display='none';return;}
  tc.textContent={buy:'BUY MARKER — click a price level · ESC cancels',
    sell:'SELL MARKER — click a price level · ESC cancels',
    base:'SET BASELINE — click a price · ESC cancels'}[placing];
  tc.style.display='block'; }
function startPlacing(kind){ placing=kind; closeAxMenu(); chipPlacing(); }
function cancelPlacing(){ if(!placing)return; placing=null; chipPlacing(); }
function placeAt(md){
  const p=activeP(); if(!p)return;
  if(placing==='buy'||placing==='sell')
    finishD({type:'mark',side:placing,pts:[{gm:md.gm,p:md.p}]});
  else if(placing==='base'){ const src=paneBars(p);
    const c=src[0]?.c||md.p;
    p.pctBase=clamp(md.p,c*0.2,c*5); }
  placing=null; chipPlacing(); }
qsa('#axMenu button').forEach(b=>on(b,'click',e=>{e.stopPropagation();startPlacing(b.dataset.act);}));
document.addEventListener('click',e=>{
  if(axMenuOpen&&axMenu&&!axMenu.contains(e.target)&&e.target!==activeP()?.cv)closeAxMenu(); });

/* ── per-pane events ── */
function bindPaneEvents(){
  panes.forEach((p,idx)=>{
    if(!p)return;
    let cvEl=p.cv;
    if(!(cvEl instanceof Element)&&p.box instanceof Element){
      cvEl=p.box.querySelector('canvas');
      if(!cvEl){cvEl=document.createElement('canvas');p.box.appendChild(cvEl);}
      p.cv=cvEl;p.ctx=cvEl.getContext('2d'); }
    if(!(cvEl instanceof Element))return;
    p.cv=cvEl;p.ctx=p.ctx||cvEl.getContext('2d');
    const ro=new ResizeObserver(()=>{ p.dpr=window.devicePixelRatio||1;
      p.W=cvEl.clientWidth;p.H=cvEl.clientHeight;
      cvEl.width=Math.round(p.W*p.dpr);cvEl.height=Math.round(p.H*p.dpr); });
    ro.observe(cvEl);
    cvEl.addEventListener('pointerdown',e=>{ e.preventDefault();
      /* add(+) button beside the hover pill */
      if(p._addBtn&&e.offsetX>=p._addBtn.x&&e.offsetX<=p._addBtn.x+16&&
         e.offsetY>=p._addBtn.y&&e.offsetY<=p._addBtn.y+18){
        if(activePane!==idx){activePane=idx;layoutUI();syncPaneUI();syncGhostUI();mountOverlays();}
        openAxMenu(); return; }
      if(activePane!==idx){activePane=idx;layoutUI();syncPaneUI();syncGhostUI();mountOverlays();}
      const v=view0(p);
      p.autoFollow=false;
      p._drag={x:e.offsetX,y:e.offsetY,r:v.r,lo:p.yLo,hi:p.yHi};
      try{cvEl.setPointerCapture(e.pointerId);}catch(_){} });
    cvEl.addEventListener('pointermove',e=>{
      p.mouse={x:e.offsetX,y:e.offsetY,in:true};
      const d=p._drag;
      if(d){ const v=view0(p);
        v.r=clampPaneR(p,d.r-(e.offsetX-d.x)/paneSp(p));
        const dy=e.offsetY-d.y;
        if(Math.abs(dy)>2&&p.yLo!=null){ const R=p.yHi-p.yLo;
          p.mLo=d.lo+dy*R/p.priceH; p.mHi=d.hi+dy*R/p.priceH; p.pMode='manual'; } }
      else if(tool==='cursor'){
        const hit=hitTopmost(e.offsetX,e.offsetY);
        const want=hit?(hit.h?'pointer':'move'):'crosshair';
        if(cvEl.style.cursor!==want)cvEl.style.cursor=want; } });
    const end=()=>{p._drag=null;};
    cvEl.addEventListener('pointerup',end);cvEl.addEventListener('pointercancel',end);
    cvEl.addEventListener('pointerleave',()=>{p.mouse.in=false;p._hoverGm=null;});
    cvEl.addEventListener('wheel',e=>{ e.preventDefault();
      const x=e.offsetX,y=e.offsetY, plotW=p.W-AXIS_W;
      if(x>=plotW||e.altKey){                        /* PRICE axis: zoom / slide */
        const R=(p.yHi-p.yLo)||1;
        if(e.shiftKey){ const d=R/p.priceH*0.25*e.deltaY;
          p.mLo=(p.yLo||0)+d; p.mHi=(p.yHi||1)+d; p.pMode='manual'; return; }
        const pc=p.yHi-(y/p.priceH)*R;
        const nR=clamp(R*Math.exp(e.deltaY*0.0012),price*0.0004,price*3);
        const kk=nR/R;
        p.mLo=pc-(pc-p.yLo)*kk; p.mHi=pc+(p.yHi-pc)*kk; p.pMode='manual';
        p.autoFollow=false; return; }
      if(y>=p.H-TIME_H){                             /* TIME axis: zoom */
        const t=view0(p).r-(plotW-x)/paneSp(p);
        const nv=clamp(view0(p).v*Math.exp(e.deltaY*0.0011),30,2400);
        view0(p).r=t+(plotW-x)/(plotW/nv); view0(p).v=nv; return; }
      if(e.shiftKey){ view0(p).r=clampPaneR(p,view0(p).r+(e.deltaY+e.deltaX)*0.6/paneSp(p)); return; }
      const anchor=view0(p).r-(plotW-x)/paneSp(p);   /* body: time zoom */
      const nv=clamp(view0(p).v*Math.exp(e.deltaY*0.0011),30,2400);
      view0(p).r=clampPaneR(p,anchor+(plotW-x)/(plotW/nv)); view0(p).v=nv; },{passive:false});
    cvEl.addEventListener('dblclick',e=>{
      const r=cvEl.getBoundingClientRect();
      if(e.clientX-r.left>=r.width-AXIS_W){          /* dbl-click price axis = pin */
        const p2=panes[idx];
        if(p2.yLo!=null){ p2.mLo=p2.yLo; p2.mHi=p2.yHi; p2.pMode='manual';
          toast('price scale pinned — wheel on axis zooms, drag body slides'); } return; }
      const p2=panes[idx];
      p2.view=null;p2.yLo=p2.yHi=null;p2.pMode='auto';p2.autoFollow=true; }); }); }

/* ═══════════ render loop ═══════════ */
const lgTf=qs('#lgTf'),lgO=qs('#lgO'),lgH=qs('#lgH'),lgL=qs('#lgL'),
      lgC=qs('#lgC'),lgV=qs('#lgV'),lgRow2=qs('#lgRow2');
function frame(now){
  requestAnimationFrame(frame);
  panes.forEach((p,pi)=>{
    ctx=p.ctx; cv=p.cv; W=p.W||0; H=p.H||0;
    if(!ctx)return;
    ctx.setTransform(p.dpr||1,0,0,p.dpr||1,0,0);
    ctx.fillStyle=COL.bg;ctx.fillRect(0,0,W,H);
    if(W<60||H<60)return;
    if(!p.key){ ctx.fillStyle='rgba(214,218,224,.28)';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font='700 13px '+MONO;
      ctx.fillText('P'+(pi+1)+' · click pane, then pick a symbol (amber frame = active)',W/2,H/2);
      p._addBtn=null; return; }
    const src=paneBars(p);
    if(!src.length){ ctx.fillStyle='rgba(214,218,224,.28)';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font='700 13px '+MONO;ctx.fillText('NO DATA — '+SRC.toUpperCase(),W/2,H/2);
      p._addBtn=null; return; }
    const plotW=W-AXIS_W, plotH=H-TIME_H;
    const volH=Math.max(26,plotH*0.13);
    const act=PANE_DEFS.filter(x=>x.on);
    const indPH=act.length?clamp(plotH*0.11,34,90):0;
    const priceH=Math.max(90,plotH-volH-indPH*act.length);
    const volBot=priceH+volH;
    const sp=paneSp(p), v=view0(p), leftGM=v.r-v.v;
    if(!p.pctBase)p.pctBase=+src[0].c.toFixed(2);
    const relOn=SORDER.some(s=>scales[s]&&s!=='price');
    const prim=SORDER.find(s=>scales[s])||'price';
    const primX0=relOn?plotW+MCOLW:plotW;
    const gA=Math.max(0,Math.floor(leftGM)), gB=Math.min(src.length-1,Math.ceil(v.r));
    let lo=1e18,hi=-1e18,vmax=0,vmax1=0;
    for(let g=gA;g<=gB;g++){const x=src[g];if(x.l<lo)lo=x.l;if(x.h>hi)hi=x.h;if(x.v>vmax1)vmax1=x.v;}
    const agg=paneAgg(p,p.tf);
    const b0=Math.max(0,Math.floor(leftGM/p.tf)), b1=Math.min(agg.length-1,Math.floor(v.r/p.tf));
    for(let b=b0;b<=b1;b++)if(agg[b].v>vmax)vmax=agg[b].v;
    const manual=p.pMode==='manual'&&p.mHi>p.mLo;
    const pad=(hi-lo)*0.08+src[src.length-1].c*0.0003;
    const tLo=manual?p.mLo:lo-pad, tHi=manual?p.mHi:hi+pad;
    if(p.yLo===null){p.yLo=tLo;p.yHi=tHi;p.volMax=vmax||1;p.volMax1=vmax1||1;}
    else{p.yLo+=(tLo-p.yLo)*0.22;p.yHi+=(tHi-p.yHi)*0.22;
      p.volMax+=((vmax||1)-p.volMax)*0.22;p.volMax1+=((vmax1||1)-p.volMax1)*0.22;}
    const Y=pp=>(1-(pp-p.yLo)/(p.yHi-p.yLo))*priceH;
    const X=gm=>plotW-(v.r-gm)*sp;
    p.priceH=priceH;
    Object.assign(geo,{sp,plotW,priceH,X,Y,yLo:p.yLo,yHi:p.yHi});
    p.geo={sp,plotW,priceH,X,Y,yLo:p.yLo,yHi:p.yHi};
    const effGhost=p.ghost&&p.tf>1;
    const la=la0(sp);
    /* hover */
    const inP=p.mouse.in&&p.mouse.x>=0&&p.mouse.x<=plotW&&p.mouse.y>=0&&p.mouse.y<=plotH;
    let hoverGm=null;
    if(inP){ hoverGm=clamp(Math.floor(v.r-(plotW-p.mouse.x)/sp),0,src.length-1);
      p._hoverGm=hoverGm; masterPane=pi; }
    /* header: constant title + fixed-width value (direct, every frame) */
    const hb=src[hoverGm!=null?hoverGm:src.length-1];
    const q=quotes.get(p.key);
    const val=hb?hb.c:(q?q.ltp:null);
    const base=q&&q.prevClose?q.prevClose:p.pctBase;
    const chg=val&&base?(val-base)/base*100:0;
    const pn=p.box.querySelector('.pn');
    if(pn)pn.textContent='P'+(pi+1)+' · '+paneTitle(p.key);
    const pl=p.box.querySelector('.pl');
    if(pl){ pl.textContent=(hoverGm!=null?'@ ':'')+(val!=null?fmtP(val):'—');
      pl.style.color=chg>=0?'var(--up)':'var(--dn)'; }
    /* axis strips */
    ctx.fillStyle='rgba(255,255,255,.014)';
    ctx.fillRect(plotW,0,W-plotW,plotH); ctx.fillRect(0,plotH,W,TIME_H);
    if(relOn){ ctx.fillStyle='rgba(224,166,63,.025)'; ctx.fillRect(plotW,0,MCOLW,priceH); }
    ctx.font='10px '+MONO;ctx.textAlign='left';ctx.textBaseline='middle';ctx.lineWidth=1;
    const gridCol=manual?'#c9a45c':COL.dim;
    const tickPts=[];
    if(prim==='price'){
      const raw=(p.yHi-p.yLo)/6, pow=Math.pow(10,Math.floor(Math.log10(raw)));
      const st=(raw/pow<1.5?1:raw/pow<3.5?2:raw/pow<7.5?5:10)*pow;
      ctx.strokeStyle=COL.grid;ctx.fillStyle=gridCol;
      for(let i=Math.ceil(p.yLo/st);i*st<=p.yHi;i++){
        const gy=cr(Y(i*st));line(0,gy,plotW,gy);
        ctx.fillText((i*st).toFixed(2),primX0+8,gy);
        tickPts.push({gy,p:i*st}); }
      /* %/inv%/pts sub-labels in the LEFT measurement column */
      const others=SORDER.filter(s=>scales[s]&&s!=='price');
      if(others.length&&p.pctBase){
        ctx.font='8.5px '+MONO;
        for(const t of tickPts){
          others.forEach((s,i)=>{
            let vv=s==='pts'?t.p-p.pctBase:(t.p-p.pctBase)/p.pctBase*100;
            if(s==='inv')vv=-vv;
            ctx.fillStyle='rgba(154,163,174,.65)';
            ctx.fillText(relLabel(vv,s==='pts'),plotW+5,t.gy+(i-(others.length-1)/2)*10); }); }
        ctx.font='10px '+MONO; }
    }else{
      const isPts=prim==='pts';
      const valOf=pp=>isPts?pp-p.pctBase:(pp-p.pctBase)/p.pctBase*100;
      const priceOf=vv=>isPts?p.pctBase+vv:p.pctBase*(1+vv/100);
      const span=Math.max(1e-9,valOf(p.yHi)-valOf(p.yLo));
      const st=(isPts?[0.5,1,2,5,10,20,50,100,200,500]:[0.05,0.1,0.25,0.5,1,2,5,10]).find(s=>span/s<=8)||1e7;
      ctx.strokeStyle=COL.grid;ctx.fillStyle=gridCol;
      for(let k=Math.ceil(valOf(p.yLo)/st);k<=Math.floor(valOf(p.yHi)/st);k++){
        if(k===0)continue;
        const gy=cr(Y(priceOf(k*st)));
        if(gy<-1||gy>priceH+1)continue;
        line(0,gy,plotW,gy);
        const dv=prim==='inv'?-k*st:k*st;
        ctx.fillText(relLabel(dv,isPts),primX0+8,gy);
        tickPts.push({gy,p:priceOf(k*st)}); } }
    /* time axis */
    const stepT=[1,2,3,5,10,15,30,60,120,240].find(s=>s*sp>=56)||480;
    ctx.textAlign='center';
    for(let gmT=Math.max(0,Math.ceil(leftGM/stepT)*stepT);gmT<=v.r;gmT+=stepT){
      if(gmT>=src.length)break;
      const xi=cr(X(gmT));
      ctx.strokeStyle=COL.grid;line(xi,0,xi,plotH);
      ctx.fillStyle=COL.dim;ctx.fillText(fmtHM(gmT),X(gmT),plotH+TIME_H/2+1); }
    for(let d=Math.max(0,Math.floor(leftGM/SESSION));d*SESSION<src.length&&d*SESSION<=v.r;d++){
      const xi=cr(X(d*SESSION));
      ctx.strokeStyle=COL.gridStrong;line(xi,0,xi,plotH); }
    /* FVG */
    if(fvgOn){
      const list=paneFVG(p);
      ctx.save();ctx.beginPath();ctx.rect(0,0,plotW,priceH);ctx.clip();
      let drawn=0;
      for(let i=list.length-1;i>=0&&drawn<40;i--){
        const f=list[i]; if(f.gone)continue;
        const xs=X(f.gm); if(xs>plotW)continue;
        const xe=f.fill?X(f.fill):plotW;
        const yT=Y(f.top),yB=Y(f.bot); if(yB-yT<1.5)continue;
        const a=f.fill?0.055:0.11;
        ctx.fillStyle=f.dir===1?`rgba(47,191,127,${a})`:`rgba(229,72,77,${a})`;
        ctx.fillRect(xs,yT,Math.max(2,xe-xs),yB-yT); drawn++; }
      ctx.restore(); }
    /* volume */
    const aggA=effGhost?0.22*(1-la):0.22;
    if(aggA>0.012){
      ctx.globalAlpha=aggA;
      for(let b=b0;b<=b1;b++){
        const k=agg[b];
        ctx.fillStyle=k.c>=k.o?COL.up:COL.dn;
        const vh=Math.max(1,k.v/p.volMax*(volH-6));
        ctx.fillRect(X(k.g0)+(X(k.g1)-X(k.g0))*0.17,volBot-vh,Math.max(1,(X(k.g1)-X(k.g0))*0.66),vh); }
      ctx.globalAlpha=1; }
    /* v-wicks on high-volume bars */
    if(vwOn){
      ctx.save();ctx.beginPath();ctx.rect(0,0,plotW,priceH);ctx.clip();
      const wMax=clamp(sp*10,26,110);
      const win=20; let sIdx=Math.max(0,b0-win), sSum=0;
      for(let k=sIdx;k<b0;k++)sSum+=agg[k].v;
      for(let b=b0;b<=b1;b++){
        const k=agg[b];
        const avg=sSum/Math.max(1,b-sIdx);
        sSum+=k.v; if(b-sIdx>=win){sSum-=agg[sIdx].v;sIdx++;}
        if(k.v<=avg*1.8)continue;
        const cx=(X(k.g0)+X(k.g1))/2, hw=(X(k.g1)-X(k.g0))*0.33;
        const bar={h:k.h,l:k.l,c:k.c,v:k.v};
        const r=bar.h-bar.l, bf=r>0?(bar.c-bar.l)/r:0.5;
        const relv=clamp(bar.v/Math.max(1e-9,p.volMax*0.85),0,1);
        if(relv<=0.02)continue;
        const ty=Y((bar.h+bar.l+bar.c)/3), bw2=relv*wMax;
        ctx.lineWidth=2.4;ctx.lineCap='round';
        ctx.strokeStyle='rgba(47,191,127,.75)';line(cx-hw-3,ty,cx-hw-3-bw2*bf,ty);
        ctx.strokeStyle='rgba(229,72,77,.75)';line(cx+hw+3,ty,cx+hw+3+bw2*(1-bf),ty); }
      ctx.lineCap='butt';ctx.restore(); }
    /* ghosts */
    if(effGhost&&la>0.02){
      const gw=Math.max(1.2,sp*0.46);
      for(let b=b0;b<=b1;b++){
        for(let g=Math.max(gA,agg[b].g0),e0=agg[b].g0;g<=Math.min(gB,agg[b].g1-1);g++){
          const bar=src[g], cx=X(g+0.5);
          if(cx<-6||cx>plotW+6)continue;
          const col=bar.c>=bar.o?COL.up:COL.dn;
          const a=0.62*la;
          const yH=Y(bar.h),yL=Y(bar.l),yO=Y(bar.o),yC=Y(bar.c);
          const top=Math.min(yO,yC),bot=Math.max(yO,yC),bh=Math.max(1,bot-top);
          ctx.globalAlpha=a;ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=1;
          if(gw>=2.6){
            if(top-yH>0.3)line(cr(cx),yH,cr(cx),top+0.5);
            if(yL-bot>0.3)line(cr(cx),bot-0.5,cr(cx),yL);
            if(p.ghostStyle==='fade'){ctx.globalAlpha=a*0.16;ctx.fillRect(cx-gw/2,top,gw,bh);ctx.globalAlpha=a;}
            ctx.strokeRect(cx-gw/2,top,gw,bh);
          }else ctx.fillRect(cx-gw/2,top,gw,bh); } }
      ctx.globalAlpha=1; }
    /* shells / candles */
    for(let b=b0;b<=b1;b++){
      const k=agg[b];
      const col=k.c>=k.o?COL.up:COL.dn;
      const x0=X(k.g0),x1=X(k.g1),ins=(x1-x0)*0.17;
      const bx=x0+ins,bw=Math.max(1,(x1-x0)*0.66),cx=(x0+x1)/2;
      const yHv=Y(k.h),yLv=Y(k.l);
      const top=Y(Math.max(k.o,k.c)),yBo=Y(Math.min(k.o,k.c)),bh=Math.max(1,yBo-top);
      ctx.strokeStyle=col;ctx.fillStyle=col;
      ctx.lineWidth=1;ctx.globalAlpha=effGhost?0.85:1;
      if(bw<2.6){ line(cr(cx),yHv,cr(cx),yLv);
        ctx.lineWidth=Math.max(2,bw);line(cr(cx),top,cr(cx),top+bh); }
      else if(effGhost){
        if(top-yHv>0.3)line(cr(cx),yHv,cr(cx),top+0.5);
        if(yLv-yBo>0.3)line(cr(cx),yBo-0.5,cr(cx),yLv);
        ctx.globalAlpha=0.17;ctx.fillRect(bx,top,bw,bh);
        ctx.globalAlpha=0.9;ctx.lineWidth=1.5;ctx.strokeRect(bx,top,bw,bh);
      }else{ ctx.globalAlpha=1;line(cr(cx),yHv,cr(cx),yLv);ctx.fillRect(bx,top,bw,bh); } }
    ctx.globalAlpha=1;
    /* drawings */
    axisTags=[];
    ctx.save();ctx.beginPath();ctx.rect(0,0,plotW,priceH);ctx.clip();
    for(const d of p.drawings)renderDrawing(d,{});
    if(pi===activePane&&pending)renderDrawing(pending,{preview:true});
    if(pi===activePane&&p.selId!=null){
      const sd=p.drawings.find(d=>d.id===p.selId);
      if(sd)for(const h of handlesOf(sd)){
        ctx.fillStyle='#e8ecf1';ctx.strokeStyle='#0c0e11';ctx.lineWidth=1.2;
        ctx.fillRect(h.x-3.5,h.y-3.5,7,7);ctx.strokeRect(h.x-2.5,h.y-2.5,5,5); } }
    ctx.restore();
    for(const t of axisTags){
      ctx.fillStyle=t.c;rr(primX0+2,t.y-9,W-primX0-4,18,4);ctx.fill();
      ctx.fillStyle='#0c0e11';ctx.font='600 9.5px '+MONO;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(t.text,primX0+2+(W-primX0-4)/2,t.y); }
    /* LTP line + tag */
    const lp=src[src.length-1].c, ly=Y(lp);
    if(ly>-8&&ly<priceH+8){
      ctx.strokeStyle=COL.acc;ctx.globalAlpha=.55;ctx.setLineDash([3,4]);
      line(0,cr(ly),plotW,cr(ly));ctx.setLineDash([]);ctx.globalAlpha=1;
      ctx.fillStyle=COL.acc;rr(primX0+2,ly-9,W-primX0-4,18,4);ctx.fill();
      ctx.fillStyle='#10131a';ctx.font='600 9.5px '+MONO;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(fmtP(lp),primX0+2+(W-primX0-4)/2,ly); }
    /* crosshair: own hover OR locked from master pane */
    let cxGm=null,cxY=null,isOwn=false;
    if(inP){ cxGm=hoverGm; cxY=p.mouse.y; isOwn=true; }
    else if(lockCross&&masterPane>=0&&panes[masterPane]&&panes[masterPane]._hoverGm!=null
            &&pi!==masterPane){ cxGm=panes[masterPane]._hoverGm; }
    p._addBtn=null;
    if(cxGm!=null){
      const sx=cr(X(cxGm+0.5));
      ctx.strokeStyle='rgba(255,255,255,.2)';ctx.setLineDash([4,4]);
      line(sx,0,sx,plotH);
      if(isOwn){
        line(0,cr(cxY),plotW,cr(cxY));
        const pv=clamp(p.yHi-(cxY/priceH)*(p.yHi-p.yLo),p.yLo,p.yHi);
        const parts=[fmtP(pv)];
        if(scales.pct)parts.push(relLabel(pctOf(pv,p.pctBase),false));
        if(scales.inv)parts.push(relLabel(-pctOf(pv,p.pctBase),false));
        if(scales.pts)parts.push(relLabel(pv-p.pctBase,true));
        const txt=parts.join(' · ');
        const pw=ctx.measureText(txt).width+14;
        const px0=Math.max(2,W-2-pw);
        pill(px0,cxY-9,pw,18,txt);
        const ab={x:px0-20,y:cxY-9};
        ctx.fillStyle='rgba(224,166,63,.15)';ctx.strokeStyle='rgba(224,166,63,.6)';
        rr(ab.x,ab.y,16,18,4);ctx.fill();ctx.stroke();
        ctx.strokeStyle=COL.acc;ctx.lineWidth=1.3;
        line(ab.x+4.5,ab.y+9,ab.x+11.5,ab.y+9);line(ab.x+8,ab.y+5.5,ab.x+8,ab.y+12.5);
        ctx.lineWidth=1;
        p._addBtn=ab;
      }else{
        const pv=src[cxGm]?.c;
        if(pv!=null){ const py2=cr(Y(pv));
          const pw=ctx.measureText(fmtP(pv)).width+14;
          pill(Math.max(2,W-2-pw),clamp(py2,2,priceH-20),pw,18,fmtP(pv)); } }
      ctx.setLineDash([]);
      const txt=fmtHM(cxGm),w2=ctx.measureText(txt).width+14;
      pill(clamp(X(cxGm+0.5)-w2/2,2,plotW-w2-2),plotH+4,w2,TIME_H-8,txt); }
    /* indicator panes */
    const IND=paneInd(p);
    let top=volBot;
    for(const pd of act){
      ctx.strokeStyle='#1d232c';line(0,cr(top),W,cr(top));
      const padT=8,padB=6,ph=indPH-padT-padB;
      let plo=0,phi=1,levels=[],series=[],histD=null;
      if(pd.id==='rsi'){plo=0;phi=100;
        levels=[{v:70,dash:[3,4],c:'rgba(229,72,77,.35)',l:'70'},{v:30,dash:[3,4],c:'rgba(47,191,127,.35)',l:'30'}];
        series=[{d:IND.rsi,c:COL.acc,w:1.3}];}
      else if(pd.id==='macd'){let m2=1e-9;
        for(let b=b0;b<=b1;b++)m2=Math.max(m2,Math.abs(IND.macd.m[b]||0),Math.abs(IND.macd.s[b]||0),Math.abs(IND.macd.h[b]||0));
        plo=-m2*1.18;phi=m2*1.18;levels=[{v:0,c:'rgba(255,255,255,.10)'}];
        histD=IND.macd.h;
        series=[{d:IND.macd.m,c:'#5fb0d8',w:1.2},{d:IND.macd.s,c:COL.acc,w:1}];}
      else{let m2=1e-9;
        for(let b=b0;b<=b1;b++)m2=Math.max(m2,IND.adx.a[b]||0,IND.adx.p[b]||0,IND.adx.m[b]||0);
        plo=0;phi=Math.max(30,m2*1.18);
        levels=[{v:20,c:'rgba(255,255,255,.05)',l:'20'},{v:40,c:'rgba(255,255,255,.05)',l:'40'}];
        series=[{d:IND.adx.p,c:COL.up,w:1},{d:IND.adx.m,c:COL.dn,w:1},{d:IND.adx.a,c:COL.acc,w:1.4}];}
      const PY=vv=>top+padT+(1-(vv-plo)/(phi-plo))*ph;
      ctx.font='9px '+MONO;ctx.textAlign='left';ctx.textBaseline='middle';
      for(const L of levels){const y=cr(PY(L.v));
        ctx.strokeStyle=L.c;ctx.setLineDash(L.dash||[]);line(0,y,plotW,y);ctx.setLineDash([]);
        if(L.l){ctx.fillStyle='#4a525d';ctx.fillText(L.l,plotW+8,y);}}
      ctx.save();ctx.beginPath();ctx.rect(0,top+1,plotW,indPH-1);ctx.clip();
      if(histD){for(let b=b0;b<=b1;b++){const vv=histD[b];if(vv==null)continue;
          const w=Math.max(1,(X(agg[b].g1)-X(agg[b].g0))*0.42);
          const y0=PY(0),y1=PY(vv);
          ctx.fillStyle=vv>=0?'rgba(47,191,127,.45)':'rgba(229,72,77,.45)';
          ctx.fillRect(X(agg[b].g0+p.tf/2)-w/2,Math.min(y0,y1),w,Math.max(1,Math.abs(y1-y0)));}}
      for(const s of series){ctx.strokeStyle=s.c;ctx.lineWidth=s.w;
        ctx.beginPath();let st2=false;
        for(let b=b0;b<=b1;b++){const vv=s.d[b];if(vv==null){st2=false;continue;}
          const x=X(agg[b].g0+p.tf/2),y=PY(vv);
          if(!st2){ctx.moveTo(x,y);st2=true;}else ctx.lineTo(x,y);}
        ctx.stroke();}
      ctx.restore();
      top+=indPH; }
    ctx.strokeStyle='#20262f';
    line(cr(plotW),0,cr(plotW),H);line(0,cr(plotH),W,cr(plotH));
    if(relOn)line(cr(primX0),0,cr(primX0),H);
  });
  /* legend: hovered 1m bar + ghost shell context (active pane) */
  const ap=activeP();
  if(ap&&ap.key&&lgRow2){
    const src=paneBars(ap);
    if(src.length){
      const gm=clamp(ap._hoverGm!=null?ap._hoverGm:src.length-1,0,src.length-1);
      const s=src[gm];
      lgTf.textContent=ap.tf+'m';
      lgO.textContent=fmtP(s.o);lgH.textContent=fmtP(s.h);
      lgL.textContent=fmtP(s.l);lgC.textContent=fmtP(s.c);lgV.textContent=fmtV(s.v);
      const cc=s.c>=s.o?COL.up:COL.dn;
      [lgO,lgH,lgL,lgC,lgV].forEach(el=>el.style.color=cc);
      let s2=`1m ${fmtHM(gm)}`;
      if(ap.ghost&&ap.tf>1){
        const shell=paneAgg(ap,ap.tf)[Math.floor(gm/ap.tf)];
        if(shell)s2+=` · inside ${ap.tf}m shell ${fmtHM(shell.g0)}–${fmtHM(shell.g1-1)}`; }
      s2+=ap.autoFollow===false?'':' · following ⟳';
      if(lgRow2.dataset.h!==s2){lgRow2.innerHTML=s2;lgRow2.dataset.h=s2;} } }
}
