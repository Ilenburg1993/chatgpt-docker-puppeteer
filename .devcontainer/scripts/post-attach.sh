#!/usr/bin/env bash
# =============================================================================
# PHASE 0 — GUARDA DE EXECUÇÃO (FAIL-SAFE ABSOLUTO)
# CANONICAL v5.7.1
#
# Contrato:
# - post-attach NUNCA pode falhar
# - post-attach NUNCA pode herdar comportamento destrutivo
# - post-attach NUNCA pode bloquear o VS Code
#
# Política explícita:
# - UX resiliente > rigor de shell
# - Variáveis opcionais são aceitáveis
# CHANGELOG v5.7.0 (2026-05-17):
# - Sincronizado com post-start v2.8.0, github-api-route-fix v1.8.4,
#   local-copilot-proxy v1.2.2 e manager v1.5.0.
# - Adiciona leitura passiva de recommendation/benchmark/comparison artifacts
#   sem executar jobs longos, probes externos ou mutações de rede.
# - Expõe política segura de boot: recomendação persistida + quick-verify futuro,
#   mantendo post-attach como UX snapshot read-only.
# - Corrige leituras cat/head desnecessárias e hardening de manifesto key=value.
# - Hardenings: redaction de paths/URLs sensíveis em summaries, bounded readers,
#   freshness/TTL display e hints humanos para direct vs proxy-local.
#
# CHANGELOG v5.7.1 (2026-05-17):
# - Sincronizado com post-start v2.8.1, github-api-route-fix v1.8.6,
#   local-dns-cache v1.5.3, local-copilot-proxy v1.2.3,
#   github-copilot-network-manager v1.5.3 e endpoint registry v1.1.0.
# - Amplia snapshot passivo com registry, artifact states, soft-degraded counts,
#   DNS fail-closed fields, route current/best candidate p95 e fail-rate.
# - Corrige stale UX: diferencia boot snapshot, current recommendation e artifacts
#   longos sem executar benchmarks, probes ou scripts de rede no attach.
# - Adiciona hints humanos sincronizados com package.json v1.1.2/Makefile v4.2.2.
#
# =============================================================================

# Desarma heranças perigosas
set +e
set +u
set +o pipefail 2> /dev/null || true

# Neutraliza traps herdados (defensivo absoluto)
trap - ERR EXIT INT TERM 2> /dev/null || true

# Versão canônica do hook (fonte única da verdade)
readonly SCRIPT_NAME="post-attach"
readonly SCRIPT_VERSION="5.7.1"

# ---------------------------------------------------------------------------
# CLI options parser
# ---------------------------------------------------------------------------
BRIEF=false
SHOW_NETWORK_RECOMMENDATIONS="${DEVCONTAINER_POST_ATTACH_SHOW_NETWORK_RECOMMENDATIONS:-true}"
SHOW_BENCHMARK_ARTIFACTS="${DEVCONTAINER_POST_ATTACH_SHOW_BENCHMARK_ARTIFACTS:-true}"
RECOMMENDATION_MAX_AGE_SECONDS="${DEVCONTAINER_POST_ATTACH_RECOMMENDATION_MAX_AGE_SECONDS:-86400}"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --brief)
            BRIEF=true
            shift
            ;;
        --help)
            cat << 'EOF'
post-attach.sh [--brief] [--help] [--version]

--brief    suppress detailed environment diagnostics
--help     display this help text and exit
--version  print script version and exit

This hook is passive/read-only. It displays the latest post-start/network
snapshots and cached benchmark/recommendation artifacts without starting
services, route-fix, proxy compare jobs or long-running benchmarks.
EOF
            exit 0
            ;;
        --version)
            printf '%s v%s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}"
            exit 0
            ;;
        *)
            break
            ;;
    esac
done

# =============================================================================
# PHASE 1 — UX HELPERS (API SEMÂNTICA DE OUTPUT)
# CANONICAL v5.7.1
#
# Finalidade:
#   • Prover API mínima e estável de mensagens humanas
#   • Isolar detalhes de cor / terminal
#   • Garantir comportamento seguro sob set -euo pipefail
#
# Propriedades:
#   • Nenhuma lógica de negócio
#   • Nenhuma leitura de estado
#   • Nenhuma escrita
# =============================================================================

# ---------------------------------------------------------------------------
# Detecção defensiva de terminal e suporte a cores
# ---------------------------------------------------------------------------
COLOR_ENABLED=false

if [[ -t 1 ]] && command -v tput > /dev/null 2>&1; then
    COLOR_ENABLED=true
fi

# ---------------------------------------------------------------------------
# Paleta semântica (fallback silencioso)
# ---------------------------------------------------------------------------
if [[ "${COLOR_ENABLED}" == "true" ]]; then
    GREEN="$(tput setaf 2)"
    YELLOW="$(tput setaf 3)"
    BLUE="$(tput setaf 4)"
    CYAN="$(tput setaf 6)"
    NC="$(tput sgr0)"
else
    GREEN=""
    YELLOW=""
    BLUE=""
    CYAN=""
    NC=""
fi

# ---------------------------------------------------------------------------
# API de mensagens humanas
#
# Política canônica:
#   • post-attach NÃO falha
#   • NÃO existe "erro" operacional aqui
#   • Apenas: info / ok / warn
# ---------------------------------------------------------------------------
info() { printf "%b\n" "${CYAN}ℹ️  $*${NC}"; }
ok() { printf "%b\n" "${GREEN}✅ $*${NC}"; }
warn() { printf "%b\n" "${YELLOW}⚠️  $*${NC}"; }

# ---------------------------------------------------------------------------
# Snapshot defensivo de tamanho de diretório
#
# Contrato:
#   • Nunca pode bloquear o attach
#   • Usa timeout quando disponível
#   • Se a medição for lenta, devolve marcador sem erro
# ---------------------------------------------------------------------------
dir_size_snapshot() {
    local target_dir="$1"
    local size=""
    local rc=0

    if [[ ! -d "${target_dir}" ]]; then
        printf '%s\n' "?"
        return 0
    fi

    if command -v timeout > /dev/null 2>&1; then
        size="$(timeout 2 du -sh "${target_dir}" 2> /dev/null | awk 'NR==1 {print $1}')"
        rc=$?

        case "${rc}" in
            0)
                printf '%s\n' "${size:-?}"
                ;;
            124 | 137)
                printf '%s\n' "~(lento)"
                ;;
            *)
                printf '%s\n' "?"
                ;;
        esac

        return 0
    fi

    # Fallback: evitar travar em diretórios sabidamente pesados sem timeout.
    if [[ "${target_dir}" == "${USER_HOME}/.vscode-server" ]]; then
        printf '%s\n' "~(skip)"
        return 0
    fi

    size="$(du -sh "${target_dir}" 2> /dev/null | awk 'NR==1 {print $1}')"
    printf '%s\n' "${size:-?}"
    return 0
}

# ---------------------------------------------------------------------------
# Helpers passivos adicionais
# ---------------------------------------------------------------------------
is_uint() {
    [[ "${1:-}" =~ ^[0-9]+$ ]]
}

cfg_bool() {
    case "${1:-}" in
        true | TRUE | 1 | yes | YES | on | ON) printf 'true' ;;
        false | FALSE | 0 | no | NO | off | OFF) printf 'false' ;;
        *) printf '%s' "${2:-false}" ;;
    esac
}

cfg_uint() {
    local value fallback min max
    value="${1:-}"
    fallback="${2:-0}"
    min="${3:-0}"
    max="${4:-}"
    if [[ ! "${value}" =~ ^[0-9]+$ ]]; then
        value="${fallback}"
    fi
    if ((value < min)); then
        value="${fallback}"
    fi
    if [[ -n "${max}" && "${max}" =~ ^[0-9]+$ && "${value}" =~ ^[0-9]+$ && value -gt max ]]; then
        value="${max}"
    fi
    printf '%s' "${value}"
}

RECOMMENDATION_MAX_AGE_SECONDS="$(cfg_uint "${RECOMMENDATION_MAX_AGE_SECONDS}" 86400 60 604800)"
SHOW_NETWORK_RECOMMENDATIONS="$(cfg_bool "${SHOW_NETWORK_RECOMMENDATIONS}" true)"
SHOW_BENCHMARK_ARTIFACTS="$(cfg_bool "${SHOW_BENCHMARK_ARTIFACTS}" true)"

read_status_snapshot() {
    # $1=file, $2=label
    local status_file="$1"
    local status_label="$2"
    local status_value=""

    if [[ -r "${status_file}" ]]; then
        status_value="$(head -n 1 "${status_file}" 2> /dev/null || echo unknown)"
        case "${status_value}" in
            ok)
                ok "${status_label}: OK"
                ;;
            degraded | fail | failed | error)
                warn "${status_label}: ${status_value}"
                ;;
            *)
                info "${status_label}: ${status_value:-unknown}"
                ;;
        esac
    else
        warn "${status_label}: sem snapshot registrado"
    fi
}

detect_pm2_version_passive() {
    # Avoids invoking pm2 itself because some pm2 commands may daemonize.
    local pm2_bin="$1"
    local pm2_real=""
    local dir=""
    local pkg=""
    local depth=0

    if [[ -z "${pm2_bin}" ]]; then
        printf '%s\n' "desconhecida"
        return 0
    fi

    if command -v readlink > /dev/null 2>&1; then
        pm2_real="$(readlink -f "${pm2_bin}" 2> /dev/null || printf '%s' "${pm2_bin}")"
    else
        pm2_real="${pm2_bin}"
    fi

    dir="$(dirname "${pm2_real}" 2> /dev/null || printf '.')"

    while [[ "${depth}" -lt 8 && -n "${dir}" && "${dir}" != "/" ]]; do
        pkg="${dir}/package.json"
        if [[ -r "${pkg}" ]] && grep -q '"name"[[:space:]]*:[[:space:]]*"pm2"' "${pkg}" 2> /dev/null; then
            if command -v node > /dev/null 2>&1; then
                node -e 'try { const p = require(process.argv[1]); console.log(p.version || "desconhecida"); } catch { console.log("desconhecida"); }' "${pkg}" 2> /dev/null
                return 0
            fi
            if command -v jq > /dev/null 2>&1; then
                jq -r '.version // "desconhecida"' "${pkg}" 2> /dev/null || printf '%s\n' "desconhecida"
                return 0
            fi
        fi
        dir="$(dirname "${dir}" 2> /dev/null || printf '/')"
        depth=$((depth + 1))
    done

    printf '%s\n' "desconhecida"
}

pm2_dump_process_count_passive() {
    # Reads PM2 dump only. Does not invoke pm2 and therefore does not start its daemon.
    local pm2_home="${PM2_HOME:-${USER_HOME}/.pm2}"
    local dump_file="${pm2_home}/dump.pm2"

    if [[ ! -r "${dump_file}" ]]; then
        printf '%s\n' "absent"
        return 0
    fi

    if command -v jq > /dev/null 2>&1; then
        jq '. | length' "${dump_file}" 2> /dev/null || printf '%s\n' "unknown"
        return 0
    fi

    grep -c '"name"' "${dump_file}" 2> /dev/null || printf '%s\n' "unknown"
    return 0
}

