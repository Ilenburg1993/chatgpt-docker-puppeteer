#!/usr/bin/env bash
# =============================================================================
# PHASE 0 — GUARDA DE EXECUÇÃO (FAIL-SAFE ABSOLUTO)
# CANONICAL v5.2.0
#
# Contrato:
# - post-attach NUNCA pode falhar
# - post-attach NUNCA pode herdar comportamento destrutivo
# - post-attach NUNCA pode bloquear o VS Code
#
# Política explícita:
# - UX resiliente > rigor de shell
# - Variáveis opcionais são aceitáveis
# =============================================================================

# Desarma heranças perigosas
set +e
set +u
set +o pipefail 2>/dev/null || true

# Neutraliza traps herdados (defensivo absoluto)
trap - ERR EXIT INT TERM 2>/dev/null || true

# ---------------------------------------------------------------------------
# CLI options parser
# ---------------------------------------------------------------------------
BRIEF=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --brief)
            BRIEF=true
            shift
            ;;
        --help)
            cat <<'EOF'
post-attach.sh [--brief] [--help] [--version]

--brief    suppress detailed environment diagnostics
--help     display this help text and exit
--version  print script version and exit
EOF
            exit 0
            ;;
        --version)
            echo "${SCRIPT_NAME} v${SCRIPT_VERSION}"
            exit 0
            ;;
        *)
            break
            ;;
    esac
done

# =============================================================================
# PHASE 1 — UX HELPERS (API SEMÂNTICA DE OUTPUT)
# CANONICAL v5.2.0
#
# Finalidade:
#   • Prover API mínima e estável de mensagens humanas
#   • Isolar detalhes de cor / terminal
#   • Garantir comportamento seguro sob set -euo pipefail
#
# Propriedades:
#   • Nenhuma lógica de negócio
#   • Nenhuma leitura de estado
#   • Nenhuma escrita
# =============================================================================

# Versão canônica do hook (fonte única da verdade)
readonly SCRIPT_NAME="post-attach"
readonly SCRIPT_VERSION="5.2.0"

# ---------------------------------------------------------------------------
# Detecção defensiva de terminal e suporte a cores
# ---------------------------------------------------------------------------
COLOR_ENABLED=false

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1; then
    COLOR_ENABLED=true
fi

# ---------------------------------------------------------------------------
# Paleta semântica (fallback silencioso)
# ---------------------------------------------------------------------------
if [[ "${COLOR_ENABLED}" == "true" ]]; then
    GREEN="$(tput setaf 2)"
    YELLOW="$(tput setaf 3)"
    BLUE="$(tput setaf 4)"
    CYAN="$(tput setaf 6)"
    NC="$(tput sgr0)"
else
    GREEN=""
    YELLOW=""
    BLUE=""
    CYAN=""
    NC=""
fi

# ---------------------------------------------------------------------------
# API de mensagens humanas
#
# Política canônica:
#   • post-attach NÃO falha
#   • NÃO existe "erro" operacional aqui
#   • Apenas: info / ok / warn
# ---------------------------------------------------------------------------
info() { printf "%b\n" "${CYAN}ℹ️  $*${NC}"; }
ok()   { printf "%b\n" "${GREEN}✅ $*${NC}"; }
warn() { printf "%b\n" "${YELLOW}⚠️  $*${NC}"; }

# =============================================================================
# PHASE 2 — BANNER DE ATTACH (IDENTIDADE HUMANA — INICIAL)
# CANONICAL v5.2.0
#
# Finalidade:
#   • Sinalizar visualmente o evento de attach
#   • Comunicar identidade do projeto
#   • Comunicar identidade e versão do hook
#
# Proibições (INVIOLÁVEIS):
#   • Nenhuma lógica condicional
#   • Nenhuma inferência temporal (primeiro / recorrente)
#   • Nenhuma dependência de estado persistente
#   • Nenhum diagnóstico
# =============================================================================

echo ""

# simple internationalization: switch to English when LANG starts with en
if [[ "${LANG:-}" =~ ^en ]]; then
    BANNER_ATTACH="🔗 VS Code attached to DevContainer"
    BANNER_PROJECT="📦 Project: ChatGPT Docker Puppeteer"
else
    BANNER_ATTACH="🔗 VS Code anexado ao DevContainer"
    BANNER_PROJECT="📦 Projeto: ChatGPT Docker Puppeteer"
fi

printf "%b\n" "${BLUE}══════════════════════════════════════════════════════════════${NC}"
printf "%b\n" "${BLUE}${BANNER_ATTACH}${NC}"
printf "%b\n" "${BLUE}${BANNER_PROJECT}${NC}"
printf "%b\n" "${BLUE}🧩 Hook: ${SCRIPT_NAME}  |  v${SCRIPT_VERSION}${NC}"
printf "%b\n" "${BLUE}══════════════════════════════════════════════════════════════${NC}"

echo ""
# =============================================================================
# PHASE 3 — NAMESPACE CANÔNICO DE ESTADO (UX / ATTACH)
# CANONICAL v5.2.0
#
# CONTRATO (NORMATIVO):
#   • Este namespace armazena APENAS estado HUMANO / UX
#   • Nada aqui é estrutural, técnico ou decisório
#   • Falha, ausência ou corrupção NÃO podem quebrar o attach
#   • Escritas são:
#       - defensivas
#       - best-effort
#       - silenciosas em caso de erro
#
# SEPARAÇÃO CRÍTICA (INVIOLÁVEL):
#   • Estado UX (attach):     .devcontainer/state/*
#   • Estado Estrutural:      .devcontainer/.initialized
#
# Observação:
#   • O KERNEL NUNCA lê este namespace
#   • Apenas humanos e UX helpers consomem estes dados
# =============================================================================

