'use strict';
const COL={bg:'#0a0c10',grid:'rgba(255,255,255,.045)',gridStrong:'rgba(255,255,255,.11)',
  ink:'#d6dae0',dim:'#8b95a1',up:'#2fbf7f',dn:'#e5484d',acc:'#e0a63f'};
const AXIS_W=92, MCOLW=40, TIME_H=26;
const scales={price:true,pct:true,inv:false,pts:false};
const SORDER=['price','pct','inv','pts'];
const MONO='"IBM Plex Mono", monospace';
let paused=false, fvgOn=true, vwOn=true;
const bars=[];                       /* canonical array for the PRIMARY (ticket) symbol */
let price=0, lastPrice=0;
const geo={sp:0,plotW:1,priceH:1,volH:1,volBot:1,X:x=>x,Y:y=>y,yLo:0,yHi:1,badge:null,addBtn:null};
let RD_BARS=null;                    /* bars context for tool rendering */
let tool='cursor', pending=null, selId=null, drag=null, downPt=null;
let drawings=[], uidC=1;
const undoStack=[];
let axisTags=[];
/* compat globals for tools.js — re-pointed to the active/rendered pane each frame */
var cv={style:{}}, ctx=null, W=0, H=0;
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
on('#resetBtn','click',()=>{ const p=activeP(); if(p){p.view=null;p.yLo=p.yHi=null;} });
on('#latestBtn','click',()=>{ const p=activeP(); if(p){p.view=null;p.yLo=p.yHi=null;} });

function paneBars(p){ return p.key===(SYM&&SYM.key)?bars:(dataCache.get(p.key)?.bars||[]); }
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
  const A=paneAgg(p,p.tf), c=A.map(k=>k.c),h=A.map(k=>k.h),l=A.map(k=>k.l);
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
function view0(p){ if(!p.view){ const src=paneBars(p);
  p.view={r:src.length+20,v:Math.min(260,Math.max(60,src.length||120))}; } return p.view; }
function paneSp(p){ return (p.W-AXIS_W)/view0(p).v; }
function clampPaneR(p,r){ const src=paneBars(p);
  return clamp(r,view0(p).v-30,src.length+90); }
function la0(sp){ return clamp((sp-1.5)/1.8,0,1); }

/* per-pane interactions */
function bindPaneEvents(){
  panes.forEach((p,idx)=>{
    const cv=p.cv;
    const ro=new ResizeObserver(()=>{
      p.dpr=window.devicePixelRatio||1;
      p.W=cv.clientWidth;p.H=cv.clientHeight;
      cv.width=Math.round(p.W*p.dpr);cv.height=Math.round(p.H*p.dpr); });
    ro.observe(cv);
    cv.addEventListener('pointerdown',e=>{ e.preventDefault();
      if(activePane!==idx){activePane=idx;layoutUI();syncPaneUI();syncGhostUI();}
      const v=view0(p);
      p._drag={x:e.offsetX,y:e.offsetY,r:v.r,lo:p.yLo,hi:p.yHi,moved:false};
      cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove',e=>{
      p.mouse={x:e.offsetX,y:e.offsetY,in:true};
      const d=p._drag;
      if(d){ d.moved=true;
        const v=view0(p);
        v.r=clampPaneR(p,d.r-(e.offsetX-d.x)/paneSp(p));
        const dy=e.offsetY-d.y;
        if(Math.abs(dy)>2&&p.yLo!=null){
          const R=p.yHi-p.yLo;
          p.mLo=d.lo+dy*R/p.priceH; p.mHi=d.hi+dy*R/p.priceH; p.pMode='manual'; } } });
    const end=()=>{ p._drag=null; };
    cv.addEventListener('pointerup',end); cv.addEventListener('pointercancel',end);
    cv.addEventListener('pointerleave',()=>{ p.mouse.in=false; });
    cv.addEventListener('wheel',e=>{ e.preventDefault();
      const v=view0(p), sp=paneSp(p), plotW=p.W-AXIS_W;
      const nv=clamp(v.v*Math.exp(e.deltaY*0.0011),40,2400);
      const anchor=v.r-(plotW-e.offsetX)/sp;
      v.r=clampPaneR(p,anchor+(plotW-e.offsetX)/(plotW/nv)); v.v=nv; },{passive:false});
    cv.addEventListener('dblclick',()=>{ p.view=null;p.yLo=p.yHi=null;p.pMode='auto'; }); }); }

