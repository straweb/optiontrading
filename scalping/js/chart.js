'use strict';
const COL={bg:'#0a0c10',grid:'rgba(255,255,255,.045)',gridStrong:'rgba(255,255,255,.11)',
  ink:'#d6dae0',dim:'#8b95a1',up:'#2fbf7f',dn:'#e5484d',acc:'#e0a63f'};
const AXIS_W=92, MCOLW=40, TIME_H=26;
const scales={price:true,pct:true,inv:false,pts:false};
const SORDER=['price','pct','inv','pts'];
const MONO='"IBM Plex Mono", monospace';
let paused=false, fvgOn=true, vwOn=true;
const bars=[];                                     /* active-symbol mirror (ticket/LTP) */
let price=0, lastPrice=0;
document.querySelector('#ovSeg').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
  if(b.dataset.o==='fvg'){fvgOn=!fvgOn;b.classList.toggle('on',fvgOn);}
  else{vwOn=!vwOn;b.classList.toggle('on',vwOn);} }));
document.querySelector('#pauseBtn').addEventListener('click',()=>{
  paused=!paused;
  document.querySelector('#icPause').style.display=paused?'none':'block';
  document.querySelector('#icPlay').style.display=paused?'block':'none';
  document.querySelector('#live').classList.toggle('paused',paused);
  document.querySelector('#liveTxt').textContent=paused?'PAUSED':'LIVE'; });
document.querySelector('#resetBtn').addEventListener('click',()=>{
  const p=activeP(); p.view=null; p.yLo=p.yHi=null; });
document.querySelector('#latestBtn').addEventListener('click',()=>{
  const p=activeP(); p.view=null; p.yLo=p.yHi=null; });

/* per-pane data helpers */
function paneAgg(p,t){
  if(p.aggDirty){p.aggCache.clear();p.aggDirty=false;}
  if(!p.aggCache.has(t)){
    const src=p.key===SYM?.key?bars:(dataCache.get(p.key)?.bars||[]);
    const arr=[],n=Math.ceil(src.length/t);
    for(let b=0;b<n;b++){
      const g0=b*t,g1=Math.min(g0+t,src.length);
      let h=-1e18,l=1e18,v=0;
      for(let g=g0;g<g1;g++){const x=src[g];if(x.h>h)h=x.h;if(x.l<l)l=x.l;v+=x.v;}
      arr.push({g0,g1,o:src[g0].o,h,l,c:src[g1-1].c,v}); }
    p.aggCache.set(t,arr); }
  return p.aggCache.get(t); }
function paneBars(p){ return p.key===SYM?.key?bars:(dataCache.get(p.key)?.bars||[]); }
function paneInd(p){
  if(p.indCache&&p.indCache.ver===p.dataVer)return p.indCache.d;
  const A=paneAgg(p,p.tf);
  const c=A.map(k=>k.c),h=A.map(k=>k.h),l=A.map(k=>k.l);
  const d={rsi:rsiArr(c,14),macd:macdArr(c),adx:adxArr(h,l,c,14)};
  p.indCache={ver:p.dataVer,d};return d; }
function paneFVG(p){
  const src=paneBars(p); const key='f'+p.dataVer;
  if(p._fvgVer===key)return p._fvg;
  const list=[];
  for(let i=1;i<src.length-1;i++){
    const a=src[i-1],b=src[i+1];
    if(b.l>a.h)list.push({top:b.l,bot:a.h,gm:i+1,dir:1,fill:0,gone:false});
    else if(b.h<a.l)list.push({top:a.l,bot:b.h,gm:i+1,dir:-1,fill:0,gone:false}); }
  for(const f of list){
    for(let j=f.gm+1;j<src.length;j++){const x=src[j];
      if(f.dir===1){ if(x.l<=f.bot){f.gone=true;break;} if(!f.fill&&x.l<f.top)f.fill=j; }
      else{ if(x.h>=f.top){f.gone=true;break;} if(!f.fill&&x.h>f.bot)f.fill=j; } } }
  p._fvgVer=key;p._fvg=list;return list; }

