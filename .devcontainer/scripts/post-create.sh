#!/usr/bin/env bash
# =============================================================================
# post-create.sh — Inicialização Estrutural do DevContainer (CANÔNICO)
#
# Version: v1.2.2 (toolchain/control-plane sync + structural audit hardening)
#
# PRINCÍPIO:
#   Este script NÃO é conveniência de setup. É verificação estrutural.
#   Ele executa validações, auditorias e instrumentação mínima — com fail-fast
#   estratificado e idempotência por container.
#
# COMPATIBILIDADE:
#   - Bash 5+ (Debian Bookworm OK)
#   - Shell hardening: set -Eeuo pipefail
#   - Sem leitura interativa de stdin
#
# GARANTIAS (blindagens principais):
#   - Re-exec em bash se invocado por sh/posix inadvertido
#   - Logger robusto SEM process substitution (sem `>(...)`)
#     (usa coprocess/pipe; evita o erro “token inesperado '('”)
#   - Trap robusto (ERR + EXIT) com snapshot de ENV e preservação de marker
#   - Sem chown recursivo de workspace (proibido em bind-mount)
#   - Auditoria de volumes sem criação implícita (exceto /tmp e log dir; history é UX)
#
# CONTRATOS CANÔNICOS:
#   • Executado como usuário canônico ('node') por padrão
#   • Idempotente por container (reentry aborta com exit 0)
#   • Reexecução somente por sinal explícito (REEXECUTE_POST_CREATE=true)
#     ou por recovery automático (IN_PROGRESS_MARKER preservado em erro)
#   • Fail-fast absoluto para variáveis estruturais (ENV)
#   • Infraestrutura: FATAL em production; WARNING em development/test
#   • Chrome externo é fundamental para operação, mas ausência no boot é normal
#
# REFERÊNCIAS:
#   • .devcontainer/ENV_ANALYSIS_V6.md
#   • .devcontainer/TROUBLESHOOTING_SSH.md
#
# CHANGELOG v1.0.2:
#   - Normaliza LF para Linux/WSL2 e mantém compatibilidade Bash 5+.
#   - Corrige bug crítico do logger com coprocess/tee: redirecionamento agora
#     duplica o file descriptor correto em vez de criar arquivo chamado pelo FD.
#   - Corrige validação awk de artefatos NSS que podia mascarar registros
#     inválidos por causa de END { exit 0 }.
#   - Adiciona CLI read-only (--help/--version) para validação rápida.
#   - Adiciona auditoria estática passiva dos hooks/scripts de rede atualizados.
#   - Sincroniza manifesto estrutural com post-start/post-attach e scripts
#     network: local-dns-cache, github-api-route-fix, manager, advisor e proxy.
#   - Hardening de /dev/tcp, hostname/porta, logger cleanup, env/log sanitization
#     e substituição de padrões A && B || C sensíveis a ShellCheck SC2015.
#
# CHANGELOG v1.0.3:
#   - Corrige ShellCheck SC2016 nos probes /dev/tcp do Chrome/Proxy sem usar
#     suppression: os probes agora passam por helper validado e command string
#     construída somente após saneamento host/porta.
#   - Torna o re-exec inicial POSIX-safe quando alguém invoca via sh.
#   - Remove padrões diagnósticos A && B || C restantes em deep audit.
#   - Endurece restauração/fechamento do logger coprocess com validação de FD.
#   - Fortalece audit_mounts contra regex injection em project_root/username.
#   - Troca o probe de rede observacional de google.com para api.github.com,
#     coerente com a arquitetura GitHub/Copilot-first.
#
# CHANGELOG v1.0.4:
#   - Sincroniza a auditoria estrutural com post-start v2.8.0, post-attach
#     v5.7.0, github-api-route-fix v1.8.4, local-copilot-proxy v1.2.2
#     e github-copilot-network-manager v1.5.0.
#   - Adiciona capability audit passivo para dependências de rede/benchmark
#     sem instalar pacotes e sem executar serviços.
#   - Adiciona auditoria de endpoint registry e artifacts de benchmark,
#     comparison e recommendation que serão consumidos por post-start/post-attach.
#   - Endurece a geração de grupos NSS com fallback obrigatório do grupo
#     primário, evitando group file vazio em imagens mínimas.
#   - Torna a validação inicial de LD_PRELOAD best-effort para qualquer valor,
#     não apenas quando vazio.
#   - Opcionalmente registra shellcheck quando disponível, sem transformar a
#     ausência da ferramenta em falha estrutural.
#
# CHANGELOG v1.1.0:
#   - Sincroniza o gate estrutural com post-start v2.8.1, post-attach v5.7.1,
#     github-api-route-fix v1.8.6, local-dns-cache v1.5.3,
#     local-copilot-proxy v1.2.3, github-copilot-network-manager v1.5.3,
#     copilot-route-advisor v1.0.1, nss-gatekeeper v2.1.2 e endpoint registry
#     v1.1.0.
#   - Promove o post-create a fonte estrutural de baseline para a jornada longa:
#     gera matriz de versões, matriz de capacidades, baseline de política ENV,
#     inventário de artifacts e manifesto atômico enriquecido.
#   - Endurece auditoria do endpoint registry: exige formato TSV canônico de
#     5 campos, conta linhas ruins e preserva status/freshness no manifesto.
#   - Separa mismatch de versão, ausência de package/Makefile e artifacts
#     runtime ainda ausentes como DEGRADED/advisory, sem mascarar falhas
#     estruturais reais.
#   - Mantém proibição de benchmarks longos, serviços de rede, mutações de
#     /etc/hosts e mutações de /etc/resolv.conf durante post-create.
#
# CHANGELOG v1.2.0:
#   - Sincroniza o post-create com devcontainer.json v5.9.0 e Dockerfile v1.5.0.
#   - Atualiza matriz canônica para post-start v3.0.2, post-attach v5.9.0,
#     healthcheck v3.0.0, sync-local-auth v2.0.0, network-control-plane-state
#     v1.0.0, local-dns-cache v1.8.0, github-api-route-fix v1.9.1,
#     github-copilot-network-manager v1.6.1, local-copilot-proxy v1.3.1,
#     copilot-route-advisor v1.1.0 e endpoint registry v1.2.0.
#   - Corrige drift do caminho canônico do endpoint registry para
#     .devcontainer/scripts/network/endpoints.github-copilot.tsv, com fallback
#     legado apenas quando o arquivo canônico não existir.
#   - Adiciona auditoria estrutural passiva do agregador
#     network-control-plane-state.sh e dos artifacts /tmp/devcontainer-network-control-plane.*.
#   - Adiciona artifacts próprios do post-create em /tmp/devcontainer-post-create.*
#     para leitura posterior por post-start/post-attach/control-plane.
#   - Fortalece version_status com normalização de prefixo v, evitando falsos
#     mismatches entre 1.2.0 e v1.2.0.
#   - Amplia auditoria de registry: campos TSV, HTTPS, ausência de wildcard em
#     linhas ativas, unicidade de URL/id e códigos HTTP esperados.
#   - Expande baseline de política ENV para DNS default-on v1.8.0, split Docker
#     embedded DNS, warmup bounded, action summaries e control-plane passivo.
#   - Mantém post-create estritamente estrutural: não inicia dnsmasq/proxy, não
#     aplica route-fix, não altera /etc/hosts, não altera /etc/resolv.conf e não
#     executa benchmark.
# CHANGELOG v1.2.1:
#   - Corrige ShellCheck SC2034 reportado no VS Code para HEALTH_REPORT_FILE,
#     HEALTH_EVENTS_FILE e SYNC_LOCAL_AUTH_REPORT_FILE usando esses artifacts
#     no inventário runtime, no manifesto e nos summaries próprios.
#   - Completa a matriz de artifacts de healthcheck e sync-local-auth, evitando
#     drift entre variáveis declaradas, relatórios TSV e manifesto estrutural.
#   - Adiciona status estrutural derivado para diferenciar ready-ok de
#     ready-degraded sem quebrar o contrato de post-create.
#   - Endurece os artifacts próprios do post-create com referências cruzadas
#     para health/report/events e sync-local-auth/report.
#
# CHANGELOG v1.2.2:
#   - Sincroniza a matriz estrutural com package.json v1.1.4, Makefile v4.4.0
#     e network-control-plane-state.sh v1.1.0.
#   - Corrige o caminho padrão do Dockerfile para .devcontainer/Dockerfile,
#     mantendo fallback para Dockerfile na raiz apenas quando necessário.
#   - Endurece detecção de versão do Makefile para reconhecer comentários
#     canônicos como "Versão: 4.4.0" e linhas Makefile v4.4.0.
#   - Remove helper morto de readiness simples e evita ruído ShellCheck.
#   - Adiciona auditoria explícita de scripts npm e targets Make recém-criados
#     para network:state/control-plane, sem executar probes nem benchmarks.
#   - Expande summary/report/manifesto com expected/detected/status de
#     package, Makefile e network-control-plane.
#
# =============================================================================

# =============================================================================
# LAYER 0 — Helpers (sem efeitos colaterais ao "source")
# =============================================================================

# Se invocado por /bin/sh ou modo não-bash, re-exec em bash (blindagem máxima).
if [ -z "${BASH_VERSION:-}" ]; then
    exec /usr/bin/env bash "$0" "$@"
fi

# warn() mínimo (será substituído por logger completo na execução direta)
warn() { echo "[WARN] $*" >&2; }

# cria diretório idempotente (silencioso)
ensure_dir() {
    local dir="${1:-}"
    [[ -z "${dir}" ]] && return 0
    mkdir -p "${dir}" 2> /dev/null || true
}

# wrapper para chown seguro
safe_chown() { chown "$@" 2> /dev/null || true; }

