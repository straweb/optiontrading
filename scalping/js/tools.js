'use strict';
/* drawing tools — registry, toolbar, geometry, rendering */
const DCOL={def:'#5fb0d8',fib:'#e0a63f',text:'#d6dae0',free:'#cfd6de',pat:'#b48ce0'};
const FIBL=[0,.236,.382,.5,.618,.786,1];
const EXTL=[0,0.618,1,1.618,2.618];
const FANR=[0.236,0.382,0.5,0.618,0.786,1];
const CIRCLR=[0.382,0.618,1,1.618,2.618];
const TZL=[1,2,3,5,8,13,21,34,55,89,144];
const PATS=new Set(['abcd','dbltop','dblbot','hns','ihns','tri','wedge']);
const EDITABLE=new Set(['text','comment','callout','pin','pricenote','table']);
const NPTS={trend:2,ray:2,arrow:2,rect:2,ellipse:2,fib:2,fibext:2,fan:2,circles:2,tzones:2,
  tbfib:3,pitchfork:3,pricerange:2,daterange:2,pricedate:2,vprofile:2,vbs:2,
  abcd:4,dbltop:4,dblbot:4,hns:5,ihns:5,tri:5,wedge:5,projection:3,forecast:2,callout:2};
const CHIP={trend:'TREND LINE — click start, click end',ray:'RAY — click origin, click direction',
  arrow:'ARROW — click start, click end',hline:'H LINE — click to place',hray:'H RAY — click to place',
  rect:'RECTANGLE — click two corners',ellipse:'ELLIPSE — click two corners',
  fib:'FIB RETRACE — click swing high & low',fibext:'FIB EXTENSION — click swing A, click swing B',
  tbfib:'TREND-BASED FIB EXT — click 3 pivots',fan:'FIB SPEED FAN — click origin, click second point',
  circles:'FIB CIRCLES — click center, click radius',tzones:'FIB TIME ZONES — click start, click one unit',
  pitchfork:'PITCHFORK — click 3 pivots',pricerange:'PRICE RANGE — click start, click end',
  daterange:'DATE RANGE — click start, click end',pricedate:'PRICE + DATE RANGE — click start, click end',
  vprofile:'VOLUME PROFILE — drag or click range start & end',
  vbs:'BUY/SELL VOLUME — click range start & end',
  abcd:'AB=CD — click 4 points',dbltop:'DOUBLE TOP — click 4 points',dblbot:'DOUBLE BOTTOM — click 4 points',
  hns:'HEAD & SHOULDERS — click 5 points',ihns:'INVERTED H&S — click 5 points',
  tri:'TRIANGLE — click 5 points',wedge:'WEDGE — click 5 points',
  projection:'PROJECTION — click A→B then target',forecast:'FORECAST — click start, click target',
  long:'LONG POSITION — click entry',short:'SHORT POSITION — click entry',text:'TEXT — click to type',
  comment:'COMMENT — click to place',callout:'CALLOUT — click anchor, click label',
  pin:'PIN — click to place',pricenote:'PRICE NOTE — click a price level',
  table:'TABLE — click to place · dbl-click to edit',free:'PENCIL — draw freehand'};
const toolChip=document.querySelector('#toolChip');
const toolsWrap=document.querySelector('#tools');
function chipTxt(){
  if(!CHIP[tool]){toolChip.style.display='none';return;}
  let t=CHIP[tool];
  if(pending&&NPTS[pending.type])
    t+=NPTS[pending.type]===2?' · click end point · ESC cancels':` · point ${pending.n+1}/${NPTS[pending.type]} · ESC cancels`;
  toolChip.textContent=t;toolChip.style.display='block'; }
function handlesOf(d){ const out=[],X=geo.X,Y=geo.Y;
  const add=(x,y,kind,i)=>out.push({x,y,kind,i});
  switch(d.type){
    case 'trend':case 'ray':case 'arrow':case 'rect':case 'ellipse':case 'fib':
    case 'fibext':case 'fan':case 'circles':case 'tzones':case 'tbfib':case 'pitchfork':
    case 'pricerange':case 'daterange':case 'pricedate':case 'forecast':case 'projection':case 'callout':
      if(PATS.has(d.type)||NPTS[d.type])d.pts.forEach((p,i)=>add(X(p.gm),Y(p.p),'pt',i));break;
    case 'hline': case 'mark': case 'pricenote': add(X(d.pts[0].gm),Y(d.pts[0].p),'hlp',0);break;
    case 'hray': case 'comment': case 'pin': case 'text': add(X(d.pts[0].gm),Y(d.pts[0].p),'pt',0);break;
    case 'vprofile': case 'vbs':{
      const vp=(d.type==='vprofile'?computeVP:computeBSV)(d.pts[0].gm,d.pts[1].gm);
      const ym=Y(vp?(vp.lo+vp.hi)/2:0);
      add(X(d.pts[0].gm),ym,'gm0',0);add(X(d.pts[1].gm),ym,'gm1',1);break;}
    case 'pos':
      add(X(d.gm0),Y(d.pE),'t0');add(X(d.gm1),Y(d.pE),'t1');
      add(X(d.gm1),Y(d.pS),'stop');add(X(d.gm1),Y(d.pT),'tgt');break; }
  return out; }
