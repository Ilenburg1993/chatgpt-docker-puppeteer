# =============================================================================
# Makefile — ChatGPT Docker Puppeteer (DEV / PM2-First / Control-Plane Ready)
# =============================================================================
# PRINCÍPIOS CANÔNICOS:
# • Ambiente de DESENVOLVIMENTO (DEV), não produção
# • Makefile é a superfície humana de operação; scripts continuam fonte técnica
# • Bootstrap ≠ Runtime ≠ Health ≠ Network Control Plane
# • PM2 é crítico para runtime, mas NÃO define saúde estrutural do container
# • Healthcheck é conservador: fatal reprova; degraded/advisory orientam humanos
# • Rede GitHub/Copilot é opt-in/manual para mutações e benchmarks prolongados
# • Compatível com Docker / DevContainer do zero
# • Alinhado com package.json v1.1.4 e scripts de rede/control-plane canônicos
#
# Versão: 4.4.0
# Data:   2026-05-20
# Changelog v4.4.0:
#   - Sincroniza com package.json v1.1.4, DevContainer v5.9.0, Dockerfile v1.5.0 e post-create v1.2.1.
#   - Integra network-control-plane-state.sh v1.1.0 como agregador passivo canônico.
#   - Adiciona targets network-state*, network-control-plane*, network-registry-status ampliado e aliases humanos.
#   - Inclui control-plane em network-syntax, network-shellcheck, network-doctor, network-validate e summaries.
#   - Expande artifacts para DNS action/events, route action, sync-local-auth, health e network-control-plane.
#   - Mantém benchmarks e mutações como ações manuais explícitas; summaries/state continuam passivos.
# Changelog v4.3.0:
#   - Sincroniza com healthcheck.sh v3.0.0, package.json v1.1.3 e DevContainer v5.8.0.
#   - Health deixa de ser PM2-first e passa a chamar o classificador canônico do container.
#   - Adiciona health-brief, health-quiet, health-strict, health-no-cdp, health-summary e health-artifacts.
#   - Sincroniza control plane com post-create v1.1.0, post-start v2.9.0 e post-attach v5.8.0.
#   - Sincroniza rede com local-dns-cache v1.6.0, route-fix v1.9.0, manager v1.6.0,
#     local-copilot-proxy v1.3.1 e copilot-route-advisor v1.1.0.
#   - Corrige registry canônico para .devcontainer/scripts/network/endpoints.github-copilot.tsv.
#   - Adiciona targets de advisor, route doctor/summary, manager doctor/summary, proxy env e summaries ampliados.
#   - Inclui healthcheck.sh em network-syntax/network-shellcheck/network-validate.
#   - Mantém benchmarks/compare como ações manuais explícitas, nunca boot/attach automáticos.
# Changelog v4.2.2:
#   - Alinha comandos DNS ao local-dns-cache v1.5.3.
#   - Adiciona network-dns-* para status, doctor, benchmark, start, health, stop, summary e lock.
#   - Corrige quick targets para não herdarem duração longa do ambiente.
#   - Separa summaries atuais de snapshots de boot/lifecycle para evitar leitura de artefatos stale.
#   - Expande artifacts/status/doctor para incluir DNS cache local.
# Changelog v4.2.1:
#   - Corrige network-doctor para usar DEVCONTAINER_COPILOT_NETWORK_MANAGER_ACTION=doctor.
#   - Corrige comandos explícitos de proxy para forçar mode=local, mesmo quando containerEnv define off.
#   - Corrige manager benchmark/compare para permitir A/B direct vs proxy-local de verdade.
#   - Adiciona targets rápidos/diagnósticos para proxy compare, lock e summaries.
# Changelog v4.2.0:
#   - Adiciona superfície oficial de comandos para benchmark prolongado GitHub/Copilot.
#   - Adiciona targets para route-fix v1.8.4, proxy v1.2.2 e manager v1.5.0.
#   - Separa validação rápida/shellcheck de benchmarks longos para não contaminar boot.
#   - Adiciona summary/artifacts/recommendation readers para consumo humano.
#   - Mantém proxy local opt-in e benchmark A/B manual/controlado.
# Changelog v4.1.1:
#   - Consolidação de validações de DevContainer, Dockerfile e GitHub/Actions
#   - Novos targets validate-devcontainer, validate-dockerfile, validate-github e validate-platform
# Changelog v4.1:
#   - Expansão abrangente dos comandos de RAG e Audit (execução + operação)
#   - Novos targets para rebuild/index sem docs, docs-only e modo estrito
#   - Novos targets de inspeção de artifacts (último run, progress, tail de eventos)
#   - Novos atalhos para nightly sem refresh e execução code-only
#   - Help reorganizado com foco operacional (pré-run, run, pós-run)
# =============================================================================
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
# GITHUB/COPILOT NETWORK CONTROL PLANE
# =============================================================================

POST_CREATE_SCRIPT ?= .devcontainer/scripts/post-create.sh
POST_START_SCRIPT ?= .devcontainer/scripts/post-start.sh
POST_ATTACH_SCRIPT ?= .devcontainer/scripts/post-attach.sh
HEALTHCHECK_SCRIPT ?= .devcontainer/scripts/healthcheck.sh
NETWORK_CONTROL_PLANE_SCRIPT ?= .devcontainer/scripts/network-control-plane-state.sh
NETWORK_LOCAL_DNS_SCRIPT ?= .devcontainer/scripts/network/local-dns-cache.sh
NETWORK_ROUTE_SCRIPT ?= .devcontainer/scripts/network/github-api-route-fix.sh
NETWORK_MANAGER_SCRIPT ?= .devcontainer/scripts/network/github-copilot-network-manager.sh
NETWORK_PROXY_SCRIPT ?= .devcontainer/scripts/network/local-copilot-proxy.sh
NETWORK_ADVISOR_SCRIPT ?= .devcontainer/scripts/network/copilot-route-advisor.sh
NETWORK_ENDPOINT_REGISTRY ?= .devcontainer/scripts/network/endpoints.github-copilot.tsv
NETWORK_ENDPOINT_REGISTRY_LEGACY ?= .devcontainer/network/endpoints.github-copilot.tsv

NETWORK_BENCHMARK_SECONDS ?= 600
NETWORK_BENCHMARK_INTERVAL ?= 10
NETWORK_BENCHMARK_MAX_SAMPLES ?= 0
NETWORK_FUNCTIONALITY_PROFILE ?= full
NETWORK_PROXY_MODE ?= local
NETWORK_TRANSPORT_PROFILE ?= auto
NETWORK_ENABLE_LOCAL_PROXY ?= true
NETWORK_DNS_MODE ?= local
NETWORK_DNS_UPSTREAM_SELECTION ?= ranked
NETWORK_DNS_FORCE_REBENCHMARK ?= true
NETWORK_DNS_WRITE_RESOLV_CONF ?= true

# =============================================================================
# RAG SCOPE CONFIG (aditivo, compatível com defaults atuais)
# =============================================================================

EMPTY :=
SPACE := $(EMPTY) $(EMPTY)
COMMA := ,

RAG_PROFILE ?=
RAG_DOCS_MODE ?=
RAG_MAX_FILE_BYTES ?=
RAG_INCLUDE_GLOBS ?=
RAG_EXCLUDE_GLOBS ?=

RAG_INCLUDE_GLOBS_LIST = $(strip $(subst $(COMMA),$(SPACE),$(RAG_INCLUDE_GLOBS)))
RAG_EXCLUDE_GLOBS_LIST = $(strip $(subst $(COMMA),$(SPACE),$(RAG_EXCLUDE_GLOBS)))
RAG_FILTER_ARGS = $(if $(RAG_MAX_FILE_BYTES),--max-file-bytes "$(RAG_MAX_FILE_BYTES)",) \
	$(foreach glob,$(RAG_INCLUDE_GLOBS_LIST),--include-glob "$(glob)") \
	$(foreach glob,$(RAG_EXCLUDE_GLOBS_LIST),--exclude-glob "$(glob)")
