#!/usr/bin/env bash
# shellcheck shell=bash
# =============================================================================
# endpoint-registry.sh — shared structural contract for endpoint registries
# Version: v1.0.0
#
# Source-only library. It performs no network access, no filesystem mutation and
# does not change caller shell options. Provider/product allowlists remain owned
# by each consumer; this library owns only the structural trust boundary.
# =============================================================================

NETWORK_ENDPOINT_REGISTRY_LIBRARY_VERSION="1.0.0"
NETWORK_ENDPOINT_REGISTRY_V1_EXPECTED_VERSION_DEFAULT="v1.2.0"
readonly NETWORK_ENDPOINT_REGISTRY_LIBRARY_VERSION NETWORK_ENDPOINT_REGISTRY_V1_EXPECTED_VERSION_DEFAULT

network_endpoint_registry_reset_audit() {
    NETWORK_ENDPOINT_REGISTRY_AUDIT_FILE=""
    NETWORK_ENDPOINT_REGISTRY_AUDIT_STATUS="unknown"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_VERSION_STATUS="unknown"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_VERSION="unknown"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_EXPECTED_VERSION="${NETWORK_ENDPOINT_REGISTRY_V1_EXPECTED_VERSION_DEFAULT}"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_ROWS="0"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_ROWS="0"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_URLS="0"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_IDS="0"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_CAPABILITIES="0"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_CRITICALITY="0"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_EXPECTED_HTTP="0"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_DUPLICATE_URLS="0"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_DUPLICATE_IDS="0"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_TOTAL_BAD="0"
}

network_endpoint_registry_reset_audit

