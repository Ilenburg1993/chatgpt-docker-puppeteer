#!/usr/bin/env bash
# common.sh — Funções compartilhadas por todos os hooks
# Deve ser sourceado como PRIMEIRO passo de cada lib.
# Não usar set -euo pipefail aqui (libs são sourceadas, não executadas).

# ---------------------------------------------------------------------------
# Caminhos fundamentais (calculados a partir deste arquivo, independente do cwd)
# ---------------------------------------------------------------------------
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Permite override do diretório de state para testes (NUNCA usar em produção)
if [ -n "${HOOKS_TEST_STATE_DIR:-}" ]; then
    STATE_DIR="$HOOKS_TEST_STATE_DIR"
else
    STATE_DIR="$HOOK_DIR/state"
fi

STATE_FILE="$STATE_DIR/session.json"
AUDIT_FILE="$STATE_DIR/audit.jsonl"

# ---------------------------------------------------------------------------
# Verificação de dependência crítica
# ---------------------------------------------------------------------------
if ! command -v jq > /dev/null 2>&1; then
    printf 'ERROR[hooks/common.sh]: jq is required but not installed\n' >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Funções de estado
# ---------------------------------------------------------------------------

# Retorna 0 se session.json existe e é JSON válido
state_exists() {
    [ -f "$STATE_FILE" ] && jq -e . "$STATE_FILE" > /dev/null 2>&1
}

# Le campo do session.json via jq path (ex: ".current_turn.number")
# AVISO: usa `// empty` para retornar "" para campos null/ausentes.
# LIMITACAO: boolean `false` tambem retorna "" (falsy para o operador // do jq).
# Para leitura de booleanos, o caller deve tratar "" como "false".
read_field() {
    local path="$1"
    jq -r "${path} // empty" "$STATE_FILE" 2> /dev/null
}

# Atualiza campo de raiz STRING no session.json atomicamente
# CUIDADO: não usar para booleanos nem campos aninhados
update_state() {
    local key="$1" val="$2"
    local tmp
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    jq --arg k "$key" --arg v "$val" '.[$k] = $v' "$STATE_FILE" > "$tmp" || {
        rm -f "$tmp"
        return 1
    }
    mv -f "$tmp" "$STATE_FILE" || {
        rm -f "$tmp"
        return 1
    }
}

# Atualiza campo de raiz BOOLEANO no session.json atomicamente
# val deve ser a string "true" ou "false"
update_state_bool() {
    local key="$1" val="$2"
    local tmp
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    jq --arg k "$key" --argjson v "$val" '.[$k] = $v' "$STATE_FILE" > "$tmp" || {
        rm -f "$tmp"
        return 1
    }
    mv -f "$tmp" "$STATE_FILE" || {
        rm -f "$tmp"
        return 1
    }
}

# Atualiza campo aninhado no session.json via jq path syntax
# Detecta automaticamente tipo: bool (true|false), número (só dígitos), string (demais)
# Uso: update_nested_state "current_turn.ask_questions_called" "true"
#      update_nested_state "session_stats.turn_count" "5"
#      update_nested_state "current_turn.turn_id" "uuid-abc"
update_nested_state() {
    local key_path="$1" val="$2"
    local tmp jq_path
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    jq_path=".${key_path}"

    case "$val" in
        true | false)
            # GAP-34: booleano → argjson
            jq --argjson v "$val" "${jq_path} = \$v" "$STATE_FILE" > "$tmp" || {
                rm -f "$tmp"
                return 1
            }
            ;;
        null)
            # GAP-34: null literal → sem arg (injetado direto no jq filter)
            jq "${jq_path} = null" "$STATE_FILE" > "$tmp" || {
                rm -f "$tmp"
                return 1
            }
            ;;
        *)
            # GAP-34: número (int positivo, negativo, float) → argjson; o resto → string
            if printf '%s' "$val" | grep -qE '^-?[0-9]+(\.[0-9]+)?$'; then
                jq --argjson v "$val" "${jq_path} = \$v" "$STATE_FILE" > "$tmp" || {
                    rm -f "$tmp"
                    return 1
                }
            else
                jq --arg v "$val" "${jq_path} = \$v" "$STATE_FILE" > "$tmp" || {
                    rm -f "$tmp"
                    return 1
                }
            fi
            ;;
    esac

    # GAP-36: cleanup de temp file em falha de mv
    mv -f "$tmp" "$STATE_FILE" || {
        rm -f "$tmp"
        return 1
    }
}

