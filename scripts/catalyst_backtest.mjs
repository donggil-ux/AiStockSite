// 카탈리스트 근사 역사 백테스트 (1회성 연구 스크립트)
// EDGAR 과거 8-K(키워드 검색) + 야후 일봉 → 재현 가능 점수(키워드+거래량+RSI) vs 공시 후 1·3일 수익률.
// 숏플로트·프리갭·신선도는 과거 재현 불가라 제외 → "점수-lite" 검증.
// 목적: 점수가 높을수록 실제로 더 오르는가 (점수 분위별 평균 수익률 비교).
const UA = 'StockAI research rkd687@gmail.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// server.js 와 동일 키워드/배점
const KW_HIGH = ['acquires','acquisition','merger','merge with','partnership','collaboration','strategic agreement','fda approval','fda clearance','exclusive license','exclusive agreement','artificial intelligence'];
const KW_MID  = ['new product','product launch','commercial launch','awarded','selected by','wins contract','joint venture','milestone payment','milestone achieved'];
const KW_LOW  = ['expansion','innovation','data center','nuclear','clean energy'];

const START = '2026-04-15', END = '2026-06-02'; // +3거래일 확보 위해 ~6일 전까지
const MAX_TICKERS = 180;

function kwScore(text){
  const t=String(text||'').toLowerCase(); const tags=[];
  for(const k of KW_HIGH) if(t.includes(k)){return {score:30,tier:'high'};}
  for(const k of KW_MID)  if(t.includes(k)){return {score:20,tier:'mid'};}
  for(const k of KW_LOW)  if(t.includes(k)){return {score:10,tier:'low'};}
  return {score:0,tier:'none'};
}
function rsi14(closes){
  if(closes.length<15) return null;
  let g=0,l=0;
  for(let i=closes.length-14;i<closes.length;i++){const ch=closes[i]-closes[i-1];if(ch>0)g+=ch;else l-=ch;}
  const ag=g/14, al=l/14; if(al===0) return 100; const rs=ag/al; return 100-100/(1+rs);
}

// EDGAR 전체텍스트 검색 — 키워드 구문별로 8-K 수집
async function edgarSearch(phrase){
  const out=[];
  for(let from=0; from<300; from+=100){
    const url=`https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(phrase)}%22&forms=8-K&startdt=${START}&enddt=${END}&from=${from}`;
    let d; try{ const r=await fetch(url,{headers:{'User-Agent':UA}}); if(!r.ok) break; d=await r.json(); }catch(e){break;}
    const hits=d?.hits?.hits||[]; if(!hits.length) break;
    for(const h of hits){
      const s=h._source||{};
      const dn=(s.display_names||[])[0]||'';
      const m=dn.match(/\(([A-Z][A-Z.]{0,5})\)\s*\(CIK/);
      if(!m) continue;
      out.push({ticker:m[1].replace(/\.$/,''), date:s.file_date, title:dn+' '+phrase});
    }
    if(hits.length<100) break;
    await sleep(150);
  }
  return out;
}

async function yfDaily(ticker){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  try{ const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}}); if(!r.ok) return null; const d=await r.json();
    const res=d?.chart?.result?.[0]; if(!res) return null;
    return {ts:res.timestamp||[], q:res.indicators?.quote?.[0]||{}};
  }catch(e){return null;}
}