RAG_SCOPE_ARGS = $(if $(RAG_PROFILE),--profile "$(RAG_PROFILE)",) \
	$(if $(RAG_DOCS_MODE),--docs-mode "$(RAG_DOCS_MODE)",) \
	$(RAG_FILTER_ARGS)

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
	@echo "$(CYAN)║  ChatGPT Docker Puppeteer — Makefile v4.4 (DEV)            ║$(NC)"
	@echo "$(CYAN)║  Health-Classified • Network-Ready • PM2-Ready             ║$(NC)"
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
	@echo "$(GREEN)$(BOLD)🌐 Dashboard UI (Vite):$(NC)"
	@echo "  $(CYAN)make dashboard-check$(NC)   Diagnóstico completo"
	@echo "  $(CYAN)make dashboard-guide$(NC)   Guia port forwarding"
	@echo "  $(CYAN)make dashboard-open$(NC)    Abrir Simple Browser"
	@echo "  $(CYAN)make dashboard-sync$(NC)    Check config sync (rebuild needed?)"
	@echo ""
	@echo "$(YELLOW)$(BOLD)🏥 Health & Validação:$(NC)"
	@echo "  $(CYAN)make health$(NC)            Healthcheck canônico do DevContainer"
	@echo "  $(CYAN)make pm2-check$(NC)         Check completo (6 validações)"
	@echo "  $(CYAN)make pm2-startup$(NC)       Startup seguro"
	@echo "  $(CYAN)make validate$(NC)          Validar config.json"
	@echo "  $(CYAN)make validate-all$(NC)      Validação completa (check+lint+format+test)"
	@echo "  $(CYAN)make validate-env$(NC)      Validar arquivos .env"
	@echo "  $(CYAN)make validate-devcontainer$(NC) Validar devcontainer + drift"
	@echo "  $(CYAN)make validate-dockerfile$(NC)   Lint do Dockerfile"
	@echo "  $(CYAN)make validate-github$(NC)       Validar workflows GitHub locais"
	@echo "  $(CYAN)make validate-github-remote$(NC) Validar workflows GitHub remotos"
	@echo "  $(CYAN)make validate-platform$(NC)     Validação consolidada de plataforma/CI"
	@echo "  $(CYAN)make validate-git$(NC)      Validar configurações Git"
	@echo "  $(CYAN)make mcp-diagnose$(NC)      Diagnóstico MCP (RAG/LSP/Ollama)"
	@echo "  $(CYAN)make copilot-mcp-up$(NC)    Sobe MCP OAuth + Cloudflare permanente"
	@echo "  $(CYAN)make copilot-mcp-restart$(NC) Reinicia MCP OAuth + Cloudflare"
	@echo "  $(CYAN)make copilot-mcp-h2-origin-plan$(NC) Planeja origin remoto HTTPS/HTTP2 sem aplicar"
	@echo "  $(CYAN)make copilot-mcp-h2-origin-apply-dry-run$(NC) Dry-run do apply HTTPS/HTTP2 no named tunnel"
	@echo "  $(CYAN)make copilot-mcp-h2-origin-apply$(NC) Aplica HTTPS/HTTP2 no named tunnel com confirmação explícita"
	@echo "  $(CYAN)make copilot-mcp-h2-remote-audit$(NC) Audita Cloudflare contra perfil HTTPS/HTTP2"
	@echo "  $(CYAN)make copilot-mcp-h2-restart$(NC) Reinicia MCP OAuth + Cloudflare em origin HTTP/2"
	@echo "  $(CYAN)make copilot-mcp-h2-canary$(NC) Valida canary H2: audit + smoke + status"
	@echo "  $(CYAN)make copilot-mcp-h2-migrate$(NC) Fluxo canônico completo para migrar origin H2"
	@echo "  $(CYAN)make copilot-mcp-http1-rollback$(NC) Rollback canônico para origin HTTP/1"
	@echo "  $(CYAN)make copilot-mcp-edge-audit$(NC) Audita Cloudflare cache/WAF/rate-limit/transforms"
	@echo "  $(CYAN)make copilot-mcp-edge-backup-create$(NC) Persiste backup local Cloudflare antes de mutar"
	@echo "  $(CYAN)make copilot-mcp-edge-backup-list$(NC) Lista backups locais Cloudflare"
	@echo "  $(CYAN)make copilot-mcp-edge-policy-apply$(NC) Dry-run do aplicador Cloudflare com backup"
	@echo "  $(CYAN)make copilot-mcp-edge-policy-diff$(NC) Compara edge actual vs desired sem aplicar"
	@echo "  $(CYAN)make copilot-mcp-edge-policy-plan$(NC) Planeja edge policy Cloudflare sem aplicar"
	@echo "  $(CYAN)make copilot-mcp-edge-snapshot$(NC) Snapshot Cloudflare tunnel/DNS/rulesets/diff"
	@echo "  $(CYAN)make copilot-mcp-smoke-refresh$(NC) Atualiza smoke persistido do MCP público"
	@echo "  $(CYAN)make copilot-mcp-oauth-smoke$(NC) Smoke OAuth canônico do MCP público"
	@echo "  $(CYAN)make lsp-health$(NC)        Diagnóstico funcional LSP via MCP"
	@echo "  $(CYAN)make semantic-preflight$(NC) Preflight PM2+MCP+RAG+LSP"
	@echo ""
	@echo "$(MAGENTA)$(BOLD)🤖 Model Gateway BYOK:$(NC)"
	@echo "  $(CYAN)make model-gateway-commands$(NC)  Inventário canônico package/make/terminal"
	@echo "  $(CYAN)make model-gateway-validate$(NC)  Lint + typecheck strict + testes escopados"
	@echo "  $(CYAN)make model-gateway-prebuild$(NC)  Sequência canônica antes do primeiro build"
	@echo "  $(CYAN)make model-gateway-build$(NC)     Prebuild + build do banco de metadados"
	@echo "  $(CYAN)make model-gateway-selection-audit$(NC)  Auditoria de seleção pré-runtime"
	@echo "  $(CYAN)make model-gateway-effective-selection$(NC)  Seleção efetiva sem novas probes"
	@echo "  $(CYAN)make model-gateway-auto-ready$(NC) Gate read-only para automação terminal"
	@echo "  $(CYAN)make model-gateway-auto-doctor$(NC) Doctor read-only da política e trilhas auto"
	@echo "  $(CYAN)make model-gateway-auto-recoveries$(NC) Ledger SQLite de recovery pós-falha"
	@echo "  $(CYAN)make model-gateway-auto-scenarios$(NC) Cenários canônicos para operador/LLM antes dos live tests"
	@echo "  $(CYAN)make model-gateway-live-readiness$(NC)   Gate antes dos testes live llm-b"
	@echo "  $(CYAN)make model-gateway-live-plan$(NC)  Plano auditável antes dos testes live"
	@echo "  $(CYAN)make model-gateway-live-auto-probe$(NC)  Probe live do cockpit auto sem turno de modelo"
	@echo "  $(CYAN)make model-gateway-live-runs$(NC)  Ledger SQLite dos live tests"
	@echo "  $(CYAN)make model-gateway-terminal$(NC)  Abrir terminal llm-b para comandos /byok"
	@echo ""
	@echo "$(CYAN)$(BOLD)🌐 GitHub/Copilot Network:$(NC)"
	@echo "  $(CYAN)make network-status$(NC)       Snapshots passivos de DNS/rota/manager/proxy/advisor"
	@echo "  $(CYAN)make network-summary$(NC)      Exibir summaries/recommendations atuais"
	@echo "  $(CYAN)make network-state$(NC)        Estado consolidado passivo do control plane"
	@echo "  $(CYAN)make network-state-json$(NC)   JSON consolidado do control plane"
	@echo "  $(CYAN)make network-validate$(NC)     bash -n + ShellCheck + doctor"
	@echo "  $(CYAN)make network-route-probe$(NC)  Probe dry-run api.github.com"
	@echo "  $(CYAN)make network-route-benchmark$(NC) Benchmark prolongado api.github.com"
	@echo "  $(CYAN)make network-proxy-compare$(NC) A/B direct vs proxy-local"
	@echo "  $(CYAN)make network-manager-recommend$(NC) Policy recommendation consolidada"
	@echo "  $(CYAN)make network-manager-benchmark$(NC) Benchmark coordenado manager"
	@echo "  $(CYAN)make network-advisor-probe$(NC)   Advisor passivo de edges/IPs"
	@echo "  $(CYAN)make network-health$(NC)          Healthcheck canônico + artifacts"
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
	@echo "  $(CYAN)make test-regression$(NC)   Testes de regressão"
	@echo "  $(CYAN)make test-e2e$(NC)          Testes E2E"
	@echo "  $(CYAN)make test-coverage$(NC)     Com coverage"
	@echo ""
	@echo "$(BLUE)$(BOLD)🧠 RAG & MCP:$(NC)"
	@echo "  $(CYAN)make rag-help$(NC)          Guia detalhado de operações RAG"
	@echo "  $(CYAN)make rag-health$(NC)        Health do RAG (estado do índice)"
	@echo "  $(CYAN)make rag-index$(NC)         Reindexação com argumentos dinâmicos"
	@echo "  $(CYAN)make rag-index-code-config$(NC)  Indexar só código/config (sem docs)"
	@echo "  $(CYAN)make rag-index-docs$(NC)    Indexar somente documentação"
	@echo "  $(CYAN)make rag-ask QUERY='...'$(NC)    Pergunta via RAG"
	@echo "  $(CYAN)make rag-hybrid QUERY='...'$(NC) Busca híbrida RAG"
	@echo "  $(CYAN)make rag-expand CHUNK_ID='...'$(NC) Expandir chunk por linhas/símbolo"
	@echo "  $(CYAN)make rag-reset$(NC)         Reset de índices RAG"
	@echo "  $(CYAN)make rag-watch$(NC)         Watch incremental contínuo do RAG"
	@echo "  $(CYAN)make rag-full-rebuild$(NC)  Reset + reindex (escopo configurável)"
	@echo "  $(CYAN)make rag-rebuild-zero$(NC)  Pipeline canônico completo (PM2/MCP/RAG)"
	@echo "  $(CYAN)make rag-rebuild-code-config$(NC) Rebuild zero focado em código/config"
	@echo "  $(CYAN)make rag-rebuild-code-config-strict$(NC) Rebuild estrito por extensões"
	@echo "  $(CYAN)make rag-preflight$(NC)     MCP + LSP + preflight semântico + health"
	@echo "  $(CYAN)make audit-preflight$(NC)   Preflight semântico estruturado (JSON)"
	@echo "  $(CYAN)make audit-help$(NC)        Guia detalhado de operações de auditoria"
	@echo "  $(CYAN)make audit-ready$(NC)       Checklist de prontidão antes da auditoria"
	@echo "  $(CYAN)make audit-shadow$(NC)      Auditoria rápida em modo shadow gate"
	@echo "  $(CYAN)make audit-quick$(NC)       Auditoria bug-first rápida (delta + ETA/progresso)"
	@echo "  $(CYAN)make audit-quick-serial$(NC) Quick com quality serial (diagnóstico)"
	@echo "  $(CYAN)make audit-quick-cache-off$(NC) Quick sem cache de quality (baseline)"
	@echo "  $(CYAN)make audit-quick-skip-refresh$(NC) Quick sem refresh de contexto"
	@echo "  $(CYAN)make audit-deep$(NC)        Auditoria bug-first completa local (com proposals)"
	@echo "  $(CYAN)make audit-deep-jsdoc$(NC)  Deep com 'jsdoc_full' + threshold"
	@echo "  $(CYAN)make audit-nightly$(NC)     Auditoria noturna completa (com refresh/docs)"
	@echo "  $(MAGENTA)$(BOLD)make audit-nightly-max-no-docs$(NC) Nightly máxima sem refresh (deep + diffs + chaos + all)"
	@echo "  $(CYAN)make audit-nightly-no-docs$(NC)   Nightly sem refresh/docs (mais rápido)"
	@echo "  $(CYAN)make audit-run-last$(NC)    Mostra o diretório do último run"
	@echo "  $(CYAN)make audit-progress RUN_ID=<run_id>$(NC)  Lê progress.json de um run"
	@echo "  $(CYAN)make audit-events-tail RUN_ID=<run_id>$(NC) Tail de events.jsonl"
	@echo "  $(CYAN)make rag-index RAG_DOCS_MODE=exclude$(NC)  Indexar sem MD/MDX"
	@echo "  $(CYAN)make rag-index RAG_DOCS_MODE=only$(NC)     Indexar somente MD/MDX"
	@echo "  $(CYAN)make rag-watch RAG_INCLUDE_GLOBS='src/**,config/**'$(NC)  Escopo custom"
	@echo ""
	@echo "$(YELLOW)$(BOLD)🎨 Formatação & Lint:$(NC)"
	@echo "  $(CYAN)make format$(NC)            Formatar código (Prettier)"
	@echo "  $(CYAN)make format-check$(NC)      Verificar formatação"
	@echo "  $(CYAN)make jsdoc-coverage$(NC)    Cobertura JSDoc full"
	@echo "  $(CYAN)make jsdoc-delta$(NC)       Cobertura JSDoc delta"
	@echo "  $(CYAN)make lint$(NC)              Linting (ESLint)"
	@echo "  $(CYAN)make lint-fix$(NC)          Fix automático"
	@echo "  $(CYAN)make typecheck-node$(NC)    Typecheck canônico (Node/Audit)"
	@echo "  $(CYAN)make typecheck-browser$(NC) Typecheck browser/UI isolado"
	@echo "  $(CYAN)make typecheck-full$(NC)    Typecheck completo (node + browser)"
	@echo "  $(CYAN)make test-audit-quality$(NC) Testes unitários do audit quality/JSDoc"
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
	@echo "  Makefile: $(BOLD)v4.4.0$(NC)"
	@echo ""
	@echo "$(YELLOW)Pacotes base instalados no projeto:$(NC)"
	@echo "  • $(GREEN)chalk$(NC) (^5.6.2) - Terminal colors"
	@echo "  • $(GREEN)dotenv$(NC) (^17.2.4) - ENV loader"
	@echo "  • $(GREEN)pino$(NC) (^10.3.1) - Logger estruturado"
	@echo ""

version:
	@echo "Makefile v4.4.0 — DEV / Health-Classified / Network-Control-Plane-Ready"
	@echo "Data: 2026-05-20"
	@echo "Stack: devcontainer 5.9.0 | Dockerfile 1.5.0 | post-create 1.2.1 | healthcheck 3.0.0 | package 1.1.4 | network-control-plane 1.1.0"
	@echo "Targets: 135+ | Aliases: 18 | Coverage: package.json scripts v1.1.4"

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

.PHONY: ensure-pm2 start stop restart reload status logs logs-follow monit dashboard-check dashboard-guide dashboard-open dashboard-test-windows dashboard-sync

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
# 4️⃣.5 DASHBOARD UI (VITE DEV SERVER)
# =============================================================================

.PHONY: dashboard-check dashboard-guide dashboard-open dashboard-test-windows

