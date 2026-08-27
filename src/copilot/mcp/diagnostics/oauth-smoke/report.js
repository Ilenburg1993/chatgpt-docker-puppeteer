// @ts-check
/** @module copilot/mcp/diagnostics/oauth-smoke/report */

/** @typedef {{ ok:boolean; status?:number; body?:unknown; error?:string; headers?:Record<string,string>; attempts?:number; transient?:boolean; durationMs?:number; responseBytes?:number; eventReceived?:boolean|null; lastEventId?:string; skipped?:boolean }} ProbeResult
 * @typedef {{ verboseTools:boolean; localToolNames:string[]; localToolFingerprints:Readonly<Record<string,string>> }} OAuthSmokeReportOptions */

/** @param {unknown} value */
export function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/** @param {ProbeResult} probe */
function summarizeProbeBase(probe) {
    return { ok: probe.ok, status: probe.status ?? null, attempts: probe.attempts ?? null, error: probe.error ?? null };
}

/** @param {ProbeResult} probe */
export function summarizeProtectedResourceProbe(probe) {
    const body = asRecord(probe.body);
    return {
        ...summarizeProbeBase(probe),
        resource: body?.['resource'] ?? null,
        authorizationServers: body?.['authorization_servers'] ?? [],
        scopesSupported: body?.['scopes_supported'] ?? [],
        bearerMethodsSupported: body?.['bearer_methods_supported'] ?? [],
        bodyKind: typeof probe.body,
        transient: probe.transient ?? false,
    };
}

/** @param {ProbeResult} probe */
export function summarizeMetadataProbe(probe) {
    const body = asRecord(probe.body);
    return {
        ...summarizeProbeBase(probe),
        issuer: body?.['issuer'] ?? null,
        authorizationEndpointConfigured: typeof body?.['authorization_endpoint'] === 'string',
        tokenEndpointConfigured: typeof body?.['token_endpoint'] === 'string',
        registrationEndpointConfigured: typeof body?.['registration_endpoint'] === 'string',
        introspectionEndpointConfigured: typeof body?.['introspection_endpoint'] === 'string',
        clientIdMetadataDocumentSupported: body?.['client_id_metadata_document_supported'] === true,
        userinfoEndpointConfigured: typeof body?.['userinfo_endpoint'] === 'string',
        jwksUriConfigured: typeof body?.['jwks_uri'] === 'string',
        codeChallengeMethodsSupported: body?.['code_challenge_methods_supported'] ?? [],
        tokenEndpointAuthMethodsSupported: body?.['token_endpoint_auth_methods_supported'] ?? [],
        tokenEndpointAuthSigningAlgValuesSupported: body?.['token_endpoint_auth_signing_alg_values_supported'] ?? [],
        idTokenSigningAlgValuesSupported: body?.['id_token_signing_alg_values_supported'] ?? [],
        resourceParameterSupported: body?.['resource_parameter_supported'] === true,
        authorizationResponseIssParameterSupported: body?.['authorization_response_iss_parameter_supported'] === true,
        scopesSupported: body?.['scopes_supported'] ?? [],
    };
}

/** @param {ProbeResult} probe */
export function summarizeJwks(probe) {
    const body = asRecord(probe.body);
    return {
        ...summarizeProbeBase(probe),
        keys: Array.isArray(body?.['keys']) ? body['keys'].length : 0,
    };
}

/**
 * @param {ProbeResult} registration
 * @returns {Record<string, unknown>}
 */
export function summarizeRegistration(registration) {
    const body = asRecord(registration.body);
    return {
        ...summarizeProbeBase(registration),
        clientIdIssued: typeof body?.['client_id'] === 'string',
        tokenEndpointAuthMethod: body?.['token_endpoint_auth_method'] ?? null,
        redirectUris: body?.['redirect_uris'] ?? [],
    };
}

/** @param {ProbeResult} probe */
export function summarizeIntrospection(probe) {
    const body = asRecord(probe.body);
    return {
        ok: probe.ok && body?.['active'] === true,
        status: probe.status ?? null,
        active: body?.['active'] ?? null,
        tokenType: body?.['token_type'] ?? null,
        clientId: body?.['client_id'] ?? null,
        scope: body?.['scope'] ?? null,
        audience: body?.['aud'] ?? null,
        resource: body?.['resource'] ?? null,
        cnfPresent: typeof body?.['cnf'] === 'object' && body?.['cnf'] !== null,
        error: probe.error ?? null,
    };
}
/** @param {ProbeResult} token */
export function summarizeToken(token) {
    const body = asRecord(token.body);
    return {
        ...summarizeProbeBase(token),
        tokenType: body?.['token_type'] ?? null,
        expiresIn: body?.['expires_in'] ?? null,
        scope: body?.['scope'] ?? null,
        refreshTokenIssued: typeof body?.['refresh_token'] === 'string',
        refreshTokenExpiresIn: body?.['refresh_token_expires_in'] ?? null,
        idTokenIssued: typeof body?.['id_token'] === 'string',
    };
}

/** @param {ProbeResult} probe */
export function summarizeTokenCleanup(probe) {
    return {
        ok: probe.ok,
        skipped: probe.skipped === true,
        status: probe.status ?? null,
        attempts: probe.attempts ?? null,
        error: probe.error ?? null,
    };
}

/** @param {{ ok: boolean; status?: number; error?: string; durationMs?: number; body?: unknown }} probe */
export function summarizeRuntimeProbe(probe) {
    return {
        ok: probe.ok,
        status: probe.status ?? null,
        durationMs: probe.durationMs ?? null,
        hasJsonRpcError: hasJsonRpcError(probe.body),
        error: probe.error ?? null,
    };
}

