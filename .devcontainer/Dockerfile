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

FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm

# =============================================================================
# SECTION 0 — BUILD METADATA
# =============================================================================
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
# SECTION 1 — LOCALE / TIMEZONE (VS CODE SAFE)
# =============================================================================
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=America/Sao_Paulo \
    LANG=pt_BR.UTF-8 \
    LC_ALL=pt_BR.UTF-8 \
    HOME=/home/node

RUN ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime \
    && echo "${TZ}" > /etc/timezone \
    && apt-get update \
    && apt-get install -y --no-install-recommends locales \
    && sed -i 's/^# *pt_BR.UTF-8/pt_BR.UTF-8/' /etc/locale.gen \
    && sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen \
    && locale-gen pt_BR.UTF-8 en_US.UTF-8 \
    && update-locale LANG=pt_BR.UTF-8 LC_ALL=pt_BR.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

# =============================================================================
# SECTION 2 — CORE SYSTEM & VS CODE SERVER DEPENDENCIES
# =============================================================================
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        wget \
        gnupg \
        bash \
        openssh-client \
        procps \
        psmisc \
        dumb-init \
        libnss-wrapper \
        rsync \
        file \
        iproute2 \
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

ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_LOGLEVEL=warn \
    NPM_CONFIG_PREFIX=/home/node/.npm-global

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
# =============================================================================
USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
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

RUN groupadd -f docker \
    && usermod -aG docker node

# =============================================================================
# SECTION 8 — USER CONTEXT (VS CODE / COPILOT / XDG SAFE)
#
# Finalidade:
#   Garantir um estado inicial de filesystem completamente determinístico
#   antes da inicialização do VS Code Server e extensões.
#
# Esta seção existe para:
#   • Eliminar erros silenciosos de permissão (EACCES)
#   • Evitar criação tardia de diretórios críticos
#   • Estabilizar Copilot / Copilot Chat
#   • Alinhar o container ao XDG Base Directory Spec
#
# CRITÉRIO DE INCLUSÃO:
#   • Diretórios criados automaticamente por tooling
#   • Diretórios usados antes de qualquer script do usuário
#   • Diretórios cuja ausência causa falhas não determinísticas
#
# IMPORTANTE:
#   • Nenhuma lógica de runtime
#   • Nenhuma inicialização
#   • Nenhuma dependência do VS Code já estar rodando
# =============================================================================

RUN mkdir -p \
    \
    # ------------------------------------------------------------
    # HOME BASE
    # ------------------------------------------------------------
    /home/node \
    \
    # ------------------------------------------------------------
    # VS CODE SERVER (CORE)
    # ------------------------------------------------------------
    /home/node/.vscode-server \
    /home/node/.vscode-server/bin \
    /home/node/.vscode-server/data \
    /home/node/.vscode-server/data/Machine \
    /home/node/.vscode-server/data/User \
    /home/node/.vscode-server/extensions \
    /home/node/.vscode-server/extensionsCache \
    \
    # ------------------------------------------------------------
    # XDG BASE DIRECTORIES
    # ------------------------------------------------------------
    /home/node/.cache \
    /home/node/.cache/Microsoft \
    /home/node/.cache/puppeteer \
    /home/node/.config \
    /home/node/.local \
    /home/node/.local/share \
    \
    # ------------------------------------------------------------
    # GITHUB COPILOT / COPILOT CHAT
    # ------------------------------------------------------------
    /home/node/.config/GitHub Copilot \
    /home/node/.config/github-copilot \
    \
    # ------------------------------------------------------------
    # NODE / NPM / PM2
    # ------------------------------------------------------------
    /home/node/.npm \
    /home/node/.npm-global \
    /home/node/.pm2 \
    \
    # ------------------------------------------------------------
    # GIT / SSH / GPG
    # ------------------------------------------------------------
    /home/node/.ssh \
    /home/node/.gnupg \
    \
    # ------------------------------------------------------------
    # DEVCONTAINER METADATA
    # ------------------------------------------------------------
    /home/node/.devcontainer \
    \
    # ------------------------------------------------------------
    # TEMPORARY RUNTIME
    # ------------------------------------------------------------
    /tmp \
    \
    # ------------------------------------------------------------
    # OWNERSHIP — primeiro garantir dono correto
    # ------------------------------------------------------------
    && chown -R node:node /home/node \
    \
    # ------------------------------------------------------------
    # PERMISSIONS — mínimas, determinísticas e seguras
    # ------------------------------------------------------------
    && chmod 700 /home/node/.ssh \
    && chmod 700 /home/node/.gnupg \
    && chmod 1777 /tmp \
    && chmod -R u+rwX /home/node/.vscode-server \
    && chmod -R u+rwX /home/node/.cache

# =============================================================================
# SECTION 9 — SHELL & INIT SAFETY
# =============================================================================
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

USER node
WORKDIR /workspaces

ENTRYPOINT ["dumb-init", "--"]

# =============================================================================
# FINAL NOTES
# =============================================================================
# - dockerd NÃO está instalado
# - docker CLI usa socket do host
# - NSS Wrapper é configurado apenas em runtime (post-create.sh)
# - VS Code Server estável por design
# - Base canônica congelável
# =============================================================================
