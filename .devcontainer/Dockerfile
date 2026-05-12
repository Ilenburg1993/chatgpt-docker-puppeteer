# syntax=docker/dockerfile:1
# =============================================================================
# Dockerfile v1.0 — ChatGPT Docker Puppeteer DevContainer (CANÔNICO / DEFINITIVO)
# Base: Node.js 24 + Debian Bookworm (Microsoft DevContainers)
# hadolint global ignore=DL3008,DL3059,DL3009
#
# OBJETIVO MACRO (v1.0)
#   Este Dockerfile define uma imagem DEV (apenas desenvolvimento) com foco em:
#   - Estabilidade máxima do VS Code Server (Remote - Containers / Dev Containers)
#   - Compatibilidade alta com GitHub Copilot / Copilot Chat e fluxos de agente
#   - Puppeteer estável em modo CONNECT (Chrome externo via CDP) com fallback local
#   - Tooling de diagnóstico, profiling, rede e inspeção (sem daemons)
#   - Estrutura de filesystem do usuário previsível (XDG-safe) e amigável a volumes
#   - Contratos formais: shell canônico, shell instrumental, gatekeeper NSS e UX
#
# PRINCÍPIOS (INVIOLÁVEIS)
#   1) AMBIENTE DEV: não é imagem de produção.
#   2) NENHUM SERVIÇO/DAEMON auto-start: nada inicia no build nem por default no runtime.
#   3) CHROME EXTERNO É PRIMÁRIO: Puppeteer conecta via CDP; Chromium local é fallback técnico.
#   4) DOCKER CLI SEM DOCKERD: somente CLI, via socket do host (bind mount).
#   5) REPRODUTIBILIDADE PRÁTICA: camadas bem definidas; limpeza de apt em todas as seções.
#   6) DOCUMENTAÇÃO ROBUSTA: comentários são parte do contrato (não reduzir).
#
# NOTA DE SEGURANÇA (DOCKER SOCKET)
#   Montar /var/run/docker.sock dentro do container equivale a conceder privilégios
#   altos no host (na prática, root-equivalent). Isso é deliberado para DEV.
#
# VERSÃO
#   - Todas as versões/contratos internos nesta imagem usam "1.0".
#   - ARG VERSION default é 1.0 e é propagado para contratos e labels OCI.
# =============================================================================


# =============================================================================
# SECTION 0 — BASE IMAGE, SHELL GLOBAL & BUILD METADATA (OCI)
# =============================================================================
FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm

# ---------------------------------------------------------------------------
# Toolchain pins (upstream stable)
# - Curated tools that are too stale in Debian should be pinned explicitly.
# - Keep these values in sync with upstream stable releases when refreshing the image.
# ---------------------------------------------------------------------------
ARG NPM_VERSION=11.14.1
ARG DEVCONTAINER_CLI_VERSION=0.86.1
ARG PNPM_VERSION=11.1.0
ARG GH_VERSION=2.92.0
ARG ACTIONLINT_VERSION=1.7.12
ARG HADOLINT_VERSION=2.14.0
ARG TYPESCRIPT_VERSION=6.0.3
ARG TYPESCRIPT_LANGUAGE_SERVER_VERSION=5.2.0

# ---------------------------------------------------------------------------
# Curated Rust/Go CLIs — pinned upstream releases (Section 6.8)
# Update via: docker build --build-arg DELTA_VERSION=X.Y.Z ...
# ---------------------------------------------------------------------------
ARG DELTA_VERSION=0.19.2
ARG ZOXIDE_VERSION=0.9.9
ARG XH_VERSION=0.25.3
ARG DUST_VERSION=1.2.4
ARG SD_VERSION=1.1.0
ARG BOTTOM_VERSION=0.12.3
ARG GLOW_VERSION=2.1.2
ARG PROCS_VERSION=0.14.11

# ---------------------------------------------------------------------------
# SHELL GLOBAL (PIPEFAIL)
# - Garante que pipelines em RUN falhem corretamente (curl | gpg, etc.).
# - Aumenta rigor e previsibilidade do build.
# ---------------------------------------------------------------------------
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# ---------------------------------------------------------------------------
# Build-time metadata (OCI)
# - VERSION deve ser "1.0" para o release canônico (pode ser override via build-arg).
# ---------------------------------------------------------------------------
ARG VERSION=1.0
ARG BUILD_DATE=unknown
ARG VCS_REF=unknown
ARG IMAGE_NAME=chatgpt-docker-puppeteer
ARG IMAGE_VENDOR=unknown
ARG BUILD_ENV=dev

LABEL org.opencontainers.image.title="${IMAGE_NAME}" \
    org.opencontainers.image.vendor="${IMAGE_VENDOR}" \
    org.opencontainers.image.version="${VERSION}" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${VCS_REF}" \
    org.opencontainers.image.environment="${BUILD_ENV}" \
    org.opencontainers.image.description="DevContainer for ChatGPT Puppeteer Agent (DEV) — Canonical v1.0"

# ---------------------------------------------------------------------------
# Build-time feedback (logs)
# - Meramente informativo; não cria dependências.
# ---------------------------------------------------------------------------
RUN echo "" \
    && echo "📦 Building ${IMAGE_NAME} v${VERSION}" \
    && echo "🏭 Environment: ${BUILD_ENV}" \
    && echo "📅 Build date: ${BUILD_DATE}" \
    && echo "🔗 VCS ref: ${VCS_REF}" \
    && echo ""


# =============================================================================
# SECTION 1 — IDENTIDADE, CAMINHOS E XDG (CANÔNICO)
#
# Finalidade:
#   • Estabelecer identidade lógica e caminhos base de forma determinística
#   • Alinhar com devcontainer.json (REMOTE_USER) sem assumir VS Code em runtime
#   • Criar APP_DIR sem chown recursivo amplo
#
# Nota:
#   Este Dockerfile assume que o usuário REMOTE_USER já existe no base image.
#   (Na imagem Microsoft DevContainers, "node" existe.)
# =============================================================================

# Projeto (usado para WORKDIR / path; não cria lógica de runtime)
ARG PROJECT_NAME=chatgpt-docker-puppeteer

# Usuário remoto (normalmente: "node")
ARG REMOTE_USER=node

ENV USER_NAME="${REMOTE_USER}" \
    HOME_DIR="/home/${REMOTE_USER}" \
    APP_DIR="/workspaces/${PROJECT_NAME}" \
    CODEX_HOME="/workspaces/${PROJECT_NAME}/.codex"