# ---------------------------------------------------------------------------
# Key/value summary readers (passive, bounded, redaction-safe)
# ---------------------------------------------------------------------------
sanitize_oneline() {
    # Keep diagnostics single-line and terminal-safe. Accepts an argument or stdin.
    local value
    if [[ $# -gt 0 ]]; then
        value="$*"
    else
        value="$(LC_ALL=C awk 'BEGIN{ORS=""} {print; exit}' 2> /dev/null || true)"
    fi
    value="${value//$'\r'/ }"
    value="${value//$'\n'/ }"
    value="${value//$'\t'/ }"
    value="$(printf '%s' "${value}" | LC_ALL=C sed 's/[[:cntrl:]]//g' 2> /dev/null || true)"
    printf '%.4096s\n' "${value}"
}

read_first_line() {
    local file
    file="${1:-}"
    [[ -r "${file}" ]] || return 1
    awk 'NR==1{print; exit}' "${file}" 2> /dev/null | sanitize_oneline
}

kv_get() {
    # Reads first key=value occurrence without evaluating content.
    # $1=file, $2=key
    local file key value
    file="${1:-}"
    key="${2:-}"
    [[ -r "${file}" && -n "${key}" ]] || return 1

    value="$(awk -v k="${key}" '
        index($0, k "=") == 1 {
            sub(/^[^=]*=/, "", $0);
            print;
            exit;
        }
    ' "${file}" 2> /dev/null | sanitize_oneline)"

    [[ -n "${value}" ]] || return 1
    printf '%s\n' "${value}"
}

kv_or() {
    # $1=file, $2=key, $3=fallback
    local value
    value="$(kv_get "${1:-}" "${2:-}" 2> /dev/null || true)"
    printf '%s\n' "${value:-${3:-unknown}}"
}

status_snapshot_or() {
    # $1=status-file, $2=summary-file, $3=summary-key, $4=fallback
    local status_file summary_file summary_key fallback value
    status_file="${1:-}"
    summary_file="${2:-}"
    summary_key="${3:-status}"
    fallback="${4:-unknown}"

    value="$(kv_get "${summary_file}" "${summary_key}" 2> /dev/null || true)"
    if [[ -z "${value}" && -r "${status_file}" ]]; then
        value="$(read_first_line "${status_file}" 2> /dev/null || true)"
    fi
    printf '%s\n' "${value:-${fallback}}"
}

print_bullet() {
    # $1=label, $2=value
    printf "  • %-26s %s\n" "${1:-Item:}" "${2:-unknown}"
}

print_file_hint() {
    # $1=label, $2=file
    local label file
    label="${1:-arquivo:}"
    file="${2:-}"
    if [[ -r "${file}" ]]; then
        print_bullet "${label}" "${file}"
    else
        print_bullet "${label}" "${file:-unknown} (ausente)"
    fi
}

file_mtime_epoch() {
    local file
    file="${1:-}"
    [[ -n "${file}" && -e "${file}" ]] || {
        printf '%s\n' 0
        return 0
    }
    if command -v stat > /dev/null 2>&1; then
        stat -c '%Y' "${file}" 2> /dev/null || printf '%s\n' 0
    else
        printf '%s\n' 0
    fi
}

age_human_from_epoch() {
    local epoch now age
    epoch="${1:-0}"
    [[ "${epoch}" =~ ^[0-9]+$ ]] || epoch=0
    now="$(date '+%s' 2> /dev/null || printf '0')"
    [[ "${now}" =~ ^[0-9]+$ ]] || now=0
    if ((epoch <= 0 || now <= epoch)); then
        printf '%s\n' 'unknown'
        return 0
    fi
    age=$((now - epoch))
    if ((age < 60)); then
        printf '%ss\n' "${age}"
    elif ((age < 3600)); then
        printf '%sm\n' "$((age / 60))"
    elif ((age < 86400)); then
        printf '%sh\n' "$((age / 3600))"
    else
        printf '%sd\n' "$((age / 86400))"
    fi
}

file_age_human() {
    age_human_from_epoch "$(file_mtime_epoch "${1:-}")"
}

is_recent_file() {
    local file max_age epoch now
    file="${1:-}"
    max_age="${2:-86400}"
    [[ "${max_age}" =~ ^[0-9]+$ ]] || max_age=86400
    [[ -e "${file}" ]] || return 1
    epoch="$(file_mtime_epoch "${file}")"
    now="$(date '+%s' 2> /dev/null || printf '0')"
    [[ "${epoch}" =~ ^[0-9]+$ && "${now}" =~ ^[0-9]+$ ]] || return 1
    ((epoch > 0 && now >= epoch && now - epoch <= max_age))
}

kv_any_or() {
    # $1=file, $2=fallback, remaining=args keys
    local file fallback key value
    file="${1:-}"
    fallback="${2:-unknown}"
    shift 2 || true
    for key in "$@"; do
        value="$(kv_get "${file}" "${key}" 2> /dev/null || true)"
        if [[ -n "${value}" ]]; then
            printf '%s\n' "${value}"
            return 0
        fi
    done
    printf '%s\n' "${fallback}"
}

print_recommendation_snapshot() {
    # $1=label, $2=file
    local label file action transport confidence reason fresh age
    label="${1:-Recomendação}"
    file="${2:-}"
    if [[ ! -r "${file}" ]]; then
        print_bullet "${label}:" "sem artifact"
        return 0
    fi
    action="$(kv_any_or "${file}" unknown recommended_action recommendation action decision)"
    transport="$(kv_any_or "${file}" unknown recommended_transport transport transport_profile)"
    confidence="$(kv_any_or "${file}" unknown confidence recommendation_confidence)"
    reason="$(kv_any_or "${file}" unknown reason recommendation_reason decision_reason)"
    age="$(file_age_human "${file}")"
    if is_recent_file "${file}" "${RECOMMENDATION_MAX_AGE_SECONDS}"; then
        fresh="fresh"
    else
        fresh="stale-or-unknown"
    fi
    print_bullet "${label}:" "action=${action}; transport=${transport}; confidence=${confidence}; age=${age}; ${fresh}"
    print_bullet "motivo:" "$(sanitize_oneline "${reason}")"
}

print_artifact_freshness() {
    local label file age size
    label="${1:-artifact}"
    file="${2:-}"
    if [[ -r "${file}" ]]; then
        age="$(file_age_human "${file}")"
        size="?"
        if command -v stat > /dev/null 2>&1; then
            size="$(stat -c '%s' "${file}" 2> /dev/null || printf '?')"
        fi
        print_bullet "${label}:" "${file} (age=${age}, bytes=${size})"
    else
        print_bullet "${label}:" "${file:-unknown} (ausente)"
    fi
}

count_tsv_registry_rows() {
    local file
    file="${1:-}"
    [[ -r "${file}" ]] || {
        printf '0 0
'
        return 0
    }
    awk -F '	' '
        /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
        {
            total++
            if (NF != 5 || $1 !~ /^https:\/\// || $2 == "" || $3 == "" || $4 == "" || $5 == "") bad++
        }
        END { print total+0, bad+0 }
    ' "${file}" 2> /dev/null || printf '0 0
'
}

print_endpoint_registry_snapshot() {
    local file counts rows bad status age
    file="${1:-}"
    if [[ ! -r "${file}" ]]; then
        print_bullet "endpoint registry:" "missing (${file:-unknown})"
        return 0
    fi
    counts="$(count_tsv_registry_rows "${file}")"
    rows="${counts%% *}"
    bad="${counts##* }"
    status="ok"
    if ! is_uint "${rows}" || ! is_uint "${bad}" || ((rows <= 0 || bad > 0)); then
        status="degraded"
    fi
    age="$(file_age_human "${file}")"
    print_bullet "endpoint registry:" "${status}; rows=${rows}; bad=${bad}; age=${age}; file=${file}"
}

print_key_if_present() {
    local label file key value
    label="${1:-campo:}"
    file="${2:-}"
    key="${3:-}"
    value="$(kv_get "${file}" "${key}" 2> /dev/null || true)"
    [[ -n "${value}" ]] || return 0
    print_bullet "${label}" "${value}"
}

status_to_human() {
    local status
    status="${1:-unknown}"
    case "${status}" in
        ok) printf '%s\n' 'OK' ;;
        off | disabled | skipped) printf '%s\n' "${status}" ;;
        degraded | fail | failed | error | stale) printf '%s\n' "${status}" ;;
        *) printf '%s\n' "${status:-unknown}" ;;
    esac
}

print_status_line() {
    # $1=human label, $2=status
    local label status
    label="${1:-Status}"
    status="${2:-unknown}"
    case "${status}" in
        ok)
            ok "${label}: OK"
            ;;
        off | disabled | skipped)
            info "${label}: ${status}"
            ;;
        degraded | fail | failed | error | stale)
            warn "${label}: $(status_to_human "${status}")"
            ;;
        *)
            info "${label}: $(status_to_human "${status}")"
            ;;
    esac
}

# =============================================================================
# PHASE 2 — BANNER DE ATTACH (IDENTIDADE HUMANA — INICIAL)
# CANONICAL v5.7.1
#
# Finalidade:
#   • Sinalizar visualmente o evento de attach
#   • Comunicar identidade do projeto
#   • Comunicar identidade e versão do hook
#
# Proibições (INVIOLÁVEIS):
#   • Nenhuma lógica condicional
#   • Nenhuma inferência temporal (primeiro / recorrente)
#   • Nenhuma dependência de estado persistente
#   • Nenhum diagnóstico
# =============================================================================

echo ""

# simple internationalization: switch to English when LANG starts with en
if [[ "${LANG:-}" =~ ^en ]]; then
    BANNER_ATTACH="🔗 VS Code attached to DevContainer"
    BANNER_PROJECT="📦 Project: ChatGPT Docker Puppeteer"
else
    BANNER_ATTACH="🔗 VS Code anexado ao DevContainer"
    BANNER_PROJECT="📦 Projeto: ChatGPT Docker Puppeteer"
fi

printf "%b\n" "${BLUE}══════════════════════════════════════════════════════════════${NC}"
printf "%b\n" "${BLUE}${BANNER_ATTACH}${NC}"
printf "%b\n" "${BLUE}${BANNER_PROJECT}${NC}"
printf "%b\n" "${BLUE}🧩 Hook: ${SCRIPT_NAME}  |  v${SCRIPT_VERSION}${NC}"
printf "%b\n" "${BLUE}══════════════════════════════════════════════════════════════${NC}"

echo ""
# =============================================================================
# PHASE 3 — NAMESPACE CANÔNICO DE ESTADO (UX / ATTACH)
# CANONICAL v5.7.1
#
# CONTRATO (NORMATIVO):
#   • Este namespace armazena APENAS estado HUMANO / UX
#   • Nada aqui é estrutural, técnico ou decisório
#   • Falha, ausência ou corrupção NÃO podem quebrar o attach
#   • Escritas são:
#       - defensivas
#       - best-effort
#       - silenciosas em caso de erro
#
# SEPARAÇÃO CRÍTICA (INVIOLÁVEL):
#   • Estado UX (attach):     .devcontainer/state/*
#   • Estado Estrutural:      .devcontainer/.initialized
#
# Observação:
#   • O KERNEL NUNCA lê este namespace
#   • Apenas humanos e UX helpers consomem estes dados
# =============================================================================