function hitDrawing(d,mx,my){
  const X=geo.X,Y=geo.Y;
  for(const h of handlesOf(d)) if(Math.abs(mx-h.x)<7&&Math.abs(my-h.y)<7)return{h};
  const near=(x1,y1,x2,y2,tol=6)=>distSeg(mx,my,x1,y1,x2,y2)<tol;
  const P=d.pts;
  switch(d.type){
    case 'trend':case 'arrow':case 'ray':
      return near(X(P[0].gm),Y(P[0].p),X(P[1].gm),Y(P[1].p))?{}:null;
    case 'hline': case 'pricenote': return Math.abs(my-Y(P[0].p))<5?{}:null;
    case 'mark': return Math.abs(my-Y(P[0].p))<6?{}:null;
    case 'hray': return (mx>=X(P[0].gm)-4&&Math.abs(my-Y(P[0].p))<5)?{}:null;
    case 'rect': case 'pricerange': case 'pricedate':
      return rectHit(X(P[0].gm),Y(P[0].p),X(P[1].gm),Y(P[1].p),mx,my,4)?{}:null;
    case 'daterange':
      return (Math.abs(my-Y(P[0].p))<11&&rectHit(X(P[0].gm),Y(P[0].p),X(P[1].gm),Y(P[0].p),mx,my,4))?{}:null;
    case 'ellipse':{ const xa=X(P[0].gm),xb=X(P[1].gm),ya=Y(P[0].p),yb=Y(P[1].p);
      const cx=(xa+xb)/2,cy=(ya+yb)/2,rx=Math.abs(xb-xa)/2,ry=Math.abs(yb-ya)/2;
      if(rx<3||ry<3)return null;
      const r=Math.hypot((mx-cx)/rx,(my-cy)/ry),tol=clamp(6/Math.min(rx,ry),.06,.4);
      return Math.abs(r-1)<tol?{}:null;}
    case 'fib':{ const xa=Math.min(X(P[0].gm),X(P[1].gm)),xb=Math.max(X(P[0].gm),X(P[1].gm));
      if(mx<xa-4||mx>xb+4)return null;
      for(const lv of FIBL) if(Math.abs(my-Y(P[1].p+(P[0].p-P[1].p)*lv))<5)return{};
      return null;}
    case 'fibext':{ const xa=Math.min(X(P[0].gm),X(P[1].gm)),xb=Math.max(X(P[0].gm),X(P[1].gm));
      if(mx<xa-4||mx>xb+4)return null;
      const dP=P[1].p-P[0].p;
      for(const k of EXTL) if(Math.abs(my-Y(P[1].p+dP*k))<5)return{};
      return null;}
    case 'tbfib':{ if(mx<X(P[2].gm)-6)return null;
      const dP=P[1].p-P[0].p;
      for(const k of EXTL) if(Math.abs(my-Y(P[2].p+dP*k))<5)return{};
      return null;}
    case 'fan':{ const ax=X(P[0].gm),ay=Y(P[0].p),bx=X(P[1].gm),by=Y(P[1].p);
      for(const r of FANR){ const ey=ay+(by-ay)*r,[fx,fy]=far(ax,ay,bx,ey);
        if(near(ax,ay,fx,fy))return{}; } return null;}
    case 'circles':{ const cx=X(P[0].gm),cy=Y(P[0].p);
      const R=Math.hypot(X(P[1].gm)-cx,Y(P[1].p)-cy); if(R<3)return null;
      const rr2=Math.hypot(mx-cx,my-cy);
      for(const k of CIRCLR) if(Math.abs(rr2-R*k)<6)return{};
      return null;}
    case 'tzones':{ const dg=P[1].gm-P[0].gm;
      if(Math.abs(mx-X(P[0].gm))<5)return{};
      for(const F of TZL) if(Math.abs(mx-X(P[0].gm+dg*F))<5)return{};
      return null;}
    case 'pitchfork':{ const ax=X(P[0].gm),ay=Y(P[0].p),bx=X(P[1].gm),by=Y(P[1].p),cx2=X(P[2].gm),cy2=Y(P[2].p);
      const mx2=(bx+cx2)/2,my2=(by+cy2)/2,dx=mx2-ax,dy=my2-ay;
      const segs=[[ax,ay,...far(ax,ay,mx2,my2)],[ax,ay,mx2,my2],
        [bx,by,...far(bx,by,bx+dx,by+dy)],[cx2,cy2,...far(cx2,cy2,cx2+dx,cy2+dy)]];
      return segs.some(s=>near(...s))?{}:null;}
    case 'forecast': case 'projection':{
      const A=P[0],B=P[1];
      if(near(X(A.gm),Y(A.p),X(B.gm),Y(B.p)))return{};
      if(d.type==='forecast'){ const C={gm:B.gm+(B.gm-A.gm),p:B.p+(B.p-A.p)};
        return rectHit(X(A.gm),Y(A.p),X(B.gm),Y(B.p),mx,my,3)||near(X(B.gm),Y(B.p),X(C.gm),Y(C.p))?{}:null;}
      const C=P[2],D={gm:C.gm+(B.gm-A.gm),p:C.p+(B.p-A.p)};
      return rectHit(X(A.gm),Y(A.p),X(B.gm),Y(B.p),mx,my,3)||
             rectHit(X(C.gm),Y(C.p),X(D.gm),Y(D.p),mx,my,3)||near(X(C.gm),Y(C.p),X(D.gm),Y(D.p))?{}:null;}
    default: if(PATS.has(d.type)){
      for(let i=1;i<P.length;i++)
        if(near(X(P[i-1].gm),Y(P[i-1].p),X(P[i].gm),Y(P[i].p)))return{};
      return null;}
    case 'comment': case 'text':{ ctx.font='600 12px Archivo, sans-serif';
      const w=ctx.measureText(d.text).width,x=X(P[0].gm),y=Y(P[0].p);
      return (mx>x-12&&mx<x+w+14&&my>y-20&&my<y+10)?{}:null;}
    case 'callout':{ if(near(X(P[0].gm),Y(P[0].p),X(P[1].gm),Y(P[1].p)))return{};
      ctx.font='600 11px Archivo, sans-serif';
      const w=ctx.measureText(d.text).width,x=X(P[1].gm),y=Y(P[1].p);
      return (mx>x-4&&mx<x+w+16&&my>y-24&&my<y-4)?{}:null;}
    case 'pin': return Math.hypot(mx-X(P[0].gm),my-Y(P[0].p))<10?{}:null;
    case 'table':{ ctx.font='500 9px '+MONO;
      const cols=Math.max(...d.rows.map(r=>r.length));
      const cw=[];for(let c=0;c<cols;c++){let w=0;for(const r of d.rows)w=Math.max(w,ctx.measureText(r[c]||'').width);cw.push(w+10);}
      const x0=X(P[0].gm),y0=Y(P[0].p);
      return rectHit(x0,y0,x0+cw.reduce((a,b)=>a+b,0),y0+15*d.rows.length,mx,my,2)?{}:null;}
    case 'free':{ for(let i=1;i<P.length;i++)
        if(near(X(P[i-1].gm),Y(P[i-1].p),X(P[i].gm),Y(P[i].p),5))return{};
      return null;}
    case 'vprofile':{ const vp=computeVP(P[0].gm,P[1].gm);if(!vp)return null;
      const x0=Math.min(X(P[0].gm),X(P[1].gm)),x1=Math.max(X(P[0].gm),X(P[1].gm));
      return (mx>x0&&mx<x1&&my>Y(vp.hi)&&my<Y(vp.lo))?{}:null;}
    case 'vbs':{ const vp=computeBSV(P[0].gm,P[1].gm);if(!vp)return null;
      const x0=Math.min(X(P[0].gm),X(P[1].gm)),x1=Math.max(X(P[0].gm),X(P[1].gm));
      return (mx>x0&&mx<x1&&my>Y(vp.hi)&&my<Y(vp.lo))?{}:null;}
    case 'pos':{ const x0=Math.min(X(d.gm0),X(d.gm1)),x1=Math.max(X(d.gm0),X(d.gm1));
      const yT=Math.min(Y(d.pE),Y(d.pS),Y(d.pT)),yB=Math.max(Y(d.pE),Y(d.pS),Y(d.pT));
      return (mx>x0&&mx<x1&&my>yT&&my<yB)?{}:null;} }
  return null; }
function hitTopmost(mx,my){ if(!geo.sp||mx>geo.plotW||mx<0||my<0||my>geo.priceH)return null;
  for(let i=drawings.length-1;i>=0;i--){const d=drawings[i];const r=hitDrawing(d,mx,my);if(r)return{d,...r};}
  return null; }
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
    d.pE=orig.pE+dp;d.pS=orig.pS+dp;d.pT=orig.pT+dp;return true;}
  d.pts=orig.pts.map(pt=>d.type==='vprofile'||d.type==='vbs'?{gm:pt.gm+dgm,p:pt.p}:{gm:pt.gm+dgm,p:pt.p+dp});
  return dgm!==0||dp!==0; }
