#!/usr/bin/env bash
# =============================================================================
# read-transcript.sh — Lê o transcript da sessão atual ou de uma sessão dada
# =============================================================================
# Uso:
#   bash read-transcript.sh                  # stats da sessão atual
#   bash read-transcript.sh --errors         # apenas falhas
#   bash read-transcript.sh --stats          # estatísticas completas
#   bash read-transcript.sh --last N         # N últimas mensagens do usuário
#   bash read-transcript.sh --session ID     # sessão específica (por ID completo ou parcial)
#   bash read-transcript.sh --list           # lista todas sessões disponíveis
#   bash read-transcript.sh --path           # exibe apenas o caminho do transcript
#
# Contexto: Os transcripts são arquivos JSONL gravados automaticamente pelo
# GitHub Copilot Chat. Cada linha é um evento JSON com campos:
#   { type, data, id, timestamp, parentId }
#
# Tipos de eventos:
#   session.start          → início da sessão (producer, copilotVersion, etc.)
#   user.message           → mensagem do usuário
#   assistant.turn_start   → início de turno do agente
#   assistant.message      → resposta ou tool call do agente
#   assistant.turn_end     → fim do turno
#   tool.execution_start   → início da execução de ferramenta
#   tool.execution_complete→ resultado (success: boolean — sem conteúdo)
#
# ⚠️  LIMITAÇÃO: tool.execution_complete tem APENAS success:bool (sem output).
#     O conteúdo real das ferramentas está no requestLogger in-memory do Debug Panel.
#
# Descoberta: /home/node/.vscode-server/data/User/workspaceStorage/
#             <workspace-hash>/GitHub.copilot-chat/transcripts/<session-id>.jsonl
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------
HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HOOKS_DIR/../../.." && pwd)"
SESSION_CONTEXT="$REPO_ROOT/.github/hooks/state/session-context.json"
WS_STORAGE_ROOT="/home/node/.vscode-server/data/User/workspaceStorage"

# ---------------------------------------------------------------------------
# Parse de argumentos
# ---------------------------------------------------------------------------
MODE="stats"
SESSION_ID=""
LAST_N=5

while [[ $# -gt 0 ]]; do
    case "$1" in
        --errors)
            MODE="errors"
            shift
            ;;
        --stats)
            MODE="stats"
            shift
            ;;
        --path)
            MODE="path"
            shift
            ;;
        --list)
            MODE="list"
            shift
            ;;
        --last)
            MODE="last"
            LAST_N="${2:-5}"
            shift 2
            ;;
        --session)
            SESSION_ID="${2:-}"
            shift 2
            ;;
        *)
            echo "Uso: bash $0 [--errors|--stats|--path|--list|--last N|--session ID]" >&2
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Descobrir diretório de transcripts
# ---------------------------------------------------------------------------
TRANSCRIPTS_DIR=""
# shellcheck disable=SC2227
while IFS= read -r -d '' candidate; do
    TRANSCRIPTS_DIR="$(dirname "$candidate")"
    break
done < <(find "$WS_STORAGE_ROOT" -maxdepth 5 -name "*.jsonl" \
    -path "*/GitHub.copilot-chat/transcripts/*.jsonl" -print0 2> /dev/null)

if [[ -z "$TRANSCRIPTS_DIR" ]]; then
    echo '{"error": "Diretório de transcripts não encontrado em workspaceStorage"}' >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Modo --list