# Substitui session.json inteiro pelo JSON fornecido (escrita atômica via mktemp)
write_state() {
    local json="$1"
    local tmp
    mkdir -p "$STATE_DIR"
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    printf '%s\n' "$json" > "$tmp"
    mv -f "$tmp" "$STATE_FILE"
}

# Cria state/session.json com zero state para nova sessão
# Uso: init_state "sessionId" ["new"|"reconnect"]
init_state() {
    local session_id="${1:-unknown}"
    local source="${2:-new}"
    local close_key now

    close_key=$(make_close_key)
    now=$(now_iso)

    mkdir -p "$STATE_DIR"

    jq -n \
        --arg sid "$session_id" \
        --arg start "$now" \
        --arg key "$close_key" \
        --arg src "$source" \
        '{
            "_comment": "gerado por session-start.sh",
            "vs_code_session_id": $sid,
            "session_id": $sid,
            "started_at": $start,
            "ended_at": null,
            "close_key": $key,
            "source": $src,
            "pending_session_close": false,
            "strict_turn_close": true,
            "current_turn": {
                "number": 0,
                "turn_id": null,
                "started_at": null,
                "ended_at": null,
                "intent": "",
                "source": "unknown",
                "ask_questions_called": false,
                "ask_questions_turn_pos": 0,
                "last_template": "",
                "subturn_count": 0,
                "tools_count": 0,
                "subagents_started": 0
            },
            "current_subturn": {
                "number": 0,
                "subturn_id": null,
                "started_at": null,
                "ended_at": null,
                "response_at": null,
                "duration_ms": 0
            },
            "session_stats": {
                "turn_count": 0,
                "turn_authorized": 0,
                "turn_unauthorized": 0,
                "subturn_total": 0,
                "subturn_duration_total_ms": 0,
                "subturn_count_timed": 0,
                "tools_total": 0,
                "tools_blocked": 0,
                "tools_by_type": {},
                "subagents_active": 0,
                "subagents_total": 0
            },
            "compliance": {
                "consecutive_unauthorized": 0,
                "last_turn_authorized": true,
                "template_usage": {"A":0,"B":0,"C":0,"D":0,"E":0,"F":0,"G":0},
                "last_template": "",
                "template_usage": {"A":0,"B":0,"C":0,"D":0,"E":0,"F":0,"G":0},
                "last_template": ""
            }
        }' > "$STATE_FILE"
}

# recover_or_init_state — GAP-57: tenta recuperar state de checkpoint antes de init_state()
# Se session.json não existe/está corrompido: restaura do checkpoint mais recente válido,
# ou faz init_state limpo. Registra no audit.jsonl o que aconteceu.
# Uso: recover_or_init_state "session_id" ["new"|"reconnect"]
recover_or_init_state() {
    local session_id="${1:-unknown}"
    local source="${2:-new}"

    # Se state já existe e é válido, nada a recuperar
    if state_exists 2> /dev/null; then
        return 0
    fi

    local checkpoint_dir="$STATE_DIR/checkpoints"

    # Tenta o checkpoint mais recente que seja JSON válido
    if [ -d "$checkpoint_dir" ]; then
        local best_cp=""
        # Mais recente primeiro (ls -t)
        while IFS= read -r cp; do
            if jq empty "$cp" 2> /dev/null; then
                best_cp="$cp"
                break
            fi
        done < <(ls -t "$checkpoint_dir"/session-*.json 2> /dev/null)

        if [ -n "$best_cp" ]; then
            cp "$best_cp" "$STATE_FILE" 2> /dev/null || true
            if state_exists 2> /dev/null; then
                hook_log_audit "state_recovered_from_checkpoint" \
                    "checkpoint" "$(basename "$best_cp")" \
                    "session_id" "$session_id"
                return 0
            fi
        fi
    fi

    # Nenhum checkpoint válido — init limpo
    init_state "$session_id" "$source"
    hook_log_audit "state_initialized_clean" \
        "session_id" "$session_id" \
        "source" "$source"
}

