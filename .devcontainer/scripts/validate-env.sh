#!/usr/bin/env bash
# =============================================================================
# validate-env.sh — ENV Configuration Validator (FINAL)
# Version: 1.2
#
# CONTRATO:
# - Executa ANTES do post-create.sh
# - Valida variáveis estruturais (FATAL) e infraestrutura (estratificada por NODE_ENV)
# - Não assume existência de .env (apenas informa)
# - Fail-fast com mensagens claras
# - Exit 0 = sucesso, 1 = falha
#
# PRINCÍPIOS:
# - Compatível com set -u (usa "${VAR:-}")
# - Não imprime segredos (redaction por padrão)
# - Regras semânticas mínimas (ports, BROWSER_MODE deps)
# =============================================================================

set -euo pipefail

# =============================================================================
# COLORS & LOGGING (fail-safe)
# =============================================================================
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
  RED="$(tput setaf 1)"; GREEN="$(tput setaf 2)"; YELLOW="$(tput setaf 3)"; BLUE="$(tput setaf 4)"; NC="$(tput sgr0)"
else
  RED=""; GREEN=""; YELLOW=""; BLUE=""; NC=""
fi

log()   { printf "%b\n" "${BLUE}ℹ️  $*${NC}"; }
ok()    { printf "%b\n" "${GREEN}✅ $*${NC}"; }
warn()  { printf "%b\n" "${YELLOW}⚠️  $*${NC}"; }
error() { printf "%b\n" "${RED}❌ $*${NC}"; }

# =============================================================================
# HELPERS
# =============================================================================

# Redaction policy: hide values for likely secret vars.
# Override with DEVCONTAINER_SHOW_ENV_VALUES=1 (not recommended).
_redact_value() {
  local var="$1"
  local val="$2"
  if [[ -n "${DEVCONTAINER_SHOW_ENV_VALUES:-}" ]]; then
    printf "%s" "$val"
    return 0
  fi
  case "$var" in
    *KEY*|*TOKEN*|*SECRET*|*PASSWORD*|*PASS*|*AUTH*|*COOKIE*|*SESSION*)
      printf "<redacted>"
      ;;
    *)
      printf "%s" "$val"
      ;;
  esac
}

_is_port() {
  local p="${1:-}"
  [[ "$p" =~ ^[0-9]+$ ]] || return 1
  (( p >= 1024 && p <= 65535 ))
}

# entry format: "VAR:PATTERN:DESC"
_validate_entry() {
  local entry="$1"
  local fatal="$2" # "true" or "false"
  local mode="$3"  # label for messages

  local var pattern desc value
  IFS=':' read -r var pattern desc <<< "${entry}"
  value="${!var:-}"

  if [[ -z "${value}" ]]; then
    if [[ "${fatal}" == "true" ]]; then
      error "${mode}: ${var} AUSENTE (${desc})"
      return 2
    fi
    warn "${mode}: ${var} NÃO DEFINIDA (${desc})"
    return 1
  fi

  if [[ -n "${pattern}" ]] && [[ ! "${value}" =~ ${pattern} ]]; then
    if [[ "${fatal}" == "true" ]]; then
      error "${mode}: ${var} INVÁLIDO (valor='$(_redact_value "${var}" "${value}")', esperado='${pattern}')"
      return 2
    fi
    warn "${mode}: ${var} INVÁLIDO (valor='$(_redact_value "${var}" "${value}")', esperado='${pattern}')"
    return 1
  fi

  ok "${mode}: ${var}=$(_redact_value "${var}" "${value}")"
  return 0
}

# =============================================================================
# VALIDATION CONFIGURATION (aligned with your v6 taxonomy)
# =============================================================================

# STRUCTURAL (FATAL always)
STRUCTURAL_VARS=(
  "NODE_ENV:^(development|test|production)$:Ambiente de execução"
  "SERVER_MODE:.+:Modo do servidor (ex: standalone|proxy|...)"
  "SERVER_AUTHORITY:.+:Autoridade/identidade do servidor (ex: local|dev|prod)"
  "BROWSER_MODE:^(launcher|connect|wsEndpoint|auto)$:Modo de conexão do browser"
)

# INFRASTRUCTURE (FATAL in production, WARNING otherwise)
INFRA_VARS=(
  "SERVER_PORT:^[0-9]{2,5}$:Porta do servidor (1024-65535)"
  "CHROME_HOST:.+:Host do Chrome (ex: host.docker.internal)"
  "CHROME_PORT:^[0-9]{2,5}$:Porta do Chrome (1024-65535)"
  "CHROME_PROXY_PORT:^[0-9]{2,5}$:Porta do Chrome Proxy (1024-65535)"
  "CHROME_PROXY_BIND:.+:Bind/interface do proxy (ex: 0.0.0.0)"
  "HOST:.+:Host/hostname semântico (ex: devcontainer)"
)

