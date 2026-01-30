# =============================================================================
# Dockerfile v4.3.1 — ChatGPT Docker Puppeteer DevContainer (VS CODE STABLE)
# Base: Node.js 20 + Debian Bookworm (Microsoft DevContainers)
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
FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm

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
#   • Definir identidade lógica do usuário
#   • Descobrir caminhos base de forma determinística
#   • Garantir que a imagem seja reutilizável fora do DevContainer
#
# NOTAS DE DESIGN:
#   • Não assume volumes montados
#   • Não assume VS Code
#   • Não executa chown amplo
# =============================================================================

# Usuário remoto (injetado pelo DevContainer ou fallback seguro)
ARG REMOTE_USER=node

# Nome do projeto (usado apenas para WORKDIR; não cria lógica)
ARG PROJECT_NAME=chatgpt-docker-puppeteer

# Identidade e caminhos fundamentais
ENV USER_NAME=${REMOTE_USER} \
    HOME_DIR=/home/${REMOTE_USER} \
    APP_DIR=/workspaces/${PROJECT_NAME}

# XDG Base Directories — fonte única de verdade
ENV XDG_CONFIG_HOME=${HOME_DIR}/.config \
    XDG_CACHE_HOME=${HOME_DIR}/.cache \
    XDG_DATA_HOME=${HOME_DIR}/.local/share \
    XDG_STATE_HOME=${HOME_DIR}/.local/state \
    PUPPETEER_CACHE_DIR=${HOME_DIR}/.cache/puppeteer

# Hardening mínimo:
# Garante que o WORKDIR exista mesmo fora do DevContainer
# (não aplica ownership recursivo; apenas cria o diretório)
RUN mkdir -p ${APP_DIR} && chown ${USER_NAME}:${USER_NAME} ${APP_DIR}

# SSH Agent forwarding contract (runtime only)
ENV SSH_AUTH_SOCK=/ssh-agent

# =============================================================================
# SECTION 2 — LOCALE / TIMEZONE / SYSTEM (VS CODE SAFE)
# libnss-wrapper: requerido pelo Gatekeeper (post-create.sh)
# =============================================================================
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=America/Sao_Paulo \
    LANG=pt_BR.UTF-8 \
    LC_ALL=pt_BR.UTF-8

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
    && update-locale LANG=pt_BR.UTF-8 LC_ALL=pt_BR.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

# SSH client (required for agent forwarding)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# =============================================================================
# SECTION 3 — NODE NATIVE BUILD TOOLCHAIN
# =============================================================================
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    python3-pip \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Aplicando a automação: substituímos o caminho fixo pela nossa âncora ${HOME_DIR}
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_LOGLEVEL=warn \
    NPM_CONFIG_PREFIX=${HOME_DIR}/.npm-global

# =============================================================================
# SECTION 4 — BROWSER FALLBACK (Chromium)
# =============================================================================
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    chromium \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcursor1 \
    libxext6 \
    libxi6 \
    libxkbcommon0 \
    libxrender1 \
    libxshmfence1 \
    libcairo2 \
    libpango-1.0-0 \
    libgl1 \
    mesa-utils \
    libvulkan1 \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# =============================================================================
