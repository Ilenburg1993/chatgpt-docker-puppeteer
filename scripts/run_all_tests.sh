#!/usr/bin/env bash
# run_all_tests.sh — Executa a suíte completa
set -u

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "==== INICIANDO SUÍTE DE TESTES (AUDIT LEVEL 5) ===="

run_test() {
  echo -e "\n---------------------------------------------------"
  echo "Rodando: $1"
  echo "---------------------------------------------------"
  node "$1"
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}[PASS] $1${NC}"
  else
    echo -e "${RED}[FAIL] $1${NC}"
    exit 1
  fi
}

# Limpeza prévia
rm -f ../RUNNING.lock
rm -f ../logs/*.log
rm -f ../fila/test-*.json

# Execução sequencial
run_test "test_lock.js"
run_test "test_control_pause.js"
run_test "test_running_recovery.js"
run_test "test_stall_mitigation.js"

echo -e "\n${GREEN}==== TODOS OS TESTES PASSARAM ====${NC}"
#!/usr/bin/env bash
# run_all_tests.sh — Executa a suíte completa
set -u

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "==== INICIANDO SUÍTE DE TESTES (AUDIT LEVEL 5) ===="

run_test() {
  echo -e "\n---------------------------------------------------"
  echo "Rodando: $1"
  echo "---------------------------------------------------"
  node "$1"
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}[PASS] $1${NC}"
  else
    echo -e "${RED}[FAIL] $1${NC}"
    exit 1
  fi
}

# Limpeza prévia
rm -f ../RUNNING.lock
rm -f ../logs/*.log
rm -f ../fila/test-*.json

# Execução sequencial
run_test "test_lock.js"
run_test "test_control_pause.js"
run_test "test_running_recovery.js"
run_test "test_stall_mitigation.js"

echo -e "\n${GREEN}==== TODOS OS TESTES PASSARAM ====${NC}"
