// 공통 로직: 실제 조회(scripts/fetch-daily.js)와 실패 재생(index.html)이 같은 함수를 씁니다.
// 정규화 → 형식 검사 → 일별 저장(같은 날짜는 갱신) → 상태(fresh/stale) 계산

export const TIMEZONE = 'Asia/Seoul';
export const ERROR_CODES = ['none', 'timeout', 'auth', 'rate_limit', 'offline', 'schema_error'];

// 실패 종류별 설명과 사용자가 할 다음 행동 (종류마다 다르게)
export const ERROR_GUIDE = {
  timeout: {
    title: '응답이 너무 늦음',
    why: '원천 서버가 제한시간 안에 답하지 않았습니다.',
    next: '잠시 뒤 다시 시도하세요. 값은 마지막 정상값 그대로입니다.',
  },
  auth: {
    title: '원천이 접근을 거절함 (401/403)',
    why: '데이터 원천이 이 요청을 허용하지 않았습니다. 정보판 로그인과는 무관합니다.',
    next: '원천 정책이 바뀌었을 수 있습니다. 다시 시도해도 같으면 원천 주소를 점검해야 합니다.',
  },
  rate_limit: {
    title: '호출 제한 (429)',
    why: '짧은 시간에 요청이 많아 원천이 잠시 막았습니다.',
    next: '안내된 대기 시간이 지난 뒤 다시 시도하세요.',
  },
  offline: {
    title: '연결 끊김',
    why: '네트워크에 연결되지 않았거나 원천 서버에 닿지 못했습니다.',
    next: '인터넷 연결을 확인한 뒤 다시 시도하세요.',
  },
  schema_error: {
    title: '응답 형식이 바뀜',
    why: '응답은 왔지만 값의 형식이 약속과 달라 저장하지 않았습니다.',
    next: '다시 시도해도 같으면 원천 형식 변경에 맞춰 코드를 고쳐야 합니다.',
  },
};

// 기준 시간대(Asia/Seoul) 날짜 키 'YYYY-MM-DD'
export function kstDate(input) {
  const d = input instanceof Date ? input : new Date(input);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// 화면 표시용 KST 시각 '2026-09-15 15:30:00 KST'
export function kstDateTime(input) {
  if (input == null) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d);
  return `${s} KST`;
}

// RFC 3339 (+09:00) — 과정 기록 칸에 붙여넣기 좋은 모양
export function kstRfc3339(input) {
  const s = kstDateTime(input);
  return s ? s.replace(' KST', '').replace(' ', 'T') + '+09:00' : null;
}

const DATE_RE = /^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$/;
const SIGNAL_RE = /^[a-z0-9][a-z0-9._-]*$/;
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

// normalized-reading.schema.json 과 같은 규칙
export function validateReading(r) {
  const problems = [];
  const keys = ['signal_id', 'normalized_value', 'unit', 'source_name', 'source_url',
    'source_time', 'fetched_at', 'record_timezone', 'record_date'];
  if (!r || typeof r !== 'object') return ['응답이 객체가 아님'];
  for (const k of keys) if (!(k in r)) problems.push(`${k} 없음`);
  for (const k of Object.keys(r)) if (!keys.includes(k)) problems.push(`허용되지 않은 필드 ${k}`);
  if (typeof r.signal_id !== 'string' || !SIGNAL_RE.test(r.signal_id) || r.signal_id.length > 100) problems.push('signal_id 형식');
  if (typeof r.normalized_value !== 'number' || !Number.isFinite(r.normalized_value)) problems.push('normalized_value가 숫자가 아님');
  if (typeof r.unit !== 'string' || r.unit.length < 1 || r.unit.length > 24) problems.push('unit 형식');
  if (typeof r.source_name !== 'string' || r.source_name.length < 1 || r.source_name.length > 120) problems.push('source_name 형식');
  if (typeof r.source_url !== 'string' || !r.source_url.startsWith('https://')) problems.push('source_url은 https');
  if (!(r.source_time === null || isIso(r.source_time))) problems.push('source_time 형식');
  if (!isIso(r.fetched_at)) problems.push('fetched_at 형식');
  if (r.record_timezone !== TIMEZONE) problems.push('record_timezone은 Asia/Seoul');
  if (typeof r.record_date !== 'string' || !DATE_RE.test(r.record_date)) problems.push('record_date 형식');
  return problems;
}

export function emptyStore() {
  return { rows: [], status: null, last_attempt: null };
}

const clone = (o) => JSON.parse(JSON.stringify(o));

// 정상값 저장: signal_id + record_date 가 같으면 같은 행을 갱신(새 행 X)
export function applySuccess(store, reading, attemptAt) {
  const next = clone(store);
  const id = `${reading.signal_id}:${reading.record_date}`;
  const row = { id, ...reading };
  const i = next.rows.findIndex((r) => r.id === id);
  if (i >= 0) next.rows[i] = row; else next.rows.push(row);
  next.rows.sort((a, b) => a.record_date.localeCompare(b.record_date));
  next.status = { freshness: 'fresh', error_code: 'none' };
  next.last_attempt = { at: attemptAt ?? reading.fetched_at, ok: true, error_code: 'none', detail: null };
  return next;
}

// 실패: 행은 그대로 두고 상태만 stale / 오류코드
export function applyFailure(store, errorCode, attemptAt, detail = null) {
  if (!ERROR_CODES.includes(errorCode) || errorCode === 'none') throw new Error(`알 수 없는 오류코드 ${errorCode}`);
  const next = clone(store);
  next.status = { freshness: 'stale', error_code: errorCode };
  next.last_attempt = { at: attemptAt, ok: false, error_code: errorCode, detail };
  return next;
}

export function latestRow(store) {
  return store.rows.length ? store.rows[store.rows.length - 1] : null;
}