# Validate the canonical five-field v1 registry contract and publish the result
# through NETWORK_ENDPOINT_REGISTRY_AUDIT_* globals. Return 0 only for a fully
# valid, non-empty registry with the expected declared version.
network_endpoint_registry_audit_v1() {
    local file expected_version detected_version metrics
    local rows bad_rows bad_urls bad_ids bad_capabilities bad_criticality bad_expected duplicate_urls duplicate_ids
    local version_bad total_bad

    file="${1:-}"
    expected_version="${2:-${NETWORK_ENDPOINT_REGISTRY_V1_EXPECTED_VERSION_DEFAULT}}"
    network_endpoint_registry_reset_audit
    NETWORK_ENDPOINT_REGISTRY_AUDIT_FILE="${file}"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_EXPECTED_VERSION="${expected_version}"

    if [[ -z "${file}" || ! -r "${file}" ]]; then
        NETWORK_ENDPOINT_REGISTRY_AUDIT_STATUS="missing"
        NETWORK_ENDPOINT_REGISTRY_AUDIT_VERSION_STATUS="unavailable"
        return 2
    fi

    detected_version="$(awk '
        /^#[[:space:]]*Version:[[:space:]]*/ {
            line=$0
            sub(/^#[[:space:]]*Version:[[:space:]]*/, "", line)
            sub(/[[:space:]].*$/, "", line)
            print line
            exit
        }
    ' "${file}" 2> /dev/null || true)"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_VERSION="${detected_version:-missing}"
    if [[ -z "${detected_version}" ]]; then
        NETWORK_ENDPOINT_REGISTRY_AUDIT_VERSION_STATUS="missing"
        version_bad=1
    elif [[ "${detected_version}" != "${expected_version}" ]]; then
        NETWORK_ENDPOINT_REGISTRY_AUDIT_VERSION_STATUS="mismatch"
        version_bad=1
    else
        NETWORK_ENDPOINT_REGISTRY_AUDIT_VERSION_STATUS="ok"
        version_bad=0
    fi

    metrics="$(awk -F '\t' '
        function valid_token(value) {
            return value ~ /^[A-Za-z0-9][A-Za-z0-9._-]*$/
        }
        function valid_url(value,    raw, authority) {
            if (value !~ /^https:\/\//) return 0
            if (value ~ /[[:space:]\\]/ || value ~ /@/ || value ~ /[*]/) return 0
            raw=value
            sub(/^https:\/\//, "", raw)
            split(raw, parts, "/")
            authority=parts[1]
            if (authority == "" || authority ~ /:/) return 0
            if (authority !~ /^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$/) return 0
            if (authority !~ /[.]/ || authority ~ /[.][.]/) return 0
            return 1
        }
        /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
        {
            rows++
            if (NF != 5) {
                bad_rows++
                next
            }
            url=$1
            id=$2
            capability=$3
            criticality=$4
            expected=$5
            if (!valid_url(url)) bad_urls++
            if (!valid_token(id)) bad_ids++
            if (!valid_token(capability)) bad_capabilities++
            if (criticality !~ /^(low|medium|high|critical)$/) bad_criticality++
            if (expected !~ /^[1-5][0-9][0-9]([|][1-5][0-9][0-9])*$/) bad_expected++
            if (seen_url[url]++) duplicate_urls++
            if (seen_id[id]++) duplicate_ids++
        }
        END {
            printf "%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d", \
                rows+0, bad_rows+0, bad_urls+0, bad_ids+0, bad_capabilities+0, \
                bad_criticality+0, bad_expected+0, duplicate_urls+0, duplicate_ids+0
        }
    ' "${file}" 2> /dev/null || printf '0\t1\t0\t0\t0\t0\t0\t0\t0')"

    IFS=$'\t' read -r rows bad_rows bad_urls bad_ids bad_capabilities bad_criticality bad_expected duplicate_urls duplicate_ids <<< "${metrics}"
    rows="${rows:-0}"
    bad_rows="${bad_rows:-0}"
    bad_urls="${bad_urls:-0}"
    bad_ids="${bad_ids:-0}"
    bad_capabilities="${bad_capabilities:-0}"
    bad_criticality="${bad_criticality:-0}"
    bad_expected="${bad_expected:-0}"
    duplicate_urls="${duplicate_urls:-0}"
    duplicate_ids="${duplicate_ids:-0}"
    total_bad=$((bad_rows + bad_urls + bad_ids + bad_capabilities + bad_criticality + bad_expected + duplicate_urls + duplicate_ids + version_bad))

    NETWORK_ENDPOINT_REGISTRY_AUDIT_ROWS="${rows}"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_ROWS="${bad_rows}"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_URLS="${bad_urls}"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_IDS="${bad_ids}"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_CAPABILITIES="${bad_capabilities}"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_CRITICALITY="${bad_criticality}"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_EXPECTED_HTTP="${bad_expected}"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_DUPLICATE_URLS="${duplicate_urls}"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_DUPLICATE_IDS="${duplicate_ids}"
    NETWORK_ENDPOINT_REGISTRY_AUDIT_TOTAL_BAD="${total_bad}"

    if [[ "${rows}" == "0" ]]; then
        NETWORK_ENDPOINT_REGISTRY_AUDIT_STATUS="empty"
        return 1
    fi
    if ((total_bad > 0)); then
        NETWORK_ENDPOINT_REGISTRY_AUDIT_STATUS="invalid"
        return 1
    fi

    NETWORK_ENDPOINT_REGISTRY_AUDIT_STATUS="ok"
    return 0
}

# Materialize URL rows only from the exact registry most recently validated as
# fully valid in this shell. This is the trust-boundary primitive: callers cannot
# accidentally consume superficially-valid rows from a globally-invalid file.
network_endpoint_registry_materialize_urls_v1() {
    local file max
    file="${1:-}"
    max="${2:-128}"
    [[ "${NETWORK_ENDPOINT_REGISTRY_AUDIT_STATUS:-unknown}" == "ok" ]] || return 64
    [[ "${NETWORK_ENDPOINT_REGISTRY_AUDIT_FILE:-}" == "${file}" ]] || return 64
    [[ "${max}" =~ ^[0-9]+$ && "${max}" -ge 1 ]] || return 64

    awk -F '\t' -v max="${max}" '
        /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
        {
            if (!seen[$1]++) {
                print $1
                emitted++
                if (emitted >= max) exit
            }
        }
    ' "${file}" 2> /dev/null
}

# Read the expected unauthenticated HTTP contract only from the exact registry
# previously validated in this shell.
network_endpoint_registry_expected_http_v1() {
    local file url
    file="${1:-}"
    url="${2:-}"
    [[ "${NETWORK_ENDPOINT_REGISTRY_AUDIT_STATUS:-unknown}" == "ok" ]] || return 64
    [[ "${NETWORK_ENDPOINT_REGISTRY_AUDIT_FILE:-}" == "${file}" ]] || return 64
    [[ -n "${url}" ]] || return 64
    awk -F '\t' -v target="${url}" '
        /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
        $1 == target { print $5; exit }
    ' "${file}" 2> /dev/null
}

network_endpoint_registry_audit_summary_v1() {
    printf 'status=%s version_status=%s version=%s expected_version=%s rows=%s bad_rows=%s bad_urls=%s bad_ids=%s bad_capabilities=%s bad_criticality=%s bad_expected_http=%s duplicate_urls=%s duplicate_ids=%s total_bad=%s' \
        "${NETWORK_ENDPOINT_REGISTRY_AUDIT_STATUS:-unknown}" \
        "${NETWORK_ENDPOINT_REGISTRY_AUDIT_VERSION_STATUS:-unknown}" \
        "${NETWORK_ENDPOINT_REGISTRY_AUDIT_VERSION:-unknown}" \
        "${NETWORK_ENDPOINT_REGISTRY_AUDIT_EXPECTED_VERSION:-unknown}" \
        "${NETWORK_ENDPOINT_REGISTRY_AUDIT_ROWS:-0}" \
        "${NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_ROWS:-0}" \
        "${NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_URLS:-0}" \
        "${NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_IDS:-0}" \
        "${NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_CAPABILITIES:-0}" \
        "${NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_CRITICALITY:-0}" \
        "${NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_EXPECTED_HTTP:-0}" \
        "${NETWORK_ENDPOINT_REGISTRY_AUDIT_DUPLICATE_URLS:-0}" \
        "${NETWORK_ENDPOINT_REGISTRY_AUDIT_DUPLICATE_IDS:-0}" \
        "${NETWORK_ENDPOINT_REGISTRY_AUDIT_TOTAL_BAD:-0}"
}