# ---------------------------------------------------------------------------
# Diretório canônico de estado UX (relativo ao projeto)
# ---------------------------------------------------------------------------
readonly UX_STATE_DIR=".devcontainer/state"

readonly FIRST_ATTACH_MARKER="${UX_STATE_DIR}/first-attach"
readonly LAST_ATTACH_MARKER="${UX_STATE_DIR}/last-attach"
readonly ATTACH_COUNT_FILE="${UX_STATE_DIR}/attach-count"
readonly LAST_ATTACH_AT_FILE="${UX_STATE_DIR}/last-attach-at"

# Flag interna: namespace UX utilizável
UX_STATE_WRITABLE=true

# ---------------------------------------------------------------------------
# Preparação defensiva do namespace
# ---------------------------------------------------------------------------
if ! mkdir -p "${UX_STATE_DIR}" 2> /dev/null; then
    UX_STATE_WRITABLE=false
fi

# ---------------------------------------------------------------------------
# Determinação semântica do tipo de attach (HUMANO)
# ---------------------------------------------------------------------------
IS_FIRST_ATTACH=false

if [[ "${UX_STATE_WRITABLE}" == "true" && ! -f "${FIRST_ATTACH_MARKER}" ]]; then
    IS_FIRST_ATTACH=true
    touch "${FIRST_ATTACH_MARKER}" 2> /dev/null || true
fi

# ---------------------------------------------------------------------------
# Atualização do contador de attaches (informativo)
# ---------------------------------------------------------------------------
# amortização: mantemos um contador base gravado em
# ${ATTACH_COUNT_FILE} e um offset transitório em
# ${ATTACH_COUNT_FILE}-offset.  o arquivo base só é
# reescrito quando atingimos um múltiplo de 10, mas o
# offset acumula os demais anexos para que o cálculo
# total seja correto.

ATTACH_OFFSET_FILE="${ATTACH_COUNT_FILE}-offset"

if [[ "${UX_STATE_WRITABLE}" == "true" ]]; then
    # garantimos que o diretório existe antes de mexer nos arquivos
    mkdir -p "${UX_STATE_DIR}" 2> /dev/null || true

    if [[ ! -f "${ATTACH_COUNT_FILE}" ]]; then
        # primeiro attach: criamos o arquivo base com 1 e limpamos qualquer offset
        if printf '%s\n' 1 > "${ATTACH_COUNT_FILE}.tmp" 2> /dev/null; then
            mv "${ATTACH_COUNT_FILE}.tmp" "${ATTACH_COUNT_FILE}" 2> /dev/null || true
        fi
        rm -f "${ATTACH_OFFSET_FILE}" 2> /dev/null || true
    else
        base="$(read_first_line "${ATTACH_COUNT_FILE}" 2> /dev/null || echo 0)"
        offset=0
        if [[ -f "${ATTACH_OFFSET_FILE}" ]]; then
            offset="$(read_first_line "${ATTACH_OFFSET_FILE}" 2> /dev/null || echo 0)"
        fi

        is_uint "${base}" || base=0
        is_uint "${offset}" || offset=0

        offset=$((offset + 1))
        total=$((base + offset))

        if ((total % 10 == 0)); then
            if printf '%s\n' "${total}" > "${ATTACH_COUNT_FILE}.tmp" 2> /dev/null; then
                mv "${ATTACH_COUNT_FILE}.tmp" "${ATTACH_COUNT_FILE}" 2> /dev/null || true
            fi
            rm -f "${ATTACH_OFFSET_FILE}" 2> /dev/null || true
        else
            # atualizamos apenas o offset, mantendo o base intacto
            if printf '%s\n' "${offset}" > "${ATTACH_OFFSET_FILE}.tmp" 2> /dev/null; then
                mv "${ATTACH_OFFSET_FILE}.tmp" "${ATTACH_OFFSET_FILE}" 2> /dev/null || true
            fi
        fi
    fi

    if date -Is > "${LAST_ATTACH_AT_FILE}.tmp" 2> /dev/null; then
        mv "${LAST_ATTACH_AT_FILE}.tmp" "${LAST_ATTACH_AT_FILE}" 2> /dev/null || true
    fi

    touch "${LAST_ATTACH_MARKER}" 2> /dev/null || true
fi

# =============================================================================
# PHASE 4 — CONTEXTO BÁSICO DO AMBIENTE (DIAGNÓSTICO HUMANO)
# additional environment diagnostics including LD_PRELOAD
# CANONICAL v5.7.1
#
# CONTRATO:
#   • Diagnóstico exclusivamente informativo
#   • Nenhuma inferência operacional
#   • Nenhuma correção automática
#   • Falhas são aceitáveis e silenciosas
#
# OBJETIVO:
#   • Oferecer ao operador humano um retrato fiel do contexto atual
#   • Tornar EXPLÍCITAS as heurísticas e suas limitações
# =============================================================================

if [[ "${BRIEF}" != "true" ]]; then
    info "Contexto do ambiente:"
fi

# ---------------------------------------------------------------------------
# Identidade de execução (defensiva)
# ---------------------------------------------------------------------------
CURRENT_USER="$(whoami 2> /dev/null || echo 'desconhecido')"
WORKSPACE_DIR="${PWD:-indefinido}"

# Âncora canônica de HOME (não normativa)
USER_HOME="${HOME:-/home/${CURRENT_USER}}"

# ---------------------------------------------------------------------------
# Contexto de execução (HEURÍSTICO, NÃO NORMATIVO)
#
# Observações:
#   • Classificação indicativa
#   • Pode falhar em WSL, SSH, CI ou setups híbridos
#   • REMOTE_CONTAINERS é variável interna do VS Code (não API estável)
# ---------------------------------------------------------------------------
EXECUTION_CONTEXT="host (heurístico)"

if [[ -n "${REMOTE_CONTAINERS:-}" ]]; then
    EXECUTION_CONTEXT="DevContainer (VS Code)"
elif [[ -f "/.dockerenv" ]]; then
    EXECUTION_CONTEXT="container Docker"
fi

# ---------------------------------------------------------------------------
# Raiz lógica do projeto (HEURÍSTICA DECLARADA)
#
# Ordem de resolução:
#   1. git rev-parse --show-toplevel, quando disponível
#   2. WORKSPACE_DIR se contiver Makefile ou .git
#   3. Diretório pai se contiver Makefile ou .git
#
# Limitações conhecidas:
#   • Monorepos profundos podem escolher o root Git, não o pacote lógico
#   • Workspaces multi-root continuam dependendo do WORKSPACE_DIR atual
#   • Execução fora do workspace pode cair no valor heurístico indefinido
# ---------------------------------------------------------------------------
PROJECT_ROOT="indefinido (heurístico)"
PARENT_DIR=""
GIT_TOPLEVEL=""

if [[ -n "${WORKSPACE_DIR:-}" ]]; then
    if command -v git > /dev/null 2>&1; then
        if GIT_TOPLEVEL="$(git -C "${WORKSPACE_DIR}" rev-parse --show-toplevel 2> /dev/null)"; then
            if [[ -n "${GIT_TOPLEVEL}" && -d "${GIT_TOPLEVEL}" ]]; then
                PROJECT_ROOT="${GIT_TOPLEVEL}"
            fi
        fi
    fi

    if [[ "${PROJECT_ROOT}" == "indefinido (heurístico)" ]]; then
        if [[ -f "${WORKSPACE_DIR}/Makefile" || -e "${WORKSPACE_DIR}/.git" ]]; then
            PROJECT_ROOT="${WORKSPACE_DIR}"
        else
            if PARENT_DIR="$(cd "${WORKSPACE_DIR}/.." 2> /dev/null && pwd -P 2> /dev/null)"; then
                if [[ -n "${PARENT_DIR}" ]] \
                    && { [[ -f "${PARENT_DIR}/Makefile" ]] || [[ -e "${PARENT_DIR}/.git" ]]; }; then
                    PROJECT_ROOT="${PARENT_DIR}"
                fi
            else
                PARENT_DIR=""
            fi
        fi
    fi
fi

# ---------------------------------------------------------------------------
# Runtime Node.js (diagnóstico passivo)
#
# Observação:
#   • Ausência de Node NÃO é erro
# ---------------------------------------------------------------------------
NODE_VERSION="$(node --version 2> /dev/null || echo 'não disponível')"
NPM_VERSION="$(npm --version 2> /dev/null || echo 'não disponível')"
NODE_PATH="$(command -v node 2> /dev/null || echo 'não encontrado')"
NPM_PATH="$(command -v npm 2> /dev/null || echo 'não encontrado')"

# ---------------------------------------------------------------------------
# Output humano estruturado
# ---------------------------------------------------------------------------
printf "  • %-22s %s\n" "Usuário:" "${CURRENT_USER}"
printf "  • %-22s %s\n" "Contexto execução:" "${EXECUTION_CONTEXT}"
printf "  • %-22s %s\n" "Workspace (PWD):" "${WORKSPACE_DIR}"
printf "  • %-22s %s\n" "Projeto (root):" "${PROJECT_ROOT}"
printf "  • %-22s %s\n" "Node.js:" "${NODE_VERSION}"
printf "  • %-22s %s\n" "npm:" "${NPM_VERSION}"
printf "  • %-22s %s\n" "Node path:" "${NODE_PATH}"
printf "  • %-22s %s\n" "npm path:" "${NPM_PATH}"

if [[ "${NODE_PATH}" =~ ^/mnt/[A-Za-z]/ ]]; then
    warn "Node.js resolve para um binário do Windows (${NODE_PATH}); prefira o Node Linux no WSL/container"
fi
if [[ "${NPM_PATH}" =~ ^/mnt/[A-Za-z]/ ]]; then
    warn "npm resolve para um binário do Windows (${NPM_PATH}); isso pode quebrar Codex, npm scripts e paths UNC"
fi

echo ""

# ---------------------------------------------------------------------------
# NSS / LD_PRELOAD — diagnóstico passivo canônico
#
# Contrato:
#   • post-attach NÃO repara NSS; apenas observa e explica.
#   • Correção estrutural pertence a:
#       - Dockerfile: cria /usr/local/lib/devcontainer/libnss_wrapper.so
#       - devcontainer.json: exporta LD_PRELOAD absoluto
#       - nss-gatekeeper: canonicaliza antes do comando real
#       - post-start: audita/recanonicaliza subprocessos do hook
# ---------------------------------------------------------------------------
info "NSS / LD_PRELOAD (diagnóstico passivo):"

NSS_BASE_DIR="${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"
NSS_CANONICAL_LIB="${DEVCONTAINER_NSS_WRAPPER_LIB:-/usr/local/lib/devcontainer/libnss_wrapper.so}"
NSS_PASSWD_FILE="${NSS_BASE_DIR}/passwd"
NSS_GROUP_FILE="${NSS_BASE_DIR}/group"

LD_PRELOAD_VALUE="${LD_PRELOAD:-}"
NSS_WRAPPER_PASSWD_VALUE="${NSS_WRAPPER_PASSWD:-}"
NSS_WRAPPER_GROUP_VALUE="${NSS_WRAPPER_GROUP:-}"

NSS_PRELOAD_FOUND=false
NSS_PRELOAD_RELATIVE=false
NSS_PRELOAD_UNREADABLE=false
NSS_PRELOAD_CANONICAL=false
NSS_PRELOAD_ABSOLUTE_NONCANONICAL=false
NSS_PRELOAD_COUNT=0