function legLabels(P,prev){
  ctx.font='600 9px '+MONO;ctx.textAlign='center';ctx.textBaseline='alphabetic';
  for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i];
    if(prev&&Math.abs(a.gm-b.gm)<1e-6&&Math.abs(a.p-b.p)<1e-9)continue;
    if(Math.abs(a.p)<1e-9)continue;
    const dv=(b.p-a.p)/a.p*100;
    ctx.fillStyle=dv>=0?'rgba(47,191,127,.9)':'rgba(229,72,77,.9)';
    ctx.fillText(labelPct(dv),(geo.X(a.gm)+geo.X(b.gm))/2,(geo.Y(a.p)+geo.Y(b.p))/2-4);}}
function drawArrow(x0,y0,x1,y1,col,dash){
  ctx.strokeStyle=col;ctx.lineWidth=1.3;ctx.setLineDash(dash||[]);
  line(x0,y0,x1,y1);ctx.setLineDash([]);
  const a=Math.atan2(y1-y0,x1-x0);ctx.fillStyle=col;
  ctx.beginPath();ctx.moveTo(x1,y1);
  ctx.lineTo(x1-9*Math.cos(a-.42),y1-9*Math.sin(a-.42));
  ctx.lineTo(x1-9*Math.cos(a+.42),y1-9*Math.sin(a+.42));
  ctx.closePath();ctx.fill();}
