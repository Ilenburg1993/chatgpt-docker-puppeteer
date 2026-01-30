# =============================================================================
# PHASE 0 — GUARDA DE EXECUÇÃO (FAIL-SAFE ABSOLUTO)
# CANONICAL v3.6
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

# =============================================================================
# PHASE 1 — UX HELPERS (API SEMÂNTICA DE OUTPUT)
# CANONICAL v3.6
# =============================================================================

# Versão canônica do script (fonte única da verdade)
SCRIPT_VERSION="3.6"

# Detecta suporte a cores (fallback silencioso)
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    COLOR_ENABLED=true
else
    COLOR_ENABLED=false
fi

if [ "${COLOR_ENABLED}" = true ]; then
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
# Política:
# - Não existe "erro" operacional no attach
# - Apenas info / ok / warn
# ---------------------------------------------------------------------------
info() { printf "%b\n" "${CYAN}ℹ️  $*${NC}"; }
ok()   { printf "%b\n" "${GREEN}✅ $*${NC}"; }
warn() { printf "%b\n" "${YELLOW}⚠️  $*${NC}"; }

#error() { printf "%b\n" "${RED}❌ $*${NC}"; }

# =============================================================================
# PHASE 2 — BANNER DE ATTACH (IDENTIDADE HUMANA — INICIAL)
# CANONICAL v3.6
#
# Finalidade:
# - Sinalizar visualmente o evento de attach
# - Comunicar identidade do projeto e do hook
# - Expor versão do post-attach em execução
#
# PROIBIÇÕES:
# - Nenhuma lógica condicional
# - Nenhuma inferência (primeiro / recorrente)
# - Nenhuma dependência de estado
# - Nenhum diagnóstico
# =============================================================================

echo ""

printf "%b\n" "${BLUE}══════════════════════════════════════════════════════════════${NC}"
printf "%b\n" "${BLUE}🔗 VS Code anexado ao DevContainer${NC}"
printf "%b\n" "${BLUE}📦 Projeto: ChatGPT Docker Puppeteer${NC}"
printf "%b\n" "${BLUE}🧩 Hook: post-attach  |  v${SCRIPT_VERSION}${NC}"
printf "%b\n" "${BLUE}══════════════════════════════════════════════════════════════${NC}"

echo ""
# =============================================================================
# PHASE 3 — NAMESPACE CANÔNICO DE ESTADO (UX / ATTACH)
# CANONICAL v3.6
#
# CONTRATO (NORMATIVO):
# - Este namespace armazena APENAS estado HUMANO / UX
# - Nada aqui é estrutural, técnico ou decisório
# - Falha, ausência ou corrupção NÃO podem quebrar o sistema
# - Escritas são:
#     • defensivas
#     • best-effort
#     • silenciosas em caso de erro
# =============================================================================

# ---------------------------------------------------------------------------
# Diretório canônico de estado UX
# ---------------------------------------------------------------------------
STATE_DIR=".devcontainer/state"

FIRST_ATTACH_MARKER="${STATE_DIR}/first-attach"
LAST_ATTACH_MARKER="${STATE_DIR}/last-attach"
ATTACH_COUNT_FILE="${STATE_DIR}/attach-count"
LAST_ATTACH_AT_FILE="${STATE_DIR}/last-attach-at"

# Flag interna: estado UX gravável
UX_STATE_WRITABLE=true

# ---------------------------------------------------------------------------
# Preparação defensiva do namespace
# ---------------------------------------------------------------------------
if ! mkdir -p "${STATE_DIR}" 2>/dev/null; then
    UX_STATE_WRITABLE=false
fi

# ---------------------------------------------------------------------------
# Determinação semântica do tipo de attach
# ---------------------------------------------------------------------------
IS_FIRST_ATTACH=false

if [ "${UX_STATE_WRITABLE}" = true ] && [ ! -f "${FIRST_ATTACH_MARKER}" ]; then
    IS_FIRST_ATTACH=true
    touch "${FIRST_ATTACH_MARKER}" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Atualização do contador de attaches (informativo)
# ---------------------------------------------------------------------------
ATTACH_COUNT=0