if [[ -n "${LD_PRELOAD_VALUE}" ]]; then
    OLD_IFS="${IFS}"
    IFS=':'
    for preload_token in ${LD_PRELOAD_VALUE}; do
        [[ -z "${preload_token}" ]] && continue

        case "${preload_token}" in
            libnss_wrapper.so)
                NSS_PRELOAD_FOUND=true
                NSS_PRELOAD_RELATIVE=true
                NSS_PRELOAD_COUNT=$((NSS_PRELOAD_COUNT + 1))
                ;;
            */libnss_wrapper.so)
                NSS_PRELOAD_FOUND=true
                NSS_PRELOAD_COUNT=$((NSS_PRELOAD_COUNT + 1))

                if [[ "${preload_token}" == "${NSS_CANONICAL_LIB}" ]]; then
                    NSS_PRELOAD_CANONICAL=true
                else
                    NSS_PRELOAD_ABSOLUTE_NONCANONICAL=true
                fi

                if [[ ! -r "${preload_token}" ]]; then
                    NSS_PRELOAD_UNREADABLE=true
                fi
                ;;
        esac
    done
    IFS="${OLD_IFS}"
    unset OLD_IFS preload_token
fi

printf "  • %-22s %s\n" "LD_PRELOAD:" "${LD_PRELOAD_VALUE:-<unset>}"
printf "  • %-22s %s\n" "NSS lib canônica:" "${NSS_CANONICAL_LIB}"
printf "  • %-22s %s\n" "NSS base dir:" "${NSS_BASE_DIR}"
printf "  • %-22s %s\n" "NSS passwd:" "${NSS_WRAPPER_PASSWD_VALUE:-<unset>}"
printf "  • %-22s %s\n" "NSS group:" "${NSS_WRAPPER_GROUP_VALUE:-<unset>}"

if [[ -r "${NSS_CANONICAL_LIB}" ]]; then
    ok "NSS wrapper canônico legível"
else
    warn "NSS wrapper canônico não encontrado/ilegível: ${NSS_CANONICAL_LIB}"
fi

if [[ "${NSS_PRELOAD_FOUND}" == "false" ]]; then
    warn "LD_PRELOAD não contém libnss_wrapper.so; identity wrapper pode estar inativo"
fi

if [[ "${NSS_PRELOAD_RELATIVE}" == "true" ]]; then
    warn "LD_PRELOAD contém libnss_wrapper.so relativo; esperado caminho absoluto canônico"
fi

if [[ "${NSS_PRELOAD_UNREADABLE}" == "true" ]]; then
    warn "LD_PRELOAD contém caminho de libnss_wrapper.so ilegível/inexistente"
fi

if [[ "${NSS_PRELOAD_COUNT}" -gt 1 ]]; then
    warn "LD_PRELOAD contém múltiplos tokens de libnss_wrapper.so; esperado apenas o canônico"
fi

if [[ "${NSS_PRELOAD_CANONICAL}" == "true" ]]; then
    ok "LD_PRELOAD contém NSS wrapper canônico"
elif [[ "${NSS_PRELOAD_ABSOLUTE_NONCANONICAL}" == "true" ]]; then
    warn "LD_PRELOAD contém NSS wrapper absoluto, mas diferente do caminho canônico esperado"
fi

if [[ -n "${LD_PRELOAD_VALUE}" ]]; then
    if [[ "${LD_PRELOAD_VALUE}" == ":"* || "${LD_PRELOAD_VALUE}" == *":" || "${LD_PRELOAD_VALUE}" == *"::"* ]]; then
        warn "LD_PRELOAD contém token vazio (: nas pontas ou :: no meio)"
    fi

    if ((${#LD_PRELOAD_VALUE} > 4096)); then
        warn "LD_PRELOAD tem ${#LD_PRELOAD_VALUE} caracteres; pode exceder limite seguro do kernel"
    fi
fi

if [[ -n "${NSS_WRAPPER_PASSWD_VALUE}" ]]; then
    if [[ -r "${NSS_WRAPPER_PASSWD_VALUE}" && -s "${NSS_WRAPPER_PASSWD_VALUE}" ]]; then
        ok "NSS_WRAPPER_PASSWD válido e legível"
    else
        warn "NSS_WRAPPER_PASSWD aponta para arquivo ausente, vazio ou ilegível: ${NSS_WRAPPER_PASSWD_VALUE}"
    fi
else
    warn "NSS_WRAPPER_PASSWD não está definido"
fi

if [[ -n "${NSS_WRAPPER_GROUP_VALUE}" ]]; then
    if [[ -r "${NSS_WRAPPER_GROUP_VALUE}" && -s "${NSS_WRAPPER_GROUP_VALUE}" ]]; then
        ok "NSS_WRAPPER_GROUP válido e legível"
    else
        warn "NSS_WRAPPER_GROUP aponta para arquivo ausente, vazio ou ilegível: ${NSS_WRAPPER_GROUP_VALUE}"
    fi
else
    warn "NSS_WRAPPER_GROUP não está definido"
fi

if [[ -r "${NSS_PASSWD_FILE}" && -s "${NSS_PASSWD_FILE}" && -r "${NSS_GROUP_FILE}" && -s "${NSS_GROUP_FILE}" ]]; then
    ok "Artefatos NSS runtime presentes e legíveis em ${NSS_BASE_DIR}"
else
    warn "Artefatos NSS runtime ausentes/incompletos/ilegíveis em ${NSS_BASE_DIR}; fallback /etc pode estar em uso"
fi

echo ""

# =============================================================================
# PHASE 5 — ESTADO ESTRUTURAL
# (STATE MANIFESTO | DIAGNÓSTICO PASSIVO)
# CANONICAL v5.7.1
#
# CONTRATO (INVIOLÁVEL):
#   • Leitura ESTRITAMENTE PASSIVA
#   • Nunca escreve, corrige ou recria estado
#   • Nunca falha se o estado estiver ausente, parcial ou corrompido
#
# FONTE DE VERDADE (ORDEM DE PRECEDÊNCIA):
#   1. Manifesto estrutural canônico (post-create / Section 10)
#   2. Marcador legado (.initialized) — compatibilidade histórica
#
# OBJETIVO:
#   • Informar SE e QUANDO o post-create foi executado
#   • Expor vereditos estruturais já consolidados
#   • Eliminar inferência ambígua no attach
#
# ESCOPO:
#   • HUMANO / UX apenas
#   • KERNEL já decidiu — aqui apenas se OBSERVA
# =============================================================================

# ---------------------------------------------------------------------------
# Caminho canônico do manifesto estrutural
# (alinhado ao post-create v5.2.x)
# ---------------------------------------------------------------------------
readonly STATE_MANIFEST=".devcontainer/.initialized"

# ---------------------------------------------------------------------------
# Política de leitura do estado estrutural
# (espelhada do post-create; attach nunca decide)
# ---------------------------------------------------------------------------
ENABLE_STATE_FILE_VAL="${ENABLE_STATE_FILE:-true}"

if [[ "${ENABLE_STATE_FILE_VAL}" == "true" ]]; then
    SKIP_STATE_FILE=false
else
    SKIP_STATE_FILE=true
fi

info "Estado estrutural do DevContainer:"

# ---------------------------------------------------------------------------
# Helper interno — leitura PASSIVA de chave (best-effort)
# ---------------------------------------------------------------------------
__dc_read_manifest_key() {
    # $1 = arquivo; $2 = chave. Read-only, regex-safe key=value reader.
    local file key
    file="${1:-}"
    key="${2:-}"
    [[ -r "${file}" && -n "${key}" ]] || return 0
    awk -F= -v k="${key}" '$1 == k {sub($1"=", ""); print; exit}' "${file}" 2> /dev/null | sanitize_oneline || true
}

# ---------------------------------------------------------------------------
# 1. Manifesto estrutural CANÔNICO (preferencial)
# ---------------------------------------------------------------------------
if [[ "${SKIP_STATE_FILE}" == "false" && -r "${STATE_MANIFEST}" ]]; then
    ok "Manifesto estrutural detectado (fonte canônica)"

    MANIFEST_INIT_AT="$(__dc_read_manifest_key "${STATE_MANIFEST}" "initialized_at")"
    MANIFEST_SCRIPT_VERSION="$(__dc_read_manifest_key "${STATE_MANIFEST}" "script_version")"
    MANIFEST_STATUS="$(__dc_read_manifest_key "${STATE_MANIFEST}" "status")"
    MANIFEST_INTEGRITY="$(__dc_read_manifest_key "${STATE_MANIFEST}" "integrity")"

    [[ -n "${MANIFEST_INIT_AT}" ]] \
        && info "→ Último post-create em: ${MANIFEST_INIT_AT}"

    [[ -n "${MANIFEST_SCRIPT_VERSION}" ]] \
        && info "→ post-create versão: ${MANIFEST_SCRIPT_VERSION}"

    [[ -n "${MANIFEST_STATUS}" ]] \
        && info "→ Status estrutural: ${MANIFEST_STATUS}"

    [[ -n "${MANIFEST_INTEGRITY}" ]] \
        && info "→ Integridade: ${MANIFEST_INTEGRITY}"

# ---------------------------------------------------------------------------
# 2. Fallback LEGADO (compatibilidade histórica)
# ---------------------------------------------------------------------------
elif [[ -r "${STATE_MANIFEST}" ]]; then
    warn "Manifesto canônico indisponível — usando marcador legado"
    ok "DevContainer inicializado (post-create confirmado)"

    LEGACY_INIT_AT="$(__dc_read_manifest_key "${STATE_MANIFEST}" "initialized_at")"
    LEGACY_VERSION="$(__dc_read_manifest_key "${STATE_MANIFEST}" "script_version")"

    [[ -n "${LEGACY_INIT_AT}" ]] \
        && info "→ Inicializado em: ${LEGACY_INIT_AT}"

    [[ -n "${LEGACY_VERSION}" ]] \
        && info "→ post-create versão: ${LEGACY_VERSION}"

# ---------------------------------------------------------------------------
# 3. Estado estrutural ausente / desconhecido
# ---------------------------------------------------------------------------
else
    warn "Estado estrutural indisponível"
    warn "→ post-create pode não ter sido executado ainda"
    warn "→ Se algo parecer inconsistente: Rebuild Container"
fi

echo ""

# =============================================================================
# PHASE 6 — ESTADO DE SAÚDE & CAPACIDADES CRÍTICAS (PASSIVO)
# CANONICAL v5.7.1
#
# CONTRATO (INVIOLÁVEL):
#   • Diagnóstico estritamente PASSIVO
#   • Nunca executa checks
#   • Nunca infere causa de falha
#   • Nunca corrige estado
#   • Nunca bloqueia o attach
#
# OBJETIVO:
#   • Informar o último estado de saúde conhecido
#   • Expor capacidades críticas observáveis (runtime)
# =============================================================================

# ---------------------------------------------------------------------------
# 6.1 — Health / Network / Diagnostics snapshots (passivo)
# ---------------------------------------------------------------------------
HEALTH_STATUS_FILE="${DEVCONTAINER_HEALTH_STATUS_FILE:-/tmp/devcontainer-health.status}"
NETWORK_STATUS_FILE="${DEVCONTAINER_NETWORK_STATUS_FILE:-/tmp/devcontainer-network.status}"
DIAGNOSTICS_STATUS_FILE="${DEVCONTAINER_DIAGNOSTICS_STATUS_FILE:-/tmp/devcontainer-diagnostics.status}"
GITHUB_ROUTE_REPORT_FILE="${DEVCONTAINER_GITHUB_ROUTE_REPORT_FILE:-/tmp/devcontainer-github-api-route.report}"

info "Estado conhecido do sistema:"

read_status_snapshot "${HEALTH_STATUS_FILE}" "Último healthcheck registrado"
read_status_snapshot "${NETWORK_STATUS_FILE}" "Último network check registrado"
read_status_snapshot "${DIAGNOSTICS_STATUS_FILE}" "Último diagnostics check registrado"

if [[ -r "${GITHUB_ROUTE_REPORT_FILE}" ]]; then
    ok "Relatório de rota GitHub API detectado"
    info "→ ${GITHUB_ROUTE_REPORT_FILE}"
else
    info "→ Relatório de rota GitHub API ainda não registrado"
fi

echo ""

# ---------------------------------------------------------------------------
# 6.1.1 — Rede GitHub/Copilot & DNS cache local (snapshot passivo)
# ---------------------------------------------------------------------------
# Contrato:
#   • Apenas lê snapshots já produzidos pelo post-start e pelos scripts de rede.
#   • Nunca inicia dnsmasq, proxy, curl probes, advisor ou route-fix.
#   • Nunca reescreve /etc/resolv.conf.
#   • Nunca imprime tokens/ambiente bruto.
# ---------------------------------------------------------------------------
POST_START_SUMMARY_FILE="${DEVCONTAINER_POST_START_SUMMARY_FILE:-/tmp/devcontainer-post-start.summary}"
LOCAL_DNS_STATUS_FILE="${DEVCONTAINER_LOCAL_DNS_STATUS_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_STATUS_FILE:-/tmp/devcontainer-local-dns-cache.status}}"
LOCAL_DNS_SUMMARY_FILE="${DEVCONTAINER_LOCAL_DNS_SUMMARY_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_SUMMARY_FILE:-/tmp/devcontainer-local-dns-cache.summary}}"
COPILOT_NETWORK_STATUS_FILE="${DEVCONTAINER_COPILOT_NETWORK_STATUS_FILE:-/tmp/devcontainer-copilot-network.status}"
COPILOT_NETWORK_SUMMARY_FILE="${DEVCONTAINER_COPILOT_NETWORK_SUMMARY_FILE:-/tmp/devcontainer-copilot-network.summary}"
COPILOT_NETWORK_DIAGNOSIS_FILE="${DEVCONTAINER_COPILOT_NETWORK_DIAGNOSIS_FILE:-/tmp/devcontainer-copilot-network.diagnosis.tsv}"
GITHUB_ROUTE_STATUS_FILE="${DEVCONTAINER_GITHUB_ROUTE_STATUS_FILE:-/tmp/devcontainer-github-api-route.status}"
GITHUB_ROUTE_SUMMARY_FILE="${DEVCONTAINER_GITHUB_ROUTE_SUMMARY_FILE:-/tmp/devcontainer-github-api-route.summary}"
GITHUB_ROUTE_METRICS_FILE="${DEVCONTAINER_GITHUB_ROUTE_METRICS_FILE:-/tmp/devcontainer-github-api-route.metrics.tsv}"
LOCAL_PROXY_STATUS_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_STATUS_FILE:-/tmp/devcontainer-copilot-proxy.status}"
LOCAL_PROXY_SUMMARY_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_SUMMARY_FILE:-/tmp/devcontainer-copilot-proxy.summary}"
GITHUB_ROUTE_BENCHMARK_FILE="${DEVCONTAINER_GITHUB_ROUTE_BENCHMARK_FILE:-/tmp/devcontainer-github-api-route.benchmark.tsv}"
GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE="${DEVCONTAINER_GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE:-/tmp/devcontainer-github-api-route.benchmark.summary}"
GITHUB_ROUTE_RECOMMENDATION_FILE="${DEVCONTAINER_GITHUB_ROUTE_RECOMMENDATION_FILE:-/tmp/devcontainer-github-api-route.recommendation}"
COPILOT_NETWORK_RECOMMENDATION_FILE="${DEVCONTAINER_COPILOT_NETWORK_RECOMMENDATION_FILE:-/tmp/devcontainer-copilot-network.recommendation}"
COPILOT_NETWORK_RECOMMENDATION_JSON_FILE="${DEVCONTAINER_COPILOT_NETWORK_RECOMMENDATION_JSON_FILE:-/tmp/devcontainer-copilot-network.recommendation.json}"
LOCAL_PROXY_BENCHMARK_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_FILE:-/tmp/devcontainer-copilot-proxy.benchmark.tsv}"
LOCAL_PROXY_BENCHMARK_SUMMARY_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_SUMMARY_FILE:-/tmp/devcontainer-copilot-proxy.benchmark.summary}"
LOCAL_PROXY_COMPARISON_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_COMPARISON_FILE:-/tmp/devcontainer-copilot-proxy.comparison.tsv}"
LOCAL_PROXY_RECOMMENDATION_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE:-/tmp/devcontainer-copilot-proxy.recommendation}"
COPILOT_ROUTE_ADVISOR_STATUS_FILE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_STATUS_FILE:-/tmp/devcontainer-copilot-route-advisor.status}"
COPILOT_ROUTE_ADVISOR_SUMMARY_FILE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_SUMMARY_FILE:-/tmp/devcontainer-copilot-route-advisor.summary}"
ENDPOINT_REGISTRY_FILE="${DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY_FILE:-${PROJECT_ROOT}/.devcontainer/network/endpoints.github-copilot.tsv}"
ENDPOINT_REGISTRY_FALLBACK_FILE=".devcontainer/network/endpoints.github-copilot.tsv"
if [[ ! -r "${ENDPOINT_REGISTRY_FILE}" && -r "${ENDPOINT_REGISTRY_FALLBACK_FILE}" ]]; then
    ENDPOINT_REGISTRY_FILE="${ENDPOINT_REGISTRY_FALLBACK_FILE}"