dashboard-check:
	@echo "$(CYAN)🔍 Dashboard Access Diagnostics$(NC)"
	@bash scripts/check-dashboard-access.sh

dashboard-guide:
	@echo "$(CYAN)📖 Port Forwarding Setup Guide$(NC)"
	@bash scripts/guide-port-forwarding.sh

dashboard-open:
	@echo "$(CYAN)🌐 Opening Dashboard in Browser$(NC)"
	@bash scripts/open-dashboard-browser.sh

dashboard-test-windows:
	@echo "$(CYAN)🪟 Test Dashboard Access from Windows$(NC)"
	@echo ""
	@echo "Run this command in Windows PowerShell (not in container):"
	@echo ""
	@echo "  cd $(shell pwd)"
	@echo '  $$PSScriptRoot\scripts\test-dashboard-from-windows.ps1'
	@echo ""
	@echo "Or manually test:"
	@echo "  Test-NetConnection -ComputerName localhost -Port 5173"

dashboard-sync:
	@echo "$(CYAN)🔄 DevContainer Config Sync Check$(NC)"
	@bash scripts/check-devcontainer-sync.sh

# =============================================================================
# 5️⃣ HEALTH — DEVCONTAINER HEALTH CLASSIFIER
# =============================================================================

.PHONY: health health-core health-brief health-quiet health-strict health-no-cdp health-summary health-artifacts pm2-health pm2-check pm2-check-fix pm2-startup pm2-validate validate validate-all validate-devcontainer validate-dockerfile validate-github validate-github-remote validate-platform

health:
	@echo "$(CYAN)🏥 DevContainer healthcheck canônico$(NC)"
	@bash "$(HEALTHCHECK_SCRIPT)"

health-core: health

health-brief:
	@bash "$(HEALTHCHECK_SCRIPT)" --brief

health-quiet:
	@bash "$(HEALTHCHECK_SCRIPT)" --quiet

health-strict:
	@bash "$(HEALTHCHECK_SCRIPT)" --strict

health-no-cdp:
	@bash "$(HEALTHCHECK_SCRIPT)" --no-cdp

health-summary:
	@echo "$(CYAN)📄 Health artifacts$(NC)"
	@for f in \
		/tmp/devcontainer-health.status \
		/tmp/devcontainer-health.summary \
		/tmp/devcontainer-health.events.tsv \
		/tmp/devcontainer-health.report \
		/tmp/devcontainer-network-control-plane.status \
		/tmp/devcontainer-network-control-plane.summary \
		/tmp/devcontainer-network-control-plane.report \
		/tmp/devcontainer-network-control-plane.events.tsv \
		/tmp/devcontainer-network-control-plane.state.json; do \
		if [ -r "$$f" ]; then \
			echo ""; echo "===== $$f ====="; cat "$$f"; \
		fi; \
	done

health-artifacts:
	@echo "$(CYAN)📦 Health artifacts em /tmp$(NC)"
	@ls -lh /tmp/devcontainer-health.* 2>/dev/null || true

pm2-health:
	@echo "$(CYAN)🏥 PM2 Health Check legado/operacional$(NC)"
	@bash scripts/ops/pm2-check.sh || true

pm2-check:
	@bash scripts/ops/pm2-check.sh

pm2-check-fix:
	@bash scripts/ops/pm2-check.sh --fix

pm2-startup:
	@bash scripts/setup/pm2-startup.sh

pm2-validate:
	@echo "$(CYAN)🔍 Validando configuração PM2 Sovereign...$(NC)"
	@grep -q 'SERVER_MODE.*split' ecosystem.config.cjs && echo "$(GREEN)✓ SERVER_MODE=split configurado$(NC)" || echo "$(RED)✗ SERVER_MODE não encontrado$(NC)"
	@grep -q 'SERVER_AUTHORITY.*standalone' ecosystem.config.cjs && echo "$(GREEN)✓ SERVER_AUTHORITY=standalone configurado$(NC)" || echo "$(RED)✗ SERVER_AUTHORITY não encontrado$(NC)"
	@grep -q 'DAEMON_MODE.*true' ecosystem.config.cjs && echo "$(GREEN)✓ DAEMON_MODE=true configurado$(NC)" || echo "$(RED)✗ DAEMON_MODE não encontrado$(NC)"

validate:
	@echo "$(CYAN)🔍 Validando config.json$(NC)"
	@$(NPM) run validate
	@echo "$(GREEN)✅ Configuração validada$(NC)"

validate-all:
	@echo "$(CYAN)🔍 Validação completa (check+lint+format+test)$(NC)"
	@$(NPM) run validate:all
	@echo "$(GREEN)✅ Validação completa finalizada$(NC)"

validate-devcontainer:
	@echo "$(CYAN)🔍 Validando DevContainer (JSONC + env + sync)$(NC)"
	@$(NPM) run check:devcontainer
	@echo "$(GREEN)✅ DevContainer validado$(NC)"

validate-dockerfile:
	@echo "$(CYAN)🔍 Validando Dockerfile$(NC)"
	@$(NPM) run check:dockerfile:lint
	@echo "$(GREEN)✅ Dockerfile validado$(NC)"

validate-github:
	@echo "$(CYAN)🔍 Validando workflows GitHub locais$(NC)"
	@$(NPM) run check:github
	@echo "$(GREEN)✅ Workflows GitHub locais validados$(NC)"

validate-github-remote:
	@echo "$(CYAN)🔍 Validando workflows GitHub remotos$(NC)"
	@$(NPM) run check:github:remote
	@echo "$(GREEN)✅ Workflows GitHub remotos validados$(NC)"

validate-platform:
	@echo "$(CYAN)🔍 Validação consolidada de plataforma/CI$(NC)"
	@$(NPM) run check:platform
	@$(MAKE) -f "$(firstword $(MAKEFILE_LIST))" health-brief
	@echo "$(GREEN)✅ Plataforma/CI validada$(NC)"


# =============================================================================
# 5️⃣.5 GITHUB/COPILOT NETWORK CONTROL PLANE
# =============================================================================

.PHONY: network-help network-status network-summary network-summary-current network-summary-boot network-summary-all network-artifacts network-syntax network-shellcheck network-validate network-validate-soft network-doctor network-doctor-soft network-health network-registry-status
.PHONY: network-state network-state-status network-state-summary network-state-report network-state-events network-state-json network-state-doctor network-state-strict network-control-plane network-control-plane-status network-control-plane-summary network-control-plane-report network-control-plane-events network-control-plane-json network-control-plane-doctor
.PHONY: network-dns-status network-dns-doctor network-dns-benchmark network-dns-start network-dns-health network-dns-stop network-dns-summary network-dns-lock-diagnose
.PHONY: network-route-status network-route-doctor network-route-summary network-route-probe network-route-benchmark
.PHONY: network-proxy-status network-proxy-doctor network-proxy-env network-proxy-start network-proxy-stop network-proxy-benchmark network-proxy-compare network-proxy-compare-quick network-proxy-summary network-proxy-lock-diagnose
.PHONY: network-manager-status network-manager-doctor network-manager-summary network-manager-recommend network-manager-benchmark network-manager-benchmark-quick network-manager-compare network-manager-compare-quick
.PHONY: network-advisor-status network-advisor-doctor network-advisor-probe network-advisor-summary

network-help:
	@echo ""
	@echo "$(CYAN)$(BOLD)🌐 GitHub/Copilot Network Control Plane — Makefile v4.4.0$(NC)"
	@echo "  $(CYAN)make network-status$(NC)                    Lê status passivo de DNS/manager/route/proxy/advisor"
	@echo "  $(CYAN)make network-summary$(NC)                   Mostra snapshot atual + health"
	@echo "  $(CYAN)make network-summary-boot$(NC)              Mostra snapshots de lifecycle/boot"
	@echo "  $(CYAN)make network-summary-all$(NC)               Mostra snapshots atuais + boot + advisor"
	@echo "  $(CYAN)make network-health$(NC)                    Roda healthcheck canônico do DevContainer"
	@echo "  $(CYAN)make network-state$(NC)                     Estado consolidado passivo do control plane"
	@echo "  $(CYAN)make network-state-json$(NC)                JSON consolidado para automação/diagnóstico"
	@echo "  $(CYAN)make network-state-doctor$(NC)              Doctor passivo do agregador control-plane"
	@echo "  $(CYAN)make network-validate$(NC)                  bash -n + ShellCheck + doctor + health"
	@echo "  $(CYAN)make network-dns-start$(NC)                 Inicia DNS cache local com prova antes de resolv.conf"
	@echo "  $(CYAN)make network-dns-health$(NC)                Health do DNS cache local"
	@echo "  $(CYAN)make network-route-doctor$(NC)              Doctor passivo/seguro do route-fix"
	@echo "  $(CYAN)make network-route-probe$(NC)               Probe dry-run api.github.com"
	@echo "  $(CYAN)make network-route-benchmark$(NC)           Benchmark api.github.com por $(NETWORK_BENCHMARK_SECONDS)s"
	@echo "  $(CYAN)make network-proxy-env$(NC)                 Gera env hints opt-in do proxy local"
	@echo "  $(CYAN)make network-proxy-compare$(NC)             A/B direct vs proxy-local"
	@echo "  $(CYAN)make network-proxy-compare-quick$(NC)       A/B curto de 120s, sem herdar duração longa"
	@echo "  $(CYAN)make network-advisor-probe$(NC)             Advisor passivo de edges/IPs Copilot"
	@echo "  $(CYAN)make network-manager-recommend$(NC)         Policy recommendation consolidada"
	@echo "  $(CYAN)make network-manager-benchmark$(NC)         Benchmark coordenado manager"
	@echo ""
	@echo "$(YELLOW)Variáveis úteis$(NC): NETWORK_BENCHMARK_SECONDS=600 NETWORK_BENCHMARK_INTERVAL=10 NETWORK_FUNCTIONALITY_PROFILE=full NETWORK_PROXY_MODE=local NETWORK_ENABLE_LOCAL_PROXY=true"
	@echo "$(YELLOW)DNS úteis$(NC): NETWORK_DNS_MODE=local NETWORK_DNS_UPSTREAM_SELECTION=ranked NETWORK_DNS_WRITE_RESOLV_CONF=true"
	@echo "$(YELLOW)Registry$(NC): NETWORK_ENDPOINT_REGISTRY=$(NETWORK_ENDPOINT_REGISTRY)"
	@echo ""

network-health: health-brief

network-registry-status:
	@echo "$(CYAN)📚 Endpoint registry$(NC)"
	@if [ -r "$(NETWORK_ENDPOINT_REGISTRY)" ]; then \
		echo "canonical=$(NETWORK_ENDPOINT_REGISTRY)"; \
		awk -F '	' 'BEGIN{rows=0;bad=0} /^[[:space:]]*#/ || /^[[:space:]]*$$/ {next} {rows++; if (NF != 5 || $$1 !~ /^https:\/\// || $$1 ~ /[[:space:]\\]/ || $$1 ~ /@/ || $$2 == "" || $$3 == "" || $$4 == "" || $$5 == "") bad++} END{printf "rows=%d\nbad=%d\n", rows, bad}' "$(NETWORK_ENDPOINT_REGISTRY)"; \
	elif [ -r "$(NETWORK_ENDPOINT_REGISTRY_LEGACY)" ]; then \
		echo "legacy=$(NETWORK_ENDPOINT_REGISTRY_LEGACY)"; \
		awk -F '	' 'BEGIN{rows=0;bad=0} /^[[:space:]]*#/ || /^[[:space:]]*$$/ {next} {rows++; if (NF != 5 || $$1 !~ /^https:\/\// || $$1 ~ /[[:space:]\\]/ || $$1 ~ /@/ || $$2 == "" || $$3 == "" || $$4 == "" || $$5 == "") bad++} END{printf "rows=%d\nbad=%d\n", rows, bad}' "$(NETWORK_ENDPOINT_REGISTRY_LEGACY)"; \
	else \
		echo "missing=$(NETWORK_ENDPOINT_REGISTRY)"; \
		exit 1; \
	fi