(async()=>{
  console.log(`[EDGAR] ${START}~${END} 8-K 키워드 수집...`);
  const phrases=[...KW_HIGH,...KW_MID]; // 고·중 키워드 (검증 가치 높은 것)
  const map=new Map(); // ticker → 최고점 이벤트
  for(const p of phrases){
    const hits=await edgarSearch(p);
    for(const h of hits){
      const ks=kwScore(h.title);
      const prev=map.get(h.ticker);
      if(!prev || ks.score>prev.kw){ map.set(h.ticker,{ticker:h.ticker,date:h.date,kw:ks.score,tier:ks.tier}); }
    }
    process.stdout.write(`  "${p}": ${hits.length}건 (누적 ${map.size}종목)\n`);
    await sleep(120);
  }
  let events=[...map.values()].slice(0,MAX_TICKERS);
  console.log(`\n[가격] ${events.length}종목 야후 일봉 조회 + 점수/수익률 계산...`);
  const rows=[];
  for(let i=0;i<events.length;i++){
    const e=events[i];
    const dd=await yfDaily(e.ticker);
    await sleep(120);
    if(!dd||!dd.ts.length) continue;
    const closes=dd.q.close||[], vols=dd.q.volume||[];
    // 공시일 인덱스 (해당 날짜 또는 직후 첫 거래일)
    const target=new Date(e.date+'T00:00:00Z').getTime()/1000;
    let idx=dd.ts.findIndex(t=>t>=target);
    if(idx<30 || idx+3>=closes.length) continue;
    const entry=closes[idx]; if(!(entry>0)) continue;
    const c1=closes[idx+1], c3=closes[idx+3];
    if(!(c1>0)||!(c3>0)) continue;
    const ret1=(c1/entry-1)*100, ret3=(c3/entry-1)*100;
    // 거래량 점수 (volRatio: 공시일 vs 직전 20일 평균)
    const vslice=vols.slice(Math.max(0,idx-20),idx).filter(v=>v>0);
    const vavg=vslice.length?vslice.reduce((s,v)=>s+v,0)/vslice.length:0;
    const vr=vavg>0?(vols[idx]||0)/vavg:1;
    let vScore=0; if(vr>=10)vScore=25;else if(vr>=5)vScore=20;else if(vr>=3)vScore=15;else if(vr>=2)vScore=10;else if(vr>=1)vScore=5;
    // RSI 턴어라운드 (재현 가능 부분)
    const cl=closes.slice(0,idx+1).filter(v=>v>0);
    const rsi=rsi14(cl);
    const ma200=cl.length>=200?cl.slice(-200).reduce((s,v)=>s+v,0)/200:null;
    let rsiAdj=0; if(rsi!=null&&ma200&&entry<ma200&&rsi<=35)rsiAdj=15; else if(rsi!=null&&rsi>=70)rsiAdj=-15;
    const score=e.kw+vScore+rsiAdj;
    // 프로덕션 규율 재현 — 추격/과확장 제외 판정용 지표
    const runup5=idx>=5&&closes[idx-5]>0?(entry/closes[idx-5]-1)*100:0;   // 직전 5일 런업
    const dayChg=closes[idx-1]>0?(entry/closes[idx-1]-1)*100:0;            // 공시일 당일 변동
    const ma20=cl.length>=20?cl.slice(-20).reduce((s,v)=>s+v,0)/20:entry;
    const ext20=(entry/ma20-1)*100;                                       // MA20 대비 과확장
    rows.push({ticker:e.ticker, kw:e.kw, vr:+vr.toFixed(1), score, rsi:rsi!=null?+rsi.toFixed(0):null,
      runup5:+runup5.toFixed(1), dayChg:+dayChg.toFixed(1), ext20:+ext20.toFixed(1),
      ret1:+ret1.toFixed(2), ret3:+ret3.toFixed(2)});
  }
  console.log(`\n[결과] 유효 샘플 ${rows.length}건\n`);
  if(!rows.length){console.log('데이터 없음');return;}
  const stat=arr=>{
    if(!arr.length)return{n:0,r1:0,r3:0,win1:0};
    const a1=arr.map(x=>x.ret1),a3=arr.map(x=>x.ret3);
    return {n:arr.length,
      r1:+(a1.reduce((s,v)=>s+v,0)/a1.length).toFixed(2),
      r3:+(a3.reduce((s,v)=>s+v,0)/a3.length).toFixed(2),
      win1:Math.round(a1.filter(v=>v>0).length/a1.length*100)};
  };
  // 점수 분위 (Q1 최저 ~ Q4 최고) — 점수가 수익을 예측하면 Q4 > Q1
  const sorted=[...rows].sort((a,b)=>a.score-b.score);
  const q=Math.floor(sorted.length/4);
  const Q1=sorted.slice(0,q),Q2=sorted.slice(q,2*q),Q3=sorted.slice(2*q,3*q),Q4=sorted.slice(3*q);
  console.log('=== 점수 분위별 (점수↑ → 수익↑ 인가) ===');
  for(const [n,Q] of [['Q1(최저)',Q1],['Q2',Q2],['Q3',Q3],['Q4(최고)',Q4]]){
    const s=stat(Q); console.log(`  ${n}: ${s.n}건 | 1일 ${s.r1>=0?'+':''}${s.r1}% (승률${s.win1}%) | 3일 ${s.r3>=0?'+':''}${s.r3}%`);
  }
  console.log('\n=== 키워드 등급별 ===');
  for(const [n,t] of [['HIGH(30)','high'],['MID(20)','mid']]){
    const s=stat(rows.filter(r=>r.kw===(t==='high'?30:20))); console.log(`  ${n}: ${s.n}건 | 1일 ${s.r1>=0?'+':''}${s.r1}% | 3일 ${s.r3>=0?'+':''}${s.r3}%`);
  }
  console.log('\n전체:', stat(rows));

  // ── 프로덕션 규율(추격/과확장 제외) 적용 시 수익이 +로 도는가 ──
  console.log('\n=== 프로덕션 필터 효과 (이미 오른/과확장 제외) ===');
  const fNoChase = rows.filter(r=>r.dayChg<8 && r.runup5<20);            // 추격 제외
  const fNoExt   = fNoChase.filter(r=>r.ext20<12);                       // 과확장 제외
  const fNoHeat  = fNoExt.filter(r=>r.rsi==null||r.rsi<70);              // 과열 제외
  console.log('  추격제외:', stat(fNoChase));
  console.log('  +과확장제외:', stat(fNoExt));
  console.log('  +과열제외(최종):', stat(fNoHeat));
  // 거래량 받쳐주는 것만 (프로덕션 핵심)
  console.log('  +거래량2배↑:', stat(fNoHeat.filter(r=>r.vr>=2)));
})();
