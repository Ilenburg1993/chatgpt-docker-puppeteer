#!/bin/bash
# test-level1-detect.sh — Testa Nível 1 (DETECT) anomaly detection logic
# Valida que os 3 cenários principais retornam os alertas esperados

set -euo pipefail

echo "🧪 Testando Nível 1 (DETECT — Anomaly Detection)"
echo "=================================================="
echo ""

ORIG_HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_DIR="$(mktemp -d)"
trap 'rm -rf "$SANDBOX_DIR"' EXIT

cp -a "$ORIG_HOOK_DIR" "$SANDBOX_DIR/hooks"
HOOK_DIR="$SANDBOX_DIR/hooks"
STATE_DIR="$HOOK_DIR/state"
LOG_DIR="$HOOK_DIR/logs"
CHECKPOINT_DIR="$HOOK_DIR/checkpoints"

# Limpa estado anterior
rm -f "$STATE_DIR/session-context.json" "$STATE_DIR/session-context-test*.json"
rm -f "$LOG_DIR/audit.jsonl" "$LOG_DIR/audit-test*.jsonl"
rm -f "$STATE_DIR/SESSION_CLOSE_NO_KEY.flag" "$STATE_DIR/SESSION_CLOSE_AUTHORIZED.flag" "$STATE_DIR/UNAUTHORIZED_CLOSE.flag"
rm -f "$CHECKPOINT_DIR"/*.json "$CHECKPOINT_DIR"/*.jsonl 2> /dev/null || true
mkdir -p "$STATE_DIR" "$LOG_DIR" "$CHECKPOINT_DIR"

# ──────────────────────────────────────────────────────────────────────────────
# Scenario A: Nova sessão (close_mode = "ok")
# ──────────────────────────────────────────────────────────────────────────────
echo "✓ Scenario A: Nova sessão (nenhuma anterior)"
(
    rm -f "$STATE_DIR"/session-context*.json "$LOG_DIR"/audit*.jsonl "$CHECKPOINT_DIR"/*.json 2> /dev/null || true

    export STATE_DIR LOG_DIR HOOK_DIR CHECKPOINT_DIR

    INPUT='{"timestamp":"2026-03-15T10:00:00Z","cwd":"/workspace","source":"new"}'

    # Simula chamada do hook
    echo "$INPUT" | bash "$HOOK_DIR/scripts/session-start.sh" > /dev/null 2>&1 || true

    CTX_FILE="$(ls -1t "$STATE_DIR"/session-context-*.json 2> /dev/null | head -1 || true)"
    if [ -z "$CTX_FILE" ] || [ ! -f "$CTX_FILE" ]; then
        echo "  ❌ session-context não gerado no Scenario A"
        exit 1
    fi

    # Valida result
    if [ "$(jq -r '.recovery.close_mode // ""' "$CTX_FILE" 2> /dev/null || echo '')" = "ok" ]; then
        echo "  ✅ close_mode = ok"
    else
        echo "  ❌ close_mode deveria ser 'ok'"
        exit 1
    fi

    if [ "$(jq -r '(.recovery.alerts // []) | length' "$CTX_FILE" 2> /dev/null || echo -1)" -eq 0 ] 2> /dev/null; then
        echo "  ✅ alerts array vazio"
    else
        echo "  ❌ alerts deveria estar vazio"
        exit 1
    fi

    if [ "$(jq -r '.recovery.alerts_require_kickoff // false' "$CTX_FILE" 2> /dev/null || echo true)" = "false" ]; then
        echo "  ✅ alerts_require_kickoff = false"
    else
        echo "  ❌ alerts_require_kickoff deveria ser false"
        exit 1
    fi
)

echo ""
echo "✓ Scenario B: abrupt_no_key (sem autorização)"
(
    rm -f "$STATE_DIR"/session-context*.json "$LOG_DIR"/audit*.jsonl "$CHECKPOINT_DIR"/*.json 2> /dev/null || true

    # Cria checkpoint fake com close_key_validated=false
    PREV_CHECKPOINT="$CHECKPOINT_DIR/sess_prev123_turn10.json"
    cat > "$PREV_CHECKPOINT" << 'EOF'
{
    "session_id": "prev123-old",
  "turn_count": 10,
        "checkpoint_ts": "2020-03-15T09:55:00Z",
  "session": {
    "close_key_validated": false
  }
}
EOF

    export STATE_DIR LOG_DIR HOOK_DIR CHECKPOINT_DIR

    INPUT='{"timestamp":"2026-03-15T10:01:00Z","cwd":"/workspace","source":"new"}'

    # Simula chamada do hook
    echo "$INPUT" | bash "$HOOK_DIR/scripts/session-start.sh" > /dev/null 2>&1 || true

    CTX_FILE="$(ls -1t "$STATE_DIR"/session-context-*.json 2> /dev/null | head -1 || true)"
    if [ -z "$CTX_FILE" ] || [ ! -f "$CTX_FILE" ]; then
        echo "  ❌ session-context não gerado no Scenario B"
        exit 1
    fi

    # Valida result
    if [ "$(jq -r '.recovery.close_mode // ""' "$CTX_FILE" 2> /dev/null || echo '')" = "abrupt_no_key" ]; then
        echo "  ✅ close_mode = abrupt_no_key"
    else
        echo "  ❌ close_mode deveria ser 'abrupt_no_key'"
        exit 1
    fi

    if jq -e '(.recovery.alerts // []) | any(test("ANOMALY DETECTED"))' "$CTX_FILE" > /dev/null 2>&1; then
        echo "  ✅ alert ANOMALY_DETECTED presente"
    else
        echo "  ❌ alert ANOMALY_DETECTED não encontrado"
        exit 1
    fi

    if [ "$(jq -r '.recovery.alerts_require_kickoff // false' "$CTX_FILE" 2> /dev/null || echo false)" = "true" ]; then
        echo "  ✅ alerts_require_kickoff = true"
    else
        echo "  ❌ alerts_require_kickoff deveria ser true"
        exit 1
    fi

    rm -f "$PREV_CHECKPOINT"
)

echo ""
echo "✓ Scenario C: abrupt_reconnect (reconexão)"
(
    rm -f "$STATE_DIR"/session-context*.json "$LOG_DIR"/audit*.jsonl "$CHECKPOINT_DIR"/*.json 2> /dev/null || true

    # Cria checkpoint fake e audit com sessionReconnect
    PREV_SESSION_ID="prev456-old"
    PREV_CHECKPOINT="$CHECKPOINT_DIR/sess_prev456_turn05.json"
    cat > "$PREV_CHECKPOINT" << 'EOF'
{
    "session_id": "prev456-old",
  "turn_count": 5,
        "checkpoint_ts": "2020-03-15T09:50:00Z",
  "session": {
    "close_key_validated": false
  }
}
EOF

    # Simula audit entries com sessionEnd sintético + sessionReconnect
    PREV_SID_SHORT="${PREV_SESSION_ID:0:8}"
    AUDIT_FILE="$LOG_DIR/audit-${PREV_SID_SHORT}.jsonl"
    cat >> "$AUDIT_FILE" << 'EOF'
{"event":"sessionEnd","session_id":"prev456-old","timestamp":"2026-03-15T09:51:00Z"}
{"event":"sessionReconnect","session_id":"prev456-old","timestamp":"2026-03-15T09:52:00Z"}
EOF

    export STATE_DIR LOG_DIR HOOK_DIR CHECKPOINT_DIR

    INPUT='{"timestamp":"2026-03-15T10:02:00Z","cwd":"/workspace","source":"new"}'

    # Simula chamada do hook
    echo "$INPUT" | bash "$HOOK_DIR/scripts/session-start.sh" > /dev/null 2>&1 || true

    CTX_FILE="$(ls -1t "$STATE_DIR"/session-context-*.json 2> /dev/null | head -1 || true)"
    if [ -z "$CTX_FILE" ] || [ ! -f "$CTX_FILE" ]; then
        echo "  ❌ session-context não gerado no Scenario C"
        exit 1
    fi

    # Valida result
    if [ "$(jq -r '.recovery.close_mode // ""' "$CTX_FILE" 2> /dev/null || echo '')" = "abrupt_reconnect" ]; then
        echo "  ✅ close_mode = abrupt_reconnect"
    else
        echo "  ❌ close_mode deveria ser 'abrupt_reconnect'"
        exit 1
    fi

    if jq -e '(.recovery.alerts // []) | any(test("INFO"))' "$CTX_FILE" > /dev/null 2>&1; then
        echo "  ✅ alert INFO presente"
    else
        echo "  ❌ alert INFO não encontrado"
        exit 1
    fi

    if [ "$(jq -r '.recovery.alerts_require_kickoff' "$CTX_FILE" 2> /dev/null || echo true)" = "false" ]; then
        echo "  ✅ alerts_require_kickoff = false (informativo)"
    else
        echo "  ❌ alerts_require_kickoff deveria ser false"
        exit 1
    fi

    rm -f "$PREV_CHECKPOINT" "$AUDIT_FILE"
)

echo ""
echo "✓ Scenario D: key_validated (KEY validada sem close autorizado)"
(
    rm -f "$STATE_DIR"/session-context*.json "$LOG_DIR"/audit*.jsonl "$CHECKPOINT_DIR"/*.json 2> /dev/null || true

    PREV_CHECKPOINT="$CHECKPOINT_DIR/sess_prev789_turn03.json"
    cat > "$PREV_CHECKPOINT" << 'EOF'
{
    "session_id": "prev789-old",
  "turn_count": 3,
        "checkpoint_ts": "2020-03-15T09:40:00Z",
  "session": {
    "close_key_validated": true
  }
}
EOF

    export STATE_DIR LOG_DIR HOOK_DIR CHECKPOINT_DIR

    INPUT='{"timestamp":"2026-03-15T10:03:00Z","cwd":"/workspace","source":"new"}'

    echo "$INPUT" | bash "$HOOK_DIR/scripts/session-start.sh" > /dev/null 2>&1 || true

    CTX_FILE="$(ls -1t "$STATE_DIR"/session-context-*.json 2> /dev/null | head -1 || true)"
    if [ -z "$CTX_FILE" ] || [ ! -f "$CTX_FILE" ]; then
        echo "  ❌ session-context não gerado no Scenario D"
        exit 1
    fi

    if [ "$(jq -r '.recovery.close_mode // ""' "$CTX_FILE" 2> /dev/null || echo '')" = "key_validated" ]; then
        echo "  ✅ close_mode = key_validated"
    else
        echo "  ❌ close_mode deveria ser 'key_validated'"
        exit 1
    fi

    if jq -e '(.recovery.alerts // []) | any(test("WARNING"))' "$CTX_FILE" > /dev/null 2>&1; then
        echo "  ✅ alert WARNING presente"
    else
        echo "  ❌ alert WARNING não encontrado"
        exit 1
    fi

    if [ "$(jq -r '.recovery.alerts_require_kickoff' "$CTX_FILE" 2> /dev/null || echo true)" = "false" ]; then
        echo "  ✅ alerts_require_kickoff = false"
    else
        echo "  ❌ alerts_require_kickoff deveria ser false"
        exit 1
    fi

    rm -f "$PREV_CHECKPOINT"
)

echo ""
echo "✓ Scenario E: clean (sessionCloseAuthorized presente no audit)"
(
    rm -f "$STATE_DIR"/session-context*.json "$LOG_DIR"/audit*.jsonl "$CHECKPOINT_DIR"/*.json 2> /dev/null || true

    PREV_SESSION_ID="abcd1234-prev"
    PREV_CHECKPOINT="$CHECKPOINT_DIR/sess_prev900_turn04.json"
    cat > "$PREV_CHECKPOINT" << EOF
{
  "session_id": "$PREV_SESSION_ID",
  "turn_count": 4,
        "checkpoint_ts": "2020-03-15T09:35:00Z",
  "session": {
    "close_key_validated": false
  }
}
EOF

    PREV_SID_SHORT="${PREV_SESSION_ID:0:8}"
    AUDIT_FILE="$LOG_DIR/audit-${PREV_SID_SHORT}.jsonl"
    cat >> "$AUDIT_FILE" << EOF
{"event":"sessionCloseAuthorized","session_id":"$PREV_SESSION_ID","timestamp":"2026-03-15T09:36:00Z"}
EOF

    export STATE_DIR LOG_DIR HOOK_DIR CHECKPOINT_DIR

    INPUT='{"timestamp":"2026-03-15T10:04:00Z","cwd":"/workspace","source":"new"}'

    echo "$INPUT" | bash "$HOOK_DIR/scripts/session-start.sh" > /dev/null 2>&1 || true

    CTX_FILE="$(ls -1t "$STATE_DIR"/session-context-*.json 2> /dev/null | head -1 || true)"
    if [ -z "$CTX_FILE" ] || [ ! -f "$CTX_FILE" ]; then
        echo "  ❌ session-context não gerado no Scenario E"
        exit 1
    fi

    if [ "$(jq -r '.recovery.close_mode // ""' "$CTX_FILE" 2> /dev/null || echo '')" = "clean" ]; then
        echo "  ✅ close_mode = clean"
    else
        echo "  ❌ close_mode deveria ser 'clean'"
        exit 1
    fi

    if [ "$(jq -r '(.recovery.alerts // []) | length' "$CTX_FILE" 2> /dev/null || echo -1)" -eq 0 ] 2> /dev/null; then
        echo "  ✅ alerts array vazio"
    else
        echo "  ❌ alerts deveria estar vazio"
        exit 1
    fi

    rm -f "$PREV_CHECKPOINT" "$AUDIT_FILE"
)

echo ""
echo "✓ Scenario F: checkpoint sintético deve ser ignorado"
(
    rm -f "$STATE_DIR"/session-context*.json "$LOG_DIR"/audit*.jsonl "$CHECKPOINT_DIR"/*.json 2> /dev/null || true

    SYNTH_CHECKPOINT="$CHECKPOINT_DIR/sess_test999_turn99.json"
    cat > "$SYNTH_CHECKPOINT" << 'EOF'
{
  "session_id": "sess_test999_old",
  "turn_count": 99,
        "checkpoint_ts": "2020-03-15T09:59:00Z",
  "session": {
    "close_key_validated": false
  }
}
EOF

    export STATE_DIR LOG_DIR HOOK_DIR CHECKPOINT_DIR
    INPUT='{"timestamp":"2026-03-15T10:05:00Z","cwd":"/workspace","source":"new"}'

    echo "$INPUT" | bash "$HOOK_DIR/scripts/session-start.sh" > /dev/null 2>&1 || true

    CTX_FILE="$(ls -1t "$STATE_DIR"/session-context-*.json 2> /dev/null | head -1 || true)"
    if [ -z "$CTX_FILE" ] || [ ! -f "$CTX_FILE" ]; then
        echo "  ❌ session-context não gerado no Scenario F"
        exit 1
    fi

    if [ "$(jq -r '.recovery.close_mode // ""' "$CTX_FILE" 2> /dev/null || echo '')" = "ok" ]; then
        echo "  ✅ close_mode = ok (checkpoint sintético ignorado)"
    else
        echo "  ❌ close_mode deveria ser 'ok' com checkpoint sintético"
        exit 1
    fi

    if [ "$(jq -r '.recovery.prev_session_id // ""' "$CTX_FILE" 2> /dev/null || echo '')" = "" ]; then
        echo "  ✅ prev_session_id vazio (sem contaminação)"
    else
        echo "  ❌ prev_session_id deveria estar vazio"
        exit 1
    fi

    rm -f "$SYNTH_CHECKPOINT"
)

echo ""
echo "=================================================="
echo "✅ Todos os testes de Nível 1 (DETECT) passaram!"
echo ""
echo "📊 Resumo:"
echo "  • Scenario A (ok): ✓"
echo "  • Scenario B (abrupt_no_key): ✓"
echo "  • Scenario C (abrupt_reconnect): ✓"
echo "  • Scenario D (key_validated): ✓"
echo "  • Scenario E (clean): ✓"
echo "  • Scenario F (ignore synthetic checkpoint): ✓"
echo ""
echo "🎯 Nível 1 (DETECT) implementado com sucesso!"