# ---------------------------------------------------------------------------
# Diretório canônico de estado UX (relativo ao projeto)
# ---------------------------------------------------------------------------
readonly UX_STATE_DIR=".devcontainer/state"

readonly FIRST_ATTACH_MARKER="${UX_STATE_DIR}/first-attach"
readonly LAST_ATTACH_MARKER="${UX_STATE_DIR}/last-attach"
readonly ATTACH_COUNT_FILE="${UX_STATE_DIR}/attach-count"
readonly LAST_ATTACH_AT_FILE="${UX_STATE_DIR}/last-attach-at"

# Flag interna: namespace UX utilizável
UX_STATE_WRITABLE=true

# ---------------------------------------------------------------------------
# Preparação defensiva do namespace
# ---------------------------------------------------------------------------
if ! mkdir -p "${UX_STATE_DIR}" 2>/dev/null; then
    UX_STATE_WRITABLE=false
fi

# ---------------------------------------------------------------------------
# Determinação semântica do tipo de attach (HUMANO)
# ---------------------------------------------------------------------------
IS_FIRST_ATTACH=false

if [[ "${UX_STATE_WRITABLE}" == "true" && ! -f "${FIRST_ATTACH_MARKER}" ]]; then
    IS_FIRST_ATTACH=true
    touch "${FIRST_ATTACH_MARKER}" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Atualização do contador de attaches (informativo)
# ---------------------------------------------------------------------------
# amortização: mantemos um contador base gravado em
# ${ATTACH_COUNT_FILE} e um offset transitório em
# ${ATTACH_COUNT_FILE}-offset.  o arquivo base só é
# reescrito quando atingimos um múltiplo de 10, mas o
# offset acumula os demais anexos para que o cálculo
# total seja correto.

ATTACH_OFFSET_FILE="${ATTACH_COUNT_FILE}-offset"

if [[ "${UX_STATE_WRITABLE}" == "true" ]]; then
    # garantimos que o diretório existe antes de mexer nos arquivos
    mkdir -p "${UX_STATE_DIR}" 2>/dev/null || true

    if [[ ! -f "${ATTACH_COUNT_FILE}" ]]; then
        # primeiro attach: criamos o arquivo base com 1 e limpamos qualquer offset
        if printf '%s\n' 1 > "${ATTACH_COUNT_FILE}.tmp" 2>/dev/null; then
            mv "${ATTACH_COUNT_FILE}.tmp" "${ATTACH_COUNT_FILE}" 2>/dev/null || true
        fi
        rm -f "${ATTACH_OFFSET_FILE}" 2>/dev/null || true
    else
        base=$(cat "${ATTACH_COUNT_FILE}" 2>/dev/null || echo 0)
        offset=0
        if [[ -f "${ATTACH_OFFSET_FILE}" ]]; then
            offset=$(cat "${ATTACH_OFFSET_FILE}" 2>/dev/null || echo 0)
        fi
        offset=$((offset + 1))
        total=$((base + offset))

        if (( total % 10 == 0 )); then
            if printf '%s\n' "${total}" > "${ATTACH_COUNT_FILE}.tmp" 2>/dev/null; then
                mv "${ATTACH_COUNT_FILE}.tmp" "${ATTACH_COUNT_FILE}" 2>/dev/null || true
            fi
            rm -f "${ATTACH_OFFSET_FILE}" 2>/dev/null || true
        else
            # atualizamos apenas o offset, mantendo o base intacto
            if printf '%s\n' "${offset}" > "${ATTACH_OFFSET_FILE}.tmp" 2>/dev/null; then
                mv "${ATTACH_OFFSET_FILE}.tmp" "${ATTACH_OFFSET_FILE}" 2>/dev/null || true
            fi
        fi
    fi

    if date -Is > "${LAST_ATTACH_AT_FILE}.tmp" 2>/dev/null; then
        mv "${LAST_ATTACH_AT_FILE}.tmp" "${LAST_ATTACH_AT_FILE}" 2>/dev/null || true
    fi

    touch "${LAST_ATTACH_MARKER}" 2>/dev/null || true
fi

# =============================================================================
# PHASE 4 — CONTEXTO BÁSICO DO AMBIENTE (DIAGNÓSTICO HUMANO)
# additional environment diagnostics including LD_PRELOAD
# CANONICAL v5.2.0
#
# CONTRATO:
#   • Diagnóstico exclusivamente informativo
#   • Nenhuma inferência operacional
#   • Nenhuma correção automática
#   • Falhas são aceitáveis e silenciosas
#
# OBJETIVO:
#   • Oferecer ao operador humano um retrato fiel do contexto atual
#   • Tornar EXPLÍCITAS as heurísticas e suas limitações
# =============================================================================

if [[ "${BRIEF}" != "true" ]]; then
    info "Contexto do ambiente:"
fi

# ---------------------------------------------------------------------------
# Identidade de execução (defensiva)
# ---------------------------------------------------------------------------
CURRENT_USER="$(whoami 2>/dev/null || echo 'desconhecido')"
WORKSPACE_DIR="${PWD:-indefinido}"

