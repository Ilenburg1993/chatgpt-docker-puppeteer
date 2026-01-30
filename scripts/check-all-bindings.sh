#!/usr/bin/env bash
set -euo pipefail

# Version: 1.1 (2026-01-30) - calls fix-bindings.js with optional --apply
# Runs static scanner + runtime binding checks and writes a report.

OUT_DIR="diagnostics"
OUT_FILE="$OUT_DIR/bindings_report.txt"

# Determine apply flag: env APPLY_BINDINGS=1|true or --apply arg
APPLY_FLAG=false
if [ "${APPLY_BINDINGS:-}" = "1" ] || [ "${APPLY_BINDINGS:-}" = "true" ]; then
  APPLY_FLAG=true
fi
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY_FLAG=true ;;
  esac
done

mkdir -p "$OUT_DIR"
: > "$OUT_FILE"

echo "Bindings check report - $(date --iso-8601=seconds)" | tee -a "$OUT_FILE"

echo -e "\n[STEP] Static scan: src/server" | tee -a "$OUT_FILE"
if node ./scripts/find-bindings.js ./src/server >> "$OUT_FILE" 2>&1; then
  echo "[OK] Static scan (server) finished with no issues." | tee -a "$OUT_FILE"
else
  echo "[FAIL] Static scan (server) detected issues." | tee -a "$OUT_FILE"
fi


echo -e "\n[STEP] Static scan: src/infra" | tee -a "$OUT_FILE"
if node ./scripts/find-bindings.js ./src/infra >> "$OUT_FILE" 2>&1; then
  echo "[OK] Static scan (infra) finished with no issues." | tee -a "$OUT_FILE"
else
  echo "[FAIL] Static scan (infra) detected issues." | tee -a "$OUT_FILE"
fi


echo -e "\n[STEP] Codemod: fix-bindings.js" | tee -a "$OUT_FILE"
if [ "$APPLY_FLAG" = "true" ]; then
  echo "[INFO] APPLY enabled: running fix-bindings.js with --apply" | tee -a "$OUT_FILE"
  if node ./scripts/fix-bindings.js ./src --apply >> "$OUT_FILE" 2>&1; then
    echo "[OK] Codemod applied." | tee -a "$OUT_FILE"
  else
    echo "[FAIL] Codemod detected occurrences or failed." | tee -a "$OUT_FILE"
  fi
else
  echo "[INFO] Dry-run: running fix-bindings.js (no --apply)" | tee -a "$OUT_FILE"
  if node ./scripts/fix-bindings.js ./src >> "$OUT_FILE" 2>&1; then
    echo "[OK] Codemod dry-run found no occurrences." | tee -a "$OUT_FILE"
  else
    echo "[WARN] Codemod dry-run detected occurrences. Re-run with --apply to apply." | tee -a "$OUT_FILE"
  fi
fi


echo -e "\n[STEP] Runtime binding checks (ss/netstat)" | tee -a "$OUT_FILE"
CHECK_PORTS="${CHECK_PORTS:-3000,3001,3002,3008,9100,9224}" ./scripts/check-bindings.sh >> "$OUT_FILE" 2>&1 || echo "[FAIL] Runtime check detected issues." | tee -a "$OUT_FILE"


echo -e "\n[END] Report generated: $OUT_FILE" | tee -a "$OUT_FILE"

# Exit with non-zero if report contains FAIL
if grep -q "\[FAIL\]" "$OUT_FILE"; then
  exit 1
else
  exit 0
fi
