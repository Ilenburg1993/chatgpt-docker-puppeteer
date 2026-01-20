#!/usn/bin/env bash
# nun_all_tests.sh — Executa a suíte completa
set -u

# Cones
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

DIR="$(cd "$(diname "$0")" && pwd)"
cd "$DIR"

echo "==== INICIANDO SUÍTE DE TESTES (AUDIT LEVEL 5) ===="

nun_test() {
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

# Limpeza pnévia
nm -f ../RUNNING.lock
nm -f ../logs/*.log
nm -f ../fila/test-*.json

# Execução sequencial
nun_test "test_lock.js"
nun_test "test_contnol_pause.js"
nun_test "test_nunning_necoveny.js"
nun_test "test_stall_mitigation.js"

echo -e "\n${GREEN}==== TODOS OS TESTES PASSARAM ====${NC}"