# Âncora canônica de HOME (não normativa)
USER_HOME="${HOME:-/home/${CURRENT_USER}}"

# ---------------------------------------------------------------------------
# Contexto de execução (HEURÍSTICO, NÃO NORMATIVO)
#
# Observações:
#   • Classificação indicativa
#   • Pode falhar em WSL, SSH, CI ou setups híbridos
#   • REMOTE_CONTAINERS é variável interna do VS Code (não API estável)
# ---------------------------------------------------------------------------
EXECUTION_CONTEXT="host (heurístico)"

if [[ -n "${REMOTE_CONTAINERS:-}" ]]; then
    EXECUTION_CONTEXT="DevContainer (VS Code)"
elif [[ -f "/.dockerenv" ]]; then
    EXECUTION_CONTEXT="container Docker"
fi

# ---------------------------------------------------------------------------
# Raiz lógica do projeto (HEURÍSTICA DECLARADA)
#
# Limitações conhecidas:
#   • Monorepos profundos
#   • Workspaces multi-root
#   • Execução fora do root lógico
# ---------------------------------------------------------------------------
PROJECT_ROOT="indefinido (heurístico)"

if [[ -n "${WORKSPACE_DIR}" ]]; then
    if [[ -f "${WORKSPACE_DIR}/Makefile" || -d "${WORKSPACE_DIR}/.git" ]]; then
        PROJECT_ROOT="${WORKSPACE_DIR}"
    else
        PARENT_DIR=""
        if cd "${WORKSPACE_DIR}/.." 2>/dev/null; then
            PARENT_DIR=$(pwd || true)
        fi
        if [[ -n "${PARENT_DIR}" ]] \
           && { [[ -f "${PARENT_DIR}/Makefile" ]] || [[ -d "${PARENT_DIR}/.git" ]]; }; then
            PROJECT_ROOT="${PARENT_DIR}"
        fi
    fi
fi

# ---------------------------------------------------------------------------
# Runtime Node.js (diagnóstico passivo)
#
# Observação:
#   • Ausência de Node NÃO é erro
# ---------------------------------------------------------------------------
NODE_VERSION="$(node --version 2>/dev/null || echo 'não disponível')"
NPM_VERSION="$(npm --version 2>/dev/null || echo 'não disponível')"
NODE_PATH="$(command -v node 2>/dev/null || echo 'não encontrado')"
NPM_PATH="$(command -v npm 2>/dev/null || echo 'não encontrado')"

# ---------------------------------------------------------------------------
# Output humano estruturado
# ---------------------------------------------------------------------------
printf "  • %-22s %s\n" "Usuário:"             "${CURRENT_USER}"
printf "  • %-22s %s\n" "Contexto execução:"   "${EXECUTION_CONTEXT}"
printf "  • %-22s %s\n" "Workspace (PWD):"     "${WORKSPACE_DIR}"
printf "  • %-22s %s\n" "Projeto (root):"      "${PROJECT_ROOT}"
printf "  • %-22s %s\n" "LD_PRELOAD:"           "${LD_PRELOAD:-<unset>}"
if [[ "${NODE_PATH}" =~ ^/mnt/[A-Za-z]/ ]]; then
    warn "Node.js resolve para um binário do Windows (${NODE_PATH}); prefira o Node Linux no WSL/container"
fi
if [[ "${NPM_PATH}" =~ ^/mnt/[A-Za-z]/ ]]; then
    warn "npm resolve para um binário do Windows (${NPM_PATH}); isso pode quebrar Codex, npm scripts e paths UNC"
fi
if [[ -z "${LD_PRELOAD:-}" || ! "${LD_PRELOAD}" =~ libnss_wrapper\.so ]]; then
    warn "LD_PRELOAD does not contain libnss_wrapper.so; identity wrapper may be inactive"
fi
# always expose NSS base dir when configured, regardless of LD_PRELOAD state
if [[ -n "${DEVCONTAINER_NSS_DIR:-}" ]]; then
    # print runtime info when LD_PRELOAD is set but missing wrapper, else keep simple
    if [[ -n "${LD_PRELOAD:-}" && ! "${LD_PRELOAD}" =~ libnss_wrapper\.so ]]; then
        printf "  • %-22s %s\n" "Node.js:"             "${NODE_VERSION}"
        printf "  • %-22s %s\n" "npm:"                 "${NPM_VERSION}"
        printf "  • %-22s %s\n" "Node path:"           "${NODE_PATH}"
    fi
    printf "  • %-22s %s\n" "NSS base dir:"        "${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"
    echo ""
fi



# =============================================================================
# PHASE 5 — ESTADO ESTRUTURAL
# (STATE MANIFESTO | DIAGNÓSTICO PASSIVO)
# CANONICAL v5.2.1
#
# CONTRATO (INVIOLÁVEL):
#   • Leitura ESTRITAMENTE PASSIVA
#   • Nunca escreve, corrige ou recria estado
#   • Nunca falha se o estado estiver ausente, parcial ou corrompido
#
# FONTE DE VERDADE (ORDEM DE PRECEDÊNCIA):
#   1. Manifesto estrutural canônico (post-create / Section 10)
#   2. Marcador legado (.initialized) — compatibilidade histórica
#
# OBJETIVO:
#   • Informar SE e QUANDO o post-create foi executado
#   • Expor vereditos estruturais já consolidados
#   • Eliminar inferência ambígua no attach
#
# ESCOPO:
#   • HUMANO / UX apenas
#   • KERNEL já decidiu — aqui apenas se OBSERVA
# =============================================================================

