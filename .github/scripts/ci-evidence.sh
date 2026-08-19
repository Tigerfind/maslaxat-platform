#!/usr/bin/env bash
set -euo pipefail

mode=${1:?mode is required}
output=${2:?output path is required}

case "$mode" in
  start)
    tool=${3:?tool is required}
    mkdir -p "$(dirname "$output")"
    {
      printf 'sha=%s\n' "${GITHUB_SHA:?GITHUB_SHA is required}"
      printf 'run_id=%s\n' "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
      printf 'started_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf 'tool=%s\n' "$tool"
      printf 'result=running\n'
      printf 'final_status=pending\n'
    } > "$output"
    ;;
  finish)
    result=${3:?result is required}
    final_status=${4:?final status is required}
    {
      printf 'completed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf 'result=%s\n' "$result"
      printf 'final_status=%s\n' "$final_status"
    } >> "$output"
    ;;
  *)
    printf 'Unknown evidence mode: %s\n' "$mode" >&2
    exit 2
    ;;
esac