fi

info "Rede GitHub/Copilot e DNS local (snapshot passivo):"

# post-start summary: visão orquestradora mais recente.
if [[ -r "${POST_START_SUMMARY_FILE}" ]]; then
    POST_START_STATUS="$(kv_or "${POST_START_SUMMARY_FILE}" status unknown)"
    POST_START_NETWORK_STATUS="$(kv_or "${POST_START_SUMMARY_FILE}" network_status unknown)"
    POST_START_DIAGNOSTICS_STATUS="$(kv_or "${POST_START_SUMMARY_FILE}" diagnostics_status unknown)"
    print_status_line "post-start" "${POST_START_STATUS}"
    print_bullet "network/diagnostics:" "${POST_START_NETWORK_STATUS}/${POST_START_DIAGNOSTICS_STATUS}"
    print_bullet "versão post-start:" "$(kv_or "${POST_START_SUMMARY_FILE}" script_version unknown)"
    print_bullet "transport boot:" "$(kv_or "${POST_START_SUMMARY_FILE}" boot_transport_profile unknown); apply=$(kv_or "${POST_START_SUMMARY_FILE}" apply_transport_recommendation false)"
    print_bullet "manager rec.:" "$(kv_or "${POST_START_SUMMARY_FILE}" copilot_network_recommendation_action unknown)/$(kv_or "${POST_START_SUMMARY_FILE}" copilot_network_recommended_transport unknown); conf=$(kv_or "${POST_START_SUMMARY_FILE}" copilot_network_recommendation_confidence unknown)"
    print_bullet "manager reason:" "$(kv_or "${POST_START_SUMMARY_FILE}" copilot_network_recommendation_reason unknown)"
    print_bullet "artifact states:" "route=$(kv_or "${POST_START_SUMMARY_FILE}" copilot_network_route_artifact_state unknown); proxy=$(kv_or "${POST_START_SUMMARY_FILE}" copilot_network_proxy_artifact_state unknown)"
    print_bullet "soft degraded:" "github=$(kv_or "${POST_START_SUMMARY_FILE}" copilot_network_github_api_soft_degraded_count 0); overall=$(kv_or "${POST_START_SUMMARY_FILE}" copilot_network_overall_soft_degraded_count 0)"
    print_bullet "endpoint registry:" "$(kv_or "${POST_START_SUMMARY_FILE}" endpoint_registry_status unknown); rows=$(kv_or "${POST_START_SUMMARY_FILE}" endpoint_registry_rows 0); bad=$(kv_or "${POST_START_SUMMARY_FILE}" endpoint_registry_bad_rows 0)"
    print_bullet "proxy rec.:" "$(kv_or "${POST_START_SUMMARY_FILE}" local_copilot_proxy_recommendation_action unknown); conf=$(kv_or "${POST_START_SUMMARY_FILE}" local_copilot_proxy_recommendation_confidence unknown)"
    print_bullet "route rec.:" "$(kv_or "${POST_START_SUMMARY_FILE}" github_route_recommendation_action unknown)"
    print_bullet "route current/best:" "$(kv_or "${POST_START_SUMMARY_FILE}" github_route_current_ip unknown)/$(kv_or "${POST_START_SUMMARY_FILE}" github_route_best_candidate_ip unknown); p95=$(kv_or "${POST_START_SUMMARY_FILE}" github_route_current_p95_ms unknown)/$(kv_or "${POST_START_SUMMARY_FILE}" github_route_best_candidate_p95_ms unknown)ms"
    print_bullet "concluído em:" "$(kv_or "${POST_START_SUMMARY_FILE}" completed_at unknown)"
else
    info "post-start summary ainda não registrado"
fi

print_endpoint_registry_snapshot "${ENDPOINT_REGISTRY_FILE}"

# DNS cache local
DNS_CACHE_ENABLED="${DEVCONTAINER_ENABLE_LOCAL_DNS_CACHE:-false}"
DNS_STATUS="$(status_snapshot_or "${LOCAL_DNS_STATUS_FILE}" "${LOCAL_DNS_SUMMARY_FILE}" status unknown)"

if [[ -r "${LOCAL_DNS_SUMMARY_FILE}" ]]; then
    print_status_line "DNS cache local" "${DNS_STATUS}"
    print_bullet "habilitado:" "${DNS_CACHE_ENABLED}"
    print_bullet "modo/action:" "$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" mode unknown)/$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" action unknown)"
    print_bullet "resolv.conf:" "$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" resolv_conf_health "$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" resolv_conf_status unknown)")"
    print_bullet "nameservers:" "$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" resolv_conf_nameservers unknown)"
    print_bullet "status stale:" "$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" status_stale unknown)"
    print_bullet "stale reason:" "$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" status_stale_reason unknown)"
    print_bullet "upstreams:" "$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" selected_upstreams unknown)"
    print_bullet "ranking:" "$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" ranking_source unknown)/stale=$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" ranking_stale unknown)"
    print_bullet "dnsmasq:" "$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" dnsmasq_process_status unknown)/$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" dnsmasq_port_status unknown)"
    print_bullet "probe local:" "$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" local_probe_status "$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" probe_local_dns unknown)")"
    print_bullet "fail-closed:" "restore_on_failure=$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" restore_resolv_conf_on_failure unknown)"
    print_bullet "concluído em:" "$(kv_or "${LOCAL_DNS_SUMMARY_FILE}" completed_at unknown)"
