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

# =============================================================================
# PHASE 1 — UX HELPERS (API SEMÂNTICA DE OUTPUT)
# CANONICAL v5.2.0
# =============================================================================

# Versão canônica do script (fonte única da verdade)
SCRIPT_VERSION="5.2.0"

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
# CANONICAL v5.2.0
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
# CANONICAL v5.2.0
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
# PHASE 5 — ESTADO ESTRUTURAL (STATE MANIFESTO | DIAGNÓSTICO PASSIVO)
# CANONICAL v3.7
#
# CONTRATO:
# - Leitura estritamente PASSIVA do estado estrutural
# - Nunca escreve, corrige ou recria estado
# - Nunca falha se o estado estiver ausente, parcial ou corrompido
#
# FONTE DE VERDADE (prioridade):
# 1. State Manifesto canônico (Section 10 / post-create)
# 2. Marker legado (.devcontainer/.initialized) — compatibilidade
#
# OBJETIVO:
# - Informar se o post-create foi executado
# - Expor vereditos estruturais consolidados
# - Eliminar inferência ambígua quando há fonte canônica
# =============================================================================

STATE_MANIFEST=".devcontainer/state/manifest.env"
LEGACY_INIT_MARKER=".devcontainer/.initialized"

# Feature flag explícita (ENV-driven com fallback)
ENABLE_STATE_FILE_VAL="${ENABLE_STATE_FILE:-true}"

if [ "${ENABLE_STATE_FILE_VAL}" != "true" ]; then
    SKIP_STATE_FILE=true
else
    SKIP_STATE_FILE=false
fi

info "Estado estrutural do DevContainer:"

# ---------------------------------------------------------------------------
# 1. Manifesto canônico (preferencial)
# ---------------------------------------------------------------------------
if [ "${SKIP_STATE_FILE}" = "false" ] && [ -r "${STATE_MANIFEST}" ]; then
    ok "Manifesto estrutural detectado (fonte canônica)"

    # Extração passiva (best-effort, linha única)
    MANIFEST_STATUS="$(grep -E '^status=' "${STATE_MANIFEST}" 2>/dev/null | head -n1 | cut -d= -f2)"
    MANIFEST_INTEGRITY="$(grep -E '^integrity=' "${STATE_MANIFEST}" 2>/dev/null | head -n1 | cut -d= -f2)"
    MANIFEST_INIT_AT="$(grep -E '^initialized_at=' "${STATE_MANIFEST}" 2>/dev/null | head -n1 | cut -d= -f2)"
    MANIFEST_SCRIPT_VERSION="$(grep -E '^script_version=' "${STATE_MANIFEST}" 2>/dev/null | head -n1 | cut -d= -f2)"

    [ -n "${MANIFEST_INIT_AT}" ]        && info "→ Inicializado em: ${MANIFEST_INIT_AT}"
    [ -n "${MANIFEST_SCRIPT_VERSION}" ] && info "→ post-create versão: ${MANIFEST_SCRIPT_VERSION}"
    [ -n "${MANIFEST_STATUS}" ]         && info "→ Status: ${MANIFEST_STATUS}"
    [ -n "${MANIFEST_INTEGRITY}" ]      && info "→ Integridade: ${MANIFEST_INTEGRITY}"

# ---------------------------------------------------------------------------
# 2. Fallback legado (.initialized)
# ---------------------------------------------------------------------------
elif [ -r "${LEGACY_INIT_MARKER}" ]; then
    warn "Manifesto canônico ausente — usando marcador legado"
    ok   "DevContainer inicializado (post-create confirmado)"

    LEGACY_INIT_AT="$(grep -E '^initialized_at=' "${LEGACY_INIT_MARKER}" 2>/dev/null | head -n1 | cut -d= -f2)"
    LEGACY_VERSION="$(grep -E '^script_version=' "${LEGACY_INIT_MARKER}" 2>/dev/null | head -n1 | cut -d= -f2)"

    [ -n "${LEGACY_INIT_AT}" ] && info "→ Inicializado em: ${LEGACY_INIT_AT}"
    [ -n "${LEGACY_VERSION}" ] && info "→ post-create versão: ${LEGACY_VERSION}"