# ---------------------------------------------------------------------------
# Função de log de auditoria (canônica — Parte 10.10 do plano)
# [LEGADO — DEPRECADO] Use hook_log_audit() de api/15-audit.sh
# Usa jq -n --arg para prevenir JSON injection.
# Assinatura posicional: log_audit "event" [key1 value1 key2 value2 ...]
# @deprecated Use hook_log_audit() de api/15-audit.sh
# ---------------------------------------------------------------------------
log_audit() {
    local event="$1"
    shift
    local ts sid json_obj k v

    ts="$(now_iso)"
    sid="${SESSION_ID:-$([ -f "$STATE_FILE" ] && jq -r '.session_id // "unknown"' "$STATE_FILE" 2> /dev/null || echo "unknown")}"

    json_obj=$(jq -cn \
        --arg ts "$ts" \
        --arg ev "$event" \
        --arg sid "$sid" \
        '{ts: $ts, event: $ev, session_id: $sid}')

    # Adicionar campos extras via jq (seguro contra injection)
    while [ "$#" -ge 2 ]; do
        k="$1" v="$2"
        shift 2
        json_obj=$(printf '%s' "$json_obj" | jq -c --arg k "$k" --arg v "$v" '. + {($k): $v}')
    done

    mkdir -p "$STATE_DIR"
    printf '%s\n' "$json_obj" >> "$AUDIT_FILE"
}

# ---------------------------------------------------------------------------
# Funções de output JSON para o VS Code
# [LEGADO — DEPRECADO] Use os equivalentes na API: hook-payload-api.sh
#   emit_stop_block()       → hook_out_stop_block()     (05-output.sh)
#   emit_additional_context() → hook_out_additional_context() (05-output.sh)
#   emit_permission_deny()  → hook_out_pre_deny()        (05-output.sh)
#   emit_post_tool_block()  → hook_out_post_block()      (05-output.sh)
# UP-16: funções depreciadas removidas — migração completa para 05-output.sh.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Funções auxiliares
# ---------------------------------------------------------------------------

# Retorna timestamp ISO 8601 em UTC
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Gera close_key aleatória no formato ENCERRAR-XXXXXXXX (8 chars hex maiúsculos)
make_close_key() {
    local hex
    # Prefere /proc/sys/kernel/random/uuid (Linux — disponível sem uuidgen/xxd)
    if [ -r /proc/sys/kernel/random/uuid ]; then
        hex=$(tr -d '-' < /proc/sys/kernel/random/uuid | tr '[:lower:]' '[:upper:]' | cut -c1-8)
    elif command -v od > /dev/null 2>&1 && [ -r /dev/urandom ]; then
        hex=$(od -An -tx1 /dev/urandom 2> /dev/null | tr -d ' \n' | head -c8 | tr '[:lower:]' '[:upper:]')
    elif [ -r /dev/urandom ]; then
        # GAP-09: fallback com dd quando od não está disponível (evita timestamp previsível)
        hex=$(dd if=/dev/urandom bs=4 count=1 2> /dev/null | od -An -tx1 2> /dev/null | tr -d ' \n' | cut -c1-8 | tr '[:lower:]' '[:upper:]')
        # Se dd+od falhar, tenta via awk seed de /dev/urandom
        if [ -z "$hex" ]; then
            hex=$(awk 'BEGIN{srand();printf "%08X\n",int(rand()*4294967295)}' /dev/null 2> /dev/null || true)
        fi
    fi
    # Último recurso: derivado do timestamp (menos aleatório, mas funcional)
    if [ -z "$hex" ]; then
        hex=$(date +%s%N 2> /dev/null | tr -d '[:space:]' | head -c8 | tr '[:lower:]' '[:upper:]')
    fi
    printf 'ENCERRAR-%s' "$hex"
}

