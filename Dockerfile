# =============================================================================
# Dockerfile — ChatGPT Docker Puppeteer (PRODUÇÃO)
# Base: Node.js 24 Debian Bookworm Slim
#
# OBJETIVO:
#   Imagem de produção mínima e segura para executar o runtime da aplicação.
#   Este Dockerfile é diferente do .devcontainer/Dockerfile (que é para dev).
#
# PRINCÍPIOS:
#   1) Imagem mínima: apenas o necessário para executar node index.js
#   2) Usuário não-root: corre como "nodejs" (UID 1001)
#   3) Chrome externo: PUPPETEER_SKIP_DOWNLOAD=true (usa CDP para Chrome externo)
#   4) Multi-estágio: separa deps, build e runtime para cache otimizado
#   5) Segurança: sem secrets no build, sem ferramentas de dev
#
# USO:
#   docker build -t chatgpt-docker-puppeteer .
#   docker run -p 3008:3008 --env-file .env chatgpt-docker-puppeteer
#
# PORTA:
#   3008 — Dashboard/API (configurável via PORT env var)
#
# VARIÁVEIS REQUERIDAS EM RUNTIME:
#   Ver .env.example para a lista completa de variáveis de ambiente.
#   Mínimo: CHROME_REMOTE_URL (URL do Chrome externo via CDP)
#
# VERSÃO: 1.0.0
# =============================================================================

# =============================================================================
# STAGE 1 — deps: instala apenas dependências de produção
# =============================================================================
FROM node:24-bookworm-slim AS deps

# Metadados OCI
LABEL org.opencontainers.image.title="ChatGPT Docker Puppeteer (deps)"
LABEL org.opencontainers.image.description="Dependency installation stage"

WORKDIR /app

# Copia apenas manifests para aproveitar o cache do Docker
COPY package.json package-lock.json ./

# Instala apenas dependências de produção
# PUPPETEER_SKIP_DOWNLOAD: não baixar Chromium (usamos Chrome externo via CDP)
RUN PUPPETEER_SKIP_DOWNLOAD=true \
    npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# =============================================================================
# STAGE 2 — production: imagem final mínima
# =============================================================================
FROM node:24-bookworm-slim AS production

# Metadados OCI (https://github.com/opencontainers/image-spec)
LABEL org.opencontainers.image.title="ChatGPT Docker Puppeteer"
LABEL org.opencontainers.image.description="Autonomous AI agent for browser automation with Puppeteer"
LABEL org.opencontainers.image.url="https://github.com/Ilenburg1993/chatgpt-docker-puppeteer"
LABEL org.opencontainers.image.source="https://github.com/Ilenburg1993/chatgpt-docker-puppeteer"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.base.name="node:24-bookworm-slim"

# Instala dumb-init para gestão adequada de sinais POSIX (PID 1)
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Cria usuário não-root para execução segura
RUN groupadd --gid 1001 nodejs \
    && useradd --uid 1001 --gid nodejs --shell /bin/sh --create-home nodejs

WORKDIR /app

# Copia dependências do stage anterior
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copia o código da aplicação
# Não copia: .env*, node_modules, dist, logs, fila, backups (ver .dockerignore)
COPY --chown=nodejs:nodejs . .

# Variáveis de ambiente de produção
ENV NODE_ENV=production \
    # Porta padrão do dashboard/API
    PORT=3008 \
    # Não baixar Chromium — usa Chrome externo via CDP
    PUPPETEER_SKIP_DOWNLOAD=true \
    # Desabilita telemetria do npm
    DISABLE_OPENCOLLECTIVE=true \
    # Node.js: sem aviso de deprecation desnecessário
    NODE_NO_WARNINGS=1

# Expõe a porta do dashboard/API
EXPOSE 3008

# Healthcheck: verifica se o servidor HTTP está respondendo
# O script scripts/docker-healthcheck.js é mais legível e testável que inline JS
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node scripts/docker-healthcheck.js

# Troca para usuário não-root
USER nodejs

# Usa dumb-init como PID 1 para gestão adequada de sinais
# Inicia a aplicação via index.js (entry point canônico)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