# ---------------------------------------------------------------------------
# 3. Estado desconhecido / não inicializado
# ---------------------------------------------------------------------------
else
    warn "Estado estrutural indisponível"
    warn "→ post-create pode não ter sido executado"
    warn "→ Se algo parecer inconsistente: Rebuild Container"
fi

echo ""


# =============================================================================
# PHASE 6 — ESTADO DE SAÚDE & CAPACIDADES CRÍTICAS (PASSIVO)
# CANONICAL v3.8
#
# CONTRATO:
# - Diagnóstico estritamente PASSIVO
# - Nunca executa checks
# - Nunca infere causa de falha
# - Nunca corrige estado
# - Nunca bloqueia o attach
#
# OBJETIVO:
# - Informar o último estado de saúde conhecido
# - Expor capacidades críticas observáveis (ex.: SSH)
# - Direcionar o operador humano para ação MANUAL
# =============================================================================

# ---------------------------------------------------------------------------
# 6.1 — Healthcheck (snapshot passivo)
# ---------------------------------------------------------------------------
HEALTH_STATUS_FILE="/tmp/devcontainer-health.status"

info "Estado conhecido do sistema:"

if [ -r "${HEALTH_STATUS_FILE}" ]; then
    HEALTH_STATUS="$(cat "${HEALTH_STATUS_FILE}" 2>/dev/null || echo unknown)"

    if [ "${HEALTH_STATUS}" = "ok" ]; then
        ok "Último healthcheck registrado: OK"
    else
        warn "Último healthcheck registrado: FALHA"
        warn "→ Execute manualmente quando desejar: make health"
    fi
else
    warn "Nenhum healthcheck registrado ainda"
    warn "→ Execute quando desejar: make health"
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
# - Apenas descreve o estado visível

if [ -z "${SSH_AUTH_SOCK:-}" ]; then
    warn "SSH indisponível (SSH_AUTH_SOCK ausente)"
    warn "→ Git via SSH não estará funcional neste attach"

elif [ -S "${SSH_AUTH_SOCK}" ]; then
    ok "SSH agent detectado"
    info "→ Socket: ${SSH_AUTH_SOCK}"

    if command -v ssh-add >/dev/null 2>&1; then
        if ssh-add -l >/dev/null 2>&1; then
            ok "Chaves SSH carregadas no agent"
        else
            warn "SSH agent ativo, mas sem chaves carregadas"
            warn "→ Git via SSH pode falhar"
        fi
    else
        warn "ssh-add indisponível — incapaz de inspecionar chaves"
    fi

else
    warn "SSH_AUTH_SOCK definido, mas não é um socket válido"
    warn "→ Caminho: ${SSH_AUTH_SOCK}"
fi

echo ""

# =============================================================================
# PHASE 6.3 — ENV CONFIGURATION STATUS (DIAGNOSTIC DISPLAY) v1.0
#
# CONTRATO:
# - Display estritamente PASSIVO
# - Nunca modifica configuração
# - Nunca falha
#
# OBJETIVO:
# - Exibir estado da configuração ENV
# - Guiar usuário para .env.example se necessário
# - Validar vars críticas visualmente
# =============================================================================

info "Configuração de ambiente:"

# ---------------------------------------------------------------------------
# 6.3.1 — Detectar arquivo .env ativo
# ---------------------------------------------------------------------------
if [ -f ".env" ]; then
    ok "Arquivo .env detectado e ativo"

    # Contar variáveis definidas (não comentadas)
    DEFINED_COUNT=$(grep -cE '^[A-Z_]+=' .env 2>/dev/null || echo 0)
    info "→ ${DEFINED_COUNT} variáveis definidas"

    # Validar vars críticas (display apenas)
    CRITICAL_VARS=("NODE_ENV" "SERVER_PORT" "CHROME_HOST" "CHROME_PORT")

    for var in "${CRITICAL_VARS[@]}"; do
        if grep -q "^${var}=" .env 2>/dev/null; then
            VAL=$(grep "^${var}=" .env | cut -d= -f2 | head -n1)
            printf "  • %-22s %s\n" "${var}:" "${VAL}"
        else
            warn "  • ${var}: NÃO DEFINIDO em .env"
        fi
    done

