'use strict';
/* Shoonya (Noren) broker — QuickAuth / TPSeries / GetQuote / PlaceOrder.
   NOTE: history needs the broker TOKEN for the symbol; put a mapping in
   settings "TOKEN MAP" e.g. {"NIFTY":"26000","RELIANCE":"2885"}. Symbols
   without a token fall back to using the raw symbol as token.          */
BROKERS.shoonya={
  id:'shoonya', label:'SHOONYA',
  fields:[
    {k:'url', l:'BASE URL', ph:'https://api.shoonya.com/NorenWClientTP'},
    {k:'uid', l:'USER ID', ph:'FA12345'},
    {k:'pwd', l:'PASSWORD', ph:'••••••'},
    {k:'vc',  l:'VENDOR CODE', ph:'FA_U'},
    {k:'secret', l:'API SECRET', ph:'api_secret'},
    {k:'imei', l:'IMEI', ph:'abc1234'},
    {k:'tokens', l:'TOKEN MAP (JSON, optional)', ph:'{"NIFTY":"26000"}'}],
  async sha256(s){ const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''); },
  async login(cfg){
    if(this._sid&&this._uid===cfg.uid)return;
    const appkey=await this.sha256(cfg.uid+'|'+cfg.secret);
    const body=new URLSearchParams({apkversion:'1.0.0',uid:cfg.uid,password:cfg.pwd,
      factors:'2FA',productcode:'API',vc:cfg.vc||'FA',appkey,imei:cfg.imei||'abc1234'});
    const res=await fetch((cfg.url||'').replace(/\/+$/,'')+'/QuickAuth',
      {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
    const j=await res.json();
    if(j.stat!=='Ok')throw new Error(j.emsg||'login failed');
    this._sid=j.susertoken; this._uid=cfg.uid;
  },
  async jpost(cfg,path,obj){
    await this.login(cfg);
    const res=await fetch((cfg.url||'').replace(/\/+$/,'')+'/'+path,
      {method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({...obj,susertoken:this._sid})});
    const j=await res.json();
    if(j.stat&&j.stat!=='Ok')throw new Error(j.emsg||path+' failed');
    return j;
  },
  tokenOf(cfg,sym){
    try{ const m=JSON.parse(cfg.tokens||'{}'); return m[sym]||sym; }catch(e){ return sym; }
  },
  async test(cfg){ await this.login(cfg); return true; },
  async history(cfg,key){
    const {exch,sym}=parseKey(key);
    const token=this.tokenOf(cfg,sym);
    const endtime=new Date().toLocaleDateString('en-GB').split('/').reverse().join('-');
    const j=await this.jpost(cfg,'TPSeries',{uid:cfg.uid,token,endtime,interval:'1'});
    const rows=(j.data||[]).map(d=>{
      const [t,dd]=String(d.intt||'').split(' ');
      const [hh,mm]=t.split(':').map(Number);
      const [DD,MM,YY]=dd.split('-').map(Number);
      return {timestamp:new Date(YY,MM-1,DD,hh,mm).getTime(),
        open:+d.into,high:+d.inth,low:+d.intl,close:+d.intc,volume:+d.intv||0};});
    const mapped=mapApiRows(rows);
    if(!mapped.bars.length)throw new Error('empty history');
    mapped.price=mapped.bars[mapped.bars.length-1].c;
    mapped.prevClose=mapped.bars[Math.max(0,mapped.bars.length-1-SESSION)].c;
    return mapped;
  },
  async quote(cfg,key){
    const {exch,sym}=parseKey(key);
    const j=await this.jpost(cfg,'GetQuote',{uid:cfg.uid,exch,token:this.tokenOf(cfg,sym)});
    return {ltp:+j.lp||0,prevClose:+j.c||0};
  },
  async placeOrder(cfg,o){
    const {exch,sym}=parseKey(o.key);
    const j=await this.jpost(cfg,'PlaceOrder',{uid:cfg.uid,actid:cfg.uid,exch,
      tsym:sym,qty:o.qty,prc:o.priceType==='LIMIT'?o.price:0,
      prd:({MIS:'I',NRML:'M',CNC:'C'})[o.product]||'I',trantype:o.side>0?'B':'S',prctyp:o.priceType,ret:'DAY'});
    return {ok:true,orderId:j.norenmsg||''};
  }
};