/* pane interactions (identical semantics, per-pane state) */
function bindPaneEvents(){
  panes.forEach((p,idx)=>{
    const cv=p.cv;
    new ResizeObserver(()=>{
      p.dpr=window.devicePixelRatio||1;
      p.W=cv.clientWidth;p.H=cv.clientHeight;
      cv.width=Math.round(p.W*p.dpr);cv.height=Math.round(p.H*p.dpr);
    }).observe(cv);
    cv.addEventListener('pointerdown',e=>{ e.preventDefault();
      if(activePane!==idx){activePane=idx;layoutUI();syncPaneUI();syncGhostUI();}
      p._drag={x:e.offsetX,y:e.offsetY,r:view0(p).r,moved:false};
      cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove',e=>{
      p.mouse={x:e.offsetX,y:e.offsetY,in:true};
      if(p._drag){
        p._drag.moved=true;
        const v=view0(p);
        v.r=clampR(v.r-(e.offsetX-p._drag.x)/paneSp(p));
        const dy=e.offsetY-p._drag.y;
        if(Math.abs(dy)>2){
          const R=v.hi-v.lo;
          v.lo+=dy*R/p.priceH; v.hi+=dy*R/p.priceH; p.pMode='manual'; } } });
    cv.addEventListener('pointerup',()=>{ p._drag=null; });
    cv.addEventListener('pointerleave',()=>{ p.mouse.in=false; });
    cv.addEventListener('wheel',e=>{
      e.preventDefault();
      const v=view0(p);
      const nv=clamp(v.v*Math.exp(e.deltaY*0.0011),40,2400);
      const anchor=v.r-(panePlotW(p)-e.offsetX)/paneSp(p);
      v.r=anchor+(panePlotW(p)-e.offsetX)/(panePlotW(p)/nv); v.v=nv; },{passive:false});
    cv.addEventListener('dblclick',()=>{ const p2=activeP();
      if(panes[idx].key){ panes[idx].view=null; panes[idx].yLo=panes[idx].yHi=null; } }); }); }
function view0(p){ if(!p.view){ const src=paneBars(p);
    p.view={r:src.length+20,v:Math.min(260,Math.max(60,src.length))}; }
  return p.view; }
function panePlotW(p){ return p.W-AXIS_W; }
function paneSp(p){ return panePlotW(p)/view0(p).v; }
function clampR(r){ const src=paneBars(activeP());
  return clamp(r,view0(activeP()).v-30,src.length+90); }
/* placeholder drawing ops shared from tools.js — per pane use its own arrays */
function paneCommit(){ /* drawings per pane: tools add to activeP().drawings via finishD override */ }
const _finishD=finishD;
finishD=function(d){ const p=activeP();
  d.id=p.uidC++; p.undo.push(p.drawings.slice()); if(p.undo.length>80)p.undo.shift();
  p.drawings.push(d); p.selId=d.id; setTool('cursor'); };
const _hitTop=hitTopmost;
hitTopmost=function(mx,my){ const p=activeP();
  const save={d:drawings};
  drawings=p.drawings;
  const r=_hitTop(mx,my);
  drawings=save.d;
  return r; };
const _pushUndo=pushUndo;
pushUndo=function(){ const p=activeP();
  p.undo.push(p.drawings.slice()); if(p.undo.length>80)p.undo.shift(); };
/* legend refs */
const lgTf=document.querySelector('#lgTf'),lgO=document.querySelector('#lgO'),lgH=document.querySelector('#lgH'),
  lgL=document.querySelector('#lgL'),lgC=document.querySelector('#lgC'),lgChg=document.querySelector('#lgChg'),
  lgV=document.querySelector('#lgV'),lgRow2=document.querySelector('#lgRow2');
