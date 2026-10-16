'use strict';
const $=s=>document.querySelector(s);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const easeOut=t=>1-Math.pow(1-t,3);
const cr=v=>Math.round(v)+0.5;
const SESSION=375, OPEN_MIN=555;
const fmtDate=dt=>dt.toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short'}).toUpperCase();
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
const rng=mulberry32(0xC0FFEE);
let gSpare=null;
function gauss(){ if(gSpare!==null){const v=gSpare;gSpare=null;return v}
  let u=0,v=0;while(u===0)u=rng();while(v===0)v=rng();
  const m=Math.sqrt(-2*Math.log(u)),a=2*Math.PI*v; gSpare=m*Math.sin(a);return m*Math.cos(a); }
function gaussR(r){ let s=null; return ()=>{ if(s!==null){const v=s;s=null;return v}
  let u=0,v=0;while(u===0)u=r();while(v===0)v=r();
  const m=Math.sqrt(-2*Math.log(u)),a=2*Math.PI*v; s=m*Math.sin(a);return m*Math.cos(a);} }
const fmtP=p=>p.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtV=v=>v>=1e7?(v/1e7).toFixed(2)+'Cr':v>=1e5?(v/1e5).toFixed(2)+'L':v>=1e3?(v/1e3).toFixed(1)+'K':''+Math.round(v);
const fmtInr=v=>'₹'+Math.round(v).toLocaleString('en-IN');
const ts=()=>new Date().toLocaleTimeString('en-IN',{hour12:false});
function toast(msg,cls){ const t=document.createElement('div');t.className='toast '+(cls||'');
  t.textContent=msg;document.querySelector('#toasts').appendChild(t);setTimeout(()=>t.remove(),4500); }
function distSeg(px,py,x1,y1,x2,y2){const dx=x2-x1,dy=y2-y1,L2=dx*dx+dy*dy;
  let t=L2?((px-x1)*dx+(py-y1)*dy)/L2:0;t=clamp(t,0,1);
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));}
function far(x0,y0,x1,y1){const dx=x1-x0,dy=y1-y0,L=Math.hypot(dx,dy)||1;
  return[x0+dx*3000/L,y0+dy*3000/L];}
function rectHit(xa,ya,xb,yb,mx,my,tol=0){
  return mx>=Math.min(xa,xb)-tol&&mx<=Math.max(xa,xb)+tol&&my>=Math.min(ya,yb)-tol&&my<=Math.max(ya,yb)+tol;}

const IDX={NIFTY:24350,BANKNIFTY:51300,FINNIFTY:23100,MIDCPNIFTY:12150,SENSEX:79400};
const EQP={RELIANCE:2847.55,HDFCBANK:1642,TCS:3910,INFY:1852,SBIN:782,ICICIBANK:1148,
  AXISBANK:1104,LT:3520,ITC:462,TATAMOTORS:952,TATASTEEL:152,WIPRO:542,HCLTECH:1620,DMART:3850,ADANIENT:3120};
const FNO_SET=new Set([...Object.keys(IDX),'RELIANCE','HDFCBANK','TCS','INFY','SBIN','ICICIBANK','AXISBANK','LT','ITC','TATAMOTORS']);
const LOTS={NIFTY:75,BANKNIFTY:30,FINNIFTY:65,MIDCPNIFTY:120,SENSEX:20};
const MONTHS=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function basePriceOf(sym){ if(IDX[sym])return IDX[sym]; if(EQP[sym])return EQP[sym];
  return 300+(hash('NSE:'+sym)%4700); }
function strikeStep(root,spot){ if(IDX[root])return({NIFTY:50,BANKNIFTY:100,FINNIFTY:50,MIDCPNIFTY:25,SENSEX:100})[root]||50;
  return spot>4000?100:spot>1500?50:spot>500?20:spot>200?10:5; }
const expFmts=[];
(function(){ const d=new Date(); const wk=[];
  while(wk.length<3){d.setDate(d.getDate()+1);if(d.getDay()===4)wk.push(new Date(d));}
  const last=new Date(d.getFullYear(),d.getMonth(),0);
  while(last.getDay()!==4)last.setDate(last.getDate()-1);
  if(last>wk[2])wk.push(last); else{const n=new Date(d.getFullYear(),d.getMonth()+1,0);while(n.getDay()!==4)n.setDate(n.getDate()-1);wk.push(n);}
  wk.forEach(dt=>expFmts.push(String(dt.getDate()).padStart(2,'0')+MONTHS[dt.getMonth()]+String(dt.getFullYear()).slice(2)));
})();
function tym(f){ const dd=String(f).match(/^(\d{2})([A-Z]{3})(\d{2})$/); if(!dd)return 2/365;
  const dt=new Date(2000+ +dd[3],MONTHS.indexOf(dd[2]),+dd[1],15,30);
  return Math.max(0.4,(dt-Date.now())/864e5)/365; }
function parseKey(k){ k=k.trim().toUpperCase(); const i=k.indexOf(':');
  return i<0?{exch:'NSE',sym:k}:{exch:k.slice(0,i),sym:k.slice(i+1)}; }