# OPERATIONAL (INFO/WARN only; never blocks)
OPERATIONAL_VARS=(
  "LOG_LEVEL:^(debug|info|warn|error)$:Nível de log"
  "BROWSER_POOL_SIZE:^[0-9]+$:Tamanho do pool de browser"
  "ALLOW_DEGRADED_MODE:^(true|false)$:Permite modo degradado"
  "ENABLE_STATE_FILE:^(true|false)$:Persistência de estado"
  "DEVCONTAINER_NSS_DIR:.+:Diretório base do NSS wrapper"
  "DEVCONTAINER_MAKE_TIMEOUT:^[0-9]+$:Timeout do post-start make info (segundos)"
)

# FLAGS (INFO only)
FLAG_VARS=(
  "MOCK_CHROME:^(0|1|true|false)$:Mock do Chrome (test only)"
  "PUPPETEER_LOCAL_LAUNCH_DISABLED:^(0|1|true|false)$:Desabilita launch local"
  "FACTORY_VALIDATE_BOOT:^(0|1|true|false)$:Valida boot na factory"
  "DEVCONTAINER_SKIP_NSS:^(0|1|true|false)$:Bypass NSS wrapper"
  "DEVCONTAINER_NSS_DEBUG:^(0|1|true|false)$:Debug do NSS gatekeeper"
)

# =============================================================================
# RUN
# =============================================================================
echo ""
log "Validando configuração de ambiente (validate-env v1.2)..."
echo ""

ERRORS=0
WARNINGS=0
INFRA_MODE="WARNING"
OPER_MODE="INFO"

NODE_ENV_VAL="${NODE_ENV:-development}"
case "${NODE_ENV_VAL}" in
  production)
    INFRA_MODE="FATAL"
    OPER_MODE="WARNING"
    ;;
  test)
    INFRA_MODE="WARNING"
    OPER_MODE="INFO"
    ;;
  development|*)
    INFRA_MODE="WARNING"
    OPER_MODE="INFO"
    ;;
esac

log "NODE_ENV efetivo: ${NODE_ENV_VAL}"
log "Modo: STRUCTURAL=FATAL | INFRA=${INFRA_MODE} | OPERATIONAL=${OPER_MODE}"
echo ""

# ---------------------------------------------------------------------------
# 1) STRUCTURAL (fatal)
# ---------------------------------------------------------------------------
log "STRUCTURAL (FATAL):"
for entry in "${STRUCTURAL_VARS[@]}"; do
  if ! _validate_entry "${entry}" "true" "STRUCT"; then
    ((ERRORS++))
  fi
done
echo ""

# ---------------------------------------------------------------------------
# 2) INFRA (stratified)
# ---------------------------------------------------------------------------
log "INFRASTRUCTURE (${INFRA_MODE}):"
for entry in "${INFRA_VARS[@]}"; do
  if [[ "${INFRA_MODE}" == "FATAL" ]]; then
    if ! _validate_entry "${entry}" "true" "INFRA"; then
      ((ERRORS++))
    fi
  else
    if ! _validate_entry "${entry}" "false" "INFRA"; then
      ((WARNINGS++))
    fi
  fi
done
echo ""

# ---------------------------------------------------------------------------
# 3) OPERATIONAL (never fatal)
# ---------------------------------------------------------------------------
log "OPERATIONAL (${OPER_MODE}):"
for entry in "${OPERATIONAL_VARS[@]}"; do
  if [[ "${OPER_MODE}" == "WARNING" ]]; then
    if ! _validate_entry "${entry}" "false" "OPER"; then
      ((WARNINGS++))
    fi
  else
    # INFO mode: only warn if invalid/present but bad; missing is info-ish warning
    if ! _validate_entry "${entry}" "false" "OPER"; then
      ((WARNINGS++))
    fi
  fi
done
echo ""

# ---------------------------------------------------------------------------
# 4) FLAGS (info only)
# ---------------------------------------------------------------------------
log "FLAGS (INFO):"
for entry in "${FLAG_VARS[@]}"; do
  IFS=':' read -r var pattern desc <<< "${entry}"
  val="${!var:-}"
  if [[ -n "${val}" ]]; then
    if [[ -n "${pattern}" && ! "${val}" =~ ${pattern} ]]; then
      warn "FLAG: ${var} presente mas inválida (valor='$(_redact_value "${var}" "${val}")', esperado='${pattern}')"
      ((WARNINGS++))
    else
      ok "FLAG: ${var}=$(_redact_value "${var}" "${val}")"
    fi
  fi
