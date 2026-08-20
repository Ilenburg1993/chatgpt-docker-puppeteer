// @ts-check
/**
 * Complete originRequest profile and audit helpers for the Copilot MCP Cloudflare Tunnel.
 *
 * @module copilot/mcp/cloudflare/origin-request-profile
 */

/**
 * @typedef {'explicit' | 'keep-unset' | 'conditional' | 'forbidden'} DesiredMode
 *
 * @typedef {'tls' | 'http' | 'connection' | 'access'} OriginRequestGroup
 *
 * @typedef {object} OriginRequestFieldSpec
 * @property {string} key
 * @property {OriginRequestGroup} group
 * @property {unknown} defaultValue
 * @property {unknown} recommendedValue
 * @property {DesiredMode} desiredMode
 * @property {string} rationale
 * @property {boolean} includedInApplyPlan
 *
 * @typedef {object} OriginRequestProfileOptions
 * @property {string} [originServiceUrl]
 * @property {string} [originServerName]
 * @property {boolean} [enableHttp2Origin]
 */

/** @type {OriginRequestFieldSpec[]} */
export const ORIGIN_REQUEST_FIELD_SPECS = [
    {
        key: 'originServerName',
        group: 'tls',
        defaultValue: '',
        recommendedValue: null,
        desiredMode: 'keep-unset',
        rationale: 'HTTP loopback origin has no TLS certificate name to validate.',
        includedInApplyPlan: false,
    },
    {
        key: 'matchSNItoHost',
        group: 'tls',
        defaultValue: false,
        recommendedValue: false,
        desiredMode: 'keep-unset',
        rationale: 'SNI is not used for the current plain HTTP loopback origin.',
        includedInApplyPlan: false,
    },
    {
        key: 'caPool',
        group: 'tls',
        defaultValue: '',
        recommendedValue: null,
        desiredMode: 'keep-unset',
        rationale: 'A CA bundle is only needed for HTTPS origins with private trust roots.',
        includedInApplyPlan: false,
    },
    {
        key: 'noTLSVerify',
        group: 'tls',
        defaultValue: false,
        recommendedValue: false,
        desiredMode: 'explicit',
        rationale:
            'Keep TLS verification enabled if the origin later becomes HTTPS; unnecessary for current HTTP origin.',
        includedInApplyPlan: true,
    },
    {
        key: 'tlsTimeout',
        group: 'tls',
        defaultValue: '10s',
        recommendedValue: null,
        desiredMode: 'keep-unset',
        rationale: 'TLS timeout does not apply to the current HTTP loopback origin.',
        includedInApplyPlan: false,
    },
    {
        key: 'http2Origin',
        group: 'tls',
        defaultValue: false,
        recommendedValue: false,
        desiredMode: 'explicit',
        rationale: 'HTTP/2 to origin requires an HTTPS origin certificate; keep false for http://127.0.0.1:3333.',
        includedInApplyPlan: true,
    },
    {
        key: 'httpHostHeader',
        group: 'http',
        defaultValue: '',
        recommendedValue: null,
        desiredMode: 'keep-unset',
        rationale: 'Leaving this unset preserves normal host handling unless the origin requires a forced Host header.',
        includedInApplyPlan: false,
    },
    {
        key: 'disableChunkedEncoding',
        group: 'http',
        defaultValue: false,
        recommendedValue: false,
        desiredMode: 'explicit',
        rationale:
            'MCP/SSE/streaming should preserve HTTP/1.1 chunked transfer encoding; WSGI workaround is not needed.',
        includedInApplyPlan: true,
    },
    {
        key: 'connectTimeout',
        group: 'connection',
        defaultValue: '30s',
        recommendedValue: '5s',
        desiredMode: 'explicit',
        rationale: 'Loopback origin should fail fast when the MCP server is down; 30s delays tool recovery.',
        includedInApplyPlan: true,
    },
    {
        key: 'noHappyEyeballs',
        group: 'connection',
        defaultValue: false,
        recommendedValue: false,
        desiredMode: 'explicit',
        rationale:
            'Keep IPv4/IPv6 fallback behavior enabled for future hostnames; current origin is already IPv4 loopback.',
        includedInApplyPlan: true,
    },
    {
        key: 'proxyType',
        group: 'connection',
        defaultValue: '',
        recommendedValue: null,
        desiredMode: 'keep-unset',
        rationale: 'This HTTP MCP route is not an SSH/RDP/TCP proxy route.',
        includedInApplyPlan: false,
    },
    {
        key: 'proxyAddress',
        group: 'connection',
        defaultValue: '127.0.0.1',
        recommendedValue: null,
        desiredMode: 'keep-unset',
        rationale: 'Proxy listen address is for locally-managed TCP proxy use cases, not this remote HTTP route.',
        includedInApplyPlan: false,
    },
    {
        key: 'proxyPort',
        group: 'connection',
        defaultValue: 0,
        recommendedValue: null,
        desiredMode: 'keep-unset',
        rationale: 'Proxy listen port is for locally-managed TCP proxy use cases, not this remote HTTP route.',
        includedInApplyPlan: false,
    },
    {
        key: 'keepAliveTimeout',
        group: 'connection',
        defaultValue: '1m30s',
        recommendedValue: '1m30s',
        desiredMode: 'explicit',
        rationale:
            'Pin the documented default so future drift is visible while preserving stable idle connection reuse.',
        includedInApplyPlan: true,
    },
    {
        key: 'keepAliveConnections',
        group: 'connection',
        defaultValue: 100,
        recommendedValue: 100,
        desiredMode: 'explicit',
        rationale: 'Pin the documented default; it caps idle keepalive connections, not total concurrency.',
        includedInApplyPlan: true,
    },
    {
        key: 'tcpKeepAlive',
        group: 'connection',
        defaultValue: '30s',
        recommendedValue: '30s',
        desiredMode: 'explicit',
        rationale: 'Pin the documented default to keep idle TCP paths healthy and make drift auditable.',
        includedInApplyPlan: true,
    },
    {
        key: 'access',
        group: 'access',
        defaultValue: '',
        recommendedValue: null,
        desiredMode: 'keep-unset',
        rationale: 'Cloudflare Access JWT validation would be a separate auth layer; current MCP already uses OAuth.',
        includedInApplyPlan: false,
    },
];