network-state:
	@bash "$(NETWORK_CONTROL_PLANE_SCRIPT)" summary

network-state-status:
	@bash "$(NETWORK_CONTROL_PLANE_SCRIPT)" status

network-state-summary:
	@bash "$(NETWORK_CONTROL_PLANE_SCRIPT)" summary

network-state-report:
	@bash "$(NETWORK_CONTROL_PLANE_SCRIPT)" report

network-state-events:
	@bash "$(NETWORK_CONTROL_PLANE_SCRIPT)" events

network-state-json:
	@bash "$(NETWORK_CONTROL_PLANE_SCRIPT)" json

network-state-doctor:
	@bash "$(NETWORK_CONTROL_PLANE_SCRIPT)" doctor

network-state-strict:
	@bash "$(NETWORK_CONTROL_PLANE_SCRIPT)" --strict summary

network-control-plane: network-state
network-control-plane-status: network-state-status
network-control-plane-summary: network-state-summary
network-control-plane-report: network-state-report
network-control-plane-events: network-state-events
network-control-plane-json: network-state-json
network-control-plane-doctor: network-state-doctor

network-status:
	@echo "$(CYAN)🌐 Network status snapshots$(NC)"
	@DEVCONTAINER_LOCAL_DNS_ACTION=status bash "$(NETWORK_LOCAL_DNS_SCRIPT)" || true
	@DEVCONTAINER_COPILOT_NETWORK_MANAGER_ACTION=status bash "$(NETWORK_MANAGER_SCRIPT)" || true
	@DEVCONTAINER_GITHUB_API_ROUTE_ACTION=status bash "$(NETWORK_ROUTE_SCRIPT)" || true
	@DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION=status bash "$(NETWORK_PROXY_SCRIPT)" || true
	@DEVCONTAINER_COPILOT_ROUTE_ADVISOR_ACTION=status bash "$(NETWORK_ADVISOR_SCRIPT)" || true
	@bash "$(NETWORK_CONTROL_PLANE_SCRIPT)" status || true

network-summary: network-summary-current

network-summary-current:
	@echo "$(CYAN)📄 Current network summaries/recommendations$(NC)"
	@for f in \
		/tmp/devcontainer-health.status \
		/tmp/devcontainer-health.summary \
		/tmp/devcontainer-local-dns-cache.status \
		/tmp/devcontainer-local-dns-cache.summary \
		/tmp/devcontainer-local-dns-cache.metrics.tsv \
		/tmp/devcontainer-local-dns-cache.action.summary \
		/tmp/devcontainer-local-dns-cache.events.tsv \
		/tmp/devcontainer-github-api-route.status \
		/tmp/devcontainer-github-api-route.summary \
		/tmp/devcontainer-github-api-route.action.summary \
		/tmp/devcontainer-github-api-route.benchmark.summary \
		/tmp/devcontainer-github-api-route.recommendation \
		/tmp/devcontainer-copilot-network.status \
		/tmp/devcontainer-copilot-network.summary \
		/tmp/devcontainer-copilot-network.diagnosis.tsv \
		/tmp/devcontainer-copilot-network.recommendation \
		/tmp/devcontainer-copilot-network.recommendation.json \
		/tmp/devcontainer-copilot-proxy.status \
		/tmp/devcontainer-copilot-proxy.summary \
		/tmp/devcontainer-copilot-proxy.benchmark.summary \
		/tmp/devcontainer-copilot-proxy.comparison.tsv \
		/tmp/devcontainer-copilot-proxy.recommendation \
		/tmp/devcontainer-copilot-route-advisor.status \
		/tmp/devcontainer-copilot-route-advisor.summary \
		/tmp/devcontainer-copilot-route-advisor.decisions.tsv \
		/tmp/devcontainer-network-control-plane.status \
		/tmp/devcontainer-network-control-plane.summary \
		/tmp/devcontainer-network-control-plane.report \
		/tmp/devcontainer-network-control-plane.events.tsv \
		/tmp/devcontainer-network-control-plane.state.json; do \
		if [ -r "$$f" ]; then \
			echo ""; echo "===== $$f ====="; cat "$$f"; \
		fi; \
	done

network-summary-boot:
	@echo "$(CYAN)📄 Lifecycle/boot snapshots$(NC)"
	@for f in \
		/tmp/devcontainer-health.summary \
		/tmp/devcontainer-post-create.status \
		/tmp/devcontainer-post-create.summary \
		/tmp/devcontainer-post-create.report \
		/tmp/devcontainer-post-create.events.tsv \
		/tmp/devcontainer-sync-local-auth.status \
		/tmp/devcontainer-sync-local-auth.summary \
		/tmp/devcontainer-sync-local-auth.report \
		/tmp/devcontainer-post-start.summary \
		/tmp/devcontainer-post-start.report \
		/tmp/devcontainer-post-attach.summary \
		/tmp/devcontainer-network-control-plane.summary \
		.devcontainer/.initialized; do \
		if [ -r "$$f" ]; then \
			echo ""; echo "===== $$f ====="; cat "$$f"; \
		fi; \
	done

network-summary-all:
	@$(MAKE) -f "$(firstword $(MAKEFILE_LIST))" network-summary-boot
	@$(MAKE) -f "$(firstword $(MAKEFILE_LIST))" network-summary-current

network-artifacts:
	@echo "$(CYAN)📦 Control-plane artifacts em /tmp$(NC)"
	@ls -lh /tmp/devcontainer-health.* /tmp/devcontainer-post-create.* /tmp/devcontainer-post-start.* /tmp/devcontainer-post-attach.* /tmp/devcontainer-local-dns-cache.* /tmp/devcontainer-github-api-route.* /tmp/devcontainer-copilot-network.* /tmp/devcontainer-copilot-proxy.* /tmp/devcontainer-copilot-route-advisor.* /tmp/devcontainer-network-control-plane.* 2>/dev/null || true

network-syntax:
	@echo "$(CYAN)🔎 bash -n hooks/scripts de rede e health$(NC)"
	@bash -n "$(POST_CREATE_SCRIPT)"
	@bash -n "$(POST_START_SCRIPT)"
	@bash -n "$(POST_ATTACH_SCRIPT)"
	@bash -n "$(HEALTHCHECK_SCRIPT)"
	@bash -n "$(NETWORK_CONTROL_PLANE_SCRIPT)"
	@bash -n "$(NETWORK_LOCAL_DNS_SCRIPT)"
	@bash -n "$(NETWORK_ROUTE_SCRIPT)"
	@bash -n "$(NETWORK_MANAGER_SCRIPT)"
	@bash -n "$(NETWORK_PROXY_SCRIPT)"
	@bash -n "$(NETWORK_ADVISOR_SCRIPT)"
	@echo "$(GREEN)✅ Sintaxe shell OK$(NC)"

network-shellcheck:
	@echo "$(CYAN)🔎 ShellCheck hooks/scripts de rede e health$(NC)"
	@command -v shellcheck >/dev/null 2>&1 || { echo "$(RED)❌ shellcheck não instalado$(NC)"; exit 127; }
	@shellcheck "$(POST_CREATE_SCRIPT)" "$(POST_START_SCRIPT)" "$(POST_ATTACH_SCRIPT)" "$(HEALTHCHECK_SCRIPT)" "$(NETWORK_CONTROL_PLANE_SCRIPT)" \
		"$(NETWORK_LOCAL_DNS_SCRIPT)" "$(NETWORK_ROUTE_SCRIPT)" "$(NETWORK_MANAGER_SCRIPT)" \
		"$(NETWORK_PROXY_SCRIPT)" "$(NETWORK_ADVISOR_SCRIPT)"
	@echo "$(GREEN)✅ ShellCheck OK$(NC)"

network-validate: network-syntax network-shellcheck network-doctor network-state-doctor health-brief
	@echo "$(GREEN)✅ Network control plane validado$(NC)"

network-validate-soft: network-syntax
	@$(MAKE) -f "$(firstword $(MAKEFILE_LIST))" network-shellcheck || true
	@$(MAKE) -f "$(firstword $(MAKEFILE_LIST))" network-doctor-soft || true
	@$(MAKE) -f "$(firstword $(MAKEFILE_LIST))" network-state-doctor || true
	@$(MAKE) -f "$(firstword $(MAKEFILE_LIST))" health-brief || true

network-doctor:
	@echo "$(CYAN)🩺 Network doctor$(NC)"
	@DEVCONTAINER_LOCAL_DNS_ACTION=doctor bash "$(NETWORK_LOCAL_DNS_SCRIPT)" || true
	@DEVCONTAINER_GITHUB_API_ROUTE_ACTION=doctor bash "$(NETWORK_ROUTE_SCRIPT)" || true
	@DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION=doctor bash "$(NETWORK_PROXY_SCRIPT)" || true
	@DEVCONTAINER_COPILOT_ROUTE_ADVISOR_ACTION=doctor bash "$(NETWORK_ADVISOR_SCRIPT)" || true
	@DEVCONTAINER_COPILOT_NETWORK_MANAGER_ACTION=doctor bash "$(NETWORK_MANAGER_SCRIPT)"
	@bash "$(NETWORK_CONTROL_PLANE_SCRIPT)" doctor

network-doctor-soft:
	@echo "$(CYAN)🩺 Network doctor soft$(NC)"
	@DEVCONTAINER_LOCAL_DNS_ACTION=doctor bash "$(NETWORK_LOCAL_DNS_SCRIPT)" || true
	@DEVCONTAINER_GITHUB_API_ROUTE_ACTION=doctor bash "$(NETWORK_ROUTE_SCRIPT)" || true
	@DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION=doctor bash "$(NETWORK_PROXY_SCRIPT)" || true
	@DEVCONTAINER_COPILOT_ROUTE_ADVISOR_ACTION=doctor bash "$(NETWORK_ADVISOR_SCRIPT)" || true
	@DEVCONTAINER_COPILOT_NETWORK_MANAGER_ACTION=doctor bash "$(NETWORK_MANAGER_SCRIPT)" || true
	@bash "$(NETWORK_CONTROL_PLANE_SCRIPT)" doctor || true

network-dns-status:
	@DEVCONTAINER_LOCAL_DNS_ACTION=status bash "$(NETWORK_LOCAL_DNS_SCRIPT)"

network-dns-doctor:
	@DEVCONTAINER_LOCAL_DNS_ACTION=doctor bash "$(NETWORK_LOCAL_DNS_SCRIPT)"

network-dns-benchmark:
	@echo "$(CYAN)📈 Benchmark/ranking de upstreams DNS$(NC)"
	@DEVCONTAINER_LOCAL_DNS_ACTION=benchmark \
		DEVCONTAINER_LOCAL_DNS_MODE="$(NETWORK_DNS_MODE)" \
		DEVCONTAINER_LOCAL_DNS_UPSTREAM_SELECTION="$(NETWORK_DNS_UPSTREAM_SELECTION)" \
		DEVCONTAINER_LOCAL_DNS_FORCE_REBENCHMARK="$(NETWORK_DNS_FORCE_REBENCHMARK)" \
		bash "$(NETWORK_LOCAL_DNS_SCRIPT)"