# XDG Base Directories — fonte única de verdade
ENV XDG_CONFIG_HOME="${HOME_DIR}/.config" \
    XDG_CACHE_HOME="${HOME_DIR}/.cache" \
    XDG_DATA_HOME="${HOME_DIR}/.local/share" \
    XDG_STATE_HOME="${HOME_DIR}/.local/state" \
    PUPPETEER_CACHE_DIR="${HOME_DIR}/.cache/puppeteer"

# Hardening mínimo:
# - Garante diretório de workspace
# - Ownership local (não recursivo)
RUN mkdir -p "${APP_DIR}" \
    && chown "${USER_NAME}:${USER_NAME}" "${APP_DIR}"


# =============================================================================
# SECTION 2 — LOCALE / TIMEZONE / BASE SYSTEM (VS CODE SAFE)
#
# Finalidade:
#   • Locale PT-BR e timezone America/Sao_Paulo
#   • libnss-wrapper requerido para Gatekeeper NSS (runtime)
#   • openssh-client para compatibilidade com operações git/ssh (sem agent auto-start)
# =============================================================================
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=America/Sao_Paulo \
    LANGUAGE=pt_BR:pt:en

RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=apt-lib,target=/var/lib/apt,sharing=locked \
    ln -snf "/usr/share/zoneinfo/${TZ}" /etc/localtime \
    && echo "${TZ}" > /etc/timezone \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    locales \
    libnss-wrapper \
    openssh-client \
    && sed -i 's/^# *pt_BR.UTF-8/pt_BR.UTF-8/' /etc/locale.gen \
    && sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen \
    && locale-gen pt_BR.UTF-8 en_US.UTF-8 \
    && update-locale LANG=pt_BR.UTF-8 LC_MESSAGES=pt_BR.UTF-8

ENV LANG=pt_BR.UTF-8 \
    LC_MESSAGES=pt_BR.UTF-8


# =============================================================================
# SECTION 3 — TOOLCHAIN NATIVA NODE (node-gyp / bindings) + NPM GLOBAL PATH
#
# Finalidade:
#   • Compilação determinística de módulos nativos (C/C++/autotools/cmake)
#   • Python 3 para toolchains híbridas
#   • TLS e downloads confiáveis (ca-certificates/openssl/curl)
#   • PATH consistente para npm global prefix (.npm-global)
# =============================================================================
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=apt-lib,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    autoconf \
    automake \
    libtool \
    python3 \
    python3-pip \
    python3-venv \
    python-is-python3 \
    openssl \
    ca-certificates \
    curl \
    cmake \
    libssl-dev \
    zlib1g-dev \
    nasm \
    libzstd-dev

# Compatibilidade explícita para scripts legados que chamam "python"
RUN ln -sf /usr/bin/python3 /usr/bin/python

# NPM global prefix + PATH (garante disponibilidade das bins globais)
#
# Importante:
# - `~/.npm-global` é um volume nomeado do DevContainer (runtime/user space).
# - Tooling canônico de imagem NÃO deve morar ali, senão o volume mascara a camada da imagem.
# - O prefixo canônico da imagem fica em /usr/local/share/npm-global.
ENV PATH="/usr/local/share/npm-global/bin:${HOME_DIR}/.npm-global/bin:${HOME_DIR}/.local/bin:${PATH}" \
    DEVCONTAINER_TOOLING_PREFIX="/usr/local/share/npm-global" \
    JSONC_PARSER_MODULE_PATH="/usr/local/share/npm-global/lib/node_modules/jsonc-parser" \
    NODE_EXTRA_CA_CERTS="/etc/ssl/certs/ca-certificates.crt" \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_LOGLEVEL=warn \
    NPM_CONFIG_PREFIX="${HOME_DIR}/.npm-global"

# Toolchain global canônico (CLI de container + parsing JSONC + TS/LSP)
# - Alinha npm com o contrato do repo (volta/package.json)
# - Expõe `devcontainer` para build/read-configuration dentro do próprio container
# - Expõe `jsonc-parser` para validação real de `devcontainer.json`, `settings.json` e templates .jsonc
# - Fixa `pnpm` explicitamente no prefixo canônico para evitar depender do estado da imagem-base
#
# NOTA:
# - Instalar em /usr/local/share/npm-global evita que o volume /home/node/.npm-global
#   esconda os binários da imagem após rebuild.
RUN --mount=type=cache,id=npm-global-cache,target=/root/.npm,sharing=locked \
    mkdir -p "${HOME_DIR}/.npm-global" /usr/local/share/npm-global \
    && env NPM_CONFIG_PREFIX=/usr/local/share/npm-global npm install -g \
    npm@${NPM_VERSION} \
    pnpm@${PNPM_VERSION} \
    @devcontainers/cli@${DEVCONTAINER_CLI_VERSION} \
    jsonc-parser@3.3.1 \
    typescript@${TYPESCRIPT_VERSION} \
    typescript-language-server@${TYPESCRIPT_LANGUAGE_SERVER_VERSION} \
    && ln -sf /usr/local/share/npm-global/bin/npm /usr/local/bin/npm \
    && ln -sf /usr/local/share/npm-global/bin/npx /usr/local/bin/npx \
    && ln -sf /usr/local/share/npm-global/bin/pnpm /usr/local/bin/pnpm \
    && ln -sf /usr/local/share/npm-global/bin/devcontainer /usr/local/bin/devcontainer \
    && ln -sf /usr/local/share/npm-global/bin/tsc /usr/local/bin/tsc \
    && ln -sf /usr/local/share/npm-global/bin/tsserver /usr/local/bin/tsserver \
    && ln -sf /usr/local/share/npm-global/bin/typescript-language-server /usr/local/bin/typescript-language-server \
    && npm --version \
    && pnpm --version \
    && devcontainer --version \
    && tsc --version \
    && typescript-language-server --version


# =============================================================================
# SECTION 4 — BROWSER LAYER (Chromium fallback + libs headless)
#
# Finalidade:
#   • Chromium local apenas como fallback técnico
#   • Dependências comuns para Chrome/Chromium headless (GTK shims, X11, NSS/NSPR etc.)
#   • Ferramentas de análise (gdb/heaptrack) úteis em DEV
#
# Princípio:
#   • Puppeteer deve preferir CHROME EXTERNO via CDP; Chromium local é contingência.
# =============================================================================
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=apt-lib,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
    chromium \
    libasound2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
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
    libnss3 \
    libnspr4 \
    libgl1 \
    libvulkan1 \
    mesa-utils \
    gdb \
    heaptrack \
    fontconfig \
    libfreetype6 \
    xdg-utils

# Observação:
# - Chromium fallback NÃO implica uso por padrão.
# - Para Puppeteer connect, configure CHROME_HOST/CHROME_PORT/WS endpoint via devcontainer.json/.env.