const fmtHM=gm=>{const m=((gm%SESSION)+SESSION)%SESSION,t=OPEN_MIN+m;
  return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');};
const fmtEnd=gm=>gm%SESSION===0?'15:30':fmtHM(gm);
function frame(now){
  requestAnimationFrame(frame);
  panes.forEach(p=>{
    const ctx=p.ctx;
    ctx.setTransform(p.dpr,0,0,p.dpr,0,0);
    ctx.fillStyle=COL.bg;ctx.fillRect(0,0,p.W,p.H);
    if(p.W<60||p.H<60)return;
    if(!p.key){ ctx.fillStyle='rgba(214,218,224,.25)';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font='700 14px '+MONO;
      ctx.fillText('P'+(panes.indexOf(p)+1)+' · pick a symbol',p.W/2,p.H/2);
      return; }
    const src=paneBars(p);
    if(!src.length){ ctx.fillStyle='rgba(214,218,224,.25)';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font='700 14px '+MONO;ctx.fillText('NO DATA — '+SRC.toUpperCase(),p.W/2,p.H/2);return; }
    const plotW=p.W-AXIS_W, plotH=p.H-TIME_H;
    const volH=Math.max(26,plotH*0.14);
    const act=PANE_DEFS.filter(x=>x.on);
    const priceH=Math.max(90,plotH-volH-act.length*Math.max(34,plotH*0.1));
    const volBot=priceH+volH;
    const sp=paneSp(p), v=view0(p), leftGM=v.r-v.v;
    p.priceH=priceH;
    p.geo={sp,plotW,priceH,X:gm=>plotW-(v.r-gm)*sp,Y:null,yLo:0,yHi:1};
    const gA=Math.max(0,Math.floor(leftGM)), gB=Math.min(src.length-1,Math.ceil(v.r));
    let lo=1e18,hi=-1e18,vmax=0,vmax1=0;
    for(let g=gA;g<=gB;g++){const x=src[g];if(x.l<lo)lo=x.l;if(x.h>hi)hi=x.h;if(vmax1<x.v)vmax1=x.v;}
    const effGhost=p.ghost&&p.tf>1;
    const b0=Math.max(0,Math.floor(leftGM/p.tf)),b1=Math.min(paneAgg(p,p.tf).length-1,Math.floor(v.r/p.tf));
    for(let b=b0;b<=b1;b++){if(paneAgg(p,p.tf)[b].v>vmax)vmax=paneAgg(p,p.tf)[b].v;}
    const manual=p.pMode==='manual';
    const pad=(hi-lo)*0.08+(src[src.length-1].c)*0.0003;
    const tLo=manual?p.mLo:lo-pad, tHi=manual?p.mHi:hi+pad;
    if(p.yLo===null){p.yLo=tLo;p.yHi=tHi;p.volMax=vmax||1;p.volMax1=vmax1||1;}
    else{p.yLo+=(tLo-p.yLo)*0.22;p.yHi+=(tHi-p.yHi)*0.22;
      p.volMax+=((vmax||1)-p.volMax)*0.22;p.volMax1+=((vmax1||1)-p.volMax1)*0.22;}
    const Y=pp=>(1-(pp-p.yLo)/(p.yHi-p.yLo))*priceH;
    const X=gm=>plotW-(v.r-gm)*sp;
    p.geo.Y=Y;p.geo.yLo=p.yLo;p.geo.yHi=p.yHi;
    const rel=anyRel(), prim=primScale();
    const primX0=rel?plotW+MCOLW:plotW;
    ctx.fillStyle='rgba(255,255,255,.014)';
    ctx.fillRect(plotW,0,AXIS_W,plotH); ctx.fillRect(0,plotH,p.W,TIME_H);
    ctx.font='10px '+MONO;ctx.textAlign='left';ctx.textBaseline='middle';ctx.lineWidth=1;
    const tickPts=[];
    if(prim==='price'){
      const raw=(p.yHi-p.yLo)/6, pow=Math.pow(10,Math.floor(Math.log10(raw)));
      const st=(raw/pow<1.5?1:raw/pow<3.5?2:raw/pow<7.5?5:10)*pow;
      ctx.strokeStyle=COL.grid;ctx.fillStyle=COL.dim;
      for(let i=Math.ceil(p.yLo/st);i*st<=p.yHi;i++){
        const gy=cr(Y(i*st));
        line(0,gy,plotW,gy);ctx.fillText((i*st).toFixed(2),primX0+8,gy);
        tickPts.push({gy,p:i*st}); }
    }else{
      const base=p.pctBase||src[0].c;
      const isPts=prim==='pts';
      const valOf=pp=>isPts?pp-base:(pp-base)/base*100;
      const priceOf=vv=>isPts?base+vv:base*(1+vv/100);
      const span=Math.max(1e-9,valOf(p.yHi)-valOf(p.yLo));
      const st=(isPts?PTS_STEPS:PCT_STEPS).find(s=>span/s<=8)||1e7;
      ctx.strokeStyle=COL.grid;ctx.fillStyle=COL.dim;
      for(let k=Math.ceil(valOf(p.yLo)/st);k<=Math.floor(valOf(p.yHi)/st);k++){
        if(k===0)continue;
        const gy=cr(Y(priceOf(k*st)));
        if(gy<-1||gy>priceH+1)continue;
        line(0,gy,plotW,gy);
        const dv=prim==='inv'?-k*st:k*st;
        ctx.fillText(isPts?(dv>=0?'+':'−')+Math.abs(dv).toFixed(2):(dv>=0?'+':'−')+Math.abs(dv).toFixed(2)+'%',primX0+8,gy);
        tickPts.push({gy,p:priceOf(k*st)}); } }
    const dayXs=[];
    for(let d=Math.max(0,Math.ceil(leftGM/SESSION));d*SESSION<src.length&&d*SESSION<=v.r;d++)
      dayXs.push({gm:d*SESSION,xi:X(d*SESSION),d});
    const stepT=[5,10,15,30,60,120,240,480].find(s=>s*sp>=56)||480;
    ctx.textAlign='center';
    for(let gmT=Math.max(0,Math.ceil(leftGM/stepT)*stepT);gmT<=v.r;gmT+=stepT){
      if(gmT>=src.length)break;
      const xi=X(gmT);
      if(dayXs.some(o=>Math.abs(o.xi-xi)<28))continue;
      ctx.strokeStyle=COL.grid;line(cr(xi),0,cr(xi),plotH);
      ctx.fillStyle=COL.dim;ctx.fillText(fmtHM(gmT),xi,plotH+TIME_H/2+1); }
    for(const o of dayXs){
      ctx.strokeStyle=COL.gridStrong;line(cr(o.xi),0,cr(o.xi),plotH);
      ctx.fillStyle='#9aa3ae';ctx.font='600 9.5px '+MONO;ctx.textAlign='left';
      ctx.fillText('DAY '+(o.d+1),o.xi+5,plotH+TIME_H/2+1);ctx.textAlign='center';ctx.font='10px '+MONO; }
    if(fvgOn){
      const list=paneFVG(p);
      ctx.save();ctx.beginPath();ctx.rect(0,0,plotW,priceH);ctx.clip();
      let drawn=0;
      for(let i=list.length-1;i>=0&&drawn<40;i--){
        const f=list[i]; if(f.gone)continue;
        const xs=X(f.gm); if(xs>plotW)continue;
        const xe=f.fill?X(f.fill):plotW;
        if(xe<0)continue;
        const yT=Y(f.top),yB=Y(f.bot); if(yB-yT<1.5)continue;
        const a=f.fill?0.055:0.11;
        ctx.fillStyle=f.dir===1?`rgba(47,191,127,${a})`:`rgba(229,72,77,${a})`;
        ctx.fillRect(xs,yT,Math.max(2,xe-xs),yB-yT);
        drawn++; }
      ctx.restore(); }
    const ghostVol=effGhost;
    const aggA=ghostVol?0.22*(1-la0(sp)):0.22;
    if(aggA>0.012){
      ctx.globalAlpha=aggA;
      for(let b=b0;b<=b1;b++){
        const k=paneAgg(p,p.tf)[b];
        ctx.fillStyle=k.c>=k.o?COL.up:COL.dn;
        const vh=Math.max(1,k.v/p.volMax*(volH-6));
        ctx.fillRect(X(k.g0)+((X(k.g1)-X(k.g0))*0.17),volBot-vh,Math.max(1,(X(k.g1)-X(k.g0))*0.66),vh); }
      ctx.globalAlpha=1; }
    if(effGhost){
      for(let b=b0;b<=b1;b++){
        for(let g=Math.max(gA,paneAgg(p,p.tf)[b].g0),e0=paneAgg(p,p.tf)[b].g0;g<=Math.min(gB,paneAgg(p,p.tf)[b].g1-1);g++){
          const bar=src[g], cx=X(g+0.5);
          if(cx<-6||cx>plotW+6)continue;
          const up2=bar.c>=bar.o, col=up2?COL.up:COL.dn;
          const a=0.62*la0(sp); if(a<=0.015)continue;
          const yH=Y(bar.h),yL=Y(bar.l),yO=Y(bar.o),yC=Y(bar.c);
          const top=Math.min(yO,yC),bot=Math.max(yO,yC),bh=Math.max(1,bot-top);
          ctx.globalAlpha=a;ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=1;
          const gw=Math.max(1.2,sp*0.46);
          if(gw>=2.6){
            if(top-yH>0.3)line(cr(cx),yH,cr(cx),top+0.5);
            if(yL-bot>0.3)line(cr(cx),bot-0.5,cr(cx),yL);
            if(p.ghostStyle==='fade'){ctx.globalAlpha=a*0.16;ctx.fillRect(cx-gw/2,top,gw,bh);ctx.globalAlpha=a;}
            ctx.strokeRect(cx-gw/2,top,gw,bh);
          }else ctx.fillRect(cx-gw/2,top,gw,bh); } }
      ctx.globalAlpha=1; }
    for(let b=b0;b<=b1;b++){
      const k=paneAgg(p,p.tf)[b];
      const up2=k.c>=k.o, col=up2?COL.up:COL.dn;
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
      }else{
        ctx.globalAlpha=1;line(cr(cx),yHv,cr(cx),yLv);ctx.fillRect(bx,top,bw,bh); } }
    ctx.globalAlpha=1;
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
      const padT=8,padB=6,ph=Math.max(34,plotH*0.1)-padT-padB;
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
      ctx.save();ctx.beginPath();ctx.rect(0,top+1,plotW,Math.max(34,plotH*0.1)-1);ctx.clip();
      if(histD){for(let b=b0;b<=b1;b++){const vv=histD[b];if(vv==null)continue;
          const w=Math.max(1,(X(paneAgg(p,p.tf)[b].g1)-X(paneAgg(p,p.tf)[b].g0))*0.42);
          const y0=PY(0),y1=PY(vv);
          ctx.fillStyle=vv>=0?'rgba(47,191,127,.45)':'rgba(229,72,77,.45)';
          ctx.fillRect(X(paneAgg(p,p.tf)[b].g0+p.tf/2)-w/2,Math.min(y0,y1),w,Math.max(1,Math.abs(y1-y0)));}}
      for(const s of series){ctx.strokeStyle=s.c;ctx.lineWidth=s.w;
        ctx.beginPath();let st=false;
        for(let b=b0;b<=b1;b++){const vv=s.d[b];if(vv==null){st=false;continue;}
          const x=X(paneAgg(p,p.tf)[b].g0+p.tf/2),y=PY(vv);
          if(!st){ctx.moveTo(x,y);st=true;}else ctx.lineTo(x,y);}
        ctx.stroke();}
      ctx.restore();
      top+=Math.max(34,plotH*0.1); }
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
    line(cr(plotW),0,cr(plotW),p.H);line(0,cr(plotH),p.W,cr(plotH));
    if(rel)line(cr(primX0),0,cr(primX0),p.H); });
  /* single legend follows active pane */
  const p=activeP();
  if(p&&p.key){
    const src=paneBars(p);
    if(src.length){
      const i=clamp(src.length-1,0,src.length-1);
      const show=src[i];
      lgTf.textContent=p.tf+'m';
      lgO.textContent=fmtP(show.o);lgH.textContent=fmtP(show.h);
      lgL.textContent=fmtP(show.l);lgC.textContent=fmtP(show.c);
      const pc=show.c>=show.o?COL.up:COL.dn;
      [lgO,lgH,lgL,lgC,lgV].forEach(el=>el.style.color=pc);
      lgV.textContent=fmtV(show.v);
      const q=quotes.get(p.key);
      const chg=q&&q.prevClose?((q.ltp-q.prevClose)/q.prevClose*100):0;
      lgRow2.innerHTML=`P${activePane+1} · ${paneTitle(p.key)} · ${q?fmtP(q.ltp):'—'} <b class="${chg>=0?'u':'d'}">${(chg>=0?'+':'')+chg.toFixed(2)}%</b>`; } } }
function la0(sp){ return clamp((sp-1.5)/1.8,0,1); }
