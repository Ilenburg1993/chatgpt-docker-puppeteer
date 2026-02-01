# =============================================================================
# Dockerfile v5.0 — ChatGPT Docker Puppeteer DevContainer (VS CODE STABLE)
# Base: Node.js 24 + Debian Bookworm (Microsoft DevContainers)
#
# FOCO:
# - Estabilidade máxima do VS Code Server
# - Compatibilidade total com Copilot / Copilot Chat
# - Docker CLI funcional (sem dockerd)
# - Puppeteer estável (Chrome externo + fallback local)
#
# PRINCÍPIOS (INVIOLÁVEIS):
# - Ambiente DEV
# - Nenhum serviço iniciado automaticamente
# - Chrome externo como primário (CDP)
# - Makefile governa execução
# - Estabilidade > minimalismo
# =============================================================================

# =============================================================================
# SECTION 0 — BUILD METADATA
# =============================================================================
FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm

# ---------------------------------------------------------------------------
# Build-time metadata (OCI)
# ---------------------------------------------------------------------------
ARG VERSION
ARG BUILD_DATE
ARG VCS_REF
ARG IMAGE_NAME
ARG IMAGE_VENDOR
ARG BUILD_ENV

LABEL org.opencontainers.image.title="${IMAGE_NAME}" \
    org.opencontainers.image.vendor="${IMAGE_VENDOR}" \
    org.opencontainers.image.version="${VERSION}" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${VCS_REF}" \
    org.opencontainers.image.environment="${BUILD_ENV}" \
    org.opencontainers.image.description="DevContainer for ChatGPT Puppeteer Agent (DEV)"

# =============================================================================
# SECTION 1 — IDENTITY & PATH DISCOVERY (CANONICAL)
#
# Finalidade:
#   • Definir identidade lógica fixa do usuário
#   • Descobrir caminhos base de forma determinística
#   • Garantir que a imagem seja reutilizável fora do DevContainer
#
# NOTAS DE DESIGN:
#   • Identidade NÃO é dinâmica em build-time
#   • Não assume volumes montados
#   • Não assume VS Code
#   • Não executa chown amplo ou recursivo
# =============================================================================

# ---------------------------------------------------------------------------
# Projeto (usado apenas para WORKDIR; não cria lógica)
# ---------------------------------------------------------------------------
ARG PROJECT_NAME=chatgpt-docker-puppeteer

# ---------------------------------------------------------------------------
# Identidade fixa (alinhada à imagem base e ao devcontainer.json)
# ---------------------------------------------------------------------------
ENV USER_NAME=node \
    HOME_DIR=/home/node \
    APP_DIR=/workspaces/${PROJECT_NAME}

# ---------------------------------------------------------------------------
# XDG Base Directories — fonte única de verdade
# ---------------------------------------------------------------------------
ENV XDG_CONFIG_HOME=${HOME_DIR}/.config \
    XDG_CACHE_HOME=${HOME_DIR}/.cache \
    XDG_DATA_HOME=${HOME_DIR}/.local/share \
    XDG_STATE_HOME=${HOME_DIR}/.local/state \
    PUPPETEER_CACHE_DIR=${HOME_DIR}/.cache/puppeteer

# ---------------------------------------------------------------------------
# Hardening mínimo:
#   • Garante que o diretório da aplicação exista
#   • Ownership explícito e local (sem chown -R)
# ---------------------------------------------------------------------------
RUN mkdir -p ${APP_DIR} \
    && chown node:node ${APP_DIR}

# ---------------------------------------------------------------------------
# SSH Agent forwarding contract (runtime only)
# ---------------------------------------------------------------------------
##ENV SSH_AUTH_SOCK=/ssh-agent

# =============================================================================
# SECTION 2 — LOCALE / TIMEZONE / SYSTEM (VS CODE SAFE)
# libnss-wrapper: requerido pelo Gatekeeper (post-create.sh)
# =============================================================================
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=America/Sao_Paulo \
    LANG=pt_BR.UTF-8 \
    LC_MESSAGES=pt_BR.UTF-8 \
    LANGUAGE=pt_BR:pt:en