# =============================================================================
# SECTION 5 — FONTS & TEXT RENDERING (PDF / EMOJI / I18N)
#
# Finalidade:
#   • Renderização previsível de PDFs e screenshots
#   • Cobertura ampla (Noto + DejaVu + Liberation + Emoji)
# =============================================================================
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=apt-lib,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
    fontconfig \
    fonts-dejavu-core \
    fonts-dejavu-extra \
    fonts-liberation \
    fonts-noto-core \
    fonts-noto-ui-core \
    fonts-noto-color-emoji \
    fonts-jetbrains-mono \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-kacst \
    fonts-freefont-ttf \
    xdg-utils


# =============================================================================
# SECTION 6 — DEV UX (CLIs & DIAGNÓSTICO) — PASSIVO / SEM DAEMONS
#
# Princípios:
#   • Ferramentas de linha de comando apenas (sem serviços)
#   • Úteis para: rede/TLS, inspeção de processos, encoding, análise de código, etc.
# =============================================================================
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=apt-lib,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
    git \
    less \
    vim \
    nano \
    unzip \
    zip \
    tree \
    jq \
    dos2unix \
    file \
    libc-bin \
    htop \
    lsof \
    procps \
    psmisc \
    sysstat \
    curl \
    wget \
    netcat-openbsd \
    dnsutils \
    libnss3-tools \
    iproute2 \
    iputils-ping \
    traceroute \
    nmap \
    tcpdump \
    ncdu \
    openssl \
    watch \
    time \
    strace \
    ltrace \
    dstat \
    man-db \
    bat \
    ripgrep \
    bubblewrap \
    fd-find \
    fzf \
    sqlite3 \
    redis-tools \
    shellcheck \
    yamllint \
    gnupg \
    pass \
    age \
    graphviz \
    yq \
    moreutils \
    watchman \
    hyperfine \
    git-lfs \
    socat \
    mtr-tiny \
    cloc \
    ccache \
    postgresql-client \
    protobuf-compiler \
    lz4 \
    entr \
    pv \
    jo \
    p7zip-full \
    inotify-tools

# Debian packaging note:
# - `bat` package exposes `batcat`
# - `fd-find` package exposes `fdfind`
# The repo and operator workflows expect the canonical upstream names `bat` and `fd`.
RUN if command -v batcat >/dev/null 2>&1 && ! command -v bat >/dev/null 2>&1; then \
    ln -sf /usr/bin/batcat /usr/local/bin/bat; \
    fi \
    && if command -v fdfind >/dev/null 2>&1 && ! command -v fd >/dev/null 2>&1; then \
    ln -sf /usr/bin/fdfind /usr/local/bin/fd; \
    fi

# Curated upstream CLI binaries
# - `gh` from Debian bookworm lags significantly behind upstream; use the official release artifact.
# - `actionlint` and `hadolint` close the local lint toolchain for GitHub Actions and Dockerfiles.
# - Every upstream download is verified with the checksum published by the corresponding release.
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
    amd64) gh_arch='amd64'; actionlint_arch='amd64'; hadolint_arch='x86_64' ;; \
    arm64) gh_arch='arm64'; actionlint_arch='arm64'; hadolint_arch='arm64' ;; \
    *) echo "Unsupported architecture for curated CLIs: $arch" >&2; exit 1 ;; \
    esac; \
    gh_asset="gh_${GH_VERSION}_linux_${gh_arch}.tar.gz"; \
    curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "https://github.com/cli/cli/releases/download/v${GH_VERSION}/${gh_asset}" -o /tmp/gh.tgz; \
    curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_checksums.txt" -o /tmp/gh_checksums.txt; \
    grep "  ${gh_asset}\$" /tmp/gh_checksums.txt | sed 's#  .*#  /tmp/gh.tgz#' | sha256sum -c -; \
    tar -xzf /tmp/gh.tgz -C /tmp; \
    install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${gh_arch}/bin/gh" /usr/local/bin/gh; \
    actionlint_asset="actionlint_${ACTIONLINT_VERSION}_linux_${actionlint_arch}.tar.gz"; \
    curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${actionlint_asset}" -o /tmp/actionlint.tgz; \
    curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_checksums.txt" -o /tmp/actionlint_checksums.txt; \
    grep "  ${actionlint_asset}\$" /tmp/actionlint_checksums.txt | sed 's#  .*#  /tmp/actionlint.tgz#' | sha256sum -c -; \
    tar -xzf /tmp/actionlint.tgz -C /tmp; \
    install -m 0755 /tmp/actionlint /usr/local/bin/actionlint; \
    curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "https://github.com/hadolint/hadolint/releases/download/v${HADOLINT_VERSION}/hadolint-linux-${hadolint_arch}" -o /tmp/hadolint; \
    curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "https://github.com/hadolint/hadolint/releases/download/v${HADOLINT_VERSION}/hadolint-linux-${hadolint_arch}.sha256" -o /tmp/hadolint.sha256; \
    awk '{print $1 "  /tmp/hadolint"}' /tmp/hadolint.sha256 | sha256sum -c -; \
    install -m 0755 /tmp/hadolint /usr/local/bin/hadolint; \
    rm -rf /tmp/gh.tgz /tmp/gh_checksums.txt "/tmp/gh_${GH_VERSION}_linux_${gh_arch}" /tmp/actionlint.tgz /tmp/actionlint_checksums.txt /tmp/actionlint /tmp/hadolint /tmp/hadolint.sha256; \
    gh --version | head -n 1; \
    actionlint -version; \
    hadolint --version


