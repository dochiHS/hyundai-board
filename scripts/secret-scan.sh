#!/usr/bin/env bash
# 비밀값 검사: 작업 폴더 전체 + Git 전체 기록에서 키·토큰 모양 문자열을 찾습니다.
# 사용: bash scripts/secret-scan.sh   (0건이면 통과)
set -u
cd "$(dirname "$0")/.."
PATTERN='(api[_-]?key|secret|token|password|passwd|authorization|bearer)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.'

echo "== 작업 폴더 =="
tree_hits=$(grep -rEino "$PATTERN" --exclude-dir=.git --exclude=secret-scan.sh . || true)
echo "${tree_hits:-0건}"

echo "== Git 전체 기록 =="
if git rev-parse --git-dir >/dev/null 2>&1; then
  hist_hits=$(git log -p --all -- . ':(exclude)scripts/secret-scan.sh' | grep -Eio "$PATTERN" || true)
  echo "${hist_hits:-0건}"
else
  hist_hits=""
  echo "Git 저장소 아님 (건너뜀)"
fi

if [ -n "$tree_hits$hist_hits" ]; then echo "결과: 의심 문자열 있음"; exit 1; fi
echo "결과: 비밀값 0건"