if [ "${UX_STATE_WRITABLE}" = true ] && [ -f "${ATTACH_COUNT_FILE}" ]; then
    ATTACH_COUNT="$(cat "${ATTACH_COUNT_FILE}" 2>/dev/null || echo 0)"
fi

ATTACH_COUNT=$((ATTACH_COUNT + 1))

if [ "${UX_STATE_WRITABLE}" = true ]; then
    printf "%s\n" "${ATTACH_COUNT}" > "${ATTACH_COUNT_FILE}.tmp" 2>/dev/null && \
    mv "${ATTACH_COUNT_FILE}.tmp" "${ATTACH_COUNT_FILE}" 2>/dev/null || true

    date -Is > "${LAST_ATTACH_AT_FILE}.tmp" 2>/dev/null && \
    mv "${LAST_ATTACH_AT_FILE}.tmp" "${LAST_ATTACH_AT_FILE}" 2>/dev/null || true

    touch "${LAST_ATTACH_MARKER}" 2>/dev/null || true
fi


# =============================================================================
# PHASE 4 — CONTEXTO BÁSICO DO AMBIENTE (DIAGNÓSTICO HUMANO)
# CANONICAL v3.6
#
# CONTRATO:
# - Diagnóstico exclusivamente informativo
# - Nenhuma inferência operacional
# - Nenhuma correção automática
# - Falhas são aceitáveis e silenciosas
#
# OBJETIVO:
# - Fornecer ao operador humano um retrato fiel do contexto atual
# - Tornar explícitas heurísticas e suas limitações
# =============================================================================

info "Contexto do ambiente:"

# ---------------------------------------------------------------------------
# Identidade de execução (defensiva)
# ---------------------------------------------------------------------------
CURRENT_USER="$(whoami 2>/dev/null || echo 'desconhecido')"
WORKSPACE_DIR="${PWD:-indefinido}"

# ---------------------------------------------------------------------------
# Contexto de execução (heurístico e explicitamente declarado)
#
# Observação:
# - A classificação é indicativa, não normativa.
# - Ambientes híbridos (WSL, SSH, CI) podem escapar à heurística.
# ---------------------------------------------------------------------------
EXECUTION_CONTEXT="host (heurístico)"

if [ -n "${REMOTE_CONTAINERS:-}" ]; then
    EXECUTION_CONTEXT="DevContainer (VS Code)"
elif [ -f "/.dockerenv" ]; then
    EXECUTION_CONTEXT="container Docker"
fi

# ---------------------------------------------------------------------------
# Raiz lógica do projeto (heurística declarada)
#
# Limitações conhecidas:
# - Monorepos profundos
# - Workspaces multi-root do VS Code
# - Execução fora do root lógico
# ---------------------------------------------------------------------------
PROJECT_ROOT="indefinido (heurístico)"

if [ -n "${WORKSPACE_DIR}" ]; then
    if [ -f "${WORKSPACE_DIR}/Makefile" ] || [ -d "${WORKSPACE_DIR}/.git" ]; then
        PROJECT_ROOT="${WORKSPACE_DIR}"
    else
        PARENT_DIR="$(cd "${WORKSPACE_DIR}/.." 2>/dev/null && pwd || true)"
        if [ -n "${PARENT_DIR}" ] && \
           { [ -f "${PARENT_DIR}/Makefile" ] || [ -d "${PARENT_DIR}/.git" ]; }; then
            PROJECT_ROOT="${PARENT_DIR}"
        fi
    fi
fi

# ---------------------------------------------------------------------------
# Runtime Node.js (diagnóstico passivo)
#
# Observação:
# - A ausência de Node.js não é tratada como erro.
# ---------------------------------------------------------------------------
NODE_VERSION="$(node --version 2>/dev/null || echo 'não disponível')"
NPM_VERSION="$(npm --version 2>/dev/null || echo 'não disponível')"
NODE_PATH="$(command -v node 2>/dev/null || echo 'não encontrado')"

