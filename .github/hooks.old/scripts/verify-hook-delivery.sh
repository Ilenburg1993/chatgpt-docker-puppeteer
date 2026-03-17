#!/bin/bash
# verify-hook-delivery.sh — Verifica se comandos/hooks estão chegando e sendo processados
#
# Objetivo:
# - confirmar recebimento de comandos via preToolUse
# - confirmar processamento via postToolUse
# - detectar gaps de pareamento por tool_use_id
# - checar sinais de processamento do Stop (agentStop + eventos correlatos)
#
# Uso:
#   bash .github/hooks/scripts/verify-hook-delivery.sh
#   bash .github/hooks/scripts/verify-hook-delivery.sh --session-id <sid>
#   bash .github/hooks/scripts/verify-hook-delivery.sh --audit-file <arquivo.jsonl> --max-lines 5000 --strict
#
# Exit codes:
#   0 = sem falhas
#   1 = falhas detectadas
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$HOOK_DIR/state"
LOG_DIR="$HOOK_DIR/logs"
CTX_FILE="$STATE_DIR/session-context.json"

SESSION_ID=""
AUDIT_FILE=""
MAX_LINES=2000
SCOPE_MODE="turn"
SETTLE_SECONDS=8
STRICT=false

usage() {
    cat << 'EOF'
verify-hook-delivery.sh

Opções:
  --session-id <sid>   Filtra por session_id específico
  --audit-file <path>  Arquivo audit.jsonl a analisar
  --max-lines <N>      Janela máxima de linhas (default: 2000)
    --scope <modo>       Escopo: turn|session (default: turn)
    --settle-seconds <N> Ignora mismatch muito recente (eventos em trânsito)
  --strict             Falha também em warnings críticos de cobertura
  --help               Mostra esta ajuda
EOF
}

while [ $# -gt 0 ]; do
    case "${1:-}" in
        --session-id)
            shift
            SESSION_ID="${1:-}"
            ;;
        --audit-file)
            shift
            AUDIT_FILE="${1:-}"
            ;;
        --max-lines)
            shift
            MAX_LINES="${1:-2000}"
            ;;
        --scope)
            shift
            SCOPE_MODE="${1:-turn}"
            ;;
        --settle-seconds)
            shift
            SETTLE_SECONDS="${1:-8}"
            ;;
        --strict)
            STRICT=true
            ;;
        --help | -h)
            usage
            exit 0
            ;;
        *)
            echo "[erro] opção desconhecida: ${1}" >&2
            usage >&2
            exit 1
            ;;
    esac
    shift
done