else
    if [[ "${DNS_CACHE_ENABLED}" == "true" ]]; then
        warn "DNS cache local habilitado, mas summary ainda não foi registrado"
    else
        info "DNS cache local: desabilitado por configuração"
    fi
fi

if [[ -r /etc/resolv.conf ]]; then
    RESOLV_FIRST_NS="$(awk '$1 == "nameserver" {print $2; exit}' /etc/resolv.conf 2> /dev/null | sanitize_oneline)"
    print_bullet "nameserver efetivo:" "${RESOLV_FIRST_NS:-unknown}"
    if [[ "${DNS_CACHE_ENABLED}" == "true" ]]; then
        if [[ "${RESOLV_FIRST_NS}" == "127.0.0.1" || "${RESOLV_FIRST_NS}" == "::1" ]]; then
            ok "/etc/resolv.conf aponta para o cache local"
        else
            warn "DNS cache habilitado, mas /etc/resolv.conf não aponta para loopback"
        fi
    fi
fi

# GitHub API route summary
ROUTE_STATUS="$(status_snapshot_or "${GITHUB_ROUTE_STATUS_FILE}" "${GITHUB_ROUTE_SUMMARY_FILE}" status unknown)"
if [[ -r "${GITHUB_ROUTE_SUMMARY_FILE}" ]]; then
    print_status_line "GitHub API route-fix" "${ROUTE_STATUS}"
    print_bullet "api.github.com IP:" "$(kv_or "${GITHUB_ROUTE_SUMMARY_FILE}" selected_ip "$(kv_or "${GITHUB_ROUTE_SUMMARY_FILE}" current_ip unknown)")"
    print_bullet "latência rota:" "$(kv_or "${GITHUB_ROUTE_SUMMARY_FILE}" selected_latency_ms unknown)ms"
    print_bullet "p95 rota:" "$(kv_or "${GITHUB_ROUTE_SUMMARY_FILE}" selected_p95_latency_ms unknown)ms"
    print_key_if_present "current IP:" "${GITHUB_ROUTE_SUMMARY_FILE}" current_ip
    print_key_if_present "best candidate:" "${GITHUB_ROUTE_SUMMARY_FILE}" best_candidate_ip
    print_key_if_present "current p95:" "${GITHUB_ROUTE_SUMMARY_FILE}" current_p95_ms
    print_key_if_present "best p95:" "${GITHUB_ROUTE_SUMMARY_FILE}" best_candidate_p95_ms
    print_bullet "decisão:" "$(kv_or "${GITHUB_ROUTE_SUMMARY_FILE}" decision_reason "$(kv_or "${GITHUB_ROUTE_SUMMARY_FILE}" reason unknown)")"
    print_file_hint "métricas:" "${GITHUB_ROUTE_METRICS_FILE}"
else
    info "GitHub API route summary ainda não registrado"
fi

# Copilot network manager summary
COPILOT_STATUS="$(status_snapshot_or "${COPILOT_NETWORK_STATUS_FILE}" "${COPILOT_NETWORK_SUMMARY_FILE}" status unknown)"
if [[ -r "${COPILOT_NETWORK_SUMMARY_FILE}" ]]; then
    print_status_line "Copilot Network Manager" "${COPILOT_STATUS}"
    print_bullet "planos:" "overall=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" plane_overall_status unknown); github=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" plane_github_api_status unknown); transport=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" plane_copilot_transport_status unknown); telemetry=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" plane_copilot_telemetry_status unknown)"
    print_bullet "soft-degraded:" "github=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" github_api_soft_degraded_count 0); overall=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" overall_soft_degraded_count 0); reason=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" github_api_soft_degraded_reason none)"
    print_bullet "registry:" "$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" endpoint_registry_status unknown); rows=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" endpoint_registry_rows 0); bad=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" endpoint_registry_bad_rows 0)"
    print_bullet "route:" "$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" route_status unknown) → $(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" route_selected_ip unknown)"
    print_bullet "route artifacts:" "state=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" github_route_artifact_state unknown); current=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" github_route_current_ip unknown); best=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" github_route_best_candidate_ip unknown)"
    print_bullet "DNS cache efetivo:" "$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" dns_cache_effective unknown); stale=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" dns_cache_status_stale unknown)"
    print_bullet "endpoints:" "$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" endpoints_ok 0)/$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" endpoints_total 0) ok; failed=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" endpoints_failed 0); slow=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" endpoints_slow 0)"
    print_bullet "pior host atual:" "$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" current_worst_host unknown) ($(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" current_worst_total_ms unknown)ms)"
    print_bullet "histórico:" "$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" history_status unknown); pior=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" history_worst_host unknown)/p95=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" history_worst_p95_ms unknown)ms"
    print_bullet "bottleneck:" "$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" primary_bottleneck unknown)"
    print_bullet "proxy artifact:" "state=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" local_proxy_artifact_state unknown); action=$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" local_proxy_recommendation_action unknown)"
    print_bullet "recomendações:" "$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" recommendations observe)"
    print_file_hint "diagnóstico:" "${COPILOT_NETWORK_DIAGNOSIS_FILE}"
    print_bullet "concluído em:" "$(kv_or "${COPILOT_NETWORK_SUMMARY_FILE}" completed_at unknown)"
else
    info "Copilot Network Manager summary ainda não registrado"
fi

# Recommendation / benchmark artifacts. These are generated by manual long-running
# jobs and consumed passively here. post-attach must never start such jobs.
if [[ "${SHOW_NETWORK_RECOMMENDATIONS}" != "false" ]]; then
    info "Recomendações persistidas e benchmarks de rede (snapshot passivo):"
    print_recommendation_snapshot "Manager" "${COPILOT_NETWORK_RECOMMENDATION_FILE}"
    print_recommendation_snapshot "Route-fix" "${GITHUB_ROUTE_RECOMMENDATION_FILE}"
    print_recommendation_snapshot "Proxy local" "${LOCAL_PROXY_RECOMMENDATION_FILE}"
    print_file_hint "manager json:" "${COPILOT_NETWORK_RECOMMENDATION_JSON_FILE}"
    print_bullet "manager route p95:" "current=$(kv_or "${COPILOT_NETWORK_RECOMMENDATION_FILE}" route_current_p95_ms unknown); best=$(kv_or "${COPILOT_NETWORK_RECOMMENDATION_FILE}" route_best_candidate_p95_ms unknown)ms"
    print_bullet "manager fail-rate:" "current=$(kv_or "${COPILOT_NETWORK_RECOMMENDATION_FILE}" route_current_fail_rate_percent unknown); best=$(kv_or "${COPILOT_NETWORK_RECOMMENDATION_FILE}" route_best_candidate_fail_rate_percent unknown)%"
    if [[ "${SHOW_BENCHMARK_ARTIFACTS}" != "false" ]]; then
        print_artifact_freshness "route bench summary" "${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}"
        print_artifact_freshness "route bench tsv" "${GITHUB_ROUTE_BENCHMARK_FILE}"
        print_artifact_freshness "proxy bench summary" "${LOCAL_PROXY_BENCHMARK_SUMMARY_FILE}"
        print_artifact_freshness "proxy comparison" "${LOCAL_PROXY_COMPARISON_FILE}"
        print_artifact_freshness "proxy bench tsv" "${LOCAL_PROXY_BENCHMARK_FILE}"
    fi
    case "$(kv_any_or "${COPILOT_NETWORK_RECOMMENDATION_FILE}" unknown recommended_action action):$(kv_any_or "${COPILOT_NETWORK_RECOMMENDATION_FILE}" unknown recommended_transport transport)" in
        prefer-proxy-opt-in:proxy-local)
            info "→ Proxy local recomendado apenas como opt-in; boot não deve exportar proxy global automaticamente."
            ;;
        keep-direct:direct | keep-direct:*)
            ok "→ Recomendação atual favorece conexão direta."
            ;;
        observe-more:* | insufficient*:*)
            info "→ Recomendação ainda pede mais observação/amostras."
            ;;
        *)
            info "→ Sem recomendação operacional forte no snapshot atual."
            ;;
    esac
fi

# Route advisor permanece passivo/opt-in; apenas documenta se houver snapshot.
ADVISOR_STATUS="$(status_snapshot_or "${COPILOT_ROUTE_ADVISOR_STATUS_FILE}" "${COPILOT_ROUTE_ADVISOR_SUMMARY_FILE}" status unknown)"
if [[ -r "${COPILOT_ROUTE_ADVISOR_SUMMARY_FILE}" ]]; then
    print_status_line "Copilot Route Advisor" "${ADVISOR_STATUS}"
    print_bullet "better candidates:" "$(kv_or "${COPILOT_ROUTE_ADVISOR_SUMMARY_FILE}" endpoints_with_better_candidate 0)"
    print_bullet "current failed:" "$(kv_or "${COPILOT_ROUTE_ADVISOR_SUMMARY_FILE}" endpoints_current_failed 0)"
    print_bullet "melhor ganho:" "$(kv_or "${COPILOT_ROUTE_ADVISOR_SUMMARY_FILE}" global_best_improvement_ms 0)ms"
    print_bullet "recomendações:" "$(kv_or "${COPILOT_ROUTE_ADVISOR_SUMMARY_FILE}" recommendations observe)"
else
    info "Copilot Route Advisor: sem snapshot registrado (normal se não foi executado manualmente)"
fi

# Proxy local permanece opt-in; apenas documenta se houver snapshot.
PROXY_STATUS="$(status_snapshot_or "${LOCAL_PROXY_STATUS_FILE}" "${LOCAL_PROXY_SUMMARY_FILE}" status unknown)"
if [[ "${DEVCONTAINER_ENABLE_LOCAL_COPILOT_PROXY:-false}" == "true" || -r "${LOCAL_PROXY_SUMMARY_FILE}" || -r "${LOCAL_PROXY_STATUS_FILE}" ]]; then
    if [[ -r "${LOCAL_PROXY_SUMMARY_FILE}" ]]; then
        print_status_line "Proxy local Copilot" "${PROXY_STATUS}"
        print_bullet "proxy mode:" "$(kv_or "${LOCAL_PROXY_SUMMARY_FILE}" mode unknown)"
        print_bullet "listen:" "$(kv_or "${LOCAL_PROXY_SUMMARY_FILE}" listen_address "$(kv_or "${LOCAL_PROXY_SUMMARY_FILE}" proxy_host unknown)"):$(kv_or "${LOCAL_PROXY_SUMMARY_FILE}" listen_port "$(kv_or "${LOCAL_PROXY_SUMMARY_FILE}" proxy_port unknown)")"
        print_bullet "env file:" "$(kv_or "${LOCAL_PROXY_SUMMARY_FILE}" env_file unknown)"
        print_bullet "benchmark:" "$(kv_or "${LOCAL_PROXY_SUMMARY_FILE}" benchmark_status not-run); samples=$(kv_or "${LOCAL_PROXY_SUMMARY_FILE}" benchmark_samples 0)"
        print_bullet "comparison:" "$(kv_or "${LOCAL_PROXY_SUMMARY_FILE}" comparison_status not-run); rec=$(kv_or "${LOCAL_PROXY_SUMMARY_FILE}" recommendation_action none)"
    else
        info "Proxy local Copilot habilitado/observado, mas sem summary registrado"
    fi