# ---------------------------------------------------------------------------
# Caminho canônico do manifesto estrutural
# (alinhado ao post-create v5.2.x)
# ---------------------------------------------------------------------------
readonly STATE_MANIFEST=".devcontainer/.initialized"

# ---------------------------------------------------------------------------
# Política de leitura do estado estrutural
# (espelhada do post-create; attach nunca decide)
# ---------------------------------------------------------------------------
ENABLE_STATE_FILE_VAL="${ENABLE_STATE_FILE:-true}"

if [[ "${ENABLE_STATE_FILE_VAL}" == "true" ]]; then
    SKIP_STATE_FILE=false
else
    SKIP_STATE_FILE=true
fi

info "Estado estrutural do DevContainer:"

# ---------------------------------------------------------------------------
# Helper interno — leitura PASSIVA de chave (best-effort)
# ---------------------------------------------------------------------------
__dc_read_manifest_key() {
    # $1 = arquivo
    # $2 = chave
    grep -E "^${2}=" "$1" 2>/dev/null | head -n1 | cut -d= -f2 || true
}

# ---------------------------------------------------------------------------
# 1. Manifesto estrutural CANÔNICO (preferencial)
# ---------------------------------------------------------------------------
if [[ "${SKIP_STATE_FILE}" == "false" && -r "${STATE_MANIFEST}" ]]; then
    ok "Manifesto estrutural detectado (fonte canônica)"

    MANIFEST_INIT_AT="$(__dc_read_manifest_key "${STATE_MANIFEST}" "initialized_at")"
    MANIFEST_SCRIPT_VERSION="$(__dc_read_manifest_key "${STATE_MANIFEST}" "script_version")"
    MANIFEST_STATUS="$(__dc_read_manifest_key "${STATE_MANIFEST}" "status")"
    MANIFEST_INTEGRITY="$(__dc_read_manifest_key "${STATE_MANIFEST}" "integrity")"

    [[ -n "${MANIFEST_INIT_AT}" ]] && \
        info "→ Último post-create em: ${MANIFEST_INIT_AT}"

    [[ -n "${MANIFEST_SCRIPT_VERSION}" ]] && \
        info "→ post-create versão: ${MANIFEST_SCRIPT_VERSION}"

    [[ -n "${MANIFEST_STATUS}" ]] && \
        info "→ Status estrutural: ${MANIFEST_STATUS}"

    [[ -n "${MANIFEST_INTEGRITY}" ]] && \
        info "→ Integridade: ${MANIFEST_INTEGRITY}"

# ---------------------------------------------------------------------------
# 2. Fallback LEGADO (compatibilidade histórica)
# ---------------------------------------------------------------------------
elif [[ -r "${STATE_MANIFEST}" ]]; then
    warn "Manifesto canônico indisponível — usando marcador legado"
    ok   "DevContainer inicializado (post-create confirmado)"

    LEGACY_INIT_AT="$(__dc_read_manifest_key "${STATE_MANIFEST}" "initialized_at")"
    LEGACY_VERSION="$(__dc_read_manifest_key "${STATE_MANIFEST}" "script_version")"

    [[ -n "${LEGACY_INIT_AT}" ]] && \
        info "→ Inicializado em: ${LEGACY_INIT_AT}"

    [[ -n "${LEGACY_VERSION}" ]] && \
        info "→ post-create versão: ${LEGACY_VERSION}"

# ---------------------------------------------------------------------------
# 3. Estado estrutural ausente / desconhecido
# ---------------------------------------------------------------------------
else
    warn "Estado estrutural indisponível"
    warn "→ post-create pode não ter sido executado ainda"
    warn "→ Se algo parecer inconsistente: Rebuild Container"
fi

echo ""

# =============================================================================
# PHASE 6 — ESTADO DE SAÚDE & CAPACIDADES CRÍTICAS (PASSIVO)
# CANONICAL v5.2.1
#
# CONTRATO (INVIOLÁVEL):
#   • Diagnóstico estritamente PASSIVO
#   • Nunca executa checks
#   • Nunca infere causa de falha
#   • Nunca corrige estado
#   • Nunca bloqueia o attach
#
# OBJETIVO:
#   • Informar o último estado de saúde conhecido
#   • Expor capacidades críticas observáveis (runtime)
# =============================================================================


# ---------------------------------------------------------------------------
# 6.1 — Healthcheck (snapshot passivo)
# ---------------------------------------------------------------------------
HEALTH_STATUS_FILE="/tmp/devcontainer-health.status"

info "Estado conhecido do sistema:"

if [[ -r "${HEALTH_STATUS_FILE}" ]]; then
    HEALTH_STATUS="$(cat "${HEALTH_STATUS_FILE}" 2>/dev/null || echo unknown)"

    if [[ "${HEALTH_STATUS}" == "ok" ]]; then
        ok "Último healthcheck registrado: OK"
    else
        warn "Último healthcheck registrado: NÃO OK"
        warn "→ Healthcheck pode ser executado manualmente (make health)"
    fi
else
    warn "Nenhum healthcheck registrado ainda"
    info "→ Healthcheck ainda não foi executado neste ambiente"
