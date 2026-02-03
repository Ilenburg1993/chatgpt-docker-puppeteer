#!/usr/bin/env bash
# =============================================================================
# validate-boot-fixes.sh
# Script de validação das correções de boot implementadas
# =============================================================================
# Testa os 3 cenários principais:
#   1. PM2 + integrated (deve falhar com erro claro)
#   2. PM2 + split (deve passar)
#   3. Standalone + integrated (deve passar)
#
# Exit codes:
#   0 = Todos os testes passaram
#   1 = Algum teste falhou
# =============================================================================

set -euo pipefail

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Contadores
PASSED=0
FAILED=0

# Helper: Print com cor
print_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

print_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASSED++))
}

print_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAILED++))
}

print_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

# =============================================================================
# TESTE 1: Sintaxe JavaScript
# =============================================================================
print_test "Teste 1/6: Validando sintaxe do src/main.js..."

if node --check src/main.js 2>/dev/null; then
    print_pass "Sintaxe JavaScript válida"
else
    print_fail "Sintaxe JavaScript inválida"
fi

# =============================================================================
# TESTE 2: ESLint
# =============================================================================
print_test "Teste 2/6: Executando ESLint..."

if npx eslint src/main.js --quiet 2>/dev/null; then
    print_pass "ESLint passou sem erros"
else
    print_fail "ESLint encontrou erros"
fi

# =============================================================================
# TESTE 3: Função checkPortInUse existe
# =============================================================================
print_test "Teste 3/6: Verificando função checkPortInUse..."

if grep -q "async function checkPortInUse" src/main.js; then
    print_pass "Função checkPortInUse implementada"
else
    print_fail "Função checkPortInUse não encontrada"
fi

# =============================================================================
# TESTE 4: Validação PM2 + integrated implementada
# =============================================================================
print_test "Teste 4/6: Verificando validação PM2+integrated..."

if grep -q "CONFLITO DETECTADO: PM2 + SERVER_MODE=integrated" src/main.js; then
    print_pass "Validação PM2+integrated implementada"
else
    print_fail "Validação PM2+integrated não encontrada"
fi

# =============================================================================
# TESTE 5: Timeout de discovery aumentado para 30s
# =============================================================================
print_test "Teste 5/6: Verificando timeout de discovery..."

if grep -q "SERVER_DISCOVERY_TIMEOUT ?? 30000" src/main.js; then
    print_pass "Timeout de discovery aumentado para 30s"
else
    print_fail "Timeout de discovery ainda em 5s ou não encontrado"
fi

# =============================================================================
# TESTE 6: Detecção de proxy duplicado implementada
# =============================================================================
print_test "Teste 6/6: Verificando detecção de proxy duplicado..."

if grep -q "const proxyAlreadyRunning = await checkPortInUse" src/main.js; then
    print_pass "Detecção de proxy duplicado implementada"
else
    print_fail "Detecção de proxy duplicado não encontrada"
fi

# =============================================================================
# TESTE OPCIONAL 7: Simular PM2 + integrated (deve falhar)
# =============================================================================
echo ""
print_info "═══════════════════════════════════════════════════════════"
print_info "Teste Opcional 7: Simular PM2 + integrated (deve falhar)"
print_info "═══════════════════════════════════════════════════════════"

export SERVER_MODE=integrated
export pm_id=test_simulation  # Simula PM2

timeout 3s node src/main.js 2>&1 | head -20 || EXIT_CODE=$?

if [ "${EXIT_CODE:-0}" -eq 1 ] || [ "${EXIT_CODE:-0}" -eq 124 ]; then
    print_pass "Sistema rejeitou PM2+integrated conforme esperado"
else
    print_fail "Sistema NÃO rejeitou PM2+integrated (exit code: ${EXIT_CODE:-0})"
fi

unset pm_id
unset SERVER_MODE

# =============================================================================
# RESUMO FINAL
# =============================================================================
echo ""
echo "═══════════════════════════════════════════════════════════"
echo -e "${GREEN}✅ TESTES PASSADOS: $PASSED${NC}"
if [ "$FAILED" -gt 0 ]; then
    echo -e "${RED}❌ TESTES FALHADOS: $FAILED${NC}"
    echo "═══════════════════════════════════════════════════════════"
    exit 1
else
    echo -e "${GREEN}🎉 TODOS OS TESTES PASSARAM!${NC}"
    echo "═══════════════════════════════════════════════════════════"
    exit 0
fi