# =============================================================================
# SECTION 6.8 — CURATED RUST/GO CLIs (binary releases, pinned upstream)
#
# Ferramentas modernas do ecossistema Rust/Go que não estão disponíveis nos
# repositórios Debian Bookworm, ou estão em versões muito desatualizadas.
#
# Cada ferramenta é baixada do GitHub Releases com verificação de integridade
# via HTTPS. Suporte a amd64 e arm64.
#
# Para atualizar: ajuste os ARGs DELTA_VERSION, ZOXIDE_VERSION, etc. no topo.
# =============================================================================
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    # Mapeamento de sufixos de arquitetura por ferramenta
    case "$arch" in \
    amd64) \
    DELTA_ARCH='x86_64-unknown-linux-gnu'; \
    ZOXIDE_ARCH='x86_64-unknown-linux-musl'; \
    XH_ARCH='x86_64-unknown-linux-musl'; \
    DUST_ARCH='x86_64-unknown-linux-musl'; \
    SD_ARCH='x86_64-unknown-linux-musl'; \
    BOTTOM_ARCH='x86_64-unknown-linux-musl'; \
    GLOW_ARCH='x86_64'; \
    PROCS_ARCH='x86_64-linux'; \
    ;; \
    arm64) \
    DELTA_ARCH='aarch64-unknown-linux-gnu'; \
    ZOXIDE_ARCH='aarch64-unknown-linux-musl'; \
    XH_ARCH='aarch64-unknown-linux-musl'; \
    DUST_ARCH='aarch64-unknown-linux-musl'; \
    SD_ARCH='aarch64-unknown-linux-musl'; \
    BOTTOM_ARCH='aarch64-unknown-linux-musl'; \
    GLOW_ARCH='arm64'; \
    PROCS_ARCH='aarch64-linux'; \
    ;; \
    *) echo "Unsupported architecture for Rust CLIs: $arch" >&2; exit 1 ;; \
    esac; \
    mkdir -p /tmp/rust-cli; \
    # ─── delta (git-delta): rich, semantic diff viewer ───────────────────────
    # Tag format: VERSION (no v prefix). Binary inside subdirectory of tarball.
    curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "https://github.com/dandavison/delta/releases/download/${DELTA_VERSION}/delta-${DELTA_VERSION}-${DELTA_ARCH}.tar.gz" \
    -o /tmp/rust-cli/delta.tgz; \
    tar -xzf /tmp/rust-cli/delta.tgz -C /tmp/rust-cli; \
    install -m 0755 "/tmp/rust-cli/delta-${DELTA_VERSION}-${DELTA_ARCH}/delta" /usr/local/bin/delta; \
    # ─── zoxide: smart cd with frecency ranking ───────────────────────────────
    # Tag format: vVERSION. Binary at tarball root.
    curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "https://github.com/ajeetdsouza/zoxide/releases/download/v${ZOXIDE_VERSION}/zoxide-${ZOXIDE_VERSION}-${ZOXIDE_ARCH}.tar.gz" \
    -o /tmp/rust-cli/zoxide.tgz; \
    mkdir -p /tmp/rust-cli/zoxide-extract; \
    tar -xzf /tmp/rust-cli/zoxide.tgz -C /tmp/rust-cli/zoxide-extract; \
    install -m 0755 /tmp/rust-cli/zoxide-extract/zoxide /usr/local/bin/zoxide; \
    # ─── xh: friendly HTTP client (curl/httpie alternative) ──────────────────
    # Tag format: vVERSION. Binary inside subdirectory of tarball.
    curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "https://github.com/ducaale/xh/releases/download/v${XH_VERSION}/xh-v${XH_VERSION}-${XH_ARCH}.tar.gz" \
    -o /tmp/rust-cli/xh.tgz; \
    mkdir -p /tmp/rust-cli/xh-extract; \
    tar -xzf /tmp/rust-cli/xh.tgz -C /tmp/rust-cli/xh-extract; \
    install -m 0755 "/tmp/rust-cli/xh-extract/xh-v${XH_VERSION}-${XH_ARCH}/xh" /usr/local/bin/xh; \
    # ─── dust: intuitive `du` replacement ────────────────────────────────────
    # Tag format: vVERSION. Binary inside subdirectory of tarball.
    curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "https://github.com/bootandy/dust/releases/download/v${DUST_VERSION}/dust-v${DUST_VERSION}-${DUST_ARCH}.tar.gz" \
    -o /tmp/rust-cli/dust.tgz; \
    mkdir -p /tmp/rust-cli/dust-extract; \
    tar -xzf /tmp/rust-cli/dust.tgz -C /tmp/rust-cli/dust-extract; \
    install -m 0755 "/tmp/rust-cli/dust-extract/dust-v${DUST_VERSION}-${DUST_ARCH}/dust" /usr/local/bin/dust; \
    # ─── sd: intuitive find & replace (sed alternative) ──────────────────────
    # Tag format: vVERSION. Static binary within tarball.
    curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "https://github.com/chmln/sd/releases/download/v${SD_VERSION}/sd-v${SD_VERSION}-${SD_ARCH}.tar.gz" \
    -o /tmp/rust-cli/sd.tgz; \
    mkdir -p /tmp/rust-cli/sd-extract; \
    tar -xzf /tmp/rust-cli/sd.tgz -C /tmp/rust-cli/sd-extract; \
    find /tmp/rust-cli/sd-extract -type f -name 'sd' -exec install -m 0755 {} /usr/local/bin/sd \;; \
    # ─── bottom (btm): graphical process/system monitor ──────────────────────
    # Tag format: VERSION (no v prefix). Asset name has NO version in filename.
    curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "https://github.com/ClementTsang/bottom/releases/download/${BOTTOM_VERSION}/bottom_${BOTTOM_ARCH}.tar.gz" \
    -o /tmp/rust-cli/bottom.tgz; \
    mkdir -p /tmp/rust-cli/bottom-extract; \
    tar -xzf /tmp/rust-cli/bottom.tgz -C /tmp/rust-cli/bottom-extract; \
    install -m 0755 /tmp/rust-cli/bottom-extract/btm /usr/local/bin/btm; \
    # ─── glow: Markdown rendering in terminal ─────────────────────────────────
    # Tag format: vVERSION. Asset name has NO version in filename: glow_Linux_ARCH.
    curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "https://github.com/charmbracelet/glow/releases/download/v${GLOW_VERSION}/glow_${GLOW_VERSION}_Linux_${GLOW_ARCH}.tar.gz" \
    -o /tmp/rust-cli/glow.tgz; \
    mkdir -p /tmp/rust-cli/glow-extract; \
    tar -xzf /tmp/rust-cli/glow.tgz -C /tmp/rust-cli/glow-extract; \
    find /tmp/rust-cli/glow-extract -type f -name 'glow' -exec install -m 0755 {} /usr/local/bin/glow \;; \
    # ─── procs: modern ps replacement ────────────────────────────────────────
    # Tag format: vVERSION. Binary within zip.
    curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "https://github.com/dalance/procs/releases/download/v${PROCS_VERSION}/procs-v${PROCS_VERSION}-${PROCS_ARCH}.zip" \
    -o /tmp/rust-cli/procs.zip; \
    mkdir -p /tmp/rust-cli/procs-extract; \
    unzip -q /tmp/rust-cli/procs.zip -d /tmp/rust-cli/procs-extract; \
    install -m 0755 /tmp/rust-cli/procs-extract/procs /usr/local/bin/procs; \
    # ─── Cleanup ──────────────────────────────────────────────────────────────
    rm -rf /tmp/rust-cli; \
    # ─── Smoke test (verify all binaries respond) ─────────────────────────────
    delta --version | head -n 1; \
    zoxide --version; \
    xh --version | head -n 1; \
    dust --version | head -n 1; \
    sd --version; \
    btm --version | head -n 1; \
    glow --version; \
    procs --version | head -n 1