network-dns-start:
	@echo "$(CYAN)🌐 Start DNS cache local controlado$(NC)"
	@DEVCONTAINER_LOCAL_DNS_ACTION=start \
		DEVCONTAINER_LOCAL_DNS_MODE="$(NETWORK_DNS_MODE)" \
		DEVCONTAINER_LOCAL_DNS_UPSTREAM_SELECTION="$(NETWORK_DNS_UPSTREAM_SELECTION)" \
		DEVCONTAINER_LOCAL_DNS_WRITE_RESOLV_CONF="$(NETWORK_DNS_WRITE_RESOLV_CONF)" \
		bash "$(NETWORK_LOCAL_DNS_SCRIPT)"

network-dns-health:
	@DEVCONTAINER_LOCAL_DNS_ACTION=health \
		DEVCONTAINER_LOCAL_DNS_MODE="$(NETWORK_DNS_MODE)" \
		bash "$(NETWORK_LOCAL_DNS_SCRIPT)"

network-dns-stop:
	@DEVCONTAINER_LOCAL_DNS_ACTION=stop \
		DEVCONTAINER_LOCAL_DNS_MODE="$(NETWORK_DNS_MODE)" \
		bash "$(NETWORK_LOCAL_DNS_SCRIPT)"

network-dns-summary:
	@echo "$(CYAN)📄 DNS cache summaries/metrics$(NC)"
	@for f in \
		/tmp/devcontainer-local-dns-cache.status \
		/tmp/devcontainer-local-dns-cache.summary \
		/tmp/devcontainer-local-dns-cache.metrics.tsv \
		/tmp/devcontainer-local-dns-cache.action.summary \
		/tmp/devcontainer-local-dns-cache.events.tsv \
		/tmp/devcontainer-local-dns-cache.report; do \
		if [ -r "$$f" ]; then \
			echo ""; echo "===== $$f ====="; cat "$$f"; \
		fi; \
	done

network-dns-lock-diagnose:
	@echo "$(CYAN)🔐 DNS lock/process diagnostics$(NC)"
	@echo "===== LOCK ====="; ls -l /tmp/devcontainer-network/local-dns-cache.lock 2>/dev/null || true
	@echo ""; echo "===== LSOF ====="; lsof /tmp/devcontainer-network/local-dns-cache.lock 2>/dev/null || true
	@echo ""; echo "===== FUSER ====="; fuser -v /tmp/devcontainer-network/local-dns-cache.lock 2>/dev/null || true
	@echo ""; echo "===== PROCESSES ====="; ps -ef | grep -E 'local-dns-cache|dnsmasq' | grep -v grep || true
	@echo ""; echo "===== RESOLV.CONF ====="; cat /etc/resolv.conf 2>/dev/null || true

network-route-status:
	@DEVCONTAINER_GITHUB_API_ROUTE_ACTION=status bash "$(NETWORK_ROUTE_SCRIPT)"

network-route-doctor:
	@DEVCONTAINER_GITHUB_API_ROUTE_ACTION=doctor bash "$(NETWORK_ROUTE_SCRIPT)"

network-route-summary:
	@echo "$(CYAN)📄 GitHub API route summaries/metrics$(NC)"
	@for f in \
		/tmp/devcontainer-github-api-route.status \
		/tmp/devcontainer-github-api-route.summary \
		/tmp/devcontainer-github-api-route.metrics.tsv \
		/tmp/devcontainer-github-api-route.action.summary \
		/tmp/devcontainer-github-api-route.benchmark.summary \
		/tmp/devcontainer-github-api-route.recommendation \
		/tmp/devcontainer-github-api-route.report; do \
		if [ -r "$$f" ]; then \
			echo ""; echo "===== $$f ====="; cat "$$f"; \
		fi; \
	done

network-route-probe:
	@DEVCONTAINER_GITHUB_API_ROUTE_ACTION=probe \
		DEVCONTAINER_GITHUB_API_ROUTE_DRY_RUN=true \
		DEVCONTAINER_GITHUB_API_FUNCTIONALITY_PROFILE="$${DEVCONTAINER_GITHUB_API_FUNCTIONALITY_PROFILE:-copilot}" \
		bash "$(NETWORK_ROUTE_SCRIPT)"

network-route-benchmark:
	@echo "$(CYAN)📈 Benchmark prolongado api.github.com$(NC)"
	@DEVCONTAINER_GITHUB_API_ROUTE_ACTION=benchmark \
		DEVCONTAINER_GITHUB_API_FUNCTIONALITY_PROFILE="$(NETWORK_FUNCTIONALITY_PROFILE)" \
		DEVCONTAINER_GITHUB_API_BENCHMARK_DURATION_SECONDS="$(NETWORK_BENCHMARK_SECONDS)" \
		DEVCONTAINER_GITHUB_API_BENCHMARK_INTERVAL_SECONDS="$(NETWORK_BENCHMARK_INTERVAL)" \
		DEVCONTAINER_GITHUB_API_BENCHMARK_MAX_SAMPLES="$(NETWORK_BENCHMARK_MAX_SAMPLES)" \
		bash "$(NETWORK_ROUTE_SCRIPT)"

network-proxy-status:
	@DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION=status bash "$(NETWORK_PROXY_SCRIPT)"

network-proxy-doctor:
	@DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION=doctor bash "$(NETWORK_PROXY_SCRIPT)"

network-proxy-env:
	@DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION=env bash "$(NETWORK_PROXY_SCRIPT)"

network-proxy-start:
	@DEVCONTAINER_ENABLE_LOCAL_COPILOT_PROXY="$(NETWORK_ENABLE_LOCAL_PROXY)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION=start \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_MODE="$(NETWORK_PROXY_MODE)" \
		bash "$(NETWORK_PROXY_SCRIPT)"

network-proxy-stop:
	@DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION=stop bash "$(NETWORK_PROXY_SCRIPT)"

network-proxy-benchmark:
	@echo "$(CYAN)📈 Benchmark proxy-local$(NC)"
	@DEVCONTAINER_ENABLE_LOCAL_COPILOT_PROXY="$(NETWORK_ENABLE_LOCAL_PROXY)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION=benchmark \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_MODE="$(NETWORK_PROXY_MODE)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_DURATION_SECONDS="$(NETWORK_BENCHMARK_SECONDS)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_INTERVAL_SECONDS="$(NETWORK_BENCHMARK_INTERVAL)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_MAX_SAMPLES="$(NETWORK_BENCHMARK_MAX_SAMPLES)" \
		bash "$(NETWORK_PROXY_SCRIPT)"

network-proxy-compare:
	@echo "$(CYAN)⚖️  A/B direct vs proxy-local$(NC)"
	@DEVCONTAINER_ENABLE_LOCAL_COPILOT_PROXY="$(NETWORK_ENABLE_LOCAL_PROXY)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION=compare \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_MODE="$(NETWORK_PROXY_MODE)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_DURATION_SECONDS="$(NETWORK_BENCHMARK_SECONDS)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_INTERVAL_SECONDS="$(NETWORK_BENCHMARK_INTERVAL)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_MAX_SAMPLES="$(NETWORK_BENCHMARK_MAX_SAMPLES)" \
		bash "$(NETWORK_PROXY_SCRIPT)"

network-proxy-compare-quick:
	@echo "$(CYAN)⚖️  A/B curto direct vs proxy-local — 120s fixos$(NC)"
	@DEVCONTAINER_ENABLE_LOCAL_COPILOT_PROXY="$(NETWORK_ENABLE_LOCAL_PROXY)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION=compare \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_MODE="$(NETWORK_PROXY_MODE)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_DURATION_SECONDS="120" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_INTERVAL_SECONDS="10" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_MAX_SAMPLES="$(NETWORK_BENCHMARK_MAX_SAMPLES)" \
		bash "$(NETWORK_PROXY_SCRIPT)"

network-proxy-summary:
	@echo "$(CYAN)📄 Proxy summaries/comparison$(NC)"
	@for f in \
		/tmp/devcontainer-copilot-proxy.status \
		/tmp/devcontainer-copilot-proxy.summary \
		/tmp/devcontainer-copilot-proxy.benchmark.summary \
		/tmp/devcontainer-copilot-proxy.comparison.tsv \
		/tmp/devcontainer-copilot-proxy.recommendation; do \
		if [ -r "$$f" ]; then \
			echo ""; echo "===== $$f ====="; cat "$$f"; \
		fi; \
	done

network-proxy-lock-diagnose:
	@echo "$(CYAN)🔐 Proxy lock/process diagnostics$(NC)"
	@echo "===== LOCK ====="; ls -l /tmp/devcontainer-network/tinyproxy-copilot.lock 2>/dev/null || true
	@echo ""; echo "===== LSOF ====="; lsof /tmp/devcontainer-network/tinyproxy-copilot.lock 2>/dev/null || true
	@echo ""; echo "===== FUSER ====="; fuser -v /tmp/devcontainer-network/tinyproxy-copilot.lock 2>/dev/null || true
	@echo ""; echo "===== PROCESSES ====="; ps -ef | grep -E 'local-copilot-proxy|tinyproxy' | grep -v grep || true

network-advisor-status:
	@DEVCONTAINER_COPILOT_ROUTE_ADVISOR_ACTION=status bash "$(NETWORK_ADVISOR_SCRIPT)"

network-advisor-doctor:
	@DEVCONTAINER_COPILOT_ROUTE_ADVISOR_ACTION=doctor bash "$(NETWORK_ADVISOR_SCRIPT)"

network-advisor-probe:
	@DEVCONTAINER_COPILOT_ROUTE_ADVISOR_ACTION=probe bash "$(NETWORK_ADVISOR_SCRIPT)"

network-advisor-summary:
	@echo "$(CYAN)📄 Copilot Route Advisor summaries/metrics$(NC)"
	@for f in \
		/tmp/devcontainer-copilot-route-advisor.status \
		/tmp/devcontainer-copilot-route-advisor.summary \
		/tmp/devcontainer-copilot-route-advisor.metrics.tsv \
		/tmp/devcontainer-copilot-route-advisor.decisions.tsv \
		/tmp/devcontainer-copilot-route-advisor.report; do \
		if [ -r "$$f" ]; then \
			echo ""; echo "===== $$f ====="; cat "$$f"; \
		fi; \
	done

network-manager-status:
	@DEVCONTAINER_COPILOT_NETWORK_MANAGER_ACTION=status bash "$(NETWORK_MANAGER_SCRIPT)"

network-manager-doctor:
	@DEVCONTAINER_COPILOT_NETWORK_MANAGER_ACTION=doctor bash "$(NETWORK_MANAGER_SCRIPT)"
	@bash "$(NETWORK_CONTROL_PLANE_SCRIPT)" doctor

network-manager-summary:
	@echo "$(CYAN)📄 Copilot Network Manager summaries/diagnosis$(NC)"
	@for f in \
		/tmp/devcontainer-copilot-network.status \
		/tmp/devcontainer-copilot-network.summary \
		/tmp/devcontainer-copilot-network.diagnosis.tsv \
		/tmp/devcontainer-copilot-network.recommendation \
		/tmp/devcontainer-copilot-network.recommendation.json \
		/tmp/devcontainer-copilot-network.report; do \
		if [ -r "$$f" ]; then \
			echo ""; echo "===== $$f ====="; cat "$$f"; \
		fi; \
	done

