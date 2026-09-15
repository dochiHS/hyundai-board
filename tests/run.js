// 로컬 검사: node tests/run.js
// 1) 공개 fixture 재생 순서(README) 2) 같은 날 3번 + 다음 날 1번 3) 실제 조회 스크립트를 가짜 서버로 끝까지 실행
// 여기 쓰는 값은 모두 합성 시험값입니다.
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  emptyStore, applyOutcome, identityNormalize, computeDelta, latestRow, normalizeYahoo, kstDate,
} from '../core.js';

const run = promisify(execFile);
let pass = 0; let fail = 0;
const check = (name, ok, info = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};

const fx = async (name) => JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
const play = (store, f) => applyOutcome(store, f, identityNormalize, f.virtual_now);
const snapshot = (s) => ({
  freshness: s.status.freshness,
  error_code: s.status.error_code,
  row_count: s.rows.length,
  stored_value: latestRow(s)?.normalized_value ?? null,
  delta: computeDelta(s)?.diff ?? null,
});
const expectMatch = (label, s, exp) => {
  const got = snapshot(s);
  const keys = ['freshness', 'error_code', 'row_count', 'stored_value', 'delta'];
  const bad = keys.filter((k) => got[k] !== exp[k]);
  check(label, bad.length === 0, bad.length ? bad.map((k) => `${k}: ${got[k]} ≠ ${exp[k]}`).join(', ') : `${got.freshness}/${got.error_code} 행${got.row_count} 값${got.stored_value}`);
};

// 1. 정상·일별 저장
{
  const [a, b, d2] = await Promise.all(['normal-d1-a', 'normal-d1-b', 'normal-d2'].map(fx));
  let s = emptyStore();
  s = play(s, a); expectMatch('C20 D1-A', s, a.expected);
  const idA = s.rows[0].id;
  s = play(s, b); expectMatch('C20 D1-B 같은 날 갱신', s, b.expected);
  check('C20 D1-B 같은 record id', s.rows[0].id === idA);
  s = play(s, d2); expectMatch('C21 D2 새 행 + 변화 15', s, d2.expected);
}

// 2. 실패 다섯 종류
const FAILS = [['timeout', 'C12'], ['auth-401', 'C13'], ['rate-429', 'C14'], ['offline', 'C15'], ['schema-break', 'C16']];
for (const [name, c] of FAILS) {
  const [a, b, f] = await Promise.all(['normal-d1-a', 'normal-d1-b', name].map(fx));
  let s = play(play(emptyStore(), a), b);
  const before = JSON.stringify(s.rows);
  s = play(s, f);
  expectMatch(`${c} ${f.fixture_id}`, s, f.expected);
  check(`C17 ${f.fixture_id} 마지막 정상값 보존`, JSON.stringify(s.rows) === before);
}

// 3. 오류 뒤 회복
{
  const [a, b, t, r] = await Promise.all(['normal-d1-a', 'normal-d1-b', 'timeout', 'recover-d2'].map(fx));
  let s = play(play(play(emptyStore(), a), b), t);
  expectMatch('C19 복구 전 stale/timeout', s, { freshness: 'stale', error_code: 'timeout', row_count: 1, stored_value: 105, delta: null });
  s = play(s, r);
  expectMatch('C19 RECOVER-D2 → fresh/none', s, r.expected);
  check('C19 다음 날짜 행 정확히 1건', s.rows.filter((x) => x.record_date === '2026-08-25').length === 1);
}

// 4. 합성 시계: 같은 KST 날짜 3번 + 다음 날짜 1번 (자정 경계 포함)
{
  const base = { transport: { mode: 'http', status: 200, headers: {} } };
  const mk = (iso, v) => ({
    ...base,
    payload: {
      signal_id: 'clock-test', normalized_value: v, unit: 'pt', source_name: '합성 시계',
      source_url: 'https://fixtures.invalid/clock', source_time: null, fetched_at: iso,
      record_timezone: 'Asia/Seoul', record_date: kstDate(iso),
    },
  });
  // 2026-09-15 00:10 KST = 09-14T15:10Z, 23:50 KST = 09-15T14:50Z, 다음 날 00:05 KST = 09-15T15:05Z
  let s = emptyStore();
  for (const [iso, v] of [['2026-09-14T15:10:00Z', 1], ['2026-09-15T03:00:00Z', 2], ['2026-09-15T14:50:00Z', 3]]) {
    s = applyOutcome(s, mk(iso, v), identityNormalize, iso);
  }
  check('C20 같은 KST 날짜 3번 → 1행', s.rows.length === 1 && s.rows[0].record_date === '2026-09-15' && s.rows[0].normalized_value === 3);
  s = applyOutcome(s, mk('2026-09-15T15:05:00Z', 4), identityNormalize, '2026-09-15T15:05:00Z');
  check('C21 다음 KST 날짜 → 2행', s.rows.length === 2 && s.rows[1].record_date === '2026-09-16', s.rows.map((r) => r.record_date).join(','));
}

// 5. Yahoo 응답 정규화 (합성 응답)
const yahoo = (price, t, extra = {}) => ({
  chart: { result: [{ meta: { currency: 'KRW', symbol: '005380.KS', exchangeTimezoneName: 'Asia/Seoul', regularMarketPrice: price, regularMarketTime: t, ...extra } }], error: null },
});
{
  const r = normalizeYahoo(yahoo(123450, 1757916000), '2026-09-15T06:40:00.000Z');
  check('C10 정규화 값·단위·시각', r.normalized_value === 123450 && r.unit === 'KRW' && r.source_time === new Date(1757916000 * 1000).toISOString() && r.record_date === '2026-09-15');
  let threw = false;
  try { normalizeYahoo(yahoo('123450', 1757916000), 'x'); } catch { threw = true; }
  check('C16 가격이 문자열이면 형식 오류', threw);
}

