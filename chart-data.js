// 차트용 순수 함수: 원천 일봉 정리 · 주/월/년 봉 묶기 · 이동평균
import { kstDate } from './core.js';

// Yahoo chart 응답(일봉) → [[YYYY-MM-DD, 시, 고, 저, 종, 거래량], ...]
export function normalizeHistory(json) {
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp;
  const q = r?.indicators?.quote?.[0];
  if (!Array.isArray(ts) || !q) throw new Error('timestamp 또는 quote 없음');
  if (r.meta?.currency && r.meta.currency !== 'KRW') throw new Error(`통화 불일치 ${r.meta.currency}`);
  const byDate = new Map();
  ts.forEach((t, i) => {
    const o = q.open?.[i]; const h = q.high?.[i]; const l = q.low?.[i]; const c = q.close?.[i]; const v = q.volume?.[i];
    if (![o, h, l, c].every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0)) return; // 빈 칸·휴장 행 제외
    const d = kstDate(new Date(t * 1000));
    const round = (x) => Math.round(x);
    byDate.set(d, [d, round(o), round(Math.max(h, o, c)), round(Math.min(l, o, c)), round(c), typeof v === 'number' ? v : 0]);
  });
  const bars = [...byDate.values()].sort((a, b) => a[0].localeCompare(b[0]));
  if (bars.length < 2) throw new Error('일봉이 너무 적음');
  return bars;
}

// 주 시작일(월요일) 키
function weekKey(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 월=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

// unit: 'day' | 'week' | 'month' | 'year' → [{time, open, high, low, close, volume, prevClose}]
export function aggregate(bars, unit) {
  const keyOf = {
    day: (d) => d,
    week: weekKey,
    month: (d) => `${d.slice(0, 7)}-01`,
    year: (d) => `${d.slice(0, 4)}-01-01`,
  }[unit];
  if (!keyOf) throw new Error(`알 수 없는 단위 ${unit}`);
  const out = [];
  for (const [d, o, h, l, c, v] of bars) {
    const k = keyOf(d);
    const last = out[out.length - 1];
    if (last && last.time === k) {
      last.high = Math.max(last.high, h);
      last.low = Math.min(last.low, l);
      last.close = c;
      last.volume += v;
      last.last_date = d;
    } else {
      out.push({ time: k, open: o, high: h, low: l, close: c, volume: v, first_date: d, last_date: d });
    }
  }
  out.forEach((b, i) => { b.prevClose = i > 0 ? out[i - 1].close : null; });
  return out;
}

// 종가 단순 이동평균
export function movingAverage(candles, n) {
  const res = [];
  let sum = 0;
  candles.forEach((b, i) => {
    sum += b.close;
    if (i >= n) sum -= candles[i - n].close;
    if (i >= n - 1) res.push({ time: b.time, value: Math.round((sum / n) * 100) / 100 });
  });
  return res;
}

export function changeOf(b) {
  if (b.prevClose == null) return null;
  const diff = b.close - b.prevClose;
  return { diff, pct: (diff / b.prevClose) * 100 };
}