RUN ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime \
    && echo "${TZ}" > /etc/timezone \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    locales \
    libnss-wrapper \
    curl \
    && sed -i 's/^# *pt_BR.UTF-8/pt_BR.UTF-8/' /etc/locale.gen \
    && sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen \
    && locale-gen pt_BR.UTF-8 en_US.UTF-8 \
    && update-locale LANG=pt_BR.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

# SSH client (required for agent forwarding)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# =============================================================================
# SECTION 3 — NODE NATIVE BUILD TOOLCHAIN (CANONICAL)
#
# Finalidade:
#   • Compilação determinística de módulos nativos (node-gyp / gyp-next)
#   • Compatibilidade total com Node.js 24+
#   • Suporte a bindings C/C++, autotools e toolchains híbridos
#
# Escopo:
#   • Ambiente DEV
#   • Nenhuma dependência implícita de runtime
#   • Nenhuma instalação global de node-gyp
# =============================================================================
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    \
    # -------------------------------------------------------------------------
    # Toolchain C/C++ básica (node-gyp)
    # -------------------------------------------------------------------------
    build-essential \
    pkg-config \
    \
    # -------------------------------------------------------------------------
    # Toolchain Autotools (bindings legados / híbridos)
    # -------------------------------------------------------------------------
    autoconf \
    automake \
    libtool \
    \
    # -------------------------------------------------------------------------
    # Python (toolchain híbrido Node + Python)
    # -------------------------------------------------------------------------
    python3 \
    python3-pip \
    python-is-python3 \
    \
    # -------------------------------------------------------------------------
    # Crypto & TLS (npm, node-gyp, downloads HTTPS)
    # -------------------------------------------------------------------------
    openssl \
    ca-certificates \
    \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Compatibilidade explícita com toolchains legadas
# (node-gyp, scripts configure, bindings antigos)
# ---------------------------------------------------------------------------
RUN ln -sf /usr/bin/python3 /usr/bin/python

# ---------------------------------------------------------------------------
# NPM — Comportamento previsível e silencioso
# (alinhado com mounts e XDG)
# ---------------------------------------------------------------------------
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_LOGLEVEL=warn \
    NPM_CONFIG_PREFIX=${HOME_DIR}/.npm-global

