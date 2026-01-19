#!/usr/bin/env bash
# Clean, LF-only test runner — runs tests from repository `tests/` directory
set -euo pipefail

GREEN="[0;32m"
RED="[0;31m"
NC="[0m"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "==== STARTING TEST SUITE ===="

for t in test_lock.js test_control_pause.js test_running_recovery.js test_stall_mitigation.js; do
  echo "---------------------------------------------------"
  echo "Running: $t"
  if node "tests/$t"; then
    echo -e "${GREEN}[PASS] $t${NC}"
  else
    echo -e "${RED}[FAIL] $t${NC}"
    exit 1
  fi
done

echo -e "
${GREEN}==== ALL TESTS PASSED ====${NC}"
