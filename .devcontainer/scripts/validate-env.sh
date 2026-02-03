#!/usr/bin/env bash
# =============================================================================
# validate-env.sh — ENV Configuration Validator
# Version: 1.0
#
# CONTRATO:
# - Executa ANTES do post-create.sh
# - Valida variáveis de ambiente obrigatórias
# - Fail-fast com mensagens claras
# - Exit code 0 = sucesso, 1 = falha
#
# OBJETIVO:
# - Prevenir boot com configuração incompleta
# - Guiar usuário para correção
# - Fornecer feedback claro
# =============================================================================

set -euo pipefail

# =============================================================================
# COLORS & LOGGING
# =============================================================================

if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    RED="$(tput setaf 1)"
    GREEN="$(tput setaf 2)"
    YELLOW="$(tput setaf 3)"
    BLUE="$(tput setaf 4)"
    NC="$(tput sgr0)"
else
    RED=""
    GREEN=""
    YELLOW=""
    BLUE=""
    NC=""
fi

log()   { printf "%b\n" "${BLUE}ℹ️  $*${NC}"; }
ok()    { printf "%b\n" "${GREEN}✅ $*${NC}"; }
warn()  { printf "%b\n" "${YELLOW}⚠️  $*${NC}"; }
error() { printf "%b\n" "${RED}❌ $*${NC}"; }

# =============================================================================
# VALIDATION CONFIGURATION
# =============================================================================

# Format: "VAR_NAME:PATTERN:DESCRIPTION"
REQUIRED_VARS=(
    "NODE_ENV:^(development|production|test)$:Ambiente de execução"
    "SERVER_PORT:^[0-9]{4,5}$:Porta do servidor"
    "CHROME_HOST:.+:Host do Chrome"
    "CHROME_PORT:^[0-9]{4,5}$:Porta do Chrome"
    "CHROME_PROXY_PORT:^[0-9]{4,5}$:Porta do Chrome Proxy"
)

OPTIONAL_VARS=(
    "LOG_LEVEL:^(debug|info|warn|error)$:Nível de log"
    "BROWSER_MODE:^(launcher|connect|wsEndpoint|auto)$:Modo de conexão browser"
    "ENABLE_STATE_FILE:^(true|false)$:Persistência de estado"
)

# =============================================================================
# VALIDATION LOGIC
# =============================================================================

echo ""
log "Validando configuração de ambiente..."
echo ""

ERRORS=0
WARNINGS=0

# ---------------------------------------------------------------------------
# 1. Validar variáveis obrigatórias
# ---------------------------------------------------------------------------
log "Variáveis obrigatórias:"

for entry in "${REQUIRED_VARS[@]}"; do
    IFS=':' read -r var pattern desc <<< "${entry}"

    value="${!var:-}"

    if [[ -z "${value}" ]]; then
        error "${var}: AUSENTE (${desc})"
        ((ERRORS++))
    elif [[ ! "${value}" =~ ${pattern} ]]; then
        error "${var}: INVÁLIDO (valor='${value}', esperado='${pattern}')"
        ((ERRORS++))
    else
        ok "${var}=${value}"
    fi
done

echo ""

# ---------------------------------------------------------------------------
# 2. Validar variáveis opcionais (warnings apenas)
# ---------------------------------------------------------------------------
log "Variáveis opcionais:"

for entry in "${OPTIONAL_VARS[@]}"; do
    IFS=':' read -r var pattern desc <<< "${entry}"

    value="${!var:-}"

    if [[ -z "${value}" ]]; then
        warn "${var}: NÃO DEFINIDA (${desc}) - Usando padrão"
        ((WARNINGS++))
    elif [[ ! "${value}" =~ ${pattern} ]]; then
        warn "${var}: INVÁLIDO (valor='${value}', esperado='${pattern}')"
        ((WARNINGS++))
    else
        ok "${var}=${value}"
    fi
done

echo ""

# ---------------------------------------------------------------------------
# 3. Validar arquivo .env (informativo)
# ---------------------------------------------------------------------------
log "Arquivo de configuração:"

if [[ -f ".env" ]]; then
    ok ".env detectado"

    # Contar variáveis definidas
    DEFINED_COUNT=$(grep -cE '^[A-Z_]+=' .env 2>/dev/null || echo 0)
    log "→ ${DEFINED_COUNT} variáveis definidas em .env"

elif [[ -f ".env.development" ]]; then
    warn ".env ausente, mas .env.development encontrado"
    log "→ Considere: cp .env.development .env"

elif [[ -f ".env.example" ]]; then
    warn ".env ausente, mas .env.example encontrado"
    log "→ Copie e configure: cp .env.example .env"

else
    warn "Nenhum arquivo .env detectado"
    log "→ Sistema usará defaults do código"
fi

echo ""

# ---------------------------------------------------------------------------
# 4. Validar ports não conflitantes
# ---------------------------------------------------------------------------
log "Validação de portas:"

SERVER_PORT_VAL="${SERVER_PORT:-3008}"
CHROME_PORT_VAL="${CHROME_PORT:-9225}"
CHROME_PROXY_PORT_VAL="${CHROME_PROXY_PORT:-9224}"

if [[ "${SERVER_PORT_VAL}" == "${CHROME_PORT_VAL}" ]] || \
   [[ "${SERVER_PORT_VAL}" == "${CHROME_PROXY_PORT_VAL}" ]] || \
   [[ "${CHROME_PORT_VAL}" == "${CHROME_PROXY_PORT_VAL}" ]]; then
    error "Conflito de portas detectado!"
    error "→ SERVER_PORT=${SERVER_PORT_VAL}"
    error "→ CHROME_PORT=${CHROME_PORT_VAL}"
    error "→ CHROME_PROXY_PORT=${CHROME_PROXY_PORT_VAL}"
    ((ERRORS++))
else
    ok "Portas não conflitantes"
fi

echo ""

# =============================================================================
# FINAL VERDICT
# =============================================================================

echo "════════════════════════════════════════════════"

if [[ $ERRORS -gt 0 ]]; then
    echo ""
    error "VALIDAÇÃO FALHOU: ${ERRORS} erro(s), ${WARNINGS} aviso(s)"
    echo ""
    log "Ações corretivas:"
    log "1. Verifique arquivo .env ou devcontainer.json"
    log "2. Consulte: DOCUMENTAÇÃO/ENV_VARIABLES_GUIDE.md"
    log "3. Template disponível: .env.example"
    echo ""
    echo "════════════════════════════════════════════════"
    exit 1
else
    echo ""
    ok "VALIDAÇÃO PASSOU: 0 erros, ${WARNINGS} avisos"
    echo ""
    if [[ $WARNINGS -gt 0 ]]; then
        log "Avisos não impedem o boot, mas verifique se a config está correta."
    fi
    log "Prosseguindo com post-create..."
    echo ""
    echo "════════════════════════════════════════════════"
    exit 0
fi
