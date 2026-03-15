#!/usr/bin/env bash
# ============================================================
# hooks-lib/config.sh — Tunáveis centralizados do sistema de hooks
# ============================================================
# Todos os thresholds, timeouts e limites configuráveis ficam aqui.
# Scripts importam via: source "$HOOK_DIR/hooks-lib/config.sh" 2>/dev/null || true
#
# Variáveis exportadas (readonly para evitar redefinição acidental):
#   HOOKS_FLOCK_TIMEOUT      — timeout flock em segundos
#   HOOKS_AUX_TIMEOUT_S      — timeout padrão (segundos) para blocos auxiliares fail-open
#   HOOKS_HEAL_THRESHOLD     — mismatches consecutivos para ativar HEAL v2
#   HOOKS_MAX_BLOCK_PER_TURN — máximo de decision:block por turno
#   HOOKS_CONSEC_WARNING     — violações consecutivas para alerta WARNING
#   HOOKS_CONSEC_CRITICAL    — violações consecutivas para alerta CRITICAL
#   HOOKS_TURN_HISTORY_CAP   — máximo de entradas em turn_history (rolante)
#   HOOKS_SECTION_HISTORY_CAP — máximo de entradas em section_history (rolante)
#   HOOKS_AUDIT_MAX_MB       — tamanho máximo de audit.jsonl antes de rotate (MB)
#   HOOKS_SCHEMA_VERSION     — versão canônica do session-context.json
#   HOOKS_FF_SMOKE_DOMAINS   — flag de rollout da suíte smoke por domínios (off|shadow|on)
# ============================================================

# Não re-exportar se já carregado (idempotente)
[[ -n "${HOOKS_CONFIG_LOADED:-}" ]] && return 0

# ── Locking ──────────────────────────────────────────────────────────────────
# Timeout (segundos) que flock aguarda para obter lock exclusivo.
# REV-08: aumentado de 3s para 5s para tolerar jq+sponge em arquivos grandes (>5k linhas).
readonly HOOKS_FLOCK_TIMEOUT="${HOOKS_FLOCK_TIMEOUT:-5}"

# Timeout padrão para execução de blocos auxiliares (briefing, trends, summary, etc.).
# Mantém o fluxo crítico resiliente, evitando bloqueio por jobs não críticos.
readonly HOOKS_AUX_TIMEOUT_S="${HOOKS_AUX_TIMEOUT_S:-5}"

# ── HEAL v2 ──────────────────────────────────────────────────────────────────
# Número de mismatches consecutivos de session_id para ativar auto-heal.
# Abaixo desse número, o mismatch é apenas logado como aviso.
readonly HOOKS_HEAL_THRESHOLD="${HOOKS_HEAL_THRESHOLD:-3}"

# ── Autorização / decision:block ─────────────────────────────────────────────
# Máximo de vezes que agent-stop.sh emite {"decision":"block"} por turno.
# Anti-recursão: ao atingir o limite, encerramento é permitido incondicionalmente.
readonly HOOKS_MAX_BLOCK_PER_TURN="${HOOKS_MAX_BLOCK_PER_TURN:-1}"

# ── Nível de alerta por violações consecutivas ───────────────────────────────
# Limites usados no session-start.sh para escalonar mensagens no briefing.
readonly HOOKS_CONSEC_WARNING="${HOOKS_CONSEC_WARNING:-2}"
readonly HOOKS_CONSEC_CRITICAL="${HOOKS_CONSEC_CRITICAL:-3}"

# ── Históricos rolantes ───────────────────────────────────────────────────────
# turn_history: turnos são mais frequentes; cap menor para evitar crescimento descontrolado.
readonly HOOKS_TURN_HISTORY_CAP="${HOOKS_TURN_HISTORY_CAP:-20}"
# section_history: seções são mais raras (dezenas por sessão); cap maior para histórico útil.
readonly HOOKS_SECTION_HISTORY_CAP="${HOOKS_SECTION_HISTORY_CAP:-50}"

# ── Rotação de audit.jsonl ────────────────────────────────────────────────────
# Tamanho mínimo (em MB) de audit.jsonl para disparar rotate-audit.sh.
readonly HOOKS_AUDIT_MAX_MB="${HOOKS_AUDIT_MAX_MB:-5}"

# ── Schema ───────────────────────────────────────────────────────────────────
readonly HOOKS_SCHEMA_VERSION="${HOOKS_SCHEMA_VERSION:-8}"

# ── Feature flags de rollout controlado ─────────────────────────────────────
# off    => caminho desativado
# shadow => executa em paralelo sem quebrar gate principal
# on     => executa com efeito de gate
readonly HOOKS_FF_SMOKE_DOMAINS="${HOOKS_FF_SMOKE_DOMAINS:-shadow}"

HOOKS_CONFIG_LOADED=1
export HOOKS_CONFIG_LOADED