function renderDrawing(d,o={}){
  const X=geo.X,Y=geo.Y, prev=!!o.preview;
  const C=d.type==='fib'||['fibext','tbfib','fan','circles','tzones'].includes(d.type)?DCOL.fib
    :d.type==='text'?DCOL.text:d.type==='free'?DCOL.free:DCOL.def;
  ctx.save();
  if(prev){ctx.globalAlpha=.9;ctx.setLineDash([5,4]);}
  const P=d.pts;
  switch(d.type){
    case 'trend': ctx.strokeStyle=C;ctx.lineWidth=1.3;
      line(X(P[0].gm),Y(P[0].p),X(P[1].gm),Y(P[1].p));break;
    case 'ray':{ const x0=X(P[0].gm),y0=Y(P[0].p),[fx,fy]=far(x0,y0,X(P[1].gm),Y(P[1].p));
      ctx.strokeStyle=C;ctx.lineWidth=1.3;line(x0,y0,fx,fy);
      ctx.fillStyle=C;ctx.beginPath();ctx.arc(x0,y0,2.4,0,7);ctx.fill();break;}
    case 'arrow': drawArrow(X(P[0].gm),Y(P[0].p),X(P[1].gm),Y(P[1].p),C);break;
    case 'hline':{ const y=cr(Y(P[0].p));ctx.strokeStyle=C;ctx.lineWidth=1.2;
      line(0,y,geo.plotW,y);axisTags.push({y,text:fmtP(P[0].p),c:C});break;}
    case 'hray':{ const x=X(P[0].gm),y=cr(Y(P[0].p));ctx.strokeStyle=C;ctx.lineWidth=1.2;
      line(x,y,geo.plotW,y);ctx.fillStyle=C;ctx.beginPath();ctx.arc(x,y,2.4,0,7);ctx.fill();
      axisTags.push({y,text:fmtP(P[0].p),c:C});break;}
    case 'mark':{
      const eY=cr(Y(P[0].p)); const isBuy=d.side==='buy'; const col=isBuy?COL.up:COL.dn;
      ctx.strokeStyle=col;ctx.lineWidth=1.2;ctx.setLineDash([7,4]);
      line(0,eY,geo.plotW,eY);ctx.setLineDash([]);
      const lpc=bars[bars.length-1].c;
      const plP=isBuy?(lpc-P[0].p)/P[0].p*100:(P[0].p-lpc)/P[0].p*100;
      const plV=isBuy?lpc-P[0].p:P[0].p-lpc;
      const t1=(isBuy?'BUY ':'SELL ')+P[0].p.toFixed(2);
      const t2=labelPct(plP)+' · '+labelPts(plV);
      ctx.font='600 10px '+MONO;
      const w1=ctx.measureText(t1).width+14, w2=ctx.measureText(t2).width+12;
      ctx.fillStyle=col; rr(6,eY-17,w1,14,3); ctx.fill();
      ctx.fillStyle='#0c0e11'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(t1,6+w1/2,eY-10);
      ctx.fillStyle='rgba(12,14,17,.85)'; rr(6+w1+4,eY-17,w2,14,3); ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,.16)'; rr(6+w1+4,eY-17,w2,14,3); ctx.stroke();
      ctx.fillStyle=plP>=0?COL.up:COL.dn;
      ctx.fillText(t2,6+w1+4+w2/2,eY-10);
      ctx.textAlign='left';
      axisTags.push({y:eY,text:(isBuy?'B ':'S ')+P[0].p.toFixed(2),c:col});break;}
    case 'rect':{ const x0=Math.min(X(P[0].gm),X(P[1].gm)),y0=Math.min(Y(P[0].p),Y(P[1].p));
      ctx.fillStyle='rgba(95,176,216,.07)';
      ctx.fillRect(x0,y0,Math.abs(X(P[1].gm)-X(P[0].gm)),Math.abs(Y(P[1].p)-Y(P[0].p)));
      ctx.strokeStyle=C;ctx.lineWidth=1.3;
      ctx.strokeRect(x0,y0,Math.abs(X(P[1].gm)-X(P[0].gm)),Math.abs(Y(P[1].p)-Y(P[0].p)));break;}
    case 'pricerange': case 'pricedate':{
      const xa=Math.min(X(P[0].gm),X(P[1].gm)),xb=Math.max(X(P[0].gm),X(P[1].gm));
      const y0=Math.min(Y(P[0].p),Y(P[1].p)),y1=Math.max(Y(P[0].p),Y(P[1].p));
      const up2=P[1].p>=P[0].p,col=up2?COL.up:COL.dn;
      ctx.fillStyle=up2?'rgba(47,191,127,.12)':'rgba(229,72,77,.12)';
      ctx.fillRect(xa,y0,Math.max(2,xb-xa),y1-y0);
      ctx.strokeStyle=col;ctx.strokeRect(xa,y0,Math.max(2,xb-xa),y1-y0);
      const dv=P[1].p-P[0].p,dp2=Math.abs(P[0].p)>1e-9?dv/P[0].p*100:0;
      const nb=Math.round(Math.abs(P[1].gm-P[0].gm));
      ctx.font='600 10px '+MONO;ctx.fillStyle=col;ctx.textAlign='left';
      if(d.type!=='daterange'){ctx.textBaseline='top';ctx.fillText(labelPts(dv)+' · '+labelPct(dp2),xa+5,y0+4);}
      if(d.type!=='pricerange'){ctx.textBaseline='bottom';ctx.fillText('+'+fmtDur(nb)+' · '+nb+' bars',xa+5,d.type==='daterange'?y0-7:y1-4);}
      break;}
    case 'ellipse':{ const xa=X(P[0].gm),xb=X(P[1].gm),ya=Y(P[0].p),yb=Y(P[1].p);
      ctx.beginPath();ctx.ellipse((xa+xb)/2,(ya+yb)/2,Math.abs(xb-xa)/2,Math.abs(yb-ya)/2,0,0,7);
      ctx.fillStyle='rgba(95,176,216,.06)';ctx.fill();
      ctx.strokeStyle=C;ctx.lineWidth=1.3;ctx.stroke();break;}
    case 'fib':{ const xa=Math.min(X(P[0].gm),X(P[1].gm)),xb=Math.max(X(P[0].gm),X(P[1].gm));
      const p0=P[0].p,p1=P[1].p;
      ctx.fillStyle='rgba(224,166,63,.07)';
      ctx.fillRect(xa,Y(p1+(p0-p1)*.618),xb-xa,Math.abs(Y(p1+(p0-p1)*.382)-Y(p1+(p0-p1)*.618)));
      ctx.textAlign='left';ctx.textBaseline='bottom';ctx.font='500 10px '+MONO;
      for(const lv of FIBL){ const pr=p1+(p0-p1)*lv,y=cr(Y(pr));
        const strong=(lv===0||lv===1||lv===.618);
        ctx.strokeStyle=`rgba(224,166,63,${strong?.85:.45})`;ctx.lineWidth=strong?1.3:1;
        ctx.setLineDash(lv===.5?[5,4]:[]);line(xa,y,xb,y);ctx.setLineDash([]);
        ctx.fillStyle=`rgba(224,166,63,${strong?.95:.7})`;
        ctx.fillText(`${lv.toFixed(3)}  ${fmtP(pr)}`,xa+5,y-2);}break;}
    case 'fibext':{ const xa=Math.min(X(P[0].gm),X(P[1].gm)),xb=Math.max(X(P[0].gm),X(P[1].gm));
      const dP=P[1].p-P[0].p;
      ctx.textAlign='left';ctx.textBaseline='bottom';ctx.font='500 10px '+MONO;
      for(const k of EXTL){ const pr=P[1].p+dP*k,y=cr(Y(pr));
        const strong=(k===1||k===1.618);
        ctx.strokeStyle=`rgba(224,166,63,${strong?.85:.4})`;ctx.lineWidth=strong?1.3:1;
        ctx.setLineDash(k===0||k===1?[]:[4,4]);line(xa,y,xb,y);ctx.setLineDash([]);
        ctx.fillStyle=`rgba(224,166,63,${strong?.95:.65})`;
        ctx.fillText(`${k} · ${fmtP(pr)}`,xa+5,y-2);}break;}
    case 'tbfib':{ const x0=X(P[2].gm), dP=P[1].p-P[0].p;
      ctx.textAlign='left';ctx.textBaseline='bottom';ctx.font='500 10px '+MONO;
      for(const k of EXTL){ const pr=P[2].p+dP*k,y=cr(Y(pr));
        const strong=(k===1||k===1.618);
        ctx.strokeStyle=`rgba(224,166,63,${strong?.85:.4})`;ctx.lineWidth=strong?1.3:1;
        ctx.setLineDash(k===0||k===1?[]:[4,4]);line(x0,y,geo.plotW,y);ctx.setLineDash([]);
        ctx.fillStyle=`rgba(224,166,63,${strong?.95:.65})`;
        ctx.fillText(`${k} · ${fmtP(pr)}`,x0+5,y-2);}
      ctx.fillStyle='rgba(224,166,63,.9)';
      for(const p of P){ctx.beginPath();ctx.arc(X(p.gm),Y(p.p),2.2,0,7);ctx.fill();}break;}
    case 'fan':{ const ax=X(P[0].gm),ay=Y(P[0].p),bx=X(P[1].gm),by=Y(P[1].p);
      ctx.font='500 9.5px '+MONO;ctx.textAlign='left';ctx.textBaseline='middle';
      for(const r of FANR){ const ey=ay+(by-ay)*r;
        const [fx,fy]=far(ax,ay,bx,ey);
        const strong=(r===.382||r===.618);
        ctx.strokeStyle=`rgba(224,166,63,${strong?.8:.38})`;ctx.lineWidth=strong?1.3:1;
        line(ax,ay,fx,fy);
        ctx.fillStyle=`rgba(224,166,63,${strong?.9:.55})`;
        ctx.fillText(String(r),ax+(bx-ax)*.14+6,ay+(ey-ay)*.14);}
      ctx.fillStyle=C;ctx.beginPath();ctx.arc(ax,ay,2.4,0,7);ctx.fill();break;}
    case 'circles':{ const cx=X(P[0].gm),cy=Y(P[0].p);
      const R=Math.hypot(X(P[1].gm)-cx,Y(P[1].p)-cy); if(R<3)break;
      ctx.font='500 9.5px '+MONO;ctx.textAlign='left';ctx.textBaseline='bottom';
      for(const k of CIRCLR){ const r=R*k;
        ctx.strokeStyle=`rgba(224,166,63,${k===1?.8:.38})`;ctx.lineWidth=k===1?1.3:1;
        ctx.beginPath();ctx.arc(cx,cy,r,0,7);ctx.stroke();
        ctx.fillStyle=`rgba(224,166,63,${k===1?.9:.55})`;
        ctx.fillText(String(k),cx+r*.7071+3,cy-r*.7071-3);}
      ctx.fillStyle=C;ctx.beginPath();ctx.arc(cx,cy,2.4,0,7);ctx.fill();break;}
    case 'tzones':{ const dg=P[1].gm-P[0].gm;
      ctx.font='600 9.5px '+MONO;ctx.textAlign='center';ctx.textBaseline='top';
      for(const F of TZL){ const x=cr(X(P[0].gm+dg*F)); if(x<-2||x>geo.plotW+2)continue;
        ctx.strokeStyle=`rgba(224,166,63,${F===1?.7:.3})`;ctx.lineWidth=F===1?1.2:1;
        line(x,0,x,geo.priceH);
        ctx.fillStyle='rgba(224,166,63,.7)';ctx.fillText(String(F),x,4);}break;}
    case 'pitchfork':{ const ax=X(P[0].gm),ay=Y(P[0].p),bx=X(P[1].gm),by=Y(P[1].p),cx2=X(P[2].gm),cy2=Y(P[2].p);
      const mx2=(bx+cx2)/2,my2=(by+cy2)/2,dx=mx2-ax,dy=my2-ay;
      const [fx,fy]=far(ax,ay,mx2,my2);
      ctx.strokeStyle=C;ctx.lineWidth=1.4;
      line(ax,ay,mx2,my2);
      ctx.lineWidth=1.2;
      line(ax,ay,fx,fy);
      line(bx,by,bx+dx*40,by+dy*40);
      line(cx2,cy2,cx2+dx*40,cy2+dy*40);
      ctx.fillStyle=C;
      for(const p of P){ctx.beginPath();ctx.arc(X(p.gm),Y(p.p),2.2,0,7);ctx.fill();}break;}
    case 'projection': case 'forecast':{
      const A=P[0],B=P[1];
      const col=B.p>=A.p?COL.up:COL.dn;
      const xa=Math.min(X(A.gm),X(B.gm)),xb=Math.max(X(A.gm),X(B.gm));
      const ya=Math.min(Y(A.p),Y(B.p)),yb=Math.max(Y(A.p),Y(B.p));
      ctx.fillStyle=col===COL.up?'rgba(47,191,127,.1)':'rgba(229,72,77,.1)';
      ctx.fillRect(xa,ya,xb-xa,yb-ya);
      ctx.strokeStyle=col;ctx.strokeRect(xa,ya,xb-xa,yb-ya);
      let Tx,Ty,label;
      if(d.type==='forecast'){
        const C={gm:B.gm+(B.gm-A.gm),p:B.p+(B.p-A.p)};
        drawArrow(X(A.gm),Y(A.p),X(B.gm),Y(B.p),col);
        drawArrow(X(B.gm),Y(B.p),X(C.gm),Y(C.p),col,[4,4]);
        Tx=X(B.gm)+8;Ty=Y(C.p);
        label='→ '+fmtP(C.p)+' ('+labelPct((B.p-A.p)/A.p*100)+' · +'+fmtDur(Math.abs(C.gm-B.gm))+')';
      }else{
        const C2=P[2],D={gm:C2.gm+(B.gm-A.gm),p:C2.p+(B.p-A.p)};
        const xa2=Math.min(X(C2.gm),X(D.gm)),xb2=Math.max(X(C2.gm),X(D.gm));
        const ya2=Math.min(Y(C2.p),Y(D.p)),yb2=Math.max(Y(C2.p),Y(D.p));
        ctx.fillStyle=col===COL.up?'rgba(47,191,127,.07)':'rgba(229,72,77,.07)';
        ctx.fillRect(xa2,ya2,xb2-xa2,yb2-ya2);
        ctx.setLineDash([4,4]);ctx.strokeRect(xa2,ya2,xb2-xa2,yb2-ya2);ctx.setLineDash([]);
        drawArrow(X(C2.gm),Y(C2.p),X(D.gm),Y(D.p),col);
        Tx=X(D.gm)+6;Ty=Y(D.p);
        label=labelPts(B.p-A.p)+' · +'+fmtDur(Math.abs(B.gm-A.gm)); }
      ctx.font='600 10px '+MONO;ctx.fillStyle=col;ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillText(label,Tx,Ty);break;}
    default: if(PATS.has(d.type)){
      ctx.strokeStyle=DCOL.pat;ctx.lineWidth=1.4;ctx.lineJoin='round';
      ctx.beginPath();ctx.moveTo(X(P[0].gm),Y(P[0].p));
      for(let i=1;i<P.length;i++)ctx.lineTo(X(P[i].gm),Y(P[i].p));
      ctx.stroke();
      ctx.fillStyle=DCOL.pat;
      for(const p of P){ctx.beginPath();ctx.arc(X(p.gm),Y(p.p),2.2,0,7);ctx.fill();}
      ctx.setLineDash([4,4]);ctx.strokeStyle='rgba(180,140,224,.5)';ctx.lineWidth=1;
      if(d.type==='hns'||d.type==='ihns')line(X(P[3].gm),Y(P[3].p),X(P[4].gm),Y(P[4].p));
      else if(d.type==='dbltop'||d.type==='dblbot')line(X(P[2].gm),Y(P[2].p),X(P[3].gm),Y(P[3].p));
      else if(d.type==='tri'||d.type==='wedge'){
        line(X(P[0].gm),Y(P[0].p),X(P[2].gm),Y(P[2].p));
        line(X(P[2].gm),Y(P[2].p),X(P[4].gm),Y(P[4].p));
        line(X(P[1].gm),Y(P[1].p),X(P[3].gm),Y(P[3].p));}
      ctx.setLineDash([]);
      legLabels(P,prev);break;}
    case 'text':{ const x=X(P[0].gm),y=Y(P[0].p);
      ctx.font='600 12px Archivo, sans-serif';ctx.fillStyle=DCOL.text;
      ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillText(d.text,x,y);
      ctx.fillStyle=DCOL.fib;ctx.beginPath();ctx.arc(x-7,y-4,2.4,0,7);ctx.fill();break;}
    case 'comment':{ const x=X(P[0].gm),y=Y(P[0].p);
      ctx.font='600 11px Archivo, sans-serif';
      const w=ctx.measureText(d.text).width;
      ctx.fillStyle='rgba(23,28,35,.92)';ctx.strokeStyle='rgba(255,255,255,.2)';ctx.lineWidth=1;
      rr(x-6,y-19,w+12,17,5);ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.moveTo(x-1,y-2);ctx.lineTo(x+4,y-2);ctx.lineTo(x-1,y+5);ctx.closePath();ctx.fill();
      ctx.fillStyle=DCOL.text;ctx.textAlign='left';ctx.textBaseline='alphabetic';
      ctx.fillText(d.text,x,y-6);break;}
    case 'callout':{ const x0=X(P[0].gm),y0=Y(P[0].p),x1=X(P[1].gm),y1=Y(P[1].p);
      ctx.strokeStyle=DCOL.text;ctx.lineWidth=1.1;line(x0,y0,x1,y1-4);
      ctx.beginPath();ctx.arc(x0,y0,2.4,0,7);ctx.fill();
      ctx.font='600 11px Archivo, sans-serif';
      const w=ctx.measureText(d.text).width;
      ctx.fillStyle='rgba(23,28,35,.92)';ctx.strokeStyle='rgba(255,255,255,.2)';
      rr(x1-4,y1-24,w+14,18,5);ctx.fill();ctx.stroke();
      ctx.fillStyle=DCOL.text;ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillText(d.text,x1+3,y1-14);break;}
    case 'pin':{ const x=X(P[0].gm),y=Y(P[0].p);
      ctx.fillStyle=COL.acc;
      ctx.beginPath();ctx.moveTo(x-4,y+3);ctx.lineTo(x+4,y+3);ctx.lineTo(x,y+13);ctx.closePath();ctx.fill();
      ctx.beginPath();ctx.arc(x,y,4.6,0,7);ctx.fill();
      ctx.fillStyle='#0c0e11';ctx.beginPath();ctx.arc(x,y,1.7,0,7);ctx.fill();
      if(d.text){ctx.font='600 10px Archivo, sans-serif';ctx.fillStyle=DCOL.text;
        ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(d.text,x,y+16);}break;}
    case 'pricenote':{ const y=cr(Y(P[0].p));
      ctx.strokeStyle=DCOL.def;ctx.lineWidth=1.1;ctx.setLineDash([6,4]);
      line(0,y,geo.plotW,y);ctx.setLineDash([]);
      axisTags.push({y,text:fmtP(P[0].p),c:DCOL.def});
      if(d.text){ctx.font='600 10.5px Archivo, sans-serif';ctx.fillStyle=DCOL.def;
        ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(d.text,6,y-9);}break;}
    case 'table':{ const x0=X(P[0].gm),y0=Y(P[0].p);
      ctx.font='500 9.5px '+MONO;
      const cols=Math.max(...d.rows.map(r=>r.length));
      const cw=[];for(let c=0;c<cols;c++){let w=0;for(const r of d.rows)w=Math.max(w,ctx.measureText(r[c]||'').width);cw.push(w+10);}
      const W2=cw.reduce((a,b)=>a+b,0),H2=16*d.rows.length;
      ctx.fillStyle='rgba(15,18,24,.9)';ctx.strokeStyle='rgba(255,255,255,.2)';ctx.lineWidth=1;
      rr(x0,y0,W2,H2,4);ctx.fill();ctx.stroke();
      ctx.save();rr(x0,y0,W2,H2,4);ctx.clip();
      let y=y0;ctx.textAlign='left';ctx.textBaseline='middle';
      d.rows.forEach((r,ri)=>{
        if(ri>0){ctx.strokeStyle='rgba(255,255,255,.1)';line(x0,y,x0+W2,y);}
        let x=x0;
        r.forEach((cell,ci)=>{
          if(ci>0){ctx.strokeStyle='rgba(255,255,255,.1)';line(x,y,x,y+16);}
          ctx.fillStyle='#c8cdd4';ctx.fillText(cell||'',x+5,y+8);
          x+=cw[ci];});
        y+=16;});
      ctx.restore();break;}
    case 'free':{ if(P.length<2)break;
      ctx.strokeStyle=DCOL.free;ctx.lineWidth=1.6;ctx.lineJoin='round';ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(X(P[0].gm),Y(P[0].p));
      for(let i=1;i<P.length;i++)ctx.lineTo(X(P[i].gm),Y(P[i].p));
      ctx.stroke();break;}
    case 'vprofile':{ const vp=computeVP(P[0].gm,P[1].gm,true);if(!vp)break;
      const x0=Math.min(X(P[0].gm),X(P[1].gm)),x1=Math.max(X(P[0].gm),X(P[1].gm));
      const maxW=Math.min(Math.max(40,(x1-x0)*.55),180),mb=Math.max(...vp.bins)||1,bh=(vp.hi-vp.lo)/vp.N;
      for(let i=0;i<vp.N;i++){ const w=vp.bins[i]/mb*maxW;if(w<.5)continue;
        const yT=Y(vp.hi-(i+1)*bh),hh=Math.max(1,Math.abs(Y(vp.hi-i*bh)-yT));
        ctx.fillStyle=i===vp.poc?'rgba(224,166,63,.95)':(i>=vp.a&&i<=vp.b2)?'rgba(224,166,63,.4)':'rgba(224,166,63,.16)';
        ctx.fillRect(x0,yT,w,hh);}
      if(vp.dev&&vp.dev.length>1){
        ctx.beginPath();
        vp.dev.forEach((dp2,i)=>{ const xx=X(dp2.gm+.5),yy=Y(dp2.vah);
          i===0?ctx.moveTo(xx,yy):ctx.lineTo(xx,yy); });
        for(let i=vp.dev.length-1;i>=0;i--)ctx.lineTo(X(vp.dev[i].gm+.5),Y(vp.dev[i].val));
        ctx.closePath();ctx.fillStyle='rgba(224,166,63,.05)';ctx.fill();
        const dline=(key,col,w)=>{ ctx.strokeStyle=col;ctx.lineWidth=w;ctx.beginPath();
          vp.dev.forEach((dp2,i)=>{ const xx=X(dp2.gm+.5),yy=Y(dp2[key]);
            i===0?ctx.moveTo(xx,yy):ctx.lineTo(xx,yy); });
          ctx.stroke(); };
        ctx.setLineDash([2,3]);
        dline('vah','rgba(224,166,63,.45)',1);dline('val','rgba(224,166,63,.45)',1);
        ctx.setLineDash([5,3]);dline('poc','rgba(224,166,63,.95)',1.3);ctx.setLineDash([]); }
      ctx.font='600 9.5px '+MONO;
      const yVAH=cr(Y(vp.hi-vp.b2*bh)), yVAL=cr(Y(vp.hi-(vp.a+1)*bh)), yPOC=cr(Y(vp.lo+(vp.poc+.5)*bh));
      ctx.strokeStyle='rgba(224,166,63,.75)';ctx.lineWidth=1.1;ctx.setLineDash([6,4]);
      line(x0,yVAH,x1,yVAH); line(x0,yVAL,x1,yVAL); line(x0,yPOC,x1,yPOC);
      ctx.setLineDash([]);
      ctx.textAlign='left';
      ctx.textBaseline='bottom';ctx.fillStyle='rgba(224,166,63,.95)';
      ctx.fillText(`VAH ${fmtP(vp.hi-vp.b2*bh)}`,x0+4,yVAH-2);
      ctx.fillStyle='rgba(224,166,63,1)';
      ctx.fillText(`POC ${fmtP(vp.lo+(vp.poc+.5)*bh)}`,x0+4,yPOC-2);
      ctx.textBaseline='top';
      ctx.fillText(`VAL ${fmtP(vp.hi-(vp.a+1)*bh)}`,x0+4,yVAL+2);
      ctx.strokeStyle='rgba(255,255,255,.2)';ctx.setLineDash([3,4]);ctx.lineWidth=1;
      line(cr(x0),Y(vp.hi),cr(x0),Y(vp.lo));line(cr(x1),Y(vp.hi),cr(x1),Y(vp.lo));ctx.setLineDash([]);
      ctx.textAlign='right';ctx.textBaseline='bottom';
      ctx.fillText(`VP · ${fmtV(vp.tv||0)}`,x1-4,Y(vp.hi)-4);break;}
    case 'vbs':{ const vp=computeBSV(P[0].gm,P[1].gm);if(!vp)break;
      const x0=Math.min(X(P[0].gm),X(P[1].gm)),x1=Math.max(X(P[0].gm),X(P[1].gm));
      const cx=(x0+x1)/2, bh=(vp.hi-vp.lo)/vp.N;
      const yHi2=Y(vp.hi), yLo2=Y(vp.lo);
      ctx.fillStyle='rgba(255,255,255,.035)';ctx.fillRect(x0,yHi2,x1-x0,yLo2-yHi2);
      ctx.strokeStyle='rgba(255,255,255,.2)';ctx.lineWidth=1;
      ctx.strokeRect(cr(x0),cr(yHi2),cr(x1)-cr(x0),cr(yLo2)-cr(yHi2));
      ctx.strokeStyle='rgba(255,255,255,.32)';
      line(cr(x0),cr(yHi2),cr(x0),cr(yLo2)); line(cr(x1),cr(yHi2),cr(x1),cr(yLo2));
      ctx.strokeStyle='rgba(255,255,255,.12)';ctx.setLineDash([3,4]);
      line(cr(cx),cr(yHi2),cr(cx),cr(yLo2));ctx.setLineDash([]);
      let mNet=1e-9;for(let i=0;i<vp.N;i++)mNet=Math.max(mNet,Math.abs(vp.buy[i]-vp.sell[i]));
      const wMax=clamp((x1-x0)*0.5-8,20,150);
      for(let i=0;i<vp.N;i++){
        const net=vp.buy[i]-vp.sell[i];
        if(Math.abs(net)<mNet*0.05)continue;
        const w=Math.abs(net)/mNet*wMax;
        const yT=Y(vp.hi-(i+1)*bh),hh=Math.max(1,Math.abs(Y(vp.hi-i*bh)-yT));
        ctx.fillStyle=net>0?'rgba(47,191,127,.55)':'rgba(229,72,77,.55)';
        ctx.fillRect(net>0?cx-w:cx,yT,w,hh);}
      const bp2=vp.bt+vp.st>0?vp.bt/(vp.bt+vp.st)*100:50;
      ctx.font='600 10px '+MONO;ctx.textAlign='right';ctx.textBaseline='bottom';
      ctx.fillStyle=bp2>=50?COL.up:COL.dn;
      ctx.fillText(`BSV · BUY ${bp2.toFixed(0)}% / SELL ${(100-bp2).toFixed(0)}% · ${fmtV(vp.bt)} / ${fmtV(vp.st)}`,x1-4,yHi2-4);break;}
    case 'pos':{ const x0=Math.min(X(d.gm0),X(d.gm1)),x1=Math.max(X(d.gm0),X(d.gm1));
      const yE=Y(d.pE),yS=Y(d.pS),yT=Y(d.pT);
      ctx.fillStyle='rgba(229,72,77,.13)';ctx.fillRect(x0,Math.min(yE,yS),x1-x0,Math.abs(yS-yE));
      ctx.fillStyle='rgba(47,191,127,.13)';ctx.fillRect(x0,Math.min(yE,yT),x1-x0,Math.abs(yT-yE));
      const yT2=Math.min(yE,yS,yT),yB2=Math.max(yE,yS,yT);
      ctx.strokeStyle='rgba(255,255,255,.14)';ctx.lineWidth=1;
      line(cr(x0),yT2,cr(x0),yB2);line(cr(x1),yT2,cr(x1),yB2);
      ctx.lineWidth=1.1;
      ctx.strokeStyle=COL.dn;line(x0,cr(yS),x1,cr(yS));
      ctx.strokeStyle=COL.up;line(x0,cr(yT),x1,cr(yT));
      ctx.strokeStyle=COL.ink;ctx.lineWidth=1.3;line(x0,cr(yE),x1,cr(yE));
      const rrV=(d.pE-d.pS)!==0?Math.abs((d.pT-d.pE)/(d.pE-d.pS)):0;
      ctx.font='500 10px '+MONO;ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillStyle=d.dir>0?COL.up:COL.dn;
      rr(x0+4,yE-15,14,14,3);ctx.fill();
      ctx.fillStyle='#0c0e11';ctx.textAlign='center';
      ctx.fillText(d.dir>0?'L':'S',x0+11,yE-7.6);
      ctx.textAlign='left';
      ctx.fillStyle='#d6dae0';ctx.fillText(`ENTRY ${fmtP(d.pE)}`,x0+23,yE-7);
      ctx.fillStyle=COL.dn;ctx.fillText(`STOP ${Math.abs((d.pS-d.pE)/d.pE*100).toFixed(2)}%`,x0+5,yS>yE?yS+9:yS-8);
      ctx.fillStyle=COL.up;ctx.fillText(`TGT ${Math.abs((d.pT-d.pE)/d.pE*100).toFixed(2)}% · 1:${rrV.toFixed(1)}`,x0+5,yT<yE?yT-8:yT+9);
      break;} }
  if(prev&&P&&P[0]){ ctx.setLineDash([]);ctx.fillStyle=C;
    ctx.beginPath();ctx.arc(X(P[0].gm),Y(P[0].p),3,0,7);ctx.fill(); }
  ctx.restore(); }