/** @returns {string[]} */
export function getOriginRequestFieldKeys() {
    return ORIGIN_REQUEST_FIELD_SPECS.map((field) => field.key);
}

/**
 * @param {OriginRequestProfileOptions} [options]
 * @returns {Record<string, unknown>}
 */
export function buildDesiredOriginRequestProfile(options = {}) {
    const fields = buildResolvedOriginRequestFieldSpecs(options).map((field) => ({
        key: field.key,
        group: field.group,
        defaultValue: field.defaultValue,
        recommendedValue: field.recommendedValue,
        desiredMode: field.desiredMode,
        includedInApplyPlan: field.includedInApplyPlan,
        rationale: field.rationale,
    }));
    const originServiceUrl = options.originServiceUrl ?? 'http://127.0.0.1:3333';
    return {
        serviceAssumption: originServiceUrl,
        strategy:
            'Pin performance/safety-critical originRequest fields; enable http2Origin only when the origin service is HTTPS and the MCP HTTP/2 adapter is intentionally enabled.',
        fields,
        recommendedOriginRequest: buildRecommendedOriginRequestPatch(options),
        invariants: [
            'Do not set http2Origin=true while origin service is plain HTTP loopback.',
            'Do not set http2Origin=true without a TLS-ready Node origin and an explicit rollout decision.',
            'Do not set disableChunkedEncoding=true for MCP/SSE/streaming routes.',
            'Do not add Cloudflare Access origin JWT validation unless ChatGPT connector OAuth is redesigned for that extra layer.',
            'Keep proxy fields unset for this HTTP published application route.',
        ],
    };
}

/**
 * @param {OriginRequestProfileOptions} [options]
 * @returns {Record<string, unknown>}
 */
export function buildRecommendedOriginRequestPatch(options = {}) {
    /** @type {Record<string, unknown>} */
    const patch = {};
    for (const field of buildResolvedOriginRequestFieldSpecs(options)) {
        if (field.includedInApplyPlan) patch[field.key] = field.recommendedValue;
    }
    return patch;
}