network-manager-recommend:
	@DEVCONTAINER_COPILOT_NETWORK_MANAGER_ACTION=recommend \
		DEVCONTAINER_COPILOT_TRANSPORT_PROFILE="$(NETWORK_TRANSPORT_PROFILE)" \
		bash "$(NETWORK_MANAGER_SCRIPT)"
	@$(MAKE) -f "$(firstword $(MAKEFILE_LIST))" network-summary-current

network-manager-benchmark:
	@echo "$(CYAN)📈 Benchmark coordenado manager$(NC)"
	@DEVCONTAINER_ENABLE_LOCAL_COPILOT_PROXY="$(NETWORK_ENABLE_LOCAL_PROXY)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_MODE="$(NETWORK_PROXY_MODE)" \
		DEVCONTAINER_COPILOT_NETWORK_MANAGER_ACTION=benchmark \
		DEVCONTAINER_COPILOT_TRANSPORT_PROFILE="$(NETWORK_TRANSPORT_PROFILE)" \
		DEVCONTAINER_COPILOT_NETWORK_BENCHMARK_DURATION_SECONDS="$(NETWORK_BENCHMARK_SECONDS)" \
		DEVCONTAINER_COPILOT_NETWORK_BENCHMARK_INTERVAL_SECONDS="$(NETWORK_BENCHMARK_INTERVAL)" \
		DEVCONTAINER_COPILOT_NETWORK_BENCHMARK_MAX_SAMPLES="$(NETWORK_BENCHMARK_MAX_SAMPLES)" \
		bash "$(NETWORK_MANAGER_SCRIPT)"

network-manager-benchmark-quick:
	@echo "$(CYAN)📈 Benchmark coordenado manager — 180s fixos$(NC)"
	@DEVCONTAINER_ENABLE_LOCAL_COPILOT_PROXY="$(NETWORK_ENABLE_LOCAL_PROXY)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_MODE="$(NETWORK_PROXY_MODE)" \
		DEVCONTAINER_COPILOT_NETWORK_MANAGER_ACTION=benchmark \
		DEVCONTAINER_COPILOT_TRANSPORT_PROFILE="$(NETWORK_TRANSPORT_PROFILE)" \
		DEVCONTAINER_COPILOT_NETWORK_BENCHMARK_DURATION_SECONDS="180" \
		DEVCONTAINER_COPILOT_NETWORK_BENCHMARK_INTERVAL_SECONDS="10" \
		DEVCONTAINER_COPILOT_NETWORK_BENCHMARK_MAX_SAMPLES="0" \
		bash "$(NETWORK_MANAGER_SCRIPT)"

network-manager-compare:
	@echo "$(CYAN)⚖️  Manager compare-transports$(NC)"
	@DEVCONTAINER_ENABLE_LOCAL_COPILOT_PROXY="$(NETWORK_ENABLE_LOCAL_PROXY)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_MODE="$(NETWORK_PROXY_MODE)" \
		DEVCONTAINER_COPILOT_NETWORK_MANAGER_ACTION=compare-transports \
		DEVCONTAINER_COPILOT_NETWORK_BENCHMARK_DURATION_SECONDS="$(NETWORK_BENCHMARK_SECONDS)" \
		DEVCONTAINER_COPILOT_NETWORK_BENCHMARK_INTERVAL_SECONDS="$(NETWORK_BENCHMARK_INTERVAL)" \
		DEVCONTAINER_COPILOT_NETWORK_BENCHMARK_MAX_SAMPLES="$(NETWORK_BENCHMARK_MAX_SAMPLES)" \
		bash "$(NETWORK_MANAGER_SCRIPT)"

network-manager-compare-quick:
	@echo "$(CYAN)⚖️  Manager compare-transports — 120s fixos$(NC)"
	@DEVCONTAINER_ENABLE_LOCAL_COPILOT_PROXY="$(NETWORK_ENABLE_LOCAL_PROXY)" \
		DEVCONTAINER_LOCAL_COPILOT_PROXY_MODE="$(NETWORK_PROXY_MODE)" \
		DEVCONTAINER_COPILOT_NETWORK_MANAGER_ACTION=compare-transports \
		DEVCONTAINER_COPILOT_NETWORK_BENCHMARK_DURATION_SECONDS="120" \
		DEVCONTAINER_COPILOT_NETWORK_BENCHMARK_INTERVAL_SECONDS="10" \
		DEVCONTAINER_COPILOT_NETWORK_BENCHMARK_MAX_SAMPLES="0" \
		bash "$(NETWORK_MANAGER_SCRIPT)"

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

.PHONY: test test-unit test-integration test-regression test-e2e test-watch test-coverage test-all

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

test-regression:
	@echo "$(GREEN)🧪 Testes de Regressão$(NC)"
	@$(NPM) run test:regression
	@echo "$(GREEN)✅ Testes de regressão passaram$(NC)"

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
# 9️⃣.1 RAG & MCP
# =============================================================================

.PHONY: mcp-diagnose copilot-mcp-up copilot-mcp-down copilot-mcp-restart copilot-mcp-h2-up copilot-mcp-h2-restart copilot-mcp-h2-status copilot-mcp-h2-remote-audit copilot-mcp-h2-canary copilot-mcp-h2-migrate copilot-mcp-http1-rollback copilot-mcp-status copilot-mcp-remote-audit copilot-mcp-origin-plan copilot-mcp-h2-origin-plan copilot-mcp-h2-origin-apply-dry-run copilot-mcp-h2-origin-apply copilot-mcp-smoke copilot-mcp-smoke-refresh copilot-mcp-oauth-smoke lsp-health semantic-preflight rag-help audit-help rag-preflight rag-health rag-index rag-index-code-config rag-index-docs rag-ask rag-hybrid rag-expand rag-reset rag-watch rag-full-rebuild rag-rebuild-zero rag-rebuild-code-config rag-rebuild-code-config-strict

rag-help:
	@echo ""
	@echo "$(BLUE)$(BOLD)🧠 RAG — Guia Operacional$(NC)"
	@echo "  1) Pré-check:      make rag-preflight"
	@echo "  2) Build code:     make rag-rebuild-code-config"
	@echo "  3) Build docs:     make rag-index-docs"
	@echo "  4) Saúde final:    make rag-health"
	@echo ""
	@echo "$(CYAN)Escopo dinâmico$(NC): RAG_PROFILE, RAG_DOCS_MODE, RAG_MAX_FILE_BYTES,"
	@echo "                  RAG_INCLUDE_GLOBS='src/**,scripts/**', RAG_EXCLUDE_GLOBS='docs/**'"
	@echo ""
	@echo "$(CYAN)Exemplo$(NC): make rag-index RAG_PROFILE=full RAG_DOCS_MODE=exclude RAG_INCLUDE_GLOBS='src/**,scripts/**'"
	@echo ""

audit-help:
	@echo ""
	@echo "$(BLUE)$(BOLD)🛡️ Audit — Guia Operacional$(NC)"
	@echo "  1) Pré-check:      make audit-ready"
	@echo "  2) Delta rápido:   make audit-quick"
	@echo "  3) Profundo local: make audit-deep"
	@echo "  4) Noturno:        make audit-nightly"
	@echo "  5) $(BOLD)Máximo sem rebuild de contexto$(NC): make audit-nightly-max-no-docs"
	@echo ""
	@echo "$(CYAN)Observabilidade$(NC): make audit-run-last | make audit-progress RUN_ID='<id>' | make audit-events-tail RUN_ID='<id>'"
	@echo ""
	@echo "$(CYAN)Modo rápido sem docs/refresh$(NC): make audit-nightly-no-docs"
	@echo "$(CYAN)Modo máximo sem docs/refresh$(NC): make audit-nightly-max-no-docs"
	@echo "$(CYAN)Comando executado$(NC): npm run audit:nightly -- --refresh-context skip --proposal-depth deep --propose-diffs true --focus all --contracts-mode hybrid --chaos-profile full --cloud-fallback on --contract-coverage-report true --log-format jsonl --heartbeat-ms 5000 --shadow-gate true"
	@echo ""

rag-preflight:
	@echo "$(CYAN)🧭 RAG preflight (MCP + LSP + preflight semântico + health)$(NC)"
	@$(NPM) run mcp:diagnose
	@$(NPM) run lsp:health -- --json
	@$(NPM) run audit:preflight
	@$(NPM) run rag:health -- --json || true

mcp-diagnose:
	@echo "$(CYAN)🔍 Diagnóstico MCP$(NC)"
	@$(NPM) run mcp:diagnose

copilot-mcp-up:
	@echo "$(CYAN)🔐 Subindo MCP OAuth + Cloudflare permanente$(NC)"
	@$(NPM) run copilot:mcp:up

copilot-mcp-down:
	@echo "$(CYAN)🛑 Encerrando MCP + Cloudflare permanente$(NC)"
	@$(NPM) run copilot:mcp:cloudflare:down

copilot-mcp-restart:
	@echo "$(CYAN)🔁 Reiniciando MCP OAuth + Cloudflare permanente$(NC)"
	@$(NPM) run copilot:mcp:restart

copilot-mcp-status:
	@echo "$(CYAN)📡 Status MCP + Cloudflare permanente$(NC)"
	@$(NPM) run copilot:mcp:status

copilot-mcp-h2-status:
	@echo "$(CYAN)📡 Status MCP + Cloudflare permanente em origin HTTPS/HTTP2$(NC)"
	@$(NPM) run copilot:mcp:h2:status

copilot-mcp-h2-restart:
	@echo "$(CYAN)🚀 Reiniciando MCP OAuth + Cloudflare com origin HTTPS/HTTP2$(NC)"
	@$(NPM) run copilot:mcp:h2:restart

copilot-mcp-h2-up:
	@echo "$(CYAN)🚀 Subindo MCP OAuth + Cloudflare com origin HTTPS/HTTP2$(NC)"
	@$(NPM) run copilot:mcp:h2:up

copilot-mcp-remote-audit:
	@echo "$(CYAN)☁️  Auditoria remota Cloudflare MCP$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token $(NPM) run copilot:mcp:cloudflare:remote-audit

copilot-mcp-origin-plan:
	@echo "$(CYAN)🧭 Plano de origin remoto Cloudflare MCP$(NC)"
	@$(NPM) run copilot:mcp:cloudflare:origin-plan

copilot-mcp-h2-origin-plan:
	@echo "$(CYAN)🧭 Plano de origin remoto HTTPS/HTTP2 Cloudflare MCP$(NC)"
	@$(NPM) run copilot:mcp:cloudflare:h2-origin-plan

copilot-mcp-h2-origin-apply-dry-run:
	@echo "$(CYAN)🧪 Dry-run da aplicação do origin HTTPS/HTTP2 no named tunnel$(NC)"
	@$(NPM) run copilot:mcp:cloudflare:h2-origin-apply:dry-run

copilot-mcp-h2-origin-apply:
	@echo "$(YELLOW)⚠️  Aplicando origin HTTPS/HTTP2 no named tunnel Cloudflare$(NC)"
	@$(NPM) run copilot:mcp:cloudflare:h2-origin-apply

copilot-mcp-h2-remote-audit:
	@echo "$(CYAN)☁️  Auditoria remota Cloudflare MCP em perfil HTTPS/HTTP2$(NC)"
	@$(NPM) run copilot:mcp:cloudflare:h2-remote-audit

copilot-mcp-h2-canary:
	@echo "$(CYAN)🧪 Canary HTTPS/HTTP2 MCP: remote audit + smoke + status$(NC)"
	@$(NPM) run copilot:mcp:cloudflare:h2-canary

