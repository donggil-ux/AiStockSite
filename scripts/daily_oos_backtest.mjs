// 데일리 트레이딩 out-of-sample 백테스트 (1회성 검증)
// 프로덕션 엔진(smart-dip.js)을 그대로 import → 튜닝에 안 쓴 유니버스 밖 종목으로 검증.
// +엣지가 유지되면 과최적화 아님(일반화됨) 증명.
import { smartDipBacktest } from '../workers/src/utils/smart-dip.js';
import { calcEMA } from '../workers/src/utils/indicators.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 기본 유니버스(NVDA AAPL MSFT AMZN GOOGL META TSLA AVGO AMD NFLX PLTR SMCI MSTR
//   COIN HOOD RBLX SHOP SOFI RKLB MARA)에 없는 종목들 — out-of-sample
const OOS = ['JPM','BAC','WFC','GS','C','V','MA','WMT','COST','TGT','HD','LOW',
  'KO','PEP','MCD','SBUX','NKE','DIS','XOM','CVX','INTC','CSCO','ORCL','CRM',
  'QCOM','TXN','MU','UBER','ABNB','F','GM','PFE','BA','CAT','UNH','VZ'];

async function yf5m(ticker){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1mo&interval=5m`;
  try{ const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}}); if(!r.ok) return null;
    const d=await r.json(); const res=d?.chart?.result?.[0]; if(!res) return null;
    return {ts:res.timestamp||[], q:res.indicators?.quote?.[0]||{}};
  }catch(e){return null;}
}

(async()=>{
  // SPX 추세 1회 계산 (필터6 입력)
  let spxTrendUp=null;
  try{
    const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=3mo&interval=1d',{headers:{'User-Agent':'Mozilla/5.0'}});
    const d=await r.json(); const cl=(d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close||[]).filter(v=>v!=null);
    if(cl.length>=21){const e=calcEMA(cl,20); spxTrendUp = cl[cl.length-1] > e[e.length-1];}
  }catch(e){}
  console.log(`[OOS] ${OOS.length}종목 · SPX추세 ${spxTrendUp} · 트레일링+점심필터\n`);

  const all=[];
  let ok=0;
  for(const sym of OOS){
    const dd=await yf5m(sym); await sleep(150);
    if(!dd||!dd.q.close||dd.q.close.length<120){process.stdout.write(`  ${sym}: 데이터부족\n`);continue;}
    ok++;
    const {trades}=smartDipBacktest(dd.q,{interval:'5m',spxTrendUp,exit:'trail',skipMidday:true,ts:dd.ts});
    for(const t of trades) all.push(t);
    process.stdout.write(`  ${sym}: ${trades.length}건\n`);
  }

  const agg=arr=>{
    const n=arr.length; if(!n) return {n:0,win:0,avgR:0};
    const w=arr.filter(t=>t.outcome==='win').length, l=arr.filter(t=>t.outcome==='loss').length;
    const sumR=arr.reduce((s,t)=>s+(t.R||0),0); const dec=w+l;
    return {n, win:dec?Math.round(w/dec*100):0, avgR:+(sumR/n).toFixed(3)};
  };
  console.log(`\n=== OOS 결과 (종목 ${ok}, 거래 ${all.length}) ===`);
  console.log('전체:', agg(all));
  console.log('등급:', {S:agg(all.filter(t=>t.grade==='S')),A:agg(all.filter(t=>t.grade==='A')),B:agg(all.filter(t=>t.grade==='B'))});
  console.log('방향:', {buy:agg(all.filter(t=>t.dir==='buy')),sell:agg(all.filter(t=>t.dir==='sell'))});
  console.log('교차검증:', {early:agg(all.filter(t=>t.bucket===0)),mid:agg(all.filter(t=>t.bucket===1)),late:agg(all.filter(t=>t.bucket===2))});
})();