/* drawings target the ACTIVE pane */
function pushUndo(){ const p=activeP(); if(!p)return;
  p.undo.push(p.drawings.slice()); if(p.undo.length>80)p.undo.shift(); }
function finishD(d){ const p=activeP(); if(!p)return;
  d.id=p.uidC++; pushUndo(); p.drawings.push(d); p.selId=d.id; setTool('cursor'); }
function hitTopmost(mx,my){
  const p=activeP(); if(!p||!p.geo||mx>p.geo.plotW||my>p.priceH)return null;
  const save=drawings; drawings=p.drawings;
  for(let i=p.drawings.length-1;i>=0;i--){
    const r=hitDrawing(p.drawings[i],mx,my);
    if(r){drawings=save;return{d:p.drawings[i],...r};} }
  drawings=save; return null; }
function applyHandle(d,h,md){
  switch(h.kind){
    case 'pt': d.pts[h.i]={gm:md.gm,p:md.p};break;
    case 'hlp': d.pts[0].p=md.p;break;
    case 'gm0': d.pts[0].gm=Math.min(md.gm,d.pts[1].gm-2);break;
    case 'gm1': d.pts[1].gm=Math.max(md.gm,d.pts[0].gm+2);break;
    case 't0': d.gm0=Math.min(md.gm,d.gm1-5);break;
    case 't1': d.gm1=Math.max(md.gm,d.gm0+5);break;
    case 'stop': d.pS=md.p;break;
    case 'tgt': d.pT=md.p;break; } }
function applyMove(d,orig,dgm,dp){
  if(d.type==='pos'){ d.gm0=orig.gm0+dgm;d.gm1=orig.gm1+dgm;
    d.pE=orig.pE+dp;d.pS=orig.pS+dp;d.pT=orig.pT+dp;return true; }
  d.pts=orig.pts.map(pt=>d.type==='vprofile'||d.type==='vbs'?{gm:pt.gm+dgm,p:pt.p}:{gm:pt.gm+dgm,p:pt.p+dp});
  return dgm!==0||dp!==0; }

/* text input */
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
    if(txtCtx.editD){ pushUndo(); const d=txtCtx.editD;
      if(d.type==='table'){ const rows=v.split(';').map(r=>r.split('|').map(c=>c.trim())).filter(r=>r.length&&r.some(c=>c));
        if(rows.length)d.rows=rows; } else d.text=v; }
    else if(txtCtx.kind==='table') finishD({type:'table',pts:[txtCtx.pt],
      rows:v.split(';').map(r=>r.split('|').map(c=>c.trim()))});
    else if(txtCtx.kind) finishD({type:txtCtx.kind,pts:[txtCtx.pt],text:v});
    else finishD({type:'text',pts:[txtCtx.pt],text:v}); }
  txtIn.style.display='none';txtCtx=null; }
on(txtIn,'keydown',e=>{ e.stopPropagation();
  if(e.key==='Enter')closeText(true); else if(e.key==='Escape')closeText(false); });
on(txtIn,'blur',()=>closeText(false));

/* keyboard */
addEventListener('keydown',e=>{
  if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='SELECT'))return;
  if(e.key==='1')paneSetTF(1); else if(e.key==='2')paneSetTF(3);
  else if(e.key==='3')paneSetTF(5); else if(e.key==='4')paneSetTF(15);
  else if(e.key==='g'||e.key==='G'){ if(tf>1){const p=activeP();p.ghost=!p.ghost;syncGhostUI();} }
  else if(e.key===' '){e.preventDefault();const b=qs('#pauseBtn');if(b)b.click();}
  else if(e.key==='r'||e.key==='R'){ const p=activeP(); if(p){p.view=null;p.yLo=p.yHi=null;} }
  else if(e.key==='Escape'){
    if(txtCtx)closeText(false);
    else if(flyEl)closeFly();
    else if(axMenuOpen)closeAxMenu();
    else if(placing)cancelPlacing();
    else if(pending){pending=null;chipTxt();}
    else if(tool!=='cursor')setTool('cursor');
    else{ const p=activeP(); if(p)p.selId=null; } }
  else if((e.key==='Delete'||e.key==='Backspace')){
    const p=activeP();
    if(p&&p.selId!=null){ pushUndo();p.drawings=p.drawings.filter(d=>d.id!==p.selId);p.selId=null; } }
  else if((e.key==='z'||e.key==='Z')&&(e.ctrlKey||e.metaKey)){
    e.preventDefault(); const p=activeP();
    if(p&&p.undo.length){p.drawings=p.undo.pop();p.selId=null;pending=null;chipTxt();} } });