# =============================================================================
# SECTION 6.5 — POWERSHELL (INSTRUMENTAL / NÃO-CANÔNICO)
#
# Finalidade:
#   • Shell instrumental para inspeção/IA/diagnóstico (não substitui bash)
#   • Integração com VS Code e fluxos de agente (quando aplicável)
#
# Contrato:
#   • PowerShell é SEMPRE subordinado ao bash canônico nesta imagem.
# =============================================================================
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=apt-lib,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors https://packages.microsoft.com/keys/microsoft.asc \
    | gpg --dearmor > /etc/apt/keyrings/microsoft.gpg \
    && chmod 0644 /etc/apt/keyrings/microsoft.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
    > /etc/apt/sources.list.d/microsoft-prod.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends powershell

# SECTION 6.6 — POWERSHELL CONTRACT (GLOBAL, READ-ONLY)
RUN mkdir -p /etc/powershell \
    && chmod 0755 /etc/powershell

RUN cat > /etc/powershell/PowerShell.Contract.ps1 <<'EOF'
# =============================================================================
# PowerShell Contract — DevContainer
# Version: 1.0
#
# Authority Model:
#   • PowerShell  → Instrumental (subordinado)
#   • Bash        → Canonical (autoridade)
# =============================================================================

$env:POWERSHELL_CONTRACT_VERSION = "1.0"
$env:POWERSHELL_CONTRACT_LOADED  = "true"
$env:POWERSHELL_ROLE             = "instrumental"
$env:POWERSHELL_AUTHORITY        = "subordinate"
$env:POWERSHELL_CANONICAL        = "false"

# Fonte única de verdade (shell canônico)
$env:SHELL_CANONICAL = "bash"

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-NotCanonical {
    Write-Verbose "[PSC] PowerShell é instrumental. Bash é canônico."
}
Assert-NotCanonical

# Prompt explícito (somente console interativo)
if ($Host.Name -eq "ConsoleHost") {
    function prompt {
        "PS(instr) $(Get-Location)> "
    }
}
EOF

RUN chmod 0444 /etc/powershell/PowerShell.Contract.ps1

RUN cat > /etc/powershell/profile.ps1 <<'EOF'
# PowerShell Global Profile — DevContainer (Read-only)
$contract = "/etc/powershell/PowerShell.Contract.ps1"
if (Test-Path $contract) { . $contract }
EOF

RUN chmod 0444 /etc/powershell/profile.ps1


# =============================================================================
# SECTION 7 — DOCKER CLI (SEM DOCKERD) + PLUGINS (COMPOSE/BUILDX)
#
# Finalidade:
#   • Permitir docker CLI via socket do host (bind mount /var/run/docker.sock)
#   • O socket real é sempre fornecido pelo runtime; a imagem não fabrica socket local.
#   • Instalar plugins modernos: docker-compose-plugin e docker-buildx-plugin
#
# Segurança:
#   • Acesso ao socket do host => privilégios elevados no host.
#   • As políticas de mount são auditadas de forma centralizada pelos hooks do DevContainer.
#   • Sincronização de GID é best-effort (não quebra build).
# =============================================================================
USER root
ARG DOCKER_GID=999

RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=apt-lib,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    docker-ce-cli \
    docker-compose-plugin \
    docker-buildx-plugin

# Grupo docker — alinhamento defensivo com host (best-effort)
RUN set -e; \
    if [ -n "${DOCKER_GID:-}" ]; then \
    echo "→ DOCKER_GID fornecido: ${DOCKER_GID}"; \
    if getent group docker >/dev/null 2>&1; then \
    groupmod -g "${DOCKER_GID}" docker 2>/dev/null || true; \
    else \
    groupadd -g "${DOCKER_GID}" docker 2>/dev/null || true; \
    fi; \
    else \
    echo "→ DOCKER_GID não fornecido — garantindo grupo docker local"; \
    groupadd -f docker 2>/dev/null || true; \
    fi; \
    usermod -aG docker "${USER_NAME}" 2>/dev/null || true; \
    true


# =============================================================================
# SECTION 6.9 — TOOL VALIDATION GATE
#
# Valida que TODAS as ferramentas esperadas estão presentes no PATH.
# Posicionado após Docker CLI (Section 7) e PowerShell (Section 6.5).
# Checks obrigatórios falham o build; checks opcionais emitem aviso.
# =============================================================================
RUN set -e; \
    echo ""; \
    echo "═══════════════════════════════════════════════════"; \
    echo " Tool Validation Gate — DevContainer v1.0"; \
    echo "═══════════════════════════════════════════════════"; \
    _ok=0; _fail=0; _warn=0; \
    _check() { \
    if command -v "$1" >/dev/null 2>&1; then \
    echo "  ✓  $1"; \
    _ok=$((_ok + 1)); \
    else \
    echo "  ✗  $1  ← MISSING"; \
    _fail=$((_fail + 1)); \
    fi; \
    }; \
    _check_optional() { \
    if command -v "$1" >/dev/null 2>&1; then \
    echo "  ✓  $1"; \
    _ok=$((_ok + 1)); \
    else \
    echo "  ⚠  $1  ← optional/runtime (not blocking)"; \
    _warn=$((_warn + 1)); \
    fi; \
    }; \
    echo "── System & Build ──────────────────────────────────"; \
    _check git; _check curl; _check wget; _check openssl; \
    _check gpg; _check nasm; _check cmake; _check cc; \
    _check python3; _check node; _check npm; _check pnpm; \
    echo "── Editors & Navigation ────────────────────────────"; \
    _check vim; _check nano; _check less; _check fzf; \
    echo "── File & Archive ──────────────────────────────────"; \
    _check unzip; _check zip; _check 7za; _check pv; \
    _check lz4; _check bat; _check fd; _check rg; \
    _check tree; _check ncdu; _check jo; _check entr; \
    echo "── Process & System ────────────────────────────────"; \
    _check htop; _check lsof; _check strace; _check dstat; \
    _check inotifywait; _check ps; _check watch; \
    echo "── Network & Debug ─────────────────────────────────"; \
    _check nc; _check nmap; _check tcpdump; _check mtr; \
    _check socat; _check traceroute; _check dig; _check ip; \
    echo "── Code Quality ────────────────────────────────────"; \
    _check shellcheck; _check yamllint; _check cloc; \
    _check ccache; _check hyperfine; _check watchman; \
    echo "── Data & DB ───────────────────────────────────────"; \
    _check sqlite3; _check redis-cli; _check psql; \
    _check jq; _check yq; _check protoc; \
    echo "── TypeScript & LSP ────────────────────────────────"; \
    _check tsc; _check tsserver; _check typescript-language-server; \
    echo "── DevOps CLIs (upstream) ──────────────────────────"; \
    _check gh; _check actionlint; _check hadolint; _check git-lfs; \
    _check age; _check pass; \
    echo "── DevOps CLIs (runtime-socket / opcional) ─────────"; \
    _check_optional docker; \
    echo "── Rust/Go CLIs (Section 6.8) ──────────────────────"; \
    _check delta; _check zoxide; _check xh; _check dust; \
    _check sd; _check btm; _check glow; _check procs; \
    echo "── Instrumental Shell (opcional) ───────────────────"; \
    _check_optional pwsh; \
    echo "───────────────────────────────────────────────────"; \
    echo " Result: ${_ok} OK  |  ${_fail} MISSING  |  ${_warn} optional absent"; \
    echo "═══════════════════════════════════════════════════"; \
    echo ""; \
    if [ "${_fail}" -gt 0 ]; then \
    echo "BUILD FAILED: ${_fail} required tool(s) missing." >&2; \
    exit 1; \
    fi


