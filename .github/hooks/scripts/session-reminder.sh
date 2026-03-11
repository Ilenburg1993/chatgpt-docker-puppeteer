#!/bin/bash
# session-reminder.sh — Lembrete de protocolo de encerramento de SESSION
# Uso: bash .github/hooks/scripts/session-reminder.sh
#
# Propósito: Script standalone que o agente pode chamar a qualquer momento
# para obter um lembrete claro do protocolo SESSION/SECTION/TURN e da
# close_key ativa. Saída legível no terminal.
#
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  SESSION ≠ SECTION ≠ TURN — DISTINÇÃO CRÍTICA                          ║
# ╚══════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$(cd "${SCRIPT_DIR}/../state" && pwd)"
CTX_FILE="$STATE_DIR/session-context.json"

echo ""
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║         PROTOCOLO DE ENCERRAMENTO — SESSION vs SECTION vs TURN          ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "  CONCEITOS (distinção obrigatória):"
echo "  ─────────────────────────────────"
echo "  TURN    → Ciclo prompt→resposta. Encerra LIVREMENTE (sem autorização)."
echo "  SECTION → Fase lógica dentro da SESSION. Agente decide autonomamente:"
echo "            bash .github/hooks/scripts/start-section.sh \"nome-da-fase\""
echo "  SESSION → 1 ativação do Copilot Chat. Fecha SOMENTE com protocolo de 3 etapas:"
echo ""
echo "  PROTOCOLO DE 3 ETAPAS PARA ENCERRAR A SESSION:"
echo "  ──────────────────────────────────────────────"
echo "    1. Agente chama vscode_askQuestions com Template F"
echo "    2. Usuário digita a chave SESSION no campo livre"
echo "    3. Agente executa: bash .github/hooks/scripts/session-close.sh \"KEY\""
echo ""

if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // "N/A"' "$CTX_FILE" 2> /dev/null || echo 'N/A')"
    CLOSE_KEY="$(jq -r '.session.close_key // "N/A"' "$CTX_FILE" 2> /dev/null || echo 'N/A')"
    CLOSE_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
    SECTION="$(jq -r '.current_section.name // "(sem section)"' "$CTX_FILE" 2> /dev/null || echo '(sem section)')"
    TURN="$(jq -r '.current_turn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    SECTION_TURN="$(jq -r '.current_turn.section_turn // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    CONSEC="$(jq -r '.compliance.consecutive_unauthorized // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    TURNS_SINCE="$(jq -r '.session_stats.turns_since_askQuestions // 0' "$CTX_FILE" 2> /dev/null || echo 0)"

    echo "  ESTADO ATUAL DA SESSION:"
    echo "  ─────────────────────────"
    echo "  Session ID : $SESSION_ID"
    echo "  Close Key  : $CLOSE_KEY"
    if [ "$CLOSE_VALIDATED" = "true" ]; then
        echo "  Status KEY : ✅ VALIDADA (session-close.sh pode ser chamado)"
    else
        echo "  Status KEY : ⏳ PENDENTE (aguardando Template F + usuário digitar a KEY)"
    fi
    echo ""
    echo "  SECTION ativa : \"$SECTION\""
    echo "  TURN atual    : #$TURN (seção: #$SECTION_TURN)"
    echo "  TURNs sem vscode_askQuestions : $TURNS_SINCE"
    echo "  TURNs consecutivos sem ask    : $CONSEC"
    echo ""

    if { [ "$CONSEC" -ge 2 ] 2> /dev/null; }; then
        echo "  ⛔ ALERTA: $CONSEC TURNs consecutivos sem vscode_askQuestions!"
        echo "     → Chame vscode_askQuestions AGORA (Template A, D, ou C)"
    elif { [ "$CONSEC" -ge 1 ] 2> /dev/null; }; then
        echo "  ⚠️  ATENÇÃO: $CONSEC TURN consecutivo sem vscode_askQuestions"
        echo "     → Prefira chamar vscode_askQuestions ao final desta resposta"
    fi
    echo ""
    echo "  COMANDO PARA ENCERRAR A SESSION:"
    echo "  bash .github/hooks/scripts/session-close.sh \"${CLOSE_KEY}\""
    echo ""
else
    echo "  ⚠️  session-context.json não encontrado ou vazio"
    echo "  Não foi possível ler close_key da sessão ativa."
fi

echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║  REGRA: Terminar uma resposta ≠ encerrar a SESSION.                     ║"
echo "║  A SESSION só encerra com a KEY + session-close.sh.                    ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo ""
