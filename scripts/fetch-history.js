// 차트용 과거 시세(일봉) 받기. 일별 기록(data/board.json)과는 별개이며, 실패해도 기존 파일을 그대로 둡니다.
// 사용: node scripts/fetch-history.js
import { readFile, writeFile } from 'node:fs/promises';
import { HYUNDAI, kstDate } from '../core.js';
import { normalizeHistory } from '../chart-data.js';

const DATA_DIR = process.env.T04_DATA_DIR ? new URL(`file://${process.env.T04_DATA_DIR.replace(/\/?$/, '/')}`) : new URL('../data/', import.meta.url);
const OUT = new URL('history.json', DATA_DIR);
const SOURCE = `https://query1.finance.yahoo.com/v8/finance/chart/${HYUNDAI.symbol}?range=max&interval=1d`;
const URL_ = process.env.T04_TEST_URL || SOURCE;

async function main() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.T04_DEADLINE_MS || 20000));
  let json;
  try {
    const res = await fetch(URL_, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (T04 information board; github actions)', accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (e) {
    console.log(`[history] 받기 실패, 기존 파일 유지: ${e.name === 'AbortError' ? '제한시간 초과' : e.message}`);
    return;
  } finally {
    clearTimeout(timer);
  }

  let bars;
  try {
    bars = normalizeHistory(json);
  } catch (e) {
    console.log(`[history] 형식 오류, 기존 파일 유지: ${e.message}`);
    return;
  }

  const fetchedAt = new Date().toISOString();
  const out = {
    symbol: HYUNDAI.symbol,
    name: '현대차',
    unit: 'KRW',
    source_name: 'Yahoo Finance 일봉',
    source_url: SOURCE,
    fetched_at: fetchedAt,
    timezone: 'Asia/Seoul',
    columns: ['date', 'open', 'high', 'low', 'close', 'volume'],
    bars,
  };
  await writeFile(OUT, JSON.stringify(out).replace(/\],\[/g, '],\n[') + '\n');
  const last = bars[bars.length - 1];
  console.log(`[history] ${bars.length}개 일봉 저장 (${bars[0][0]} ~ ${last[0]}), 조회 ${kstDate(fetchedAt)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
