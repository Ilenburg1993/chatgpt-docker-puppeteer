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
#   4) Multi-estágio: deps-prod → dashboard-builder → production
#   5) Segurança: sem secrets no build, sem ferramentas de dev na imagem final
#
# STAGES:
#   deps-prod         — instala dependências de produção (omit=dev)
#   dashboard-builder — instala todas as deps + compila o dashboard Vite
#   production        — imagem final mínima (deps + dist + código)
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
# VERSÃO: 1.1.0
# =============================================================================

# =============================================================================
# STAGE 1 — deps-prod: instala apenas dependências de produção
# =============================================================================
FROM node:24-bookworm-slim AS deps-prod

WORKDIR /app

# Copia apenas manifests para aproveitar o cache do Docker
COPY package.json package-lock.json ./

# Instala apenas dependências de produção
# PUPPETEER_SKIP_DOWNLOAD: não baixar Chromium (usamos Chrome externo via CDP)
RUN PUPPETEER_SKIP_DOWNLOAD=true \
    npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# =============================================================================
# STAGE 2 — dashboard-builder: compila o dashboard Vue/Vite
#
# O servidor em produção serve o dashboard a partir de src/dashboard-ui/dist.
# Como dist/ está no .gitignore e .dockerignore, é necessário compilar aqui.
# Este stage instala ALL deps (incluindo devDependencies) para ter Vite disponível.
# =============================================================================
FROM node:24-bookworm-slim AS dashboard-builder

WORKDIR /app

# Copia manifests raiz e do workspace para instalar todas as deps
COPY package.json package-lock.json ./
COPY src/dashboard-ui/package.json src/dashboard-ui/

# Instala todas as dependências (incluindo devDependencies do workspace Vite)
# PUPPETEER_SKIP_DOWNLOAD: evita download desnecessário de Chromium no builder
RUN PUPPETEER_SKIP_DOWNLOAD=true \
    npm ci --no-audit --no-fund \
    && npm cache clean --force

# Copia o código-fonte do dashboard para compilar
COPY src/dashboard-ui/ src/dashboard-ui/

# Compila o dashboard (saída em src/dashboard-ui/dist)
RUN npm run dashboard:build

# =============================================================================
# STAGE 3 — production: imagem final mínima
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

# Copia dependências de produção do stage deps-prod
COPY --from=deps-prod --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copia o dashboard compilado do stage dashboard-builder
# (src/dashboard-ui/dist é servido pelo servidor em /dashboard)
COPY --from=dashboard-builder --chown=nodejs:nodejs /app/src/dashboard-ui/dist ./src/dashboard-ui/dist

# Copia o código da aplicação (excluindo o que está no .dockerignore)
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
