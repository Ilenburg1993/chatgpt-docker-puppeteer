###############################################################################
# docker/runtime.inc
# -----------------------------------------------------------------------------
# Estágio de RUNTIME do DevContainer
#
# Responsabilidades exclusivas:
# - Criar usuário não-root (node)
# - Preparar diretórios do workspace
# - Copiar node_modules prontos do builder
# - Instalar utilitários de desenvolvimento (runtime)
# - Preparar ambiente para VS Code Dev Containers
#
# NÃO:
# - Instala dependências de build
# - Executa scripts do projeto
# - Assume bind mount ativo
###############################################################################

FROM base AS runtime

###############################################################################
# ARGUMENTOS
###############################################################################
ARG PROJECT_NAME=chatgpt-docker-puppeteer
ARG USERNAME=node
ARG USER_UID=1000
ARG USER_GID=1000

###############################################################################
# USUÁRIO NÃO-ROOT
###############################################################################
RUN set -eux; \
    if ! getent group "${USERNAME}" >/dev/null; then \
        groupadd --gid "${USER_GID}" "${USERNAME}"; \
    fi; \
    if ! id -u "${USERNAME}" >/dev/null 2>&1; then \
        useradd \
            --uid "${USER_UID}" \
            --gid "${USER_GID}" \
            --create-home \
            --shell /bin/bash \
            "${USERNAME}"; \
    fi

###############################################################################
# ESTRUTURA DO WORKSPACE
###############################################################################
WORKDIR /workspaces/${PROJECT_NAME}

RUN set -eux; \
    mkdir -p /workspaces/${PROJECT_NAME}; \
    chown -R ${USERNAME}:${USERNAME} /workspaces

###############################################################################
# DEPENDÊNCIAS DE RUNTIME (DEV UTILITIES)
###############################################################################
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        git \
        curl \
        wget \
        ca-certificates \
        procps \
        less \
        tree \
        jq \
        openssh-client \
        bash-completion \
        tzdata \
        locales \
        sudo \
        dumb-init; \
    \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

###############################################################################
# LOCALES
###############################################################################
RUN set -eux; \
    sed -i 's/^# *\(en_US.UTF-8 UTF-8\)/\1/' /etc/locale.gen; \
    sed -i 's/^# *\(pt_BR.UTF-8 UTF-8\)/\1/' /etc/locale.gen; \
    locale-gen

ENV LANG=pt_BR.UTF-8 \
    LC_ALL=pt_BR.UTF-8

###############################################################################
# NODE_MODULES (COPIADOS DO BUILDER)
###############################################################################
COPY --from=builder \
     --chown=${USERNAME}:${USERNAME} \
     /workspace_node_modules/node_modules \
     /workspaces/${PROJECT_NAME}/node_modules

###############################################################################
# SUDO (DEV FRIENDLY)
###############################################################################
RUN set -eux; \
    echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME}; \
    chmod 0440 /etc/sudoers.d/${USERNAME}

###############################################################################
# VARIÁVEIS DE AMBIENTE
###############################################################################
ENV NODE_ENV=development \
    DEVCONTAINER=true \
    CONTAINER_SCRIPTS_PATH=/usr/local/bin

###############################################################################
# ENTRYPOINT
###############################################################################
ENTRYPOINT ["dumb-init", "--"]
CMD ["bash"]