/* toolbar */
const sv2=(inner)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ICONS={
  cursor:sv2('<path d="M6 3l12 8.5-5.2 1.2L10.5 19z"/>'),
  trend:sv2('<line x1="5" y1="19" x2="19" y2="5"/><circle cx="5" cy="19" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="5" r="1.7" fill="currentColor" stroke="none"/>'),
  ray:sv2('<line x1="6" y1="18" x2="21" y2="5"/><circle cx="6" cy="18" r="1.8" fill="currentColor" stroke="none"/>'),
  arrow:sv2('<line x1="5" y1="19" x2="18" y2="6"/><path d="M18 6l-5 .9M18 6l-.9 5"/>'),
  hline:sv2('<line x1="3" y1="12" x2="21" y2="12"/>'),
  hray:sv2('<circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none"/><line x1="5" y1="12" x2="21" y2="12"/>'),
  rect:sv2('<rect x="4" y="6" width="16" height="12"/>'),
  ellipse:sv2('<ellipse cx="12" cy="12" rx="8" ry="6"/>'),
  fib:sv2('<line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/>'),
  fibext:sv2('<line x1="4" y1="6" x2="11" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="21" y2="18"/>'),
  tbfib:sv2('<line x1="9" y1="3.5" x2="21" y2="3.5"/><circle cx="5" cy="19" r="1.6"/><circle cx="11" cy="13" r="1.6"/><circle cx="17" cy="7" r="1.6"/>'),
  fan:sv2('<circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none"/><line x1="5" y1="19" x2="20" y2="4"/><line x1="5" y1="19" x2="20" y2="10"/><line x1="5" y1="19" x2="20" y2="16"/>'),
  circles:sv2('<circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8.5"/>'),
  tzones:sv2('<line x1="6" y1="4" x2="6" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="19" y1="4" x2="19" y2="20"/>'),
  pitchfork:sv2('<path d="M4 20L11 12L18 5M11 12L18 19"/>'),
  pricerange:sv2('<path d="M12 4v16M9 7l3-3 3 3M9 17l3 3 3-3"/>'),
  daterange:sv2('<path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3"/>'),
  pricedate:sv2('<rect x="6" y="6" width="12" height="12"/><path d="M3 12h3M18 12h3"/>'),
  vprofile:sv2('<line x1="4" y1="6" x2="16" y2="6"/><line x1="4" y1="12" x2="21" y2="12"/><line x1="4" y1="18" x2="12" y2="18"/>'),
  vbs:sv2('<line x1="12" y1="4" x2="12" y2="20"/><line x1="11" y1="7" x2="6" y2="7"/><line x1="11" y1="12" x2="4" y2="12"/><line x1="13" y1="9" x2="18" y2="9"/><line x1="13" y1="14" x2="20" y2="14"/>'),
  abcd:sv2('<path d="M4 18l5-9 5 6 6-11"/>'),
  dbltop:sv2('<path d="M4 18l4-10 4 7 4-7 4 10"/>'),
  dblbot:sv2('<path d="M4 6l4 10 4-7 4 7 4-10"/>'),
  hns:sv2('<path d="M4 17l4-8 4 5 4-8 4 11"/>'),
  ihns:sv2('<path d="M4 7l4 8 4-5 4 8 4-11"/>'),
  tri:sv2('<path d="M12 5l8 14H4z"/>'),
  wedge:sv2('<path d="M4 18L20 6M4 18L20 14"/>'),
  projection:sv2('<path d="M4 18l6-6 4 4 6-9"/><path d="M15 11h6" stroke-dasharray="2 2"/>'),
  forecast:sv2('<path d="M4 18l8-8"/><path d="M12 10l7-7" stroke-dasharray="2 2"/><path d="M15 4h5v5"/>'),
  long:sv2('<path d="M12 20V6M12 6l-5 5M12 6l5 5"/><line x1="5" y1="21" x2="19" y2="21"/>'),
  short:sv2('<path d="M12 4v14M12 18l-5-5M12 18l5-5"/><line x1="5" y1="3" x2="19" y2="3"/>'),
  text:sv2('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>'),
  comment:sv2('<path d="M4 5h16v10H9l-5 4z"/>'),
  callout:sv2('<rect x="12" y="4" width="9" height="8" rx="1"/><path d="M12 8H7l-3 4v8"/>'),
  pin:sv2('<path d="M12 21c-3.2-3.7-5-6.6-5-9a5 5 0 0 1 10 0c0 2.4-1.8 5.3-5 9z"/><circle cx="12" cy="11.5" r="1.6"/>'),
  pricenote:sv2('<line x1="3" y1="12" x2="12" y2="12"/><rect x="12" y="8" width="9" height="8" rx="1"/>'),
  table:sv2('<rect x="4" y="5" width="16" height="14"/><path d="M4 10h16M4 15h16"/>'),
  free:sv2('<path d="M4 20l1.2-4.2L16 5l3 3L8.2 18.8z"/>'),
  trash:sv2('<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/>')};