// 어제 대비: 저장된 마지막 두 일별 값으로 다시 계산 (같은 단위일 때만)
export function computeDelta(store) {
  const n = store.rows.length;
  if (n < 2) return null;
  const prev = store.rows[n - 2];
  const cur = store.rows[n - 1];
  if (prev.unit !== cur.unit) return null;
  const diff = cur.normalized_value - prev.normalized_value;
  const pct = prev.normalized_value !== 0 ? (diff / prev.normalized_value) * 100 : null;
  return { diff, pct: pct === null ? null : Math.round(pct * 100) / 100, from_date: prev.record_date, to_date: cur.record_date, unit: cur.unit };
}

// HTTP 상태 → 오류코드 (시간초과·오프라인은 호출하는 쪽에서 따로 판단)
export function classifyHttp(status) {
  if (status >= 200 && status < 300) return 'none';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  return 'offline'; // 그 밖의 서버 오류는 '원천에 닿지 못함'으로 취급
}

// 한 번의 조회 결과(transport + payload)를 저장소에 반영 — 실제·재생 공통
// normalize: payload → reading (실패 시 throw)
export function applyOutcome(store, outcome, normalize, attemptAt) {
  const { mode, status } = outcome.transport;
  if (mode === 'timeout') return applyFailure(store, 'timeout', attemptAt, '제한시간 초과');
  if (mode === 'offline') return applyFailure(store, 'offline', attemptAt, '연결 불가');
  const code = classifyHttp(status);
  if (code !== 'none') {
    const ra = outcome.transport.headers?.['retry-after'];
    return applyFailure(store, code, attemptAt, `HTTP ${status}${ra ? ` · Retry-After ${ra}s` : ''}`);
  }
  let reading;
  try {
    reading = normalize(outcome.payload);
  } catch (e) {
    return applyFailure(store, 'schema_error', attemptAt, String(e.message || e));
  }
  const problems = validateReading(reading);
  if (problems.length) return applyFailure(store, 'schema_error', attemptAt, problems.join(', '));
  return applySuccess(store, reading, attemptAt);
}

// 재생용 정규화: fixture payload 는 이미 정규화된 모양
export const identityNormalize = (p) => {
  if (!p || typeof p !== 'object') throw new Error('payload 없음');
  return p;
};

// 실제 조회용: '장 시작 전 멈춰 있는 가격' = 전 거래일 정규장 종가
// 5일치 일봉에서 기록 날짜(KST)보다 앞선 마지막 거래일의 종가를 고릅니다.
// 이 값은 그날 안에서는 언제 조회해도 같아서, 같은 날 다시 조회해도 기록이 흔들리지 않습니다.
export const HYUNDAI = {
  signal_id: 'hyundai-motor-005380-prev-close',
  symbol: '005380.KS',
  source_name: 'Yahoo Finance 일봉 · 현대차(005380.KS) 전 거래일 종가',
  source_url: 'https://query1.finance.yahoo.com/v8/finance/chart/005380.KS?range=5d&interval=1d',
};

// 원자료에서 '전 거래일' 일봉 한 개 고르기 (정규화·화면 대조가 같은 함수를 씀)
export function pickPrevClose(json, recordDate) {
  const r = json?.chart?.result?.[0];
  const m = r?.meta;
  if (!m) throw new Error('chart.result[0].meta 없음');
  if (m.symbol !== HYUNDAI.symbol) throw new Error(`종목 불일치 ${m.symbol}`);
  if (m.currency !== 'KRW') throw new Error(`통화 불일치 ${m.currency}`);
  if (m.dataGranularity && m.dataGranularity !== '1d') throw new Error(`일봉이 아님 (${m.dataGranularity})`);
  const ts = r.timestamp;
  const close = r.indicators?.quote?.[0]?.close;
  if (!Array.isArray(ts) || !Array.isArray(close)) throw new Error('timestamp 또는 close 배열 없음');
  let pick = null;
  ts.forEach((t, i) => {
    if (typeof t !== 'number') return;
    const c = close[i];
    if (c === null || c === undefined) return; // 휴장·미확정 칸
    if (typeof c !== 'number' || !Number.isFinite(c)) throw new Error('close가 숫자가 아님');
    const d = kstDate(t * 1000);
    if (d < recordDate) pick = { trade_date: d, close: Math.round(c), time: t };
  });
  if (!pick) throw new Error(`${recordDate} 이전 거래일 종가가 응답에 없음`);
  return pick;
}

// sourceUrl: 실제로 응답을 받은 주소(예비 주소로 받았으면 그 주소)
export function normalizeYahoo(json, fetchedAt, sourceUrl = HYUNDAI.source_url) {
  const recordDate = kstDate(fetchedAt);
  const p = pickPrevClose(json, recordDate);
  return {
    signal_id: HYUNDAI.signal_id,
    normalized_value: p.close,
    unit: 'KRW',
    source_name: HYUNDAI.source_name,
    source_url: sourceUrl,
    // 원천 일봉에 적힌 그 거래일의 시각을 그대로 KST(+09:00) RFC 3339로 저장 (과정 기록 칸과 같은 문자열)
    source_time: kstRfc3339(p.time * 1000),
    fetched_at: fetchedAt,
    record_timezone: TIMEZONE,
    record_date: recordDate,
  };
}

// 원자료 파일(data/raw/날짜.json)에서 화면 대조용 값만 뽑기
export function rawFacts(json, recordDate) {
  try {
    const p = pickPrevClose(json, recordDate);
    return { price: p.close, trade_date: p.trade_date, time: kstRfc3339(p.time * 1000), currency: json.chart.result[0].meta.currency, exchange_timezone: json.chart.result[0].meta.exchangeTimezoneName ?? null };
  } catch {
    return null;
  }
}