# =============================================================================
# SECTION 8 — USER CONTEXT (VS CODE / COPILOT / CLAUDE / XDG SAFE)
#
# Finalidade:
#   • Criar estrutura base (imagem-level) antes de mounts de volumes
#   • Evitar criação de diretórios como root em runtime (quando possível)
#   • Garantir ownership inicial correto sem chown indiscriminado do $HOME
#
# Nota:
#   Ajustes dinâmicos de UID/GID, volumes e NSS são responsabilidade do post-create.sh.
# =============================================================================
RUN mkdir -p \
    "${HOME_DIR}/.vscode-server/bin" \
    "${HOME_DIR}/.vscode-server/data/Machine" \
    "${HOME_DIR}/.vscode-server/data/User" \
    "${HOME_DIR}/.vscode-server/data/CachedProfilesData" \
    "${HOME_DIR}/.vscode-server/extensions" \
    "${HOME_DIR}/.vscode-server/extensionsCache" \
    "${HOME_DIR}/.cache" \
    "${HOME_DIR}/.cache/Microsoft" \
    "${HOME_DIR}/.cache/puppeteer" \
    "${HOME_DIR}/.cache/typescript" \
    "${HOME_DIR}/.local/share" \
    "${HOME_DIR}/.local/share/github-copilot" \
    "${HOME_DIR}/.local/share/rag-db" \
    "${HOME_DIR}/.local/share/rag-index" \
    "${HOME_DIR}/.local/state" \
    "${HOME_DIR}/.local/bin" \
    "${HOME_DIR}/.npm" \
    "${HOME_DIR}/.npm-global" \
    "${HOME_DIR}/.pm2" \
    "${HOME_DIR}/.copilot" \
    "${HOME_DIR}/.copilot/skills" \
    "${HOME_DIR}/.config" \
    "${HOME_DIR}/.config/gh" \
    "${HOME_DIR}/.config/github-copilot" \
    "${HOME_DIR}/.config/GitHub Copilot" \
    "${HOME_DIR}/.config/opencode" \
    "${HOME_DIR}/.ssh" \
    "${HOME_DIR}/.gnupg" \
    "${HOME_DIR}/.claude" \
    "/home/${USER_NAME}-history" \
    && chown -R "${USER_NAME}:${USER_NAME}" \
    "${HOME_DIR}/.vscode-server" \
    "${HOME_DIR}/.cache" \
    "${HOME_DIR}/.npm" \
    "${HOME_DIR}/.npm-global" \
    "${HOME_DIR}/.pm2" \
    "${HOME_DIR}/.copilot" \
    "${HOME_DIR}/.config" \
    "${HOME_DIR}/.local" \
    "${HOME_DIR}/.ssh" \
    "${HOME_DIR}/.gnupg" \
    "${HOME_DIR}/.claude" \
    "/home/${USER_NAME}-history" \
    && touch "/home/${USER_NAME}-history/.bash_history" \
    && chown "${USER_NAME}:${USER_NAME}" "/home/${USER_NAME}-history/.bash_history" \
    # .hushlogin: suprime MOTD em shells login+interativos (ex.: userEnvProbe loginInteractiveShell)
    # Elimina: 50-motd-news (rede), 50-landscape-sysinfo (CPU/disco), 91-contract-ua-esm-status (rede)
    # Mantém intactos todos os scripts de /etc/profile.d/ (runtime.sh, gatekeeper-nss.sh, etc.)
    && touch "${HOME_DIR}/.hushlogin" \
    && chown "${USER_NAME}:${USER_NAME}" "${HOME_DIR}/.hushlogin" \
    && chmod 0644 "${HOME_DIR}/.hushlogin" \
    && chmod 1777 /tmp \
    && chmod 0700 "${HOME_DIR}/.ssh" "${HOME_DIR}/.gnupg" \
    && touch "${HOME_DIR}/.ssh/config" \
    && chmod 0600 "${HOME_DIR}/.ssh/config" \
    && chown "${USER_NAME}:${USER_NAME}" "${HOME_DIR}/.ssh/config" \
    # Endurecimento adicional (sensíveis mas não secretos por si só)
    && chmod 0700 \
    "${HOME_DIR}/.copilot" \
    "${HOME_DIR}/.config/gh" \
    "${HOME_DIR}/.config/github-copilot" \
    "${HOME_DIR}/.config/opencode" \
    "${HOME_DIR}/.claude" \
    "/home/${USER_NAME}-history" \
    # Permissões relaxadas apenas em bits do usuário (não altera group/other)
    && chmod -R u+rwX \
    "${HOME_DIR}/.vscode-server" \
    "${HOME_DIR}/.cache" \
    "${HOME_DIR}/.npm" \
    "${HOME_DIR}/.npm-global" \
    "${HOME_DIR}/.pm2" \
    "${HOME_DIR}/.config" \
    "${HOME_DIR}/.local" \
    "${HOME_DIR}/.claude" \
    "/home/${USER_NAME}-history"


# =============================================================================
# SECTION 8.5 — ENV DEFAULTS (DOCUMENTAÇÃO / SAFE DEFAULTS DEV) — v1.0
#
# Hierarquia prática (maior prioridade -> menor):
#   1) devcontainer.json: remoteEnv (processos geridos pelo VS Code)
#   2) devcontainer.json: containerEnv
#   3) devcontainer.json: runArgs --env-file
#   4) ENV neste Dockerfile (defaults da imagem)
#   5) bootstrap da app: .env -> .env.${NODE_ENV} -> .env.local -> .env.${NODE_ENV}.local
#   6) config.json (superfície do ConfigurationManager)
#   7) fallback hardcoded em código
#
# Observação:
#   Estes defaults são DEV. Para produção, use .env.production (fora desta imagem).
#   `FORCE_COLOR` é intencionalmente omitido aqui para respeitar `NO_COLOR`
#   e evitar warnings globais no startup do Node.
# =============================================================================