fi

echo ""

# ---------------------------------------------------------------------------
# 6.2 — SSH (Capacidade Crítica | Observação Passiva)
# ---------------------------------------------------------------------------
info "SSH (capacidade crítica):"

# Observação:
# - NÃO valida conectividade externa
# - NÃO executa ssh-add
# - NÃO tenta iniciar agent
# - Apenas descreve o estado VISÍVEL

if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
    warn "SSH indisponível (SSH_AUTH_SOCK ausente)"

elif [[ -S "${SSH_AUTH_SOCK}" ]]; then
    ok "SSH agent detectado"
    info "→ Socket visível: ${SSH_AUTH_SOCK}"

else
    warn "SSH_AUTH_SOCK definido, mas não é um socket válido"
    warn "→ Caminho observado: ${SSH_AUTH_SOCK}"
fi

echo ""

# ---------------------------------------------------------------------------
# 6.3 — ENV (Resumo Passivo - Arquitetura remoteEnv)
# ---------------------------------------------------------------------------
# Nota arquitetural:
#   Sistema usa remoteEnv (devcontainer.json) + runArgs (--env-file)
#   Arquivo .env físico NÃO é obrigatório (vars injetadas pelo Docker/VS Code)
# ---------------------------------------------------------------------------
info "Configuração de ambiente (arquitetura remoteEnv):"

# Validar vars críticas injetadas (5 estruturais mínimas)
CRITICAL_VARS_INJECTED=("NODE_ENV" "SERVER_MODE" "SERVER_AUTHORITY" "BROWSER_MODE" "SERVER_PORT")
MISSING_COUNT=0

for var in "${CRITICAL_VARS_INJECTED[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        ((MISSING_COUNT++))
    fi
done

if [[ ${MISSING_COUNT} -eq 0 ]]; then
    ok "Variáveis críticas injetadas (remoteEnv ativo)"
    info "→ NODE_ENV=${NODE_ENV:-<unset>}"
    info "→ BROWSER_MODE=${BROWSER_MODE:-<unset>}"

    # Mostrar se .env físico existe (informativo, não obrigatório)
    if [[ -f ".env" ]]; then
        info "→ Arquivo .env físico detectado (suplementar)"
    else
        info "→ Arquivo .env físico ausente (normal - usa remoteEnv)"
    fi
else
    warn "${MISSING_COUNT} variáveis críticas ausentes"
    warn "→ Verifique devcontainer.json (remoteEnv)"
fi

echo ""

if [[ "${BRIEF}" == "true" ]]; then
    printf "%b\n" "${BLUE}──────────────────────────────────────────────────────────────${NC}"
    ok "Ambiente pronto para uso."
    info "Attach concluído em modo breve."
    printf "%b\n" "${BLUE}──────────────────────────────────────────────────────────────${NC}"
    echo ""
    exit 0
fi

# =============================================================================
# PHASE 7 — QUICK START GUIDE (FIRST ATTACH ONLY)
# CANONICAL v5.7.1
#
# CONTRATO:
#   • Exibido APENAS no primeiro attach
#   • Informativo (humano), nunca executável
#   • Nenhuma inferência técnica
#   • Nenhuma validação ou diagnóstico
#
# OBJETIVO:
#   • Orientar o operador humano no primeiro contato
#   • Reduzir fricção inicial
#   • Apresentar o fluxo mental do projeto
# =============================================================================

if [ "${IS_FIRST_ATTACH}" = true ]; then
    echo ""
    printf "%b\n" "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    printf "%b\n" "${GREEN}🚀 QUICK START — Primeiros Passos${NC}"
    printf "%b\n" "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""

    echo "📦 Visão geral:"
    echo "Este DevContainer fornece um ambiente isolado para desenvolvimento,"
    echo "com automação baseada em Node.js + Puppeteer + Chrome externo."
    echo ""

    echo "🧩 Etapas conceituais (ordem flexível):"
    echo ""

    echo "1️⃣  Configuração de ambiente"
    echo "   • Fonte primária: remoteEnv (devcontainer.json) + runArgs (--env-file)"
    echo "   • Arquivo .env local é opcional (suplementar)"
    echo ""

    echo "2️⃣  Dependência externa: Chrome (Windows host)"
    echo "   • Um Chrome REAL roda fora do container"
    echo "   • Ele é acessado indiretamente via proxy interno"
    echo "   • Estado normal no início: Chrome NÃO estar rodando"
    echo ""

    echo "3️⃣  Inicialização do sistema"
    echo "   • O sistema é iniciado manualmente quando fizer sentido"
    echo "   • Tipicamente via Makefile ou PM2"
    echo ""

    echo "4️⃣  Observabilidade e controle"
    echo "   • Dashboard web"
    echo "   • Logs em tempo real"
    echo "   • Healthcheck sob demanda"
    echo ""

    echo "📚 Documentação principal:"
    echo "   • README.md"
    echo "   • DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md"
    echo "   • DOCUMENTAÇÃO/REFERENCIA/ENV_VARIABLES_GUIDE.md"
    echo ""

    echo "💡 Dica:"
    echo "Este ambiente NÃO executa nada automaticamente no attach."
    echo "Todas as ações são explícitas e sob seu controle."
    echo ""

    printf "%b\n" "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
fi

# =============================================================================
# PHASE 8 — PM2 (OBSERVAÇÃO PASSIVA SEM DAEMONIZAÇÃO)
# CANONICAL v5.7.1
#
# CONTRATO:
#   • Observação estritamente PASSIVA.
#   • Nunca chama `pm2 jlist`, `pm2 list`, `pm2 status` ou qualquer comando que
#     possa inicializar o daemon interno do PM2.
#   • Nunca inicia, reinicia ou modifica processos.
#   • Nunca presume que PM2 deva estar ativo.
#
# OBJETIVO:
#   • Informar se o binário PM2 está disponível.
#   • Ler, se existir, o dump persistente ~/.pm2/dump.pm2 de forma passiva.
# =============================================================================

info "PM2 (observação passiva sem daemonização):"

PM2_CMD=""

# ---------------------------------------------------------------------------
# Detecção do binário PM2 (ordem semântica)
# ---------------------------------------------------------------------------
if command -v pm2 > /dev/null 2>&1; then
    PM2_CMD="$(command -v pm2 2> /dev/null || echo pm2)"
elif [[ -x "node_modules/.bin/pm2" ]]; then
    PM2_CMD="node_modules/.bin/pm2"
fi

if [[ -n "${PM2_CMD}" ]]; then
    PM2_VERSION="$(detect_pm2_version_passive "${PM2_CMD}")"
    ok "PM2 disponível — binário: ${PM2_CMD}"
    info "→ Versão detectada passivamente: ${PM2_VERSION}"

    PM2_HOME_EFFECTIVE="${PM2_HOME:-${USER_HOME}/.pm2}"
    PM2_DUMP_FILE="${PM2_HOME_EFFECTIVE}/dump.pm2"
    PM2_DUMP_COUNT="$(pm2_dump_process_count_passive)"

    if [[ "${PM2_DUMP_COUNT}" == "absent" ]]; then
        warn "Nenhum dump.pm2 encontrado em ${PM2_HOME_EFFECTIVE}"
        info "→ Normal antes de iniciar ou salvar processos PM2"
    elif [[ "${PM2_DUMP_COUNT}" == "unknown" ]]; then
        warn "dump.pm2 encontrado, mas não pôde ser interpretado passivamente"
        info "→ Arquivo: ${PM2_DUMP_FILE}"
    elif is_uint "${PM2_DUMP_COUNT}" && [[ "${PM2_DUMP_COUNT}" -gt 0 ]]; then
        ok "dump.pm2 indica ${PM2_DUMP_COUNT} processo(s) salvo(s)"
        info "→ Isto não confirma processo ativo; é apenas snapshot persistente"
        info "→ Use 'pm2 status' ou 'make pm2-status' manualmente para estado real"
    else
        warn "dump.pm2 presente, mas sem processos salvos"
        info "→ Normal antes de iniciar/salvar o sistema"
    fi
else
    warn "PM2 não detectado no ambiente"
    info "→ Normal se o sistema ainda não foi iniciado ou não utiliza PM2"
fi

echo ""

# =============================================================================
# PHASE 9 — CHROME EXTERNO (CDP | DIAGNÓSTICO PASSIVO)
# CANONICAL v5.7.1
#
# MODELO FÍSICO (NÃO NEGOCIÁVEL):
#
#   Windows Host
#   ────────────
#   • Chrome REAL (browser efetivo)
#   • Porta: 9225 (remote debugging, bind 0.0.0.0)
#   • ÚNICO ponto onde o browser realmente existe
#   • Estado NORMAL: NÃO estar rodando (inicia sob demanda)
#
#   DevContainer (Docker)
#   ─────────────────────
#   • Chrome Proxy Service (Node.js / PM2)
#   • Porta: 9224
#   • Frontend: localhost:9224  (Puppeteer conecta aqui)
#   • Backend: host.docker.internal:9225 (encaminhamento)
#
#   Puppeteer (Node.js no container)
#   ─────────────────────────────────
#   • Conecta EXCLUSIVAMENTE ao proxy (localhost:9224)
#   • Nunca acessa o Chrome Windows diretamente
#   • Não conhece topologia externa
#
# CONTRATO DESTA FASE:
#   • Diagnóstico estritamente PASSIVO
#   • Nunca inicia Chrome, proxy ou serviços
#   • Nunca bloqueia o attach
#   • Nunca presume que Chrome esteja ativo
#
# OBJETIVO:
#   • Informar a arquitetura ao operador humano
#   • Observar, de forma best-effort, o endpoint LOCAL do proxy
# =============================================================================

info "Chrome externo (arquitetura proxy — diagnóstico passivo):"
echo ""
echo "  Arquitetura efetiva:"
echo "    Puppeteer → localhost:9224 (proxy no container)"
echo "             → host.docker.internal:9225 (Chrome no Windows)"
echo ""
echo "  ℹ️  Nota operacional:"
echo "      • Chrome Windows é FUNDAMENTAL para operações LLM"
echo "      • Estado normal durante attach/boot: NÃO estar rodando"
echo "      • Chrome será iniciado sob demanda quando necessário"
echo "      • Comando manual (Windows host): START-CHROME-SIMPLE.bat"
echo ""

# ---------------------------------------------------------------------------
# Observação passiva do Chrome Proxy (endpoint local do Puppeteer)
# ---------------------------------------------------------------------------
info "Chrome Proxy (endpoint local — observação passiva):"