# ---------------------------------------------------------------------------
# Output humano estruturado
# ---------------------------------------------------------------------------
printf "  • %-22s %s\n" "Usuário:"             "${CURRENT_USER}"
printf "  • %-22s %s\n" "Contexto execução:"   "${EXECUTION_CONTEXT}"
printf "  • %-22s %s\n" "Workspace (PWD):"     "${WORKSPACE_DIR}"
printf "  • %-22s %s\n" "Projeto (root):"      "${PROJECT_ROOT}"
printf "  • %-22s %s\n" "Node.js:"             "${NODE_VERSION}"
printf "  • %-22s %s\n" "npm:"                 "${NPM_VERSION}"
printf "  • %-22s %s\n" "Node path:"           "${NODE_PATH}"

echo ""


# =============================================================================
# PHASE 5 — ESTADO ESTRUTURAL (post-create | DIAGNÓSTICO PASSIVO)
# CANONICAL v3.6
#
# CONTRATO:
# - Leitura estritamente PASSIVA do estado estrutural
# - Nunca escreve, corrige ou recria estado
# - Nunca falha se o estado estiver ausente, parcial ou corrompido
#
# OBJETIVO:
# - Informar se o post-create foi executado
# - Expor metadados estruturais úteis ao operador humano
# - Diferenciar ausência, ilegibilidade e presença válida
# =============================================================================

INIT_MARKER=".devcontainer/.initialized"

# ---------------------------------------------------------------------------
# Presença e legibilidade do manifesto estrutural
#
# Observação:
# - A ausência do arquivo NÃO é tratada como erro
# - A presença parcial é tratada de forma tolerante
# ---------------------------------------------------------------------------
if [ -r "${INIT_MARKER}" ]; then
    ok "DevContainer inicializado (post-create confirmado)"

    # -----------------------------------------------------------------------
    # Extração defensiva de metadados conhecidos
    #
    # Regras:
    # - Cada campo é opcional
    # - Apenas a primeira ocorrência é considerada
    # - Falhas de parsing são silenciosas
    # -----------------------------------------------------------------------
    INIT_AT="$(
        grep -E '^initialized_at=' "${INIT_MARKER}" 2>/dev/null \
        | head -n1 \
        | cut -d= -f2
    )"

    INIT_VERSION="$(
        grep -E '^script_version=' "${INIT_MARKER}" 2>/dev/null \
        | head -n1 \
        | cut -d= -f2
    )"

    INIT_PROJECT="$(
        grep -E '^project=' "${INIT_MARKER}" 2>/dev/null \
        | head -n1 \
        | cut -d= -f2
    )"

    # -----------------------------------------------------------------------
    # Emissão humana dos metadados (somente se presentes)
    # -----------------------------------------------------------------------
    [ -n "${INIT_AT}" ] && info "→ Inicializado em: ${INIT_AT}"
    [ -n "${INIT_VERSION}" ] && info "→ post-create versão: ${INIT_VERSION}"
    [ -n "${INIT_PROJECT}" ] && info "→ Projeto registrado: ${INIT_PROJECT}"

else
    warn "DevContainer NÃO inicializado ou estado estrutural indisponível"
    warn "→ O post-create pode não ter sido executado"
    warn "→ Se algo parecer inconsistente: Rebuild Container"
fi

echo ""


# =============================================================================
# PHASE 6 — ESTADO DE SAÚDE (PASSIVO)
# =============================================================================
HEALTH_STATUS_FILE="/tmp/devcontainer-health.status"

info "Estado conhecido do sistema:"

if [ -f "${HEALTH_STATUS_FILE}" ]; then
    HEALTH_STATUS="$(cat "${HEALTH_STATUS_FILE}")"
    if [ "${HEALTH_STATUS}" = "ok" ]; then
        ok "Último healthcheck conhecido: OK"
    else
        warn "Último healthcheck conhecido: FALHA"
        warn "→ Execute manualmente: make health"
    fi
else
    warn "Nenhum healthcheck registrado ainda"
    warn "→ Execute quando desejar: make health"
fi
echo ""

# =============================================================================
# PHASE 7 — PM2 (OBSERVAÇÃO PASSIVA E CONTEXTUAL)
# CANONICAL v3.5
#
# CONTRATO:
# - Observação estritamente passiva
# - Nenhum start / restart / reload
# - Nenhuma inferência operacional
# - Timeout curto para não bloquear UX
#
# OBJETIVO:
# - Informar se o PM2 está disponível
# - Indicar se há processos conhecidos
# - Nunca assumir que PM2 deva estar ativo
# =============================================================================