elif [ -f ".env.development" ]; then
    warn "Arquivo .env ausente"
    ok   "Template encontrado: .env.development"
    info "→ Copie e personalize: cp .env.development .env"
    info "→ Ou use defaults: ln -s .env.development .env"

elif [ -f ".env.example" ]; then
    warn "Arquivo .env ausente"
    ok   "Template encontrado: .env.example"
    info "→ Copie e configure: cp .env.example .env"
    info "→ Consulte: DOCUMENTAÇÃO/ENV_VARIABLES_GUIDE.md"

else
    warn "Sistema ENV não configurado"
    warn "→ Usando defaults do código (pode não ser ideal)"
    info "→ Crie arquivo .env para configuração personalizada"
fi

echo ""

# =============================================================================
# PHASE 7.5 — QUICK START GUIDE (FIRST ATTACH ONLY) v1.0
#
# CONTRATO:
# - Exibido APENAS no primeiro attach
# - Informativo, nunca executável
# - Guia visual de 5 passos
#
# OBJETIVO:
# - Acelerar onboarding
# - Reduzir fricção inicial
# - Documentação viva no terminal
# =============================================================================

if [ "${IS_FIRST_ATTACH}" = true ]; then
    echo ""
    printf "%b\n" "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    printf "%b\n" "${GREEN}🚀 QUICK START GUIDE - Primeiros Passos${NC}"
    printf "%b\n" "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "📋 Workflow completo para iniciar o sistema:"
    echo ""
    echo "1️⃣  Configurar ambiente (escolha uma opção):"
    echo "   → Desenvolvimento: cp .env.development .env"
    echo "   → Produção:        cp .env.production .env"
    echo "   → Ou editar:       code .env.example"
    echo ""
    echo "2️⃣  Iniciar Chrome no Windows (host):"
    echo "   → Execute: START-CHROME-SIMPLE.bat"
    echo "   → Porta: 9225 (Remote Debugging)"
    echo ""
    echo "3️⃣  Iniciar sistema (PM2):"
    echo "   → make start"
    echo "   → Ou: pm2 start ecosystem.config.js"
    echo ""
    echo "4️⃣  Validar saúde do sistema:"
    echo "   → make health"
    echo "   → Deve retornar: 4 endpoints OK"
    echo ""
    echo "5️⃣  Abrir Dashboard (qualquer browser):"
    echo "   → http://localhost:3008"
    echo "   → Mission Control + Logs + Metrics"
    echo ""
    echo "📚 Documentação:"
    echo "   → Quick Reference:    README.md"
    echo "   → Guia ENV:           DOCUMENTAÇÃO/ENV_VARIABLES_GUIDE.md"
    echo "   → Arquitetura:        DOCUMENTAÇÃO/ARCHITECTURE.md"
    echo "   → Chrome Proxy v2.0:  DOCUMENTAÇÃO/CHROME_PROXY_V2_IMPLEMENTATION.md"
    echo ""
    echo "🆘 Troubleshooting:"
    echo "   → Logs:               make logs-follow"
    echo "   → PM2 status:         make pm2-status"
    echo "   → Diagnostics:        make diagnose"
    echo ""
    printf "%b\n" "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