# STRUCTURAL (identidade do sistema)
ENV NODE_ENV=development \
    SERVER_MODE=split \
    SERVER_AUTHORITY=standalone \
    BROWSER_MODE=wsEndpoint

# INFRASTRUCTURE (conectividade essencial)
ENV SERVER_PORT=3008 \
    CHROME_PROXY_PORT=9224 \
    CHROME_PORT=9225 \
    CHROME_HOST=host.docker.internal \
    CHROME_PROXY_BIND=0.0.0.0 \
    HOST=0.0.0.0

# OPERATIONAL (comportamento runtime)
ENV BROWSER_POOL_SIZE=3 \
    ALLOCATION_STRATEGY=round-robin \
    HEALTH_CHECK_INTERVAL=30000 \
    ALLOW_DEGRADED_MODE=true \
    AUTO_RETRY_CHROME=true \
    MAX_AUTO_RETRIES=2 \
    MAX_CONNECTION_ATTEMPTS=5 \
    CONNECTION_TIMEOUT=30000 \
    LOG_LEVEL=info \
    NERV_BUFFER_SIZE=1000 \
    NERV_TELEMETRY=true \
    NERV_INTEGRATION=true \
    KERNEL_CYCLE_INTERVAL=50 \
    CONTEXT_STRATEGY=sliding_window \
    CONTEXT_MAX_TOKENS=100000 \
    SUMMARIZATION_POLICY=on_overflow \
    MISSIONS_DIR=missions \
    CHECKPOINT_KEEP_LAST=10 \
    FACTORY_DEFAULT_TARGET=chatgpt \
    FACTORY_VALIDATE_BOOT=false

# FEATURE FLAGS
ENV PUPPETEER_LOCAL_LAUNCH_DISABLED=true \
    MOCK_CHROME=0 \
    ENABLE_STATE_FILE=true

# CHROME PROXY SERVICE (v1.0)
ENV WS_IDLE_TIMEOUT_MS=300000 \
    ALLOWED_ORIGINS="http://localhost:3008,http://127.0.0.1:3008"

# RUNTIME PERFORMANCE (VM / I/O tuning)
# UV_THREADPOOL_SIZE: pool de threads do libuv (default=4). Aumentar para
# melhorar I/O paralelo — tsserver, fs watchers e async file ops se beneficiam.
# 16 = bom compromisso para ambientes multi-core sem desperdício de memória.
ENV UV_THREADPOOL_SIZE=16


# =============================================================================
# SECTION 9 — SHELL CONTRACT + GATEKEEPER NSS + UX BASELINE + HANDOFF (v1.0)
#
# Objetivos:
#   [A] Infra: bash-completion + dumb-init (entrypoint)
#   [B] Contrato: /etc/profile.d/00-runtime.sh (read-only)
#   [C] Gatekeeper NSS: /etc/profile.d/10-gatekeeper-nss.sh (read-only, fail-safe)
#   [D] UX baseline: /etc/profile.d/20-devcontainer-ux.sh (read-only, interactive-only)
#   [E] Handoff: ENTRYPOINT com dumb-init + nss-gatekeeper
#
# NOTA SOBRE /etc/profile.d:
#   Scripts aqui precisam ser POSIX-safe sempre que possível, pois podem ser
#   “sourceados” em diferentes shells via /etc/profile.
# =============================================================================

# [A] PRÉ-REQUISITOS
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=apt-lib,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
    bash-completion \
    dumb-init

# [B] CONTRATO CANÔNICO RUNTIME (GLOBAL, READ-ONLY)
RUN mkdir -p /etc/profile.d \
    && printf '%s\n' \
    '# Canonical Runtime Shell Contract' \
    '# Version: 1.0' \
    '# Declarative only — no logic, no side effects' \
    '# AI-AWARE CONTRACT (Semantic Hints Only)' \
    '' \
    '## Shell canônico' \
    'export SHELL_CANONICAL=bash' \
    'export CANONICAL_SHELL=bash' \
    'export INSTRUMENTAL_SHELLS="pwsh"' \
    '' \
    '## Identidade do contrato' \
    "export SHELL_CONTRACT_VERSION=${VERSION:-1.0}" \
    'export SHELL_CONTRACT_LOADED=true' \
    '' \
    '## Classificação de runtime (semântica)' \
    "export RUNTIME_ENV=${BUILD_ENV:-dev}" \
    'export RUNTIME_PROFILE=default' \
    'export RUNTIME_ROLE=devcontainer' \
    '' \
    '## Flags de capacidade (semânticas)' \
    'export CAPABILITY_INTERACTIVE=true' \
    'export CAPABILITY_AGENT=false' \
    'export CAPABILITY_CI=false' \
    'export CAPABILITY_AI_ASSISTED=true' \
    'export CAPABILITY_SEMANTIC_SHELL=true' \
    '' \
    '# AI-HINT:' \
    '# - Bash é o shell canônico para automação e execução' \
    '# - PowerShell (pwsh) é instrumental e não-autoritativo' \
    > /etc/profile.d/00-runtime.sh \
    && chmod 0444 /etc/profile.d/00-runtime.sh

# [C] GATEKEEPER NSS (GLOBAL, FAIL-SAFE, POSIX-SAFE)
RUN cat > /etc/profile.d/10-gatekeeper-nss.sh <<'EOF'
# DevContainer Gatekeeper — NSS Wrapper
# Version: 1.0
# Scope: Universal (all shells)
# Mutability: READ-ONLY (Image-level)
# Behavior: Fail-safe; activates only if artifacts exist and library is present.
#
# POSIX-sh compatible (no [[ ]], no arrays).

# Bypass explícito
if [ -n "${DEVCONTAINER_SKIP_NSS:-}" ]; then
  return 0 2>/dev/null || exit 0
fi

# Opcional: restringir a interativo
# case "$-" in *i*) ;; *) return 0 2>/dev/null || exit 0 ;; esac

# Artefatos canônicos (seed fallback no entrypoint; post-create pode refinar)
NSS_BASE_DIR="${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"
PASSWD_FILE="${NSS_BASE_DIR}/passwd"
GROUP_FILE="${NSS_BASE_DIR}/group"

# Diretório best-effort (nunca fatal)
mkdir -p "${NSS_BASE_DIR}" 2>/dev/null || true
chmod 700 "${NSS_BASE_DIR}" 2>/dev/null || true

# Só ativa se artefatos existirem e não estiverem vazios
if [ ! -s "${PASSWD_FILE}" ] || [ ! -s "${GROUP_FILE}" ]; then
  return 0 2>/dev/null || exit 0
fi