# Extrai campo de JSON passado como string (seguro com input não-confiável)
# Uso: jq_field "$input" ".tool_name"
jq_field() {
    printf '%s' "$1" | jq -r "${2} // empty"
}

# ---------------------------------------------------------------------------
# Identificadores e IDs portáveis
# ---------------------------------------------------------------------------

# Gera UUID v4 sem depender do binário `uuidgen` (usa /dev/urandom + awk)
# Fallback: timestamp + random se /dev/urandom falhar
uuidgen_safe() {
    if command -v uuidgen > /dev/null 2>&1; then
        uuidgen | tr '[:upper:]' '[:lower:]'
    else
        local rnd
        rnd=$(cat /proc/sys/kernel/random/uuid 2> /dev/null || true)
        if [ -n "$rnd" ]; then
            printf '%s' "$rnd"
        else
            # Fallback: hex aleatório formatado como UUID
            local b
            b=$(od -An -tx1 /dev/urandom 2> /dev/null | tr -d ' \n' | head -c32 || date +%s%N | tr -d '[:space:]')
            printf '%s-%s-%s-%s-%s\n' \
                "${b:0:8}" "${b:8:4}" "4${b:13:3}" "${b:16:4}" "${b:20:12}"
        fi
    fi
}

# Gera ID de seção canônico: "seção-XXXXXXXX" (8 hex chars)
generate_section_id() {
    local name="${1:-unknown}"
    local suffix
    # GAP-11: usa od em vez de xxd (od é padrão POSIX, xxd não está em todas distros)
    suffix=$(od -An -tx1 /dev/urandom 2> /dev/null | tr -d ' \n' | head -c8)
    printf '%s-%s' "$(printf '%s' "$name" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')" "$suffix"
}

# ---------------------------------------------------------------------------
# Leitura de payload (stdin)
# ---------------------------------------------------------------------------

# Lê o payload JSON do stdin e armazena em HOOK_INPUT global.
# Retorna 0 se parseable, 1 se stdin vazio ou inválido (HOOK_INPUT = "{}").
# Se debug capture estiver ativo (state/debug/capture.enabled), salva o payload.
# Uso: load_payload; tool_name=$(jq_field "$HOOK_INPUT" ".tool_name")
load_payload() {
    HOOK_INPUT=$(cat /dev/stdin 2> /dev/null || true)
    if [ -z "$HOOK_INPUT" ]; then
        HOOK_INPUT='{}'
        return 1
    fi
    if ! printf '%s' "$HOOK_INPUT" | jq -e . > /dev/null 2>&1; then
        HOOK_INPUT='{}'
        return 1
    fi
    # Captura automática se debug mode ativo
    maybe_capture_debug "$HOOK_INPUT"
    return 0
}

# Salva payload para diagnóstico se STATE_DIR/debug/capture.enabled existir.
# Nunca falha — erros são silenciosos para não impactar o hook principal.
# Uso: maybe_capture_debug "$payload"
maybe_capture_debug() {
    local payload="$1"
    local flag="$STATE_DIR/debug/capture.enabled"
    [ -f "$flag" ] || return 0

    local event ts_slug debug_dir
    event=$(printf '%s' "$payload" | jq -r '.hookEventName // "unknown"' 2> /dev/null || echo "unknown")
    ts_slug=$(date -u +%Y%m%dT%H%M%SZ 2> /dev/null || date +%s)
    debug_dir="$STATE_DIR/debug/payloads"
    mkdir -p "$debug_dir" 2> /dev/null || return 0

    printf '%s' "$payload" | jq '.' > "$debug_dir/${event}-${ts_slug}.json" 2> /dev/null || true
}