fi

echo ""


# ---------------------------------------------------------------------------
# 6.2 — SSH (Capacidade Crítica | Observação Passiva)
# ---------------------------------------------------------------------------
info "SSH (capacidade crítica):"

# Observação:
# - NÃO valida conectividade externa
# - NÃO executa ssh-add
# - NÃO tenta iniciar agent
# - Apenas descreve o estado VISÍVEL

if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
    warn "SSH indisponível (SSH_AUTH_SOCK ausente)"

elif [[ -S "${SSH_AUTH_SOCK}" ]]; then
    ok "SSH agent detectado"
    info "→ Socket visível: ${SSH_AUTH_SOCK}"

else
    warn "SSH_AUTH_SOCK definido, mas não é um socket válido"
    warn "→ Caminho observado: ${SSH_AUTH_SOCK}"
fi

echo ""


# ---------------------------------------------------------------------------
# 6.3 — ENV (Resumo Passivo - Arquitetura remoteEnv)
# ---------------------------------------------------------------------------
# Nota arquitetural:
#   Sistema usa remoteEnv (devcontainer.json) + runArgs (--env-file)
#   Arquivo .env físico NÃO é obrigatório (vars injetadas pelo Docker/VS Code)
# ---------------------------------------------------------------------------
info "Configuração de ambiente (arquitetura remoteEnv):"

# Validar vars críticas injetadas (5 estruturais mínimas)
CRITICAL_VARS_INJECTED=("NODE_ENV" "SERVER_MODE" "SERVER_AUTHORITY" "BROWSER_MODE" "SERVER_PORT")
MISSING_COUNT=0

for var in "${CRITICAL_VARS_INJECTED[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        ((MISSING_COUNT++))
    fi
done

if [[ ${MISSING_COUNT} -eq 0 ]]; then
    ok "Variáveis críticas injetadas (remoteEnv ativo)"
    info "→ NODE_ENV=${NODE_ENV:-<unset>}"
    info "→ BROWSER_MODE=${BROWSER_MODE:-<unset>}"

    # Mostrar se .env físico existe (informativo, não obrigatório)
    if [[ -f ".env" ]]; then
        info "→ Arquivo .env físico detectado (suplementar)"
    else
        info "→ Arquivo .env físico ausente (normal - usa remoteEnv)"
    fi
else
    warn "${MISSING_COUNT} variáveis críticas ausentes"
    warn "→ Verifique devcontainer.json (remoteEnv)"
fi

echo ""


# =============================================================================
# PHASE 7 — QUICK START GUIDE (FIRST ATTACH ONLY)
# CANONICAL v5.2.1
#
# CONTRATO:
#   • Exibido APENAS no primeiro attach
#   • Informativo (humano), nunca executável
#   • Nenhuma inferência técnica
#   • Nenhuma validação ou diagnóstico
#
# OBJETIVO:
#   • Orientar o operador humano no primeiro contato
#   • Reduzir fricção inicial
#   • Apresentar o fluxo mental do projeto
# =============================================================================

if [ "${IS_FIRST_ATTACH}" = true ]; then
    echo ""
    printf "%b\n" "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    printf "%b\n" "${GREEN}🚀 QUICK START — Primeiros Passos${NC}"
    printf "%b\n" "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""

    echo "📦 Visão geral:"
    echo "Este DevContainer fornece um ambiente isolado para desenvolvimento,"
    echo "com automação baseada em Node.js + Puppeteer + Chrome externo."
    echo ""

    echo "🧩 Etapas conceituais (ordem flexível):"
    echo ""

    echo "1️⃣  Configuração de ambiente"
    echo "   • Fonte primária: remoteEnv (devcontainer.json) + runArgs (--env-file)"
    echo "   • Arquivo .env local é opcional (suplementar)"
    echo ""

    echo "2️⃣  Dependência externa: Chrome (Windows host)"
    echo "   • Um Chrome REAL roda fora do container"
    echo "   • Ele é acessado indiretamente via proxy interno"
    echo "   • Estado normal no início: Chrome NÃO estar rodando"
    echo ""

    echo "3️⃣  Inicialização do sistema"
    echo "   • O sistema é iniciado manualmente quando fizer sentido"
    echo "   • Tipicamente via Makefile ou PM2"
    echo ""

    echo "4️⃣  Observabilidade e controle"
    echo "   • Dashboard web"
    echo "   • Logs em tempo real"
    echo "   • Healthcheck sob demanda"
    echo ""

    echo "📚 Documentação principal:"
    echo "   • README.md"
    echo "   • DOCUMENTAÇÃO/ARCHITECTURE.md"
    echo "   • DOCUMENTAÇÃO/ENV_VARIABLES_GUIDE.md"
    echo ""

    echo "💡 Dica:"
    echo "Este ambiente NÃO executa nada automaticamente no attach."
    echo "Todas as ações são explícitas e sob seu controle."
    echo ""

    printf "%b\n" "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
fi

# =============================================================================
# PHASE 8 — PM2 (OBSERVAÇÃO PASSIVA)
# CANONICAL v5.2.1
#
# CONTRATO:
#   • Observação estritamente PASSIVA
#   • Nunca inicia, reinicia ou modifica processos
#   • Nunca presume que PM2 deva estar ativo
#   • Nunca bloqueia o attach
#
# OBJETIVO:
#   • Informar se o PM2 está disponível no ambiente
#   • Indicar se há processos registrados
# =============================================================================