const TNAME={cursor:'Cursor',trend:'Trend line',ray:'Ray',arrow:'Arrow',hline:'Horiz line',
  hray:'Horiz ray',rect:'Rectangle',ellipse:'Ellipse',fib:'Fib retracement',fibext:'Fib extension',
  tbfib:'Trend-based fib',fan:'Speed fan',circles:'Fib circles',tzones:'Fib time zones',
  pitchfork:"Andrews' pitchfork",pricerange:'Price range',daterange:'Date range',pricedate:'Price + date range',
  vprofile:'Fixed range volume profile',vbs:'Buy/Sell volume',
  abcd:'AB=CD',dbltop:'Double top',dblbot:'Double bottom',hns:'Head & shoulders',ihns:'Inverted H&S',
  tri:'Triangle pattern',wedge:'Wedge pattern',projection:'Projection',forecast:'Forecast',
  long:'Long position',short:'Short position',text:'Text',comment:'Comment',callout:'Callout',
  pin:'Pin',pricenote:'Price note',table:'Table',free:'Pencil'};
const GROUPS=[
  {id:'cursor', name:'CURSOR', tools:['cursor']},
  {id:'lines',  name:'LINES',  tools:['trend','ray','arrow','hline','hray']},
  {id:'shapes', name:'SHAPES', tools:['rect','ellipse']},
  {id:'fib',    name:'FIB',    tools:['fib','fibext','tbfib','fan','circles','tzones','pitchfork']},
  {id:'measure',name:'MEASURE',tools:['pricerange','daterange','pricedate']},
  {id:'patterns',name:'PATTERNS',tools:['abcd','dbltop','dblbot','hns','ihns','tri','wedge']},
  {id:'forecast',name:'FORECAST',tools:['projection','forecast']},
  {id:'trade',  name:'TRADE',  tools:['long','short']},
  {id:'notes',  name:'NOTES',  tools:['text','comment','callout','pin','pricenote','table','free']},
  {id:'study',  name:'STUDY',  tools:['vprofile','vbs']}];