# ---------------------------------------------------------------------------
# Operações atômicas em campos numéricos
# ---------------------------------------------------------------------------

# Incrementa campo numérico aninhado atomicamente e retorna o novo valor
# Uso: new_val=$(increment_field ".session_stats.turn_count")
increment_field() {
    local path="$1"
    local current new_val tmp
    current=$(read_field "$path")
    new_val=$((${current:-0} + 1))
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    jq --argjson v "$new_val" "${path} = \$v" "$STATE_FILE" > "$tmp" || {
        rm -f "$tmp"
        return 1
    }
    mv -f "$tmp" "$STATE_FILE" || {
        rm -f "$tmp"
        return 1
    }
    printf '%d' "$new_val"
}

# Decrementa campo numérico para zero (nunca negativo)
# Uso: decrement_field_floor0 ".compliance.consecutive_unauthorized"
decrement_field_floor0() {
    local path="$1"
    local current new_val tmp
    current=$(read_field "$path")
    new_val=$((${current:-0} > 0 ? ${current:-0} - 1 : 0))
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    jq --argjson v "$new_val" "${path} = \$v" "$STATE_FILE" > "$tmp" || {
        rm -f "$tmp"
        return 1
    }
    mv -f "$tmp" "$STATE_FILE" || {
        rm -f "$tmp"
        return 1
    }
    printf '%d' "$new_val"
}

# ---------------------------------------------------------------------------
# Detecção de close_key
# [LEGADO — DEPRECADO] Use hook_close_key_detect_in_text() de 10-close-key.sh
# ---------------------------------------------------------------------------

# @deprecated Use hook_close_key_detect_in_text() de api/10-close-key.sh
# Verifica se a close_key da sessão aparece no texto fornecido.
# Retorna 0 se encontrar, 1 se não encontrar ou close_key ausente no state.
detect_close_key_in_text() {
    local text="$1"
    local close_key
    close_key=$(read_field ".close_key")
    [ -z "$close_key" ] || [ "$close_key" = "null" ] && return 1
    printf '%s' "$text" | grep -qF "$close_key"
}

# ---------------------------------------------------------------------------
# Detecção de turno órfão
# [LEGADO — DEPRECADO] Use hook_turn_is_orphaned() de api/16-lifecycle.sh
# ---------------------------------------------------------------------------

# @deprecated Use hook_turn_is_orphaned() de api/16-lifecycle.sh
# Retorna 0 se o turno atual é órfão (iniciou mas não encerrou em threshold segundos)
turn_is_orphaned() {
    local threshold="${1:-300}" # default: 5 minutos
    local started_at now_epoch started_epoch delta

    started_at=$(read_field ".current_turn.started_at")
    [ -z "$started_at" ] || [ "$started_at" = "null" ] && return 1

    # Converte ISO 8601 para epoch via date (portável em Linux)
    started_epoch=$(date -d "$started_at" +%s 2> /dev/null) || return 1
    now_epoch=$(date -u +%s)
    delta=$((now_epoch - started_epoch))

    [ "$delta" -gt "$threshold" ]
}

# @deprecated Use hook_heal_orphaned_turn() de api/16-lifecycle.sh
# Fecha turno órfão e registra evento de healing no audit.jsonl
heal_orphaned_turn() {
    local turn_num turn_id
    turn_num=$(read_field ".current_turn.number")
    turn_id=$(read_field ".current_turn.turn_id")

    update_nested_state "current_turn.ask_questions_called" "false"
    update_nested_state "current_turn.started_at" "null"     # GAP-04: evita re-heal na próxima UserPromptSubmit
    update_nested_state "current_turn.ended_at" "$(now_iso)" # GAP-10: registra temporalmente quando terminou
    log_audit "turnEnd_orphan_healed" "turn" "${turn_num:-0}" "turn_id" "${turn_id:-unknown}"
}