info "PM2 (observação passiva):"

PM2_BIN=""
PM2_TIMEOUT_SECONDS=2

# ---------------------------------------------------------------------------
# Detecção do binário PM2 (ordem semântica de preferência)
# ---------------------------------------------------------------------------
if command -v pm2 >/dev/null 2>&1; then
    PM2_BIN="pm2 (global)"
elif [ -x "node_modules/.bin/pm2" ]; then
    PM2_BIN="node_modules/.bin/pm2 (local)"
fi

# ---------------------------------------------------------------------------
# Diagnóstico passivo
# ---------------------------------------------------------------------------
if [ -n "${PM2_BIN}" ]; then
    PM2_CMD="${PM2_BIN%% *}"

    PM2_VERSION="$(${PM2_CMD} --version 2>/dev/null || echo 'desconhecida')"
    ok "PM2 disponível — ${PM2_BIN}, versão: ${PM2_VERSION}"

    # -----------------------------------------------------------------------
    # Observação do estado (com timeout defensivo, se disponível)
    # -----------------------------------------------------------------------
    if command -v timeout >/dev/null 2>&1; then
        PM2_LIST_OUTPUT="$(timeout "${PM2_TIMEOUT_SECONDS}" "${PM2_CMD}" list 2>/dev/null || true)"
    else
        PM2_LIST_OUTPUT="$("${PM2_CMD}" list 2>/dev/null || true)"
    fi

    if echo "${PM2_LIST_OUTPUT}" | grep -qiE "online|stopped|errored"; then
        ok "PM2 respondeu — processos conhecidos detectados"
    elif [ -n "${PM2_LIST_OUTPUT}" ]; then
        warn "PM2 respondeu, mas nenhum processo reconhecível foi detectado"
    else
        warn "PM2 disponível, mas não retornou estado observável"
    fi

else
    warn "PM2 não detectado"
    info "→ Normal se o sistema ainda não foi iniciado ou não utiliza PM2"
fi

echo ""



# =============================================================================
# PHASE 8 — CHROME EXTERNO (CDP | DIAGNÓSTICO PASSIVO)
# CANONICAL v3.5
#
# CONTRATO:
# - Diagnóstico estritamente PASSIVO
# - Nunca bloqueia o attach
# - Nunca inicia processos
# - Nunca assume que Chrome deveria estar ativo
# - Falhas são informativas, não excepcionais
#
# OBJETIVO:
# - Detectar presença de Chrome acessível via CDP
# - Diferenciar: disponível / respondeu inválido / não respondeu
# =============================================================================

info "Chrome externo (CDP):"

# ---------------------------------------------------------------------------
# Endpoint CDP (derivado de ambiente, com fallback seguro)
# ---------------------------------------------------------------------------
CHROME_ENDPOINT="${PUPPETEER_WS_ENDPOINT:-http://host.docker.internal:9224}"
CHROME_CDP_PATH="/json/version"

# Timeout curto por design (UX > diagnóstico profundo)
CHROME_CDP_TIMEOUT_SECONDS=2

# ---------------------------------------------------------------------------
# Diagnóstico
# ---------------------------------------------------------------------------
if command -v curl >/dev/null 2>&1; then
    CDP_RESPONSE="$(
        curl \
            --max-time "${CHROME_CDP_TIMEOUT_SECONDS}" \
            --connect-timeout "${CHROME_CDP_TIMEOUT_SECONDS}" \
            --silent \
            --show-error \
            "${CHROME_ENDPOINT}${CHROME_CDP_PATH}" 2>/dev/null \
        || true
    )"

    if [ -z "${CDP_RESPONSE}" ]; then
        warn "Chrome externo não respondeu (timeout, rede ou serviço ausente)"
        warn "→ Endpoint: ${CHROME_ENDPOINT}"
        warn "→ Se necessário, inicie no host com:"
        warn "   chrome.exe --remote-debugging-port=9224"

    elif echo "${CDP_RESPONSE}" | grep -q '"Browser"'; then
        ok "Chrome externo acessível via CDP (${CHROME_ENDPOINT})"

    else
        warn "Endpoint respondeu, mas não parece ser Chrome CDP válido"
        warn "→ Endpoint: ${CHROME_ENDPOINT}"
        warn "→ Resposta (resumo): $(echo "${CDP_RESPONSE}" | tr '\n' ' ' | cut -c1-80)..."
    fi
