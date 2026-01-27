# =============================================================================
# base.inc — Camada Base do Sistema
# -----------------------------------------------------------------------------
# Função:
#   Fundamento sistêmico estável do container.
#   Instala dependências do sistema, bibliotecas gráficas e utilitários
#   estruturais, SEM executar binários, SEM validação ativa e SEM decisões
#   de aplicação.
#
# Contrato:
#   - Não executa Chromium, Node ou qualquer binário instalado
#   - Não cria usuário
#   - Não define variáveis de aplicação (Puppeteer, Playwright, etc.)
#   - Não faz diagnóstico nem healthcheck
# =============================================================================




# -----------------------------------------------------------------------------
# Metadados básicos
# -----------------------------------------------------------------------------
ARG BUILD_DATE=unknown
ARG VCS_REF=unknown

LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.title="Base System Layer"

# -----------------------------------------------------------------------------
# Ambiente sistêmico
# -----------------------------------------------------------------------------
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=pt_BR.UTF-8 \
    LC_ALL=pt_BR.UTF-8 \
    TZ=America/Sao_Paulo

# -----------------------------------------------------------------------------
# Timezone e locale (sem interação)
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
# Dependências sistêmicas e bibliotecas gráficas
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
        \
        # Chromium (somente instalação, sem execução)
        chromium \
        \
        # Bibliotecas gráficas e de runtime (headless)
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
        # Fontes mínimas
        fonts-liberation \
        fonts-noto-color-emoji; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# -----------------------------------------------------------------------------
# Normalizações passivas
# -----------------------------------------------------------------------------
# Garantia de existência de diretórios fundamentais
RUN set -eux; \
    mkdir -p /usr/local/bin /var/log; \
    true

# -----------------------------------------------------------------------------
# ENTRYPOINT neutro (não inicia processos de aplicação)
# -----------------------------------------------------------------------------
ENTRYPOINT ["dumb-init", "--"]