# ---------------------------------------------------------------------------
# Lifecycle de TURN (userPromptSubmit)
# ---------------------------------------------------------------------------

# Abre novo TURN: incrementa contador, gera turn_id, seta started_at, reseta flags.
# Retorna o novo número de turno via stdout.
# Uso: turn_num=$(open_new_turn [source])
open_new_turn() {
    local turn_source="${1:-userPromptSubmit}"
    local turn_num turn_id now
    now=$(now_iso)
    turn_id=$(uuidgen_safe)

    # Incrementa turn_count e turn_number
    turn_num=$(increment_field ".session_stats.turn_count")
    update_nested_state "current_turn.number" "$turn_num"
    update_nested_state "current_turn.turn_id" "$turn_id"
    update_nested_state "current_turn.started_at" "$now"
    update_nested_state "current_turn.ended_at" "null"
    update_nested_state "current_turn.source" "$turn_source"
    update_nested_state "current_turn.ask_questions_called" "false"
    update_nested_state "current_turn.ask_questions_turn_pos" "0"
    update_nested_state "current_turn.last_template" ""
    update_nested_state "current_turn.subturn_count" "0"
    update_nested_state "current_turn.tools_count" "0"
    update_nested_state "current_turn.intent" ""
    update_nested_state "current_turn.subagents_started" "0"
    # UP-H1b: reseta contadores de tools pós-askQ no início de cada turno.
    # Sem este reset, valores do turno anterior propagavam para o próximo
    # causando falsos positivos no UP-H1b (task_complete bloqueado indevidamente).
    update_nested_state "current_turn.tools_after_ask_questions" "0"
    update_nested_state "current_turn.last_tool_after_ask_questions" ""

    # GAP-SUBTURN-RESET: limpa current_subturn ao abrir novo turno para evitar
    # que dados residuais do subturn anterior (de turno encerrado abruptamente)
    # contaminem leituras antes do primeiro preToolUse do novo turno.
    update_nested_state "current_subturn.number" "0"
    update_nested_state "current_subturn.subturn_id" "null"
    update_nested_state "current_subturn.started_at" "null"
    update_nested_state "current_subturn.ended_at" "null"
    update_nested_state "current_subturn.response_at" "null"

    printf '%d' "$turn_num"
}

# ---------------------------------------------------------------------------
# Lifecycle de SUBTURN (preToolUse)
# ---------------------------------------------------------------------------

# Abre novo SUBTURN: incrementa contadores, gera subturn_id, seta started_at.
# Retorna o novo número de subturn via stdout.
# Uso: subturn_num=$(open_new_subturn)
open_new_subturn() {
    # GAP-21: guard — sem turno ativo, não abre subturn
    local _guard_turn
    _guard_turn=$(read_field '.current_turn.number')
    if [ -z "$_guard_turn" ] || [ "$_guard_turn" = 'null' ] || [ "${_guard_turn:-0}" -eq 0 ] 2> /dev/null; then
        printf '0'
        return 0
    fi

    local subturn_id now
    now=$(now_iso)
    subturn_id=$(uuidgen_safe)

    # Incrementa subturn global e local
    increment_field ".session_stats.subturn_total" > /dev/null
    local local_count
    local_count=$(increment_field ".current_turn.subturn_count")

    update_nested_state "current_subturn.number" "$local_count"
    update_nested_state "current_subturn.subturn_id" "$subturn_id"
    update_nested_state "current_subturn.started_at" "$now"
    update_nested_state "current_subturn.ended_at" "null" # GAP-14
    update_nested_state "current_subturn.response_at" "null"

    printf '%d' "$local_count"
}