else
    warn "curl indisponível — diagnóstico de Chrome externo não executado"
fi

echo ""


# =============================================================================
# PHASE 9 — DOCUMENTAÇÃO VIVA (PORTAS)
# CANONICAL v3.0
#
# Função:
# - Informar superfícies de rede relevantes
# - Não inferir estado (abertas/fechadas)
# - Não testar conectividade
# =============================================================================
info "Mapa de portas relevantes (documentação viva):"

printf "  • %-5s → %s\n" "3008" "Servidor Socket.io / API (aplicação)"
printf "  • %-5s → %s\n" "9224" "Chrome DevTools Protocol (container-facing / proxy)"
printf "  • %-5s → %s\n" "9229" "Node.js Inspector (PM2 primário)"
printf "  • %-5s → %s\n" "9230" "Node.js Inspector (PM2 secundário)"
echo ""

# =============================================================================
# PHASE 10 — ONBOARDING HUMANO (PRIMEIRO ATTACH)
# CANONICAL v3.6
#
# CONTRATO (INVIOLÁVEL):
# - Executado SOMENTE no primeiro attach
# - Comunicação puramente humana e orientativa
# - Não inicia serviços
# - Não executa comandos
# - Não escreve estado estrutural
# - Não presume que algo esteja quebrado ou incompleto
#
# FINALIDADE:
# - Acolher o operador humano
# - Explicitar o que ESTE ambiente é (e o que não é)
# - Oferecer próximos passos claros, opcionais e manuais
# =============================================================================

if [ "${IS_FIRST_ATTACH}" = true ]; then
    echo ""

    printf "%b\n" "${GREEN}👋 Bem-vindo!${NC}"
    printf "%b\n" "${GREEN}Este é o primeiro attach neste DevContainer.${NC}"
    echo ""

    info "O que este ambiente faz:"
    printf "  • %-20s %s\n" "Tipo:"        "Ambiente de desenvolvimento (DevContainer)"
    printf "  • %-20s %s\n" "Automação:"   "Nenhuma ação automática no attach"
    printf "  • %-20s %s\n" "Segurança:"   "Nenhuma modificação estrutural foi feita"
    printf "  • %-20s %s\n" "Controle:"    "Você decide quando iniciar qualquer coisa"
    echo ""

    info "Sugestões iniciais (execução manual, quando desejar):"
    printf "  • %-14s → %s\n" "make help"   "listar comandos disponíveis no projeto"
    printf "  • %-14s → %s\n" "make info"   "exibir informações detalhadas do ambiente"
    printf "  • %-14s → %s\n" "make health" "executar verificações de saúde"
    printf "  • %-14s → %s\n" "make start"  "iniciar o sistema (quando fizer sentido)"
    echo ""

    info "Nota:"
    printf "  • Nada precisa ser executado agora.\n"
    printf "  • Este ambiente permanece estável até ação explícita sua.\n"
    echo ""
fi

# =============================================================================
# PHASE 11 — ENCERRAMENTO SEMÂNTICO + BANNER FINAL
# CANONICAL v3.6
#
# CONTRATO:
# - Última saída do post-attach
# - Síntese humana do evento
# - Nenhuma lógica adicional
# - Nenhuma escrita estrutural
#
# FINALIDADE:
# - Encerrar o attach de forma explícita
# - Reafirmar estado neutro e seguro
# =============================================================================

echo ""

printf "%b\n" "${BLUE}──────────────────────────────────────────────────────────────${NC}"
ok   "Ambiente pronto para uso."
info "Attach concluído com sucesso."
info "Nenhuma ação automática, destrutiva ou estrutural foi executada."
printf "%b\n" "${BLUE}──────────────────────────────────────────────────────────────${NC}"

echo ""

# =============================================================================
# FIM DO post-attach.sh — CANONICAL v3.0
# =============================================================================