// 6. 실제 조회 스크립트 끝까지 (가짜 원천 서버)
{
  let mode = 'ok';
  let price = 1000;
  const server = createServer((req, res) => {
    if (mode === 'slow') { setTimeout(() => { res.end('{}'); }, 1500); return; }
    if (mode === '401') { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"e":1}'); return; }
    if (mode === '429') { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' }); res.end('{"e":1}'); return; }
    const body = mode === 'schema' ? yahoo(String(price), 1757916000) : yahoo(price, Math.floor(Date.now() / 1000));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/chart`;
  const dir = await mkdtemp(join(tmpdir(), 't04-'));
  const env = { ...process.env, T04_DATA_DIR: dir, T04_TEST_URL: url, T04_DEADLINE_MS: '500' };
  const script = new URL('../scripts/fetch-daily.js', import.meta.url).pathname;
  const go = async () => { await run('node', [script], { env }); return JSON.parse(await readFile(join(dir, 'board.json'), 'utf8')); };

  let b = await go();
  check('스크립트 정상 조회 → 1행 fresh', b.rows.length === 1 && b.status.freshness === 'fresh' && b.rows[0].normalized_value === 1000);
  const raw = JSON.parse(await readFile(join(dir, 'raw', `${b.rows[0].record_date}.json`), 'utf8'));
  check('C10 원자료 = 저장값', raw.body.chart.result[0].meta.regularMarketPrice === b.rows[0].normalized_value);
  price = 1010; b = await go();
  check('스크립트 같은 날 재실행 → 1행 갱신', b.rows.length === 1 && b.rows[0].normalized_value === 1010);
  for (const [m, code] of [['slow', 'timeout'], ['401', 'auth'], ['429', 'rate_limit'], ['schema', 'schema_error']]) {
    mode = m; b = await go();
    check(`스크립트 ${m} → stale/${code}, 값 유지`, b.status.freshness === 'stale' && b.status.error_code === code && b.rows[0].normalized_value === 1010, b.last_attempt.detail);
  }
  server.close();
  const env2 = { ...env, T04_TEST_URL: 'http://127.0.0.1:9/none' };
  await run('node', [script], { env: env2 });
  b = JSON.parse(await readFile(join(dir, 'board.json'), 'utf8'));
  check('스크립트 연결 불가 → stale/offline, 값 유지', b.status.error_code === 'offline' && b.rows[0].normalized_value === 1010);
  check('시도 기록 누적', b.attempts.length === 7);
  await rm(dir, { recursive: true, force: true });
}

// 7. 차트 데이터 (합성 일봉)
{
  const { normalizeHistory, aggregate, movingAverage, changeOf, mergeBars } = await import('../chart-data.js');
  const day = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000; // KST 09:00
  const ts = [day('2026-09-07'), day('2026-09-08'), day('2026-09-09'), day('2026-09-14'), day('2026-09-15'), day('2026-10-01'), day('2027-01-04')];
  const json = { chart: { result: [{ meta: { currency: 'KRW' }, timestamp: [...ts, day('2026-09-10')], indicators: { quote: [{
    open: [100, 110, 120, 130, 140, 150, 160, null],
    high: [105, 115, 125, 135, 145, 155, 165, null],
    low: [95, 105, 115, 125, 135, 145, 155, null],
    close: [102, 112, 122, 132, 142, 152, 162, null],
    volume: [1, 2, 3, 4, 5, 6, 7, null],
  }] } }] } };
  const bars = normalizeHistory(json);
  check('차트 일봉 정리 (빈 칸 제외)', bars.length === 7 && bars[0][0] === '2026-09-07');
  const w = aggregate(bars, 'week');
  check('주봉 묶기', w.length === 4 && w[0].time === '2026-09-07' && w[0].open === 100 && w[0].close === 122 && w[0].high === 125 && w[0].low === 95 && w[0].volume === 6, JSON.stringify(w[0]));
  const m = aggregate(bars, 'month');
  check('월봉 묶기', m.length === 3 && m[0].close === 142 && m[1].prevClose === 142);
  const y = aggregate(bars, 'year');
  check('년봉 묶기', y.length === 2 && y[0].time === '2026-01-01' && y[0].close === 152 && y[1].open === 160);
  const ma = movingAverage(aggregate(bars, 'day'), 5);
  check('5일 이동평균', ma.length === 3 && ma[0].value === (102 + 112 + 122 + 132 + 142) / 5);
  let threw = false;
  try { normalizeHistory({ chart: { result: [{ ...json.chart.result[0], meta: { currency: 'KRW', dataGranularity: '1mo' } }] } }); } catch { threw = true; }
  check('월봉 응답은 일봉으로 저장하지 않음', threw);
  const merged = mergeBars(bars.slice(0, 5), [['2026-09-15', 1, 2, 1, 2, 9], ['2026-09-16', 3, 4, 3, 4, 9]]);
  check('최근 5일 보충 (같은 날짜 덮어쓰기 + 새 날짜 추가)', merged.length === 6 && merged[4][4] === 2 && merged[5][0] === '2026-09-16');
  const ch = changeOf(w[1]);
  check('봉 등락 계산', ch.diff === 142 - 122);
}

console.log(`\n합계 PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