/**
 * @param {Record<string, unknown>} originRequest
 * @param {{
 *     hostnameRulePresent?: boolean;
 *     originServiceUrl?: string;
 *     originServerName?: string;
 *     enableHttp2Origin?: boolean;
 * }} [options]
 * @returns {{
 *     actual: Record<string, unknown>;
 *     desired: Record<string, unknown>;
 *     applyPlan: Record<string, unknown>;
 *     critical: string[];
 *     warnings: string[];
 *     recommendations: string[];
 *     fieldFindings: Record<string, unknown>[];
 *     score: Record<string, unknown>;
 * }}
 */
export function auditOriginRequestProfile(originRequest, options = {}) {
    const hostnameRulePresent = options.hostnameRulePresent !== false;
    const actual = buildActualOriginRequest(originRequest);
    const resolvedSpecs = buildResolvedOriginRequestFieldSpecs(options);
    const applyPlan = buildRecommendedOriginRequestPatch(options);
    /** @type {string[]} */
    const critical = [];
    /** @type {string[]} */
    const warnings = [];
    /** @type {string[]} */
    const recommendations = [];
    /** @type {Record<string, unknown>[]} */
    const fieldFindings = [];

    for (const field of resolvedSpecs) {
        const value = actual[field.key];
        const configured = value !== null && value !== undefined && value !== '';
        const matchesRecommendation = sameConfigValue(value, field.recommendedValue, field.key);
        let status = 'ok';
        let action = 'none';
        if (!hostnameRulePresent) {
            status = 'not-evaluated';
            action = 'restore-hostname-rule-first';
        } else if (field.desiredMode === 'forbidden' && configured) {
            status = 'critical';
            action = 'remove';
        } else if (field.includedInApplyPlan && !matchesRecommendation) {
            status = configured ? 'drift' : 'recommended-explicit';
            action = 'set-recommended-value';
            recommendations.push(`${field.key}: set to ${formatValue(field.recommendedValue)}. ${field.rationale}`);
        } else if (!field.includedInApplyPlan && configured) {
            status = 'review';
            action = 'confirm-or-remove';
            warnings.push(
                `${field.key}: configured but not recommended for the current HTTP loopback origin. ${field.rationale}`,
            );
        }
        fieldFindings.push({
            key: field.key,
            group: field.group,
            actualValue: value,
            recommendedValue: field.recommendedValue,
            defaultValue: field.defaultValue,
            desiredMode: field.desiredMode,
            includedInApplyPlan: field.includedInApplyPlan,
            status,
            action,
            rationale: field.rationale,
        });
    }

    if (actual['http2Origin'] === true && applyPlan['http2Origin'] !== true) {
        critical.push(
            'originRequest.http2Origin=true is incompatible unless the origin service is HTTPS and HTTP/2 origin rollout is explicit.',
        );
    }
    if (actual['disableChunkedEncoding'] === true) {
        critical.push('originRequest.disableChunkedEncoding=true may break MCP streaming/SSE behavior.');
    }
    if (actual['access'] && typeof actual['access'] === 'object') {
        warnings.push(
            'originRequest.access is configured; confirm ChatGPT OAuth still works with the added Access JWT layer.',
        );
    }

    const configuredCount = Object.values(actual).filter(
        (value) => value !== null && value !== undefined && value !== '',
    ).length;
    const explicitRecommendedCount = resolvedSpecs.filter((field) => field.includedInApplyPlan).length;
    const explicitMatches = resolvedSpecs.filter(
        (field) => field.includedInApplyPlan && sameConfigValue(actual[field.key], field.recommendedValue, field.key),
    ).length;

    return {
        actual,
        desired: buildDesiredOriginRequestProfile(options),
        applyPlan,
        critical,
        warnings,
        recommendations,
        fieldFindings,
        score: {
            configuredCount,
            knownFieldCount: resolvedSpecs.length,
            explicitRecommendedCount,
            explicitMatches,
            explicitCoverage:
                explicitRecommendedCount === 0 ? 1 : Number((explicitMatches / explicitRecommendedCount).toFixed(3)),
        },
    };
}