fi

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
PM2_TIMEOUT_SECONDS=5  # Aumentado para 5s (v5.2) - acomoda sistemas lentos

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
        PM2_JLIST_OUTPUT="$(timeout "${PM2_TIMEOUT_SECONDS}" "${PM2_CMD}" jlist 2>/dev/null || echo '[]')"
    else
        PM2_JLIST_OUTPUT="$("${PM2_CMD}" jlist 2>/dev/null || echo '[]')"
    fi

    # Parse com jq se disponível
    if command -v jq >/dev/null 2>&1; then
        PROC_COUNT="$(echo "${PM2_JLIST_OUTPUT}" | jq -r '. | length' 2>/dev/null || echo 0)"

        if [ "${PROC_COUNT}" -gt 0 ]; then
            ok "PM2 respondeu — ${PROC_COUNT} processo(s) registrado(s)"
            echo ""
            echo "  Processos:"
            echo "${PM2_JLIST_OUTPUT}" | jq -r '.[] | "  • \(.name): \(.pm2_env.status) (uptime: \(.pm2_env.pm_uptime / 1000 | round)s, mem: \(.monit.memory / 1048576 | round)MB)"' 2>/dev/null || echo "  (detalhes indisponíveis)"
        else
            warn "PM2 disponível mas sem processos registrados"
        fi
    else
        # Fallback sem jq
        if echo "${PM2_JLIST_OUTPUT}" | grep -qiE "online|stopped|errored"; then
            ok "PM2 respondeu — processos conhecidos detectados"
        else
            warn "PM2 disponível, mas nenhum processo reconhecível foi detectado"
        fi
    fi

else
    warn "PM2 não detectado"
    info "→ Normal se o sistema ainda não foi iniciado ou não utiliza PM2"
fi

echo ""

# --- Git User Identity Check ---
if ! git config --global user.name >/dev/null 2>&1; then
    warn "Git user.name não configurado"
    info "  → Configure: git config --global user.name 'Seu Nome'"
    info "  → Configure: git config --global user.email 'seu@email.com'"
    echo ""
fi


# =============================================================================
# PHASE 8 — CHROME EXTERNO (CDP | DIAGNÓSTICO PASSIVO)
# CANONICAL v5.2.0
#
# MODELO FÍSICO (NÃO NEGOCIÁVEL):
#
#   Windows Host
#   ────────────
#   • Chrome REAL
#   • Porta: 9225 (bind 0.0.0.0)
#   • ÚNICO ponto onde o browser realmente existe
#   • Acessível via: host.docker.internal:9225
#   • ESTADO NORMAL: NÃO ESTAR RODANDO (inicia sob demanda)
#
#   DevContainer (Docker)
#   ─────────────────────
#   • Chrome Proxy Service (PM2)
#   • Porta: 9224 (bind 0.0.0.0)
#   • Frontend: localhost:9224 (Puppeteer conecta aqui)
#   • Backend: host.docker.internal:9225 (encaminha para Chrome)
#   • Funções:
#     - Reescreve Host: headers
#     - Reescreve WebSocket URLs
#     - Gerenciado por PM2 (mesmo container)
#
#   Puppeteer (Node.js no container)
#   ─────────────────────────────────
#   • Conecta: localhost:9224 (proxy no mesmo container)
#   • NUNCA acessa 9225 diretamente
#   • NÃO conhece o Windows Host
#
# CONTRATO DESTA FASE:
# - Diagnóstico ESTRITAMENTE PASSIVO
# - Nunca inicia Chrome, proxy ou serviços
# - Nunca bloqueia o attach
# - Nunca presume que Chrome esteja ativo
# - Ausência de Chrome é ESTADO VÁLIDO E ESPERADO
#
# OBJETIVO:
# - Verificar se o proxy (localhost:9224) responde
# - NÃO verificar o Chrome do Windows diretamente
# - Documentar topologia completa para usuário
# =============================================================================

