#!/usr/bin/env bash
# state-crud.sh — CRUD atômico do session.json
# Extraído de common.sh (R-06: split de módulos)
# Requer: STATE_DIR, STATE_FILE definidos (via common.sh header)
# Não usar set -euo pipefail (é sourceado, não executado)

# Guard de re-source
[[ -n "${_STATE_CRUD_LOADED:-}" ]] && return 0
_STATE_CRUD_LOADED=1

# ---------------------------------------------------------------------------
# Funções de estado
# ---------------------------------------------------------------------------

# Retorna 0 se session.json existe e é JSON válido
state_exists() {
    [[ -f "$STATE_FILE" ]] && jq -e . "$STATE_FILE" > /dev/null 2>&1
}

# Le campo do session.json via jq path (ex: ".current_turn.number")
# AVISO: usa `// empty` para retornar "" para campos null/ausentes.
# LIMITACAO: boolean `false` tambem retorna "" (falsy para o operador // do jq).
# Para leitura de booleanos, o caller deve tratar "" como "false".
read_field() {
    local path="$1"
    jq -r "${path} // empty" "$STATE_FILE" 2> /dev/null
}

# Leitura segura de campos booleanos do session.json.
# Retorna a string "true" ou "false" independente do valor JSON (evita
# o bug de read_field() que retorna "" para boolean false via "// empty").
read_field_bool() {
    local path="$1"
    jq -r "if ${path} then \"true\" else \"false\" end" "$STATE_FILE" 2> /dev/null || echo "false"
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

# Atualiza campo aninhado no session.json usando JSON literal (argjson)
# Uso: update_nested_state_json "session_stats.tools_by_type" '{}'
#      update_nested_state_json "compliance.template_usage" '{"A":0,"B":0,"C":0,"D":0,"E":0,"F":0,"G":0}'
update_nested_state_json() {
    local key_path="$1" json_val="$2"
    local tmp jq_path
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    jq_path=".${key_path}"

    # Validação defensiva: precisa ser JSON válido
    if ! printf '%s' "$json_val" | jq -e . > /dev/null 2>&1; then
        rm -f "$tmp"
        return 1
    fi

    jq --argjson v "$json_val" "${jq_path} = \$v" "$STATE_FILE" > "$tmp" || {
        rm -f "$tmp"
        return 1
    }

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
            "state_schema_version": "3",
            "vs_code_session_id": $sid,
            "session_id": $sid,
            "started_at": $start,
            "ended_at": null,
            "close_key": $key,
            "source": $src,
            "pending_session_close": false,
            "strict_turn_close": true,
            "last_activity_at": $start,
            "current_turn": {
                "number": 0,
                "turn_id": null,
                "started_at": null,
                "ended_at": null,
                "duration_ms": 0,
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
                "subagents_total": 0,
                "turn_duration_total_ms": 0
            },
            "compliance": {
                "consecutive_unauthorized": 0,
                "last_turn_authorized": true,
                "template_usage": {"A":0,"B":0,"C":0,"D":0,"E":0,"F":0,"G":0},
                "last_template": ""
            }
        }' > "$STATE_FILE"
    chmod 600 "$STATE_FILE" 2> /dev/null || true # R-09: close_key não deve ser world-readable
    # R-14: inicializa symlink canônico para o audit ativo
    _audit_update_symlink "$AUDIT_FILE" || true
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
    if [[ -d "$checkpoint_dir" ]]; then
        local best_cp=""
        # Mais recente primeiro (ls -t)
        while IFS= read -r cp; do
            if jq empty "$cp" 2> /dev/null; then
                best_cp="$cp"
                break
            fi
        done < <(ls -t "$checkpoint_dir"/session-*.json 2> /dev/null)

        if [[ -n "$best_cp" ]]; then
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