# Endpoint canônico do proxy
# • Derivado de PUPPETEER_WS_ENDPOINT
# • Fallback seguro: http://localhost:9224
RAW_CHROME_PROXY_ENDPOINT="${PUPPETEER_WS_ENDPOINT:-http://localhost:9224}"
CHROME_PROXY_ENDPOINT="${RAW_CHROME_PROXY_ENDPOINT}"
if [[ "${RAW_CHROME_PROXY_ENDPOINT}" == ws://* ]]; then
    CHROME_PROXY_ENDPOINT="http://${RAW_CHROME_PROXY_ENDPOINT#ws://}"
elif [[ "${RAW_CHROME_PROXY_ENDPOINT}" == wss://* ]]; then
    CHROME_PROXY_ENDPOINT="https://${RAW_CHROME_PROXY_ENDPOINT#wss://}"
fi
CHROME_CDP_PATH="/json/version"
CHROME_CDP_TIMEOUT_SECONDS=2

if command -v curl > /dev/null 2>&1; then
    CDP_RESPONSE="$(
        LC_ALL=C curl \
            --noproxy '*' \
            --silent \
            --fail \
            --max-time "${CHROME_CDP_TIMEOUT_SECONDS}" \
            --connect-timeout "${CHROME_CDP_TIMEOUT_SECONDS}" \
            "${CHROME_PROXY_ENDPOINT}${CHROME_CDP_PATH}" \
            2> /dev/null || echo ""
    )"

    if [ -n "${CDP_RESPONSE}" ]; then
        # Proxy respondeu — SEM inferir estado do Chrome Windows
        CHROME_VERSION="$(
            echo "${CDP_RESPONSE}" \
                | sed -n 's/.*"Browser"[[:space:]]*:[[:space:]]*"\([^\"]*\)".*/\1/p'
        )"

        ok "Chrome Proxy (container:9224): respondendo"
        [ -n "${CHROME_VERSION}" ] && info "  └─ Backend reportado: ${CHROME_VERSION}"
        info "  └─ Proxy ativo ≠ Chrome Windows ativo (pode estar aguardando)"

    else
        warn "Chrome Proxy (container:9224): não acessível"
        info "  └─ Estado normal durante attach (sistema não iniciado)"
        info "  └─ Proxy será iniciado via: make start"
    fi
else
    warn "curl indisponível — observação do Chrome Proxy ignorada"
fi

echo ""

# =============================================================================
# PHASE 10 — VOLUMES & CACHE (OBSERVAÇÃO PASSIVA)
# CANONICAL v5.7.1
#
# CONTRATO (INVIOLÁVEL):
#   • Display estritamente PASSIVO
#   • Nunca cria, corrige ou modifica volumes
#   • Nunca falha
#
# OBJETIVO:
#   • Expor presença de volumes persistentes esperados
#   • Indicar capacidade de cache / estado entre sessões
#   • Fornecer snapshot de uso de disco (host/container)
# =============================================================================

info "Volumes persistentes (observação passiva):"

# ---------------------------------------------------------------------------
# Volumes esperados (contrato lógico, não garantia física)
#
# Nota:
# • Ausência NÃO é erro
# • Alguns volumes só existem após uso efetivo
# ---------------------------------------------------------------------------
VOLUMES_TO_CHECK=(
    "${USER_HOME}/.cache:Cache geral (Puppeteer, npm, etc.)"
    "${USER_HOME}/.npm:npm packages"
    "${USER_HOME}/.pm2:PM2 runtime state"
    "${USER_HOME}/.config:Configuração do usuário"
    "${USER_HOME}/.vscode-server:VS Code Server"
    "${USER_HOME}-history:Histórico de shell"
)

# Salvaguarda defensiva
[ "${#VOLUMES_TO_CHECK[@]}" -gt 0 ] || VOLUMES_TO_CHECK=()

for vol_entry in "${VOLUMES_TO_CHECK[@]}"; do
    IFS=':' read -r vol_path vol_desc <<< "${vol_entry}"

    if [ -d "${vol_path}" ]; then
        vol_size="$(dir_size_snapshot "${vol_path}")"
        printf "  ✅ %-32s %10s\n" "${vol_desc}" "${vol_size}"
    else
        printf "  ⚠️  %-32s %10s\n" "${vol_desc}" "(ausente)"
    fi
done

echo ""

# =============================================================================
# PHASE 10.1 — DISK USAGE (SNAPSHOT PASSIVO)
# CANONICAL v5.7.1
#
# CONTRATO:
#   • Apenas leitura
#   • Sem inferência causal
#   • Sem correção automática
# =============================================================================

info "Espaço em disco (snapshot):"

# Usa última linha para evitar variações de locale/header
DISK_USAGE="$(df -h / 2> /dev/null | awk 'END {print $5}' || echo '?%')"
DISK_AVAIL="$(df -h / 2> /dev/null | awk 'END {print $4}' || echo '?')"

DISK_USAGE_NUM="${DISK_USAGE%\%}"

if [ "${DISK_USAGE_NUM}" -gt 90 ] 2> /dev/null; then
    warn "Uso de disco: ${DISK_USAGE} (${DISK_AVAIL} disponível) — CRÍTICO"
    warn "→ Ação manual sugerida: make clean (logs/cache)"
elif [ "${DISK_USAGE_NUM}" -gt 80 ] 2> /dev/null; then
    warn "Uso de disco: ${DISK_USAGE} (${DISK_AVAIL} disponível) — ALTO"
else
    ok "Uso de disco: ${DISK_USAGE} (${DISK_AVAIL} disponível)"
fi

echo ""

# =============================================================================
# PHASE 11 — DOCUMENTAÇÃO VIVA (MAPA DE PORTAS & FRONTEIRAS)
# CANONICAL v5.7.1
#
# CONTRATO (INVIOLÁVEL):
#   • Documentação PURA (read-only)
#   • NÃO documenta estado
#   • NÃO testa conectividade
#   • NÃO executa lógica
#
# FINALIDADE:
#   • Tornar explícitos os contratos de endereçamento
#   • Fixar fronteiras entre container, host e debug
#   • Eliminar ambiguidade topológica para humanos e agentes
#
# TOPOLOGIA CANÔNICA (RESUMO):
#   Puppeteer → localhost:9224 (Proxy no container)
#              → host.docker.internal:9225 (Chrome no Windows)
# =============================================================================

info "Mapa de portas (contratos arquiteturais):"
echo ""

# ---------------------------------------------------------------------------
# Interface Humana
# ---------------------------------------------------------------------------
echo "  UI Humana:"
echo "    3008  → Dashboard Principal (HTTP + Socket.io + API)"
echo ""

# ---------------------------------------------------------------------------
# Infraestrutura Crítica
#
# Nota:
# • Containers NUNCA acessam 9225 diretamente
# • 9224 é a ÚNICA ponte autorizada
# ---------------------------------------------------------------------------
echo "  Infraestrutura:"
echo "    9224  → Chrome Proxy Service (container)"
echo "             └─ Frontend do Puppeteer"
echo "             └─ Encaminha para Chrome Windows"
echo ""
echo "    9225  → Chrome Real (Windows host)"
echo "             └─ Remote Debugging (CDP)"
echo "             └─ FUNDAMENTAL para operações LLM"
echo "             └─ Inicialização manual: START-CHROME-SIMPLE.bat"
echo ""

# ---------------------------------------------------------------------------
# Debug (Opt-in, não produtivo)
# ---------------------------------------------------------------------------
echo "  Debug (opt-in):"
echo "    9229  → Node.js Debug (agente-gpt --inspect)"
echo "    9230  → Node.js Debug (dashboard-web --inspect)"
echo ""

# ---------------------------------------------------------------------------
# Rede interna não-forwarded
# ---------------------------------------------------------------------------
echo "  Rede interna do container (não-forwarded):"
echo "    53    → dnsmasq local em 127.0.0.1:53 quando habilitado"
echo "             └─ Gerenciado por local-dns-cache.sh"
echo "    3128  → Proxy HTTP CONNECT local para Copilot, opt-in/desligado por padrão"
echo ""

# ---------------------------------------------------------------------------
# Fonte de Verdade
# ---------------------------------------------------------------------------
echo "  Fonte de verdade:"
echo "    devcontainer.json → forwardPorts"
echo ""

# =============================================================================
# PHASE 12 — QUICK TIPS (ALWAYS)
# CANONICAL v5.7.1
#
# CONTRATO (INVIOLÁVEL):
#   • Quick Start Guide COMPLETO apenas no PRIMEIRO attach (PHASE 7)
#   • Quick Tips RESUMIDOS em todos os attaches subsequentes
#   • Nunca executa comandos
#   • Nunca bloqueia
#   • Estritamente informativo (UX)
#
# OBJETIVO:
#   • Reorientar rapidamente o operador
#   • Reduzir fricção cognitiva
#   • Evitar leitura desnecessária de documentação
# =============================================================================

if [ "${IS_FIRST_ATTACH}" = true ]; then
    echo ""

    printf "%b\n" "${GREEN}👋 Bem-vindo!${NC}"
    printf "%b\n" "${GREEN}Este é o primeiro attach neste DevContainer.${NC}"
    echo ""

    info "Natureza deste ambiente:"
    printf "  • %-20s %s\n" "Tipo:" "Ambiente de desenvolvimento (DevContainer)"
    printf "  • %-20s %s\n" "Automação:" "Nenhuma ação automática no attach"
    printf "  • %-20s %s\n" "Segurança:" "Nenhuma modificação estrutural foi realizada"
    printf "  • %-20s %s\n" "Controle:" "Toda ação depende de decisão explícita sua"
    echo ""

    info "Próximos passos sugeridos (opcionais, execução manual):"
    printf "  • %-14s → %s\n" "make help" "listar comandos disponíveis no projeto"
    printf "  • %-14s → %s\n" "make info" "exibir informações detalhadas do ambiente"
    printf "  • %-14s → %s\n" "make health" "executar verificações de saúde"
    printf "  • %-14s → %s\n" "make start" "iniciar o sistema quando fizer sentido"
    echo ""

    info "Documentação:"
    echo "  • Arquitetura: DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md"
    echo "  • Chrome Proxy: DOCUMENTAÇÃO/ARQUITETURA/CONNECTION_ARCHITECTURE/"
    echo "  • Onboarding: .github/copilot-instructions.md"
    echo "  • Comandos: make help"
    echo ""
else
    # Quick tips resumidos (attaches subsequentes)
    echo ""
    info "Quick tips:"
    echo "  • Iniciar sistema: make start"
    echo "  • Ver logs: make logs-follow"
    echo "  • Healthcheck: make health"
    echo "  • Rede atual: npm run network:summary"
    echo "  • Doctor rede: npm run network:doctor"
    echo "  • Documentação: DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md"
    echo ""
fi

# =============================================================================
# FINAL BANNER
# CANONICAL v5.7.1
# =============================================================================

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  ✅ DevContainer Pronto (v${SCRIPT_VERSION})                        ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "💡 Importante sobre Chrome:"
echo "   • Chrome externo (Windows) é FUNDAMENTAL para operações LLM"
echo "   • NÃO precisa estar rodando durante attach ou boot"
echo "   • Será iniciado sob demanda quando necessário"
echo "   • Comando manual: START-CHROME-SIMPLE.bat (Windows host)"
echo ""

# =============================================================================
# ENCERRAMENTO SEMÂNTICO — ATTACH COMPLETO
# CANONICAL v5.7.1
# =============================================================================

printf "%b\n" "${BLUE}──────────────────────────────────────────────────────────────${NC}"
ok "Ambiente pronto para uso."
info "Attach concluído com sucesso."
info "Nenhuma ação automática, destrutiva ou estrutural foi executada."
printf "%b\n" "${BLUE}──────────────────────────────────────────────────────────────${NC}"

echo ""

# =============================================================================
# FIM DO post-attach.sh
# =============================================================================

exit 0