# validação leve de LD_PRELOAD (informativa)
validate_ld_preload() {
    local val="${1:-}"
    if [[ -z "${val}" ]]; then
        echo "⚠️  [post-create] LD_PRELOAD is empty; NSS may not activate" >&2
        return 1
    fi
    if ((${#val} > 4096)); then
        echo "⚠️  [post-create] LD_PRELOAD length ${#val} exceeds kernel limit; may be truncated" >&2
    fi
    return 0
}

sanitize_oneline() {
    # Terminal/log safe one-line rendering. It does not evaluate content.
    printf '%s' "${1:-}" | tr '\n\r\t' '   ' | sed 's/[[:cntrl:]]//g' 2> /dev/null || true
}

is_port() {
    local p="${1:-}"
    [[ "${p}" =~ ^[0-9]+$ ]] && ((p >= 1 && p <= 65535))
}

is_tcp_probe_host_token() {
    local host="${1:-}"
    [[ -n "${host}" && ${#host} -le 253 ]] || return 1
    # Conservative: literal hostnames/IPv4/localhost/host.docker.internal.
    # Avoid shell metacharacters because this token is used by Bash /dev/tcp.
    [[ "${host}" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
    [[ "${host}" != .* && "${host}" != *..* ]] || return 1
    return 0
}

regex_escape_ere() {
    # Escape a string for safe use inside grep -E / awk ERE contexts.
    printf '%s' "${1:-}" | sed -e 's/[][\\.^$*+?()|{}]/\\&/g' 2> /dev/null || true
}

tcp_probe_with_timeout() {
    local seconds="${1:-2}" host="${2:-}" port="${3:-}"
    is_port "${seconds}" || seconds=2
    is_tcp_probe_host_token "${host}" || return 2
    is_port "${port}" || return 2
    command -v timeout > /dev/null 2>&1 || return 127

    # Host and port are strictly validated before being interpolated. Bash needs
    # the /dev/tcp path in the inner shell command so it can apply the special
    # redirection semantics itself.
    timeout "${seconds}" bash -c ": > /dev/tcp/${host}/${port}" 2> /dev/null
}

# check_chown_contract <path> <current_uid>
# Emite warning se path pertence a outro UID (chown recursivo proibido).
check_chown_contract() {
    local path="${1:-}" current_uid="${2:-}"
    local owner="unknown"

    [[ -z "${path}" || -z "${current_uid}" ]] && return 0
    command -v stat > /dev/null 2>&1 || return 0

    if stat --version > /dev/null 2>&1; then
        owner="$(stat -c '%u' "${path}" 2> /dev/null || echo unknown)"
    else
        owner="$(stat -f '%u' "${path}" 2> /dev/null || echo unknown)"
    fi

    if [[ -n "${owner}" && "${owner}" != "${current_uid}" && "${owner}" != "unknown" ]]; then
        printf '[WARN] workspace root (%s) pertence a UID %s; chown recursivo é proibido.\n' \
            "${path}" "${owner}" >&2
    fi
}

# audit_mounts <project_root> <current_user>
audit_mounts() {
    local proj="${1:-}" user="${2:-}"
    echo -e "\n[2. Mount Analysis & Filesystem Context]"

    if ! command -v mount > /dev/null 2>&1; then
        echo "mount command not available"
        if command -v findmnt > /dev/null 2>&1; then
            findmnt --noheadings --target "${proj:-/workspaces}" 2> /dev/null || true
        fi
    elif command -v mount > /dev/null 2>&1; then
        local esc_project esc_user
        esc_project="$(regex_escape_ere "${proj}")"
        esc_user="$(regex_escape_ere "${user:-unknown}")"
        if ! mount 2> /dev/null \
            | grep -E "(${esc_project}|/home/${esc_user})" 2> /dev/null \
            | column -t 2> /dev/null; then
            echo "Mount information unavailable or filtered."
        fi
    else
        echo "mount/findmnt indisponível"
    fi
}

# verifica libnss_wrapper; falha se ausente
check_nss_library() {
    local found="false" candidate="" arch=""

    # Caminho canônico usado pelos demais hooks/network scripts.
    candidate="${DEVCONTAINER_NSS_WRAPPER_LIB:-/usr/local/lib/devcontainer/libnss_wrapper.so}"
    if [[ -n "${candidate}" && -r "${candidate}" ]]; then
        export DEVCONTAINER_NSS_WRAPPER_LIB_EFFECTIVE="${candidate}"
        return 0
    fi

    # ldconfig é o mais robusto quando disponível.
    if command -v ldconfig > /dev/null 2>&1 && command -v awk > /dev/null 2>&1; then
        candidate="$(ldconfig -p 2> /dev/null | awk '/libnss_wrapper\.so/{print $NF; exit}' || true)"
        if [[ -n "${candidate}" && -r "${candidate}" ]]; then
            found="true"
        fi
    fi

    if [[ "${found}" != "true" ]]; then
        for candidate in \
            "/usr/local/lib/devcontainer/libnss_wrapper.so" \
            "/usr/lib/libnss_wrapper.so" \
            "/usr/lib/x86_64-linux-gnu/libnss_wrapper.so" \
            "/usr/lib/aarch64-linux-gnu/libnss_wrapper.so"; do
            if [[ -r "${candidate}" ]]; then
                found="true"
                break
            fi
        done
    fi

    if [[ "${found}" != "true" ]] && command -v uname > /dev/null 2>&1; then
        arch="$(uname -m 2> /dev/null || true)"
        candidate="/usr/lib/${arch}-linux-gnu/libnss_wrapper.so"
        if [[ -n "${arch}" && -r "${candidate}" ]]; then
            found="true"
        fi
    fi

    if [[ "${found}" == "true" ]]; then
        export DEVCONTAINER_NSS_WRAPPER_LIB_EFFECTIVE="${candidate}"
        return 0
    fi

    echo "🔴 [post-create] libnss_wrapper.so não encontrado" >&2
    echo "   instale libnss-wrapper ou rebuild o container" >&2
    return 1
}

script_declared_version() {
    local script="${1:-}"
    [[ -r "${script}" ]] || {
        printf 'missing'
        return 0
    }
    awk '
    /^# Version:/ {
        gsub(/^# Version:[[:space:]]*/, "");
        split($0, parts, /[[:space:]]+/);
        print parts[1]; found=1; exit
    }
    /^# CANONICAL v/ {
        gsub(/^# CANONICAL[[:space:]]*/, "");
        split($0, parts, /[[:space:]]+/);
        print parts[1]; found=1; exit
    }
    /^# .*v[0-9]+[.][0-9]+/ {
        line=$0;
        sub(/^# /, "", line);
        if (match(line, /v[0-9]+([.][0-9]+)+/)) {
            print substr(line, RSTART, RLENGTH); found=1; exit
        }
    }
    /^[[:space:]]*SCRIPT_VERSION=/ {
        gsub(/^[^=]*=|"/, "");
        split($0, parts, /[[:space:]]+/);
        print parts[1]; found=1; exit
    }
    END {if (!found) print "unknown"}
  ' "${script}" 2> /dev/null | head -n 1
}

script_bash_syntax_ok() {
    local script="${1:-}"
    [[ -r "${script}" ]] || return 2
    if command -v timeout > /dev/null 2>&1; then
        timeout 10 bash -n "${script}" > /dev/null 2>&1 || return $?
    else
        bash -n "${script}" > /dev/null 2>&1 || return $?
    fi
    return 0
}

script_shellcheck_status() {
    local script="${1:-}" rc
    [[ -r "${script}" ]] || {
        printf 'not-run:missing'
        return 0
    }
    if ! command -v shellcheck > /dev/null 2>&1; then
        printf 'not-installed'
        return 0
    fi
    if command -v timeout > /dev/null 2>&1; then
        timeout 30 shellcheck "${script}" > /dev/null 2>&1
        rc=$?
    else
        shellcheck "${script}" > /dev/null 2>&1
        rc=$?
    fi
    if [[ "${rc}" -eq 0 ]]; then
        printf 'ok'
    else
        printf 'failed:%s' "${rc}"
    fi
}

file_mtime_epoch() {
    local target="${1:-}"
    [[ -n "${target}" && -e "${target}" ]] || {
        printf '0'
        return 0
    }
    stat -c '%Y' "${target}" 2> /dev/null || printf '0'
}

file_size_bytes() {
    local target="${1:-}"
    [[ -n "${target}" && -e "${target}" ]] || {
        printf '0'
        return 0
    }
    stat -c '%s' "${target}" 2> /dev/null || printf '0'
}

artifact_readiness_status_extended() {
    local path="${1:-}" max_age="${2:-86400}" epoch now age size
    [[ -n "${path}" ]] || {
        printf 'unknown'
        return 0
    }
    if [[ ! -e "${path}" ]]; then
        printf 'absent'
        return 0
    fi
    if [[ ! -s "${path}" ]]; then
        printf 'empty'
        return 0
    fi
    epoch="$(file_mtime_epoch "${path}")"
    now="$(date '+%s' 2> /dev/null || printf '0')"
    size="$(file_size_bytes "${path}")"
    if [[ "${epoch}" =~ ^[0-9]+$ && "${now}" =~ ^[0-9]+$ && "${max_age}" =~ ^[0-9]+$ && "${epoch}" -gt 0 && "${now}" -ge "${epoch}" ]]; then
        age=$((now - epoch))
        if ((age > max_age)); then
            printf 'present-stale:%s:%s' "${age}" "${size}"
        else
            printf 'present-fresh:%s:%s' "${age}" "${size}"
        fi
    else
        printf 'present-unknown-age:%s' "${size}"
    fi
}

count_tsv_registry_rows() {
    local file="${1:-}"
    [[ -r "${file}" ]] || {
        printf '0 0 0 0 0'
        return 0
    }
    awk -F '\t' '
        /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
        {
            total++
            bad_line=0
            if (NF != 5) bad_line=1
            if ($1 !~ /^https:\/\//) bad_line=1
            if ($1 ~ /[*]/) wildcard++
            if ($2 == "" || $3 == "" || $4 == "" || $5 == "") bad_line=1
            if ($5 !~ /^[0-9][0-9][0-9]([|][0-9][0-9][0-9])*$/) bad_line=1
            if (seen_url[$1]++) duplicate++
            if (seen_id[$2]++) duplicate++
            if (bad_line) bad++
        }
        END { print total+0, bad+0, wildcard+0, duplicate+0, (bad+wildcard+duplicate)+0 }
    ' "${file}" 2> /dev/null || printf '0 0 0 0 0'
}

registry_status() {
    local file="${1:-}" counts rows bad wildcard duplicate total_bad
    [[ -n "${file}" ]] || {
        printf 'unknown'
        return 0
    }
    if [[ ! -r "${file}" ]]; then
        printf 'absent'
        return 0
    fi
    counts="$(count_tsv_registry_rows "${file}")"
    IFS=' ' read -r rows bad wildcard duplicate total_bad <<< "${counts}"
    if [[ "${rows}" =~ ^[0-9]+$ && "${total_bad}" =~ ^[0-9]+$ && "${rows}" -gt 0 && "${total_bad}" -eq 0 ]]; then
        printf 'ok'
    else
        printf 'degraded'
    fi
}

registry_row_count() {
    local file="${1:-}" counts rows
    counts="$(count_tsv_registry_rows "${file}")"
    IFS=' ' read -r rows _ <<< "${counts}"
    printf '%s' "${rows:-0}"
}

registry_bad_row_count() {
    local file="${1:-}" counts _rows _bad _wild _dup total_bad
    counts="$(count_tsv_registry_rows "${file}")"
    IFS=' ' read -r _rows _bad _wild _dup total_bad <<< "${counts}"
    printf '%s' "${total_bad:-0}"
}

registry_diagnostics() {
    local file="${1:-}" counts rows bad wildcard duplicate total_bad
    counts="$(count_tsv_registry_rows "${file}")"
    IFS=' ' read -r rows bad wildcard duplicate total_bad <<< "${counts}"
    printf 'rows=%s,bad=%s,wildcard=%s,duplicate=%s,total_bad=%s' "${rows:-0}" "${bad:-0}" "${wildcard:-0}" "${duplicate:-0}" "${total_bad:-0}"
}

normalize_version_token() {
    local value="${1:-}"
    value="${value#v}"
    value="${value#V}"
    printf '%s' "${value}"
}

version_status() {
    local detected="${1:-unknown}" expected="${2:-}" detected_norm expected_norm
    if [[ -z "${expected}" || "${expected}" == "unknown" ]]; then
        printf 'not-pinned'
    elif [[ "${detected}" == "missing" ]]; then
        printf 'missing'
    elif [[ "${detected}" == "unknown" || -z "${detected}" ]]; then
        printf 'unknown'
    else
        detected_norm="$(normalize_version_token "${detected}")"
        expected_norm="$(normalize_version_token "${expected}")"
        if [[ "${detected_norm}" == "${expected_norm}" ]]; then
            printf 'ok'
        else
            printf 'mismatch'
        fi
    fi
}

capability_status() {
    local cmd="${1:-}"
    if [[ -z "${cmd}" ]]; then
        printf 'unknown'
    elif command -v "${cmd}" > /dev/null 2>&1; then
        printf 'present'
    else
        printf 'missing'
    fi
}

json_manifest_version() {
    local file="${1:-}"
    [[ -r "${file}" ]] || {
        printf 'missing'
        return 0
    }
    if command -v node > /dev/null 2>&1; then
        node -e 'try { const fs = require("node:fs"); const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); console.log(p.version || "unknown"); } catch { console.log("unknown"); }' "${file}" 2> /dev/null || printf 'unknown'
        return 0
    fi
    if command -v jq > /dev/null 2>&1; then
        jq -r '.version // "unknown"' "${file}" 2> /dev/null || printf 'unknown'
        return 0
    fi
    printf 'unknown'
}

makefile_declared_version() {
    local file="${1:-}"
    [[ -r "${file}" ]] || {
        printf 'missing'
        return 0
    }
    awk '
        /^[[:space:]]*(MAKEFILE_VERSION|VERSION)[[:space:]]*[:?+]?=/ {
            sub(/^[^=]*=[[:space:]]*/, "", $0);
            gsub(/["'"'"' ]/, "", $0);
            print;
            found=1;
            exit
        }
        /^#[[:space:]]*Vers[^:]*:[[:space:]]*/ {
            sub(/^#[[:space:]]*Vers[^:]*:[[:space:]]*/, "", $0);
            split($0, a, /[[:space:]]+/);
            print a[1];
            found=1;
            exit
        }
        /^#.*Makefile[[:space:]]+v/ {
            sub(/^.*Makefile[[:space:]]+v/, "v", $0);
            split($0, a, /[[:space:]]+/);
            print a[1];
            found=1;
            exit
        }
        /Makefile[[:space:]]+v[0-9]+[.][0-9]+/ {
            if (match($0, /v[0-9]+([.][0-9]+)+/)) {
                print substr($0, RSTART, RLENGTH);
                found=1;
                exit
            }
        }
        END { if (!found) print "unknown" }
    ' "${file}" 2> /dev/null | head -n 1
}

devcontainer_declared_version() {
    local file="${1:-}"
    [[ -r "${file}" ]] || {
        printf 'missing'
        return 0
    }
    if command -v node > /dev/null 2>&1; then
        node - "${file}" << 'NODE' 2> /dev/null || true
const fs = require('node:fs');
const file = process.argv[2];
let text = fs.readFileSync(file, 'utf8');
text = text.replace(/^\uFEFF/, '');
text = text.replace(/\/\*[\s\S]*?\*\//g, '');
text = text.replace(/(^|[^:])\/\/.*$/gm, '$1');
const m = text.match(/"DEVCONTAINER_VERSION"\s*:\s*"([^"]+)"/);
process.stdout.write(m ? m[1] : 'unknown');
NODE
        return 0
    fi
    awk -F '"' '/"DEVCONTAINER_VERSION"[[:space:]]*:/ {print $4; found=1; exit} END {if (!found) print "unknown"}' "${file}" 2> /dev/null | head -n 1
}

dockerfile_declared_version() {
    local file="${1:-}"
    [[ -r "${file}" ]] || {
        printf 'missing'
        return 0
    }
    awk '
        /^[[:space:]]*ARG[[:space:]]+VERSION=/ {
            sub(/^[[:space:]]*ARG[[:space:]]+VERSION=/, "", $0);
            gsub(/["'"'"' ]/, "", $0);
            print; found=1; exit
        }
        /^# Dockerfile[[:space:]]+v/ {
            sub(/^# Dockerfile[[:space:]]+v/, "v", $0);
            split($0, a, /[[:space:]]+/); print a[1]; found=1; exit
        }
        END { if (!found) print "unknown" }
    ' "${file}" 2> /dev/null | head -n 1
}

package_script_exists() {
    local file="${1:-}" script="${2:-}"
    [[ -r "${file}" && -n "${script}" ]] || return 1
    if command -v node > /dev/null 2>&1; then
        node - "${file}" "${script}" << 'NODE' 2> /dev/null
const fs = require('node:fs');
const file = process.argv[2];
const key = process.argv[3];
try {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  process.exit(pkg && pkg.scripts && Object.prototype.hasOwnProperty.call(pkg.scripts, key) ? 0 : 1);
} catch {
  process.exit(2);
}
NODE
        return $?
    fi
    grep -q "\"${script}\"[[:space:]]*:" "${file}" 2> /dev/null
}

make_target_exists() {
    local file="${1:-}" target="${2:-}"
    [[ -r "${file}" && -n "${target}" ]] || return 1
    awk -v t="${target}" '
        $0 ~ "^[[:space:]]*" t ":[[:space:]]*($|[^=])" { found=1; exit }
        END { exit found ? 0 : 1 }
    ' "${file}" 2> /dev/null
}

# ---------------------------------------------------------------------------
# Guard: se o arquivo foi "sourceado", apenas exporta helpers e retorna.
# (Sem set -euo, sem traps, sem execução.)
# ---------------------------------------------------------------------------
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
    return 0
fi

case "${1:-}" in
    --version)
        printf '%s v%s\n' 'post-create.sh' '1.2.2'
        exit 0
        ;;
    --help)
        cat << 'EOF'
post-create.sh [--help] [--version]

Structural DevContainer initialization hook. Normal execution is controlled by
devcontainer.json postCreateCommand. This script is intentionally fail-fast for
structural contract violations and idempotent per container.
EOF
        exit 0
        ;;
esac

# =============================================================================
# LAYER 1 — Execução direta (hardening + traps)
# =============================================================================

set -Eeuo pipefail
IFS=$'\n\t'
set +o posix 2> /dev/null || true

# ---------------------------------------------------------------------------
# Identidade canônica do script (imutável)
# ---------------------------------------------------------------------------
SCRIPT_NAME="post-create.sh"
SCRIPT_VERSION="1.2.2"
readonly SCRIPT_NAME SCRIPT_VERSION

# Matriz canônica sincronizada com devcontainer.json v5.9.0 / Dockerfile v1.5.0.
EXPECTED_POST_CREATE_VERSION="v1.2.2"
EXPECTED_POST_START_VERSION="v3.0.2"
EXPECTED_POST_ATTACH_VERSION="v5.9.0"
EXPECTED_HEALTHCHECK_VERSION="v3.0.0"
EXPECTED_SYNC_LOCAL_AUTH_VERSION="v2.0.0"
EXPECTED_NSS_GATEKEEPER_VERSION="v2.1.2"
EXPECTED_LOCAL_DNS_VERSION="v1.8.0"
EXPECTED_GITHUB_ROUTE_VERSION="v1.9.1"
EXPECTED_COPILOT_MANAGER_VERSION="v1.6.1"
EXPECTED_COPILOT_ADVISOR_VERSION="v1.1.0"
EXPECTED_LOCAL_PROXY_VERSION="v1.3.1"
EXPECTED_NETWORK_CONTROL_PLANE_VERSION="v1.1.0"
EXPECTED_ENDPOINT_REGISTRY_VERSION="v1.2.0"
EXPECTED_PACKAGE_VERSION="v1.1.4"
EXPECTED_MAKEFILE_VERSION="v4.4.0"
EXPECTED_DEVCONTAINER_VERSION="v5.9.0"
EXPECTED_DOCKERFILE_VERSION="v1.5.0"
readonly EXPECTED_POST_CREATE_VERSION EXPECTED_POST_START_VERSION EXPECTED_POST_ATTACH_VERSION EXPECTED_HEALTHCHECK_VERSION EXPECTED_SYNC_LOCAL_AUTH_VERSION
readonly EXPECTED_NSS_GATEKEEPER_VERSION EXPECTED_LOCAL_DNS_VERSION EXPECTED_GITHUB_ROUTE_VERSION EXPECTED_COPILOT_MANAGER_VERSION EXPECTED_COPILOT_ADVISOR_VERSION EXPECTED_LOCAL_PROXY_VERSION
readonly EXPECTED_NETWORK_CONTROL_PLANE_VERSION EXPECTED_ENDPOINT_REGISTRY_VERSION EXPECTED_PACKAGE_VERSION EXPECTED_MAKEFILE_VERSION EXPECTED_DEVCONTAINER_VERSION EXPECTED_DOCKERFILE_VERSION

POST_CREATE_STATUS_FILE="${DEVCONTAINER_POST_CREATE_STATUS_FILE:-/tmp/devcontainer-post-create.status}"
POST_CREATE_SUMMARY_FILE="${DEVCONTAINER_POST_CREATE_SUMMARY_FILE:-/tmp/devcontainer-post-create.summary}"
POST_CREATE_REPORT_FILE="${DEVCONTAINER_POST_CREATE_REPORT_FILE:-/tmp/devcontainer-post-create.report}"
POST_CREATE_EVENTS_FILE="${DEVCONTAINER_POST_CREATE_EVENTS_FILE:-/tmp/devcontainer-post-create.events.tsv}"
readonly POST_CREATE_STATUS_FILE POST_CREATE_SUMMARY_FILE POST_CREATE_REPORT_FILE POST_CREATE_EVENTS_FILE

# ---------------------------------------------------------------------------
# Paths canônicos (o mais cedo possível, para suportar trap e logging)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd -P)"
DEVCONTAINER_DIR="${PROJECT_ROOT}/.devcontainer"
LOG_DIR="${DEVCONTAINER_DIR}/logs"
LOG_FILE="${LOG_DIR}/post-create.log"

readonly SCRIPT_DIR PROJECT_ROOT DEVCONTAINER_DIR

# ---------------------------------------------------------------------------
# Markers transacionais (definidos cedo para recovery em falha precoce)
# ---------------------------------------------------------------------------
IN_PROGRESS_MARKER="/tmp/post-create.in-progress"
COMPLETED_MARKER="/tmp/post-create.done"
readonly IN_PROGRESS_MARKER COMPLETED_MARKER

# ---------------------------------------------------------------------------
# Logging: blindagem sem process substitution (coprocess tee)
#   - evita `exec > >(tee ...)` e o erro “token inesperado '('”
# ---------------------------------------------------------------------------

# logger state
_LOG_FD=""
_LOG_PID=""

# garantir diretório de log; se falhar, fallback /tmp (não quebra bootstrap)
ensure_dir "${LOG_DIR}"
if [[ ! -d "${LOG_DIR}" || ! -w "${LOG_DIR}" ]]; then
    LOG_DIR="/tmp/devcontainer-logs"
    ensure_dir "${LOG_DIR}"
    LOG_FILE="${LOG_DIR}/post-create.log"
fi
readonly LOG_DIR LOG_FILE

# Registra o estado bruto herdado do ambiente antes de redirecionar stdout/stderr para o logger.
validate_ld_preload "${LD_PRELOAD:-}" || true

# Hash defensivo (best-effort)
SCRIPT_HASH="unknown"
if command -v sha256sum > /dev/null 2>&1 && [[ -r "${BASH_SOURCE[0]}" ]]; then
    SCRIPT_HASH="$(sha256sum "${BASH_SOURCE[0]}" 2> /dev/null | awk '{print $1}' || echo unknown)"
fi
readonly SCRIPT_HASH

# Rotação defensiva de logs (robusta; sem glob quebrando set -e)
if [[ -f "${LOG_FILE}" ]] && command -v stat > /dev/null 2>&1; then
    LOG_SIZE="$(stat -c%s "${LOG_FILE}" 2> /dev/null || echo 0)"
    if [[ "${LOG_SIZE:-0}" =~ ^[0-9]+$ ]] && ((LOG_SIZE > 2097152)); then
        ts="$(date -Is 2> /dev/null | tr ':' '-' || echo rotated)"
        mv "${LOG_FILE}" "${LOG_FILE}.${ts}.old" 2> /dev/null || true
        gzip -9 "${LOG_FILE}.${ts}.old" 2> /dev/null || true

        shopt -s nullglob
        archives=("${LOG_FILE}."*.old.gz)
        shopt -u nullglob
        if ((${#archives[@]} > 3)); then
            mapfile -t sorted < <(printf '%s\n' "${archives[@]}" | sort -r)
            for ((i = 3; i < ${#sorted[@]}; i++)); do
                rm -f "${sorted[$i]}" 2> /dev/null || true
            done
        fi
    fi
fi

# inicia tee como coprocess e redireciona stdout/stderr para ele
_start_logger() {
    # guarda stdout/stderr originais para fallback em caso extremo
    exec 9>&1 10>&2

    if command -v tee > /dev/null 2>&1; then
        # coproc evita process substitution
        coproc __POSTCREATE_LOGGER { tee -a "${LOG_FILE}"; }
        _LOG_PID="${__POSTCREATE_LOGGER_PID:-}"
        _LOG_FD="${__POSTCREATE_LOGGER[1]:-}"

        if [[ "${_LOG_FD}" =~ ^[0-9]+$ ]]; then
            # Duplicate the coprocess write FD correctly; redirecting to the
            # decimal FD string as a path would create/truncate an unintended file.
            eval "exec >&${_LOG_FD} 2>&1"
            return 0
        fi
    fi

    # fallback: arquivo apenas (ainda registra; mantém 9/10 para emergência)
    exec >> "${LOG_FILE}" 2>&1
    echo "[WARN] Logger degrade: tee/coprocess indisponível; log somente em arquivo: ${LOG_FILE}" >&2
    return 0
}

_stop_logger() {
    # best-effort; NÃO deve falhar sob set -e
    set +e
    set +o pipefail

    # Restore original stdout/stderr before closing the coprocess write FD.
    exec 1>&9 2>&10 || true

    if [[ "${_LOG_FD:-}" =~ ^[0-9]+$ ]]; then
        eval "exec ${_LOG_FD}>&-" || true
    fi
    if [[ "${_LOG_PID:-}" =~ ^[0-9]+$ ]]; then
        wait "${_LOG_PID}" 2> /dev/null || true
    fi

    exec 9>&- 10>&- || true
}

_start_logger

_ts() { date -Is 2> /dev/null || echo "unknown-time"; }

_blue=$'\e[34m'
_yellow=$'\e[33m'
_red=$'\e[31m'
_reset=$'\e[0m'

log() { echo -e "[${_blue}$(_ts)${_reset}] [${SCRIPT_NAME}] [pid=$$] ℹ️  $*"; }
warn() { echo -e "[${_yellow}$(_ts)${_reset}] [${SCRIPT_NAME}] [pid=$$] ⚠️  $*" >&2; }
error() { echo -e "[${_red}$(_ts)${_reset}] [${SCRIPT_NAME}] [pid=$$] ❌ $*" >&2; }

# Timestamp de início (atribui antes de readonly)
BOOT_START_TIME="$(date +%s 2> /dev/null || echo 0)"
readonly BOOT_START_TIME

log "Simbiose inicializada"
log "→ Script : ${SCRIPT_NAME}"
log "→ Versão : ${SCRIPT_VERSION}"
log "→ Hash   : ${SCRIPT_HASH:0:8}"
log "→ Root   : ${PROJECT_ROOT}"
log "→ Log    : ${LOG_FILE}"

# =============================================================================
# TRAPS — Diagnóstico + Recovery Marker + Logger Cleanup
# =============================================================================

_write_env_snapshot_on_error() {
    local exit_code="${1:-1}"
    local line_num="${2:-unknown}"
    local ts snapshot

    ts="$(date +%s 2> /dev/null || echo 0)"
    snapshot="${LOG_DIR:-/tmp}/env_error_snapshot_${ts}.txt"

    {
        echo "=== ENV SNAPSHOT AT ERROR ==="
        echo "Exit Code: ${exit_code}"
        echo "Line: ${line_num}"
        echo "Timestamp: $(date -Iseconds 2> /dev/null || echo unknown)"
        echo "Script: ${SCRIPT_NAME} v${SCRIPT_VERSION}"
        echo "Project Root: ${PROJECT_ROOT}"
        echo ""

        echo "[STRUCTURAL]"
        for var in NODE_ENV SERVER_MODE SERVER_AUTHORITY BROWSER_MODE; do
            printf "  %-25s = %s\n" "${var}" "${!var:-<UNSET>}"
        done

        echo ""
        echo "[INFRASTRUCTURE]"
        for var in SERVER_PORT CHROME_HOST CHROME_PORT CHROME_PROXY_PORT CHROME_PROXY_BIND HOST; do
            printf "  %-25s = %s\n" "${var}" "${!var:-<UNSET>}"
        done

        echo ""
        echo "[OPERATIONAL] (sample)"
        for var in LOG_LEVEL BROWSER_POOL_SIZE ALLOW_DEGRADED_MODE MOCK_CHROME; do
            printf "  %-25s = %s\n" "${var}" "${!var:-<UNSET>}"
        done
    } > "${snapshot}" 2>&1 || true
    chmod 600 "${snapshot}" 2> /dev/null || true

    echo "${snapshot}"
}

_on_err() {
    local exit_code=$?
    local line_num="${1:-${BASH_LINENO[0]:-unknown}}"

    # handler deve ser best-effort
    set +e
    set +o pipefail

    [[ "${exit_code}" -eq 0 ]] && return 0

    # garantir marker para REPLAY mesmo se falhar antes do Gatekeeper
    if [[ -n "${IN_PROGRESS_MARKER:-}" && ! -f "${IN_PROGRESS_MARKER}" ]]; then
        touch "${IN_PROGRESS_MARKER}" 2> /dev/null || true
    fi

    local snapshot
    snapshot="$(_write_env_snapshot_on_error "${exit_code}" "${line_num}")" || snapshot=""

    echo ""
    error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    error "FALHA NO POST-CREATE (EXIT CODE: ${exit_code})"
    error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    error "Linha aproximada: ${line_num}"
    error "Script: ${SCRIPT_NAME} v${SCRIPT_VERSION}"
    error ""
    error "AÇÃO AUTOMÁTICA:"
    error "  → IN_PROGRESS_MARKER mantido/criado para diagnóstico"
    error "  → Próxima execução entrará em modo REPLAY (recovery)"
    error ""
    error "AÇÕES DISPONÍVEIS:"
    error "  1. Rebuild container (via VS Code)"
    error "  2. Inspecionar logs: ${LOG_FILE}"
    error "  3. Forçar reexecução: REEXECUTE_POST_CREATE=true"
    error ""
    error "DIAGNÓSTICO RECOMENDADO:"
    error "  1. Verificar snapshot: ${snapshot:-<falhou>}"
    error "  2. Validar remoteEnv/runArgs em devcontainer.json"
    error "  3. Consultar: .devcontainer/ENV_ANALYSIS_V6.md"
    error "  4. SSH: .devcontainer/TROUBLESHOOTING_SSH.md"
    error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

_on_exit() {
    local exit_code=$?

    # Sempre: garantir que não deixamos recursos do logger pendurados
    _stop_logger

    # Não mexer em markers no EXIT: o commit transacional é feito no fluxo normal.
    # Em erro, o marker já foi preservado/criado em _on_err.
    return "${exit_code}"
}

trap '_on_err $LINENO' ERR
trap '_on_exit' EXIT

# =============================================================================
# SECTION 2 — Contrato de Identidade (Fail-fast)
# =============================================================================

EXPECTED_USER="${DEVCONTAINER_EXPECTED_USER:-node}"
readonly EXPECTED_USER

CURRENT_USER="$(id -un 2> /dev/null || echo unknown)"
CURRENT_UID="$(id -u 2> /dev/null || echo unknown)"
CURRENT_GID="$(id -g 2> /dev/null || echo unknown)"
CURRENT_GROUPS="$(id -Gn 2> /dev/null | tr ' ' ',' || echo unknown)"

# Fallback defensivo (antes de readonly)
if [[ "${CURRENT_USER}" == "unknown" ]]; then
    warn "Identidade não resolvida (UID=${CURRENT_UID}), usando 'node' como fallback."
    CURRENT_USER="node"
fi

readonly CURRENT_USER CURRENT_UID CURRENT_GID CURRENT_GROUPS

USER_HOME="${HOME:-/home/${CURRENT_USER}}"
HOME_DIR="${USER_HOME}"
readonly USER_HOME HOME_DIR

check_chown_contract "${PROJECT_ROOT}" "${CURRENT_UID}"

log "Identity Check:"
log "→ Esperado : ${EXPECTED_USER}"
log "→ Atual    : ${CURRENT_USER} (UID:${CURRENT_UID}, GID:${CURRENT_GID})"
log "→ Grupos   : ${CURRENT_GROUPS}"
log "→ HOME     : ${HOME_DIR}"

if [[ "${SKIP_IDENTITY_CHECK:-false}" == "true" ]]; then
    log "SKIP_IDENTITY_CHECK=true, pulando contrato de identidade"
else
    if [[ "${CURRENT_USER}" != "${EXPECTED_USER}" ]]; then
        error "CONTRATO DE IDENTIDADE VIOLADO (FATAL)"
        error "→ Usuário esperado : ${EXPECTED_USER}"
        error "→ Usuário detectado: ${CURRENT_USER}"
        error "→ UID/GID          : ${CURRENT_UID}/${CURRENT_GID}"
        error "→ Grupos           : ${CURRENT_GROUPS}"
        error "Ação corretiva obrigatória:"
        error "• Ajustar 'remoteUser' no devcontainer.json"
        error "• Rebuild COMPLETO do DevContainer"
        exit 1
    fi
fi

log "Identidade validada com sucesso."

# =============================================================================
# SECTION 3 — ENV Validation (Taxonomia v6.0, estratificada)
# =============================================================================

log "Validando variáveis de ambiente (modelo estratificado v6.0)..."
log "ENV source hint: remoteEnv (VS Code) + runArgs (--env-file) + defaults"

schema_vars() {
    local cat="${1:-}"
    if command -v jq > /dev/null 2>&1 && [[ -f "${PROJECT_ROOT}/.env.schema.json" ]]; then
        jq -r ".categories[\"${cat}\"].properties | keys[]" "${PROJECT_ROOT}/.env.schema.json" 2> /dev/null || true
    fi
    return 0
}

# carregar do schema, senão fallback
STRUCTURAL_ENV_VARS=()
INFRASTRUCTURE_ENV_VARS=()
OPERATIONAL_ENV_VARS=()

mapfile -t STRUCTURAL_ENV_VARS < <(schema_vars "STRUCTURAL")
mapfile -t INFRASTRUCTURE_ENV_VARS < <(schema_vars "INFRASTRUCTURE")
mapfile -t OPERATIONAL_ENV_VARS < <(schema_vars "OPERATIONAL")

if ((${#STRUCTURAL_ENV_VARS[@]} == 0)); then
    STRUCTURAL_ENV_VARS=(NODE_ENV SERVER_MODE SERVER_AUTHORITY BROWSER_MODE)
fi
if ((${#INFRASTRUCTURE_ENV_VARS[@]} == 0)); then
    INFRASTRUCTURE_ENV_VARS=(SERVER_PORT CHROME_HOST CHROME_PORT CHROME_PROXY_PORT CHROME_PROXY_BIND HOST)
fi
if ((${#OPERATIONAL_ENV_VARS[@]} == 0)); then
    OPERATIONAL_ENV_VARS=(
        BROWSER_POOL_SIZE ALLOCATION_STRATEGY HEALTH_CHECK_INTERVAL ALLOW_DEGRADED_MODE
        AUTO_RETRY_CHROME MAX_AUTO_RETRIES MAX_CONNECTION_ATTEMPTS CONNECTION_TIMEOUT
        LOG_LEVEL NERV_BUFFER_SIZE NERV_TELEMETRY NERV_INTEGRATION WS_IDLE_TIMEOUT_MS
        RAG_DB_DIR RAG_INDEX_DIR
    )
fi

readonly STRUCTURAL_ENV_VARS INFRASTRUCTURE_ENV_VARS OPERATIONAL_ENV_VARS

FEATURE_FLAG_ENV_VARS=(MOCK_CHROME PUPPETEER_LOCAL_LAUNCH_DISABLED FACTORY_VALIDATE_BOOT)
readonly FEATURE_FLAG_ENV_VARS

STRUCT_ERRORS=0
INFRA_ERRORS=0
INFRA_WARNINGS=0
OPER_WARNINGS=0
FLAG_INFO=0

case "${NODE_ENV:-development}" in
    production)
        INFRA_VALIDATION_MODE="FATAL"
        OPER_VALIDATION_MODE="WARNING"
        log "Modo de validação: NODE_ENV=production → INFRAESTRUTURA=FATAL"
        ;;
    test)
        INFRA_VALIDATION_MODE="WARNING"
        OPER_VALIDATION_MODE="INFO"
        log "Modo de validação: NODE_ENV=test → INFRAESTRUTURA=WARNING"
        ;;
    development | *)
        INFRA_VALIDATION_MODE="WARNING"
        OPER_VALIDATION_MODE="INFO"
        log "Modo de validação: NODE_ENV=development → INFRAESTRUTURA=WARNING"
        ;;
esac
readonly INFRA_VALIDATION_MODE OPER_VALIDATION_MODE

# 3.6 Structural (fatal)
for var in "${STRUCTURAL_ENV_VARS[@]}"; do
    value="${!var:-}"
    if [[ -z "${value}" ]]; then
        error "ENV ESTRUTURAL AUSENTE (FATAL): ${var}"
        STRUCT_ERRORS=$((STRUCT_ERRORS + 1))
    else
        log "ENV estrutural OK: ${var}=$(sanitize_oneline "${value}")"
    fi
done

# 3.7 Infrastructure (fatal em prod; warning em dev/test)
for var in "${INFRASTRUCTURE_ENV_VARS[@]}"; do
    value="${!var:-}"
    if [[ -z "${value}" ]]; then
        if [[ "${INFRA_VALIDATION_MODE}" == "FATAL" ]]; then
            error "ENV infraestrutura ausente (FATAL): ${var}"
            INFRA_ERRORS=$((INFRA_ERRORS + 1))
        else
            warn "ENV infraestrutura ausente (${INFRA_VALIDATION_MODE}): ${var}"
            INFRA_WARNINGS=$((INFRA_WARNINGS + 1))
        fi
    else
        log "ENV infraestrutura OK: ${var}=$(sanitize_oneline "${value}")"
    fi
done

# 3.8 NODE_ENV semântico (não-fatal)
if [[ -n "${NODE_ENV:-}" ]]; then
    case "${NODE_ENV}" in
        development | test | production) log "NODE_ENV semântico válido: ${NODE_ENV}" ;;
        *) warn "NODE_ENV fora do conjunto canônico: '${NODE_ENV}' (development|test|production)" ;;
    esac
fi

# 3.9 Operational (contextual)
for var in "${OPERATIONAL_ENV_VARS[@]}"; do
    value="${!var:-}"
    if [[ -z "${value}" ]]; then
        if [[ "${OPER_VALIDATION_MODE}" == "WARNING" ]]; then
            warn "ENV operacional ausente: ${var} (modo WARNING em NODE_ENV=${NODE_ENV:-development})"
            OPER_WARNINGS=$((OPER_WARNINGS + 1))
        else
            log "ENV operacional ausente (INFO): ${var}"
        fi
    else
        log "ENV operacional detectada: ${var}=$(sanitize_oneline "${value}")"
    fi
done

# 3.10 Feature flags (info)
for var in "${FEATURE_FLAG_ENV_VARS[@]}"; do
    value="${!var:-}"
    if [[ -n "${value}" ]]; then
        log "Feature flag detectado: ${var}=$(sanitize_oneline "${value}")"
        FLAG_INFO=$((FLAG_INFO + 1))
    fi
done

_is_port() {
    local p="${1:-}"
    [[ "${p}" =~ ^[0-9]+$ ]] && ((p >= 1024 && p <= 65535))
}

for p in SERVER_PORT CHROME_PORT CHROME_PROXY_PORT; do
    val="${!p:-}"
    if [[ -n "${val}" ]] && ! _is_port "${val}"; then
        warn "ENV porta inválida: ${p}='${val}' (1024-65535)"
    fi
done

# conflito lógico de portas (se todas existirem)
if [[ -n "${SERVER_PORT:-}" && -n "${CHROME_PORT:-}" && -n "${CHROME_PROXY_PORT:-}" ]]; then
    if [[ "${SERVER_PORT}" == "${CHROME_PORT}" || "${SERVER_PORT}" == "${CHROME_PROXY_PORT}" || "${CHROME_PORT}" == "${CHROME_PROXY_PORT}" ]]; then
        error "ENV CRÍTICO: conflito lógico de portas"
        error "→ SERVER_PORT=${SERVER_PORT}"
        error "→ CHROME_PORT=${CHROME_PORT}"
        error "→ CHROME_PROXY_PORT=${CHROME_PROXY_PORT}"
        STRUCT_ERRORS=$((STRUCT_ERRORS + 1))
    fi
fi

log "Validando dependências semânticas..."

# BROWSER_MODE=wsEndpoint → CHROME_PROXY_PORT + CHROME_PORT + CHROME_HOST
if [[ "${BROWSER_MODE:-}" == "wsEndpoint" ]]; then
    for v in CHROME_PROXY_PORT CHROME_PORT CHROME_HOST; do
        if [[ -z "${!v:-}" ]]; then
            error "DEPENDÊNCIA AUSENTE: BROWSER_MODE=wsEndpoint requer ${v}"
            STRUCT_ERRORS=$((STRUCT_ERRORS + 1))
        fi
    done
    ((STRUCT_ERRORS == 0)) && log "✓ Dependências de BROWSER_MODE=wsEndpoint satisfeitas"
fi

if [[ "${MOCK_CHROME:-0}" == "1" ]]; then
    warn "MOCK_CHROME=1 ativo: Browser real não será usado (não use em produção)"
fi

if [[ "${NODE_ENV:-}" == "production" && "${ALLOW_DEGRADED_MODE:-false}" == "true" ]]; then
    error "INCONSISTÊNCIA: ALLOW_DEGRADED_MODE=true não permitido em production"
    STRUCT_ERRORS=$((STRUCT_ERRORS + 1))
fi

TOTAL_FATAL_ERRORS=$((STRUCT_ERRORS + INFRA_ERRORS))
if ((TOTAL_FATAL_ERRORS > 0)); then
    error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    error "VALIDAÇÃO ENV FALHOU (${TOTAL_FATAL_ERRORS} erro[s] fatal[is])"
    error "→ Estruturais : ${STRUCT_ERRORS}"
    error "→ Infraestrutura : ${INFRA_ERRORS}"
    error "→ Infra warnings : ${INFRA_WARNINGS}"
    error "Referência: .devcontainer/ENV_ANALYSIS_V6.md"
    error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

((INFRA_WARNINGS > 0)) && warn "Validação ENV: ${INFRA_WARNINGS} warning(s) de infraestrutura (aceitável em ${NODE_ENV:-development})"
((OPER_WARNINGS > 0)) && warn "Validação ENV: ${OPER_WARNINGS} warning(s) operacional(is) (aceitável em bootstrap)"
((FLAG_INFO > 0)) && log "Feature flags detectados: ${FLAG_INFO}"

log "✓ Validação ENV concluída com sucesso (modelo estratificado v6.0)"

# =============================================================================
# SECTION 4 — Gatekeeper (Idempotência + Modos + Persistência)
# =============================================================================

STATE_FILE="${DEVCONTAINER_DIR}/.initialized"
readonly STATE_FILE

ENABLE_STATE_FILE_VAL="${ENABLE_STATE_FILE:-true}"
case "${ENABLE_STATE_FILE_VAL}" in
    true)
        SKIP_STATE_FILE="false"
        log "Gatekeeper: Persistência de estado ATIVADA (ENABLE_STATE_FILE=true)"
        ;;
    false)
        SKIP_STATE_FILE="true"
        log "Gatekeeper: Persistência de estado DESATIVADA (ENABLE_STATE_FILE=false)"
        ;;
    *)
        SKIP_STATE_FILE="false"
        warn "Gatekeeper: ENABLE_STATE_FILE inválido ('${ENABLE_STATE_FILE_VAL}'); assumindo true"
        ;;
esac
readonly SKIP_STATE_FILE

REEXECUTE_POST_CREATE_VAL="${REEXECUTE_POST_CREATE:-false}"
FORCE_REEXECUTION="false"
[[ "${REEXECUTE_POST_CREATE_VAL}" == "true" ]] && FORCE_REEXECUTION="true"
readonly FORCE_REEXECUTION

# estado impossível: ambos markers
if [[ -f "${COMPLETED_MARKER}" && -f "${IN_PROGRESS_MARKER}" ]]; then
    warn "Gatekeeper: Estado inconsistente (COMPLETED + IN_PROGRESS). Limpando IN_PROGRESS."
    rm -f "${IN_PROGRESS_MARKER}" 2> /dev/null || true
fi

# determinar modo
RUNTIME_MODE="bootstrap"
if [[ "${SKIP_STATE_FILE}" == "true" ]]; then
    RUNTIME_MODE="stateless"
elif [[ -f "${COMPLETED_MARKER}" && "${FORCE_REEXECUTION}" != "true" ]]; then
    RUNTIME_MODE="reentry"
elif [[ -f "${IN_PROGRESS_MARKER}" ]]; then
    RUNTIME_MODE="replay"
elif [[ -f "${STATE_FILE}" && -s "${STATE_FILE}" && "${FORCE_REEXECUTION}" == "true" ]]; then
    RUNTIME_MODE="replay"
else
    RUNTIME_MODE="bootstrap"
fi
readonly RUNTIME_MODE

log "Gatekeeper: Modo operacional efetivo = ${RUNTIME_MODE}"

if [[ "${RUNTIME_MODE}" == "reentry" ]]; then
    log "Gatekeeper: Execução abortada para preservar idempotência por container (reentry)."
    exit 0
fi

if [[ "${RUNTIME_MODE}" == "replay" ]]; then
    warn ""
    warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    warn "🔄 RECOVERY MODE ATIVADO"
    warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    warn "Gatekeeper: Reexecução estrutural autorizada (replay)."
    warn "Marker: ${IN_PROGRESS_MARKER}"
    warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    warn ""
fi

# início da transação (garantir marker)
touch "${IN_PROGRESS_MARKER}" 2> /dev/null || true
log "Gatekeeper: Execução marcada como IN_PROGRESS (${IN_PROGRESS_MARKER})"

log "Inicialização estrutural autorizada."
log "Simbiose v${SCRIPT_VERSION} | Hash=${SCRIPT_HASH:0:8}"
log "Modo de execução: ${RUNTIME_MODE}"
log "Identidade: ${CURRENT_USER} (UID:${CURRENT_UID})"
log "Paths: HOME=${HOME_DIR} | PROJECT_ROOT=${PROJECT_ROOT}"

# =============================================================================
# SECTION 5 — Handshake (audit-only)
# =============================================================================
log "Realizando auditoria de estrutura do projeto (Handshake)..."

STRUCT_GIT_DIR="${PROJECT_ROOT}/.git"
STRUCT_NODE_MANIFEST="${PROJECT_ROOT}/package.json"
STRUCT_MAKEFILE="${PROJECT_ROOT}/Makefile"
readonly STRUCT_GIT_DIR STRUCT_NODE_MANIFEST STRUCT_MAKEFILE

STRUCT_STATUS="OK"
STRUCT_WARNINGS=()

if [[ -d "${STRUCT_GIT_DIR}" ]]; then
    log "Handshake: Git detectado (.git/)"
else
    warn "Handshake: Git NÃO detectado. Workspace pode não ser a raiz do projeto."
    STRUCT_STATUS="DEGRADED"
    STRUCT_WARNINGS+=("git")
fi

if [[ -f "${STRUCT_NODE_MANIFEST}" ]]; then
    log "Handshake: package.json detectado"
else
    warn "Handshake: package.json ausente. Toolchain Node pode não estar inicializada."
    STRUCT_STATUS="DEGRADED"
    STRUCT_WARNINGS+=("node")
fi

if [[ -f "${STRUCT_MAKEFILE}" ]]; then
    log "Handshake: Makefile detectado"
else
    warn "Handshake: Makefile ausente. Governança de execução indisponível."
    STRUCT_STATUS="DEGRADED"
    STRUCT_WARNINGS+=("makefile")
fi

log "Handshake Summary: STATUS=${STRUCT_STATUS} | missing=$(
    IFS=,
    echo "${STRUCT_WARNINGS[*]:-none}"
)"

# =============================================================================
# SECTION 6 — Volumes (audit-only; críticos abortam)
# =============================================================================
log "Validando integridade estrutural dos volumes (audit-only)..."

VOLUME_DIRS=(
    "${USER_HOME}/.cache"
    "${USER_HOME}/.cache/puppeteer"
    "${USER_HOME}/.cache/typescript"
    "${USER_HOME}/.npm"
    "${USER_HOME}/.npm-global"
    "${USER_HOME}/.pm2"
    "${USER_HOME}/.config"
    "${USER_HOME}/.local/share"
    "${USER_HOME}/.local/state"
    "${USER_HOME}/.claude"
    "${USER_HOME}/.ssh"
    "${USER_HOME}/.gnupg"
    "${USER_HOME}/.vscode-server"
    "${USER_HOME}-history"
)
readonly VOLUME_DIRS

CRITICAL_VOLUMES=(
    "${USER_HOME}/.config"
    "${USER_HOME}/.claude"
    "${USER_HOME}/.local/state"
)
readonly CRITICAL_VOLUMES

for dir in "${VOLUME_DIRS[@]}"; do
    if [[ ! -d "${dir}" ]]; then
        warn "Volume ausente: ${dir}"
        for crit in "${CRITICAL_VOLUMES[@]}"; do
            if [[ "${dir}" == "${crit}" ]]; then
                error "FALHA CRÍTICA: Volume essencial não montado: ${dir}"
                exit 1
            fi
        done
        continue
    fi

    if [[ ! -w "${dir}" ]]; then
        is_critical="false"
        for crit in "${CRITICAL_VOLUMES[@]}"; do
            [[ "${dir}" == "${crit}" ]] && is_critical="true"
        done

        if [[ "${is_critical}" == "true" ]]; then
            error "FALHA CRÍTICA: Volume essencial não gravável: ${dir}"
            exit 1
        else
            warn "Volume não gravável (não-crítico): ${dir}"
        fi
    fi
done

log "Volumes auditados com sucesso."

# =============================================================================
# SECTION 7 — SSH (observacional)
# =============================================================================
log "Avaliando capacidade SSH (observacional)..."

SSH_CONTRACT_VERSION="1.6"
SSH_CONTRACT_STATUS="absent"
readonly SSH_CONTRACT_VERSION

if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
    SSH_CONTRACT_STATUS="absent"
    log "SSH: Não solicitado (SSH_AUTH_SOCK ausente)."
else
    if [[ -S "${SSH_AUTH_SOCK}" ]]; then
        SSH_CONTRACT_STATUS="valid"
        log "SSH: Socket válido observado: ${SSH_AUTH_SOCK}"
    elif [[ -e "${SSH_AUTH_SOCK}" ]]; then
        SSH_CONTRACT_STATUS="inconsistent"
        warn "SSH: SSH_AUTH_SOCK existe, mas NÃO é socket: ${SSH_AUTH_SOCK}"
    else
        SSH_CONTRACT_STATUS="present"
        warn "SSH: SSH_AUTH_SOCK definido, mas path não existe (transitório): ${SSH_AUTH_SOCK}"
    fi
fi

export SSH_CONTRACT_VERSION SSH_CONTRACT_STATUS

SSH_SOCKET_AVAILABLE="false"
[[ "${SSH_CONTRACT_STATUS}" == "valid" ]] && SSH_SOCKET_AVAILABLE="true"
SSH_REQUESTED="false"
[[ "${SSH_CONTRACT_STATUS}" != "absent" ]] && SSH_REQUESTED="true"
export SSH_SOCKET_AVAILABLE SSH_REQUESTED

log "SSH: status=${SSH_CONTRACT_STATUS} (requested=${SSH_REQUESTED}, usable=${SSH_SOCKET_AVAILABLE})"

# =============================================================================
# SECTION 8 — Persistência de histórico (UX)
# =============================================================================
log "Persistindo histórico do bash (UX-only)..."

HISTORY_VOL="${USER_HOME}-history"
HISTORY_FILE="${HOME_DIR}/.bash_history"
HISTORY_TARGET="${HISTORY_VOL}/.bash_history"
readonly HISTORY_VOL HISTORY_FILE HISTORY_TARGET

HISTORY_VOLUME_READY="false"
if [[ ! -d "${HISTORY_VOL}" ]]; then
    warn "Histórico: Volume não detectado em ${HISTORY_VOL}. Sem persistência."
elif [[ ! -w "${HISTORY_VOL}" ]]; then
    warn "Histórico: Volume ${HISTORY_VOL} não é gravável. Persistência desativada."
else
    HISTORY_VOLUME_READY="true"
fi

if [[ "${HISTORY_VOLUME_READY}" == "true" ]]; then
    if [[ ! -f "${HISTORY_TARGET}" ]]; then
        log "Histórico: inicializando ${HISTORY_TARGET}"
        touch "${HISTORY_TARGET}" 2> /dev/null || {
            warn "Histórico: falha ao criar target; desativando"
            HISTORY_VOLUME_READY="false"
        }
    fi
fi

if [[ "${HISTORY_VOLUME_READY}" == "true" ]]; then
    if ln -sfn "${HISTORY_TARGET}" "${HISTORY_FILE}"; then
        log "Histórico: symlink OK → ${HISTORY_FILE} -> ${HISTORY_TARGET}"
    else
        warn "Histórico: falha ao criar symlink; histórico pode não persistir"
    fi
fi

# =============================================================================
# SECTION 9 — NSS wrapper (instrumental, runtime-only em /tmp)
# =============================================================================
log "Configurando Gatekeeper NSS (Identidade Dinâmica Instrumental)..."

if ! check_nss_library; then
    error "NSS: dependência libnss_wrapper ausente; abortando"
    exit 1
fi

NSS_BASE_DIR="${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"
NSS_PASSWD_FILE="${NSS_BASE_DIR}/passwd"
NSS_GROUP_FILE="${NSS_BASE_DIR}/group"
readonly NSS_BASE_DIR NSS_PASSWD_FILE NSS_GROUP_FILE

ensure_dir "${NSS_BASE_DIR}"
chmod 700 "${NSS_BASE_DIR}" 2> /dev/null || true
[[ -w "${NSS_BASE_DIR}" ]] || {
    error "NSS: ${NSS_BASE_DIR} não é gravável"
    exit 1
}

HOME_DIR_EFF="${HOME_DIR:-${HOME:-/home/${CURRENT_USER}}}"
if [[ "${CURRENT_UID}" == "unknown" || "${CURRENT_GID}" == "unknown" ]]; then
    error "NSS: UID/GID indisponível"
    exit 1
fi

cat > "${NSS_PASSWD_FILE}.tmp" << PASSWD_BLOCK
${CURRENT_USER}:x:${CURRENT_UID}:${CURRENT_GID}:${CURRENT_USER} user:${HOME_DIR_EFF}:/bin/bash
PASSWD_BLOCK
mv "${NSS_PASSWD_FILE}.tmp" "${NSS_PASSWD_FILE}"
safe_chown "${CURRENT_UID}:${CURRENT_GID}" "${NSS_PASSWD_FILE}"
chmod 644 "${NSS_PASSWD_FILE}" 2> /dev/null || true

{
    # grupos reais (best-effort). A linha do grupo primário é emitida como
    # fallback obrigatório para evitar group file vazio em imagens mínimas.
    if command -v id > /dev/null 2>&1 && command -v getent > /dev/null 2>&1 && command -v awk > /dev/null 2>&1 && command -v xargs > /dev/null 2>&1; then
        id -G 2> /dev/null \
            | xargs -r -n1 getent group 2> /dev/null \
            | awk -F: 'NF>=3 {print $1 ":" $2 ":" $3 ":"}' \
            || true
    fi

    printf '%s:x:%s:\n' "${CURRENT_USER}" "${CURRENT_GID}"

    # docker group injection (observacional)
    if [[ -S /var/run/docker.sock ]] && command -v stat > /dev/null 2>&1; then
        sockgid="$(stat -c '%g' /var/run/docker.sock 2> /dev/null || true)"
        [[ -n "${sockgid:-}" && "${sockgid:-}" =~ ^[0-9]+$ ]] && echo "docker:x:${sockgid}:"
    elif command -v getent > /dev/null 2>&1 && getent group docker > /dev/null 2>&1; then
        dgid="$(getent group docker | awk -F: 'NF>=3 {print $3; exit}')"
        [[ -n "${dgid:-}" && "${dgid:-}" =~ ^[0-9]+$ ]] && echo "docker:x:${dgid}:"
    fi
} > "${NSS_GROUP_FILE}.tmp"

# sanitização final: mantém só group(5)-shape e remove duplicatas por GID,
# preservando a primeira ocorrência real quando disponível.
if command -v awk > /dev/null 2>&1; then
    awk -F: 'NF==4 && $3 ~ /^[0-9]+$/ { if (!seen_gid[$3]++) print }' "${NSS_GROUP_FILE}.tmp" 2> /dev/null > "${NSS_GROUP_FILE}.tmp.s" || true
    if [[ -s "${NSS_GROUP_FILE}.tmp.s" ]]; then
        mv -f "${NSS_GROUP_FILE}.tmp.s" "${NSS_GROUP_FILE}.tmp" 2> /dev/null || true
    else
        printf '%s:x:%s:\n' "${CURRENT_USER}" "${CURRENT_GID}" > "${NSS_GROUP_FILE}.tmp" 2> /dev/null || true
        rm -f "${NSS_GROUP_FILE}.tmp.s" 2> /dev/null || true
    fi
fi

mv "${NSS_GROUP_FILE}.tmp" "${NSS_GROUP_FILE}"
safe_chown "${CURRENT_UID}:${CURRENT_GID}" "${NSS_GROUP_FILE}"
chmod 644 "${NSS_GROUP_FILE}" 2> /dev/null || true

# validação sintática
_validate_nss_files() {
    local pass="${1:-}" grp="${2:-}"
    if [[ ! -s "${pass}" || ! -s "${grp}" ]]; then
        return 20
    fi
    if command -v grep > /dev/null 2>&1; then
        grep -q $'\r' "${pass}" "${grp}" 2> /dev/null && return 21
        grep -qE '\$\{[A-Za-z_][A-Za-z0-9_]*\}' "${pass}" "${grp}" 2> /dev/null && return 22
    fi
    if command -v awk > /dev/null 2>&1; then
        awk -F: 'NF != 7 {bad=1} END {exit bad ? 1 : 0}' "${pass}" 2> /dev/null || return 23
        awk -F: 'NF != 4 {bad=1} END {exit bad ? 1 : 0}' "${grp}" 2> /dev/null || return 24
    fi
    return 0
}

if ! _validate_nss_files "${NSS_PASSWD_FILE}" "${NSS_GROUP_FILE}"; then
    rc=$?
    error "NSS: artefatos inválidos (rc=${rc})"
    error "→ passwd=${NSS_PASSWD_FILE}"
    error "→ group=${NSS_GROUP_FILE}"
    warn "Dump passwd (5 primeiras linhas):"
    sed -n '1,5p' "${NSS_PASSWD_FILE}" 2> /dev/null || true
    warn "Dump group (10 primeiras linhas):"
    sed -n '1,10p' "${NSS_GROUP_FILE}" 2> /dev/null || true
    exit 1
fi

# ativação via profile (best-effort)
if [[ -f /etc/profile.d/10-gatekeeper-nss.sh ]]; then
    # shellcheck disable=SC1091
    . /etc/profile.d/10-gatekeeper-nss.sh > /dev/null 2>&1 || true
else
    warn "NSS: /etc/profile.d/10-gatekeeper-nss.sh ausente; ativação automática não aplicada"
fi

if [[ -n "${NSS_WRAPPER_PASSWD:-}" && -n "${NSS_WRAPPER_GROUP:-}" ]]; then
    log "NSS: identidade dinâmica ativa (NSS_WRAPPER_* exportados)"
else
    warn "NSS: artefatos OK, mas NSS_WRAPPER_* não definidos (ver profile/lib)"
fi

# =============================================================================
# SECTION 10 — Git base config (opcional, defensivo)
# =============================================================================
log "Auditando configuração base do Git (defensivo)..."

GIT_BASE_APPLICABLE="true"
command -v git > /dev/null 2>&1 || {
    warn "Git não localizado; desativando"
    GIT_BASE_APPLICABLE="false"
}

BASE_GITCONFIG="${DEVCONTAINER_DIR}/config/.gitconfig"
TARGET_GITCONFIG="${HOME_DIR}/.gitconfig"
readonly BASE_GITCONFIG TARGET_GITCONFIG

if [[ "${GIT_BASE_APPLICABLE}" == "true" && ! -f "${BASE_GITCONFIG}" ]]; then
    log "Git: template base não encontrado (${BASE_GITCONFIG})."
    GIT_BASE_APPLICABLE="false"
fi
if [[ "${GIT_BASE_APPLICABLE}" == "true" && -f "${TARGET_GITCONFIG}" ]]; then
    log "Git: ~/.gitconfig já existe; preservando."
    GIT_BASE_APPLICABLE="false"
fi

if [[ "${GIT_BASE_APPLICABLE}" == "true" ]]; then
    log "Git: aplicando template base (one-shot)..."
    if cp "${BASE_GITCONFIG}" "${TARGET_GITCONFIG}" 2> /dev/null; then
        chmod 644 "${TARGET_GITCONFIG}" 2> /dev/null || true
        log "Git: template aplicado em ~/.gitconfig"
    else
        warn "Git: falha ao copiar template; prosseguindo"
    fi
else
    log "Git: configuração base não aplicável."
fi

# =============================================================================
# SECTION 11 — Deep Audit (observacional)
# =============================================================================
log "Iniciando Diagnóstico Exaustivo (Deep Audit)..."

NET_STATUS="SKIP"
NETWORK_PROBE_URL="${DEVCONTAINER_POST_CREATE_NETWORK_PROBE_URL:-https://api.github.com/}"
if command -v curl > /dev/null 2>&1; then
    if curl -fsS -o /dev/null --connect-timeout 2 --max-time 3 "${NETWORK_PROBE_URL}" > /dev/null 2>&1; then
        NET_STATUS="ONLINE"
    else
        NET_STATUS="OFFLINE"
    fi
fi

{
    echo -e "\n=== [DEEP AUDIT REPORT - $(date -Is 2> /dev/null || echo unknown)] ==="
    echo "Audit Mode: OBSERVATIONAL (non-fatal)"

    echo -e "\n[1. Volume Metadata & Ownership Registry]"
    for dir in "${VOLUME_DIRS[@]}"; do
        if [[ -d "${dir}" ]] && command -v stat > /dev/null 2>&1; then
            stat -c "PATH: %n | PERM: %a | OWNER: %U(%u) | GROUP: %G(%g)" "${dir}" 2> /dev/null \
                || echo "PATH: ${dir} | Metadata check failed."
        else
            if [[ -d "${dir}" ]]; then
                echo "PATH: ${dir} | STATUS: OK"
            else
                echo "PATH: ${dir} | STATUS: NOT_FOUND"
            fi
        fi
    done

    audit_mounts "${PROJECT_ROOT}" "${CURRENT_USER}"

    echo -e "\n[3. System Resource Snapshot]"
    df -h / 2> /dev/null | tail -1 | awk '{printf "Disk Usage: %s (%s available)\n", $5, $4}' || echo "Disk usage unavailable."
    df -i / 2> /dev/null | tail -1 | awk '{printf "Inode Usage: %s\n", $5}' || echo "Inode usage unavailable."
    if [[ -d "/dev/shm" ]]; then
        df -h /dev/shm 2> /dev/null | tail -1 | awk '{printf "Shared Memory (/dev/shm): %s free\n", $4}' || true
    fi
    echo "Umask: $(umask 2> /dev/null || echo unknown)"

    echo -e "\n[4. Network & Identity Check]"
    echo "Network Status (diagnostic): ${NET_STATUS}"
    echo "Whoami: $(whoami 2> /dev/null || echo unknown)"
    echo "UID: $(id -u 2> /dev/null || echo unknown)"
    echo "Groups: $(id -Gn 2> /dev/null | tr ' ' ',' || echo unknown)"

    echo -e "\n[5. SSH Agent Diagnostic]"
    if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
        echo "SSH: DISABLED (SSH_AUTH_SOCK not set)"
    else
        echo "SSH_AUTH_SOCK=${SSH_AUTH_SOCK}"
        if [[ -S "${SSH_AUTH_SOCK}" ]]; then
            echo "SSH Agent Socket: VALID"
        else
            echo "SSH Agent Socket: INVALID"
        fi
    fi

    echo -e "\n[6. Runtime & Execution Context]"
    echo "Node Path: $(command -v node 2> /dev/null || echo not-found)"
    echo "Node Version: $(node -v 2> /dev/null || echo N/A)"
    echo "=========================================="
} >> "${LOG_FILE}" 2> /dev/null || true

log "Relatório forense anexado ao log físico."

# =============================================================================
# SECTION 11.1 — Structural Control-Plane Baseline Audit (passivo)
# =============================================================================
log "Auditando baseline estrutural do control plane (presença/sintaxe/versão; nenhuma execução operacional)..."

STRICT_SCRIPT_AUDIT="${DEVCONTAINER_POST_CREATE_STRICT_SCRIPT_AUDIT:-false}"
STRICT_VERSION_AUDIT="${DEVCONTAINER_POST_CREATE_STRICT_VERSION_AUDIT:-false}"
STRICT_ENDPOINT_REGISTRY_AUDIT="${DEVCONTAINER_POST_CREATE_STRICT_ENDPOINT_REGISTRY_AUDIT:-false}"
ARTIFACT_MAX_AGE_SECONDS="${DEVCONTAINER_POST_CREATE_ARTIFACT_MAX_AGE_SECONDS:-86400}"
if [[ ! "${ARTIFACT_MAX_AGE_SECONDS}" =~ ^[0-9]+$ ]]; then
    ARTIFACT_MAX_AGE_SECONDS="86400"
fi

SCRIPT_AUDIT_STATUS="OK"
SCRIPT_AUDIT_WARNINGS=0
SCRIPT_VERSION_MISMATCHES=0
SCRIPT_MISSING_COUNT=0
SCRIPT_BASH_N_FAILURES=0

POST_START_SCRIPT="${DEVCONTAINER_POST_START_SCRIPT:-${DEVCONTAINER_DIR}/scripts/post-start.sh}"
POST_ATTACH_SCRIPT="${DEVCONTAINER_POST_ATTACH_SCRIPT:-${DEVCONTAINER_DIR}/scripts/post-attach.sh}"
HEALTHCHECK_SCRIPT="${DEVCONTAINER_HEALTHCHECK_SCRIPT:-${DEVCONTAINER_DIR}/scripts/healthcheck.sh}"
SYNC_LOCAL_AUTH_SCRIPT="${DEVCONTAINER_SYNC_LOCAL_AUTH_SCRIPT:-${DEVCONTAINER_DIR}/scripts/sync-local-auth.sh}"
NSS_GATEKEEPER_SOURCE="${DEVCONTAINER_NSS_GATEKEEPER_SOURCE:-${DEVCONTAINER_DIR}/nss-gatekeeper.sh}"
LOCAL_DNS_SCRIPT="${DEVCONTAINER_LOCAL_DNS_CACHE_SCRIPT:-${DEVCONTAINER_DIR}/scripts/network/local-dns-cache.sh}"
GITHUB_ROUTE_SCRIPT="${DEVCONTAINER_GITHUB_API_ROUTE_SCRIPT:-${DEVCONTAINER_DIR}/scripts/network/github-api-route-fix.sh}"
COPILOT_MANAGER_SCRIPT="${DEVCONTAINER_COPILOT_NETWORK_MANAGER_SCRIPT:-${DEVCONTAINER_DIR}/scripts/network/github-copilot-network-manager.sh}"
COPILOT_ADVISOR_SCRIPT="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_SCRIPT:-${DEVCONTAINER_DIR}/scripts/network/copilot-route-advisor.sh}"
LOCAL_PROXY_SCRIPT="${DEVCONTAINER_LOCAL_COPILOT_PROXY_SCRIPT:-${DEVCONTAINER_DIR}/scripts/network/local-copilot-proxy.sh}"
NETWORK_CONTROL_PLANE_SCRIPT="${DEVCONTAINER_NETWORK_CONTROL_PLANE_SCRIPT:-${DEVCONTAINER_DIR}/scripts/network/network-control-plane-state.sh}"
DEVCONTAINER_JSON_FILE="${DEVCONTAINER_JSON_FILE:-${DEVCONTAINER_DIR}/devcontainer.json}"
DOCKERFILE_FILE="${DEVCONTAINER_DOCKERFILE_FILE:-}"
if [[ -z "${DOCKERFILE_FILE}" ]]; then
    DOCKERFILE_FILE="${DEVCONTAINER_DIR}/Dockerfile"
    if [[ ! -r "${DOCKERFILE_FILE}" && -r "${PROJECT_ROOT}/Dockerfile" ]]; then
        DOCKERFILE_FILE="${PROJECT_ROOT}/Dockerfile"
    fi
fi
ENDPOINT_REGISTRY_FILE="${DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY_FILE:-${DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY:-}}"
if [[ -z "${ENDPOINT_REGISTRY_FILE}" ]]; then
    ENDPOINT_REGISTRY_FILE="${DEVCONTAINER_DIR}/scripts/network/endpoints.github-copilot.tsv"
    if [[ ! -r "${ENDPOINT_REGISTRY_FILE}" && -r "${DEVCONTAINER_DIR}/network/endpoints.github-copilot.tsv" ]]; then
        ENDPOINT_REGISTRY_FILE="${DEVCONTAINER_DIR}/network/endpoints.github-copilot.tsv"
    fi
fi

GITHUB_ROUTE_STATUS_FILE="${DEVCONTAINER_GITHUB_ROUTE_STATUS_FILE:-/tmp/devcontainer-github-api-route.status}"
GITHUB_ROUTE_SUMMARY_FILE="${DEVCONTAINER_GITHUB_ROUTE_SUMMARY_FILE:-/tmp/devcontainer-github-api-route.summary}"
GITHUB_ROUTE_METRICS_FILE="${DEVCONTAINER_GITHUB_ROUTE_METRICS_FILE:-/tmp/devcontainer-github-api-route.metrics.tsv}"
GITHUB_ROUTE_BENCHMARK_FILE="${DEVCONTAINER_GITHUB_API_BENCHMARK_FILE:-${DEVCONTAINER_GITHUB_ROUTE_BENCHMARK_FILE:-/tmp/devcontainer-github-api-route.benchmark.tsv}}"
GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE="${DEVCONTAINER_GITHUB_API_BENCHMARK_SUMMARY_FILE:-${DEVCONTAINER_GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE:-/tmp/devcontainer-github-api-route.benchmark.summary}}"
GITHUB_ROUTE_RECOMMENDATION_FILE="${DEVCONTAINER_GITHUB_API_RECOMMENDATION_FILE:-${DEVCONTAINER_GITHUB_ROUTE_RECOMMENDATION_FILE:-/tmp/devcontainer-github-api-route.recommendation}}"
GITHUB_ROUTE_ACTION_SUMMARY_FILE="${DEVCONTAINER_GITHUB_ROUTE_ACTION_SUMMARY_FILE:-${DEVCONTAINER_GITHUB_API_ROUTE_ACTION_SUMMARY_FILE:-/tmp/devcontainer-github-api-route.action.summary}}"
LOCAL_DNS_STATUS_FILE="${DEVCONTAINER_LOCAL_DNS_STATUS_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_STATUS_FILE:-/tmp/devcontainer-local-dns-cache.status}}"
LOCAL_DNS_SUMMARY_FILE="${DEVCONTAINER_LOCAL_DNS_SUMMARY_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_SUMMARY_FILE:-/tmp/devcontainer-local-dns-cache.summary}}"
LOCAL_DNS_ACTION_SUMMARY_FILE="${DEVCONTAINER_LOCAL_DNS_ACTION_SUMMARY_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_ACTION_SUMMARY_FILE:-/tmp/devcontainer-local-dns-cache.action.summary}}"
LOCAL_DNS_EVENTS_FILE="${DEVCONTAINER_LOCAL_DNS_EVENTS_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_EVENTS_FILE:-/tmp/devcontainer-local-dns-cache.events.tsv}}"
LOCAL_DNS_METRICS_FILE="${DEVCONTAINER_LOCAL_DNS_METRICS_FILE:-${DEVCONTAINER_LOCAL_DNS_CACHE_METRICS_FILE:-/tmp/devcontainer-local-dns-cache.metrics.tsv}}"
LOCAL_PROXY_STATUS_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_STATUS_FILE:-/tmp/devcontainer-copilot-proxy.status}"
LOCAL_PROXY_SUMMARY_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_SUMMARY_FILE:-/tmp/devcontainer-copilot-proxy.summary}"
LOCAL_PROXY_BENCHMARK_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_FILE:-/tmp/devcontainer-copilot-proxy.benchmark.tsv}"
LOCAL_PROXY_BENCHMARK_SUMMARY_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_BENCHMARK_SUMMARY_FILE:-/tmp/devcontainer-copilot-proxy.benchmark.summary}"
LOCAL_PROXY_COMPARISON_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_COMPARISON_FILE:-/tmp/devcontainer-copilot-proxy.comparison.tsv}"
LOCAL_PROXY_RECOMMENDATION_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_RECOMMENDATION_FILE:-/tmp/devcontainer-copilot-proxy.recommendation}"
COPILOT_NETWORK_STATUS_FILE="${DEVCONTAINER_COPILOT_NETWORK_STATUS_FILE:-/tmp/devcontainer-copilot-network.status}"
COPILOT_NETWORK_SUMMARY_FILE="${DEVCONTAINER_COPILOT_NETWORK_SUMMARY_FILE:-/tmp/devcontainer-copilot-network.summary}"
COPILOT_NETWORK_METRICS_FILE="${DEVCONTAINER_COPILOT_NETWORK_METRICS_FILE:-/tmp/devcontainer-copilot-network.metrics.tsv}"
COPILOT_NETWORK_DIAGNOSIS_FILE="${DEVCONTAINER_COPILOT_NETWORK_DIAGNOSIS_FILE:-/tmp/devcontainer-copilot-network.diagnosis.tsv}"
COPILOT_NETWORK_RECOMMENDATION_FILE="${DEVCONTAINER_COPILOT_NETWORK_RECOMMENDATION_FILE:-/tmp/devcontainer-copilot-network.recommendation}"
COPILOT_NETWORK_RECOMMENDATION_JSON="${DEVCONTAINER_COPILOT_NETWORK_RECOMMENDATION_JSON:-${DEVCONTAINER_COPILOT_NETWORK_RECOMMENDATION_JSON_FILE:-/tmp/devcontainer-copilot-network.recommendation.json}}"
COPILOT_ROUTE_ADVISOR_STATUS_FILE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_STATUS_FILE:-/tmp/devcontainer-copilot-route-advisor.status}"
COPILOT_ROUTE_ADVISOR_SUMMARY_FILE="${DEVCONTAINER_COPILOT_ROUTE_ADVISOR_SUMMARY_FILE:-/tmp/devcontainer-copilot-route-advisor.summary}"
NETWORK_CONTROL_PLANE_STATUS_FILE="${DEVCONTAINER_NETWORK_CONTROL_PLANE_STATUS_FILE:-/tmp/devcontainer-network-control-plane.status}"
NETWORK_CONTROL_PLANE_SUMMARY_FILE="${DEVCONTAINER_NETWORK_CONTROL_PLANE_SUMMARY_FILE:-/tmp/devcontainer-network-control-plane.summary}"
NETWORK_CONTROL_PLANE_REPORT_FILE="${DEVCONTAINER_NETWORK_CONTROL_PLANE_REPORT_FILE:-/tmp/devcontainer-network-control-plane.report}"
NETWORK_CONTROL_PLANE_EVENTS_FILE="${DEVCONTAINER_NETWORK_CONTROL_PLANE_EVENTS_FILE:-/tmp/devcontainer-network-control-plane.events.tsv}"
NETWORK_CONTROL_PLANE_JSON_FILE="${DEVCONTAINER_NETWORK_CONTROL_PLANE_JSON_FILE:-/tmp/devcontainer-network-control-plane.state.json}"
HEALTH_STATUS_FILE="${DEVCONTAINER_HEALTH_STATUS_FILE:-/tmp/devcontainer-health.status}"
HEALTH_SUMMARY_FILE="${DEVCONTAINER_HEALTH_SUMMARY_FILE:-/tmp/devcontainer-health.summary}"
HEALTH_REPORT_FILE="${DEVCONTAINER_HEALTH_REPORT_FILE:-/tmp/devcontainer-health.report}"
HEALTH_EVENTS_FILE="${DEVCONTAINER_HEALTH_EVENTS_FILE:-/tmp/devcontainer-health.events.tsv}"
SYNC_LOCAL_AUTH_STATUS_FILE="${DEVCONTAINER_SYNC_LOCAL_AUTH_STATUS_FILE:-/tmp/devcontainer-sync-local-auth.status}"
SYNC_LOCAL_AUTH_SUMMARY_FILE="${DEVCONTAINER_SYNC_LOCAL_AUTH_SUMMARY_FILE:-/tmp/devcontainer-sync-local-auth.summary}"
SYNC_LOCAL_AUTH_REPORT_FILE="${DEVCONTAINER_SYNC_LOCAL_AUTH_REPORT_FILE:-/tmp/devcontainer-sync-local-auth.report}"

readonly POST_START_SCRIPT POST_ATTACH_SCRIPT HEALTHCHECK_SCRIPT SYNC_LOCAL_AUTH_SCRIPT NSS_GATEKEEPER_SOURCE LOCAL_DNS_SCRIPT GITHUB_ROUTE_SCRIPT COPILOT_MANAGER_SCRIPT COPILOT_ADVISOR_SCRIPT LOCAL_PROXY_SCRIPT NETWORK_CONTROL_PLANE_SCRIPT DEVCONTAINER_JSON_FILE DOCKERFILE_FILE
readonly ENDPOINT_REGISTRY_FILE GITHUB_ROUTE_STATUS_FILE GITHUB_ROUTE_SUMMARY_FILE GITHUB_ROUTE_METRICS_FILE GITHUB_ROUTE_BENCHMARK_FILE GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE GITHUB_ROUTE_RECOMMENDATION_FILE GITHUB_ROUTE_ACTION_SUMMARY_FILE
readonly LOCAL_DNS_STATUS_FILE LOCAL_DNS_SUMMARY_FILE LOCAL_DNS_ACTION_SUMMARY_FILE LOCAL_DNS_EVENTS_FILE LOCAL_DNS_METRICS_FILE LOCAL_PROXY_STATUS_FILE LOCAL_PROXY_SUMMARY_FILE LOCAL_PROXY_BENCHMARK_FILE LOCAL_PROXY_BENCHMARK_SUMMARY_FILE LOCAL_PROXY_COMPARISON_FILE LOCAL_PROXY_RECOMMENDATION_FILE
readonly COPILOT_NETWORK_STATUS_FILE COPILOT_NETWORK_SUMMARY_FILE COPILOT_NETWORK_METRICS_FILE COPILOT_NETWORK_DIAGNOSIS_FILE COPILOT_NETWORK_RECOMMENDATION_FILE COPILOT_NETWORK_RECOMMENDATION_JSON COPILOT_ROUTE_ADVISOR_STATUS_FILE COPILOT_ROUTE_ADVISOR_SUMMARY_FILE NETWORK_CONTROL_PLANE_STATUS_FILE NETWORK_CONTROL_PLANE_SUMMARY_FILE NETWORK_CONTROL_PLANE_REPORT_FILE NETWORK_CONTROL_PLANE_EVENTS_FILE NETWORK_CONTROL_PLANE_JSON_FILE HEALTH_STATUS_FILE HEALTH_SUMMARY_FILE HEALTH_REPORT_FILE HEALTH_EVENTS_FILE SYNC_LOCAL_AUTH_STATUS_FILE SYNC_LOCAL_AUTH_SUMMARY_FILE SYNC_LOCAL_AUTH_REPORT_FILE

HOOK_AUDIT_REPORT="${LOG_DIR}/post-create-hook-audit.tsv"
CAPABILITY_AUDIT_REPORT="${LOG_DIR}/post-create-capability-audit.tsv"
ARTIFACT_AUDIT_REPORT="${LOG_DIR}/post-create-network-artifacts.tsv"
ENV_BASELINE_REPORT="${LOG_DIR}/post-create-environment-baseline.tsv"
TOOLCHAIN_AUDIT_REPORT="${LOG_DIR}/post-create-toolchain-audit.tsv"
CONTROL_PLANE_BASELINE_REPORT="${LOG_DIR}/post-create-control-plane-baseline.tsv"
TOOLCHAIN_CONTRACT_REPORT="${LOG_DIR}/post-create-toolchain-contract.tsv"
readonly HOOK_AUDIT_REPORT CAPABILITY_AUDIT_REPORT ARTIFACT_AUDIT_REPORT ENV_BASELINE_REPORT TOOLCHAIN_AUDIT_REPORT CONTROL_PLANE_BASELINE_REPORT TOOLCHAIN_CONTRACT_REPORT

{
    printf 'component\tpath\tdetected_version\texpected_version\tversion_status\texists\tbash_n\tmode\tshellcheck\n'
} > "${HOOK_AUDIT_REPORT}" 2> /dev/null || true

_audit_one_script() {
    local label="${1:-unknown}" path="${2:-}" expected="${3:-}" version="unknown" exists="false" bash_n="not-run" mode="unknown" shellcheck_status="not-run" vstatus="unknown" rc=0
    if [[ -r "${path}" ]]; then
        exists="true"
        version="$(script_declared_version "${path}")"
        if [[ -x "${path}" ]]; then mode="executable"; else mode="not-executable"; fi
        shellcheck_status="$(script_shellcheck_status "${path}")"
        vstatus="$(version_status "${version}" "${expected}")"
        if script_bash_syntax_ok "${path}"; then
            bash_n="ok"
        else
            rc=$?
            bash_n="failed:${rc}"
            SCRIPT_AUDIT_STATUS="DEGRADED"
            SCRIPT_AUDIT_WARNINGS=$((SCRIPT_AUDIT_WARNINGS + 1))
            SCRIPT_BASH_N_FAILURES=$((SCRIPT_BASH_N_FAILURES + 1))
            warn "Script audit: bash -n falhou para ${label} (${path}) rc=${rc} shellcheck=${shellcheck_status}"
        fi
        case "${shellcheck_status}" in
            failed:*)
                SCRIPT_AUDIT_STATUS="DEGRADED"
                SCRIPT_AUDIT_WARNINGS=$((SCRIPT_AUDIT_WARNINGS + 1))
                warn "Script audit: shellcheck sinalizou ${label} (${path}) status=${shellcheck_status}"
                ;;
        esac
        case "${vstatus}" in
            mismatch | missing | unknown)
                if [[ -n "${expected}" ]]; then
                    SCRIPT_AUDIT_STATUS="DEGRADED"
                    SCRIPT_AUDIT_WARNINGS=$((SCRIPT_AUDIT_WARNINGS + 1))
                    SCRIPT_VERSION_MISMATCHES=$((SCRIPT_VERSION_MISMATCHES + 1))
                    warn "Script audit: versão ${label}=${version}, esperado=${expected}, status=${vstatus}"
                fi
                ;;
        esac
        log "Script audit: ${label} version=${version} expected=${expected:-not-pinned} status=${vstatus} bash_n=${bash_n} mode=${mode} shellcheck=${shellcheck_status}"
    else
        exists="false"
        version="missing"
        vstatus="missing"
        SCRIPT_AUDIT_STATUS="DEGRADED"
        SCRIPT_AUDIT_WARNINGS=$((SCRIPT_AUDIT_WARNINGS + 1))
        SCRIPT_MISSING_COUNT=$((SCRIPT_MISSING_COUNT + 1))
        warn "Script audit: ${label} ausente/ilegível: ${path}"
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "${label}" "${path}" "${version}" "${expected:-}" "${vstatus}" "${exists}" "${bash_n}" "${mode}" "${shellcheck_status}" >> "${HOOK_AUDIT_REPORT}" 2> /dev/null || true
}

_audit_one_script "post-create" "${BASH_SOURCE[0]}" "${EXPECTED_POST_CREATE_VERSION}"
_audit_one_script "post-start" "${POST_START_SCRIPT}" "${EXPECTED_POST_START_VERSION}"
_audit_one_script "post-attach" "${POST_ATTACH_SCRIPT}" "${EXPECTED_POST_ATTACH_VERSION}"
_audit_one_script "healthcheck" "${HEALTHCHECK_SCRIPT}" "${EXPECTED_HEALTHCHECK_VERSION}"
_audit_one_script "sync-local-auth" "${SYNC_LOCAL_AUTH_SCRIPT}" "${EXPECTED_SYNC_LOCAL_AUTH_VERSION}"
_audit_one_script "nss-gatekeeper" "${NSS_GATEKEEPER_SOURCE}" "${EXPECTED_NSS_GATEKEEPER_VERSION}"
_audit_one_script "local-dns-cache" "${LOCAL_DNS_SCRIPT}" "${EXPECTED_LOCAL_DNS_VERSION}"
_audit_one_script "github-api-route-fix" "${GITHUB_ROUTE_SCRIPT}" "${EXPECTED_GITHUB_ROUTE_VERSION}"
_audit_one_script "github-copilot-network-manager" "${COPILOT_MANAGER_SCRIPT}" "${EXPECTED_COPILOT_MANAGER_VERSION}"
_audit_one_script "copilot-route-advisor" "${COPILOT_ADVISOR_SCRIPT}" "${EXPECTED_COPILOT_ADVISOR_VERSION}"
_audit_one_script "local-copilot-proxy" "${LOCAL_PROXY_SCRIPT}" "${EXPECTED_LOCAL_PROXY_VERSION}"
_audit_one_script "network-control-plane-state" "${NETWORK_CONTROL_PLANE_SCRIPT}" "${EXPECTED_NETWORK_CONTROL_PLANE_VERSION}"

ENDPOINT_REGISTRY_STATUS="$(registry_status "${ENDPOINT_REGISTRY_FILE}")"
ENDPOINT_REGISTRY_ROWS="$(registry_row_count "${ENDPOINT_REGISTRY_FILE}")"
ENDPOINT_REGISTRY_BAD_ROWS="$(registry_bad_row_count "${ENDPOINT_REGISTRY_FILE}")"
ENDPOINT_REGISTRY_ARTIFACT_STATE="$(artifact_readiness_status_extended "${ENDPOINT_REGISTRY_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
ENDPOINT_REGISTRY_DIAGNOSTICS="$(registry_diagnostics "${ENDPOINT_REGISTRY_FILE}")"
readonly ENDPOINT_REGISTRY_STATUS ENDPOINT_REGISTRY_ROWS ENDPOINT_REGISTRY_BAD_ROWS ENDPOINT_REGISTRY_ARTIFACT_STATE ENDPOINT_REGISTRY_DIAGNOSTICS

if [[ "${ENDPOINT_REGISTRY_STATUS}" != "ok" ]]; then
    SCRIPT_AUDIT_STATUS="DEGRADED"
    SCRIPT_AUDIT_WARNINGS=$((SCRIPT_AUDIT_WARNINGS + 1))
    warn "Endpoint registry degradado: status=${ENDPOINT_REGISTRY_STATUS}; ${ENDPOINT_REGISTRY_DIAGNOSTICS}; file=${ENDPOINT_REGISTRY_FILE}"
    if [[ "${STRICT_ENDPOINT_REGISTRY_AUDIT}" == "true" ]]; then
        error "Endpoint registry: falha em modo estrito."
        exit 1
    fi
fi

{
    printf 'capability\tcommand\tstatus\treason\n'
    printf 'bash\tbash\t%s\t%s\n' "$(capability_status bash)" "lifecycle interpreter"
    printf 'node\tnode\t%s\t%s\n' "$(capability_status node)" "Node runtime baseline"
    printf 'npm\tnpm\t%s\t%s\n' "$(capability_status npm)" "package governance"
    printf 'make\tmake\t%s\t%s\n' "$(capability_status make)" "Makefile governance"
    printf 'git\tgit\t%s\t%s\n' "$(capability_status git)" "workspace provenance"
    printf 'curl\tcurl\t%s\t%s\n' "$(capability_status curl)" "bounded network probes and GitHub/Copilot diagnostics"
    printf 'timeout\ttimeout\t%s\t%s\n' "$(capability_status timeout)" "bounded lifecycle and /dev/tcp probes"
    printf 'flock\tflock\t%s\t%s\n' "$(capability_status flock)" "network/history lock coordination"
    printf 'jq\tjq\t%s\t%s\n' "$(capability_status jq)" "optional JSON validation/reporting"
    printf 'awk\tawk\t%s\t%s\n' "$(capability_status awk)" "portable reports and validators"
    printf 'sed\tsed\t%s\t%s\n' "$(capability_status sed)" "sanitization and report formatting"
    printf 'stat\tstat\t%s\t%s\n' "$(capability_status stat)" "metadata/freshness"
    printf 'getent\tgetent\t%s\t%s\n' "$(capability_status getent)" "identity/NSS audit"
    printf 'tee\ttee\t%s\t%s\n' "$(capability_status tee)" "inode-preserving writes in runtime scripts"
    printf 'openssl\topenssl\t%s\t%s\n' "$(capability_status openssl)" "optional TLS diagnostics"
    printf 'shellcheck\tshellcheck\t%s\t%s\n' "$(capability_status shellcheck)" "optional static validation"
    printf 'tinyproxy\ttinyproxy\t%s\t%s\n' "$(capability_status tinyproxy)" "optional local Copilot HTTP CONNECT proxy"
    printf 'dnsmasq\tdnsmasq\t%s\t%s\n' "$(capability_status dnsmasq)" "optional local DNS cache"
    printf 'dig\tdig\t%s\t%s\n' "$(capability_status dig)" "optional DNS diagnostics/benchmarking"
    printf 'certutil\tcertutil\t%s\t%s\n' "$(capability_status certutil)" "NSS database diagnostics"
} > "${CAPABILITY_AUDIT_REPORT}" 2> /dev/null || true

{
    printf 'artifact\tpath\tstate\tstatus_hint\n'
    printf 'endpoint_registry\t%s\t%s\trows=%s,bad=%s,status=%s\n' "${ENDPOINT_REGISTRY_FILE}" "${ENDPOINT_REGISTRY_ARTIFACT_STATE}" "${ENDPOINT_REGISTRY_ROWS}" "${ENDPOINT_REGISTRY_BAD_ROWS}" "${ENDPOINT_REGISTRY_STATUS}"
    printf 'github_route_status\t%s\t%s\tpost-start/runtime\n' "${GITHUB_ROUTE_STATUS_FILE}" "$(artifact_readiness_status_extended "${GITHUB_ROUTE_STATUS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'github_route_summary\t%s\t%s\tpost-start/runtime\n' "${GITHUB_ROUTE_SUMMARY_FILE}" "$(artifact_readiness_status_extended "${GITHUB_ROUTE_SUMMARY_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'github_route_metrics\t%s\t%s\tpost-start/runtime\n' "${GITHUB_ROUTE_METRICS_FILE}" "$(artifact_readiness_status_extended "${GITHUB_ROUTE_METRICS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'github_route_benchmark\t%s\t%s\tmanual-long-job\n' "${GITHUB_ROUTE_BENCHMARK_FILE}" "$(artifact_readiness_status_extended "${GITHUB_ROUTE_BENCHMARK_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'github_route_benchmark_summary\t%s\t%s\tmanual-long-job\n' "${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}" "$(artifact_readiness_status_extended "${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'github_route_recommendation\t%s\t%s\tmanual-policy-artifact\n' "${GITHUB_ROUTE_RECOMMENDATION_FILE}" "$(artifact_readiness_status_extended "${GITHUB_ROUTE_RECOMMENDATION_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'github_route_action_summary\t%s\t%s\taction-artifact-non-runtime\n' "${GITHUB_ROUTE_ACTION_SUMMARY_FILE}" "$(artifact_readiness_status_extended "${GITHUB_ROUTE_ACTION_SUMMARY_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'local_dns_status\t%s\t%s\truntime\n' "${LOCAL_DNS_STATUS_FILE}" "$(artifact_readiness_status_extended "${LOCAL_DNS_STATUS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'local_dns_summary\t%s\t%s\truntime\n' "${LOCAL_DNS_SUMMARY_FILE}" "$(artifact_readiness_status_extended "${LOCAL_DNS_SUMMARY_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'local_dns_action_summary\t%s\t%s\taction-artifact-non-runtime\n' "${LOCAL_DNS_ACTION_SUMMARY_FILE}" "$(artifact_readiness_status_extended "${LOCAL_DNS_ACTION_SUMMARY_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'local_dns_events\t%s\t%s\truntime-events\n' "${LOCAL_DNS_EVENTS_FILE}" "$(artifact_readiness_status_extended "${LOCAL_DNS_EVENTS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'local_dns_metrics\t%s\t%s\truntime\n' "${LOCAL_DNS_METRICS_FILE}" "$(artifact_readiness_status_extended "${LOCAL_DNS_METRICS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'local_proxy_status\t%s\t%s\truntime-or-off\n' "${LOCAL_PROXY_STATUS_FILE}" "$(artifact_readiness_status_extended "${LOCAL_PROXY_STATUS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'local_proxy_summary\t%s\t%s\truntime-or-off\n' "${LOCAL_PROXY_SUMMARY_FILE}" "$(artifact_readiness_status_extended "${LOCAL_PROXY_SUMMARY_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'local_proxy_benchmark\t%s\t%s\tmanual-long-job\n' "${LOCAL_PROXY_BENCHMARK_FILE}" "$(artifact_readiness_status_extended "${LOCAL_PROXY_BENCHMARK_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'local_proxy_benchmark_summary\t%s\t%s\tmanual-long-job\n' "${LOCAL_PROXY_BENCHMARK_SUMMARY_FILE}" "$(artifact_readiness_status_extended "${LOCAL_PROXY_BENCHMARK_SUMMARY_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'local_proxy_comparison\t%s\t%s\tmanual-compare\n' "${LOCAL_PROXY_COMPARISON_FILE}" "$(artifact_readiness_status_extended "${LOCAL_PROXY_COMPARISON_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'local_proxy_recommendation\t%s\t%s\tmanual-policy-artifact\n' "${LOCAL_PROXY_RECOMMENDATION_FILE}" "$(artifact_readiness_status_extended "${LOCAL_PROXY_RECOMMENDATION_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'copilot_network_status\t%s\t%s\truntime\n' "${COPILOT_NETWORK_STATUS_FILE}" "$(artifact_readiness_status_extended "${COPILOT_NETWORK_STATUS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'copilot_network_summary\t%s\t%s\truntime\n' "${COPILOT_NETWORK_SUMMARY_FILE}" "$(artifact_readiness_status_extended "${COPILOT_NETWORK_SUMMARY_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'copilot_network_metrics\t%s\t%s\truntime\n' "${COPILOT_NETWORK_METRICS_FILE}" "$(artifact_readiness_status_extended "${COPILOT_NETWORK_METRICS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'copilot_network_diagnosis\t%s\t%s\truntime\n' "${COPILOT_NETWORK_DIAGNOSIS_FILE}" "$(artifact_readiness_status_extended "${COPILOT_NETWORK_DIAGNOSIS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'copilot_network_recommendation\t%s\t%s\tmanual-policy-artifact\n' "${COPILOT_NETWORK_RECOMMENDATION_FILE}" "$(artifact_readiness_status_extended "${COPILOT_NETWORK_RECOMMENDATION_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'copilot_network_recommendation_json\t%s\t%s\tmanual-policy-artifact\n' "${COPILOT_NETWORK_RECOMMENDATION_JSON}" "$(artifact_readiness_status_extended "${COPILOT_NETWORK_RECOMMENDATION_JSON}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'copilot_route_advisor_status\t%s\t%s\tmanual-passive-advisor\n' "${COPILOT_ROUTE_ADVISOR_STATUS_FILE}" "$(artifact_readiness_status_extended "${COPILOT_ROUTE_ADVISOR_STATUS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'copilot_route_advisor_summary\t%s\t%s\tmanual-passive-advisor\n' "${COPILOT_ROUTE_ADVISOR_SUMMARY_FILE}" "$(artifact_readiness_status_extended "${COPILOT_ROUTE_ADVISOR_SUMMARY_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'network_control_plane_status\t%s\t%s\taggregator-runtime\n' "${NETWORK_CONTROL_PLANE_STATUS_FILE}" "$(artifact_readiness_status_extended "${NETWORK_CONTROL_PLANE_STATUS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'network_control_plane_summary\t%s\t%s\taggregator-runtime\n' "${NETWORK_CONTROL_PLANE_SUMMARY_FILE}" "$(artifact_readiness_status_extended "${NETWORK_CONTROL_PLANE_SUMMARY_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'network_control_plane_report\t%s\t%s\taggregator-runtime\n' "${NETWORK_CONTROL_PLANE_REPORT_FILE}" "$(artifact_readiness_status_extended "${NETWORK_CONTROL_PLANE_REPORT_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'network_control_plane_events\t%s\t%s\taggregator-runtime\n' "${NETWORK_CONTROL_PLANE_EVENTS_FILE}" "$(artifact_readiness_status_extended "${NETWORK_CONTROL_PLANE_EVENTS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'network_control_plane_json\t%s\t%s\taggregator-runtime\n' "${NETWORK_CONTROL_PLANE_JSON_FILE}" "$(artifact_readiness_status_extended "${NETWORK_CONTROL_PLANE_JSON_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'health_status\t%s\t%s\thealthcheck-runtime\n' "${HEALTH_STATUS_FILE}" "$(artifact_readiness_status_extended "${HEALTH_STATUS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'health_summary\t%s\t%s\thealthcheck-runtime\n' "${HEALTH_SUMMARY_FILE}" "$(artifact_readiness_status_extended "${HEALTH_SUMMARY_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'health_report\t%s\t%s\thealthcheck-runtime\n' "${HEALTH_REPORT_FILE}" "$(artifact_readiness_status_extended "${HEALTH_REPORT_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'health_events\t%s\t%s\thealthcheck-runtime-events\n' "${HEALTH_EVENTS_FILE}" "$(artifact_readiness_status_extended "${HEALTH_EVENTS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'sync_local_auth_status\t%s\t%s\tpost-create-helper\n' "${SYNC_LOCAL_AUTH_STATUS_FILE}" "$(artifact_readiness_status_extended "${SYNC_LOCAL_AUTH_STATUS_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'sync_local_auth_summary\t%s\t%s\tpost-create-helper\n' "${SYNC_LOCAL_AUTH_SUMMARY_FILE}" "$(artifact_readiness_status_extended "${SYNC_LOCAL_AUTH_SUMMARY_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
    printf 'sync_local_auth_report\t%s\t%s\tpost-create-helper\n' "${SYNC_LOCAL_AUTH_REPORT_FILE}" "$(artifact_readiness_status_extended "${SYNC_LOCAL_AUTH_REPORT_FILE}" "${ARTIFACT_MAX_AGE_SECONDS}")"
} > "${ARTIFACT_AUDIT_REPORT}" 2> /dev/null || true

PACKAGE_VERSION="$(json_manifest_version "${PROJECT_ROOT}/package.json")"
MAKEFILE_VERSION="$(makefile_declared_version "${PROJECT_ROOT}/Makefile")"
DEVCONTAINER_JSON_VERSION="$(devcontainer_declared_version "${DEVCONTAINER_JSON_FILE}")"
DOCKERFILE_VERSION="$(dockerfile_declared_version "${DOCKERFILE_FILE}")"
PACKAGE_STATUS="$(version_status "${PACKAGE_VERSION}" "${EXPECTED_PACKAGE_VERSION}")"
MAKEFILE_STATUS="$(version_status "${MAKEFILE_VERSION}" "${EXPECTED_MAKEFILE_VERSION}")"
DEVCONTAINER_JSON_STATUS="$(version_status "${DEVCONTAINER_JSON_VERSION}" "${EXPECTED_DEVCONTAINER_VERSION}")"
DOCKERFILE_STATUS="$(version_status "${DOCKERFILE_VERSION}" "${EXPECTED_DOCKERFILE_VERSION}")"
readonly PACKAGE_VERSION MAKEFILE_VERSION DEVCONTAINER_JSON_VERSION DOCKERFILE_VERSION PACKAGE_STATUS MAKEFILE_STATUS DEVCONTAINER_JSON_STATUS DOCKERFILE_STATUS
{
    printf 'artifact\tpath\tdetected_version\texpected_version\tstatus\n'
    printf 'package.json\t%s\t%s\t%s\t%s\n' "${PROJECT_ROOT}/package.json" "${PACKAGE_VERSION}" "${EXPECTED_PACKAGE_VERSION}" "${PACKAGE_STATUS}"
    printf 'Makefile\t%s\t%s\t%s\t%s\n' "${PROJECT_ROOT}/Makefile" "${MAKEFILE_VERSION}" "${EXPECTED_MAKEFILE_VERSION}" "${MAKEFILE_STATUS}"
    printf 'devcontainer.json\t%s\t%s\t%s\t%s\n' "${DEVCONTAINER_JSON_FILE}" "${DEVCONTAINER_JSON_VERSION}" "${EXPECTED_DEVCONTAINER_VERSION}" "${DEVCONTAINER_JSON_STATUS}"
    printf 'Dockerfile\t%s\t%s\t%s\t%s\n' "${DOCKERFILE_FILE}" "${DOCKERFILE_VERSION}" "${EXPECTED_DOCKERFILE_VERSION}" "${DOCKERFILE_STATUS}"
} > "${TOOLCHAIN_AUDIT_REPORT}" 2> /dev/null || true

case "${PACKAGE_STATUS}" in missing | mismatch | unknown)
    SCRIPT_AUDIT_STATUS="DEGRADED"
    SCRIPT_AUDIT_WARNINGS=$((SCRIPT_AUDIT_WARNINGS + 1))
    warn "Toolchain audit: package.json status=${PACKAGE_STATUS}, version=${PACKAGE_VERSION}, esperado=${EXPECTED_PACKAGE_VERSION}"
    ;;
esac
case "${MAKEFILE_STATUS}" in missing | mismatch | unknown)
    SCRIPT_AUDIT_STATUS="DEGRADED"
    SCRIPT_AUDIT_WARNINGS=$((SCRIPT_AUDIT_WARNINGS + 1))
    warn "Toolchain audit: Makefile status=${MAKEFILE_STATUS}, version=${MAKEFILE_VERSION}, esperado=${EXPECTED_MAKEFILE_VERSION}"
    ;;
esac
case "${DEVCONTAINER_JSON_STATUS}" in missing | mismatch | unknown)
    SCRIPT_AUDIT_STATUS="DEGRADED"
    SCRIPT_AUDIT_WARNINGS=$((SCRIPT_AUDIT_WARNINGS + 1))
    warn "Toolchain audit: devcontainer.json status=${DEVCONTAINER_JSON_STATUS}, version=${DEVCONTAINER_JSON_VERSION}, esperado=${EXPECTED_DEVCONTAINER_VERSION}"
    ;;
esac
case "${DOCKERFILE_STATUS}" in missing | mismatch | unknown)
    SCRIPT_AUDIT_STATUS="DEGRADED"
    SCRIPT_AUDIT_WARNINGS=$((SCRIPT_AUDIT_WARNINGS + 1))
    warn "Toolchain audit: Dockerfile status=${DOCKERFILE_STATUS}, version=${DOCKERFILE_VERSION}, esperado=${EXPECTED_DOCKERFILE_VERSION}"
    ;;
esac

PACKAGE_REQUIRED_SCRIPTS=(
    "network:state"
    "network:state:json"
    "network:state:doctor"
    "network:control-plane"
    "network:control-plane:doctor"
    "network:registry:status"
    "network:advisor"
    "network:compare-transports"
)
MAKEFILE_REQUIRED_TARGETS=(
    "network-state"
    "network-state-json"
    "network-state-doctor"
    "network-control-plane"
    "network-control-plane-json"
    "network-control-plane-doctor"
)
TOOLCHAIN_CONTRACT_STATUS="ok"
TOOLCHAIN_CONTRACT_MISSING=0
{
    printf 'surface\tname\tstatus\tpath\n'
    for required_script in "${PACKAGE_REQUIRED_SCRIPTS[@]}"; do
        if package_script_exists "${PROJECT_ROOT}/package.json" "${required_script}"; then
            printf 'package.json\t%s\tok\t%s\n' "${required_script}" "${PROJECT_ROOT}/package.json"
        else
            printf 'package.json\t%s\tmissing\t%s\n' "${required_script}" "${PROJECT_ROOT}/package.json"
            TOOLCHAIN_CONTRACT_STATUS="degraded"
            TOOLCHAIN_CONTRACT_MISSING=$((TOOLCHAIN_CONTRACT_MISSING + 1))
        fi
    done
    for required_target in "${MAKEFILE_REQUIRED_TARGETS[@]}"; do
        if make_target_exists "${PROJECT_ROOT}/Makefile" "${required_target}"; then
            printf 'Makefile\t%s\tok\t%s\n' "${required_target}" "${PROJECT_ROOT}/Makefile"
        else
            printf 'Makefile\t%s\tmissing\t%s\n' "${required_target}" "${PROJECT_ROOT}/Makefile"
            TOOLCHAIN_CONTRACT_STATUS="degraded"
            TOOLCHAIN_CONTRACT_MISSING=$((TOOLCHAIN_CONTRACT_MISSING + 1))
        fi
    done
} > "${TOOLCHAIN_CONTRACT_REPORT}" 2> /dev/null || true
readonly TOOLCHAIN_CONTRACT_STATUS TOOLCHAIN_CONTRACT_MISSING
if [[ "${TOOLCHAIN_CONTRACT_STATUS}" != "ok" ]]; then
    SCRIPT_AUDIT_STATUS="DEGRADED"
    SCRIPT_AUDIT_WARNINGS=$((SCRIPT_AUDIT_WARNINGS + 1))
    warn "Toolchain contract: status=${TOOLCHAIN_CONTRACT_STATUS}, missing=${TOOLCHAIN_CONTRACT_MISSING}, report=${TOOLCHAIN_CONTRACT_REPORT}"
fi

{
    printf 'key\tvalue\tpolicy\n'
    printf 'post_create_version\t%s\tstructural-source-of-truth\n' "${SCRIPT_VERSION}"
    printf 'post_start_expected\t%s\truntime-fail-safe\n' "${EXPECTED_POST_START_VERSION}"
    printf 'post_attach_expected\t%s\tpassive-read-only\n' "${EXPECTED_POST_ATTACH_VERSION}"
    printf 'route_fix_expected\t%s\tapi.github.com-only-hosts-mutation\n' "${EXPECTED_GITHUB_ROUTE_VERSION}"
    printf 'local_dns_expected\t%s\tdns-cache-auto-fail-closed\n' "${EXPECTED_LOCAL_DNS_VERSION}"
    printf 'manager_expected\t%s\tobservational-orchestrator\n' "${EXPECTED_COPILOT_MANAGER_VERSION}"
    printf 'advisor_expected\t%s\tpassive-route-advisor\n' "${EXPECTED_COPILOT_ADVISOR_VERSION}"
    printf 'local_proxy_expected\t%s\tloopback-opt-in-no-global-env\n' "${EXPECTED_LOCAL_PROXY_VERSION}"
    printf 'endpoint_registry_expected\t%s\tcanonical-tsv-5-fields\n' "${EXPECTED_ENDPOINT_REGISTRY_VERSION}"
    printf 'package_expected\t%s\tnpm-script-surface\n' "${EXPECTED_PACKAGE_VERSION}"
    printf 'makefile_expected\t%s\thuman-operation-surface\n' "${EXPECTED_MAKEFILE_VERSION}"
    printf 'network_control_plane_expected\t%s\tpassive-aggregator\n' "${EXPECTED_NETWORK_CONTROL_PLANE_VERSION}"
    printf 'enable_manager\t%s\tfrom-env\n' "${DEVCONTAINER_ENABLE_COPILOT_NETWORK_MANAGER:-unset}"
    printf 'manager_post_start_action\t%s\tlong-actions-sanitized-by-post-start\n' "${DEVCONTAINER_COPILOT_NETWORK_MANAGER_POST_START_ACTION:-unset}"
    printf 'enable_route_fix\t%s\tfrom-env\n' "${DEVCONTAINER_ENABLE_GITHUB_API_ROUTE_FIX:-unset}"
    printf 'enable_local_dns_cache\t%s\tfrom-env\n' "${DEVCONTAINER_ENABLE_LOCAL_DNS_CACHE:-unset}"
    printf 'local_dns_mode\t%s\tfrom-env\n' "${DEVCONTAINER_LOCAL_DNS_CACHE_MODE:-${DEVCONTAINER_LOCAL_DNS_MODE:-unset}}"
    printf 'local_dns_write_resolv_conf\t%s\truntime-only-fail-closed\n' "${DEVCONTAINER_LOCAL_DNS_WRITE_RESOLV_CONF:-unset}"
    printf 'enable_local_proxy\t%s\tfrom-env\n' "${DEVCONTAINER_ENABLE_LOCAL_COPILOT_PROXY:-unset}"
    printf 'local_proxy_mode\t%s\tfrom-env\n' "${DEVCONTAINER_LOCAL_COPILOT_PROXY_MODE:-${DEVCONTAINER_COPILOT_PROXY_MODE:-unset}}"
    printf 'transport_profile\t%s\tmanager-policy\n' "${DEVCONTAINER_COPILOT_TRANSPORT_PROFILE:-unset}"
    printf 'probe_proxy_mode\t%s\tmeasurement-policy\n' "${DEVCONTAINER_COPILOT_PROBE_PROXY_MODE:-unset}"
    printf 'apply_transport_recommendation\t%s\tmust-remain-explicit\n' "${DEVCONTAINER_POST_START_APPLY_TRANSPORT_RECOMMENDATION:-unset}"
    printf 'endpoint_registry_file\t%s\tregistry-source\n' "${ENDPOINT_REGISTRY_FILE}"
} > "${ENV_BASELINE_REPORT}" 2> /dev/null || true

{
    printf 'baseline\tstatus\tdetails\n'
    printf 'scripts\t%s\twarnings=%s,missing=%s,bash_n_failures=%s,version_mismatches=%s,report=%s\n' "${SCRIPT_AUDIT_STATUS}" "${SCRIPT_AUDIT_WARNINGS}" "${SCRIPT_MISSING_COUNT}" "${SCRIPT_BASH_N_FAILURES}" "${SCRIPT_VERSION_MISMATCHES}" "${HOOK_AUDIT_REPORT}"
    printf 'endpoint_registry\t%s\trows=%s,bad=%s,state=%s,file=%s\n' "${ENDPOINT_REGISTRY_STATUS}" "${ENDPOINT_REGISTRY_ROWS}" "${ENDPOINT_REGISTRY_BAD_ROWS}" "${ENDPOINT_REGISTRY_ARTIFACT_STATE}" "${ENDPOINT_REGISTRY_FILE}"
    printf 'package_json\t%s\tdetected=%s,expected=%s,path=%s\n' "${PACKAGE_STATUS}" "${PACKAGE_VERSION}" "${EXPECTED_PACKAGE_VERSION}" "${PROJECT_ROOT}/package.json"
    printf 'makefile\t%s\tdetected=%s,expected=%s,path=%s\n' "${MAKEFILE_STATUS}" "${MAKEFILE_VERSION}" "${EXPECTED_MAKEFILE_VERSION}" "${PROJECT_ROOT}/Makefile"
    printf 'devcontainer_json\t%s\tdetected=%s,expected=%s,path=%s\n' "${DEVCONTAINER_JSON_STATUS}" "${DEVCONTAINER_JSON_VERSION}" "${EXPECTED_DEVCONTAINER_VERSION}" "${DEVCONTAINER_JSON_FILE}"
    printf 'dockerfile\t%s\tdetected=%s,expected=%s,path=%s\n' "${DOCKERFILE_STATUS}" "${DOCKERFILE_VERSION}" "${EXPECTED_DOCKERFILE_VERSION}" "${DOCKERFILE_FILE}"
    printf 'capabilities\trecorded\treport=%s\n' "${CAPABILITY_AUDIT_REPORT}"
    printf 'artifacts\trecorded\treport=%s\n' "${ARTIFACT_AUDIT_REPORT}"
    printf 'env_policy\trecorded\treport=%s\n' "${ENV_BASELINE_REPORT}"
    printf 'toolchain_contract\t%s\tmissing=%s,report=%s\n' "${TOOLCHAIN_CONTRACT_STATUS}" "${TOOLCHAIN_CONTRACT_MISSING}" "${TOOLCHAIN_CONTRACT_REPORT}"
} > "${CONTROL_PLANE_BASELINE_REPORT}" 2> /dev/null || true

log "Capability audit concluído: ${CAPABILITY_AUDIT_REPORT}"
log "Network artifact audit concluído: ${ARTIFACT_AUDIT_REPORT}; endpoint_registry=${ENDPOINT_REGISTRY_STATUS}; rows=${ENDPOINT_REGISTRY_ROWS}; bad=${ENDPOINT_REGISTRY_BAD_ROWS}"
log "Environment baseline preservado: ${ENV_BASELINE_REPORT}"
log "Toolchain audit concluído: ${TOOLCHAIN_AUDIT_REPORT}"
log "Toolchain contract concluído: ${TOOLCHAIN_CONTRACT_REPORT}; status=${TOOLCHAIN_CONTRACT_STATUS}; missing=${TOOLCHAIN_CONTRACT_MISSING}"
log "Control-plane baseline concluído: ${CONTROL_PLANE_BASELINE_REPORT}"

readonly SCRIPT_AUDIT_STATUS SCRIPT_AUDIT_WARNINGS SCRIPT_VERSION_MISMATCHES SCRIPT_MISSING_COUNT SCRIPT_BASH_N_FAILURES
if [[ "${SCRIPT_AUDIT_STATUS}" != "OK" && "${STRICT_SCRIPT_AUDIT}" == "true" ]]; then
    error "Script audit: falha em modo estrito. Veja ${HOOK_AUDIT_REPORT}"
    exit 1
fi
if ((SCRIPT_VERSION_MISMATCHES > 0)) && [[ "${STRICT_VERSION_AUDIT}" == "true" ]]; then
    error "Version audit: mismatch em modo estrito. Veja ${HOOK_AUDIT_REPORT}"
    exit 1
fi
log "Script audit concluído: status=${SCRIPT_AUDIT_STATUS}; warnings=${SCRIPT_AUDIT_WARNINGS}; version_mismatches=${SCRIPT_VERSION_MISMATCHES}; report=${HOOK_AUDIT_REPORT}"

# =============================================================================
# SECTION 12 — Manifesto persistente (opcional; atômico; sem segredos)
# =============================================================================
log "Consolidando manifesto de estado..."

STATE_SWAP="${STATE_FILE}.tmp"
ensure_dir "$(dirname "${STATE_FILE}")"

# calcula duração parcial até aqui (para manifesto)
BOOT_NOW="$(date +%s 2> /dev/null || echo 0)"
BOOT_DURATION_SO_FAR=$((BOOT_NOW - BOOT_START_TIME))

if [[ "${SKIP_STATE_FILE}" == "true" ]]; then
    log "Persistência desativada; manifesto não será gravado."
else
    {
        printf '%s\n' \
            "# =============================================================================" \
            "# SIMBIOSE — STATE MANIFESTO" \
            "# Version: ${SCRIPT_VERSION}" \
            "# =============================================================================" \
            "" \
            "initialized_at=$(date -Is 2> /dev/null || echo unknown)" \
            "script_name=${SCRIPT_NAME}" \
            "script_version=${SCRIPT_VERSION}" \
            "script_hash=${SCRIPT_HASH:0:8}" \
            "total_setup_seconds=${BOOT_DURATION_SO_FAR}" \
            "" \
            "user=${CURRENT_USER}" \
            "uid=${CURRENT_UID}" \
            "gid=${CURRENT_GID}" \
            "groups=$(id -Gn 2> /dev/null | tr ' ' ',' || echo unknown)" \
            "nss_profile=EXTENDED" \
            "" \
            "home=${HOME_DIR}" \
            "project_root=${PROJECT_ROOT}" \
            "devcontainer_dir=${DEVCONTAINER_DIR}" \
            "log_path=${LOG_FILE}" \
            "" \
            "system_arch=$(uname -m 2> /dev/null || echo unknown)" \
            "node_version=$(node -v 2> /dev/null || echo N/A)" \
            "network_status=${NET_STATUS:-unknown}" \
            "network_probe_url=${NETWORK_PROBE_URL:-unknown}" \
            "script_audit_status=${SCRIPT_AUDIT_STATUS:-unknown}" \
            "script_audit_warnings=${SCRIPT_AUDIT_WARNINGS:-0}" \
            "script_version_mismatches=${SCRIPT_VERSION_MISMATCHES:-0}" \
            "script_missing_count=${SCRIPT_MISSING_COUNT:-0}" \
            "script_bash_n_failures=${SCRIPT_BASH_N_FAILURES:-0}" \
            "script_audit_report=${HOOK_AUDIT_REPORT:-unknown}" \
            "capability_audit_report=${CAPABILITY_AUDIT_REPORT:-unknown}" \
            "network_artifact_audit_report=${ARTIFACT_AUDIT_REPORT:-unknown}" \
            "environment_baseline_report=${ENV_BASELINE_REPORT:-unknown}" \
            "toolchain_audit_report=${TOOLCHAIN_AUDIT_REPORT:-unknown}" \
            "toolchain_contract_report=${TOOLCHAIN_CONTRACT_REPORT:-unknown}" \
            "toolchain_contract_status=${TOOLCHAIN_CONTRACT_STATUS:-unknown}" \
            "toolchain_contract_missing=${TOOLCHAIN_CONTRACT_MISSING:-0}" \
            "control_plane_baseline_report=${CONTROL_PLANE_BASELINE_REPORT:-unknown}" \
            "endpoint_registry=${ENDPOINT_REGISTRY_FILE:-unknown}" \
            "endpoint_registry_status=${ENDPOINT_REGISTRY_STATUS:-unknown}" \
            "endpoint_registry_rows=${ENDPOINT_REGISTRY_ROWS:-0}" \
            "endpoint_registry_bad_rows=${ENDPOINT_REGISTRY_BAD_ROWS:-0}" \
            "endpoint_registry_artifact_state=${ENDPOINT_REGISTRY_ARTIFACT_STATE:-unknown}" \
            "package_json_version=${PACKAGE_VERSION:-unknown}" \
            "package_json_status=${PACKAGE_STATUS:-unknown}" \
            "makefile_version=${MAKEFILE_VERSION:-unknown}" \
            "makefile_status=${MAKEFILE_STATUS:-unknown}" \
            "devcontainer_json_version=${DEVCONTAINER_JSON_VERSION:-unknown}" \
            "devcontainer_json_status=${DEVCONTAINER_JSON_STATUS:-unknown}" \
            "dockerfile_version=${DOCKERFILE_VERSION:-unknown}" \
            "dockerfile_status=${DOCKERFILE_STATUS:-unknown}" \
            "github_route_action_summary=${GITHUB_ROUTE_ACTION_SUMMARY_FILE:-unknown}" \
            "github_route_benchmark=${GITHUB_ROUTE_BENCHMARK_FILE:-unknown}" \
            "github_route_benchmark_summary=${GITHUB_ROUTE_BENCHMARK_SUMMARY_FILE:-unknown}" \
            "github_route_recommendation=${GITHUB_ROUTE_RECOMMENDATION_FILE:-unknown}" \
            "local_proxy_benchmark=${LOCAL_PROXY_BENCHMARK_FILE:-unknown}" \
            "local_proxy_benchmark_summary=${LOCAL_PROXY_BENCHMARK_SUMMARY_FILE:-unknown}" \
            "local_proxy_comparison=${LOCAL_PROXY_COMPARISON_FILE:-unknown}" \
            "local_proxy_recommendation=${LOCAL_PROXY_RECOMMENDATION_FILE:-unknown}" \
            "local_dns_action_summary=${LOCAL_DNS_ACTION_SUMMARY_FILE:-unknown}" \
            "local_dns_events=${LOCAL_DNS_EVENTS_FILE:-unknown}" \
            "copilot_network_recommendation=${COPILOT_NETWORK_RECOMMENDATION_FILE:-unknown}" \
            "copilot_network_recommendation_json=${COPILOT_NETWORK_RECOMMENDATION_JSON:-unknown}" \
            "post_start_version=$(script_declared_version "${POST_START_SCRIPT:-}")" \
            "post_attach_version=$(script_declared_version "${POST_ATTACH_SCRIPT:-}")" \
            "local_dns_cache_version=$(script_declared_version "${LOCAL_DNS_SCRIPT:-}")" \
            "github_api_route_fix_version=$(script_declared_version "${GITHUB_ROUTE_SCRIPT:-}")" \
            "copilot_network_manager_version=$(script_declared_version "${COPILOT_MANAGER_SCRIPT:-}")" \
            "copilot_route_advisor_version=$(script_declared_version "${COPILOT_ADVISOR_SCRIPT:-}")" \
            "local_copilot_proxy_version=$(script_declared_version "${LOCAL_PROXY_SCRIPT:-}")" \
            "network_control_plane_version=$(script_declared_version "${NETWORK_CONTROL_PLANE_SCRIPT:-}")" \
            "sync_local_auth_version=$(script_declared_version "${SYNC_LOCAL_AUTH_SCRIPT:-}")" \
            "network_control_plane_status=${NETWORK_CONTROL_PLANE_STATUS_FILE:-unknown}" \
            "network_control_plane_summary=${NETWORK_CONTROL_PLANE_SUMMARY_FILE:-unknown}" \
            "network_control_plane_json=${NETWORK_CONTROL_PLANE_JSON_FILE:-unknown}" \
            "health_status=${HEALTH_STATUS_FILE:-unknown}" \
            "health_summary=${HEALTH_SUMMARY_FILE:-unknown}" \
            "health_report=${HEALTH_REPORT_FILE:-unknown}" \
            "health_events=${HEALTH_EVENTS_FILE:-unknown}" \
            "sync_local_auth_status=${SYNC_LOCAL_AUTH_STATUS_FILE:-unknown}" \
            "sync_local_auth_summary=${SYNC_LOCAL_AUTH_SUMMARY_FILE:-unknown}" \
            "sync_local_auth_report=${SYNC_LOCAL_AUTH_REPORT_FILE:-unknown}" \
            "" \
            "ssh_requested=${SSH_REQUESTED}" \
            "ssh_socket_available=${SSH_SOCKET_AVAILABLE}" \
            "ssh_contract_status=${SSH_CONTRACT_STATUS}" \
            "ssh_contract_version=${SSH_CONTRACT_VERSION}" \
            "" \
            "status=ready" \
            "integrity=canonical"
    } > "${STATE_SWAP}"

    mv -f "${STATE_SWAP}" "${STATE_FILE}"
    chmod 444 "${STATE_FILE}" 2> /dev/null || true
    log "✅ Manifesto persistido em ${STATE_FILE}"
fi

# Status derivado para consumo humano/máquina: post-create pode concluir com
# readiness estrutural degradada quando há mismatch/advisory não-fatal.
POST_CREATE_STRUCTURAL_STATUS="ready-ok"
if [[ "${SCRIPT_AUDIT_STATUS:-OK}" != "OK" || "${ENDPOINT_REGISTRY_STATUS:-ok}" != "ok" || "${PACKAGE_STATUS:-ok}" != "ok" || "${MAKEFILE_STATUS:-ok}" != "ok" || "${DEVCONTAINER_JSON_STATUS:-ok}" != "ok" || "${DOCKERFILE_STATUS:-ok}" != "ok" || "${TOOLCHAIN_CONTRACT_STATUS:-ok}" != "ok" ]]; then
    POST_CREATE_STRUCTURAL_STATUS="ready-degraded"
fi
readonly POST_CREATE_STRUCTURAL_STATUS

# =============================================================================
# SECTION 12.5 — Runtime artifacts próprios do post-create (passivos)
# =============================================================================
log "Emitindo artifacts compactos do post-create..."

ensure_dir "$(dirname "${POST_CREATE_STATUS_FILE}")"
{
    printf 'status=%s\n' "${POST_CREATE_STRUCTURAL_STATUS}"
    printf 'script_version=%s\n' "${SCRIPT_VERSION}"
    printf 'script_audit_status=%s\n' "${SCRIPT_AUDIT_STATUS:-unknown}"
    printf 'endpoint_registry_status=%s\n' "${ENDPOINT_REGISTRY_STATUS:-unknown}"
    printf 'created_at=%s\n' "$(date -Is 2> /dev/null || echo unknown)"
} > "${POST_CREATE_STATUS_FILE}" 2> /dev/null || true

{
    printf 'summary_kind=post-create-structural\n'
    printf 'status=%s\n' "${POST_CREATE_STRUCTURAL_STATUS}"
    printf 'script_name=%s\n' "${SCRIPT_NAME}"
    printf 'script_version=%s\n' "${SCRIPT_VERSION}"
    printf 'project_root=%s\n' "${PROJECT_ROOT}"
    printf 'devcontainer_version=%s\n' "${DEVCONTAINER_JSON_VERSION:-unknown}"
    printf 'dockerfile_version=%s\n' "${DOCKERFILE_VERSION:-unknown}"
    printf 'dockerfile_path=%s\n' "${DOCKERFILE_FILE:-unknown}"
    printf 'package_json_version=%s\n' "${PACKAGE_VERSION:-unknown}"
    printf 'package_json_expected=%s\n' "${EXPECTED_PACKAGE_VERSION}"
    printf 'package_json_status=%s\n' "${PACKAGE_STATUS:-unknown}"
    printf 'makefile_version=%s\n' "${MAKEFILE_VERSION:-unknown}"
    printf 'makefile_expected=%s\n' "${EXPECTED_MAKEFILE_VERSION}"
    printf 'makefile_status=%s\n' "${MAKEFILE_STATUS:-unknown}"
    printf 'script_audit_status=%s\n' "${SCRIPT_AUDIT_STATUS:-unknown}"
    printf 'script_audit_warnings=%s\n' "${SCRIPT_AUDIT_WARNINGS:-0}"
    printf 'script_version_mismatches=%s\n' "${SCRIPT_VERSION_MISMATCHES:-0}"
    printf 'endpoint_registry_file=%s\n' "${ENDPOINT_REGISTRY_FILE:-unknown}"
    printf 'endpoint_registry_status=%s\n' "${ENDPOINT_REGISTRY_STATUS:-unknown}"
    printf 'endpoint_registry_rows=%s\n' "${ENDPOINT_REGISTRY_ROWS:-0}"
    printf 'endpoint_registry_bad_rows=%s\n' "${ENDPOINT_REGISTRY_BAD_ROWS:-0}"
    printf 'endpoint_registry_diagnostics=%s\n' "${ENDPOINT_REGISTRY_DIAGNOSTICS:-unknown}"
    printf 'local_dns_expected=%s\n' "${EXPECTED_LOCAL_DNS_VERSION}"
    printf 'local_dns_default_on=%s\n' "${DEVCONTAINER_ENABLE_LOCAL_DNS_CACHE:-unset}"
    printf 'manager_expected=%s\n' "${EXPECTED_COPILOT_MANAGER_VERSION}"
    printf 'network_control_plane_expected=%s\n' "${EXPECTED_NETWORK_CONTROL_PLANE_VERSION}"
    printf 'network_control_plane_version=%s\n' "$(script_declared_version "${NETWORK_CONTROL_PLANE_SCRIPT:-}")"
    printf 'toolchain_contract_status=%s\n' "${TOOLCHAIN_CONTRACT_STATUS:-unknown}"
    printf 'toolchain_contract_missing=%s\n' "${TOOLCHAIN_CONTRACT_MISSING:-0}"
    printf 'toolchain_contract_report=%s\n' "${TOOLCHAIN_CONTRACT_REPORT:-unknown}"
    printf 'control_plane_baseline_report=%s\n' "${CONTROL_PLANE_BASELINE_REPORT:-unknown}"
    printf 'artifact_audit_report=%s\n' "${ARTIFACT_AUDIT_REPORT:-unknown}"
    printf 'capability_audit_report=%s\n' "${CAPABILITY_AUDIT_REPORT:-unknown}"
    printf 'state_file=%s\n' "${STATE_FILE}"
    printf 'health_status_file=%s\n' "${HEALTH_STATUS_FILE}"
    printf 'health_summary_file=%s\n' "${HEALTH_SUMMARY_FILE}"
    printf 'health_report_file=%s\n' "${HEALTH_REPORT_FILE}"
    printf 'health_events_file=%s\n' "${HEALTH_EVENTS_FILE}"
    printf 'sync_local_auth_status_file=%s\n' "${SYNC_LOCAL_AUTH_STATUS_FILE}"
    printf 'sync_local_auth_summary_file=%s\n' "${SYNC_LOCAL_AUTH_SUMMARY_FILE}"
    printf 'sync_local_auth_report_file=%s\n' "${SYNC_LOCAL_AUTH_REPORT_FILE}"
} > "${POST_CREATE_SUMMARY_FILE}" 2> /dev/null || true

{
    printf 'post-create structural report\n'
    printf 'script=%s v%s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}"
    printf 'status=%s\n' "${POST_CREATE_STRUCTURAL_STATUS}"
    printf 'script_audit=%s warnings=%s mismatches=%s\n' "${SCRIPT_AUDIT_STATUS:-unknown}" "${SCRIPT_AUDIT_WARNINGS:-0}" "${SCRIPT_VERSION_MISMATCHES:-0}"
    printf 'endpoint_registry=%s %s\n' "${ENDPOINT_REGISTRY_STATUS:-unknown}" "${ENDPOINT_REGISTRY_DIAGNOSTICS:-unknown}"
    printf 'toolchain package=%s Makefile=%s devcontainer=%s Dockerfile=%s\n' "${PACKAGE_VERSION:-unknown}" "${MAKEFILE_VERSION:-unknown}" "${DEVCONTAINER_JSON_VERSION:-unknown}" "${DOCKERFILE_VERSION:-unknown}"
    printf 'reports: hook=%s capability=%s artifacts=%s baseline=%s toolchain_contract=%s\n' "${HOOK_AUDIT_REPORT:-unknown}" "${CAPABILITY_AUDIT_REPORT:-unknown}" "${ARTIFACT_AUDIT_REPORT:-unknown}" "${CONTROL_PLANE_BASELINE_REPORT:-unknown}" "${TOOLCHAIN_CONTRACT_REPORT:-unknown}"
    printf 'runtime-artifacts: health_report=%s health_events=%s sync_local_auth_report=%s\n' "${HEALTH_REPORT_FILE}" "${HEALTH_EVENTS_FILE}" "${SYNC_LOCAL_AUTH_REPORT_FILE}"
} > "${POST_CREATE_REPORT_FILE}" 2> /dev/null || true

if [[ ! -e "${POST_CREATE_EVENTS_FILE}" ]]; then
    printf 'epoch	event	details\n' > "${POST_CREATE_EVENTS_FILE}" 2> /dev/null || true
fi
printf '%s	%s	%s\n' "$(date '+%s' 2> /dev/null || echo 0)" "post-create-ready" "version=${SCRIPT_VERSION},status=${POST_CREATE_STRUCTURAL_STATUS},audit=${SCRIPT_AUDIT_STATUS:-unknown},registry=${ENDPOINT_REGISTRY_STATUS:-unknown}" >> "${POST_CREATE_EVENTS_FILE}" 2> /dev/null || true

# =============================================================================
# SECTION 13 — Healthcheck final (informativo) + Commit transacional
# =============================================================================
log "Executando healthcheck final (informativo)..."

if [[ -r "${SYNC_LOCAL_AUTH_SCRIPT}" ]]; then
    bash "${SYNC_LOCAL_AUTH_SCRIPT}" --all || warn "sync-local-auth.sh falhou (WARN only)."
else
    warn "sync-local-auth.sh ausente/ilegível; bootstrap local de auth ignorado."
fi

BOOT_END_TIME="$(date +%s 2> /dev/null || echo 0)"
BOOT_DURATION=$((BOOT_END_TIME - BOOT_START_TIME))

CHROME_PROXY_STATUS="⏸️  não verificado"
CHROME_PROXY_NOTE=""
CHROME_BACKEND_STATUS="⏸️  não verificado"
CHROME_BACKEND_NOTE=""

if [[ "${BROWSER_MODE:-}" == "wsEndpoint" ]]; then
    CHROME_HOST_EFF="${CHROME_HOST:-host.docker.internal}"
    CHROME_PORT_EFF="${CHROME_PORT:-9225}"
    CHROME_PROXY_PORT_EFF="${CHROME_PROXY_PORT:-9224}"

    HAS_TIMEOUT="false"
    command -v timeout > /dev/null 2>&1 && HAS_TIMEOUT="true"

    if [[ "${HAS_TIMEOUT}" == "true" ]] && is_tcp_probe_host_token "${CHROME_HOST_EFF}" && is_port "${CHROME_PORT_EFF}" && is_port "${CHROME_PROXY_PORT_EFF}"; then
        if tcp_probe_with_timeout 3 "${CHROME_HOST_EFF}" "${CHROME_PORT_EFF}"; then
            CHROME_BACKEND_STATUS="✅ respondendo"
            CHROME_BACKEND_NOTE="Chrome Windows acessível em ${CHROME_HOST_EFF}:${CHROME_PORT_EFF} (OK, embora não esperado no boot)"
        else
            CHROME_BACKEND_STATUS="⏸️  aguardando demanda"
            CHROME_BACKEND_NOTE="Será iniciado quando necessário (START-CHROME-SIMPLE.bat)"
        fi

        if tcp_probe_with_timeout 2 "localhost" "${CHROME_PROXY_PORT_EFF}"; then
            CHROME_PROXY_STATUS="✅ respondendo"
            CHROME_PROXY_NOTE="Proxy acessível em localhost:${CHROME_PROXY_PORT_EFF} (OK, embora não esperado no boot)"
        else
            CHROME_PROXY_STATUS="⏸️  aguardando demanda"
            CHROME_PROXY_NOTE="Será iniciado automaticamente quando necessário"
        fi
    else
        CHROME_BACKEND_STATUS="⏸️  diagnóstico indisponível"
        CHROME_BACKEND_NOTE="timeout ausente ou CHROME_HOST/PORT inválidos para probe seguro"
        CHROME_PROXY_STATUS="⏸️  diagnóstico indisponível"
        CHROME_PROXY_NOTE="timeout ausente ou CHROME_PROXY_PORT inválido para probe seguro"
    fi
fi

echo ""
printf "╔════════════════════════════════════════════════════════════╗\n"
printf "║  ✅ DevContainer Inicializado com Sucesso (v%-14s) ║\n" "${SCRIPT_VERSION}"
printf "╚════════════════════════════════════════════════════════════╝\n"
echo ""

echo "📊 Checklist:"
echo "  ✅ Identidade validada (${CURRENT_USER}, UID ${CURRENT_UID})"
echo "  ✅ ENV validado (${#STRUCTURAL_ENV_VARS[@]} críticas)"
echo "  ✅ Volumes auditados (${#VOLUME_DIRS[@]})"
echo "  ✅ Histórico bash (UX)"
echo "  ✅ NSS wrapper (instrumental)"
echo "  ✅ Status estrutural (${POST_CREATE_STRUCTURAL_STATUS})"
echo "  ✅ Script audit (${SCRIPT_AUDIT_STATUS:-unknown}; warnings=${SCRIPT_AUDIT_WARNINGS:-0}; version_mismatches=${SCRIPT_VERSION_MISMATCHES:-0})"
echo "  ✅ Capability audit (${CAPABILITY_AUDIT_REPORT:-unknown})"
echo "  ✅ Network artifacts audit (${ARTIFACT_AUDIT_REPORT:-unknown})"
echo "  ✅ Environment baseline (${ENV_BASELINE_REPORT:-unknown})"
echo "  ✅ Control-plane baseline (${CONTROL_PLANE_BASELINE_REPORT:-unknown})"
echo "  ✅ Toolchain contract (${TOOLCHAIN_CONTRACT_STATUS:-unknown}; missing=${TOOLCHAIN_CONTRACT_MISSING:-0})"
echo "  ✅ Endpoint registry (${ENDPOINT_REGISTRY_STATUS:-unknown}; rows=${ENDPOINT_REGISTRY_ROWS:-0}; bad=${ENDPOINT_REGISTRY_BAD_ROWS:-0})"
echo "  ✅ Post-create artifacts (${POST_CREATE_SUMMARY_FILE})"
echo "  ${CHROME_BACKEND_STATUS} Chrome backend (Windows:${CHROME_PORT:-9225})"
[[ -n "${CHROME_BACKEND_NOTE}" ]] && echo "     └─ ${CHROME_BACKEND_NOTE}"
echo "  ${CHROME_PROXY_STATUS} Proxy server (container:${CHROME_PROXY_PORT:-9224})"
[[ -n "${CHROME_PROXY_NOTE}" ]] && echo "     └─ ${CHROME_PROXY_NOTE}"
echo ""
echo "⏱️  Tempo total: ${BOOT_DURATION}s"
echo ""
echo "📚 Próximos passos:"
echo "  • Iniciar sistema: make start"
echo "  • Ver logs: make logs-follow"
echo "  • Log físico: ${LOG_FILE}"
echo "  • Estado consolidado de rede: npm run network:state"
echo "  • DNS health: npm run network:dns:health"
echo "  • Benchmark GitHub/Copilot: npm run network:manager:benchmark"
echo ""

# Sanidade: marker deve existir
if [[ ! -f "${IN_PROGRESS_MARKER}" ]]; then
    error "INCONSISTÊNCIA: IN_PROGRESS_MARKER ausente no commit final"
    exit 1
fi

if ! validate_ld_preload "${LD_PRELOAD:-}"; then
    warn "LD_PRELOAD parece inválido; NSS wrapper pode não carregar"
fi

log "Finalizando transação (commit)..."
rm -f "${IN_PROGRESS_MARKER}" 2> /dev/null || true
touch "${COMPLETED_MARKER}" 2> /dev/null || true
log "Gatekeeper: Execução concluída com sucesso (COMPLETED)."

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  ✅ POST-CREATE CONCLUÍDO COM SUCESSO                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "📝 Log completo:"
echo "   ${LOG_FILE}"
echo ""
