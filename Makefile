# =============================================================================
# Makefile — ChatGPT Docker Puppeteer (DEV / PM2-First / Bootstrap-Ready)
# =============================================================================
# PRINCÍPIOS CANÔNICOS:
# • Ambiente de DESENVOLVIMENTO (DEV), não produção
# • Makefile é o ÁRBITRO do sistema, não o criador da infra
# • Bootstrap ≠ Runtime ≠ Health
# • PM2 é crítico, mas NÃO presumido
# • Health system ainda NÃO existe (placeholder explícito)
# • Compatível com Docker / DevContainer do zero
#
# Versão: 3.0.0
# Data:   2026-01-26
# =============================================================================

.DEFAULT_GOAL := help

# =============================================================================
# CORES (ANSI — funcionam em Linux, macOS, Git Bash, VS Code)
# =============================================================================

RED     = \033[0;31m
GREEN   = \033[0;32m
YELLOW  = \033[1;33m
BLUE    = \033[0;34m
CYAN    = \033[0;36m
MAGENTA = \033[0;35m
NC      = \033[0m

# =============================================================================
# FERRAMENTAS CANÔNICAS
# =============================================================================

NODE := node
NPM  := npm
PM2  := npx pm2
CURL := curl

# =============================================================================
# DETECÇÃO DE PLATAFORMA
# =============================================================================

ifeq ($(OS),Windows_NT)
	PLATFORM := Windows
	SHELL_CMD := cmd /C
else
	UNAME_S := $(shell uname -s 2>/dev/null || echo Linux)
	ifeq ($(UNAME_S),Darwin)
		PLATFORM := macOS
	else
		PLATFORM := Linux
	endif
	SHELL_CMD := bash -c
endif

# =============================================================================
# HELP / IDENTIDADE
# =============================================================================

help:
	@echo ""
	@echo "$(CYAN)╔════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(CYAN)║  ChatGPT Docker Puppeteer — Makefile v3.0 (DEV)            ║$(NC)"
	@echo "$(CYAN)║  PM2-First • Bootstrap-Ready • Health Placeholder          ║$(NC)"
	@echo "$(CYAN)╚════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(GREEN)🚀 Primeiros passos (ambiente do zero):$(NC)"
	@echo "  make info"
	@echo "  make bootstrap"
	@echo "  make install-deps"
	@echo ""
	@echo "$(GREEN)▶️  Execução:$(NC)"
	@echo "  make start        Inicia o sistema (PM2)"
	@echo "  make status       Status do runtime"
	@echo "  make logs         Logs do sistema"
	@echo ""
	@echo "$(YELLOW)🏥 Health:$(NC)"
	@echo "  make health       (placeholder — em construção)"
	@echo ""
	@echo "$(BLUE)🧪 Testes:$(NC)"
	@echo "  make test         Testes lógicos"
	@echo "  make test-integration"
	@echo ""
	@echo "$(MAGENTA)🛠️  Manutenção:$(NC)"
	@echo "  make clean"
	@echo "  make workspace-clean"
	@echo ""
	@echo "$(CYAN)💻 Plataforma detectada: $(PLATFORM)$(NC)"
	@echo ""

# =============================================================================
# INFO (sempre seguro)
# =============================================================================

info:
	@echo "$(CYAN)ℹ️  Informações do ambiente$(NC)"
	@echo "  Plataforma: $(PLATFORM)"
	@echo "  Node: $$($(NODE) --version 2>/dev/null || echo 'não instalado')"
	@echo "  npm:  $$($(NPM) --version 2>/dev/null || echo 'não instalado')"
	@echo "  PM2:  $$($(PM2) --version 2>/dev/null || echo 'não disponível')"
	@echo "  Diretório: $$(pwd)"
	@echo ""

version:
	@echo "Makefile v3.0.0 — DEV / Bootstrap-Ready"

# =============================================================================
# 1️⃣ DESCOBERTA DE AMBIENTE (somente leitura)
# =============================================================================

env: check-os check-node check-npm check-git check-pm2

check-os:
	@echo "$(CYAN)🔍 OS: $(PLATFORM)$(NC)"

check-node:
	@command -v $(NODE) >/dev/null 2>&1 \
		&& echo "$(GREEN)✓ Node encontrado$(NC)" \
		|| echo "$(RED)✗ Node não encontrado$(NC)"

check-npm:
	@command -v $(NPM) >/dev/null 2>&1 \
		&& echo "$(GREEN)✓ npm encontrado$(NC)" \
		|| echo "$(RED)✗ npm não encontrado$(NC)"

check-git:
	@command -v git >/dev/null 2>&1 \
		&& echo "$(GREEN)✓ Git encontrado$(NC)" \
		|| echo "$(RED)✗ Git não encontrado$(NC)"

check-pm2:
	@command -v pm2 >/dev/null 2>&1 \
		&& echo "$(GREEN)✓ PM2 global disponível$(NC)" \
		|| echo "$(YELLOW)⚠ PM2 não instalado globalmente (ok)$(NC)"

# =============================================================================
# 2️⃣ BOOTSTRAP (zero-assumption)
# =============================================================================

bootstrap: bootstrap-node bootstrap-pm2 bootstrap-workspace bootstrap-git
	@echo "$(GREEN)✅ Bootstrap estrutural concluído$(NC)"

bootstrap-node:
	@echo "$(CYAN)🔧 Verificando Node/npm...$(NC)"
	@command -v $(NODE) >/dev/null 2>&1 || { echo "$(RED)Node ausente$(NC)"; exit 1; }
	@command -v $(NPM)  >/dev/null 2>&1 || { echo "$(RED)npm ausente$(NC)"; exit 1; }

bootstrap-pm2:
	@echo "$(CYAN)🔧 Verificando PM2...$(NC)"
	@command -v pm2 >/dev/null 2>&1 \
		&& echo "$(GREEN)PM2 global disponível$(NC)" \
		|| echo "$(YELLOW)PM2 será usado via npx (recomendado)$(NC)"

bootstrap-workspace:
	@echo "$(CYAN)📁 Preparando workspace...$(NC)"
	@mkdir -p logs
	@echo "$(GREEN)Workspace OK$(NC)"

bootstrap-git:
	@echo "$(CYAN)🔧 Verificando Git...$(NC)"
	@command -v git >/dev/null 2>&1 || { echo "$(RED)Git ausente$(NC)"; exit 1; }

# =============================================================================
# 3️⃣ DEPENDÊNCIAS DO PROJETO
# =============================================================================

install-deps:
	@echo "$(GREEN)📦 Instalando dependências do projeto$(NC)"
	@$(NPM) ci

deps-consistency:
	@echo "$(CYAN)🔍 Verificando consistência do lockfile$(NC)"
	@$(NPM) ci --dry-run --quiet

update-deps:
	@echo "$(YELLOW)🔄 Dependências desatualizadas$(NC)"
	@$(NPM) outdated || true

workspace-clean:
	@echo "$(RED)🧹 Limpeza profunda do workspace$(NC)"
	@rm -rf node_modules
	@$(NPM) cache clean --force
	@$(NPM) ci

# =============================================================================
# 4️⃣ RUNTIME OPERACIONAL (PM2 / daemon)
# =============================================================================

ensure-pm2:
	@command -v pm2 >/dev/null 2>&1 || echo "$(YELLOW)Usando PM2 via npx$(NC)"

start: ensure-pm2
	@echo "$(GREEN)🚀 Iniciando sistema (PM2)$(NC)"
	@$(NPM) run daemon:start

stop:
	@echo "$(YELLOW)⏹️  Parando sistema$(NC)"
	@$(NPM) run daemon:stop || true

restart: stop start

reload:
	@echo "$(YELLOW)♻️  Reload do sistema$(NC)"
	@$(NPM) run daemon:reload

status:
	@echo "$(CYAN)📊 Status do runtime$(NC)"
	@$(NPM) run daemon:status || true

# =============================================================================
# 5️⃣ HEALTH (PLACEHOLDER CANÔNICO)
# =============================================================================

health:
	@echo "$(YELLOW)🏥 Health system ainda NÃO implementado$(NC)"
	@echo "Use: make status / make logs"

health-core: health

# =============================================================================
# 6️⃣ LOGS & OBSERVABILIDADE
# =============================================================================

logs:
	@echo "$(CYAN)📜 Logs do sistema$(NC)"
	@$(NPM) run daemon:logs || true

# =============================================================================
# 7️⃣ TESTES
# =============================================================================

test:
	@echo "$(GREEN)🧪 Testes lógicos$(NC)"
	@$(NPM) test

test-integration:
	@echo "$(GREEN)🧪 Testes de integração$(NC)"
	@$(NPM) run test:integration

test-all: test test-integration

# =============================================================================
# 8️⃣ MANUTENÇÃO
# =============================================================================

clean:
	@echo "$(YELLOW)🧹 Limpando arquivos temporários$(NC)"
	@rm -rf logs/*.log 2>/dev/null || true

rebuild: clean workspace-clean start

# =============================================================================
# 9️⃣ VS CODE & DEV EXPERIENCE
# =============================================================================

vscode-info:
	@echo "$(CYAN)📊 VS Code — status$(NC)"
	@ls .vscode 2>/dev/null || echo "Sem .vscode/"

reload-vscode:
	@echo "$(YELLOW)🔄 VS Code: Reload Window$(NC)"

# =============================================================================
# 🔟 GIT & QUALIDADE
# =============================================================================

git-changed:
	@git status --short

format-code:
	@npx prettier --write .

lint:
	@npx eslint . --quiet

lint-fix:
	@npx eslint . --fix

git-push-safe:
	@git status --porcelain | grep . && { echo "Há alterações não commitadas"; exit 1; } || true
	@$(MAKE) lint
	@$(MAKE) test
	@git push

# =============================================================================
# ALIASES
# =============================================================================

s: start
st: stop
r: restart
h: health
l: logs
t: test
i: info
v: vscode-info
g: git-changed

# Check bindings (0.0.0.0) - runs static + runtime checks
check-bindings:
	@echo "Running bindings verification..."
	@bash ./scripts/check-all-bindings.sh