info "Chrome externo (arquitetura proxy — diagnóstico passivo):"
echo ""
echo "  Topologia:"
echo "    Puppeteer → localhost:9224 (proxy no container)"
echo "             → host.docker.internal:9225 (Chrome no Windows)"
echo ""
echo "  ⚠️  IMPORTANTE: Chrome externo é FUNDAMENTAL"
echo "      • Necessário para: Operações LLM (ChatGPT, Gemini via Puppeteer)"
echo "      • Estado normal agora (attach/boot): NÃO estar rodando"
echo "      • Será iniciado sob demanda quando necessário"
echo "      • Comando manual: START-CHROME-SIMPLE.bat (Windows host)"
echo ""
#   • Backend: host.docker.internal:9225 (encaminha para Chrome)
#   • Funções:
#     - Reescreve Host: headers
#     - Reescreve WebSocket URLs
#     - Gerenciado por PM2 (mesmo container)
#
#   Puppeteer (Node.js no container)
#   ─────────────────────────────────
#   • Conecta: localhost:9224 (proxy no mesmo container)
#   • NUNCA acessa 9225 diretamente
#   • NÃO conhece o Windows Host
#
# CONTRATO DESTA FASE:
# - Diagnóstico ESTRITAMENTE PASSIVO
# - Nunca inicia Chrome, proxy ou serviços
# - Nunca bloqueia o attach
# - Nunca presume que Chrome esteja ativo
# - Ausência de Chrome é ESTADO VÁLIDO
#
# OBJETIVO:
# - Verificar se o proxy (localhost:9224) responde
# - NÃO verificar o Chrome do Windows diretamente
# =============================================================================

info "Chrome externo (CDP — via proxy local, diagnóstico passivo):"

# ---------------------------------------------------------------------------
# Endpoint CANÔNICO visível ao container
#
# • Derivado de PUPPETEER_WS_ENDPOINT
# • Fallback seguro: localhost:9224 (proxy no mesmo container)
# • Este endpoint é o PROXY, não o Chrome real
# ---------------------------------------------------------------------------
CHROME_PROXY_ENDPOINT="${PUPPETEER_WS_ENDPOINT:-http://localhost:9224}"
CHROME_CDP_PATH="/json/version"

# Timeout curto por design:
# • UX > diagnóstico profundo
# • Evita atrasos no attach
CHROME_CDP_TIMEOUT_SECONDS=2

# ---------------------------------------------------------------------------
# Diagnóstico observacional (proxy-facing ONLY)
# ---------------------------------------------------------------------------
if command -v curl >/dev/null 2>&1; then
    CDP_RESPONSE="$(
        curl \
            --max-time "${CHROME_CDP_TIMEOUT_SECONDS}" \
            --connect-timeout "${CHROME_CDP_TIMEOUT_SECONDS}" \
            --silent \
            --fail \
            "${CHROME_PROXY_ENDPOINT}${CHROME_CDP_PATH}" 2>/dev/null || echo ""
    )"

    if [ -n "${CDP_RESPONSE}" ]; then
        # Proxy respondeu - Chrome pode ou não estar ativo
        CHROME_VERSION="$(echo "${CDP_RESPONSE}" | grep -oP '\"Browser\":\s*\"\K[^\"]+' || echo 'desconhecida')"
        ok "Chrome Proxy (container:9224): ✅ respondendo"
        info "  └─ Chrome backend: ${CHROME_VERSION}"
        info "  └─ Topologia completa: Puppeteer → 9224 (proxy) → 9225 (Chrome)"
    else
        # Proxy não respondeu - estado NORMAL durante attach
        warn "Chrome Proxy (container:9224): ⏸️  não acessível"
        info "  └─ Normal durante attach/boot (sistema não iniciado)"
        info "  └─ Chrome É FUNDAMENTAL mas inicia sob demanda"
        info "  └─ Comando: make start (inicia sistema + proxy)"
    fi
else
    warn "curl indisponível — diagnóstico de Chrome proxy ignorado."
fi

echo ""


# =============================================================================
# PHASE 8.5 — VOLUMES & CACHE STATUS (DIAGNOSTIC) v5.2.0
#
# CONTRATO:
# - Display estritamente PASSIVO
# - Nunca modifica volumes
# - Nunca falha
#
# OBJETIVO:
# - Exibir status de volumes persistentes
# - Identificar problemas de cache/state
# - Mostrar disk usage
# =============================================================================

info "Volumes persistentes (status):"

VOLUMES_TO_CHECK=(
    "${HOME}/.cache:Cache (Puppeteer, npm, etc)"
    "${HOME}/.npm:npm packages"
    "${HOME}/.pm2:PM2 runtime state"
    "${HOME}/.config:User configuration"
    "${HOME}/.vscode-server:VS Code Server"
    "/home/${USER}-history:Shell history"
)