/* axis add menu */
const axMenu=qs('#axMenu');
let placing=null, axMenuOpen=false;
function openAxMenu(){ if(!axMenu)return;
  axMenu.style.left=Math.max(4,(activeP()?.W||600)-180)+'px'; axMenu.style.top='24px';
  axMenu.hidden=false; axMenuOpen=true; }
function closeAxMenu(){ if(axMenu)axMenu.hidden=true; axMenuOpen=false; }
function chipPlacing(){
  const tc=qs('#toolChip'); if(!tc)return;
  if(!placing){tc.style.display='none';return;}
  tc.textContent={buy:'BUY MARKER — click a price level · ESC cancels',
    sell:'SELL MARKER — click a price level · ESC cancels',
    base:'SET BASELINE — click a price to anchor 0 · ESC cancels'}[placing];
  tc.style.display='block'; }
function startPlacing(kind){ placing=kind; closeAxMenu(); chipPlacing(); }
function cancelPlacing(){ if(!placing)return; placing=null; chipPlacing(); }
function placeAt(md){
  if(placing==='buy'||placing==='sell')
    finishD({type:'mark',side:placing,pts:[{gm:md.gm,p:md.p}]});
  else if(placing==='base'){ const p=activeP();
    if(p){ const src=paneBars(p); p.pctBase=clamp(md.p,(src[0]?.c||md.p)*0.2,(src[0]?.c||md.p)*5); } }
  placing=null; chipPlacing(); }
qsa('#axMenu button').forEach(b=>on(b,'click',e=>{e.stopPropagation();startPlacing(b.dataset.act);}));
document.addEventListener('click',e=>{
  if(axMenuOpen&&axMenu&&!axMenu.contains(e.target)&&e.target!==activeP()?.cv)closeAxMenu(); });

