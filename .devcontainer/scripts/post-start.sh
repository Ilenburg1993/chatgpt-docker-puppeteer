#!/usr/bin/env bash
# =============================================================================
# post-start.sh — Start Hook (Fail-Safe) — FINAL
# Version: v1.1
#
# Contrato (inviolável):
# - Nunca bloqueia o start/attach do DevContainer
# - Nunca inicia serviços automaticamente
# - Sempre termina com exit 0
# - Sem mutações estruturais perigosas (sem chown recursivo; sem alterar mounts)
#
# Papel:
# - Diagnóstico leve (make info, identidade, NSS artifacts, LD_PRELOAD)
# - Registro de health/status em /tmp (observacional)
# - Auto-reparo mínimo e seguro de artefatos NSS ausentes para sessões normais
# - Sinais úteis para humanos/agentes sem “auto-repair” destrutivo
#
# Nota importante:
# - O entrypoint/gatekeeper agora semeia artefatos NSS cedo.
# - Este hook só repara a superfície de forma defensiva quando os artefatos continuarem ausentes,
#   preservando o ambiente utilizável e observável.
# =============================================================================

# Defesa máxima contra herança de shell estrito (fail-safe)
set +e
set +u
set +o pipefail 2> /dev/null || true
trap - ERR EXIT INT TERM 2> /dev/null || true

# ---------------------------------------------------------------------------
# Constantes / Config
# ---------------------------------------------------------------------------
readonly SCRIPT_NAME="post-start.sh"
readonly SCRIPT_VERSION="1.1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR

readonly HEALTH_STATUS_FILE="/tmp/devcontainer-health.status"

# Parâmetros configuráveis
readonly MAKE_INFO_TIMEOUT_SECONDS="${DEVCONTAINER_MAKE_TIMEOUT:-10}"
readonly ENABLE_SSHD_CHECK="${DEVCONTAINER_ENABLE_SSHD_CHECK:-false}"
readonly NSS_BASE_DIR="${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"

# ---------------------------------------------------------------------------
# Logging minimalista (não depende de cores; não quebra)
# ---------------------------------------------------------------------------
log_info() { printf "%s\n" "ℹ️  [${SCRIPT_NAME}] $*"; }
log_warn() { printf "%s\n" "⚠️  [${SCRIPT_NAME}] $*"; }