# increment_tools_by_type — UP-01: incrementa contador por tipo de ferramenta
# Uso: increment_tools_by_type "read_file"
increment_tools_by_type() {
    local tool_name="${1:-unknown}"
    # Sanitiza: mantém apenas [a-zA-Z0-9_-] para evitar injeção de chaves jq
    local safe_name
    safe_name=$(printf '%s' "$tool_name" | tr -cd 'a-zA-Z0-9_-' | cut -c1-64)
    [ -n "$safe_name" ] || safe_name="unknown"
    local current new_val tmp
    current=$(jq -r ".session_stats.tools_by_type[\"${safe_name}\"] // 0" "$STATE_FILE" 2> /dev/null || printf '0')
    new_val=$((${current:-0} + 1))
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    jq --arg k "$safe_name" --argjson v "$new_val" \
        '.session_stats.tools_by_type[$k] = $v' "$STATE_FILE" > "$tmp" || {
        rm -f "$tmp"
        return 0 # falha silenciosa — não crítico
    }
    mv -f "$tmp" "$STATE_FILE" || {
        rm -f "$tmp"
        return 0
    }
}

# _increment_template_usage — UP-02: incrementa contador de uso por template (A-G)
# Uso: _increment_template_usage "A"
_increment_template_usage() {
    local tmpl="${1:-}"
    # Aceita apenas letras A-G
    case "$tmpl" in
        A | B | C | D | E | F | G) ;;
        *) return 0 ;;
    esac
    local current new_val tmp
    current=$(jq -r ".compliance.template_usage[\"${tmpl}\"] // 0" "$STATE_FILE" 2> /dev/null || printf '0')
    new_val=$((${current:-0} + 1))
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    jq --arg k "$tmpl" --argjson v "$new_val" \
        '.compliance.template_usage[$k] = $v' "$STATE_FILE" > "$tmp" || {
        rm -f "$tmp"
        return 0
    }
    mv -f "$tmp" "$STATE_FILE" || {
        rm -f "$tmp"
        return 0
    }
}

# Incrementa tools_count do turno atual e tools_total da sessão.
# Retorna o total de ferramentas do turno atual.
# Uso: tool_num=$(count_tool_use)
count_tool_use() {
    increment_field ".session_stats.tools_total" > /dev/null
    # UP-01: rastreia contagem por tipo de ferramenta (HOOK_TOOL_NAME do payload)
    [ -n "${HOOK_TOOL_NAME:-}" ] && increment_tools_by_type "$HOOK_TOOL_NAME" > /dev/null || true
    increment_field ".current_turn.tools_count"
}

# ---------------------------------------------------------------------------
# Geração de session-briefing.md
# ---------------------------------------------------------------------------

BRIEFING_FILE="$STATE_DIR/session-briefing.md"
PENDING_TASKS_FILE="$STATE_DIR/pending-tasks.md"

# sanitize_md — remove chars que quebrariam formatação Markdown em heredoc (GAP-35)
# Remove: backticks, pipe, hash inicial, backslash de escape
sanitize_md() {
    printf '%s' "${1:-}" | tr -d '`\\' | tr '|' '-' | tr -d '\r'
}

