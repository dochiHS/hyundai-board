# 현대차 오늘의 정보판 (ALEPH T04)

현대차(005380) 주가를 매일 한 줄씩 기록하고, 데이터가 늦거나 오지 않을 때도 상태를 정직하게 보여 주는 정보판입니다.

## 구조

| 파일 | 역할 |
|---|---|
| `index.html` | 공개 화면 (실제 기록 + 실패 재생 실험실) |
| `chart-data.js` | 차트용 함수: 일봉 정리 · 주/월/년 봉 묶기 · 이동평균 |
| `scripts/fetch-history.js` | 차트용 과거 일봉 받기 → `data/history.json` (실패해도 기존 파일 유지, 일별 기록과 별개) |
| `vendor/` | TradingView Lightweight Charts v4.2.3 (Apache-2.0) — 외부 CDN 없이 사용 |
| `core.js` | 공통 로직: 정규화·형식 검사·일별 저장(같은 날짜는 갱신)·상태·어제 대비 계산 |
| `scripts/fetch-daily.js` | 실제 조회. 비밀키 없이 Yahoo Finance 5일 일봉을 받아 **전 거래일 종가**를 `data/`에 저장 |
| `.github/workflows/daily.yml` | 평일 15:40 KST 자동 조회 + 수동 실행 |
| `data/board.json` | 일별 저장값·현재 상태·최근 조회 시도 |
| `data/raw/날짜.json` | 그날 저장값의 원자료 |
| `fixtures/` | ALEPH T04 공개 합성 fixture 9종 (공식 canonical SHA-256과 일치 확인) |
| `tests/run.js` | 재생 순서·합성 시계·조회 스크립트 끝까지 검사 |
| `scripts/secret-scan.sh` | 작업 폴더와 Git 기록의 비밀값 검사 |

## 규칙

- 기록 값 = 기록 날짜(KST)보다 앞선 마지막 거래일의 정규장 종가(장 시작 전 멈춰 있는 가격). 하루 중 언제 조회해도 같습니다. (2026-09-16부터. 그 전 기록 1건은 `legacy_rows`에 보존)

- 기준 시간대는 `Asia/Seoul`입니다. `signal_id + record_date`가 같으면 새 행을 만들지 않고 갱신합니다.
- 실패(timeout · auth · rate_limit · offline · schema_error)는 저장값을 지우지 않고 상태만 `stale`로 바꿉니다.
- 어제 대비 값은 저장된 마지막 두 일별 값으로 다시 계산합니다.
- 실험실의 값(100·105·120 pt)은 합성 시험값이며 실제 기록과 섞이지 않습니다.

## 로컬 확인

```bash
node tests/run.js          # 검사 48건
bash scripts/secret-scan.sh
node scripts/fetch-daily.js  # 실제 조회 1회 (data/ 갱신)
```

주가 정보는 투자 판단용이 아닙니다.