# ---------------------------------------------------------------------------
# Diagnóstico: LD_PRELOAD (informativo)
# ---------------------------------------------------------------------------
check_ld_preload() {
    local val="${LD_PRELOAD:-}"
    if [[ -z "${val}" ]]; then
        log_warn "LD_PRELOAD is empty; NSS wrapper may not be active (this can be normal before profile load)."
        return 1
    fi
    if [[ "${val}" == ":"* || "${val}" == *":" || "${val}" == *"::"* ]]; then
        log_warn "LD_PRELOAD contém token vazio (p.ex. '::' ou ':' nas pontas): '${val}'"
    fi
    if ((${#val} > 4096)); then
        log_warn "LD_PRELOAD length=${#val} exceeds kernel limit; truncation may occur."
    fi
    return 0
}

repair_nss_artifacts() {
    local current_uid current_gid current_user passwd_file group_file
    local passwd_tmp group_tmp

    current_uid="$(id -u 2> /dev/null || echo unknown)"
    if [[ "${current_uid}" == "0" || "${current_uid}" == "unknown" ]]; then
        return 1
    fi

    current_gid="$(id -g 2> /dev/null || echo unknown)"
    current_user="$(id -un 2> /dev/null || echo node)"
    [[ -z "${current_user}" || "${current_user}" == "unknown" ]] && current_user="node"

    passwd_file="${NSS_BASE_DIR}/passwd"
    group_file="${NSS_BASE_DIR}/group"
    passwd_tmp="${passwd_file}.tmp"
    group_tmp="${group_file}.tmp"

    mkdir -p "${NSS_BASE_DIR}" 2> /dev/null || return 1

    if [[ -r /etc/passwd ]]; then
        cat /etc/passwd > "${passwd_tmp}" 2> /dev/null || true
    fi
    if [[ -r /etc/group ]]; then
        cat /etc/group > "${group_tmp}" 2> /dev/null || true
    fi

    if [[ ! -s "${passwd_tmp}" ]]; then
        printf '%s:x:%s:%s:%s user:%s:/bin/bash\n' \
            "${current_user}" "${current_uid}" "${current_gid}" "${current_user}" "${HOME:-/home/node}" > "${passwd_tmp}" 2> /dev/null || return 1
    fi
    if [[ ! -s "${group_tmp}" ]]; then
        printf '%s:x:%s:\n' "${current_user}" "${current_gid}" > "${group_tmp}" 2> /dev/null || return 1
    fi

    mv -f "${passwd_tmp}" "${passwd_file}" 2> /dev/null || return 1
    mv -f "${group_tmp}" "${group_file}" 2> /dev/null || return 1
    chmod 600 "${passwd_file}" "${group_file}" 2> /dev/null || true
    log_info "NSS artifacts repaired in post-start: ${NSS_BASE_DIR}"
    return 0
}

# ---------------------------------------------------------------------------
# Diagnóstico: NSS artifacts (somente audit; sem reparo)
# ---------------------------------------------------------------------------
audit_nss_artifacts() {
    local degraded=0

    local passwd_file="${NSS_BASE_DIR}/passwd"
    local group_file="${NSS_BASE_DIR}/group"

    # registrar path efetivo (útil p/ debugging)
    export DEVCONTAINER_NSS_DIR="${NSS_BASE_DIR}"

    # NSS artifacts são runtime-only; ausência pode ser normal se post-create não rodou ainda
    if [[ ! -s "${passwd_file}" || ! -s "${group_file}" ]]; then
        repair_nss_artifacts || true
    fi

    if [[ -s "${passwd_file}" ]]; then
        log_info "NSS artifact OK: ${passwd_file}"
    else
        log_warn "NSS artifact ausente/vazio: ${passwd_file}"
        degraded=1
    fi

    if [[ -s "${group_file}" ]]; then
        log_info "NSS artifact OK: ${group_file}"
    else
        log_warn "NSS artifact ausente/vazio: ${group_file}"
        degraded=1
    fi

    # coerência mínima: passwd deve conter entrada do usuário atual (best-effort)
    local current_user current_uid
    current_user="$(id -un 2> /dev/null || echo unknown)"
    current_uid="$(id -u 2> /dev/null || echo unknown)"

    if [[ -s "${passwd_file}" && "${current_user}" != "unknown" && "${current_uid}" != "unknown" ]]; then
        if grep -qE "^${current_user}:x:${current_uid}:" "${passwd_file}" 2> /dev/null; then
            log_info "NSS passwd coerente com usuário atual: ${current_user} (uid=${current_uid})"
        else
            log_warn "NSS passwd NÃO contém linha esperada para ${current_user} (uid=${current_uid}) — possível mismatch."
            degraded=1
        fi
    fi

    # validação leve do LD_PRELOAD no *ambiente atual* (pode ser cedo demais)
    check_ld_preload || true

    return "${degraded}"
}

# ---------------------------------------------------------------------------
# DNS Fix — sobrescreve /etc/resolv.conf com nameservers confiáveis
#
# Contexto:
# - --dns=1.1.1.1/8.8.8.8 em runArgs configura o resolver interno do Docker,
#   mas não altera diretamente /etc/resolv.conf em Docker Desktop.
# - O Docker documenta explicitamente que o arquivo pode ser editado e não
#   será sobrescrito novamente após modificação manual.
# - /etc/resolv.conf é montado via block device (ext4 rw) — gravação funciona.
# ---------------------------------------------------------------------------
fix_dns() {
    if ! command -v sudo > /dev/null 2>&1; then
        log_warn "DNS fix: sudo não disponível — ignorado."
        return 1
    fi

    printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\noptions timeout:1 attempts:2 rotate\n' \
        | sudo tee /etc/resolv.conf > /dev/null 2>&1 || {
        log_warn "DNS fix: falha ao sobrescrever /etc/resolv.conf (bind mount read-only?)."
        return 1
    }

    local ns
    ns="$(awk '/^nameserver/{printf "%s ", $2}' /etc/resolv.conf 2> /dev/null)"
    log_info "DNS configurado: ${ns}"
    return 0
}

# ---------------------------------------------------------------------------
# NSS DB — inicializa o banco de certificados do VS Code/Chromium no Linux
#
# VS Code (Electron) usa o NSS trust store em ~/.pki/nssdb para validar
# certificados TLS. Sem esse DB, ele cai de volta ao bundle do sistema.
# Tendo o DB inicializado, novos CAs podem ser adicionados com certutil
# sem necessitar de rebuild.
#
# Referência: https://code.visualstudio.com/docs/setup/network
# (seção "SSL certificates" para Linux)
# ---------------------------------------------------------------------------
init_nss_db() {
    local nssdb="${HOME}/.pki/nssdb"

    if ! command -v certutil > /dev/null 2>&1; then
        log_warn "NSS DB: certutil não encontrado (libnss3-tools não instalado); ignorado."
        return 1
    fi

    # Validar integridade se DB já existe
    if [[ -d "${nssdb}" ]]; then
        if certutil -L -d "sql:${nssdb}" > /dev/null 2>&1; then
            log_info "NSS DB OK: ${nssdb}"
            return 0
        fi
        log_warn "NSS DB corrompido: ${nssdb} — removendo e recriando."
        rm -rf "${nssdb}" 2> /dev/null || true
    fi

    # certutil sql: exige que o diretório alvo já exista antes de -N;
    # criamos nssdb/ diretamente (mkdir -p cria os pais ~/.pki também).
    mkdir -p "${nssdb}" 2> /dev/null || {
        log_warn "NSS DB: falha ao criar ${nssdb}."
        return 1
    }

    # Inicializa DB com senha vazia (-f /dev/null).
    # "password file contains no data" = aviso esperado — rc still 0.
    certutil -d "sql:${nssdb}" -N -f /dev/null 2> /dev/null || {
        log_warn "NSS DB: certutil -N falhou (rc=$?)."
        return 1
    }
    log_info "NSS DB criado: ${nssdb}"

    # Importar CAs customizados (ex.: corporativos adicionados via
    # update-ca-certificates). Geralmente poucos arquivos — rápido.
    local custom_dir="/usr/local/share/ca-certificates"
    local imported=0
    if [[ -d "${custom_dir}" ]]; then
        while IFS= read -r -d '' crt_file; do
            local ca_name
            ca_name=$(basename "${crt_file}" .crt)
            if certutil -A -d "sql:${nssdb}" -n "custom-${ca_name}" -t "CT,," \
                -i "${crt_file}" 2> /dev/null; then
                imported=$((imported + 1))
            fi
        done < <(find "${custom_dir}" -maxdepth 2 -name '*.crt' -print0 2> /dev/null)
        [[ "${imported}" -gt 0 ]] && log_info "NSS DB: ${imported} CA(s) customizado(s) importado(s)"
    fi

    return 0
}

# ---------------------------------------------------------------------------
# Probe de conectividade Copilot — verifica endpoints obrigatórios no start
# ---------------------------------------------------------------------------
probe_copilot_connectivity() {
    local failed=0
    local endpoints
    endpoints=(
        "https://copilot-proxy.githubusercontent.com"
        "https://api.github.com"
        "https://default.exp-tas.com"
    )

    if ! command -v curl > /dev/null 2>&1; then
        log_warn "Copilot probe: curl não encontrado — ignorado."
        return 1
    fi

    for url in "${endpoints[@]}"; do
        # Uma única requisição por endpoint — captura http_code, tempo TCP e
        # resultado da verificação TLS (0 = OK, não-zero = erro de certificado).
        local result
        result=$(curl -so /dev/null --connect-timeout 4 \
            -w "%{http_code}|%{time_connect}|%{ssl_verify_result}" \
            "${url}" 2> /dev/null)

        local http_code time_connect tls_ok
        IFS='|' read -r http_code time_connect tls_ok <<< "${result}"

        if [[ -z "${http_code}" || "${http_code}" == "000" ]]; then
            log_warn "Copilot probe FALHOU: ${url} (sem resposta — possível bloqueio de rede)"
            failed=1
        elif [[ "${tls_ok}" != "0" ]]; then
            log_warn "Copilot probe TLS ERRO (${tls_ok}): ${url} → HTTP ${http_code} (TCP ${time_connect}s)"
            failed=1
        else
            log_info "Copilot probe OK: ${url} → HTTP ${http_code} | TCP ${time_connect}s | TLS OK"
        fi
    done

    return "${failed}"
}

# ---------------------------------------------------------------------------
# Diagnóstico: .initialized (manifesto do post-create)
# ---------------------------------------------------------------------------
audit_initialized_marker() {
    if [[ -f ".devcontainer/.initialized" ]]; then
        log_info "Marker encontrado: .devcontainer/.initialized"
        return 0
    fi
    log_warn "Marker ausente: .devcontainer/.initialized (post-create pode ter falhado ou não rodou)."
    return 0
}

# ---------------------------------------------------------------------------
# Diagnóstico: make info (observacional)
# ---------------------------------------------------------------------------
run_make_info() {
    if ! command -v make > /dev/null 2>&1; then
        log_warn "make não encontrado no PATH."
        return 1
    fi

    if command -v timeout > /dev/null 2>&1; then
        timeout "${MAKE_INFO_TIMEOUT_SECONDS}" make info > /dev/null 2>&1
        return $?
    fi

    make info > /dev/null 2>&1
    return $?
}

# ---------------------------------------------------------------------------
# Diagnóstico: SSH (observacional; nunca degrada por padrão)
# ---------------------------------------------------------------------------
audit_ssh() {
    local ssh_key_found=false
    local key

    for key in id_rsa id_dsa id_ecdsa id_ed25519; do
        if [[ -s "${HOME:-/home/node}/.ssh/${key}" ]]; then
            ssh_key_found=true
            log_info "SSH private key presente: ~/.ssh/${key}"
            break
        fi
    done

    if [[ "${ssh_key_found}" == "false" ]]; then
        if command -v ssh-add > /dev/null 2>&1 && ssh-add -L > /dev/null 2>&1; then
            log_info "Nenhuma chave em ~/.ssh, mas agente SSH encaminhado detectado."
            ssh_key_found=true
        else
            log_warn "Nenhuma chave SSH privada detectada e nenhum agente aparente; git/ssh pode falhar (WARN only)."
        fi
    fi

    if [[ "${ENABLE_SSHD_CHECK}" != "true" ]]; then
        log_info "SSHD check skipped via DEVCONTAINER_ENABLE_SSHD_CHECK."
    else
        if command -v sshd > /dev/null 2>&1; then
            log_info "sshd está instalado."
        else
            log_info "sshd não encontrado; acesso inbound via SSH permanece desabilitado (estado esperado)."
        fi
    fi
}

# =============================================================================
# Execução (sempre fail-safe)
# =============================================================================
log_info "Hook de start acionado (não-bloqueante)."
log_info "Versão: v${SCRIPT_VERSION}"
log_info "PWD: ${PWD:-unknown}"
log_info "User: $(id -un 2> /dev/null || echo unknown) (uid=$(id -u 2> /dev/null || echo unknown), gid=$(id -g 2> /dev/null || echo unknown))"
log_info "NSS_BASE_DIR: ${NSS_BASE_DIR}"
log_info "LD_PRELOAD: ${LD_PRELOAD:-<unset>}"

status="ok"

# DNS Fix — aplicar antes de qualquer operação dependente de rede
log_info "Aplicando fix de DNS..."
fix_dns
dns_rc=$?
if [[ "${dns_rc}" -ne 0 ]]; then
    status="degraded"
    log_warn "Fix de DNS não aplicado — resolução de nomes pode falhar."
fi

# make info (se falhar → degraded)
run_make_info
make_rc=$?
if [[ "${make_rc}" -ne 0 ]]; then
    status="degraded"
    log_warn "make info falhou (rc=${make_rc}, timeout=${MAKE_INFO_TIMEOUT_SECONDS}s)."
else
    log_info "make info executado com sucesso."
fi

# NSS + markers (se falhar → degraded)
audit_nss_artifacts
nss_rc=$?
if [[ "${nss_rc}" -ne 0 ]]; then
    status="degraded"
    log_warn "NSS audit degradado (artefatos ausentes/mismatch)."
    log_warn "Ação recomendada: Rebuild Container OU execute manualmente: .devcontainer/scripts/post-create.sh (com REEXECUTE_POST_CREATE=true se aplicável)."
fi

audit_initialized_marker || true

# NSS DB — inicializa trust store do VS Code/Electron (idempotente)
init_nss_db || true

# Probe de conectividade Copilot (WARN only; não degrada status por design)
log_info "Verificando conectividade com endpoints do GitHub Copilot..."
probe_copilot_connectivity || log_warn "Um ou mais endpoints do Copilot não responderam. Verifique a rede."

# SSH (WARN only)
audit_ssh || true

# Local auth/env sync (WARN only)
if [[ -x "${SCRIPT_DIR}/sync-local-auth.sh" ]]; then
    "${SCRIPT_DIR}/sync-local-auth.sh" || log_warn "sync-local-auth.sh falhou (WARN only)."
fi

# Persist status (best-effort)
printf '%s\n' "${status}" > "${HEALTH_STATUS_FILE}" 2> /dev/null || true
log_info "health.status=${status} (${HEALTH_STATUS_FILE})"

exit 0
