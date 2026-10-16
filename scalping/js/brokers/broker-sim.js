'use strict';
/* SIM broker — deterministic local feed. Also the default fills engine. */
window.BROKERS=window.BROKERS||{};
BROKERS.sim={
  id:'sim', label:'SIM',
  fields:[],
  async test(){ return true; },
  async history(cfg,key){
    const sd=symbolData(key);
    return {bars:sd.bars.map(b=>({...b})),dayLbl:[...sd.dayLbl],price:sd.price,prevClose:sd.prevClose};
  },
  async quote(cfg,key){ const q=ensureQuote(key); return {ltp:q.ltp,prevClose:q.prevClose}; },
  async placeOrder(cfg,o){ return {ok:true,orderId:'SIM-'+Date.now()}; }
};
