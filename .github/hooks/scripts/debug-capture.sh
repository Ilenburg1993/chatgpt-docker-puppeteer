#!/usr/bin/env bash
# debug-capture.sh — Captura payloads reais dos hooks para diagnóstico
#
# Uso:
#   Ativar: bash .github/hooks/scripts/debug-capture.sh on
#   Desativar: bash .github/hooks/scripts/debug-capture.sh off
#   Ver payloads: bash .github/hooks/scripts/debug-capture.sh show [event]
#   Limpar: bash .github/hooks/scripts/debug-capture.sh clear
#
# Quando ativado, cada hook salva seu payload em:
#   .github/hooks/state/debug/payloads/<event>-<timestamp>.json
#
# SEGURANÇA: Nunca commitar payloads (podem conter conteúdo do usuário).
# O diretório .github/hooks/state/ já deve estar no .gitignore.

HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEBUG_DIR="$HOOKS_DIR/state/debug/payloads"
CAPTURE_FLAG="$HOOKS_DIR/state/debug/capture.enabled"

case "${1:-status}" in

    on)
        mkdir -p "$DEBUG_DIR"
        touch "$CAPTURE_FLAG"
        echo "✓ Captura de payloads ATIVADA"
        echo "  → Payloads salvos em: $DEBUG_DIR"
        echo "  → Para ver: bash .github/hooks/scripts/debug-capture.sh show"
        ;;

    off)
        rm -f "$CAPTURE_FLAG"
        echo "✓ Captura de payloads DESATIVADA"
        ;;

    show)
        local_event="${2:-}"
        if [ ! -d "$DEBUG_DIR" ] || [ -z "$(ls -A "$DEBUG_DIR" 2>/dev/null)" ]; then
            echo "(nenhum payload capturado ainda — ative com: debug-capture.sh on)"
            exit 0
        fi
        echo "=== Payloads capturados ==="
        if [ -n "$local_event" ]; then
            # Filtrar por evento
            for f in "$DEBUG_DIR"/${local_event}*.json; do
                [ -f "$f" ] || continue
                echo ""
                echo "--- $(basename "$f") ---"
                jq '.' "$f" 2>/dev/null || cat "$f"
            done
        else
            # Listar todos
            for f in "$DEBUG_DIR"/*.json; do
                [ -f "$f" ] || continue
                echo "  $(basename "$f") ($(wc -c < "$f") bytes)"
            done
            echo ""
            echo "Para ver conteúdo: debug-capture.sh show <evento>"
            echo "Eventos disponíveis: SessionStart UserPromptSubmit PreToolUse PostToolUse"
            echo "                     Stop PreCompact SubagentStart SubagentStop"
        fi
        ;;

    clear)
        rm -rf "$DEBUG_DIR"
        mkdir -p "$DEBUG_DIR"
        echo "✓ Payloads limpos"
        ;;

    status)
        if [ -f "$CAPTURE_FLAG" ]; then
            COUNT=$(ls "$DEBUG_DIR"/*.json 2>/dev/null | wc -l)
            echo "Captura: ATIVA | Payloads: $COUNT arquivos em $DEBUG_DIR"
        else
            echo "Captura: INATIVA (ative com: bash .github/hooks/scripts/debug-capture.sh on)"
        fi
        ;;

    *)
        echo "Uso: debug-capture.sh [on|off|show [evento]|clear|status]"
        exit 1
        ;;
esac