info "PM2 (observação passiva):"

PM2_CMD=""

# ---------------------------------------------------------------------------
# Detecção do binário PM2 (ordem semântica)
# ---------------------------------------------------------------------------
if command -v pm2 >/dev/null 2>&1; then
    PM2_CMD="pm2"
elif [ -x "node_modules/.bin/pm2" ]; then
    PM2_CMD="node_modules/.bin/pm2"
fi

# ---------------------------------------------------------------------------
# Diagnóstico observacional
# ---------------------------------------------------------------------------
if [ -n "${PM2_CMD}" ]; then
    PM2_VERSION="$(${PM2_CMD} --version 2>/dev/null || echo 'desconhecida')"
    ok "PM2 disponível — versão ${PM2_VERSION}"

    # Consulta passiva de processos (sem detalhamento)
    if command -v timeout >/dev/null 2>&1; then
        PM2_JLIST="$(
            timeout 3 "${PM2_CMD}" jlist 2>/dev/null || echo '[]'
        )"
    else
        PM2_JLIST="$("${PM2_CMD}" jlist 2>/dev/null || echo '[]')"
    fi

    if command -v jq >/dev/null 2>&1; then
        PROC_COUNT="$(echo "${PM2_JLIST}" | jq '. | length' 2>/dev/null || echo 0)"
    else
        PROC_COUNT="$(echo "${PM2_JLIST}" | grep -c '"name"' 2>/dev/null || echo 0)"
    fi

    if [ "${PROC_COUNT}" -gt 0 ]; then
        ok "PM2 respondeu — ${PROC_COUNT} processo(s) registrado(s)"
        info "→ Use 'pm2 status' ou 'make pm2-status' para detalhes"
    else
        warn "PM2 disponível, mas nenhum processo registrado"
        info "→ Normal antes de iniciar o sistema"
    fi
else
    warn "PM2 não detectado no ambiente"
    info "→ Normal se o sistema ainda não foi iniciado ou não utiliza PM2"
fi

echo ""



# =============================================================================
# PHASE 9 — CHROME EXTERNO (CDP | DIAGNÓSTICO PASSIVO)
# CANONICAL v5.2.1
#
# MODELO FÍSICO (NÃO NEGOCIÁVEL):
#
#   Windows Host
#   ────────────
#   • Chrome REAL (browser efetivo)
#   • Porta: 9225 (remote debugging, bind 0.0.0.0)
#   • ÚNICO ponto onde o browser realmente existe
#   • Estado NORMAL: NÃO estar rodando (inicia sob demanda)
#
#   DevContainer (Docker)
#   ─────────────────────
#   • Chrome Proxy Service (Node.js / PM2)
#   • Porta: 9224
#   • Frontend: localhost:9224  (Puppeteer conecta aqui)
#   • Backend: host.docker.internal:9225 (encaminhamento)
#
#   Puppeteer (Node.js no container)
#   ─────────────────────────────────
#   • Conecta EXCLUSIVAMENTE ao proxy (localhost:9224)
#   • Nunca acessa o Chrome Windows diretamente
#   • Não conhece topologia externa
#
# CONTRATO DESTA FASE:
#   • Diagnóstico estritamente PASSIVO
#   • Nunca inicia Chrome, proxy ou serviços
#   • Nunca bloqueia o attach
#   • Nunca presume que Chrome esteja ativo
#
# OBJETIVO:
#   • Informar a arquitetura ao operador humano
#   • Observar, de forma best-effort, o endpoint LOCAL do proxy
# =============================================================================

info "Chrome externo (arquitetura proxy — diagnóstico passivo):"
echo ""
echo "  Arquitetura efetiva:"
echo "    Puppeteer → localhost:9224 (proxy no container)"
echo "             → host.docker.internal:9225 (Chrome no Windows)"
echo ""
echo "  ℹ️  Nota operacional:"
echo "      • Chrome Windows é FUNDAMENTAL para operações LLM"
echo "      • Estado normal durante attach/boot: NÃO estar rodando"
echo "      • Chrome será iniciado sob demanda quando necessário"
echo "      • Comando manual (Windows host): START-CHROME-SIMPLE.bat"
echo ""

# ---------------------------------------------------------------------------
# Observação passiva do Chrome Proxy (endpoint local do Puppeteer)
# ---------------------------------------------------------------------------
info "Chrome Proxy (endpoint local — observação passiva):"