const groupCur={}; GROUPS.forEach(g=>groupCur[g.id]=g.tools[0]);
let flyEl=null, flyFor=null;
function buildToolbar(){
  GROUPS.forEach(g=>{
    const lbl=document.createElement('div');lbl.className='tgrp';lbl.textContent=g.name;
    toolsWrap.appendChild(lbl);
    const row=document.createElement('div');row.className='trow';
    const main=document.createElement('button');main.className='tbtn';main.dataset.group=g.id;
    main.innerHTML=ICONS[groupCur[g.id]];main.title=TNAME[groupCur[g.id]];
    row.appendChild(main);
    if(g.tools.length>1){
      const car=document.createElement('button');car.className='tcar';car.textContent='▾';
      row.appendChild(car);
      car.addEventListener('click',e=>{e.stopPropagation();flyFor===g.id?closeFly():openFly(g,car);}); }
    toolsWrap.appendChild(row);
    main.addEventListener('click',()=>setTool(groupCur[g.id]));
    main.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();
      if(g.tools.length>1)openFly(g,main);}); });
  const sep=document.createElement('div');sep.className='tsep';toolsWrap.appendChild(sep);
  const tr=document.createElement('button');tr.className='tbtn';tr.title='Clear all drawings (Ctrl+Z undo)';
  tr.innerHTML=ICONS.trash;
  toolsWrap.appendChild(tr);
  tr.addEventListener('click',()=>{ if(!drawings.length)return; pushUndo();drawings=[];selId=null; }); }
