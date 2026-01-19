#!/usr/bin/env bash
set -euo pipefail
# Post-rotation verification: run gitleaks if available and save reports.

OUTDIR="../actions-check"
mkdir -p "$OUTDIR"

if command -v gitleaks >/dev/null 2>&1; then
  echo "Running gitleaks against analysis/repo-verify"
  gitleaks detect --source ../repo-verify --report-path "$OUTDIR/gitleaks-report.json" || true
else
  echo "gitleaks not installed; skipping. To install: https://github.com/zricethezav/gitleaks"
fi

if command -v trufflehog >/dev/null 2>&1; then
  echo "Running trufflehog (git history) against ../repo-verify"
  trufflehog git --json ../repo-verify > "$OUTDIR/trufflehog-verify.json" || true
else
  echo "trufflehog not installed; skipping. Consider running via Docker." 
fi

echo "Verification reports saved to $OUTDIR"