# =============================================================================
# SECTION 4 — BROWSER FALLBACK & CHROME COMPATIBILITY LAYER
#
# Finalidade:
#   • Fallback local de Chromium (uso EXCEPCIONAL)
#   • Camada de compatibilidade para Chrome externo via CDP
#   • Garantir estabilidade máxima do Puppeteer (connect / launch)
#
# Princípios:
#   • Chrome externo é PRIMÁRIO
#   • Chromium local é FALLBACK técnico
#   • Nenhum download automático de browser
#   • Nenhuma UI gráfica iniciada
# =============================================================================
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    \
    # -------------------------------------------------------------------------
    # Chromium (fallback local controlado)
    # -------------------------------------------------------------------------
    chromium \
    \
    # -------------------------------------------------------------------------
    # Runtime base (audio, IPC, sandbox, threads)
    # -------------------------------------------------------------------------
    libasound2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    \
    # -------------------------------------------------------------------------
    # GTK / UI shims (necessários mesmo em headless)
    # -------------------------------------------------------------------------
    libgtk-3-0 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    \
    # -------------------------------------------------------------------------
    # X11 / Wayland compatibility (headless-safe)
    # -------------------------------------------------------------------------
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxrender1 \
    libxcursor1 \
    libxi6 \
    libxkbcommon0 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    \
    # -------------------------------------------------------------------------
    # NSS / NSPR (TLS, certs, Chrome internals)
    # -------------------------------------------------------------------------
    libnss3 \
    libnspr4 \
    \
    # -------------------------------------------------------------------------
    # Graphics & GPU abstraction (safe even sem GPU)
    # -------------------------------------------------------------------------
    libgl1 \
    libvulkan1 \
    mesa-utils \
    \
    # -------------------------------------------------------------------------
    # Fonts & text rendering (PDF, emojis, i18n)
    # -------------------------------------------------------------------------
    fontconfig \
    libfreetype6 \
    \
    # -------------------------------------------------------------------------
    # Desktop / runtime helpers (headless-safe)
    # -------------------------------------------------------------------------
    xdg-utils \
    \
    && rm -rf /var/lib/apt/lists/*

# Chromium é FALLBACK TÉCNICO
# Chrome CANÔNICO é externo (host)

# =============================================================================
# SECTION 5 — FONTS & TEXT RENDERING (PDF / EMOJI / I18N / SCREENSHOTS)
#
# Finalidade:
#   • Renderização previsível de texto em:
#       - PDFs
#       - Screenshots (Puppeteer)
#       - Dashboards HTML
#   • Compatibilidade total com Chrome externo e Chromium fallback
#
# Princípios:
#   • Fontes amplas, mas controladas
#   • Fontconfig como árbitro único
#   • Sem dependência de fontes do host
# =============================================================================
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    \
    # -------------------------------------------------------------------------
    # FONTCONFIG — FUNDACIONAL (NUNCA REMOVER)
    # -------------------------------------------------------------------------
    fontconfig \
    \
    # -------------------------------------------------------------------------
    # BASE LATINA (PT-BR / EN / EU)
    # -------------------------------------------------------------------------
    fonts-dejavu-core \
    fonts-dejavu-extra \
    fonts-liberation \
    \
    # -------------------------------------------------------------------------
    # NOTO FAMILY — COBERTURA GLOBAL UNIFICADA
    # -------------------------------------------------------------------------
    fonts-noto-core \
    fonts-noto-ui-core \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    fonts-noto-extra \
    fonts-jetbrains-mono \
    \
    # -------------------------------------------------------------------------
    # ASIAN SCRIPTS (fallback robusto)
    # -------------------------------------------------------------------------
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    \
    # -------------------------------------------------------------------------
    # RTL & COMPLEMENTARES (árabe, hebraico, etc.)
    # -------------------------------------------------------------------------
    fonts-kacst \
    \
    # -------------------------------------------------------------------------
    # LEGACY / COMPATIBILIDADE (PDFs antigos)
    # -------------------------------------------------------------------------
    fonts-freefont-ttf \
    \
    # -------------------------------------------------------------------------
    # XDG UTILITIES (PDF viewers / helpers)
    # -------------------------------------------------------------------------
    xdg-utils \
    \
    && rm -rf /var/lib/apt/lists/*

# =============================================================================
# SECTION 6 — DEV UX (CLI & DIAGNOSTICS)
#
# Finalidade:
#   • Ferramentas passivas de diagnóstico e inspeção em ambiente DEV
#   • Suporte explícito a Node.js, Puppeteer, rede, TLS e sistema
#   • UX de terminal rica, previsível e silenciosa
#
# Princípios:
#   • Apenas CLIs (nenhum daemon, nenhum serviço automático)
#   • Nenhuma interferência com o VS Code Server
#   • Seguro para rebuild frequente (stateless)
#   • Compatível com WSL, Docker e CI
# =============================================================================
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    \
    # =====================================================================
    # CONTROLE DE VERSÃO & TEXTO
    # ---------------------------------------------------------------------
    # • Inspeção de código
    # • Navegação e edição emergencial
    # =====================================================================
    git \
    less \
    vim \
    nano \
    \
    # =====================================================================
    # ARQUIVOS & INSPEÇÃO
    # ---------------------------------------------------------------------
    # • Análise de encoding / CRLF / BOM
    # • Manipulação e inspeção de dados estruturados
    # =====================================================================
    unzip \
    zip \
    tree \
    jq \
    dos2unix \
    file \
    libc-bin \
    \
    # =====================================================================
    # MONITORAMENTO & PROCESSOS
    # ---------------------------------------------------------------------
    # • Observabilidade local
    # • Diagnóstico de leaks, travamentos e limites
    # =====================================================================
    htop \
    lsof \
    procps \
    psmisc \
    sysstat \
    \
    # =====================================================================
    # REDE & DIAGNÓSTICO (Node / Puppeteer / APIs)
    # ---------------------------------------------------------------------
    # • Testes HTTP/TLS
    # • Conectividade CDP / WebSocket
    # • Debug de DNS e rotas
    # =====================================================================
    curl \
    wget \
    netcat-openbsd \
    dnsutils \
    iputils-ping \
    traceroute \
    openssl \
    \
    # =====================================================================
    # DEBUG DE SISTEMA
    # ---------------------------------------------------------------------
    # • Syscalls, timing e comportamento runtime
    # =====================================================================
    watch \
    time \
    strace \
    \
    # =====================================================================
    # PRODUTIVIDADE (LOW NOISE, HIGH VALUE)
    # ---------------------------------------------------------------------
    # • Busca rápida de código e arquivos
    # • UX CLI moderna, sem sobreposição com VS Code
    # =====================================================================
    bat \
    ripgrep \
    fd-find \
    fzf \
    \
    && rm -rf /var/lib/apt/lists/*

# =============================================================================
# SECTION 6.5 — POWERSHELL (INSTRUMENTAL / NON-CANONICAL)
#
# Finalidade:
#   • Shell semântico para inspeção, diagnóstico e IA
#   • Integração com VS Code, Copilot e Claude
#   • Apoio a debugging, análise de objetos e introspecção
#
# Princípios:
#   • NÃO substitui bash (shell canônico)
#   • NÃO é shell default
#   • NÃO inicia serviços
#   • NÃO interfere em bootstrap, build ou runtime
#   • Seguro para rebuild e CI
# =============================================================================

# -----------------------------------------------------------------------------
# Instalação mínima e oficial do PowerShell (pwsh)
# • Repositório oficial Microsoft
# • Compatível com Debian Bookworm
# • Sem dependências extras desnecessárias
# -----------------------------------------------------------------------------
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
    | gpg --dearmor \
    > /etc/apt/keyrings/microsoft.gpg \
    && chmod 644 /etc/apt/keyrings/microsoft.gpg \
    && echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/microsoft.gpg] \
    https://packages.microsoft.com/debian/12/prod bookworm main" \
    > /etc/apt/sources.list.d/microsoft-prod.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends powershell \
    && rm -rf /var/lib/apt/lists/*


# =============================================================================
# SECTION 6.6 — POWERSHELL CONTRACT (GLOBAL, READ-ONLY)
#
# Contrato explícito:
#   • PowerShell é INSTRUMENTAL
#   • Bash é o shell CANÔNICO
#   • Nenhuma mutação de estado
#   • Nenhum efeito colateral
# =============================================================================

# Estrutura global (imagem)
RUN mkdir -p /etc/powershell \
    && chmod 755 /etc/powershell


# -----------------------------------------------------------------------------
# PowerShell Contract — Imutável
# -----------------------------------------------------------------------------
RUN cat <<'EOF' > /etc/powershell/PowerShell.Contract.ps1
# =============================================================================
# PowerShell Contract — DevContainer
# Version: 1.0
#
# Authority Model:
#   • PowerShell  → Instrumental
#   • Bash        → Canonical
# =============================================================================

# Identidade do contrato
$env:POWERSHELL_CONTRACT_LOADED = "true"
$env:POWERSHELL_ROLE            = "instrumental"
$env:POWERSHELL_AUTHORITY       = "subordinate"
$env:POWERSHELL_CANONICAL       = "false"

# Fonte única de verdade do shell
$env:SHELL_CANONICAL = "bash"

# Endurecimento básico
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-NotCanonical {
    Write-Verbose "[PSC] PowerShell é instrumental. Bash é canônico."
}

Assert-NotCanonical

# Prompt explícito (apenas console interativo)
if ($Host.Name -eq "ConsoleHost") {
    function prompt {
        "PS(instr) $(Get-Location)> "
    }
}
EOF

RUN chmod 444 /etc/powershell/PowerShell.Contract.ps1


# -----------------------------------------------------------------------------
# PowerShell Global Profile (bootstrap defensivo)
# • Executado automaticamente pelo pwsh
# • Não depende de HOME
# • Não interfere no VS Code
# -----------------------------------------------------------------------------
RUN cat <<'EOF' > /etc/powershell/profile.ps1
# PowerShell Global Profile — DevContainer (Read-only)

$contract = "/etc/powershell/PowerShell.Contract.ps1"

if (Test-Path $contract) {
    . $contract
}
EOF

RUN chmod 444 /etc/powershell/profile.ps1



# =============================================================================
# SECTION 7 — DOCKER CLI (NO DOCKERD)
#
# Finalidade:
#   • Permitir uso do Docker CLI via socket do host
#   • Nenhum daemon Docker dentro do container
#
# Contrato (INVIOLÁVEL):
#   • Ambiente DEV apenas
#   • CLI-only (dockerd NÃO instalado)
#   • Nenhuma dependência de GID fixo
#   • Funciona com ou sem sincronização explícita de grupo
#
# Notas de segurança:
#   • Acesso ao socket do host ⇒ privilégios equivalentes a root no host
#   • O alinhamento de GID é best-effort e NUNCA obrigatório
#   • Falhas de alinhamento NÃO quebram o build
# =============================================================================

USER root

# -----------------------------------------------------------------------------
# GID do grupo docker no host (OPCIONAL)
#
# • Normalmente injetado pelo devcontainer.json
# • Ausência é tratada como cenário válido
# -----------------------------------------------------------------------------
ARG DOCKER_GID

# -----------------------------------------------------------------------------
# Instalação do Docker CLI (SEM daemon)
#
# Garantias:
# • Apenas docker-ce-cli
# • Nenhum serviço automático
# • Compatível com Debian Bookworm
# -----------------------------------------------------------------------------
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    \
    # Keyring isolado (padrão moderno APT)
    && install -m 0755 -d /etc/apt/keyrings \
    \
    # Importação segura da chave oficial do Docker
    && curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    \
    # Repositório oficial (CLI apenas)
    && echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list \
    \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    \
    && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# Grupo docker — sincronização defensiva com o host
#
# Estratégia formal:
#   • DOCKER_GID definido:
#       - tenta alinhar exatamente com o host
#       - falha é tolerada
#
#   • DOCKER_GID ausente:
#       - cria grupo docker local (fallback)
#
# Propriedades:
#   • Nunca falha o build
#   • Nunca assume existência prévia de grupo
#   • Nunca cria dependência rígida
# -----------------------------------------------------------------------------
RUN set -e; \
    if [ -n "${DOCKER_GID}" ]; then \
    echo "→ DOCKER_GID fornecido: ${DOCKER_GID}"; \
    groupadd -g "${DOCKER_GID}" docker 2>/dev/null || true; \
    else \
    echo "→ DOCKER_GID não fornecido — criando grupo docker local"; \
    groupadd -f docker; \
    fi; \
    usermod -aG docker ${USER_NAME}



# =============================================================================
# SECTION 8 — USER CONTEXT (VS CODE / COPILOT / CLAUDE / XDG SAFE)
#
# FINALIDADE
# ────────────────────────────────────────────────────────────────────────────
# Definir a ESTRUTURA BASE e IMUTÁVEL do filesystem do usuário NA IMAGEM,
# antes de qualquer mount de volume ou reconciliação dinâmica em runtime.
#
# PRINCÍPIOS
# ────────────────────────────────────────────────────────────────────────────
# • A imagem cria apenas DIRETÓRIOS ESTRUTURAIS (sem estado)
# • Nenhum diretório deve ser criado como root em runtime
# • Nenhuma dependência de volumes montados
# • Total compatibilidade com VS Code Server, Copilot, Node 24 e XDG
#
# RESPONSABILIDADE DESTA SEÇÃO
# ────────────────────────────────────────────────────────────────────────────
# • Criar diretórios pertencentes à IMAGEM
# • Garantir ownership inicial correto
# • Evitar efeitos colaterais quando volumes forem montados
#
# RESPONSABILIDADE EXPLÍCITA DO post-create.sh
# ────────────────────────────────────────────────────────────────────────────
# • Ajuste de ownership de VOLUMES
# • Reconciliação UID/GID
# • Lógica dinâmica (NSS, agentes, etc.)
#
# PROIBIÇÕES (SEMÂNTICAS)
# ────────────────────────────────────────────────────────────────────────────
# • ❌ chown -R ${HOME_DIR} indiscriminadamente
# • ❌ assumir presença de volumes
# • ❌ criar estado persistente na imagem
# =============================================================================

RUN mkdir -p \
    \
    # =====================================================================
    # VS CODE SERVER — ESTRUTURA BASE (IMAGEM)
    # =====================================================================
    ${HOME_DIR}/.vscode-server/bin \
    ${HOME_DIR}/.vscode-server/data/Machine \
    ${HOME_DIR}/.vscode-server/data/User \
    ${HOME_DIR}/.vscode-server/data/CachedProfilesData \
    ${HOME_DIR}/.vscode-server/extensions \
    ${HOME_DIR}/.vscode-server/extensionsCache \
    \
    # =====================================================================
    # XDG BASE DIRECTORIES & CACHES (ALINHADO AOS MOUNTS)
    # =====================================================================
    # Cache geral (ferramentas, npm, VS Code, etc.)
    ${HOME_DIR}/.cache \
    ${HOME_DIR}/.cache/Microsoft \
    \
    # Caches pesados / especializados
    ${HOME_DIR}/.cache/puppeteer \
    ${HOME_DIR}/.cache/typescript \
    \
    # Estado e dados XDG (Copilot, extensões, etc.)
    ${HOME_DIR}/.local/share \
    ${HOME_DIR}/.local/share/github-copilot \
    ${HOME_DIR}/.local/state \
    ${HOME_DIR}/.local/state/github-copilot \
    ${HOME_DIR}/.local/bin \
    \
    # =====================================================================
    # NODE / PACKAGE ECOSYSTEM
    # =====================================================================
    ${HOME_DIR}/.npm \
    ${HOME_DIR}/.npm-global \
    ${HOME_DIR}/.pm2 \
    \
    # =====================================================================
    # USER CONFIGURATION (XDG CONFIG)
    # =====================================================================
    ${HOME_DIR}/.config \
    ${HOME_DIR}/.config/github-copilot \
    ${HOME_DIR}/.config/"GitHub Copilot" \
    \
    # =====================================================================
    # IDENTITY & SECRETS (ESTRUTURA APENAS — CHAVES VÊM DO HOST / AGENT)
    # =====================================================================
    ${HOME_DIR}/.ssh \
    ${HOME_DIR}/.gnupg \
    \
    # =====================================================================
    # AI / AGENT STATE (ESTRUTURA NEUTRA)
    # =====================================================================
    ${HOME_DIR}/.claude \
    \
    # =====================================================================
    # UX — HISTÓRICO DE SHELL (FORA DO $HOME POR DESIGN)
    # =====================================================================
    /home/${USER_NAME}-history \
    \
    # =====================================================================
    # OWNERSHIP — APLICAÇÃO CONTROLADA (APENAS DIRETÓRIOS CRIADOS)
    # =====================================================================
    && chown -R ${USER_NAME}:${USER_NAME} \
    ${HOME_DIR}/.vscode-server \
    ${HOME_DIR}/.cache \
    ${HOME_DIR}/.npm \
    ${HOME_DIR}/.npm-global \
    ${HOME_DIR}/.pm2 \
    ${HOME_DIR}/.config \
    ${HOME_DIR}/.local \
    ${HOME_DIR}/.ssh \
    ${HOME_DIR}/.gnupg \
    ${HOME_DIR}/.claude \
    /home/${USER_NAME}-history \
    \
    # =====================================================================
    # PERMISSIONS — MÍNIMAS, SEGURAS E PREVISÍVEIS
    # =====================================================================
    && chmod 1777 /tmp \
    \
    # SSH / GPG — PERMISSÕES ESTRITAS (OpenSSH / GnuPG compliant)
    && chmod 700 ${HOME_DIR}/.ssh ${HOME_DIR}/.gnupg \
    && touch ${HOME_DIR}/.ssh/config \
    && chmod 600 ${HOME_DIR}/.ssh/config \
    && chown ${USER_NAME}:${USER_NAME} ${HOME_DIR}/.ssh/config \
    \
    # Permissões relaxadas APENAS para áreas NÃO sensíveis
    && chmod -R u+rwX \
    ${HOME_DIR}/.vscode-server \
    ${HOME_DIR}/.cache \
    ${HOME_DIR}/.npm \
    ${HOME_DIR}/.npm-global \
    ${HOME_DIR}/.pm2 \
    ${HOME_DIR}/.config \
    ${HOME_DIR}/.local \
    ${HOME_DIR}/.claude \
    /home/${USER_NAME}-history

# Nota: chown -R aplicado SOMENTE aos diretórios criados acima (imagem-level)

# =============================================================================
# SECTION 9 — SHELL CONTRACT, UX BASELINE & RUNTIME HANDOFF (DIAMOND)
#
# OBJETIVOS (FORMALIZADOS):
# [A] Infraestrutura: Suporte passivo (autocomplete).
# [B] Contrato: Imutável (444), Global, Declarativo.
# [C] Gatekeeper: Identidade dinâmica (NSS), Global, Read-only.
# [D] UX Baseline: Global, Read-only, Interactive-only.
# [E] Segurança: Pipefail obrigatório.
#
# EXTENSÃO SEMÂNTICA (v4.4):
# • Sinalização explícita para IA / Copilot / Agentes
# • Zero impacto comportamental
# • Zero lógica dinâmica adicional
# =============================================================================


# -----------------------------------------------------------------------------
# [A] PRÉ-REQUISITOS DE SHELL (INFRAESTRUTURA)
# -----------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash-completion \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*


# -----------------------------------------------------------------------------
# [B] CONTRATO CANÔNICO DE RUNTIME (GLOBAL & READ-ONLY)
# Declarativo, sem lógica, sem efeitos colaterais
# -----------------------------------------------------------------------------
RUN printf '%s\n' \
    '# Canonical Runtime Shell Contract' \
    '# Declarative only — no logic, no side effects' \
    '# AI-AWARE CONTRACT (Semantic Hints Only)' \
    '' \
    '## Canonical shell model' \
    'export SHELL_CANONICAL=bash' \
    'export CANONICAL_SHELL=bash' \
    'export INSTRUMENTAL_SHELLS="pwsh"' \
    '' \
    '## Contract identity' \
    "export SHELL_CONTRACT_VERSION=${VERSION:-4.4}" \
    'export SHELL_CONTRACT_LOADED=true' \
    '' \
    '## Runtime classification' \
    "export RUNTIME_ENV=${BUILD_ENV:-dev}" \
    'export RUNTIME_PROFILE=default' \
    'export RUNTIME_ROLE=devcontainer' \
    '' \
    '## Capability flags (semantic only)' \
    'export CAPABILITY_INTERACTIVE=true' \
    'export CAPABILITY_AGENT=false' \
    'export CAPABILITY_CI=false' \
    'export CAPABILITY_AI_ASSISTED=true' \
    'export CAPABILITY_SEMANTIC_SHELL=true' \
    '' \
    '# AI-HINT:' \
    '# - Bash is the canonical shell for automation and execution' \
    '# - PowerShell (pwsh) is instrumental, semantic, and non-authoritative' \
    '# - Automations MUST assume bash unless explicitly overridden' \
    > /etc/profile.d/00-runtime.sh \
    && chmod 444 /etc/profile.d/00-runtime.sh


# -----------------------------------------------------------------------------
# [C] GATEKEEPER — IDENTIDADE DINÂMICA (NSS WRAPPER)
#
# • Ativação somente em shells interativos
# • Artefatos gerados EXCLUSIVAMENTE pelo post-create.sh
# • Fail-safe: ausência de libnss_wrapper ou artefatos não quebra shell
# • Bypass explícito via DEVCONTAINER_SKIP_NSS
# -----------------------------------------------------------------------------
RUN cat <<'EOF' > /etc/profile.d/10-gatekeeper-nss.sh
# DevContainer Gatekeeper — NSS Wrapper
# Scope: Interactive shells only
# Mutability: READ-ONLY (Image-level)

# Nunca interfere em shells não-interativos
[[ $- != *i* ]] && return

# Bypass explícito (humano / makefile / debug)
[ -n "${DEVCONTAINER_SKIP_NSS:-}" ] && return

# Artefatos esperados do post-create.sh
NSS_BASE_DIR="/tmp/devcontainer-nss"
PASSWD_FILE="${NSS_BASE_DIR}/passwd"
GROUP_FILE="${NSS_BASE_DIR}/group"

# Ativação defensiva
if [ -f "${PASSWD_FILE}" ] && ldconfig -p 2>/dev/null | grep -q libnss_wrapper.so; then
    export NSS_WRAPPER_PASSWD="${PASSWD_FILE}"
    export NSS_WRAPPER_GROUP="${GROUP_FILE}"
    export LD_PRELOAD="libnss_wrapper.so"
fi
EOF

RUN chmod 444 /etc/profile.d/10-gatekeeper-nss.sh


# -----------------------------------------------------------------------------
# [D] UX HUMANO BASELINE (GLOBAL, READ-ONLY, INTERACTIVE-ONLY)
#
# Fonte única de verdade para:
# • Prompt
# • Histórico
# • UX de shell
#
# ❗ NÃO usa ~/.bashrc
# ❗ NÃO depende de ownership
# ❗ Contém apenas sinais legíveis (human + AI)
# -----------------------------------------------------------------------------
RUN cat <<'EOF' > /etc/profile.d/20-devcontainer-ux.sh
# DevContainer UX Contract
# Version: 4.4
# Scope: Interactive shells only
# Mutability: READ-ONLY (Image-level)

# Guards — nunca afeta shells não-interativos
[[ $- != *i* ]] && return

# AI-HINT:
# - This shell is human-facing and AI-observable
# - No automation logic must depend on this file

# -------------------------------------------------------------------------
# Prompt helpers (namespaced)
# -------------------------------------------------------------------------
__dc_parse_git_branch() {
  git branch 2>/dev/null | sed -e "/^[^*]/d" -e "s/* \(.*\)/ (\1)/"
}

# -------------------------------------------------------------------------
# Prompt visual informativo
# -------------------------------------------------------------------------
export PS1="\n\[\033[01;30m\][\t]\[\033[00m\] \
\[\033[01;32m\]➜ \[\033[00m\]\
\[\033[01;34m\]\w\[\033[00m\]\
\[\033[33m\]\$(__dc_parse_git_branch)\[\033[00m\]\n\$ "

# -------------------------------------------------------------------------
# Histórico persistente (compatível com volumes externos)
# -------------------------------------------------------------------------
export HISTCONTROL=ignoreboth
shopt -s histappend
export HISTSIZE=10000
export HISTFILESIZE=20000
export HISTTIMEFORMAT="%F %T "

# -------------------------------------------------------------------------
# Infraestrutura auxiliar
# -------------------------------------------------------------------------
[ -f /usr/share/bash-completion/bash_completion ] \
  && . /usr/share/bash-completion/bash_completion
EOF

RUN chmod 444 /etc/profile.d/20-devcontainer-ux.sh


# -----------------------------------------------------------------------------
# [E] SHELL SEGURO PARA BUILDS FUTUROS
# -----------------------------------------------------------------------------
SHELL ["/bin/bash", "-o", "pipefail", "-c"]


# -----------------------------------------------------------------------------
# [F] HANDOFF FINAL (Transição para Runtime)
# -----------------------------------------------------------------------------
USER ${USER_NAME}
WORKDIR ${APP_DIR}

ENTRYPOINT ["dumb-init", "--"]
CMD ["sleep", "infinity"]

# =============================================================================
# FINAL NOTES
# =============================================================================
# - dockerd NÃO está instalado
# - docker CLI usa socket do host
# - NSS Wrapper é configurado apenas em runtime (post-create.sh)
# - VS Code Server estável por design
# - Base canônica congelável