function normKey(k){ const {exch,sym}=parseKey(k); return exch+':'+sym; }
function ncdf(x){const t=1/(1+.2316419*Math.abs(x));const d=.3989423*Math.exp(-x*x/2);
  const p=d*t*(.3193815+t*(-.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return x>0?1-p:p}
function bs(S,K,T,iv,isCall){ if(T<=0)T=1/(365*8); const r=.065,sq=iv*Math.sqrt(T);
  const d1=(Math.log(S/K)+(r+iv*iv/2)*T)/sq,d2=d1-sq,disc=Math.exp(-r*T);
  return Math.max(.05,isCall?S*ncdf(d1)-K*disc*ncdf(d2):K*disc*ncdf(-d2)-S*ncdf(-d1)); }
function mapApiRows(rows){
  const days=[],dayIdx=new Map();
  for(const r of rows){ const t=(+r.timestamp>1e12?+r.timestamp:+r.timestamp*1000);
    const dk=new Date(t).toDateString();
    if(!dayIdx.has(dk)){dayIdx.set(dk,days.length);days.push(new Date(dk));} }
  const map=new Map();
  for(const r of rows){ const t=(+r.timestamp>1e12?+r.timestamp:+r.timestamp*1000);
    const d=new Date(t); const di=dayIdx.get(d.toDateString());
    const mins=d.getHours()*60+d.getMinutes();
    const gm=di*SESSION+clamp(mins-OPEN_MIN,0,SESSION-1);
    const o=+r.open,h=+r.high,l=+r.low,c=+r.close,v=+r.volume||0;
    const ex=map.get(gm);
    if(!ex)map.set(gm,{o,h,l,c,v});
    else{ex.h=Math.max(ex.h,h);ex.l=Math.min(ex.l,l);ex.c=c;ex.v+=v;} }
  const bars=[...map.entries()].sort((a,b)=>a[0]-b[0]).map(e=>e[1]);
  return {bars,dayLbl:days.map(fmtDate)};
}

const metaCache=new Map();
function resolveMeta(key){
  if(metaCache.has(key))return metaCache.get(key);
  const {exch,sym}=parseKey(key);
  const m={key,exch,sym,disp:sym,type:'EQ',basePrice:0};
  const um=sym.match(/^([A-Z]+?)(\d{2}[A-Z]{3}\d{2})(\d+)(CE|PE)$/);
  const fm=sym.match(/^([A-Z]+?)(\d{2}[A-Z]{3}\d{2})FUT$/);
  if(um){ const root=um[1];
    Object.assign(m,{type:'OPT',root,underlying:'NSE:'+root,exp:um[2],strike:+um[3],optSide:um[4]});
    const ei=expFmts.indexOf(um[2]);
    m.iv=((IDX[root]?0.13:0.22)+(ei<=0?0:0.01*ei));
    m.basePrice=bs(basePriceOf(root),m.strike,tym(um[2]),m.iv,um[4]==='CE');
    m.disp=`${root} ${m.strike} ${um[4]}`;
  }else if(fm){ const root=fm[1];
    Object.assign(m,{type:'FUT',root,underlying:'NSE:'+root,exp:fm[2]});
    m.basePrice=basePriceOf(root)*(1+0.0006*(expFmts.indexOf(fm[2])+1)); m.disp=`${root} FUT`; }
  else{ m.type=IDX[sym]?'INDEX':'EQ'; m.basePrice=basePriceOf(sym); }
  metaCache.set(key,m); return m;
}
const disp=key=>{try{return resolveMeta(key).disp}catch(e){return key}};
const quotes=new Map();
function liveSpot(root){ const q=quotes.get('NSE:'+root); return q?q.ltp:basePriceOf(root); }
const dataCache=new Map();
function genSeries(key){
  const m=resolveMeta(key);
  const r=mulberry32(hash(key)); const g=gaussR(r);
  const out={bars:[],dayLbl:[]};
  const volBase=m.type==='INDEX'?0.00030:m.type==='OPT'?Math.max(.05,m.iv)*0.09:0.00042;
  const dts=[];{const dd=new Date();while(dts.length<3){dd.setDate(dd.getDate()-1);
    const w=dd.getDay();if(w!==0&&w!==6)dts.push(new Date(dd));}dts.reverse();}
  let p=m.basePrice*(1-(r()-.5)*0.008);
  for(let s=0;s<3;s++){
    out.dayLbl.push(fmtDate(dts[s]));
    p*=1+(r()-.5)*0.004;
    let regimeLeft=0,drift=0;
    for(let mi=0;mi<SESSION;mi++){
      if(regimeLeft<=0){regimeLeft=25+(r()*45|0);drift=(r()-.48)*0.0009;if(r()<0.06)drift*=4;}
      const smile=1+1.5*Math.exp(-mi/45)+1.05*Math.exp(-(SESSION-mi)/55);
      const vol=volBase*smile,va=p*vol;
      const o=p,c=o*(1+drift+g()*vol);
      const h=Math.max(o,c)+va*(0.15+r()*0.85);
      const l=Math.min(o,c)-va*(0.15+r()*0.85);
      const v=Math.round((m.type==='INDEX'?9000:5200)*smile*(0.5+r())*(1+Math.abs(c-o)/(va||1e-9)*0.35));
      out.bars.push({o,h,l,c,v});p=c;
    }
  }
  const k=m.basePrice/out.bars[out.bars.length-1].c;
  for(const b of out.bars){b.o*=k;b.h*=k;b.l*=k;b.c*=k;}
  out.price=m.basePrice; out.prevClose=out.bars[SESSION*2-1].c;
  return out;
}
function symbolData(key){
  if(dataCache.has(key))return dataCache.get(key);
  const sd=genSeries(key); dataCache.set(key,sd); return sd;
}
function ensureQuote(key){
  if(quotes.has(key))return quotes.get(key);
  const sd=symbolData(key);
  const q={ltp:sd.price,prevClose:sd.prevClose};
  quotes.set(key,q); return q;
}
const BROKERS={};                                    // broker registry
