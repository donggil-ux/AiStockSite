// 종가매매(미너비니) 근사 역사 백테스트 (1회성 검증)
// server.js _mvDetectSetup 을 그대로 복사 → 일봉 워크포워드(룩어헤드 없음).
// 시점별 SPX 상대강도 재현(SPY 일봉). 신호 후 스윙 트레이드 R-멀티플 측정.
// 목적: 미너비니 셋업 점수가 실제 수익을 내는가 (점수↑ → 수익↑).
const sleep = ms => new Promise(r => setTimeout(r, ms));

function mvSMA(arr, p){const o=new Array(arr.length).fill(null);for(let i=p-1;i<arr.length;i++){let s=0;for(let j=0;j<p;j++)s+=(arr[i-j]||0);o[i]=s/p;}return o;}
function mvATR(h,l,c,p){const tr=[];for(let i=0;i<c.length;i++){if(i===0){tr.push(h[i]-l[i]);continue;}tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-(c[i-1]||0)),Math.abs(l[i]-(c[i-1]||0))));}const o=new Array(c.length).fill(null);let s=0;for(let i=0;i<p&&i<tr.length;i++)s+=tr[i];if(p<=tr.length)o[p-1]=s/p;for(let i=p;i<tr.length;i++)o[i]=(o[i-1]*(p-1)+tr[i])/p;return o;}

// server.js _mvDetectSetup 복제 (등급/점수 동일)
function mvDetect(candleData, spxRet){
  if(!candleData||candleData.length<60) return null;
  const closes=candleData.map(c=>c.close),highs=candleData.map(c=>c.high),lows=candleData.map(c=>c.low),volumes=candleData.map(c=>c.volume);
  const n=closes.length,cur=closes[n-1];
  const ma50=mvSMA(closes,50),ma150=mvSMA(closes,150),ma200=n>=200?mvSMA(closes,200):null;
  const lm50=ma50[n-1],lm150=ma150[n-1],lm200=ma200?ma200[n-1]:null;
  if(!lm50||!lm150) return null;
  const rs1m=n>21?(cur/closes[n-21]-1)*100:0, rs3m=n>63?(cur/closes[n-63]-1)*100:0, rs6m=n>126?(cur/closes[n-126]-1)*100:0;
  const sp=spxRet||{r1m:0,r3m:0,r6m:0};
  const rsVsSpx=(rs6m-sp.r6m)*0.5+(rs3m-sp.r3m)*0.3+(rs1m-sp.r1m)*0.2;
  const cond1=cur>lm150&&(!lm200||cur>lm200);
  const cond2=lm150>(lm200||lm150*0.99);
  const cond3=lm200&&ma200[n-21]!=null?lm200>ma200[n-21]:ma150[n-21]!=null?lm150>ma150[n-21]:false;
  const cond4=lm50>lm150, cond5=cur>lm50;
  const lookback=Math.min(252,n);
  const low52w=Math.min(...lows.slice(-lookback)),high52w=Math.max(...highs.slice(-lookback));
  const cond6=(cur-low52w)/low52w>=0.25, cond7=(high52w-cur)/high52w<=0.25, cond8=rsVsSpx>0;
  const tts=[cond1,cond2,cond3,cond4,cond5,cond6,cond7,cond8].filter(Boolean).length;
  if(tts<6||rsVsSpx<=0) return null;
  const w=40;
  const s1=closes.slice(-w,-Math.floor(w*2/3)),s2=closes.slice(-Math.floor(w*2/3),-Math.floor(w/3)),s3=closes.slice(-Math.floor(w/3));
  const rng=a=>a.length<2?0:(Math.max(...a)-Math.min(...a))/Math.min(...a)*100;
  const range1=rng(s1),range2=rng(s2),range3=rng(s3);
  const isVCP=range1>range2&&range2>range3&&range3<range1*0.6;
  const pivot=s3.length>0?Math.max(...s3):cur, pivotBroken=cur>=pivot*0.997;
  const vols=volumes.slice(-50).filter(v=>v!=null);const avgVol50=vols.length?vols.reduce((a,b)=>a+b,0)/vols.length:0;
  const volRatio=avgVol50>0?(volumes[n-1]||0)/avgVol50:0, volConfirm=volRatio>=1.3;
  const recentVols=volumes.slice(-11,-1).filter(v=>v!=null);const avgRecent10=recentVols.length?recentVols.reduce((a,b)=>a+b,0)/recentVols.length:avgVol50;
  const volDryUp=avgVol50>0&&avgRecent10<avgVol50*0.85;
  const atrArr=mvATR(highs,lows,closes,14);const atr=atrArr[n-1]||cur*0.02;
  const swingLow=Math.min(...lows.slice(-10));let stop=Math.max(swingLow,cur*0.92);if(stop>=cur)stop=cur*0.93;
  const risk=cur-stop;
  let ts2=0;
  ts2+=(tts/8)*3;
  ts2+=rsVsSpx>=30?3.5:rsVsSpx>=15?2.5:rsVsSpx>=7?1.5:0.7;
  if(isVCP)ts2+=1.5; if(volDryUp)ts2+=0.5; if(pivotBroken)ts2+=1.0; if(volConfirm)ts2+=0.5;
  ts2=Math.min(10,ts2);
  const grade=ts2>=8.5?'S':ts2>=6.5?'A':ts2>=4.5?'B':'C';
  return {grade,totalScore:+ts2.toFixed(1),entry:cur,stop,risk,pivotBroken};
}