if [ -z "$SESSION_ID" ] && [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

if [ -z "$AUDIT_FILE" ]; then
    if [ -f "$LOG_DIR/audit.jsonl" ]; then
        AUDIT_FILE="$LOG_DIR/audit.jsonl"
    elif [ -n "$SESSION_ID" ]; then
        SID_SHORT="$(printf '%s' "$SESSION_ID" | cut -c1-8)"
        if [ -f "$LOG_DIR/audit-${SID_SHORT}.jsonl" ]; then
            AUDIT_FILE="$LOG_DIR/audit-${SID_SHORT}.jsonl"
        else
            AUDIT_FILE="$LOG_DIR/audit.jsonl"
        fi
    else
        AUDIT_FILE="$LOG_DIR/audit.jsonl"
    fi
fi

if [ ! -f "$AUDIT_FILE" ]; then
    echo "[falha] audit file não encontrado: $AUDIT_FILE"
    exit 1
fi

if ! [[ "$MAX_LINES" =~ ^[0-9]+$ ]]; then
    echo "[erro] --max-lines precisa ser inteiro >= 0" >&2
    exit 1
fi

if ! [[ "$SETTLE_SECONDS" =~ ^[0-9]+$ ]]; then
    echo "[erro] --settle-seconds precisa ser inteiro >= 0" >&2
    exit 1
fi

if [ "$SCOPE_MODE" != "turn" ] && [ "$SCOPE_MODE" != "session" ]; then
    echo "[erro] --scope deve ser 'turn' ou 'session'" >&2
    exit 1
fi

TMP_RAW="$(mktemp)"
TMP_INPUT="$(mktemp)"
TMP_SCOPE="$(mktemp)"
PRE_IDS="$(mktemp)"
POST_IDS="$(mktemp)"
MISSING_POST_IDS="$(mktemp)"
MISSING_PRE_IDS="$(mktemp)"
MISSING_POST_IDS_EFFECTIVE="$(mktemp)"
MISSING_PRE_IDS_EFFECTIVE="$(mktemp)"
MISSING_POST_IDS_IGNORED="$(mktemp)"
MISSING_PRE_IDS_IGNORED="$(mktemp)"
TMP_SCOPE_TURN="$(mktemp)"
SELF_VERIFY_PRE_IDS="$(mktemp)"
TMP_MISSING_POST_ADJUSTED="$(mktemp)"
DENY_PRE_IDS="$(mktemp)"
trap 'rm -f "$TMP_RAW" "$TMP_INPUT" "$TMP_SCOPE" "$PRE_IDS" "$POST_IDS" "$MISSING_POST_IDS" "$MISSING_PRE_IDS" "$MISSING_POST_IDS_EFFECTIVE" "$MISSING_PRE_IDS_EFFECTIVE" "$MISSING_POST_IDS_IGNORED" "$MISSING_PRE_IDS_IGNORED" "$TMP_SCOPE_TURN" "$SELF_VERIFY_PRE_IDS" "$TMP_MISSING_POST_ADJUSTED" "$DENY_PRE_IDS"' EXIT

# Limita janela primeiro para manter custo previsível em arquivos grandes.
if [ "$MAX_LINES" -gt 0 ] 2> /dev/null; then
    tail -n "$MAX_LINES" "$AUDIT_FILE" > "$TMP_INPUT" 2> /dev/null || true
else
    cp "$AUDIT_FILE" "$TMP_INPUT"
fi

# Normaliza JSONL em uma única passada de jq (rápido para janela limitada).
if ! jq -c . "$TMP_INPUT" > "$TMP_RAW" 2> /dev/null; then
    echo "[falha] JSON inválido na janela analisada de $AUDIT_FILE" >&2
    exit 1
fi

if [ ! -s "$TMP_RAW" ]; then
    echo "[falha] nenhum JSON válido encontrado em: $AUDIT_FILE"
    exit 1
fi

if [ -n "$SESSION_ID" ]; then
    jq -c --arg sid "$SESSION_ID" 'select((.session_id // "") == $sid)' "$TMP_RAW" > "$TMP_SCOPE" || true
else
    cp "$TMP_RAW" "$TMP_SCOPE"
fi

# Escopo por TURN: considera apenas eventos após o último userPromptSubmitted.
if [ "$SCOPE_MODE" = "turn" ] && [ -s "$TMP_SCOPE" ]; then
    LAST_PROMPT_LINE="$(awk '/"event":"userPromptSubmitted"/{last=NR} END{print last+0}' "$TMP_SCOPE" 2> /dev/null || echo 0)"
    if [ "$LAST_PROMPT_LINE" -gt 0 ] 2> /dev/null; then
        TOTAL_SCOPE_LINES="$(wc -l < "$TMP_SCOPE" | tr -d ' ')"
        TAIL_LINES=$((TOTAL_SCOPE_LINES - LAST_PROMPT_LINE + 1))
        if [ "$TAIL_LINES" -gt 0 ] 2> /dev/null; then
            tail -n "$TAIL_LINES" "$TMP_SCOPE" > "$TMP_SCOPE_TURN" 2> /dev/null || true
            if [ -s "$TMP_SCOPE_TURN" ]; then
                cp "$TMP_SCOPE_TURN" "$TMP_SCOPE"
            fi
        fi
    fi
fi

TOTAL_LINES="$(wc -l < "$TMP_SCOPE" | tr -d ' ')"
if [ "$TOTAL_LINES" -eq 0 ] 2> /dev/null; then
    echo "[falha] nenhum evento encontrado no escopo analisado (session_id='${SESSION_ID:-ALL}')"
    exit 1
fi

PRE_COUNT="$(jq -r 'select(.event == "preToolUse") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
POST_COUNT="$(jq -r 'select(.event == "postToolUse") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
FAIL_POST_COUNT="$(jq -r 'select(.event == "toolUseFailure") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
ASK_RESP_COUNT="$(jq -r 'select(.event == "askQuestions_response") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
STOP_COUNT="$(jq -r 'select(.event == "agentStop") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
STOP_BLOCKED_COUNT="$(jq -r 'select(.event == "agentStop_blocked") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
TURN_AUTH_COUNT="$(jq -r 'select(.event == "turnEnd_authorized") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
TURN_INVALID_COUNT="$(jq -r 'select(.event == "turnEnd_invalid_authorization" or .event == "turnEnd_no_askQuestions") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
RUN_SUBAGENT_COUNT="$(jq -r 'select(.event == "preToolUse" and ((.tool_name // "") == "runSubagent" or (.tool_name // "") == "search_subagent")) | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
SUBAGENT_START_COUNT="$(jq -r 'select(.event == "subagentStart") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
SUBAGENT_CHAIN_INVALID_COUNT="$(jq -r 'select((.event == "turnEnd_invalid_authorization" and (.reason // "") == "subagent_chain_invalid") or (.event == "agentStop_blocked" and (.invalid_reason // "") == "subagent_chain_invalid")) | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
ASK_MISSING_TEMPLATE_F_OPTION_COUNT="$(jq -r 'select(.event == "askQuestions_missing_template_f_option") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
ASK_TEMPLATE_F_REQUESTED_COUNT="$(jq -r 'select(.event == "askQuestions_template_f_requested") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
ASK_TEMPLATE_F_WITHOUT_REQUEST_COUNT="$(jq -r 'select(.event == "askQuestions_template_f_called_without_request") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
TODO_PROTOCOL_VIOLATION_COUNT="$(jq -r 'select(.event == "todoProtocol_violation_last_item") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
TODO_PROTOCOL_CHECKED_COUNT="$(jq -r 'select(.event == "todoProtocol_checked") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
SUBTURN_AUTO_ADVANCE_COUNT="$(jq -r 'select(.event == "subturnAutoAdvance") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
AUTO_AUDIT_UNCLEAR_COUNT="$(jq -r 'select(.event == "askQuestions_continuation_unclear") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
AUTO_AUDIT_STARTED_COUNT="$(jq -r 'select(.event == "autoAudit_started") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"
AUTO_AUDIT_PRETOOL_DENY_COUNT="$(jq -r 'select(.event == "autoAudit_pretool_deny") | .event' "$TMP_SCOPE" | wc -l | tr -d ' ')"

jq -r 'select(.event == "preToolUse" and (.tool_use_id // "") != "") | .tool_use_id' "$TMP_SCOPE" | sort -u > "$PRE_IDS"
jq -r 'select((.event == "postToolUse" or .event == "toolUseFailure") and (.tool_use_id // "") != "") | .tool_use_id' "$TMP_SCOPE" | sort -u > "$POST_IDS"

comm -23 "$PRE_IDS" "$POST_IDS" > "$MISSING_POST_IDS" || true
comm -13 "$PRE_IDS" "$POST_IDS" > "$MISSING_PRE_IDS" || true

python - "$TMP_SCOPE" "$MISSING_POST_IDS" "$MISSING_PRE_IDS" "$MISSING_POST_IDS_EFFECTIVE" "$MISSING_PRE_IDS_EFFECTIVE" "$MISSING_POST_IDS_IGNORED" "$MISSING_PRE_IDS_IGNORED" "$SETTLE_SECONDS" << 'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

scope_file, miss_pre_file, miss_post_file, out_pre_eff, out_post_eff, out_pre_ign, out_post_ign, settle_s = sys.argv[1:]
settle_s = int(settle_s)

def parse_ts(ts: str):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(timezone.utc)
    except Exception:
        return None

rows = []
with open(scope_file, 'r', encoding='utf-8', errors='ignore') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except Exception:
            continue

max_ts = None
pre_latest = {}
pre_latest_tool = {}
post_latest = {}
transcript_error_ts = []

for o in rows:
    ts = parse_ts(o.get('timestamp', ''))
    if ts is not None and (max_ts is None or ts > max_ts):
        max_ts = ts
    if o.get('event') == 'transcript_error_synced' and ts is not None:
        transcript_error_ts.append(ts)
    tid = o.get('tool_use_id')
    if not tid:
        continue
    ev = o.get('event')
    if ev == 'preToolUse':
        if ts is not None:
            prev = pre_latest.get(tid)
            if prev is None or ts > prev:
                pre_latest[tid] = ts
                pre_latest_tool[tid] = (o.get('tool_name') or '').strip()
    elif ev in ('postToolUse', 'toolUseFailure'):
        if ts is not None:
            prev = post_latest.get(tid)
            if prev is None or ts > prev:
                post_latest[tid] = ts

def has_transcript_error_near(pre_ts, window_seconds=8):
    if pre_ts is None:
        return False
    for err_ts in transcript_error_ts:
        delta = (err_ts - pre_ts).total_seconds()
        if 0 <= delta <= window_seconds:
            return True
    return False

def load_ids(path):
    ids = []
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            line = line.strip()
            if line:
                ids.append(line)
    return ids

missing_pre = load_ids(miss_pre_file)   # pre sem post
missing_post = load_ids(miss_post_file) # post sem pre

pre_effective, pre_ignored = [], []
for tid in missing_pre:
    ts = pre_latest.get(tid)
    if max_ts is not None and ts is not None and (max_ts - ts).total_seconds() <= settle_s:
        pre_ignored.append(tid)
    elif pre_latest_tool.get(tid) == 'read_file' and has_transcript_error_near(ts):
        # Caso legado observado: read_file pode falhar antes de postToolUse,
        # emitindo apenas transcript_error_synced no audit.
        pre_ignored.append(tid)
    else:
        pre_effective.append(tid)

post_effective, post_ignored = [], []
for tid in missing_post:
    ts = post_latest.get(tid)
    if max_ts is not None and ts is not None and (max_ts - ts).total_seconds() <= settle_s:
        post_ignored.append(tid)
    else:
        post_effective.append(tid)

Path(out_pre_eff).write_text('\n'.join(pre_effective) + ('\n' if pre_effective else ''), encoding='utf-8')
Path(out_post_eff).write_text('\n'.join(post_effective) + ('\n' if post_effective else ''), encoding='utf-8')
Path(out_pre_ign).write_text('\n'.join(pre_ignored) + ('\n' if pre_ignored else ''), encoding='utf-8')
Path(out_post_ign).write_text('\n'.join(post_ignored) + ('\n' if post_ignored else ''), encoding='utf-8')
PY

MISSING_POST_COUNT="$(wc -l < "$MISSING_POST_IDS_EFFECTIVE" | tr -d ' ')"
MISSING_PRE_COUNT="$(wc -l < "$MISSING_PRE_IDS_EFFECTIVE" | tr -d ' ')"
MISSING_POST_IGNORED_COUNT="$(wc -l < "$MISSING_POST_IDS_IGNORED" | tr -d ' ')"
MISSING_PRE_IGNORED_COUNT="$(wc -l < "$MISSING_PRE_IDS_IGNORED" | tr -d ' ')"

# Auto-observação: quando este verificador roda via run_in_terminal, o preToolUse da
# própria chamada aparece dentro da janela, mas o postToolUse correspondente só entra
# no audit depois que o script termina. Evita falso positivo estrutural de pre_sem_post.
jq -r '
    select(
        .event == "preToolUse"
        and (.tool_use_id // "") != ""
        and (.tool_name // "") == "run_in_terminal"
        and ((.tool_args // "") | contains("verify-hook-delivery.sh"))
    )
    | .tool_use_id
' "$TMP_SCOPE" | sort -u > "$SELF_VERIFY_PRE_IDS"

if [ -s "$SELF_VERIFY_PRE_IDS" ] && [ -s "$MISSING_POST_IDS_EFFECTIVE" ]; then
    comm -23 "$MISSING_POST_IDS_EFFECTIVE" "$SELF_VERIFY_PRE_IDS" > "$TMP_MISSING_POST_ADJUSTED" || true
    cp "$TMP_MISSING_POST_ADJUSTED" "$MISSING_POST_IDS_EFFECTIVE"
    MISSING_POST_COUNT="$(wc -l < "$MISSING_POST_IDS_EFFECTIVE" | tr -d ' ')"
fi

# Exceção canônica: alguns preToolUse são negados por política no próprio pre-hook.
# Nesses casos, não há postToolUse correspondente e isso NÃO representa perda de entrega.
jq -r '
    select(
        (.event == "autoAudit_pretool_deny")
        and (.tool_use_id // "") != ""
    )
    | .tool_use_id
' "$TMP_SCOPE" | sort -u > "$DENY_PRE_IDS"

if [ -s "$DENY_PRE_IDS" ] && [ -s "$MISSING_POST_IDS_EFFECTIVE" ]; then
    comm -23 "$MISSING_POST_IDS_EFFECTIVE" "$DENY_PRE_IDS" > "$TMP_MISSING_POST_ADJUSTED" || true
    cp "$TMP_MISSING_POST_ADJUSTED" "$MISSING_POST_IDS_EFFECTIVE"
    MISSING_POST_COUNT="$(wc -l < "$MISSING_POST_IDS_EFFECTIVE" | tr -d ' ')"
fi

FAILS=0
WARNS=0

fail_check() {
    FAILS=$((FAILS + 1))
    echo "  ✗ $1"
}

warn_check() {
    WARNS=$((WARNS + 1))
    echo "  ⚠ $1"
}

pass_check() {
    echo "  ✓ $1"
}

echo ""
echo "Verificador de Entrega de Hooks"
echo "- audit_file: $AUDIT_FILE"
echo "- session_id: ${SESSION_ID:-ALL}"
echo "- scope: $SCOPE_MODE"
echo "- settle_seconds: $SETTLE_SECONDS"
echo "- linhas analisadas: $TOTAL_LINES"
echo ""

if [ "$PRE_COUNT" -gt 0 ] 2> /dev/null; then
    pass_check "preToolUse recebido ($PRE_COUNT eventos)"
else
    warn_check "nenhum preToolUse na janela analisada"
fi

if [ "$POST_COUNT" -gt 0 ] 2> /dev/null; then
    pass_check "postToolUse recebido ($POST_COUNT eventos)"
else
    warn_check "nenhum postToolUse na janela analisada"
fi

if [ "$FAIL_POST_COUNT" -gt 0 ] 2> /dev/null; then
    pass_check "toolUseFailure registrado ($FAIL_POST_COUNT eventos)"
fi

if [ "$MISSING_POST_COUNT" -eq 0 ] 2> /dev/null; then
    pass_check "pareamento pre→post por tool_use_id está consistente"
else
    fail_check "$MISSING_POST_COUNT tool_use_id(s) com preToolUse sem postToolUse"
    echo "    exemplos (até 5):"
    head -n 5 "$MISSING_POST_IDS_EFFECTIVE" | sed 's/^/      - /'
fi

if [ "$MISSING_PRE_COUNT" -eq 0 ] 2> /dev/null; then
    pass_check "não há postToolUse órfãos sem preToolUse"
else
    fail_check "$MISSING_PRE_COUNT tool_use_id(s) com postToolUse sem preToolUse"
    echo "    exemplos (até 5):"
    head -n 5 "$MISSING_PRE_IDS_EFFECTIVE" | sed 's/^/      - /'
fi

if [ "$MISSING_POST_IGNORED_COUNT" -gt 0 ] 2> /dev/null || [ "$MISSING_PRE_IGNORED_COUNT" -gt 0 ] 2> /dev/null; then
    echo "  ℹ mismatch(s) recentes ignorados por settle window: pre_sem_post=$MISSING_POST_IGNORED_COUNT post_sem_pre=$MISSING_PRE_IGNORED_COUNT"
fi

if [ "$ASK_RESP_COUNT" -gt 0 ] 2> /dev/null; then
    pass_check "respostas de vscode_askQuestions registradas ($ASK_RESP_COUNT eventos)"
else
    warn_check "nenhum askQuestions_response na janela analisada"
fi

if [ "$STOP_COUNT" -gt 0 ] 2> /dev/null; then
    pass_check "eventos agentStop registrados ($STOP_COUNT)"
else
    warn_check "nenhum agentStop na janela analisada"
fi

if [ "$STOP_BLOCKED_COUNT" -gt 0 ] 2> /dev/null; then
    pass_check "bloqueios agentStop_blocked observados ($STOP_BLOCKED_COUNT)"
elif [ "$STOP_COUNT" -gt 0 ] 2> /dev/null; then
    warn_check "há agentStop, mas sem agentStop_blocked nesta janela"
fi

if [ "$TURN_AUTH_COUNT" -gt 0 ] 2> /dev/null || [ "$TURN_INVALID_COUNT" -gt 0 ] 2> /dev/null; then
    pass_check "fechamentos de turno auditados (authorized=$TURN_AUTH_COUNT, invalid/no_ask=$TURN_INVALID_COUNT)"
else
    warn_check "nenhum evento de fechamento de turno nesta janela"
fi

if [ "$RUN_SUBAGENT_COUNT" -gt 0 ] 2> /dev/null; then
    if [ "$SUBAGENT_START_COUNT" -gt 0 ] 2> /dev/null; then
        pass_check "cadeia mínima de subagente observada (runSubagent/search_subagent=$RUN_SUBAGENT_COUNT, subagentStart=$SUBAGENT_START_COUNT)"
    else
        fail_check "delegação de subagente sem subagentStart na janela (runSubagent/search_subagent=$RUN_SUBAGENT_COUNT)"
    fi
fi

if [ "$SUBAGENT_CHAIN_INVALID_COUNT" -gt 0 ] 2> /dev/null; then
    warn_check "foram detectadas invalidações por subagent_chain_invalid ($SUBAGENT_CHAIN_INVALID_COUNT)"
fi

if [ "$ASK_TEMPLATE_F_REQUESTED_COUNT" -gt 0 ] 2> /dev/null; then
    pass_check "escalonamento para Template F foi solicitado por askQuestions ($ASK_TEMPLATE_F_REQUESTED_COUNT)"
fi

if [ "$ASK_MISSING_TEMPLATE_F_OPTION_COUNT" -gt 0 ] 2> /dev/null; then
    warn_check "há askQuestions sem opção de escalonamento para Template F ($ASK_MISSING_TEMPLATE_F_OPTION_COUNT)"
fi

if [ "$ASK_TEMPLATE_F_WITHOUT_REQUEST_COUNT" -gt 0 ] 2> /dev/null; then
    warn_check "Template F foi chamado sem solicitação prévia registrada ($ASK_TEMPLATE_F_WITHOUT_REQUEST_COUNT)"
fi

if [ "$TODO_PROTOCOL_CHECKED_COUNT" -gt 0 ] 2> /dev/null; then
    pass_check "protocolo de TODO foi verificado em preToolUse ($TODO_PROTOCOL_CHECKED_COUNT eventos)"
fi

if [ "$TODO_PROTOCOL_VIOLATION_COUNT" -gt 0 ] 2> /dev/null; then
    warn_check "foram detectadas violações de último TODO de continuação ($TODO_PROTOCOL_VIOLATION_COUNT)"
fi

if [ "$SUBTURN_AUTO_ADVANCE_COUNT" -gt 0 ] 2> /dev/null; then
    pass_check "auto-avanço de subturn (n+1) observado ($SUBTURN_AUTO_ADVANCE_COUNT eventos)"
fi

if [ "$AUTO_AUDIT_UNCLEAR_COUNT" -gt 0 ] 2> /dev/null; then
    if [ "$AUTO_AUDIT_STARTED_COUNT" -gt 0 ] 2> /dev/null; then
        pass_check "fallback de auto-auditoria observado (unclear=$AUTO_AUDIT_UNCLEAR_COUNT, started=$AUTO_AUDIT_STARTED_COUNT)"
    else
        warn_check "houve continuidade ambígua sem kickoff de auto-auditoria nesta janela (unclear=$AUTO_AUDIT_UNCLEAR_COUNT)"
    fi
fi

if [ "$AUTO_AUDIT_PRETOOL_DENY_COUNT" -gt 0 ] 2> /dev/null; then
    pass_check "bloqueios preToolUse por auto-auditoria pendente observados ($AUTO_AUDIT_PRETOOL_DENY_COUNT)"
fi

TOP_TOOLS="$(jq -r 'select(.event == "preToolUse") | (.tool_name // "unknown")' "$TMP_SCOPE" | sort | uniq -c | sort -rn | head -n 10 || true)"
if [ -n "$TOP_TOOLS" ]; then
    echo ""
    echo "Top ferramentas observadas (preToolUse):"
    echo "$TOP_TOOLS" | sed 's/^/  - /'
fi

echo ""
echo "Resumo: falhas=$FAILS warnings=$WARNS"

if [ "$FAILS" -gt 0 ] 2> /dev/null; then
    exit 1
fi

if [ "$STRICT" = "true" ] && [ "$WARNS" -gt 0 ] 2> /dev/null; then
    echo "[strict] warnings tratados como falha"
    exit 1
fi

exit 0