done
echo ""

# ---------------------------------------------------------------------------
# 5) File hints (informational)
# ---------------------------------------------------------------------------
log "Arquivos de configuração (INFO):"
if [[ -f ".env" ]]; then
  ok ".env detectado"
elif [[ -f ".env.${NODE_ENV_VAL}" ]]; then
  warn ".env ausente, mas .env.${NODE_ENV_VAL} encontrado"
  log "→ Considere: cp .env.${NODE_ENV_VAL} .env (se seu fluxo usar .env)"
elif [[ -f ".env.example" ]]; then
  warn ".env ausente, mas .env.example encontrado"
  log "→ Considere: cp .env.example .env"
else
  warn "Nenhum arquivo .env detectado (isso pode ser OK; remoteEnv pode ser a fonte)."
fi
echo ""

# ---------------------------------------------------------------------------
# 6) Port semantics
# ---------------------------------------------------------------------------
log "Validação semântica de portas:"
sp="${SERVER_PORT:-}"
cp="${CHROME_PORT:-}"
pp="${CHROME_PROXY_PORT:-}"

# Validate ranges only when present
for name in SERVER_PORT CHROME_PORT CHROME_PROXY_PORT; do
  v="${!name:-}"
  if [[ -n "${v}" ]]; then
    if ! _is_port "${v}"; then
      warn "Porta inválida: ${name}='${v}' (esperado 1024-65535)"
      ((WARNINGS++))
      # In production, treat invalid infra port as fatal
      if [[ "${NODE_ENV_VAL}" == "production" ]]; then
        ((ERRORS++))
      fi
    fi
  fi
done

# Conflicts if all exist (or if at least two exist and collide)
if [[ -n "${sp}" && -n "${cp}" && "${sp}" == "${cp}" ]] || \
   [[ -n "${sp}" && -n "${pp}" && "${sp}" == "${pp}" ]] || \
   [[ -n "${cp}" && -n "${pp}" && "${cp}" == "${pp}" ]]; then
  error "Conflito lógico de portas detectado:"
  error "→ SERVER_PORT=${sp:-<unset>}"
  error "→ CHROME_PORT=${cp:-<unset>}"
  error "→ CHROME_PROXY_PORT=${pp:-<unset>}"
  ((ERRORS++))
else
  ok "Sem conflito lógico de portas (até onde foi possível avaliar)."
fi
echo ""

# ---------------------------------------------------------------------------
# 7) Semantic dependencies
# ---------------------------------------------------------------------------
log "Dependências semânticas:"
BROWSER_MODE_VAL="${BROWSER_MODE:-}"
if [[ "${BROWSER_MODE_VAL}" == "wsEndpoint" ]]; then
  missing=0
  for v in CHROME_HOST CHROME_PORT CHROME_PROXY_PORT; do
    if [[ -z "${!v:-}" ]]; then
      error "BROWSER_MODE=wsEndpoint requer ${v} (ausente)"
      ((missing++))
    fi
  done
  if [[ "${missing}" -gt 0 ]]; then
    ((ERRORS++))
  else
    ok "BROWSER_MODE=wsEndpoint: dependências satisfeitas."
  fi
fi

if [[ "${NODE_ENV_VAL}" == "production" && "${ALLOW_DEGRADED_MODE:-false}" == "true" ]]; then
  error "ALLOW_DEGRADED_MODE=true não permitido em produção."
  ((ERRORS++))
fi
echo ""

# =============================================================================
# FINAL VERDICT
# =============================================================================
echo "════════════════════════════════════════════════"
if [[ "${ERRORS}" -gt 0 ]]; then
  echo ""
  error "VALIDAÇÃO FALHOU: ${ERRORS} erro(s) fatal(is), ${WARNINGS} aviso(s)"
  echo ""
  log "Ações corretivas (fonte de verdade):"
  log "1) devcontainer.json (remoteEnv) / docker-compose env / runArgs --env-file"
  log "2) Documentação: .devcontainer/ENV_ANALYSIS_V6.md (se aplicável)"
  log "3) Ajuste variáveis estruturais e/ou infraestrutura (principalmente em production)."
  echo ""
  echo "════════════════════════════════════════════════"
  exit 1
fi

echo ""
ok "VALIDAÇÃO PASSOU: 0 erros, ${WARNINGS} aviso(s)"
echo ""
if [[ "${WARNINGS}" -gt 0 ]]; then
  log "Avisos não impedem o bootstrap, mas podem degradar runtime."
fi
log "Prosseguindo..."
echo ""
echo "════════════════════════════════════════════════"
exit 0