ARCH="$(uname -m 2>/dev/null || echo x86_64)"
NSS_LIB=""

# Paths conhecidos (Debian/Ubuntu multiarch)
if [ -f "/usr/lib/${ARCH}-linux-gnu/libnss_wrapper.so" ]; then
  NSS_LIB="/usr/lib/${ARCH}-linux-gnu/libnss_wrapper.so"
elif [ -f "/usr/lib/x86_64-linux-gnu/libnss_wrapper.so" ]; then
  NSS_LIB="/usr/lib/x86_64-linux-gnu/libnss_wrapper.so"
elif command -v ldconfig >/dev/null 2>&1 && ldconfig -p 2>/dev/null | grep -q "libnss_wrapper\.so"; then
  NSS_LIB="libnss_wrapper.so"
else
  return 0 2>/dev/null || exit 0
fi

export NSS_WRAPPER_PASSWD="${PASSWD_FILE}"
export NSS_WRAPPER_GROUP="${GROUP_FILE}"

# Evitar duplicação em LD_PRELOAD
case ":${LD_PRELOAD:-}:" in
  *":${NSS_LIB}:"*|*":libnss_wrapper.so:"*) : ;;
  *) export LD_PRELOAD="${NSS_LIB}${LD_PRELOAD:+:$LD_PRELOAD}" ;;
esac

# Debug opt-in (stderr)
if [ -n "${DEVCONTAINER_NSS_DEBUG:-}" ]; then
  CURRENT_UID="$(id -u 2>/dev/null || echo unknown)"
  echo "[gatekeeper] NSS active (UID=${CURRENT_UID}, preload=${NSS_LIB})" >&2
fi

return 0 2>/dev/null || exit 0
EOF

RUN chmod 0444 /etc/profile.d/10-gatekeeper-nss.sh

# Wrapper de entrypoint (arquivo fornecido pelo projeto)
# - Este script deve ser POSIX-safe e idempotente.
# - Ele pode ativar o ambiente NSS wrapper antes de executar o comando final.
COPY --chmod=0755 .devcontainer/nss-gatekeeper.sh /usr/local/bin/nss-gatekeeper

# Healthcheck e utilitário de JSONC (image-level, independentes do workspace)
COPY --chmod=0755 .devcontainer/scripts/healthcheck.sh /usr/local/bin/devcontainer-healthcheck.sh
COPY --chmod=0755 .devcontainer/scripts/jsonc-validate.cjs /usr/local/bin/jsonc-validate

# Healthcheck nativo da imagem — advisory para runtime DevContainer.
# Mantém start gracioso via start-period generoso e delega a lógica ao script canônico.
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD /usr/local/bin/devcontainer-healthcheck.sh || exit 1

# [D] UX BASELINE (GLOBAL, READ-ONLY, INTERACTIVE-ONLY, POSIX-SAFE)
RUN cat > /etc/profile.d/20-devcontainer-ux.sh <<'EOF'
# DevContainer UX Contract
# Version: 1.0
# Scope: Interactive shells only
# Mutability: READ-ONLY (Image-level)

# Nunca afeta shells não-interativos
case "$-" in *i*) ;; *) return 0 ;; esac

__dc_parse_git_branch() {
  command -v git >/dev/null 2>&1 || return 0
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  git branch 2>/dev/null | sed -n 's/^\* \(.*\)$/ (\1)/p'
}

# Prompt informativo (compatível com bash; em sh apenas “degrada” visualmente)
export PS1="\n\[\033[01;30m\][\t]\[\033[00m\] \
\[\033[01;32m\]➜ \[\033[00m\]\
\[\033[01;34m\]\w\[\033[00m\]\
\[\033[33m\]\$(__dc_parse_git_branch)\[\033[00m\]\n\$ "

# Histórico
export HISTCONTROL=ignoreboth
if [ -n "${BASH_VERSION:-}" ]; then
  shopt -s histappend 2>/dev/null || true
fi
export HISTSIZE=10000
export HISTFILESIZE=20000
export HISTTIMEFORMAT="%F %T "

# Autocomplete (se disponível)
if [ -f /usr/share/bash-completion/bash_completion ]; then
  . /usr/share/bash-completion/bash_completion
fi
EOF

RUN chmod 0444 /etc/profile.d/20-devcontainer-ux.sh


# =============================================================================
# SECTION 9.6 — BASH HARDENING (.bashrc persistent overrides) — v1.0
#
# Problema: ~/.bashrc vem da base image (node) e define HISTSIZE=1000.
# Em login shells (ordem: profile.d → .profile → .bashrc), o .bashrc do
# base image SOBRESCREVE as configurações de 20-devcontainer-ux.sh (HISTSIZE=10000).
# Este bloco append ao .bashrc com late-binding: garante que as configurações
# corretas persistam após rebuilds, ganhando de qualquer valor anterior.
#
# Itens:
#   • HISTSIZE=10000   — sobrescreve padrão 1000 do base image
#   • HISTFILESIZE=20000
#   • HISTTIMEFORMAT  — timestamps para rastreio de comandos pós-crash
#   • ulimit -S -s unlimited — expande stack de 8 MB (padrão bash) p/ ilimitado
#     (hard limit já é unlimited; previne stack overflow em call-stacks profundos
#     do extension host e do Copilot agent durante sessões intensas)
# =============================================================================
RUN cat >> "${HOME_DIR}/.bashrc" <<'BASH_HARDENING'

# === DevContainer bash hardening (v1.0 — appended by Dockerfile) ===
# Applied last in .bashrc → these always win over profile.d (20-devcontainer-ux.sh)
# and the base-image defaults. Do NOT remove — needed for DevContainer stability.
HISTSIZE=10000
HISTFILESIZE=20000
HISTTIMEFORMAT="%F %T "
# Expand soft stack limit from 8 MB (bash default) to unlimited.
# Hard limit is already unlimited; prevents stack overflow in deep
# Node.js/Copilot agent call-stacks during intensive coding sessions.
ulimit -S -s unlimited 2>/dev/null || true
BASH_HARDENING



#
# Regras:
#   • ENTRYPOINT = dumb-init + nss-gatekeeper
#   • CMD default = "sleep infinity" (container fica vivo para VS Code)
#   • USER = ${USER_NAME}
# =============================================================================
USER ${USER_NAME}
WORKDIR ${APP_DIR}

ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/nss-gatekeeper"]
CMD ["sleep", "infinity"]

# =============================================================================
# FINAL NOTES (v1.0)
#   - dockerd NÃO é instalado
#   - Docker CLI opera via socket do host (bind mount)
#   - NSS wrapper é ativado em runtime pelo entrypoint/profile e refinado pelos hooks
#   - Contratos de shell em /etc/profile.d são read-only
# =============================================================================