# ---------------------------------------------------------------------------
if [[ "$MODE" == "list" ]]; then
    echo "=== Sessões disponíveis em: $TRANSCRIPTS_DIR ==="
    for f in "$TRANSCRIPTS_DIR"/*.jsonl; do
        sid="$(basename "$f" .jsonl)"
        lines="$(wc -l < "$f")"
        # Ler data de início
        start_time="$(head -5 "$f" | python3 -c "
import sys,json
for l in sys.stdin:
    try:
        o=json.loads(l)
        if o.get('type')=='session.start':
            print(o['data'].get('startTime','?')[:19])
            break
    except: pass
")"
        printf "  %s  (%d linhas, início: %s)\n" "$sid" "$lines" "${start_time:-?}"
    done
    exit 0
fi

# ---------------------------------------------------------------------------
# Descobrir TRANSCRIPT atual ou especificado
# ---------------------------------------------------------------------------
TRANSCRIPT=""

if [[ -n "$SESSION_ID" ]]; then
    # Busca por ID parcial
    for f in "$TRANSCRIPTS_DIR"/*.jsonl; do
        if [[ "$(basename "$f" .jsonl)" == *"$SESSION_ID"* ]]; then
            TRANSCRIPT="$f"
            break
        fi
    done
    if [[ -z "$TRANSCRIPT" ]]; then
        echo "{\"error\": \"Sessão não encontrada: $SESSION_ID\"}" >&2
        exit 1
    fi
else
    # Tenta ler da session-context.json
    if [[ -f "$SESSION_CONTEXT" ]]; then
        CUR_ID="$(python3 -c "
import json,sys
try:
    d=json.load(open('$SESSION_CONTEXT'))
    print(d.get('session',{}).get('id',''))
except: print('')
")"
        if [[ -n "$CUR_ID" ]] && [[ -f "$TRANSCRIPTS_DIR/$CUR_ID.jsonl" ]]; then
            TRANSCRIPT="$TRANSCRIPTS_DIR/$CUR_ID.jsonl"
        fi
    fi
    # Fallback: arquivo mais recente
    if [[ -z "$TRANSCRIPT" ]]; then
        TRANSCRIPT="$(find "$TRANSCRIPTS_DIR" -maxdepth 1 -name '*.jsonl' -printf '%T@ %p\n' 2> /dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
    fi
fi

if [[ -z "$TRANSCRIPT" ]] || [[ ! -f "$TRANSCRIPT" ]]; then
    echo '{"error": "Nenhum transcript encontrado"}' >&2
    exit 1
fi

SESSION_ID_RESOLVED="$(basename "$TRANSCRIPT" .jsonl)"

# ---------------------------------------------------------------------------
# Modo --path
# ---------------------------------------------------------------------------
if [[ "$MODE" == "path" ]]; then
    echo "$TRANSCRIPT"
    exit 0
fi

# ---------------------------------------------------------------------------
# Análise via Python3 (mais confiável para JSON)
# ---------------------------------------------------------------------------
python3 << PYEOF
import json, sys, os
from datetime import datetime

path = "$TRANSCRIPT"
mode = "$MODE"
last_n = int("$LAST_N")
session_id = "$SESSION_ID_RESOLVED"

with open(path) as f:
    events = [json.loads(l) for l in f if l.strip()]

# Contadores
tools_called = {}   # toolCallId -> toolName
failures = []
user_messages = []
assistant_messages = 0
session_start_data = {}
tool_counts = {}
total_tool_calls = 0

for ev in events:
    t = ev.get('type', '')
    data = ev.get('data', {})
    ts = ev.get('timestamp', '')

    if t == 'session.start':
        session_start_data = data

    elif t == 'user.message':
        user_messages.append({'content': data.get('content', '')[:300], 'ts': ts})

    elif t == 'assistant.message':
        assistant_messages += 1
        for req in data.get('toolRequests', []):
            name = req.get('name', '?')
            tool_counts[name] = tool_counts.get(name, 0) + 1

    elif t == 'tool.execution_start':
        tc_id = data.get('toolCallId', '')
        tool_name = data.get('toolName', '?')
        tools_called[tc_id] = {'name': tool_name, 'ts': ts}
        total_tool_calls += 1

    elif t == 'tool.execution_complete':
        tc_id = data.get('toolCallId', '')
        success = data.get('success', True)
        if not success:
            tool_info = tools_called.get(tc_id, {})
            failures.append({
                'tool': tool_info.get('name', '?'),
                'toolCallId': tc_id,
                'started_at': tool_info.get('ts', '')[:19],
                'failed_at': ts[:19]
            })

# ---------------------------------------------------------------------------
# Modo: errors
# ---------------------------------------------------------------------------
if mode == 'errors':
    if not failures:
        print(json.dumps({"session": session_id, "failures": [], "message": "Nenhuma falha encontrada"}))
    else:
        print(json.dumps({
            "session": session_id,
            "total_failures": len(failures),
            "failures": failures
        }, indent=2, ensure_ascii=False))

# ---------------------------------------------------------------------------
# Modo: last (últimas N mensagens do usuário)
# ---------------------------------------------------------------------------
elif mode == 'last':
    recent = user_messages[-last_n:]
    print(json.dumps({
        "session": session_id,
        "user_messages_shown": len(recent),
        "messages": recent
    }, indent=2, ensure_ascii=False))

# ---------------------------------------------------------------------------
# Modo: stats (default)
# ---------------------------------------------------------------------------
else:
    start_time = session_start_data.get('startTime', '?')
    total_events = len(events)

    print(json.dumps({
        "session_id": session_id,
        "transcript_path": path,
        "session_start": start_time,
        "copilot_version": session_start_data.get('copilotVersion', '?'),
        "vscode_version": session_start_data.get('vscodeVersion', '?'),
        "total_events": total_events,
        "total_tool_calls": total_tool_calls,
        "total_failures": len(failures),
        "user_messages_count": len(user_messages),
        "assistant_messages_count": assistant_messages,
        "tool_counts": dict(sorted(tool_counts.items(), key=lambda x: -x[1])),
        "failures": failures,
        "last_user_message": user_messages[-1]['content'][:200] if user_messages else None
    }, indent=2, ensure_ascii=False))

PYEOF
