# syntax=docker/dockerfile:1.5
# =============================================================================
# Dockerfile — ChatGPT Docker Puppeteer DevContainer (Hybrid Mode)
#
# Target:
# - Host: Windows (Chrome remoto via debugging)
# - Container: Debian Linux (DevContainer)
#
# Contract:
# - Chrome remoto é o DEFAULT
# - Chromium local = compatibilidade / fallback
# - Zero execução de browser no build
# =============================================================================

# -----------------------------------------------------------------------------
# Base image
# -----------------------------------------------------------------------------
ARG BASE_IMAGE=node:20-bookworm
FROM ${BASE_IMAGE} AS devcontainer

# -----------------------------------------------------------------------------
# Build metadata
# -----------------------------------------------------------------------------
ARG BUILD_DATE=unknown
ARG VCS_REF=unknown
ARG VERSION=final

LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="ChatGPT Puppeteer DevContainer (Hybrid)"

# -----------------------------------------------------------------------------
# System environment (neutral)
# -----------------------------------------------------------------------------
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=pt_BR.UTF-8 \
    LC_ALL=pt_BR.UTF-8 \
    TZ=America/Sao_Paulo

# -----------------------------------------------------------------------------
# Timezone & locale (non-interactive)
# -----------------------------------------------------------------------------
RUN set -eux; \
    ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime; \
    echo "${TZ}" > /etc/timezone; \
    echo "pt_BR.UTF-8 UTF-8" > /etc/locale.gen; \
    apt-get update; \
    apt-get install -y --no-install-recommends locales tzdata; \
    locale-gen; \
    rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# System packages + Chromium (compatibility only)
# -----------------------------------------------------------------------------
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        wget \
        gnupg \
        openssh-client \
        unzip \
        xz-utils \
        bash \
        bash-completion \
        dumb-init \
        procps \
        iproute2 \
        git \
        jq \
        inotify-tools \
        \
        chromium \
        \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcairo2 \
        libcups2 \
        libdrm2 \
        libgbm1 \
        libglib2.0-0 \
        libgtk-3-0 \
        libnss3 \
        libnspr4 \
        libpango-1.0-0 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcomposite1 \
        libxcursor1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxi6 \
        libxkbcommon0 \
        libxrandr2 \
        libxrender1 \
        libxshmfence1 \
        libxss1 \
        libxtst6 \
        libdbus-1-3 \
        \
        fonts-liberation \
        fonts-noto-color-emoji \
        fonts-dejavu-core \
        fonts-freefont-ttf; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# -----------------------------------------------------------------------------
# Browser & Dev defaults (EXPLICIT)
# -----------------------------------------------------------------------------
ENV BROWSER_MODE=remote \
    CHROME_REMOTE_HOST=host.docker.internal \
    CHROME_REMOTE_PORT=9222 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    NODE_ENV=development \
    NODE_OPTIONS="--max-old-space-size=2048" \
    ESLINT_CACHE=true \
    ESLINT_CACHE_LOCATION=/home/node/.cache/eslint \
    FORCE_COLOR=1

# -----------------------------------------------------------------------------
# Non-root user + directories for VS Code / Copilot / ESLint / Node
# -----------------------------------------------------------------------------
RUN set -eux; \
    useradd -m -s /bin/bash node; \
    mkdir -p \
        /workspaces \
        /workspaces/chatgpt-docker-puppeteer \
        \
        /home/node/.cache \
        /home/node/.cache/eslint \
        /home/node/.cache/node-gyp \
        /home/node/.cache/puppeteer \
        \
        /home/node/.npm \
        /home/node/.config \
        /home/node/.local \
        /home/node/.local/bin \
        \
        /home/node/.vscode-server \
        /home/node/.vscode-server/bin \
        /home/node/.vscode-server/extensions \
        /home/node/.vscode-server/data \
        /home/node/.vscode-server/data/Machine \
        \
        /home/node/.devcontainer; \
    chown -R node:node /home/node /workspaces

# -----------------------------------------------------------------------------
# DevContainer scripts (definitions only)
# -----------------------------------------------------------------------------
COPY --chown=node:node .devcontainer/ /home/node/.devcontainer/

# -----------------------------------------------------------------------------
# Runtime user & workspace
# -----------------------------------------------------------------------------
USER node
WORKDIR /workspaces/chatgpt-docker-puppeteer

# -----------------------------------------------------------------------------
# Init system
# -----------------------------------------------------------------------------
ENTRYPOINT ["dumb-init", "--"]

# -----------------------------------------------------------------------------
# Neutral command
# -----------------------------------------------------------------------------
CMD ["sleep", "infinity"]
