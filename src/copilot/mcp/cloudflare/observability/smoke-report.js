// @ts-check
/** Connector-smoke parsing and decision-oriented response projection. */

/** @param {string} stdout @returns {unknown} */
export function parseConnectorSmokeJsonOutput(stdout) {
    const candidates = [stdout.trim()];
    const jsonStart = /\{\s*"ok"\s*:/u.exec(stdout)?.index;
    if (typeof jsonStart === 'number' && jsonStart > 0) {
        candidates.push(stdout.slice(jsonStart).trim());
    }
    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            return JSON.parse(candidate);
        } catch {
            // Try the next candidate. The smoke CLI may emit startup logs before the final JSON report.
        }
    }
    throw new Error('No parseable smoke JSON object found in stdout.');
}

/** @param {unknown} value @param {boolean} includeRemoteToolNames @returns {unknown} */
export function compactSmokeReport(value, includeRemoteToolNames) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const report = /** @type {Record<string, unknown>} */ (value);
    const toolsList =
        report['toolsList'] && typeof report['toolsList'] === 'object' && !Array.isArray(report['toolsList'])
            ? { .../** @type {Record<string, unknown>} */ (report['toolsList']) }
            : report['toolsList'];
    /** @type {Record<string, unknown> | null} */
    const authenticatedOAuthSmoke =
        report['authenticatedOAuthSmoke'] &&
        typeof report['authenticatedOAuthSmoke'] === 'object' &&
        !Array.isArray(report['authenticatedOAuthSmoke'])
            ? { .../** @type {Record<string, unknown>} */ (report['authenticatedOAuthSmoke']) }
            : null;
    const authenticatedToolsList =
        authenticatedOAuthSmoke &&
        typeof authenticatedOAuthSmoke === 'object' &&
        !Array.isArray(authenticatedOAuthSmoke) &&
        authenticatedOAuthSmoke['authenticatedToolsList'] &&
        typeof authenticatedOAuthSmoke['authenticatedToolsList'] === 'object' &&
        !Array.isArray(authenticatedOAuthSmoke['authenticatedToolsList'])
            ? { .../** @type {Record<string, unknown>} */ (authenticatedOAuthSmoke['authenticatedToolsList']) }
            : null;
    if (!includeRemoteToolNames) {
        if (toolsList && typeof toolsList === 'object' && !Array.isArray(toolsList)) {
            const toolsListRecord = /** @type {Record<string, unknown>} */ (toolsList);
            if ('remoteToolNames' in toolsListRecord) {
                delete toolsListRecord['remoteToolNames'];
                toolsListRecord['remoteToolNamesSuppressed'] = true;
            }
        }
        if (authenticatedToolsList) {
            if ('remoteToolNames' in authenticatedToolsList) {
                delete authenticatedToolsList['remoteToolNames'];
                authenticatedToolsList['remoteToolNamesSuppressed'] = true;
            }
            if (
                authenticatedOAuthSmoke &&
                typeof authenticatedOAuthSmoke === 'object' &&
                !Array.isArray(authenticatedOAuthSmoke)
            ) {
                authenticatedOAuthSmoke['authenticatedToolsList'] = authenticatedToolsList;
            }
        }
    }
    return { ...report, toolsList, authenticatedOAuthSmoke };
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function smokeRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/** @param {unknown} value @returns {Record<string, unknown>} */
export function summarizeConnectorSmokeReport(value) {
    const report = smokeRecord(value);
    const orchestration = smokeRecord(report['orchestrationTimings']);
    const health = smokeRecord(report['health']);
    const oauth = smokeRecord(report['oauth']);
    const protectedResource = smokeRecord(oauth['protectedResource']);
    const authorizationServer = smokeRecord(oauth['authorizationServer']);
    const authChallenge = smokeRecord(report['authChallenge']);
    const authenticated = smokeRecord(report['authenticatedOAuthSmoke']);
    const runtimeHealth = smokeRecord(authenticated['runtimeHealth']);
    const toolsList = smokeRecord(authenticated['authenticatedToolsList']);
    const modernSubscription = smokeRecord(authenticated['modernSubscription']);
    const legacy2025 = smokeRecord(authenticated['legacy2025Compatibility']);
    const legacySse = smokeRecord(legacy2025['authenticatedSse']);
    const failedChecks = Array.isArray(authenticated['failedChecks']) ? authenticated['failedChecks'] : [];
    const missingLocalTools = Array.isArray(toolsList['missingLocalTools']) ? toolsList['missingLocalTools'] : [];
    const unexpectedRemoteTools = Array.isArray(toolsList['unexpectedRemoteTools'])
        ? toolsList['unexpectedRemoteTools']
        : [];
    return {
        ok: report['ok'] === true,
        protocolVersion: report['protocolVersion'] ?? null,
        authMode: report['authMode'] ?? null,
        timings: {
            totalMs: orchestration['totalMs'] ?? smokeRecord(report['timings'])['totalMs'] ?? null,
            unauthenticatedMs: orchestration['unauthenticatedMs'] ?? null,
            authenticatedOauthMs: orchestration['authenticatedOauthMs'] ?? authenticated['durationMs'] ?? null,
        },
        health: { ok: health['ok'] === true, status: health['status'] ?? null },
        oauth: {
            protectedResourceOk: protectedResource['ok'] === true,
            authorizationServerOk: authorizationServer['ok'] === true,
            challengeOk: authChallenge['ok'] === true,
            challengeStatus: authChallenge['status'] ?? null,
        },
        authenticated: {
            ok: authenticated['ok'] === true,
            durationMs: authenticated['durationMs'] ?? null,
            failedCheckCount: failedChecks.length,
            runtimeHealth: { ok: runtimeHealth['ok'] === true, status: runtimeHealth['status'] ?? null },
            toolsList: {
                ok: toolsList['ok'] === true,
                status: toolsList['status'] ?? null,
                responseBytes: toolsList['responseBytes'] ?? null,
                tools: toolsList['tools'] ?? null,
                expectedLocalTools: toolsList['expectedLocalTools'] ?? null,
                toolsMatchLocalRegistry: toolsList['toolsMatchLocalRegistry'] === true,
                missingCount: missingLocalTools.length,
                unexpectedCount: unexpectedRemoteTools.length,
            },
            modernSubscription: {
                ok: modernSubscription['ok'] === true,
                status: modernSubscription['status'] ?? null,
                opened: modernSubscription['opened'] === true,
                closedAs: modernSubscription['closedAs'] ?? null,
            },
            legacy2025Compatibility: {
                enabled: legacy2025['enabled'] === true,
                ok: legacy2025['ok'] === true,
                protocolVersion: legacy2025['protocolVersion'] ?? null,
                sse: {
                    ok: legacySse['ok'] === true,
                    status: legacySse['status'] ?? null,
                    initialOk: legacySse['initialOk'] === true,
                    reconnectOk: legacySse['reconnectOk'] === true,
                    lastEventIdAccepted: legacySse['lastEventIdAccepted'] === true,
                },
            },
        },
    };
}