copilot-mcp-h2-migrate:
	@echo "$(YELLOW)⚠️  Fluxo canônico completo para migrar o origin MCP para HTTPS/HTTP2$(NC)"
	@$(NPM) run copilot:mcp:cloudflare:h2-migrate

copilot-mcp-http1-rollback:
	@echo "$(YELLOW)↩️  Rollback canônico do origin MCP para HTTP/1$(NC)"
	@$(NPM) run copilot:mcp:cloudflare:http1-rollback

copilot-mcp-config-audit:
	@echo "$(CYAN)🧭 Auditoria Cloudflare Config/Products MCP$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token $(NPM) run copilot:mcp:cloudflare:config-audit

copilot-mcp-skip-audit:
	@echo "$(CYAN)⏭️  Auditoria Cloudflare Skip/Non-interference MCP$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token $(NPM) run copilot:mcp:cloudflare:skip-audit

copilot-mcp-passthrough-plan:
	@echo "$(CYAN)🧭 Plano Cloudflare MCP passthrough config$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token $(NPM) run copilot:mcp:cloudflare:mcp-passthrough:plan

copilot-mcp-passthrough-diff:
	@echo "$(CYAN)🧮 Diff Cloudflare MCP passthrough config$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token $(NPM) run copilot:mcp:cloudflare:mcp-passthrough:diff

copilot-mcp-edge-audit:
	@echo "$(CYAN)🛡️  Auditoria Cloudflare Edge/Rulesets MCP$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token $(NPM) run copilot:mcp:cloudflare:edge-audit

copilot-mcp-edge-backup-create:
	@echo "$(CYAN)💾 Backup local Cloudflare Edge MCP$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token $(NPM) run copilot:mcp:cloudflare:edge-backup-create

copilot-mcp-edge-backup-list:
	@echo "$(CYAN)📚 Backups locais Cloudflare Edge MCP$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token $(NPM) run copilot:mcp:cloudflare:edge-backup-list

copilot-mcp-edge-policy-apply:
	@echo "$(CYAN)🧯 Dry-run aplicador Cloudflare Edge MCP$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token $(NPM) run copilot:mcp:cloudflare:edge-policy-apply

copilot-mcp-edge-policy-diff:
	@echo "$(CYAN)🧮 Diff Cloudflare Edge actual vs desired MCP$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token $(NPM) run copilot:mcp:cloudflare:edge-policy-diff

copilot-mcp-edge-policy-plan:
	@echo "$(CYAN)🧭 Plano Cloudflare Edge policy MCP$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token $(NPM) run copilot:mcp:cloudflare:edge-policy-plan

copilot-mcp-edge-snapshot:
	@echo "$(CYAN)📦 Snapshot Cloudflare Edge MCP$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token $(NPM) run copilot:mcp:cloudflare:edge-snapshot

copilot-mcp-smoke:
	@echo "$(CYAN)🧪 Smoke MCP tools/list público$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token $(NPM) run copilot:mcp:cloudflare:smoke

copilot-mcp-smoke-refresh:
	@echo "$(CYAN)🧪 Atualizando smoke persistido do MCP público$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token $(NPM) run copilot:mcp:cloudflare:smoke:refresh

copilot-mcp-oauth-smoke:
	@echo "$(CYAN)🔐 Smoke OAuth MCP público$(NC)"
	@COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_FILE=src/copilot/.ai/mcp/oauth-refresh-tokens.json COPILOT_MCP_DEV_OAUTH_CLIENT_FILE=src/copilot/.ai/mcp/oauth-clients.json $(NPM) run copilot:mcp:oauth:smoke:persistent

lsp-health:
	@echo "$(CYAN)🔍 Diagnóstico funcional LSP$(NC)"
	@$(NPM) run lsp:health -- --json

semantic-preflight:
	@echo "$(CYAN)🧭 Preflight semântico (PM2/MCP/RAG/LSP)$(NC)"
	@$(NPM) run audit:preflight

rag-health:
	@echo "$(CYAN)🔍 RAG Health$(NC)"
	@$(NPM) run rag:health

rag-index:
	@echo "$(CYAN)📚 RAG Index$(NC)"
	@$(NPM) run rag:index -- $(RAG_SCOPE_ARGS)

rag-index-code-config:
	@echo "$(CYAN)📚 RAG Index (code/config only, sem docs)$(NC)"
	@$(NPM) run rag:index -- --profile full --docs-mode exclude $(RAG_FILTER_ARGS)

rag-index-docs:
	@echo "$(CYAN)📚 RAG Index (docs only)$(NC)"
	@$(NPM) run rag:index -- --profile full --docs-mode only $(RAG_FILTER_ARGS)

rag-ask:
	@if [ -z "$(QUERY)" ]; then \
		echo "$(RED)❌ Informe QUERY. Ex: make rag-ask QUERY='mcp timeout'$(NC)"; \
		exit 1; \
	fi
	@$(NPM) run rag:ask -- "$(QUERY)"

rag-hybrid:
	@if [ -z "$(QUERY)" ]; then \
		echo "$(RED)❌ Informe QUERY. Ex: make rag-hybrid QUERY='tool registry'$(NC)"; \
		exit 1; \
	fi
	@$(NPM) run rag:hybrid -- "$(QUERY)"

rag-expand:
	@if [ -z "$(CHUNK_ID)" ]; then \
		echo "$(RED)❌ Informe CHUNK_ID. Ex: make rag-expand CHUNK_ID='abc123'$(NC)"; \
		exit 1; \
	fi
	@$(NPM) run rag:expand -- --chunk-id "$(CHUNK_ID)" $(if $(MODE),--mode "$(MODE)",) $(if $(BEFORE),--before-lines "$(BEFORE)",) $(if $(AFTER),--after-lines "$(AFTER)",)

rag-reset:
	@echo "$(YELLOW)♻️  RAG Reset$(NC)"
	@$(NPM) run rag:reset

rag-watch:
	@echo "$(CYAN)👀 RAG Watch (incremental)$(NC)"
	@$(NPM) run rag:watch -- $(RAG_SCOPE_ARGS)

rag-full-rebuild:
	@echo "$(YELLOW)♻️  RAG Full Rebuild$(NC)"
	@$(NPM) run rag:reset -- --yes
	@$(NPM) run rag:index -- $(RAG_SCOPE_ARGS)

rag-rebuild-zero:
	@echo "$(YELLOW)♻️  RAG Rebuild Zero (PM2/MCP/RAG pipeline)$(NC)"
	@$(NPM) run rag:rebuild:zero -- $(RAG_SCOPE_ARGS)

rag-rebuild-code-config:
	@echo "$(YELLOW)♻️  RAG Rebuild Zero (code/config, sem docs)$(NC)"
	@$(NPM) run rag:rebuild:code-config

rag-rebuild-code-config-strict:
	@echo "$(YELLOW)♻️  RAG Rebuild Zero estrito (extensões de código/config)$(NC)"
	@$(NPM) run rag:rebuild:zero -- --profile full --docs-mode exclude \
		--include-glob "**/*.js" --include-glob "**/*.mjs" --include-glob "**/*.cjs" \
		--include-glob "**/*.ts" --include-glob "**/*.json" \
		--include-glob "**/*.yml" --include-glob "**/*.yaml" \
		--include-glob "**/*.sh" --include-glob "**/*.ps1" \
		--include-glob "**/Dockerfile" --include-glob "**/Makefile"

# =============================================================================
# MODEL GATEWAY BYOK — COMANDOS CANÔNICOS PRE-BUILD
# =============================================================================

.PHONY: model-gateway-help model-gateway-commands model-gateway-commands-json model-gateway-lint model-gateway-typecheck model-gateway-test-contracts model-gateway-test-terminal model-gateway-validate model-gateway-prebuild model-gateway-build model-gateway-metadata-build model-gateway-metadata-build-plan model-gateway-metadata-build-preview model-gateway-catalog-integrity model-gateway-redaction-audit model-gateway-selection-audit model-gateway-effective-selection model-gateway-effective-selection-trace model-gateway-selection-trace-diff model-gateway-selection-trace-retention model-gateway-runtime-selector model-gateway-auto-status model-gateway-auto-plan model-gateway-auto-ready model-gateway-auto-doctor model-gateway-auto-explain model-gateway-auto-handoffs model-gateway-auto-confirmations model-gateway-auto-recoveries model-gateway-auto-scenarios model-gateway-live-readiness model-gateway-live-auto-probe model-gateway-live-runs model-gateway-live-llm-b model-gateway-refresh model-gateway-refresh-preview model-gateway-refresh-plan model-gateway-refresh-provider model-gateway-refresh-log model-gateway-refresh-log-sqlite model-gateway-runtime-health-diff model-gateway-runtime-health-clear model-gateway-runtime-health-mirror model-gateway-sqlite-diagnostics model-gateway-sqlite-retention model-gateway-sqlite-retention-apply model-gateway-terminal

model-gateway-help: model-gateway-commands

model-gateway-commands:
	@$(NPM) run model-gateway:commands

model-gateway-commands-json:
	@$(NPM) run model-gateway:commands:json

model-gateway-lint:
	@$(NPM) run model-gateway:lint

model-gateway-typecheck:
	@$(NPM) run model-gateway:typecheck

model-gateway-test-contracts:
	@$(NPM) run model-gateway:test:contracts

model-gateway-test-terminal:
	@$(NPM) run model-gateway:test:terminal

model-gateway-validate:
	@$(NPM) run model-gateway:validate

model-gateway-prebuild:
	@$(NPM) run model-gateway:prebuild

model-gateway-build:
	@$(NPM) run model-gateway:build

model-gateway-metadata-build:
	@$(NPM) run model-gateway:metadata:build

model-gateway-metadata-build-plan:
	@$(NPM) run model-gateway:metadata:build:plan

model-gateway-metadata-build-preview:
	@$(NPM) run model-gateway:metadata:build:preview

model-gateway-catalog-integrity:
	@$(NPM) run model-gateway:catalog:integrity

model-gateway-redaction-audit:
	@$(NPM) run model-gateway:redaction:audit

model-gateway-selection-audit:
	@$(NPM) run model-gateway:selection:audit

model-gateway-effective-selection:
	@$(NPM) run model-gateway:selection:effective

model-gateway-effective-selection-trace:
	@$(NPM) run model-gateway:selection:effective:trace

model-gateway-selection-trace-diff:
	@$(NPM) run model-gateway:selection:trace-diff

model-gateway-selection-trace-retention:
	@$(NPM) run model-gateway:selection:trace-retention

model-gateway-runtime-selector:
	@$(NPM) run model-gateway:runtime-selector

model-gateway-auto-status:
	@$(NPM) run model-gateway:auto:status

model-gateway-auto-plan:
	@$(NPM) run model-gateway:auto:plan

model-gateway-auto-ready:
	@$(NPM) run model-gateway:auto:ready

model-gateway-auto-doctor:
	@$(NPM) run model-gateway:auto:doctor

model-gateway-auto-explain:
	@$(NPM) run model-gateway:auto:explain

model-gateway-auto-handoffs:
	@$(NPM) run model-gateway:auto:handoffs

model-gateway-auto-confirmations:
	@$(NPM) run model-gateway:auto:confirmations

model-gateway-auto-recoveries:
	@$(NPM) run model-gateway:auto:recoveries

model-gateway-auto-proof-plan:
	@$(NPM) run model-gateway:auto:proof-plan

model-gateway-auto-standby:
	@$(NPM) run model-gateway:auto:standby

model-gateway-auto-scenarios:
	@$(NPM) run model-gateway:auto:scenarios

model-gateway-ops:
	@$(NPM) run model-gateway:ops