function openFly(g,anchor){
  closeFly();
  flyEl=document.createElement('div');flyEl.className='flyout';
  g.tools.forEach(t=>{
    const b=document.createElement('button');
    b.innerHTML=ICONS[t]+'<span>'+TNAME[t]+'</span>';
    if(groupCur[g.id]===t)b.classList.add('on');
    b.addEventListener('click',e=>{e.stopPropagation();groupCur[g.id]=t;setTool(t);closeFly();});
    flyEl.appendChild(b); });
  document.querySelector('#wrap').appendChild(flyEl);
  const r=anchor.getBoundingClientRect(),wr=document.querySelector('#wrap').getBoundingClientRect();
  flyEl.style.left=(r.right-wr.left+4)+'px';
  flyEl.style.top=clamp(r.top-wr.top-4,4,H-40)+'px';
  flyFor=g.id; }
function closeFly(){ if(flyEl){flyEl.remove();flyEl=null;flyFor=null;} }
document.addEventListener('click',e=>{ if(flyEl&&!flyEl.contains(e.target))closeFly(); });
function setTool(t){ tool=t;pending=null;cancelPlacing();cv.style.cursor='';
  GROUPS.forEach(g=>{ if(g.tools.includes(t))groupCur[g.id]=t; });
  toolsWrap.querySelectorAll('.tbtn[data-group]').forEach(b=>{
    const g=GROUPS.find(x=>x.id===b.dataset.group);
    b.classList.toggle('on',g.tools.includes(tool));
    b.innerHTML=ICONS[groupCur[g.id]];b.title=TNAME[groupCur[g.id]];});
  chipTxt(); }
function popWire(btnId,popId){
  const pop=$(popId);
  $(btnId).addEventListener('click',e=>{e.stopPropagation();pop.hidden=!pop.hidden;});
  document.addEventListener('click',e=>{ if(!pop.hidden&&!pop.contains(e.target)&&!e.target.closest(btnId))pop.hidden=true; });
  return pop; }
