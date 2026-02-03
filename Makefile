# =============================================================================
# Makefile — ChatGPT Docker Puppeteer (DEV / PM2-First / Production-Ready)
# =============================================================================
# PRINCÍPIOS CANÔNICOS:
# • Ambiente de DESENVOLVIMENTO (DEV), não produção
# • Makefile é o ÁRBITRO do sistema, não o criador da infra
# • Bootstrap ≠ Runtime ≠ Health
# • PM2 é crítico, mas NÃO presumido
# • Compatível com Docker / DevContainer do zero
# • Alinhado com package.json scripts (95% coverage)
#
# Versão: 4.0.0
# Data:   2026-02-02
# Changelog v4.0:
#   - Adicionados 40+ novos targets (70+ total)
#   - Adicionadas declarações .PHONY (segurança)
#   - Novos targets: análise, queue, testes, manutenção, VS Code, dev
#   - Melhoradas mensagens de feedback (✅/❌)
#   - Novos aliases (q, m, d, a)
#   - Help menu reorganizado com BOLD
# =============================================================================

.DEFAULT_GOAL := help
.PHONY: help info version

# =============================================================================
# CORES (ANSI — funcionam em Linux, macOS, Git Bash, VS Code)
# =============================================================================

RED     = \033[0;31m
GREEN   = \033[0;32m
YELLOW  = \033[1;33m
BLUE    = \033[0;34m
CYAN    = \033[0;36m
MAGENTA = \033[0;35m
BOLD    = \033[1m
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
	@echo "$(CYAN)║  ChatGPT Docker Puppeteer — Makefile v4.0 (DEV)            ║$(NC)"
	@echo "$(CYAN)║  PM2-First • Bootstrap-Ready • Production-Ready             ║$(NC)"
	@echo "$(CYAN)╚════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(GREEN)$(BOLD)🚀 Primeiros passos:$(NC)"
	@echo "  $(CYAN)make info$(NC)              Informações do ambiente"
	@echo "  $(CYAN)make bootstrap$(NC)         Preparar workspace"
	@echo "  $(CYAN)make install-deps$(NC)      Instalar dependências"
	@echo ""
	@echo "$(GREEN)$(BOLD)▶️  Execução & Runtime:$(NC)"
	@echo "  $(CYAN)make start$(NC)             Inicia o sistema (PM2)"
	@echo "  $(CYAN)make stop$(NC)              Para o sistema"
	@echo "  $(CYAN)make restart$(NC)           Reinicia"
	@echo "  $(CYAN)make reload$(NC)            Reload sem downtime"
	@echo "  $(CYAN)make status$(NC)            Status do runtime"
	@echo "  $(CYAN)make logs$(NC)              Logs (últimas 50 linhas)"
	@echo "  $(CYAN)make logs-follow$(NC)       Logs em tempo real"
	@echo "  $(CYAN)make monit$(NC)             Dashboard PM2"
	@echo ""
	@echo "$(YELLOW)$(BOLD)🏥 Health & Validação:$(NC)"
	@echo "  $(CYAN)make health$(NC)            Health check PM2"
	@echo "  $(CYAN)make pm2-check$(NC)         Check completo (6 validações)"
	@echo "  $(CYAN)make pm2-startup$(NC)       Startup seguro"
	@echo "  $(CYAN)make validate$(NC)          Validar config.json"
	@echo "  $(CYAN)make validate-all$(NC)      Validação completa (lint+test)"
	@echo "  $(CYAN)make validate-env$(NC)      Validar arquivos .env"
	@echo "  $(CYAN)make validate-git$(NC)      Validar configurações Git"
	@echo ""
	@echo "$(BLUE)$(BOLD)📊 Análise & Code Quality:$(NC)"
	@echo "  $(CYAN)make analyze-deps$(NC)      Dependências circulares"
	@echo "  $(CYAN)make analyze-graph$(NC)     Análise de código"
	@echo "  $(CYAN)make analyze-full$(NC)      Análise completa"
	@echo "  $(CYAN)make analyze-circular$(NC)  Deps circulares"
	@echo "  $(CYAN)make analyze-orphans$(NC)   Arquivos órfãos"
	@echo ""
	@echo "$(MAGENTA)$(BOLD)📦 Queue Management:$(NC)"
	@echo "  $(CYAN)make queue-status$(NC)      Status da fila"
	@echo "  $(CYAN)make queue-add$(NC)         Adicionar tarefa"
	@echo "  $(CYAN)make queue-flow$(NC)        Flow manager"
	@echo "  $(CYAN)make queue-clean$(NC)       Limpar fila"
	@echo ""
	@echo "$(GREEN)$(BOLD)🧪 Testes:$(NC)"
	@echo "  $(CYAN)make test$(NC)              Testes completos"
	@echo "  $(CYAN)make test-unit$(NC)         Testes unitários"
	@echo "  $(CYAN)make test-integration$(NC)  Testes de integração"
	@echo "  $(CYAN)make test-e2e$(NC)          Testes E2E"
	@echo "  $(CYAN)make test-coverage$(NC)     Com coverage"
	@echo ""
	@echo "$(YELLOW)$(BOLD)🎨 Formatação & Lint:$(NC)"
	@echo "  $(CYAN)make format$(NC)            Formatar código (Prettier)"
	@echo "  $(CYAN)make format-check$(NC)      Verificar formatação"
	@echo "  $(CYAN)make lint$(NC)              Linting (ESLint)"
	@echo "  $(CYAN)make lint-fix$(NC)          Fix automático"
	@echo ""
	@echo "$(MAGENTA)$(BOLD)🛠️  Manutenção:$(NC)"
	@echo "  $(CYAN)make clean$(NC)             Limpar temporários"
	@echo "  $(CYAN)make maintenance$(NC)       Manutenção Puppeteer"
	@echo "  $(CYAN)make profiles-rotate$(NC)   Rotacionar profiles"
	@echo "  $(CYAN)make diagnose$(NC)          Diagnosticar crashes"
	@echo "  $(CYAN)make validate-git$(NC)      Validar Git configs"
	@echo ""
	@echo "$(BLUE)$(BOLD)🖥️  Dev & Tools:$(NC)"
	@echo "  $(CYAN)make dev$(NC)               Modo desenvolvimento"
	@echo "  $(CYAN)make quick-test$(NC)        Lint + test rápido"
	@echo "  $(CYAN)make check-chrome$(NC)      Verificar Chrome"
	@echo "  $(CYAN)make git-push-safe$(NC)     Push seguro (5 validações)"
	@echo ""
	@echo "$(CYAN)$(BOLD)💻 Plataforma:$(NC) $(PLATFORM)  $(CYAN)$(BOLD)📁 Aliases:$(NC) s st r h l t i v g $(BOLD)q m d a$(NC)"
	@echo ""

# =============================================================================
# INFO (sempre seguro)
# =============================================================================

info:
	@echo "$(CYAN)ℹ️  Informações do ambiente$(NC)"
	@echo "  Plataforma: $(BOLD)$(PLATFORM)$(NC)"
	@echo "  Node: $(GREEN)$$($(NODE) --version 2>/dev/null || echo 'não instalado')$(NC)"
	@echo "  npm:  $(GREEN)$$($(NPM) --version 2>/dev/null || echo 'não instalado')$(NC)"
	@echo "  PM2:  $(GREEN)$$($(PM2) --version 2>/dev/null || echo 'não disponível')$(NC)"
	@echo "  Diretório: $(BOLD)$$(pwd)$(NC)"
	@echo "  Makefile: $(BOLD)v4.0.0$(NC)"
	@echo ""
	@echo "$(YELLOW)Novos pacotes (v4.0):$(NC)"
	@echo "  • $(GREEN)chalk$(NC) (^4.1.2) - Terminal colors"
	@echo "  • $(GREEN)dotenv$(NC) (^16.6.1) - ENV loader"
	@echo "  • $(GREEN)winston$(NC) (^3.19.0) - Logger estruturado"
	@echo ""

version:
	@echo "Makefile v4.0.0 — DEV / Bootstrap-Ready / Production-Ready"
	@echo "Data: 2026-02-02"
	@echo "Targets: 70+ | Aliases: 13 | Coverage: 95%"

# =============================================================================
# 1️⃣ DESCOBERTA DE AMBIENTE (somente leitura)
# =============================================================================

.PHONY: env check-os check-node check-npm check-git check-pm2

env: check-os check-node check-npm check-git check-pm2

check-os:
	@echo "$(CYAN)🔍 OS: $(PLATFORM)$(NC)"

check-node:
	@command -v $(NODE) >/dev/null 2>&1 \
		&& echo "$(GREEN)✓ Node encontrado: $$($(NODE) --version)$(NC)" \
		|| echo "$(RED)✗ Node não encontrado$(NC)"

check-npm:
	@command -v $(NPM) >/dev/null 2>&1 \
		&& echo "$(GREEN)✓ npm encontrado: $$($(NPM) --version)$(NC)" \
		|| echo "$(RED)✗ npm não encontrado$(NC)"

check-git:
	@command -v git >/dev/null 2>&1 \
		&& echo "$(GREEN)✓ Git encontrado: $$(git --version)$(NC)" \
		|| echo "$(RED)✗ Git não encontrado$(NC)"

check-pm2:
	@command -v pm2 >/dev/null 2>&1 \
		&& echo "$(GREEN)✓ PM2 global disponível: $$(pm2 --version)$(NC)" \
		|| echo "$(YELLOW)⚠ PM2 não instalado globalmente (usará npx)$(NC)"

# =============================================================================
# 2️⃣ BOOTSTRAP (zero-assumption)
# =============================================================================

.PHONY: bootstrap bootstrap-node bootstrap-pm2 bootstrap-workspace bootstrap-git

bootstrap: bootstrap-node bootstrap-pm2 bootstrap-workspace bootstrap-git
	@echo "$(GREEN)✅ Bootstrap estrutural concluído$(NC)"

bootstrap-node:
	@echo "$(CYAN)🔧 Verificando Node/npm...$(NC)"
	@command -v $(NODE) >/dev/null 2>&1 || { echo "$(RED)✗ Node ausente$(NC)"; exit 1; }
	@command -v $(NPM)  >/dev/null 2>&1 || { echo "$(RED)✗ npm ausente$(NC)"; exit 1; }
	@echo "$(GREEN)✓ Node/npm OK$(NC)"

bootstrap-pm2:
	@echo "$(CYAN)🔧 Verificando PM2...$(NC)"
	@command -v pm2 >/dev/null 2>&1 \
		&& echo "$(GREEN)✓ PM2 global disponível$(NC)" \
		|| echo "$(YELLOW)⚠ PM2 será usado via npx (recomendado)$(NC)"

bootstrap-workspace:
	@echo "$(CYAN)📁 Preparando workspace...$(NC)"
	@mkdir -p logs fila respostas missions
	@echo "$(GREEN)✓ Workspace OK (logs, fila, respostas, missions)$(NC)"

bootstrap-git:
	@echo "$(CYAN)🔧 Verificando Git...$(NC)"
	@command -v git >/dev/null 2>&1 || { echo "$(RED)✗ Git ausente$(NC)"; exit 1; }
	@echo "$(GREEN)✓ Git OK$(NC)"

# =============================================================================
# 3️⃣ DEPENDÊNCIAS DO PROJETO
# =============================================================================

.PHONY: install-deps deps-consistency update-deps workspace-clean

install-deps:
	@echo "$(GREEN)📦 Instalando dependências do projeto$(NC)"
	@$(NPM) ci
	@echo "$(GREEN)✅ Dependências instaladas$(NC)"

deps-consistency:
	@echo "$(CYAN)🔍 Verificando consistência do lockfile$(NC)"
	@$(NPM) ci --dry-run --quiet
	@echo "$(GREEN)✓ Lockfile consistente$(NC)"

update-deps:
	@echo "$(YELLOW)🔄 Dependências desatualizadas:$(NC)"
	@$(NPM) outdated || true

workspace-clean:
	@echo "$(RED)🧹 Limpeza profunda do workspace$(NC)"
	@rm -rf node_modules
	@$(NPM) cache clean --force
	@$(NPM) ci
	@echo "$(GREEN)✅ Workspace limpo e dependências reinstaladas$(NC)"

# =============================================================================
# 4️⃣ RUNTIME OPERACIONAL (PM2 / daemon)
# =============================================================================

.PHONY: ensure-pm2 start stop restart reload status logs logs-follow monit

ensure-pm2:
	@command -v pm2 >/dev/null 2>&1 || echo "$(YELLOW)Usando PM2 via npx$(NC)"

start: ensure-pm2
	@echo "$(GREEN)🚀 Iniciando sistema (PM2)$(NC)"
	@$(NPM) run daemon:start
	@echo "$(GREEN)✅ Sistema iniciado$(NC)"

stop:
	@echo "$(YELLOW)⏹️  Parando sistema$(NC)"
	@$(NPM) run daemon:stop || true
	@echo "$(GREEN)✅ Sistema parado$(NC)"

restart: stop
	@sleep 2
	@$(MAKE) start

reload:
	@echo "$(YELLOW)♻️  Reload do sistema (zero downtime)$(NC)"
	@$(NPM) run daemon:reload
	@echo "$(GREEN)✅ Sistema recarregado$(NC)"

status:
	@echo "$(CYAN)📊 Status do runtime$(NC)"
	@$(NPM) run daemon:status || true

logs-follow:
	@echo "$(CYAN)📜 Logs em tempo real (Ctrl+C para sair)$(NC)"
	@$(PM2) logs || true

monit:
	@echo "$(CYAN)📊 Dashboard PM2 (Ctrl+C para sair)$(NC)"
	@$(NPM) run daemon:monit || true

# =============================================================================
# 5️⃣ HEALTH (PM2 SOVEREIGN MODE)
# =============================================================================

.PHONY: health health-core pm2-check pm2-check-fix pm2-startup pm2-validate validate validate-all

health:
	@echo "$(CYAN)🏥 PM2 Health Check (Sovereign Mode)$(NC)"
	@bash scripts/pm2-check.sh || true

health-core: health

pm2-check:
	@bash scripts/pm2-check.sh

pm2-check-fix:
	@bash scripts/pm2-check.sh --fix

pm2-startup:
	@bash scripts/pm2-startup.sh

pm2-validate:
	@echo "$(CYAN)🔍 Validando configuração PM2 Sovereign...$(NC)"
	@grep -q 'SERVER_MODE.*split' ecosystem.config.js && echo "$(GREEN)✓ SERVER_MODE=split configurado$(NC)" || echo "$(RED)✗ SERVER_MODE não encontrado$(NC)"
	@grep -q 'SERVER_AUTHORITY.*standalone' ecosystem.config.js && echo "$(GREEN)✓ SERVER_AUTHORITY=standalone configurado$(NC)" || echo "$(RED)✗ SERVER_AUTHORITY não encontrado$(NC)"
	@grep -q 'DAEMON_MODE.*true' ecosystem.config.js && echo "$(GREEN)✓ DAEMON_MODE=true configurado$(NC)" || echo "$(RED)✗ DAEMON_MODE não encontrado$(NC)"

# =============================================================================
# 6️⃣ ANÁLISE & CODE QUALITY
# =============================================================================

.PHONY: analyze-deps analyze-deps-graph analyze-graph analyze-full analyze-circular analyze-orphans analyze-nerv

analyze-deps:
	@echo "$(CYAN)🔍 Análise de Dependências (circular)$(NC)"
	@$(NPM) run analyze:deps

analyze-deps-graph:
	@echo "$(CYAN)📊 Gerando gráfico de dependências (deps-graph.svg)$(NC)"
	@$(NPM) run analyze:deps:graph
	@echo "$(GREEN)✅ Gráfico gerado: deps-graph.svg$(NC)"

analyze-graph:
	@echo "$(CYAN)📊 Análise de Código (estatísticas)$(NC)"
	@$(NPM) run analyze:graph

analyze-full:
	@echo "$(CYAN)📊 Análise Completa (stats + circular + orphans + nerv)$(NC)"
	@$(NPM) run analyze:graph:full

analyze-circular:
	@echo "$(CYAN)🔍 Analisando dependências circulares$(NC)"
	@$(NPM) run analyze:circular

analyze-orphans:
	@echo "$(CYAN)🔍 Analisando arquivos órfãos$(NC)"
	@$(NPM) run analyze:orphans

analyze-nerv:
	@echo "$(CYAN)🔍 Analisando eventos NERV$(NC)"
	@$(NPM) run analyze:nerv

# =============================================================================
# 7️⃣ QUEUE MANAGEMENT
# =============================================================================

.PHONY: queue-status queue-add queue-import queue-graph queue-flow queue-clean

queue-status:
	@echo "$(CYAN)📊 Status da Fila$(NC)"
	@$(NPM) run queue:status

queue-add:
	@echo "$(GREEN)➕ Adicionar Tarefa à Fila$(NC)"
	@$(NPM) run queue:add

queue-import:
	@echo "$(CYAN)📥 Importar Prompts$(NC)"
	@$(NPM) run queue:import

queue-graph:
	@echo "$(CYAN)📊 Visualizar Fila (fila.dot)$(NC)"
	@$(NPM) run queue:graph
	@echo "$(GREEN)✅ Gráfico gerado: fila.dot$(NC)"

queue-flow:
	@echo "$(CYAN)🌊 Flow Manager$(NC)"
	@$(NPM) run queue:flow

queue-clean:
	@echo "$(YELLOW)🧹 Limpando fila$(NC)"
	@$(NPM) run clean:queue
	@echo "$(GREEN)✅ Fila limpa$(NC)"

# =============================================================================
# 8️⃣ LOGS & OBSERVABILIDADE
# =============================================================================

.PHONY: logs

logs:
	@echo "$(CYAN)📜 Logs do sistema (últimas 50 linhas)$(NC)"
	@$(NPM) run daemon:logs || true

# =============================================================================
# 9️⃣ TESTES
# =============================================================================

.PHONY: test test-unit test-integration test-e2e test-watch test-coverage test-all

test:
	@echo "$(GREEN)🧪 Testes Completos$(NC)"
	@$(NPM) test
	@echo "$(GREEN)✅ Testes passaram$(NC)"

test-unit:
	@echo "$(GREEN)🧪 Testes Unitários$(NC)"
	@$(NPM) run test:unit
	@echo "$(GREEN)✅ Testes unitários passaram$(NC)"

test-integration:
	@echo "$(GREEN)🧪 Testes de Integração$(NC)"
	@$(NPM) run test:integration
	@echo "$(GREEN)✅ Testes de integração passaram$(NC)"

test-e2e:
	@echo "$(GREEN)🧪 Testes E2E$(NC)"
	@$(NPM) run test:e2e
	@echo "$(GREEN)✅ Testes E2E passaram$(NC)"

test-watch:
	@echo "$(CYAN)👀 Testes em Modo Watch (Ctrl+C para sair)$(NC)"
	@$(NPM) run test:watch

test-coverage:
	@echo "$(CYAN)📊 Testes com Coverage$(NC)"
	@$(NPM) run test:coverage
	@echo "$(GREEN)✅ Coverage report gerado$(NC)"

test-all: test test-unit test-integration test-e2e

# =============================================================================
# 🔟 FORMATAÇÃO & LINT
# =============================================================================

.PHONY: format format-check lint lint-fix lint-quiet lint-report lint-src lint-tests

format:
	@echo "$(CYAN)🎨 Formatando código (Prettier)$(NC)"
	@$(NPM) run format
	@echo "$(GREEN)✅ Código formatado$(NC)"

format-check:
	@echo "$(CYAN)🔍 Verificando formatação$(NC)"
	@$(NPM) run format:check
	@echo "$(GREEN)✅ Formatação OK$(NC)"

lint:
	@echo "$(CYAN)🔍 Linting (ESLint)$(NC)"
	@$(NPM) run lint
	@echo "$(GREEN)✅ Lint passou$(NC)"

lint-fix:
	@echo "$(YELLOW)🔧 Corrigindo automaticamente (ESLint)$(NC)"
	@$(NPM) run lint:fix
	@echo "$(GREEN)✅ Correções aplicadas$(NC)"

lint-quiet:
	@echo "$(CYAN)🔍 Linting silencioso$(NC)"
	@$(NPM) run lint:quiet

lint-report:
	@echo "$(CYAN)📊 Gerando relatório ESLint$(NC)"
	@$(NPM) run lint:report
	@echo "$(GREEN)✅ Relatório gerado: logs/eslint-report.txt$(NC)"

lint-src:
	@echo "$(CYAN)🔍 Linting src/$(NC)"
	@$(NPM) run lint:src

lint-tests:
	@echo "$(CYAN)🔍 Linting tests/$(NC)"
	@$(NPM) run lint:tests

# =============================================================================
# 1️⃣1️⃣ MANUTENÇÃO & LIMPEZA
# =============================================================================

.PHONY: clean clean-logs clean-queue maintenance maintenance-clean-cache profiles-rotate profiles-stats diagnose rebuild validate-git validate-powershell-bom

clean:
	@echo "$(YELLOW)🧹 Limpando arquivos temporários$(NC)"
	@$(NPM) run clean
	@echo "$(GREEN)✅ Limpeza concluída$(NC)"

clean-logs:
	@echo "$(YELLOW)🧹 Limpando logs$(NC)"
	@$(NPM) run clean:logs
	@echo "$(GREEN)✅ Logs limpos$(NC)"

clean-queue: queue-clean

maintenance:
	@echo "$(CYAN)🔧 Manutenção Puppeteer$(NC)"
	@$(NPM) run maintenance

maintenance-clean-cache:
	@echo "$(YELLOW)🧹 Limpando cache Puppeteer$(NC)"
	@$(NPM) run maintenance:clean-cache
	@echo "$(GREEN)✅ Cache limpo$(NC)"

profiles-rotate:
	@echo "$(CYAN)🔄 Rotacionando profiles$(NC)"
	@$(NPM) run profiles:rotate

profiles-stats:
	@echo "$(CYAN)📊 Estatísticas de profiles$(NC)"
	@$(NPM) run profiles:stats

diagnose:
	@echo "$(CYAN)🔍 Diagnosticando crashes$(NC)"
	@$(NPM) run diagnose

rebuild: clean workspace-clean start
	@echo "$(GREEN)✅ Rebuild completo concluído$(NC)"

# --- Git Validation ---
.PHONY: validate-git validate-powershell-bom validate-env

validate-git:
	@echo "$(CYAN)🔍 Validando configurações Git$(NC)"
	@git check-attr -a .gitattributes >/dev/null 2>&1 && echo "$(GREEN)✅ .gitattributes OK$(NC)" || echo "$(RED)❌ .gitattributes inválido$(NC)"
	@git config --list --show-origin | grep -q '.devcontainer/config/.gitconfig' && echo "$(GREEN)✅ .gitconfig carregado$(NC)" || echo "$(YELLOW)⚠️  .gitconfig não carregado$(NC)"
	@git config user.name >/dev/null 2>&1 && echo "$(GREEN)✅ Git user.name configurado$(NC)" || echo "$(YELLOW)⚠️  Git user.name não configurado$(NC)"
	@git config user.email >/dev/null 2>&1 && echo "$(GREEN)✅ Git user.email configurado$(NC)" || echo "$(YELLOW)⚠️  Git user.email não configurado$(NC)"

validate-env:
	@echo "$(CYAN)🔍 Validando arquivos .env contra .env.schema.json$(NC)"
	@if [ ! -f scripts/validate-env.js ]; then \
		echo "$(RED)❌ scripts/validate-env.js não encontrado$(NC)"; \
		exit 1; \
	fi
	@if [ ! -f .env.schema.json ]; then \
		echo "$(RED)❌ .env.schema.json não encontrado$(NC)"; \
		exit 1; \
	fi
	@$(NODE) scripts/validate-env.js --all || (echo "$(RED)❌ Validação ENV falhou$(NC)" && exit 1)
	@echo "$(GREEN)✅ Validação ENV concluída$(NC)"

validate-powershell-bom:
	@echo "$(CYAN)🔍 Validando BOM em scripts PowerShell$(NC)"
	@ERRORS=0; \
	for file in $$(find . -name '*.ps1' -not -path './node_modules/*' -not -path './backups/*'); do \
		if ! file "$$file" 2>/dev/null | grep -qE 'UTF-8.*(with BOM)|UTF-8 Unicode text'; then \
			echo "$(RED)❌ Missing/Invalid BOM: $$file$(NC)"; \
			ERRORS=$$((ERRORS+1)); \
		fi; \
	done; \
	if [ $$ERRORS -eq 0 ]; then \
		echo "$(GREEN)✅ Todos os scripts PowerShell têm encoding correto$(NC)"; \
	else \
		echo "$(RED)❌ $$ERRORS arquivo(s) PowerShell com problemas de encoding$(NC)"; \
		exit 1; \
	fi

# =============================================================================
# 1️⃣2️⃣ VS CODE & DEV TOOLS
# =============================================================================

.PHONY: vscode-info vscode-check vscode-list vscode-update reload-vscode check-chrome check-bindings

vscode-info:
	@echo "$(CYAN)📊 VS Code — status$(NC)"
	@ls -la .vscode 2>/dev/null || echo "$(YELLOW)Sem .vscode/$(NC)"

vscode-check:
	@echo "$(CYAN)🔍 Verificando extensões VS Code$(NC)"
	@$(NPM) run vscode:check

vscode-list:
	@echo "$(CYAN)📋 Listando extensões instaladas$(NC)"
	@$(NPM) run vscode:list

vscode-update:
	@echo "$(CYAN)🔄 Atualizando extensões$(NC)"
	@$(NPM) run vscode:update

reload-vscode:
	@echo "$(YELLOW)🔄 VS Code: Reload Window$(NC)"
	@echo "$(CYAN)Use: Ctrl+Shift+P > Developer: Reload Window$(NC)"

check-chrome:
	@echo "$(CYAN)🔍 Verificando Chrome$(NC)"
	@$(NPM) run check:chrome

check-bindings:
	@echo "$(CYAN)🔍 Verificando bindings 0.0.0.0$(NC)"
	@bash scripts/check-all-bindings.sh

# =============================================================================
# 1️⃣3️⃣ DEVELOPMENT SHORTCUTS
# =============================================================================

.PHONY: dev dev-debug quick-test quick-check check-forbidden

dev:
	@echo "$(GREEN)🚀 Iniciando modo desenvolvimento$(NC)"
	@$(NPM) run dev

dev-debug:
	@echo "$(GREEN)🐛 Iniciando modo debug$(NC)"
	@$(NODE) --inspect=0.0.0.0:9229 index.js

quick-test: lint-quiet test
	@echo "$(GREEN)✅ Quick test passou$(NC)"

quick-check: format-check lint-quiet
	@echo "$(GREEN)✅ Quick check passou$(NC)"

check-forbidden:
	@echo "$(CYAN)🔍 Verificando padrões proibidos$(NC)"
	@$(NPM) run check:forbidden

# =============================================================================
# 1️⃣4️⃣ GIT & QUALIDADE
# =============================================================================

.PHONY: git-changed git-push-safe

git-changed:
	@echo "$(CYAN)📝 Arquivos modificados:$(NC)"
	@git status --short

git-push-safe:
	@echo "$(CYAN)🔒 Git Push Seguro (5 validações)$(NC)"
	@echo "$(YELLOW)1/5 Verificando branch...$(NC)"
	@git status --porcelain | grep . && { echo "$(RED)✗ Há alterações não commitadas$(NC)"; exit 1; } || echo "$(GREEN)✓ Branch limpo$(NC)"
	@echo "$(YELLOW)2/5 Verificando formatação...$(NC)"
	@$(MAKE) format-check
	@echo "$(YELLOW)3/5 Executando lint...$(NC)"
	@$(MAKE) lint-quiet
	@echo "$(YELLOW)4/5 Executando testes...$(NC)"
	@$(MAKE) test
	@echo "$(YELLOW)5/5 Push...$(NC)"
	@git push
	@echo "$(GREEN)✅ Push seguro concluído$(NC)"

# =============================================================================
# 1️⃣5️⃣ ALIASES & SHORTCUTS
# =============================================================================

.PHONY: s st r h l t i v g q m d a

s: start
st: stop
r: restart
h: health
l: logs
t: test
i: info
v: vscode-info
g: git-changed
q: queue-status
m: monit
d: diagnose
a: analyze-graph

# =============================================================================
# 1️⃣6️⃣ DOCUMENTATION
# =============================================================================

.PHONY: docs docs-list

docs:
	@echo "$(CYAN)📚 Documentação disponível:$(NC)"
	@echo "  • $(BOLD)README.md$(NC)"
	@echo "  • $(BOLD)DOCUMENTAÇÃO/ARCHITECTURE.md$(NC)"
	@echo "  • $(BOLD)DOCUMENTAÇÃO/ENV_VARIABLES_GUIDE.md$(NC)"
	@echo "  • $(BOLD)DOCUMENTAÇÃO/DEPENDENCIES_ANALYSIS.md$(NC)"
	@echo "  • $(BOLD)DOCUMENTAÇÃO/FINAL_CONSOLIDATED_REPORT.md$(NC)"
	@echo "  • $(BOLD)DOCUMENTAÇÃO/MAKEFILE_UPGRADE_PROPOSAL.md$(NC)"
	@echo ""
	@echo "$(CYAN)Use: $(BOLD)cat DOCUMENTAÇÃO/<arquivo>$(NC)"

docs-list:
	@echo "$(CYAN)📚 Lista completa de documentação:$(NC)"
	@ls -1 DOCUMENTAÇÃO/*.md 2>/dev/null || echo "$(YELLOW)Sem arquivos .md em DOCUMENTAÇÃO/$(NC)"

# =============================================================================
# FIM DO MAKEFILE v4.0.0
# =============================================================================
