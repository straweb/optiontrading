'use strict';
/* OpenAlgo broker — POST /api/v1/... */
BROKERS.openalgo={
  id:'openalgo', label:'OPENALGO',
  fields:[
    {k:'url', l:'BASE URL', ph:'https://your-ngrok.ngrok.app'},
    {k:'key', l:'API KEY', ph:'your-openalgo-api-key'}],
  async call(cfg,path,body){
    const base=(cfg.url||'').replace(/\/+$/,'');
    const cands=[base+path];
    if(location.protocol==='https:'&&base.startsWith('http:'))cands.push('https://'+base.slice(7)+path);
    let lastErr=null;
    for(const u of cands){
      try{
        const res=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(!res.ok){lastErr=new Error('HTTP '+res.status);continue;}
        const j=await res.json();
        if(j.status&&j.status!=='success'){lastErr=new Error(j.message||'api error');continue;}
        return j;
      }catch(e){
        lastErr=new Error(location.protocol==='https:'&&u.startsWith('http:')
          ?'MIXED CONTENT — https page cannot call http://… Use localhost or an HTTPS URL.'
          :'network/CORS blocked — is OpenAlgo running?');
      }
    }
    throw lastErr||new Error('request failed');
  },
  async test(cfg){ const j=await this.call(cfg,'/api/v1/quotes',{apikey:cfg.key,symbol:'NIFTY',exchange:'NSE'}); return !!j; },
  async history(cfg,key){
    const {exch,sym}=parseKey(key);
    const end=new Date(),start=new Date(Date.now()-3*864e5);
    const f=d=>d.toISOString().slice(0,19).replace('T',' ');
    const j=await this.call(cfg,'/api/v1/history',{apikey:cfg.key,symbol:sym,exchange:exch,
      interval:'1m',start_date:f(start),end_date:f(end)});
    const mapped=mapApiRows(j.data||j||[]);
    if(!mapped.bars.length)throw new Error('empty history');
    mapped.price=mapped.bars[mapped.bars.length-1].c;
    mapped.prevClose=mapped.bars[Math.max(0,mapped.bars.length-1-SESSION)].c;
    return mapped;
  },
  async quote(cfg,key){
    const {exch,sym}=parseKey(key);
    const j=await this.call(cfg,'/api/v1/quotes',{apikey:cfg.key,symbol:sym,exchange:exch});
    return {ltp:+j.data?.ltp||0,prevClose:+j.data?.prev_close||0};
  },
  async placeOrder(cfg,o){
    const j=await this.call(cfg,'/api/v1/placeorder',{apikey:cfg.key,strategy:'scalpingtool',
      symbol:o.sym,exchange:o.exch,action:o.side>0?'BUY':'SELL',
      pricetype:o.priceType,product:o.product||'MIS',quantity:o.qty,price:o.priceType==='LIMIT'?o.price:0});
    return {ok:true,orderId:j.orderid||j.data?.orderid||''};
  }
};
