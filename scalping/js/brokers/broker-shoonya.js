'use strict';
window.BROKERS=window.BROKERS||{};
window.BROKERS.shoonya={
  id:'shoonya', label:'SHOONYA',
  /* redirect-flow fields: creds identify you, key+secret build the appkey,
     TOTP is the 2FA factor. On successful QuickAuth the session token
     (susertoken) is persisted in localStorage and reused until it
     expires — you are NOT re-logged every call. */
  fields:[
    {k:'url',   l:'API BASE',            ph:'https://api.shoonya.com/NorenWClientTP'},
    {k:'uid',   l:'CLIENT / USER ID',    ph:'FA12345'},
    {k:'acct',  l:'ACCOUNT ID (actid)',  ph:'same as uid usually'},
    {k:'vc',    l:'VENDOR CODE',         ph:'FA_U'},
    {k:'apikey',l:'API KEY (app key)',   ph:'from broker portal'},
    {k:'secret',l:'API SECRET',          ph:'used to sha256(uid|secret)'},
    {k:'totp',  l:'TOTP / 2FA factor',   ph:'current TOTP or fixed factor'},
    {k:'imei',  l:'IMEI (any id)',       ph:'abc1234'},
    {k:'tokens',l:'TOKEN MAP (JSON)',    ph:'{"NIFTY":"26000","BANKNIFTY":"26009"}'}],
  async sha256(s){ const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''); },
  _key(uid){ return 'shoonya_ses_'+uid; },
  session(cfg){ try{ return JSON.parse(localStorage.getItem(this._key(cfg.uid))||'null'); }catch(e){ return null; } },
  saveSes(cfg,s){ localStorage.setItem(this._key(cfg.uid),JSON.stringify(s)); },
  logout(cfg){ localStorage.removeItem(this._key(cfg.uid)); this._sid=null; },
  /* login: QuickAuth → stores susertoken + actid locally */
  async login(cfg,force){
    const ses=this.session(cfg);
    if(!force&&ses&&ses.susertoken){ this._sid=ses.susertoken; this._actid=ses.actid||cfg.acct||cfg.uid; return true; }
    const appkey=await this.sha256((cfg.uid||'')+'|'+(cfg.secret||''));
    const body=new URLSearchParams({apkversion:'1.0.0',uid:cfg.uid||'',password:cfg.pwd||cfg.totp||'',
      factors:'2FA',productcode:'API',vc:cfg.vc||'FA',appkey,imei:cfg.imei||'abc1234'});
    const res=await fetch((cfg.url||'').replace(/\/+$/,'')+'/QuickAuth',
      {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
    const j=await res.json();
    if(j.stat!=='Ok')throw new Error(j.emsg||'login failed — check uid/secret/TOTP');
    const s={susertoken:j.susertoken,actid:j.actid||cfg.acct||cfg.uid,email:j.email||'',exarr:j.exarr||[]};
    this.saveSes(cfg,s);
    this._sid=s.susertoken; this._actid=s.actid;
    return true; },
  async jpost(cfg,path,obj){
    await this.login(cfg);
    const res=await fetch((cfg.url||'').replace(/\/+$/,'')+'/'+path,
      {method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({...obj,susertoken:this._sid})});
    let j=null; try{ j=await res.json(); }catch(e){ throw new Error(path+' bad response'); }
    if(j.stat&&j.stat!=='Ok'){
      /* session expired → re-login once */
      if(/session|token/i.test(j.emsg||'')){ this.logout(cfg); await this.login(cfg,true);
        const r2=await fetch((cfg.url||'').replace(/\/+$/,'')+'/'+path,
          {method:'POST',headers:{'Content-Type':'application/json'},
           body:JSON.stringify({...obj,susertoken:this._sid})});
        j=await r2.json();
        if(j.stat&&j.stat!=='Ok')throw new Error(j.emsg||path+' failed');
        return j; }
      throw new Error(j.emsg||path+' failed'); }
    return j; },
  tokenOf(cfg,sym){ try{ const m=JSON.parse(cfg.tokens||'{}');
      return m[sym]||m[sym.replace(/\d+.*$/,'')]||sym; }catch(e){ return sym; } },
  async test(cfg){ await this.login(cfg,true); return true; },
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
    if(!mapped.bars.length)throw new Error('empty history — check TOKEN MAP for '+sym);
    mapped.price=mapped.bars[mapped.bars.length-1].c;
    mapped.prevClose=mapped.bars[Math.max(0,mapped.bars.length-1-SESSION)].c;
    return mapped; },
  async quote(cfg,key){
    const {exch,sym}=parseKey(key);
    const j=await this.jpost(cfg,'GetQuote',{uid:cfg.uid,exch,token:this.tokenOf(cfg,sym)});
    return {ltp:+j.lp||0,prevClose:+j.c||0}; },
  async placeOrder(cfg,o){
    const {exch,sym}=parseKey(o.key);
    const j=await this.jpost(cfg,'PlaceOrder',{uid:cfg.uid,actid:this._actid||cfg.acct||cfg.uid,
      exch,tsym:sym,qty:o.qty,prc:o.priceType==='LMT'||o.priceType==='LIMIT'?o.price:0,
      prd:({MIS:'I',NRML:'M',CNC:'C'})[o.product]||'I',
      trantype:o.side>0?'B':'S',prctyp:o.priceType==='LMT'?'LMT':'MKT',ret:'DAY'});
    return {ok:true,orderId:j.norenmsg||j.request_time||''}; } };