# Endpoint canônico do proxy
# • Derivado de PUPPETEER_WS_ENDPOINT
# • Fallback seguro: http://localhost:9224
RAW_CHROME_PROXY_ENDPOINT="${PUPPETEER_WS_ENDPOINT:-http://localhost:9224}"
CHROME_PROXY_ENDPOINT="${RAW_CHROME_PROXY_ENDPOINT}"
if [[ "${RAW_CHROME_PROXY_ENDPOINT}" == ws://* ]]; then
    CHROME_PROXY_ENDPOINT="http://${RAW_CHROME_PROXY_ENDPOINT#ws://}"
elif [[ "${RAW_CHROME_PROXY_ENDPOINT}" == wss://* ]]; then
    CHROME_PROXY_ENDPOINT="https://${RAW_CHROME_PROXY_ENDPOINT#wss://}"
fi
CHROME_CDP_PATH="/json/version"
CHROME_CDP_TIMEOUT_SECONDS=2

if command -v curl >/dev/null 2>&1; then
    CDP_RESPONSE="$(
        curl \
            --silent \
            --fail \
            --max-time "${CHROME_CDP_TIMEOUT_SECONDS}" \
            --connect-timeout "${CHROME_CDP_TIMEOUT_SECONDS}" \
            "${CHROME_PROXY_ENDPOINT}${CHROME_CDP_PATH}" \
            2>/dev/null || echo ""
    )"

    if [ -n "${CDP_RESPONSE}" ]; then
        # Proxy respondeu — SEM inferir estado do Chrome Windows
        CHROME_VERSION="$(
            echo "${CDP_RESPONSE}" \
            | sed -n 's/.*"Browser"[[:space:]]*:[[:space:]]*"\([^\"]*\)".*/\1/p'
        )"

        ok "Chrome Proxy (container:9224): respondendo"
        [ -n "${CHROME_VERSION}" ] && info "  └─ Backend reportado: ${CHROME_VERSION}"
        info "  └─ Proxy ativo ≠ Chrome Windows ativo (pode estar aguardando)"

    else
        warn "Chrome Proxy (container:9224): não acessível"
        info "  └─ Estado normal durante attach (sistema não iniciado)"
        info "  └─ Proxy será iniciado via: make start"
    fi
else
    warn "curl indisponível — observação do Chrome Proxy ignorada"
fi

echo ""


# =============================================================================
# PHASE 10 — VOLUMES & CACHE (OBSERVAÇÃO PASSIVA)
# CANONICAL v5.2.1
#
# CONTRATO (INVIOLÁVEL):
#   • Display estritamente PASSIVO
#   • Nunca cria, corrige ou modifica volumes
#   • Nunca falha
#
# OBJETIVO:
#   • Expor presença de volumes persistentes esperados
#   • Indicar capacidade de cache / estado entre sessões
#   • Fornecer snapshot de uso de disco (host/container)
# =============================================================================

info "Volumes persistentes (observação passiva):"

# ---------------------------------------------------------------------------
# Volumes esperados (contrato lógico, não garantia física)
#
# Nota:
# • Ausência NÃO é erro
# • Alguns volumes só existem após uso efetivo
# ---------------------------------------------------------------------------
VOLUMES_TO_CHECK=(
    "${USER_HOME}/.cache:Cache geral (Puppeteer, npm, etc.)"
    "${USER_HOME}/.npm:npm packages"
    "${USER_HOME}/.pm2:PM2 runtime state"
    "${USER_HOME}/.config:Configuração do usuário"
    "${USER_HOME}/.vscode-server:VS Code Server"
    "${USER_HOME}-history:Histórico de shell"
)

# Salvaguarda defensiva
[ "${#VOLUMES_TO_CHECK[@]}" -gt 0 ] || VOLUMES_TO_CHECK=()

for vol_entry in "${VOLUMES_TO_CHECK[@]}"; do
    IFS=':' read -r vol_path vol_desc <<< "${vol_entry}"

    if [ -d "${vol_path}" ]; then
        vol_size="$(du -sh "${vol_path}" 2>/dev/null | cut -f1 || echo '?')"
        printf "  ✅ %-32s %10s\n" "${vol_desc}" "${vol_size}"
    else
        printf "  ⚠️  %-32s %10s\n" "${vol_desc}" "(ausente)"
    fi
done

echo ""

# =============================================================================
# PHASE 10.1 — DISK USAGE (SNAPSHOT PASSIVO)
# CANONICAL v5.2.1
#
# CONTRATO:
#   • Apenas leitura
#   • Sem inferência causal
#   • Sem correção automática
# =============================================================================

info "Espaço em disco (snapshot):"

# Usa última linha para evitar variações de locale/header
DISK_USAGE="$(df -h / 2>/dev/null | awk 'END {print $5}' || echo '?%')"
DISK_AVAIL="$(df -h / 2>/dev/null | awk 'END {print $4}' || echo '?')"

DISK_USAGE_NUM="${DISK_USAGE%\%}"

if [ "${DISK_USAGE_NUM}" -gt 90 ] 2>/dev/null; then
    warn "Uso de disco: ${DISK_USAGE} (${DISK_AVAIL} disponível) — CRÍTICO"
    warn "→ Ação manual sugerida: make clean (logs/cache)"
elif [ "${DISK_USAGE_NUM}" -gt 80 ] 2>/dev/null; then
    warn "Uso de disco: ${DISK_USAGE} (${DISK_AVAIL} disponível) — ALTO"
else
    ok "Uso de disco: ${DISK_USAGE} (${DISK_AVAIL} disponível)"
fi

echo ""


# =============================================================================
# PHASE 11 — DOCUMENTAÇÃO VIVA (MAPA DE PORTAS & FRONTEIRAS)
# CANONICAL v5.2.1
#
# CONTRATO (INVIOLÁVEL):
#   • Documentação PURA (read-only)
#   • NÃO documenta estado
#   • NÃO testa conectividade
#   • NÃO executa lógica
#
# FINALIDADE:
#   • Tornar explícitos os contratos de endereçamento
#   • Fixar fronteiras entre container, host e debug
#   • Eliminar ambiguidade topológica para humanos e agentes
#
# TOPOLOGIA CANÔNICA (RESUMO):
#   Puppeteer → localhost:9224 (Proxy no container)
#              → host.docker.internal:9225 (Chrome no Windows)
# =============================================================================

info "Mapa de portas (contratos arquiteturais):"
echo ""

# ---------------------------------------------------------------------------
# Interface Humana
# ---------------------------------------------------------------------------
echo "  UI Humana:"
echo "    3008  → Dashboard Principal (HTTP + Socket.io + API)"
echo ""

# ---------------------------------------------------------------------------
# Infraestrutura Crítica
#
# Nota:
# • Containers NUNCA acessam 9225 diretamente
# • 9224 é a ÚNICA ponte autorizada
# ---------------------------------------------------------------------------
echo "  Infraestrutura:"
echo "    9224  → Chrome Proxy Service (container)"
echo "             └─ Frontend do Puppeteer"
echo "             └─ Encaminha para Chrome Windows"
echo ""
echo "    9225  → Chrome Real (Windows host)"
echo "             └─ Remote Debugging (CDP)"
echo "             └─ FUNDAMENTAL para operações LLM"
echo "             └─ Inicialização manual: START-CHROME-SIMPLE.bat"
echo ""

# ---------------------------------------------------------------------------
# Debug (Opt-in, não produtivo)
# ---------------------------------------------------------------------------
echo "  Debug (opt-in):"
echo "    9229  → Node.js Debug (agente-gpt --inspect)"
echo "    9230  → Node.js Debug (dashboard-web --inspect)"
echo ""

# ---------------------------------------------------------------------------
# Fonte de Verdade
# ---------------------------------------------------------------------------
echo "  Fonte de verdade:"
echo "    devcontainer.json → forwardPorts"
echo ""

# =============================================================================
# PHASE 12 — QUICK TIPS (ALWAYS)
# CANONICAL v5.2.1
#
# CONTRATO (INVIOLÁVEL):
#   • Quick Start Guide COMPLETO apenas no PRIMEIRO attach (PHASE 7)
#   • Quick Tips RESUMIDOS em todos os attaches subsequentes
#   • Nunca executa comandos
#   • Nunca bloqueia
#   • Estritamente informativo (UX)
#
# OBJETIVO:
#   • Reorientar rapidamente o operador
#   • Reduzir fricção cognitiva
#   • Evitar leitura desnecessária de documentação
# =============================================================================

if [ "${IS_FIRST_ATTACH}" = true ]; then
    echo ""

    printf "%b\n" "${GREEN}👋 Bem-vindo!${NC}"
    printf "%b\n" "${GREEN}Este é o primeiro attach neste DevContainer.${NC}"
    echo ""

    info "Natureza deste ambiente:"
    printf "  • %-20s %s\n" "Tipo:"        "Ambiente de desenvolvimento (DevContainer)"
    printf "  • %-20s %s\n" "Automação:"   "Nenhuma ação automática no attach"
    printf "  • %-20s %s\n" "Segurança:"   "Nenhuma modificação estrutural foi realizada"
    printf "  • %-20s %s\n" "Controle:"    "Toda ação depende de decisão explícita sua"
    echo ""

    info "Próximos passos sugeridos (opcionais, execução manual):"
    printf "  • %-14s → %s\n" "make help"   "listar comandos disponíveis no projeto"
    printf "  • %-14s → %s\n" "make info"   "exibir informações detalhadas do ambiente"
    printf "  • %-14s → %s\n" "make health" "executar verificações de saúde"
    printf "  • %-14s → %s\n" "make start"  "iniciar o sistema quando fizer sentido"
    echo ""

    info "Documentação:"
    echo "  • Arquitetura: ARCHITECTURE.md"
    echo "  • Chrome Proxy: DOCUMENTAÇÃO/ARQUITETURA/CONNECTION_ARCHITECTURE/"
    echo "  • Onboarding: .github/copilot-instructions.md"
    echo "  • Comandos: make help"
    echo ""
else
    # Quick tips resumidos (attaches subsequentes)
    echo ""
    info "Quick tips:"
    echo "  • Iniciar sistema: make start"
    echo "  • Ver logs: make logs-follow"
    echo "  • Healthcheck: make health"
    echo "  • Documentação: ARCHITECTURE.md"
    echo ""
fi

# =============================================================================
# FINAL BANNER
# CANONICAL v5.2.1
# =============================================================================

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  ✅ DevContainer Pronto (v${SCRIPT_VERSION})                        ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "💡 Importante sobre Chrome:"
echo "   • Chrome externo (Windows) é FUNDAMENTAL para operações LLM"
echo "   • NÃO precisa estar rodando durante attach ou boot"
echo "   • Será iniciado sob demanda quando necessário"
echo "   • Comando manual: START-CHROME-SIMPLE.bat (Windows host)"
echo ""

# =============================================================================
# ENCERRAMENTO SEMÂNTICO — ATTACH COMPLETO
# CANONICAL v5.2.1
# =============================================================================

printf "%b\n" "${BLUE}──────────────────────────────────────────────────────────────${NC}"
ok   "Ambiente pronto para uso."
info "Attach concluído com sucesso."
info "Nenhuma ação automática, destrutiva ou estrutural foi executada."
printf "%b\n" "${BLUE}──────────────────────────────────────────────────────────────${NC}"

echo ""

# =============================================================================
# FIM DO post-attach.sh
# =============================================================================