# Gera (ou regenera) $BRIEFING_FILE com base no estado atual da sessão.
# O arquivo é usado pelo agente como contexto de início/retomada de sessão.
generate_session_briefing() {
    local session_id close_key started_at source
    local turn_count turn_auth turn_unauth consecutive_unauth
    local current_turn_num current_turn_source tools_total tools_blocked subagents_total
    local pending_tasks_content

    session_id=$(read_field ".session_id")
    close_key=$(read_field ".close_key")
    started_at=$(read_field ".started_at")
    source=$(read_field ".source")
    turn_count=$(read_field ".session_stats.turn_count")
    turn_auth=$(read_field ".session_stats.turn_authorized")
    turn_unauth=$(read_field ".session_stats.turn_unauthorized")
    consecutive_unauth=$(read_field ".compliance.consecutive_unauthorized")
    current_turn_num=$(read_field ".current_turn.number")
    current_turn_source=$(read_field ".current_turn.source")
    tools_total=$(read_field ".session_stats.tools_total")
    tools_blocked=$(read_field ".session_stats.tools_blocked")
    subagents_total=$(read_field ".session_stats.subagents_total")

    # Valores padrão para campos ausentes (retrocompatibilidade com state antigo)
    session_id="${session_id:-unknown}"
    close_key="${close_key:-N/A}"
    started_at="${started_at:-N/A}"
    source="${source:-unknown}"
    turn_count="${turn_count:-0}"
    turn_auth="${turn_auth:-0}"
    turn_unauth="${turn_unauth:-0}"
    consecutive_unauth="${consecutive_unauth:-0}"
    current_turn_num="${current_turn_num:-0}"
    current_turn_source="${current_turn_source:-unknown}"
    tools_total="${tools_total:-0}"
    tools_blocked="${tools_blocked:-0}"
    subagents_total="${subagents_total:-0}"

    # GAP-35: sanitizar campos string para evitar injeção de Markdown no heredoc
    session_id=$(sanitize_md "$session_id")
    close_key=$(sanitize_md "$close_key")
    started_at=$(sanitize_md "$started_at")
    source=$(sanitize_md "$source")
    current_turn_source=$(sanitize_md "$current_turn_source")

    # Lê pending-tasks.md se existir
    if [ -f "$PENDING_TASKS_FILE" ]; then
        pending_tasks_content="$(cat "$PENDING_TASKS_FILE")"
    else
        pending_tasks_content="*(sem tarefas pendentes registradas)*"
    fi

    mkdir -p "$STATE_DIR"
    cat > "$BRIEFING_FILE" << EOF
# Session Briefing

**Gerado em**: $(now_iso)
**Session ID**: \`${session_id}\`
**Iniciada em**: ${started_at}
**Fonte**: ${source}

## Chave de Encerramento

Para encerrar esta sessão, use o Template F com a chave:
> \`${close_key}\`

## Turno Atual

| Campo | Valor |
|-------|-------|
| Número do turno | ${current_turn_num} |
| Fonte | ${current_turn_source} |

## Estatísticas da Sessão

| Métrica | Valor |
|--------|-------|
| Turnos totais | ${turn_count} |
| Autorizados | ${turn_auth} |
| Não-autorizados | ${turn_unauth} |
| Consecutivos sem askQuestions | ${consecutive_unauth} |
| Tools executadas (total) | ${tools_total} |
| Tools bloqueadas (bypass) | ${tools_blocked} |
| Subagentes invocados | ${subagents_total} |

## Tarefas Pendentes

${pending_tasks_content}

## Lembretes Operacionais

- Declare sua intenção com \`bash .github/hooks/scripts/start-turn.sh "intenção"\`
- Chame \`vscode_askQuestions\` ao final de cada turno de trabalho
- Use Template D a cada ~15 turnos para checkpoint periódico
EOF
}

# ---------------------------------------------------------------------------
# Construção de contexto adicional (SessionStart / PreCompact)
# ---------------------------------------------------------------------------

# Formata um bloco de contexto com título e corpo (para uso em additionalContext)
# Uso: context_block "## Título" "Conteúdo do bloco"
context_block() {
    printf '%s\n%s\n\n' "$1" "$2"
}

# Lê session-briefing.md e retorna conteúdo (ou mensagem padrão se não existir)
read_briefing() {
    if [ -f "$BRIEFING_FILE" ]; then
        cat "$BRIEFING_FILE"
    else
        printf 'Session briefing não disponível.\n'
    fi
}

# ---------------------------------------------------------------------------
# Variáveis de ambiente seguras (charset)
# ---------------------------------------------------------------------------

# Garante LANG=C.UTF-8 para tratamento correto de unicode em jq/date/printf
export_lang_utf8() {
    export LANG="${LANG:-C.UTF-8}"
    export LC_ALL="${LC_ALL:-C.UTF-8}"
}
