// 실제 조회: GitHub Actions(또는 내 PC의 node)에서 실행합니다. 비밀키를 쓰지 않습니다.
// 사용: node scripts/fetch-daily.js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { applyOutcome, normalizeYahoo, HYUNDAI, emptyStore, latestRow } from '../core.js';

// T04_DATA_DIR · T04_TEST_URL 은 로컬 시험(tests/run.js)에서만 씁니다.
const DATA_DIR = process.env.T04_DATA_DIR ? new URL(`file://${process.env.T04_DATA_DIR.replace(/\/?$/, '/')}`) : new URL('../data/', import.meta.url);
const BOARD = new URL('board.json', DATA_DIR);
const RAW_DIR = new URL('raw/', DATA_DIR);
const DEADLINE_MS = Number(process.env.T04_DEADLINE_MS || 10000);
const URLS = process.env.T04_TEST_URL
  ? [process.env.T04_TEST_URL, process.env.T04_TEST_URL]
  : [
      HYUNDAI.source_url,
      HYUNDAI.source_url.replace('query1.', 'query2.'), // 첫 주소가 연결 자체에 실패할 때만 사용
    ];

async function loadBoard() {
  try {
    return JSON.parse(await readFile(BOARD, 'utf8'));
  } catch {
    return { signal: HYUNDAI, ...emptyStore(), attempts: [] };
  }
}

async function callOnce(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEADLINE_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (T04 information board; github actions)', accept: 'application/json' },
    });
    const text = await res.text();
    const headers = { 'content-type': res.headers.get('content-type') ?? '' };
    const ra = res.headers.get('retry-after');
    if (ra) headers['retry-after'] = ra;
    let payload = null;
    try { payload = JSON.parse(text); } catch { payload = { __unparsable: text.slice(0, 200) }; }
    return { url, transport: { mode: 'http', status: res.status, headers }, payload };
  } catch (e) {
    const mode = e.name === 'AbortError' ? 'timeout' : 'offline';
    return { url, transport: { mode, status: null, headers: {} }, payload: null, error: String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const board = await loadBoard();
  let outcome = await callOnce(URLS[0]);
  if (outcome.transport.mode === 'offline') outcome = await callOnce(URLS[1]);

  const fetchedAt = new Date().toISOString();
  const store = { rows: board.rows, status: board.status, last_attempt: board.last_attempt };
  const next = applyOutcome(store, outcome, (p) => normalizeYahoo(p, fetchedAt), fetchedAt);

  const attempt = { ...next.last_attempt, url: outcome.url, http_status: outcome.transport.status };
  const out = {
    signal: HYUNDAI,
    rows: next.rows,
    status: next.status,
    last_attempt: attempt,
    attempts: [attempt, ...(board.attempts ?? [])].slice(0, 30),
  };

  // 성공했을 때만 그날의 원자료를 보관 (같은 날 다시 성공하면 덮어씀 = 저장값과 같은 날의 원자료)
  if (next.last_attempt.ok) {
    const row = latestRow(next);
    await mkdir(RAW_DIR, { recursive: true });
    await writeFile(
      new URL(`${row.record_date}.json`, RAW_DIR),
      JSON.stringify({ fetched_at: fetchedAt, url: outcome.url, http_status: outcome.transport.status, body: outcome.payload }, null, 2) + '\n',
    );
  }
  await writeFile(BOARD, JSON.stringify(out, null, 2) + '\n');

  const s = next.status;
  console.log(`[T04] ${fetchedAt} → ${s.freshness}/${s.error_code}${next.last_attempt.detail ? ` (${next.last_attempt.detail})` : ''}`);
  const row = latestRow(next);
  if (row) console.log(`[T04] 최신 저장값 ${row.record_date} ${row.normalized_value} ${row.unit} · 행 ${next.rows.length}개`);
}

main().catch((e) => { console.error(e); process.exit(1); });