const fmtHM=gm=>{const m=((gm%SESSION)+SESSION)%SESSION,t=OPEN_MIN+m;
  return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');};
function line(x1,y1,x2,y2){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
function rr(x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function pill(x,y,w,h,txt){ctx.fillStyle='#171c23';ctx.strokeStyle='rgba(255,255,255,.16)';
  rr(x,y,w,h,4);ctx.fill();ctx.stroke();
  ctx.fillStyle=COL.ink;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(txt,x+w/2,y+h/2+0.5);}
function drawArrow(x0,y0,x1,y1,col,dash){
  ctx.strokeStyle=col;ctx.lineWidth=1.3;ctx.setLineDash(dash||[]);
  line(x0,y0,x1,y1);ctx.setLineDash([]);
  const a=Math.atan2(y1-y0,x1-x0);ctx.fillStyle=col;
  ctx.beginPath();ctx.moveTo(x1,y1);
  ctx.lineTo(x1-9*Math.cos(a-.42),y1-9*Math.sin(a-.42));
  ctx.lineTo(x1-9*Math.cos(a+.42),y1-9*Math.sin(a+.42));
  ctx.closePath();ctx.fill(); }
function legLabels(P,prev){
  ctx.font='600 9px '+MONO;ctx.textAlign='center';ctx.textBaseline='alphabetic';
  for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i];
    if(prev&&Math.abs(a.gm-b.gm)<1e-6&&Math.abs(a.p-b.p)<1e-9)continue;
    if(Math.abs(a.p)<1e-9)continue;
    const dv=(b.p-a.p)/a.p*100;
    ctx.fillStyle=dv>=0?'rgba(47,191,127,.9)':'rgba(229,72,77,.9)';
    ctx.fillText((dv>=0?'+':'−')+Math.abs(dv).toFixed(2)+'%',(geo.X(a.gm)+geo.X(b.gm))/2,(geo.Y(a.p)+geo.Y(b.p))/2-4);}}
function fmtDur(dmin){dmin=Math.max(0,Math.round(dmin));
  const d=Math.floor(dmin/375),r=dmin%375,h=Math.floor(r/60),m=r%60;
  if(d>0)return d+'d'+(h?' '+h+'h':'');
  if(h>0)return h+'h'+(m?' '+m+'m':'');
  return m+'m';}

/* ============ render loop ============ */
const lgTf=qs('#lgTf'),lgO=qs('#lgO'),lgH=qs('#lgH'),lgL=qs('#lgL'),lgC=qs('#lgC'),lgV=qs('#lgV'),lgRow2=qs('#lgRow2');
function frame(now){
  requestAnimationFrame(frame);
  panes.forEach(p=>{
    ctx=p.ctx; cv=p.cv; W=p.W||0; H=p.H||0;
    if(!ctx)return;
  // panes.forEach(p=>{
  //   const ctx=p.ctx; if(!ctx)return;
    ctx.setTransform(p.dpr||1,0,0,p.dpr||1,0,0);
    ctx.fillStyle=COL.bg;ctx.fillRect(0,0,p.W,p.H);
    if(p.W<60||p.H<60)return;
    if(!p.key){ ctx.fillStyle='rgba(214,218,224,.28)';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font='700 14px '+MONO;
      ctx.fillText('P'+(panes.indexOf(p)+1)+' · click a pane, then pick a symbol',p.W/2,p.H/2);
      return; }
    const src=paneBars(p);
    if(!src.length){ ctx.fillStyle='rgba(214,218,224,.28)';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font='700 14px '+MONO;ctx.fillText('NO DATA — '+SRC.toUpperCase(),p.W/2,p.H/2);return; }
    const plotW=p.W-AXIS_W, plotH=p.H-TIME_H;
    const volH=Math.max(26,plotH*0.13);
    const act=PANE_DEFS.filter(x=>x.on);
    const indPH=act.length?clamp(plotH*0.11,34,90):0;
    const priceH=Math.max(90,plotH-volH-indPH*act.length);
    const volBot=priceH+volH;
    const sp=paneSp(p), v=view0(p), leftGM=v.r-v.v;
    const gA=Math.max(0,Math.floor(leftGM)), gB=Math.min(src.length-1,Math.ceil(v.r));
    let lo=1e18,hi=-1e18,vmax=0,vmax1=0;
    for(let g=gA;g<=gB;g++){const x=src[g];if(x.l<lo)lo=x.l;if(x.h>hi)hi=x.h;if(x.v>vmax1)vmax1=x.v;}
    const agg=paneAgg(p,p.tf);
    const b0=Math.max(0,Math.floor(leftGM/p.tf)), b1=Math.min(agg.length-1,Math.floor(v.r/p.tf));
    for(let b=b0;b<=b1;b++)if(agg[b].v>vmax)vmax=agg[b].v;
    const manual=p.pMode==='manual'&&p.mHi>p.mLo;
    const pad=(hi-lo)*0.08+(src[src.length-1].c)*0.0003;
    const tLo=manual?p.mLo:lo-pad, tHi=manual?p.mHi:hi+pad;
    if(p.yLo===null){p.yLo=tLo;p.yHi=tHi;p.volMax=vmax||1;p.volMax1=vmax1||1;}
    else{p.yLo+=(tLo-p.yLo)*0.22;p.yHi+=(tHi-p.yHi)*0.22;
      p.volMax+=((vmax||1)-p.volMax)*0.22;p.volMax1+=((vmax1||1)-p.volMax1)*0.22;}
    const Y=pp=>(1-(pp-p.yLo)/(p.yHi-p.yLo))*priceH;
    const X=gm=>plotW-(v.r-gm)*sp;
    p.priceH=priceH;
    Object.assign(geo,{sp,plotW,priceH,X,Y,yLo:p.yLo,yHi:p.yHi});
    p.geo={sp,plotW,priceH,X,Y,yLo:p.yLo,yHi:p.yHi};
    // p.priceH=priceH;
    // Object.assign(geo,{sp,plotW,priceH,X,Y,yLo:p.yLo,yHi:p.yHi});
    RD_BARS=src;
    const effGhost=p.ghost&&p.tf>1;
    const la=la0(sp);
    const rel=SORDER.some(s=>scales[s]&&s!=='price');
    const prim=SORDER.find(s=>scales[s])||'price';
    const primX0=rel?plotW+MCOLW:plotW;
    ctx.fillStyle='rgba(255,255,255,.014)';
    ctx.fillRect(plotW,0,p.W-plotW,plotH); ctx.fillRect(0,plotH,p.W,TIME_H);
    ctx.font='10px '+MONO;ctx.textAlign='left';ctx.textBaseline='middle';ctx.lineWidth=1;
    if(prim==='price'){
      const raw=(p.yHi-p.yLo)/6, pow=Math.pow(10,Math.floor(Math.log10(raw)));
      const st=(raw/pow<1.5?1:raw/pow<3.5?2:raw/pow<7.5?5:10)*pow;
      ctx.strokeStyle=COL.grid;ctx.fillStyle=COL.dim;
      for(let i=Math.ceil(p.yLo/st);i*st<=p.yHi;i++){
        const gy=cr(Y(i*st));line(0,gy,plotW,gy);
        ctx.fillText((i*st).toFixed(2),primX0+8,gy); }
    }else{
      const base=p.pctBase||src[0].c;
      const isPts=prim==='pts';
      const valOf=pp=>isPts?pp-base:(pp-base)/base*100;
      const priceOf=vv=>isPts?base+vv:base*(1+vv/100);
      const span=Math.max(1e-9,valOf(p.yHi)-valOf(p.yLo));
      const st=(PTS_STEPS||[]).concat(PCT_STEPS).length&&((isPts?[0.5,1,2,5,10,20,50,100]:[0.05,0.1,0.25,0.5,1,2,5,10]).find(s=>span/s<=8)||1e7);
      ctx.strokeStyle=COL.grid;ctx.fillStyle=COL.dim;
      for(let k=Math.ceil(valOf(p.yLo)/st);k<=Math.floor(valOf(p.yHi)/st);k++){
        if(k===0)continue;
        const gy=cr(Y(priceOf(k*st))); if(gy<-1||gy>priceH+1)continue;
        line(0,gy,plotW,gy);
        const dv=prim==='inv'?-k*st:k*st;
        ctx.fillText((dv>=0?'+':'−')+(isPts?Math.abs(dv).toFixed(1):Math.abs(dv).toFixed(2)+'%'),primX0+8,gy); } }
    const stepT=[5,10,15,30,60,120,240,480].find(s=>s*sp>=56)||480;
    ctx.textAlign='center';
    for(let gmT=Math.max(0,Math.ceil(leftGM/stepT)*stepT);gmT<=v.r;gmT+=stepT){
      if(gmT>=src.length)break;
      const xi=cr(X(gmT));
      ctx.strokeStyle=COL.grid;line(xi,0,xi,plotH);
      ctx.fillStyle=COL.dim;ctx.fillText(fmtHM(gmT),X(gmT),plotH+TIME_H/2+1); }
    const d0=Math.floor(leftGM/SESSION);
    for(let d=Math.max(0,d0);d*SESSION<src.length&&d*SESSION<=v.r;d++){
      const xi=cr(X(d*SESSION));
      ctx.strokeStyle=COL.gridStrong;line(xi,0,xi,plotH); }
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
        ctx.fillRect(xs,yT,Math.max(2,xe-xs),yB-yT);
        drawn++; }
      ctx.restore(); }
    const aggA=effGhost?0.22*(1-la):0.22;
    if(aggA>0.012){
      ctx.globalAlpha=aggA;
      for(let b=b0;b<=b1;b++){
        const k=agg[b];
        ctx.fillStyle=k.c>=k.o?COL.up:COL.dn;
        const vh=Math.max(1,k.v/p.volMax*(volH-6));
        ctx.fillRect(X(k.g0)+(X(k.g1)-X(k.g0))*0.17,volBot-vh,Math.max(1,(X(k.g1)-X(k.g0))*0.66),vh); }
      ctx.globalAlpha=1; }
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
    for(let b=b0;b<=b1;b++){
      const k=agg[b];
      const col=k.c>=k.o?COL.up:COL.dn;
      const x0=X(k.g0),x1=X(k.g1),ins=(x1-x0)*0.17;
      const bx=x0+ins,bw=Math.max(1,(x1-x0)*0.66),cx=(x0+x1)/2;
      const yHv=Y(k.h),yLv=Y(k.l);
      const top=Y(Math.max(k.o,k.c)),yBo=Y(Math.min(k.o,k.c)),bh=Math.max(1,yBo-top);
      ctx.strokeStyle=col;ctx.fillStyle=col;
      ctx.lineWidth=1;ctx.globalAlpha=effGhost?0.85:1;
      if(bw<2.6){
        line(cr(cx),yHv,cr(cx),yLv);
        ctx.lineWidth=Math.max(2,bw);line(cr(cx),top,cr(cx),top+bh);
      }else if(effGhost){
        if(top-yHv>0.3)line(cr(cx),yHv,cr(cx),top+0.5);
        if(yLv-yBo>0.3)line(cr(cx),yBo-0.5,cr(cx),yLv);
        ctx.globalAlpha=0.17;ctx.fillRect(bx,top,bw,bh);
        ctx.globalAlpha=0.9;ctx.lineWidth=1.5;ctx.strokeRect(bx,top,bw,bh);
      }else{ ctx.globalAlpha=1;line(cr(cx),yHv,cr(cx),yLv);ctx.fillRect(bx,top,bw,bh); } }
    ctx.globalAlpha=1;
    axisTags=[];
    ctx.save();ctx.beginPath();ctx.rect(0,0,plotW,priceH);ctx.clip();
    for(const d of p.drawings)renderDrawing(d,{});
    if(panes.indexOf(p)===activePane&&pending)renderDrawing(pending,{preview:true});
    if(panes.indexOf(p)===activePane&&p.selId!=null){
      const sd=p.drawings.find(d=>d.id===p.selId);
      if(sd)for(const h of handlesOf(sd)){
        ctx.fillStyle='#e8ecf1';ctx.strokeStyle='#0c0e11';ctx.lineWidth=1.2;
        ctx.fillRect(h.x-3.5,h.y-3.5,7,7);ctx.strokeRect(h.x-2.5,h.y-2.5,5,5); } }
    ctx.restore();
    for(const t of axisTags){
      ctx.fillStyle=t.c;rr(primX0+2,t.y-9,p.W-primX0-4,18,4);ctx.fill();
      ctx.fillStyle='#0c0e11';ctx.font='600 9.5px '+MONO;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(t.text,primX0+2+(p.W-primX0-4)/2,t.y); }
    const lp=src[src.length-1].c, ly=Y(lp);
    if(ly>-8&&ly<priceH+8){
      ctx.strokeStyle=COL.acc;ctx.globalAlpha=.55;ctx.setLineDash([3,4]);
      line(0,cr(ly),plotW,cr(ly));ctx.setLineDash([]);ctx.globalAlpha=1;
      ctx.fillStyle=COL.acc;rr(primX0+2,ly-9,p.W-primX0-4,18,4);ctx.fill();
      ctx.fillStyle='#10131a';ctx.font='600 9.5px '+MONO;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(fmtP(lp),primX0+2+(p.W-primX0-4)/2,ly); }
    const IND=paneInd(p);
    let top=volBot;
    for(const pd of act){
      ctx.strokeStyle='#1d232c';line(0,cr(top),p.W,cr(top));
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
    const inP=p.mouse.in&&p.mouse.x>=0&&p.mouse.x<=plotW&&p.mouse.y>=0&&p.mouse.y<=plotH;
    if(inP){
      const gmAt=v.r-(plotW-p.mouse.x)/sp;
      const cgm=clamp(Math.floor(gmAt),0,src.length-1);
      const sx=cr(X(cgm+0.5));
      ctx.strokeStyle='rgba(255,255,255,.2)';ctx.setLineDash([4,4]);
      line(sx,0,sx,plotH);
      if(p.mouse.y<=priceH){
        line(0,cr(p.mouse.y),plotW,cr(p.mouse.y));
        const pv=clamp(p.yHi-(p.mouse.y/priceH)*(p.yHi-p.yLo),p.yLo,p.yHi);
        const pw=ctx.measureText(fmtP(pv)).width+14;
        pill(Math.max(2,p.W-2-pw),p.mouse.y-9,pw,18,fmtP(pv)); }
      ctx.setLineDash([]);
      const txt=fmtHM(cgm),w=ctx.measureText(txt).width+14;
      pill(clamp(X(cgm+0.5)-w/2,2,plotW-w-2),plotH+4,w,TIME_H-8,txt); }
    ctx.strokeStyle='#20262f';
    line(cr(plotW),0,cr(plotW),p.H);line(0,cr(plotH),p.W,cr(plotH)); });
  /* legend follows active pane */
  const p=activeP();
  if(p&&p.key&&lgRow2){
    const src=paneBars(p);
    if(src.length){
      const s=src[src.length-1];
      if(lgTf)lgTf.textContent=p.tf+'m';
      if(lgO){lgO.textContent=fmtP(s.o);lgH.textContent=fmtP(s.h);
        lgL.textContent=fmtP(s.l);lgC.textContent=fmtP(s.c);lgV.textContent=fmtV(s.v);
        const cc=s.c>=s.o?COL.up:COL.dn;
        [lgO,lgH,lgL,lgC,lgV].forEach(el=>el.style.color=cc); }
      const q=quotes.get(p.key);
      const chg=q&&q.prevClose?((q.ltp-q.prevClose)/q.prevClose*100):0;
      lgRow2.innerHTML=`P${activePane+1} · ${paneTitle(p.key)} · ${q?fmtP(q.ltp):'—'} <b class="${chg>=0?'u':'d'}">${(chg>=0?'+':'')+chg.toFixed(2)}%</b>`; } } }