/** @param {{ ok: boolean; status?: number; error?: string; body?: unknown }} probe */
export function summarizeModernSubscription(probe) {
    const body = asRecord(probe.body);
    return {
        ok: probe.ok,
        status: probe.status ?? null,
        opened: body?.['opened'] === true,
        honoredFilter: body?.['honoredFilter'] ?? null,
        closedAs: body?.['closedAs'] ?? null,
        error: probe.error ?? null,
    };
}

/** @param {ProbeResult} probe */
export function summarizeSseProbe(probe) {
    const body =
        probe.body && typeof probe.body === 'object' && !Array.isArray(probe.body)
            ? /** @type {Record<string, unknown>} */ (probe.body)
            : {};
    const initial =
        body['initial'] && typeof body['initial'] === 'object' && !Array.isArray(body['initial'])
            ? /** @type {Record<string, unknown>} */ (body['initial'])
            : {};
    const reconnect =
        body['reconnect'] && typeof body['reconnect'] === 'object' && !Array.isArray(body['reconnect'])
            ? /** @type {Record<string, unknown>} */ (body['reconnect'])
            : {};
    return {
        ok: probe.ok,
        status: probe.status ?? initial['status'] ?? reconnect['status'] ?? null,
        attempts: probe.attempts ?? null,
        durationMs: probe.durationMs ?? null,
        contentType: probe.headers?.['content-type'] ?? initial['contentType'] ?? reconnect['contentType'] ?? null,
        diagnosticProbe:
            probe.headers?.['x-copilot-mcp-sse-probe'] === 'ok' ||
            initial['diagnosticProbe'] === true ||
            reconnect['diagnosticProbe'] === true,
        envelopeOk: body['envelopeOk'] ?? null,
        diagnosticEnvelopeOnly: body['diagnosticEnvelopeOnly'] ?? null,
        realLastEventIdObserved: body['realLastEventIdObserved'] ?? null,
        realReplayCandidate: body['realReplayCandidate'] ?? null,
        eventReceived: probe['eventReceived'] ?? initial['eventReceived'] ?? reconnect['eventReceived'] ?? null,
        lastEventId: probe['lastEventId'] ?? null,
        initialOk: initial['ok'] ?? null,
        initialStatus: initial['status'] ?? null,
        initialEventReceived: initial['eventReceived'] ?? null,
        initialLastEventId: initial['lastEventId'] ?? null,
        initialError: initial['error'] ?? null,
        reconnectOk: reconnect['ok'] ?? null,
        reconnectStatus: reconnect['status'] ?? null,
        reconnectEventReceived: reconnect['eventReceived'] ?? null,
        reconnectLastEventId: reconnect['lastEventId'] ?? null,
        reconnectError: reconnect['error'] ?? null,
        lastEventIdAccepted: body['lastEventIdAccepted'] ?? null,
        error: probe.error ?? null,
    };
}

/** @param {ProbeResult} probe @param {OAuthSmokeReportOptions} runtime */
export async function summarizeAuthenticatedToolsList(probe, runtime) {
    const { buildMcpToolWireParityProjection, extractMcpToolWireDescriptors, previewMcpToolNames } =
        await import('#copilot/mcp/public/protocol/catalog/descriptor-fingerprint');
    const remoteDescriptors = extractMcpToolWireDescriptors(probe.body);
    const remoteToolNames = remoteDescriptors
        .map((descriptor) => String(descriptor['name']))
        .sort((left, right) => left.localeCompare(right));
    const localToolNames = runtime.localToolNames;
    const missingLocalTools = localToolNames.filter((toolName) => !remoteToolNames.includes(toolName));
    const unexpectedRemoteTools = remoteToolNames.filter((toolName) => !localToolNames.includes(toolName));
    const toolsMatchLocalRegistry = missingLocalTools.length === 0 && unexpectedRemoteTools.length === 0;
    const schemaParity = buildMcpToolWireParityProjection(remoteDescriptors, runtime.localToolFingerprints);
    return {
        ok: Boolean(
            probe.ok &&
            remoteToolNames.length > 0 &&
            toolsMatchLocalRegistry &&
            (schemaParity.required !== true || schemaParity.matches === true),
        ),
        status: probe.status ?? null,
        attempts: probe.attempts ?? null,
        responseBytes: probe.responseBytes ?? null,
        tools: remoteToolNames.length,
        expectedLocalTools: localToolNames.length,
        toolsMatchLocalRegistry,
        missingLocalTools,
        unexpectedRemoteTools,
        schemaParity,
        ...(runtime.verboseTools
            ? { remoteToolNames }
            : { remoteToolNamesPreview: previewMcpToolNames(remoteToolNames) }),
        hasJsonRpcError: hasJsonRpcError(probe.body),
        error: probe.error ?? null,
    };
}

/** @param {ProbeResult} probe */
export function summarizeClientMetadata(probe) {
    const body = asRecord(probe.body);
    return {
        ...summarizeProbeBase(probe),
        clientId: body?.['client_id'] ?? null,
        clientNameConfigured: typeof body?.['client_name'] === 'string',
        tokenEndpointAuthMethod: body?.['token_endpoint_auth_method'] ?? null,
        redirectUris: body?.['redirect_uris'] ?? [],
    };
}

/** @param {ProbeResult} probe */
export function summarizeUserinfo(probe) {
    const body = asRecord(probe.body);
    return {
        ...summarizeProbeBase(probe),
        subject: body?.['sub'] ?? null,
        emailVerified: body?.['email_verified'] ?? null,
    };
}

/** @param {unknown} body @returns {boolean} */
export function hasJsonRpcError(body) {
    if (Array.isArray(body)) return body.some((message) => hasJsonRpcError(message));
    return Boolean(body && typeof body === 'object' && 'error' in body && body.error);
}