# SECTION 5 — FONTS (PDF / EMOJI / I18N)
# =============================================================================
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    fonts-noto-extra \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# =============================================================================
# SECTION 6 — DEV UX (CLI & DIAGNOSTICS)
# =============================================================================
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    git \
    less \
    vim \
    nano \
    unzip \
    zip \
    jq \
    tree \
    htop \
    lsof \
    netcat-openbsd \
    dnsutils \
    watch \
    time \
    strace \
    && rm -rf /var/lib/apt/lists/*

# =============================================================================
# SECTION 7 — DOCKER CLI (NO DOCKERD)
#
# Finalidade:
#   • Permitir uso do Docker CLI via socket do host
#   • Nenhum daemon Docker dentro do container
#
# CONTRATO:
#   • DEV only
#   • Sem hardcode de GID
#   • Funciona com ou sem sincronização explícita
#
# NOTAS DE SEGURANÇA:
#   • Acesso ao socket do host implica privilégios elevados
#   • O alinhamento de GID é best-effort, nunca obrigatório
# =============================================================================

USER root

# GID do grupo docker no host (OPCIONAL)
# Normalmente injetado pelo devcontainer.json quando disponível
ARG DOCKER_GID

# -----------------------------------------------------------------------------
# Instala apenas o Docker CLI (sem daemon)
# -----------------------------------------------------------------------------
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# Grupo docker — sincronização defensiva com o host
#
# Estratégia:
#   • Se DOCKER_GID for fornecido → tenta alinhar exatamente
#   • Se não for fornecido        → cria grupo docker local (fallback)
#   • Nunca falha o build
# -----------------------------------------------------------------------------
RUN set -e; \
    if [ -n "${DOCKER_GID}" ]; then \
    echo "→ DOCKER_GID fornecido: ${DOCKER_GID}"; \
    groupadd -g "${DOCKER_GID}" docker 2>/dev/null || true; \
    else \
    echo "→ DOCKER_GID não fornecido — criando grupo docker local"; \
    groupadd -f docker; \
    fi && \
    usermod -aG docker ${USER_NAME}


# =============================================================================
# SECTION 8 — USER CONTEXT (VS CODE / COPILOT / CLAUDE / XDG SAFE)
#
# Finalidade:
#   Definir a estrutura BASE e IMUTÁVEL do filesystem do usuário,
#   antes de qualquer volume ou reconciliação dinâmica.
#
# RESPONSABILIDADE DESTA SEÇÃO:
#   • Criar diretórios que pertencem à IMAGEM
#   • Garantir que nada seja criado como root em runtime
#
# RESPONSABILIDADE EXPLÍCITA DO post-create.sh:
#   • Corrigir ownership de volumes
#   • Reconciliação UID/GID
#
# PROIBIÇÕES:
#   • ❌ chown -R ${HOME_DIR}
#   • ❌ assumir presença de volumes
# =============================================================================

RUN mkdir -p \
    \
    # ------------------------------------------------------------
    # VS CODE SERVER — Estrutura base (imagem)
    # ------------------------------------------------------------
    ${HOME_DIR}/.vscode-server/bin \
    ${HOME_DIR}/.vscode-server/data/Machine \
    ${HOME_DIR}/.vscode-server/data/User \
    ${HOME_DIR}/.vscode-server/extensions \
    ${HOME_DIR}/.vscode-server/extensionsCache \
    \
    # ------------------------------------------------------------
    # XDG BASE & CACHES (Sincronizado com Mounts)
    # ------------------------------------------------------------
    ${HOME_DIR}/.cache/Microsoft \
    ${HOME_DIR}/.cache/puppeteer \
    ${HOME_DIR}/.npm \
    ${HOME_DIR}/.npm-global \
    ${HOME_DIR}/.pm2 \
    ${HOME_DIR}/.config/github-copilot \
    ${HOME_DIR}/.config/"GitHub Copilot" \
    ${HOME_DIR}/.local/share \
    ${HOME_DIR}/.local/state \
    ${HOME_DIR}/.local/bin \
    \
    # ------------------------------------------------------------
    # IDENTITY & SECRETS (Pré-criação para evitar ownership de root; estrutura apenas — chaves vêm do host via agent)
    # ------------------------------------------------------------
    ${HOME_DIR}/.ssh \
    ${HOME_DIR}/.gnupg \
    \
    # ------------------------------------------------------------
    # AGENTE / IA (estrutura neutra)
    # ------------------------------------------------------------
    ${HOME_DIR}/.claude \
    \
    # ------------------------------------------------------------
    # UX — HISTÓRICO (fora da HOME por design)
    # ------------------------------------------------------------
    /home/${USER_NAME}-history \
    \
    # ------------------------------------------------------------
    # OWNERSHIP — APLICAÇÃO EM BLOCO
    # ------------------------------------------------------------
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
    # ------------------------------------------------------------
    # PERMISSIONS — MÍNIMAS & SEGURAS
    # ------------------------------------------------------------
    && chmod 1777 /tmp \
    \
    # SSH / GPG — regras estritas (OpenSSH-compliant)
    && chmod 700 ${HOME_DIR}/.ssh ${HOME_DIR}/.gnupg \
    && touch ${HOME_DIR}/.ssh/config \
    && chmod 600 ${HOME_DIR}/.ssh/config \
    && chown ${USER_NAME}:${USER_NAME} ${HOME_DIR}/.ssh/config \
    \
    # Permissões relaxadas apenas para áreas não sensíveis
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



# =============================================================================
# SECTION 9 — SHELL CONTRACT, UX BASELINE & RUNTIME HANDOFF (DIAMOND)
#
# OBJETIVOS (FORMALIZADOS):
# [A] Infraestrutura: Suporte passivo (autocomplete).
# [B] Contrato: Imutável (444), Global, Declarativo.
# [C] Gatekeeper: Identidade dinâmica (NSS), Global, Read-only.
# [D] UX Baseline: Global, Read-only, Interactive-only.
# [E] Segurança: Pipefail obrigatório.
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
    '' \
    "export SHELL_CANONICAL=bash" \
    "export SHELL_CONTRACT_VERSION=${VERSION:-4.3.1}" \
    "export SHELL_CONTRACT_LOADED=true" \
    '' \
    "export RUNTIME_ENV=${BUILD_ENV:-dev}" \
    "export RUNTIME_PROFILE=default" \
    "export RUNTIME_ROLE=devcontainer" \
    '' \
    "export CAPABILITY_INTERACTIVE=true" \
    "export CAPABILITY_AGENT=false" \
    "export CAPABILITY_CI=false" \
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
# -----------------------------------------------------------------------------
RUN cat <<'EOF' > /etc/profile.d/20-devcontainer-ux.sh
# DevContainer UX Contract
# Version: 4.3
# Scope: Interactive shells only
# Mutability: READ-ONLY (Image-level)

# Guards — nunca afeta shells não-interativos
[[ $- != *i* ]] && return

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