model-gateway-runtime-health-diff:
	@$(NPM) run model-gateway:runtime-health:diff

model-gateway-runtime-health-clear:
	@$(NPM) run model-gateway:runtime-health:clear -- $(ARGS)

model-gateway-live-readiness:
	@$(NPM) run model-gateway:live:readiness

model-gateway-live-llm-b:
	@$(NPM) run model-gateway:live:llm-b

model-gateway-live-plan:
	@$(NPM) run model-gateway:live:plan

model-gateway-live-auto-probe:
	@$(NPM) run model-gateway:live:auto-probe

model-gateway-live-runs:
	@$(NPM) run model-gateway:live:runs

model-gateway-refresh:
	@$(NPM) run model-gateway:refresh

model-gateway-refresh-preview:
	@$(NPM) run model-gateway:refresh:preview

model-gateway-refresh-plan:
	@$(NPM) run model-gateway:refresh:plan

model-gateway-refresh-log:
	@$(NPM) run model-gateway:refresh:log

model-gateway-refresh-log-sqlite:
	@$(NPM) run model-gateway:refresh:log:sqlite

model-gateway-runtime-health-mirror:
	@$(NPM) run model-gateway:runtime-health:mirror

model-gateway-sqlite-diagnostics:
	@$(NPM) run model-gateway:sqlite:diagnostics

model-gateway-sqlite-retention:
	@$(NPM) run model-gateway:sqlite:retention

model-gateway-sqlite-retention-apply:
	@$(NPM) run model-gateway:sqlite:retention:apply

model-gateway-refresh-provider:
	@if [ -z "$(PROVIDER)" ]; then \
		echo "$(RED)Uso: make model-gateway-refresh-provider PROVIDER=openrouter [ARGS='--force']$(NC)"; \
		exit 2; \
	fi
	@$(NPM) run model-gateway:refresh -- --provider=$(PROVIDER) $(ARGS)

model-gateway-terminal:
	@echo "$(CYAN)Abra o cockpit e use: /byok gateway commands$(NC)"
	@$(NPM) run terminal:llm-b

# =============================================================================
# 🔟 FORMATAÇÃO & LINT
# =============================================================================

.PHONY: format format-check jsdoc-coverage jsdoc-delta jsdoc-gaps lint lint-fix lint-quiet lint-report lint-src lint-tests typecheck-node typecheck-browser typecheck-full typecheck-dashboard typecheck-repo analyze-typing-gaps check-ts-expect-error check-base-strict typing-fullstrict-check test-audit-quality

format:
	@echo "$(CYAN)🎨 Formatando código (Prettier)$(NC)"
	@$(NPM) run format
	@echo "$(GREEN)✅ Código formatado$(NC)"

format-check:
	@echo "$(CYAN)🔍 Verificando formatação$(NC)"
	@$(NPM) run format:check
	@echo "$(GREEN)✅ Formatação OK$(NC)"

jsdoc-coverage:
	@echo "$(CYAN)📘 Cobertura JSDoc (full)$(NC)"
	@$(NPM) run jsdoc:coverage

jsdoc-delta:
	@echo "$(CYAN)📘 Cobertura JSDoc (delta)$(NC)"
	@$(NPM) run jsdoc:delta

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

typecheck-node:
	@echo "$(CYAN)🔎 Typecheck Node/Audit (tsconfig.json)$(NC)"
	@$(NPM) run typecheck:node

typecheck-browser:
	@echo "$(CYAN)🔎 Typecheck Browser/UI (tsconfig.browser.json)$(NC)"
	@$(NPM) run typecheck:browser

typecheck-full:
	@echo "$(CYAN)🔎 Typecheck completo (Node + Browser/UI)$(NC)"
	@$(NPM) run typecheck:full

typecheck-dashboard:
	@echo "$(CYAN)🔎 Typecheck Dashboard (vue-tsc --noEmit)$(NC)"
	@$(NPM) run typecheck:dashboard

typecheck-repo:
	@echo "$(CYAN)🔎 Typecheck repo completo (full + tests + dashboard)$(NC)"
	@$(NPM) run typecheck:repo

analyze-typing-gaps:
	@echo "$(CYAN)📊 Analisando gaps de tipagem$(NC)"
	@$(NPM) run analyze:typing:gaps

jsdoc-gaps:
	@echo "$(CYAN)📊 JSDoc gaps (símbolos bloqueadores por lote)$(NC)"
	@$(NPM) run jsdoc:coverage:gaps

check-ts-expect-error:
	@echo "$(CYAN)🔍 Gate CI: @ts-expect-error allowlist$(NC)"
	@$(NPM) run check:ts-expect-error

check-base-strict:
	@echo "$(CYAN)🔍 Gate CI: tsconfig.base.json strict$(NC)"
	@$(NPM) run check:base-strict

typing-fullstrict-check:
	@echo "$(CYAN)🎟️ Full-Strict Check: todos os gates de tipagem$(NC)"
	@$(NPM) run typecheck:repo
	@$(NPM) run typecheck:strict:all
	@$(NPM) run check:ts-expect-error
	@$(NPM) run check:base-strict
	@echo "$(GREEN)✅ Todos os gates de tipagem passaram$(NC)"

test-audit-quality:
	@echo "$(CYAN)🧪 Testes unitários do audit quality/JSDoc$(NC)"
	@$(NPM) run test:unit:audit-quality

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
	@echo "$(CYAN)🔍 Auditoria SSOT event strings$(NC)"
	@node scripts/audit-event-strings.mjs || true

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
	@if [ ! -f scripts/env/validate-env.js ]; then \
		echo "$(RED)❌ scripts/env/validate-env.js não encontrado$(NC)"; \
		exit 1; \
	fi
	@if [ ! -f .env.schema.json ]; then \
		echo "$(RED)❌ .env.schema.json não encontrado$(NC)"; \
		exit 1; \
	fi
	@$(NODE) scripts/env/validate-env.js --all || (echo "$(RED)❌ Validação ENV falhou$(NC)" && exit 1)
	@echo "$(GREEN)✅ Validação ENV concluída$(NC)"

validate-powershell-bom:
	@echo "$(CYAN)🔍 Validando BOM em scripts PowerShell$(NC)"
	@ERRORS=0; \
	for file in $$(find . -name '*.ps1' -not -path './node_modules/*' -not -path './backups/*' -not -path './dist/*' -not -path './dashboard-ui/dist/*'); do \
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
	@bash scripts/env/check-all-bindings.sh

# =============================================================================
# 1️⃣3️⃣ DEVELOPMENT SHORTCUTS
# =============================================================================

.PHONY: dev dev-debug quick-test quick-check check-forbidden audit-preflight audit-ready audit-shadow audit-quick audit-quick-serial audit-quick-cache-off audit-quick-skip-refresh audit-deep audit-deep-jsdoc audit-nightly audit-nightly-no-docs audit-nightly-max-no-docs audit-run-last audit-progress audit-events-tail

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

audit-preflight:
	@echo "$(CYAN)🧭 Audit preflight semântico$(NC)"
	@$(NPM) run audit:preflight

audit-ready: semantic-preflight
	@echo "$(GREEN)✅ Prontidão semântica coletada. Rode make audit-shadow/audit-quick conforme necessidade.$(NC)"

audit-shadow:
	@echo "$(CYAN)🧪 Auditoria rápida em shadow gate$(NC)"
	@$(NPM) run audit:quick:shadow

audit-quick:
	@echo "$(CYAN)🧪 Auditoria bug-first rápida (delta)$(NC)"
	@$(NPM) run audit:quick

audit-quick-serial:
	@echo "$(CYAN)🧪 Auditoria rápida com quality serial (diagnóstico)$(NC)"
	@$(NPM) run audit:quick:serial

audit-quick-cache-off:
	@echo "$(CYAN)🧪 Auditoria rápida sem cache de quality (baseline/tuning)$(NC)"
	@$(NPM) run audit:quick:cache-off

audit-quick-skip-refresh:
	@echo "$(CYAN)🧪 Auditoria rápida (sem refresh de contexto)$(NC)"
	@$(NPM) run audit:quick -- --refresh-context skip

audit-deep:
	@echo "$(CYAN)🧪 Auditoria bug-first completa local$(NC)"
	@$(NPM) run audit:deep

audit-deep-jsdoc:
	@echo "$(CYAN)🧪 Auditoria deep com 'jsdoc_full' + threshold$(NC)"
	@$(NPM) run audit:deep:jsdoc

audit-nightly:
	@echo "$(CYAN)🌙 Auditoria noturna completa (refresh + docs + chaos + logs)$(NC)"
	@$(NPM) run audit:nightly

audit-nightly-no-docs:
	@echo "$(CYAN)🌙 Auditoria noturna sem refresh/docs (mais rápida)$(NC)"
	@$(NPM) run audit:nightly -- --refresh-context skip

audit-nightly-max-no-docs:
	@echo "$(MAGENTA)$(BOLD)🌙 Auditoria noturna máxima (sem refresh/rebuild de contexto)$(NC)"
	@echo "$(CYAN)Escopo$(NC): análise completa + triagem deep + diffs sugeridos + chaos + contract coverage + shadow gate"
	@echo "$(CYAN)Quando usar$(NC): varredura profunda de bugs/gaps/falhas com máximo detalhe, sem custo de reindexação RAG/docs nesta execução"
	@$(NPM) run audit:nightly -- --refresh-context skip --proposal-depth deep --propose-diffs true --focus all --contracts-mode hybrid --chaos-profile full --cloud-fallback on --contract-coverage-report true --log-format jsonl --heartbeat-ms 5000 --shadow-gate true

audit-run-last:
	@echo "$(CYAN)📁 Último run de auditoria$(NC)"
	@ls -1dt artifacts/audit/runs/* 2>/dev/null | head -n 1 || echo "$(YELLOW)Sem runs em artifacts/audit/runs$(NC)"

audit-progress:
	@if [ -z "$(RUN_ID)" ]; then \
		echo "$(RED)❌ Informe RUN_ID. Ex: make audit-progress RUN_ID='WAVE_AUDIT_NIGHTLY_2026-02-15T13-27-53-018Z'$(NC)"; \
		exit 1; \
	fi
	@cat "artifacts/audit/runs/$(RUN_ID)/progress.json"

audit-events-tail:
	@if [ -z "$(RUN_ID)" ]; then \
		echo "$(RED)❌ Informe RUN_ID. Ex: make audit-events-tail RUN_ID='WAVE_AUDIT_NIGHTLY_2026-02-15T13-27-53-018Z'$(NC)"; \
		exit 1; \
	fi
	@tail -f "artifacts/audit/runs/$(RUN_ID)/events.jsonl"

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
	@echo "  • $(BOLD)DOCUMENTAÇÃO/REFERENCIA/INTEGRACOES/RAG_MCP_LSP_PLAYBOOK_PTBR.md$(NC)"
	@echo ""
	@echo "$(CYAN)Use: $(BOLD)cat DOCUMENTAÇÃO/<arquivo>$(NC) ou $(BOLD)cat docs/integration/<arquivo>$(NC)"

docs-list:
	@echo "$(CYAN)📚 Lista completa de documentação:$(NC)"
	@ls -1 DOCUMENTAÇÃO/*.md 2>/dev/null || echo "$(YELLOW)Sem arquivos .md em DOCUMENTAÇÃO/$(NC)"
	@ls -1 docs/integration/*.md 2>/dev/null || echo "$(YELLOW)Sem arquivos .md em docs/integration/$(NC)"

# =============================================================================
# FIM DO MAKEFILE v4.4.0
# =============================================================================