/**
 * @param {OriginRequestProfileOptions} options
 * @returns {OriginRequestFieldSpec[]}
 */
function buildResolvedOriginRequestFieldSpecs(options) {
    const originServiceUrl = options.originServiceUrl ?? 'http://127.0.0.1:3333';
    const httpsOrigin = /^https:\/\//u.test(originServiceUrl);
    const allowH2Origin = options.enableHttp2Origin === true && httpsOrigin;
    const originServerName = String(options.originServerName ?? '').trim();
    return ORIGIN_REQUEST_FIELD_SPECS.map((field) => {
        if (field.key === 'originServerName' && httpsOrigin && originServerName) {
            return {
                ...field,
                recommendedValue: originServerName,
                desiredMode: 'explicit',
                includedInApplyPlan: true,
                rationale:
                    'HTTPS loopback origin must send an SNI/server name covered by the Cloudflare Origin CA certificate.',
            };
        }
        if (httpsOrigin && field.key === 'matchSNItoHost') {
            return {
                ...field,
                rationale:
                    'originServerName is pinned explicitly for the HTTPS loopback origin, so deriving SNI from Host should remain unset.',
            };
        }
        if (httpsOrigin && field.key === 'caPool') {
            return {
                ...field,
                rationale:
                    'Keep caPool unset while the configured Cloudflare origin certificate validates with the active trust path; pin a pool only for a private CA requirement.',
            };
        }
        if (httpsOrigin && field.key === 'noTLSVerify') {
            return {
                ...field,
                rationale: 'TLS verification is required for the canonical HTTPS loopback origin; do not weaken it.',
            };
        }
        if (httpsOrigin && field.key === 'tlsTimeout') {
            return {
                ...field,
                rationale:
                    'TLS is active on the canonical origin; keep the Cloudflare default timeout unless measurements justify pinning it.',
            };
        }
        if (field.key !== 'http2Origin') return field;
        if (!allowH2Origin) return field;
        return {
            ...field,
            recommendedValue: true,
            rationale:
                'HTTP/2 to origin is explicitly enabled because the origin service is HTTPS and the Node HTTP/2 adapter is selected.',
        };
    });
}

/**
 * @param {Record<string, unknown>} originRequest
 * @returns {Record<string, unknown>}
 */
function buildActualOriginRequest(originRequest) {
    /** @type {Record<string, unknown>} */
    const actual = {};
    for (const field of ORIGIN_REQUEST_FIELD_SPECS) {
        actual[field.key] = originRequest[field.key] ?? null;
    }
    return actual;
}

/** @type {ReadonlySet<string>} */
const CLOUDFLARE_DURATION_KEYS = new Set(['connectTimeout', 'keepAliveTimeout', 'tcpKeepAlive', 'tlsTimeout']);

/**
 * @param {unknown} left
 * @param {unknown} right
 * @param {string} [key]
 * @returns {boolean}
 */
function sameConfigValue(left, right, key = '') {
    if (left === right) return true;
    if ((left === null || left === undefined || left === '') && (right === null || right === undefined || right === ''))
        return true;
    if (CLOUDFLARE_DURATION_KEYS.has(key)) {
        const leftDuration = normalizeCloudflareDurationNanos(left);
        const rightDuration = normalizeCloudflareDurationNanos(right);
        if (leftDuration !== null && rightDuration !== null) return leftDuration === rightDuration;
    }
    return false;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeCloudflareDurationNanos(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    const matches = [...text.matchAll(/(\d+)(ms|s|m|h)/gu)];
    if (matches.length === 0 || matches.map((match) => match[0]).join('') !== text) return null;
    let total = 0;
    for (const match of matches) {
        const amount = Number(match[1]);
        const unit = match[2];
        const factor =
            unit === 'ms'
                ? 1_000_000
                : unit === 's'
                  ? 1_000_000_000
                  : unit === 'm'
                    ? 60_000_000_000
                    : 3_600_000_000_000;
        total += amount * factor;
    }
    return total;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatValue(value) {
    if (value === null) return 'unset';
    if (typeof value === 'string') return `"${value}"`;
    return String(value);
}