async function yfDay(t){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${t}?range=2y&interval=1d`;
  try{const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});if(!r.ok)return null;const d=await r.json();const res=d?.chart?.result?.[0];if(!res)return null;
    return {ts:res.timestamp||[],q:res.indicators?.quote?.[0]||{}};}catch(e){return null;}
}

const SYMS=['JPM','BAC','WFC','GS','V','MA','WMT','COST','HD','LOW','KO','PEP','MCD','SBUX','NKE','DIS',
  'XOM','CVX','INTC','CSCO','ORCL','CRM','QCOM','TXN','MU','UBER','ABNB','CAT','UNH','NVDA','AAPL','MSFT',
  'AMD','META','GOOGL','AMZN','TSLA','AVGO','NFLX','LLY','JNJ','PG','ADBE','NOW','PANW'];

(async()=>{
  // SPY 일봉 → 날짜별 시점 수익률 맵
  const spy=await yfDay('SPY'); await sleep(150);
  const spBy={};
  if(spy){const c=spy.q.close||[],t=spy.ts||[];
    for(let i=0;i<c.length;i++){if(c[i]==null)continue;const dstr=new Date(t[i]*1000).toISOString().slice(0,10);
      spBy[dstr]={r1m:i>21&&c[i-21]?(c[i]/c[i-21]-1)*100:0,r3m:i>63&&c[i-63]?(c[i]/c[i-63]-1)*100:0,r6m:i>126&&c[i-126]?(c[i]/c[i-126]-1)*100:0};}}
  console.log(`[미너비니 OOS/역사 백테스트] ${SYMS.length}종목 · 워크포워드 일봉 · 홀딩 40일 · 2R목표\n`);

  const all=[]; let okSyms=0;
  const HOLD=40;
  for(const sym of SYMS){
    const dd=await yfDay(sym); await sleep(150);
    if(!dd||!dd.q.close||dd.q.close.length<300){process.stdout.write(`  ${sym}: 데이터부족\n`);continue;}
    okSyms++;
    const C=dd.q.close,H=dd.q.high,L=dd.q.low,V=dd.q.volume,T=dd.ts;
    const candle=C.map((c,i)=>({close:c,high:H[i],low:L[i],volume:V[i]}));
    let cooldown=-1, cnt=0;
    for(let i=260;i<C.length-HOLD-1;i++){
      if(i<cooldown) continue;
      if(C[i]==null) continue;
      const dstr=new Date(T[i]*1000).toISOString().slice(0,10);
      const setup=mvDetect(candle.slice(0,i+1), spBy[dstr]);
      if(!setup) continue;
      const {entry,stop,risk,grade}=setup;
      if(!(risk>0)) continue;
      // (A) 고정 2R
      const target=entry+risk*2;
      let outcome='timeout',R=0;
      for(let j=i+1;j<=i+HOLD;j++){
        if(L[j]==null||H[j]==null) continue;
        if(L[j]<=stop){R=-1;outcome='loss';break;}
        if(H[j]>=target){R=2;outcome='win';break;}
      }
      if(outcome==='timeout'){R=+(((C[i+HOLD]-entry)/risk)).toFixed(2);}
      // (B) 트레일링 — +1R 본전 이동, 이후 최고가 대비 1R 추적
      let tstop=stop,be=false,peak=entry,Rt=0,outT='timeout';
      for(let j=i+1;j<=i+HOLD;j++){
        if(L[j]==null||H[j]==null) continue;
        if(L[j]<=tstop){Rt=+(((tstop-entry)/risk)).toFixed(2);outT=Rt>=0?'win':'loss';break;}
        if(!be&&H[j]>=entry+risk){tstop=entry;be=true;}
        if(be){peak=Math.max(peak,H[j]);tstop=Math.max(tstop,peak-risk);}
      }
      if(outT==='timeout'){Rt=+(((C[i+HOLD]-entry)/risk)).toFixed(2);}
      all.push({sym,grade,score:setup.totalScore,outcome,R,outT,Rt});
      cnt++; cooldown=i+15; // 신호 후 15봉 쿨다운(중복 방지)
    }
    process.stdout.write(`  ${sym}: ${cnt}건\n`);
  }
  const agg=(arr,k='R',ok='outcome')=>{const n=arr.length;if(!n)return{n:0,win:0,avgR:0};
    const w=arr.filter(t=>t[ok]==='win').length,l=arr.filter(t=>t[ok]==='loss').length,dec=w+l;
    return{n,win:dec?Math.round(w/dec*100):0,avgR:+(arr.reduce((s,t)=>s+(t[k]||0),0)/n).toFixed(3)};};
  console.log(`\n=== 결과 (종목 ${okSyms}, 거래 ${all.length}) ===`);
  console.log('[고정 2R] 전체:',agg(all));
  console.log('  등급:',{S:agg(all.filter(t=>t.grade==='S')),A:agg(all.filter(t=>t.grade==='A')),B:agg(all.filter(t=>t.grade==='B'))});
  console.log('[트레일링] 전체:',agg(all,'Rt','outT'));
  console.log('  등급:',{S:agg(all.filter(t=>t.grade==='S'),'Rt','outT'),A:agg(all.filter(t=>t.grade==='A'),'Rt','outT'),B:agg(all.filter(t=>t.grade==='B'),'Rt','outT')});
  // 점수 분위 (예측력 — 트레일링 기준)
  const sorted=[...all].sort((a,b)=>a.score-b.score);const q=Math.floor(sorted.length/4);
  console.log('점수분위(트레일):',{Q1:agg(sorted.slice(0,q),'Rt','outT'),Q2:agg(sorted.slice(q,2*q),'Rt','outT'),Q3:agg(sorted.slice(2*q,3*q),'Rt','outT'),Q4:agg(sorted.slice(3*q),'Rt','outT')});
})();