for vol_entry in "${VOLUMES_TO_CHECK[@]}"; do
    IFS=':' read -r vol_path vol_desc <<< "${vol_entry}"

    if [ -d "${vol_path}" ]; then
        vol_size="$(du -sh "${vol_path}" 2>/dev/null | cut -f1 || echo '?')"
        printf "  ✅ %-30s %10s\n" "${vol_desc}" "${vol_size}"
    else
        printf "  ❌ %-30s %10s\n" "${vol_desc}" "(ausente)"
    fi
done

echo ""

# =============================================================================
# PHASE 8.6 — DISK USAGE WARNING v5.2.0
# =============================================================================

info "Espaço em disco:"

DISK_USAGE="$(df -h / 2>/dev/null | awk 'NR==2 {print $5}' || echo '?%')"
DISK_AVAIL="$(df -h / 2>/dev/null | awk 'NR==2 {print $4}' || echo '?')"

DISK_USAGE_NUM="${DISK_USAGE%\%}"

if [ "${DISK_USAGE_NUM}" -gt 90 ] 2>/dev/null; then
    warn "Uso de disco: ${DISK_USAGE} (${DISK_AVAIL} disponível) — CRÍTICO!"
    warn "→ Considere: make clean (limpa logs/cache)"
elif [ "${DISK_USAGE_NUM}" -gt 80 ] 2>/dev/null; then
    warn "Uso de disco: ${DISK_USAGE} (${DISK_AVAIL} disponível) — ALTO"
else
    ok "Uso de disco: ${DISK_USAGE} (${DISK_AVAIL} disponível)"
fi

echo ""



# =============================================================================
# PHASE 9 — DOCUMENTAÇÃO VIVA (MAPA DE PORTAS & FRONTEIRAS)
# CANONICAL v5.2.0
#
# PRINCÍPIO:
# - Este bloco documenta CONTRATOS DE ENDEREÇAMENTO
# - NÃO documenta estado
# - NÃO testa conectividade
#
# TOPOLOGIA REAL:
#   Puppeteer → localhost:9224 (Proxy no container) → host.docker.internal:9225 (Chrome no Windows)
#
# FRONTEIRAS CRÍTICAS:
# - 9224: Chrome Proxy Service (DevContainer, PM2)
# - 9225: Chrome Real (Windows Host, remote debugging)
# - Containers conectam em localhost:9224 (proxy local)
# - Proxy encaminha para host.docker.internal:9225 (Chrome remoto)
# =============================================================================

info "Mapa de portas (contratos arquiteturais):"
echo ""
echo "  UI Humana:"
echo "    3008  → Dashboard Principal (HTTP + Socket.io + API)"
echo ""
echo "  Infraestrutura:"
echo "    9224  → Chrome Proxy (container → Windows host)"
echo "    9225  → Chrome Real (Windows host, remote debugging)"
echo "             └─ FUNDAMENTAL: inicie com START-CHROME-SIMPLE.bat quando necessário"
echo ""
echo "  Debug (opt-in):"
echo "    9229  → Node.js Debug (agente-gpt --inspect)"
echo "    9230  → Node.js Debug (dashboard-web --inspect)"
echo ""
echo "  Para detalhes: devcontainer.json (forwardPorts section)"
echo ""

# =============================================================================
# PHASE 10 — QUICK TIPS (ALWAYS) v5.2.0
# =============================================================================

if [ "${IS_FIRST_ATTACH}" = true ]; then
        info "→ Pode significar:"
        info "   • Chrome Proxy Service não foi iniciado (PM2)"
        info "   • Chrome no Windows não está ativo"
        info "   • Chrome externo não está sendo usado agora"
        info "→ Para iniciar proxy: pm2 start ecosystem.config.js --only chrome-proxy"

    elif echo "${CDP_RESPONSE}" | grep -q '"Browser"'; then
        ok "Proxy CDP ativo (localhost:9224)"
        ok "→ Chrome real no Windows (9225) está acessível INDIRETAMENTE."
        ok "→ Capacidade adicional disponível para Puppeteer."

    else
        warn "Proxy respondeu, mas não com payload CDP válido."
        warn "→ Endpoint: ${CHROME_ENDPOINT}"
        warn "→ Diagnóstico informativo apenas (sem impacto funcional)."
    fi
