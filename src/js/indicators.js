'use strict';
function emaArr(src,n){const out=new Array(src.length).fill(null);const k=2/(n+1);let sum=0,e=null;
  for(let i=0;i<src.length;i++){ if(i<n){sum+=src[i];if(i===n-1){e=sum/n;out[i]=e;}}
    else{e=src[i]*k+e*(1-k);out[i]=e;} } return out;}
function emaNull(src,n){const out=new Array(src.length).fill(null);let i0=-1;
  for(let i=0;i<src.length;i++)if(src[i]!=null){i0=i;break;}
  if(i0<0)return out; const k=2/(n+1);let sum=0,e=null;
  for(let i=i0;i<src.length;i++){ if(i-i0<n){sum+=src[i];if(i-i0===n-1){e=sum/n;out[i]=e;}}
    else{e=src[i]*k+e*(1-k);out[i]=e;} } return out;}
function rsiArr(c,n){const out=new Array(c.length).fill(null);let ag=0,al=0;
  for(let i=1;i<c.length;i++){const ch=c[i]-c[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);
    if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;out[i]=al===0?100:100-100/(1+ag/al);}}
    else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;out[i]=al===0?100:100-100/(1+ag/al);}}return out;}
function macdArr(c){const f=emaArr(c,12),s=emaArr(c,26);
  const m=c.map((_,i)=>f[i]!=null&&s[i]!=null?f[i]-s[i]:null);
  const sg=emaNull(m,9);const h=m.map((v,i)=>v!=null&&sg[i]!=null?v-sg[i]:null);
  return{m,s:sg,h};}
function adxArr(h,l,c,n){const len=h.length;
  const pdi=Array(len).fill(null),mdi=Array(len).fill(null),adx=Array(len).fill(null),dx=Array(len).fill(null);
  let trS=0,pS=0,mS=0;
  for(let i=1;i<len;i++){
    const up=h[i]-h[i-1],dn=l[i-1]-l[i];
    const pdm=(up>dn&&up>0)?up:0,mdm=(dn>up&&dn>0)?dn:0;
    const tr=Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1]));
    if(i<=n){trS+=tr;pS+=pdm;mS+=mdm;}
    else{trS=trS-trS/n+tr;pS=pS-pS/n+pdm;mS=mS-mS/n+mdm;}
    if(i>=n&&trS>0){pdi[i]=100*pS/trS;mdi[i]=100*mS/trS;
      const s2=pdi[i]+mdi[i];dx[i]=s2>0?100*Math.abs(pdi[i]-mdi[i])/s2:0;}}
  let sum=0,cnt=0;
  for(let i=n;i<len;i++){ if(dx[i]==null){sum=0;cnt=0;continue;}
    if(cnt<n){sum+=dx[i];cnt++;if(cnt===n)adx[i]=sum/n;}
    else adx[i]=(adx[i-1]*(n-1)+dx[i])/n;}
  return{p:pdi,m:mdi,a:adx};}
const PANE_DEFS=[
  {id:'rsi', on:true, title:'RSI 14'},
  {id:'macd',on:true, title:'MACD 12 26 9'},
  {id:'adx', on:false,title:'ADX 14 · DMI'}];
