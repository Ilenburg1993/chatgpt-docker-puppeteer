###############################################################################
# builder.inc
# -----------------------------------------------------------------------------
# Responsabilidade:
# - Compilar dependências nativas
# - Instalar dependências Node.js
# - Executar build do projeto (se existir)
# - Produzir artefatos autocontidos em /build/output
#
# NÃO FAZ:
# - Configuração de runtime
# - Criação de usuários
# - Ajustes de permissões
# - Setup de workspace
###############################################################################

FROM ${BASE_IMAGE} AS builder

# ----------------------------
# Diretório isolado de build
# ----------------------------
WORKDIR /build

# ----------------------------
# Toolchains (somente builder)
# ----------------------------
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        build-essential \
        python3 \
        python3-dev \
        python-is-python3 \
        make \
        g++; \
    rm -rf /var/lib/apt/lists/*

# ----------------------------
# Copiar manifestos npm
# (cache-friendly)
# ----------------------------
COPY package.json package-lock.json* ./

# ----------------------------
# Instalar dependências Node.js
# ----------------------------
RUN set -eux; \
    if [ ! -f package.json ]; then \
        echo "[builder] ERRO: package.json não encontrado"; \
        exit 1; \
    fi; \
    if [ -f package-lock.json ]; then \
        npm ci --no-audit --no-fund; \
    else \
        npm install --no-audit --no-fund; \
    fi

# ----------------------------
# Copiar código-fonte
# (explicitamente após deps)
# ----------------------------
COPY . .

# ----------------------------
# Executar build do projeto
# (se existir)
# ----------------------------
RUN set -eux; \
    if npm pkg get scripts.build >/dev/null 2>&1; then \
        npm run build; \
    else \
        echo "[builder] Nenhum script de build definido — pulando"; \
    fi

# ----------------------------
# Normalizar artefatos
# ----------------------------
RUN set -eux; \
    mkdir -p /build/output; \
    if [ -d node_modules ]; then \
        cp -a node_modules /build/output/; \
    fi; \
    if [ -d dist ]; then \
        cp -a dist /build/output/; \
    fi