else
    warn "curl indisponível — diagnóstico de Chrome externo ignorado."
fi

echo ""


# =============================================================================
# PHASE 9 — DOCUMENTAÇÃO VIVA (MAPA DE PORTAS & FRONTEIRAS)
# CANONICAL v3.8
#
# PRINCÍPIO:
# - Este bloco documenta CONTRATOS DE ENDEREÇAMENTO
# - NÃO documenta estado
# - NÃO testa conectividade
#
# TOPOLOGIA REAL:
#   Puppeteer → localhost:9224 (Proxy no container) → host.docker.internal:9225 (Chrome no Windows)
#
# FRONTEIRAS CRÍTICAS:
# - 9224: Chrome Proxy Service (DevContainer, PM2)
# - 9225: Chrome Real (Windows Host, remote debugging)
# - Containers conectam em localhost:9224 (proxy local)
# - Proxy encaminha para host.docker.internal:9225 (Chrome remoto)
# =============================================================================

info "Mapa de portas (contratos arquiteturais):"
echo ""
echo "  UI Humana:"
echo "    3008  → Dashboard Principal (HTTP + Socket.io + API)"
echo ""
echo "  Infraestrutura:"
echo "    9224  → Chrome Proxy (container → Windows host)"
echo "    9225  → Chrome Real (Windows host, remote debugging)"
echo "             └─ FUNDAMENTAL: inicie com START-CHROME-SIMPLE.bat quando necessário"
echo ""
echo "  Debug (opt-in):"
echo "    9229  → Node.js Debug (agente-gpt --inspect)"
echo "    9230  → Node.js Debug (dashboard-web --inspect)"
echo ""
echo "  Para detalhes: devcontainer.json (forwardPorts section)"
echo ""

# =============================================================================
# PHASE 10 — QUICK TIPS (ALWAYS) v5.2.0
#
# CONTRATO:
# - Quick Start Guide completo no PRIMEIRO attach
# - Quick Tips resumidos em TODOS os attaches subsequentes
# - Nunca bloqueia
# - Puramente informativo
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
    printf "  • %-14s → %s\n" "make start"  "iniciar o sistema (quando fizer sentido)"
    echo ""

    info "Documentação:"
    echo "  • Arquitetura: ARCHITECTURE.md"
    echo "  • Chrome Proxy: DOCUMENTAÇÃO/CONNECTION_ARCHITECTURE/"
    echo "  • Onboarding: .github/copilot-instructions.md"
    echo "  • Makefile: make help"
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
# FINAL BANNER v5.2.0
# =============================================================================

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  ✅ DevContainer Pronto (v${SCRIPT_VERSION})                        ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "💡 Importante sobre Chrome:"
echo "   • Chrome externo É FUNDAMENTAL para operações LLM"
echo "   • Mas NÃO precisa estar rodando durante attach/boot"
echo "   • Será iniciado sob demanda quando necessário"
echo "   • Comando: START-CHROME-SIMPLE.bat (Windows host)"
echo ""

# =============================================================================
# FINAL — ENCERRAMENTO SEMÂNTICO (ATTACH COMPLETO) v5.2.0
# =============================================================================

printf "%b\n" "${BLUE}──────────────────────────────────────────────────────────────${NC}"
ok   "Ambiente pronto para uso."
info "Attach concluído com sucesso."
info "Nenhuma ação automática, destrutiva ou estrutural foi executada."
printf "%b\n" "${BLUE}──────────────────────────────────────────────────────────────${NC}"

echo ""

# =============================================================================
# FIM DO post-attach.sh — v5.2.0
# =============================================================================