const PCT_STEPS=[0.02,0.05,0.1,0.2,0.25,0.5,1,2,2.5,5,10,20,25,50,100,200,500];
const PTS_STEPS=[0.05,0.1,0.25,0.5,1,2,2.5,5,10,20,25,50,100,200,250,500,1000,2500];
function computeVP(gm0,gm1,dev){
  const g0=Math.max(0,Math.floor(gm0)), g1=Math.min(bars.length-1,Math.ceil(gm1));
  if(g1<g0)return null;
  let lo=1e18,hi=-1e18,tv=0;
  for(let g=g0;g<=g1;g++){const b=bars[g];if(b.l<lo)lo=b.l;if(b.h>hi)hi=b.h;tv+=b.v;}
  if(tv===0||hi<=lo)return null;
  const N=26, bins=new Array(N).fill(0), bh=(hi-lo)/N;
  const devPts=dev?[]:null;
  const step=dev?Math.max(1,Math.floor((g1-g0+1)/300)):1;
  const vaScan=()=>{ let poc=0;for(let i=1;i<N;i++)if(bins[i]>bins[poc])poc=i;
    let tot=0;for(let i=0;i<N;i++)tot+=bins[i];
    if(tot<=0)return null;
    let cum=bins[poc],a=poc,b2=poc;
    while(cum<tot*0.7&&(a>0||b2<N-1)){ const va=a>0?bins[a-1]:-1,vb=b2<N-1?bins[b2+1]:-1;
      if(vb>=va){b2++;cum+=bins[b2];}else{a--;cum+=bins[a];} }
    return{poc,vah:hi-b2*bh,val:hi-(a+1)*bh}; };
  for(let g=g0;g<=g1;g++){
    const b=bars[g];
    const bi=clamp(Math.floor(((b.h+b.l+b.c)/3-lo)/bh),0,N-1);
    bins[bi]+=b.v;
    if(dev&&(g===g0||(g-g0)%step===0||g===g1)){
      const s=vaScan(); if(s)devPts.push({gm:g,poc:hi-(s.poc+.5)*bh,vah:s.vah,val:s.val}); } }
  let poc=0;for(let i=1;i<N;i++)if(bins[i]>bins[poc])poc=i;
  let cum=bins[poc],a=poc,b2=poc;
  while(cum<tv*0.7&&(a>0||b2<N-1)){ const va=a>0?bins[a-1]:-1,vb=b2<N-1?bins[b2+1]:-1;
    if(vb>=va){b2++;cum+=bins[b2];}else{a--;cum+=bins[a];} }
  return{lo,hi,bins,N,poc,a,b2,tv,dev:devPts}; }
function computeBSV(gm0,gm1){
  const g0=Math.max(0,Math.floor(gm0)), g1=Math.min(bars.length-1,Math.ceil(gm1));
  if(g1<g0)return null;
  let lo=1e18,hi=-1e18,tv=0;
  for(let g=g0;g<=g1;g++){const b=bars[g];if(b.l<lo)lo=b.l;if(b.h>hi)hi=b.h;tv+=b.v;}
  if(tv===0||hi<=lo)return null;
  const N=28, buy=new Array(N).fill(0), sell=new Array(N).fill(0), bh=(hi-lo)/N;
  for(let g=g0;g<=g1;g++){const b=bars[g], r=b.h-b.l;
    const bf=r>0?(b.c-b.l)/r:0.5;
    const bi=clamp(Math.floor(((b.h+b.l+b.c)/3-lo)/bh),0,N-1);
    buy[bi]+=b.v*bf; sell[bi]+=b.v*(1-bf);}
  let bt=0,st=0;for(let i=0;i<N;i++){bt+=buy[i];st+=sell[i];}
  return{lo,hi,N,buy,sell,bt,st}; }
let fvgCache={ver:-1,list:[]};
function getFVG(){
  if(fvgCache.ver===dataVer)return fvgCache.list;
  const list=[];
  for(let i=1;i<bars.length-1;i++){
    const a=bars[i-1], b=bars[i+1];
    if(b.l>a.h) list.push({top:b.l,bot:a.h,gm:i+1,dir:1,fill:0,gone:false});
    else if(b.h<a.l) list.push({top:a.l,bot:b.h,gm:i+1,dir:-1,fill:0,gone:false}); }
  for(const f of list){
    for(let j=f.gm+1;j<bars.length;j++){const x=bars[j];
      if(f.dir===1){ if(x.l<=f.bot){f.gone=true;f.fill=j;break;} if(!f.fill&&x.l<f.top)f.fill=j; }
      else{ if(x.h>=f.top){f.gone=true;f.fill=j;break;} if(!f.fill&&x.h>f.bot)f.fill=j; } } }
  fvgCache={ver:dataVer,list}; return list; }
