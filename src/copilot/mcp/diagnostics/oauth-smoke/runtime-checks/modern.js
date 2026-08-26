// @ts-check
/**
 * Canonical remote MCP 2026-07-28 runtime checks for the OAuth smoke.
 *
 * This owner deliberately delegates protocol framing, discovery, request metadata, header routing and subscription
 * setup to the official v2 MCP client. Diagnostics must not maintain a second hand-written implementation of the
 * modern wire contract.
 *
 * @module copilot/mcp/diagnostics/oauth-smoke/runtime-checks/modern
 */

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { MCP_PROTOCOL_MODERN_VERSION } from '#copilot/mcp/public/protocol/version';

export const MCP_OAUTH_MODERN_RUNTIME_SMOKE_VERSION = '1.0.0';

/**
 * @typedef {{
 *     ok: boolean;
 *     status?: number;
 *     body?: unknown;
 *     error?: string;
 *     durationMs?: number;
 * }} ModernProbeResult
 *
 * @typedef {{ method: string | null; name: string | null; status: number | null }} ModernRequestEvidence
 */

/**
 * @param {{ mcpUrl: string; accessToken: string; timeoutMs: number }} input
 * @returns {Promise<{
 *     protocolEra: '2026';
 *     protocolVersion: typeof MCP_PROTOCOL_MODERN_VERSION;
 *     discovery: ModernProbeResult;
 *     runtimeHealth: ModernProbeResult;
 *     authenticatedToolsList: ModernProbeResult;
 *     subscription: ModernProbeResult;
 *     subscriptionClose: { ok: boolean; outcome: 'local' | 'graceful' | 'remote' | null; error: string | null };
 *     requestEvidence: ModernRequestEvidence[];
 *     serverVersion: string | null;
 * }>}
 */
export async function runModernMcpRuntimeChecks(input) {
    const startedAtMs = Date.now();
    /** @type {ModernRequestEvidence[]} */
    const requestEvidence = [];
    /** @type {typeof fetch} */
    const authenticatedFetch = async (requestInput, requestInit) => {
        const source = requestInput instanceof Request ? requestInput : new Request(requestInput, requestInit);
        const headers = new Headers(source.headers);
        headers.set('authorization', `Bearer ${input.accessToken}`);
        const timeoutSignal = AbortSignal.timeout(input.timeoutMs);
        const signal = source.signal ? AbortSignal.any([source.signal, timeoutSignal]) : timeoutSignal;
        const request = new Request(source, { headers, signal });
        const method = normalizeHeader(request.headers.get('mcp-method'));
        const name = normalizeHeader(request.headers.get('mcp-name'));
        try {
            const response = await fetch(request);
            requestEvidence.push({ method, name, status: response.status });
            return response;
        } catch (error) {
            requestEvidence.push({ method, name, status: null });
            throw error;
        }
    };

    const client = new Client(
        { name: 'copilot-mcp-oauth-smoke-modern', version: MCP_OAUTH_MODERN_RUNTIME_SMOKE_VERSION },
        {
            versionNegotiation: { mode: { pin: MCP_PROTOCOL_MODERN_VERSION } },
            listChanged: {
                tools: {
                    autoRefresh: false,
                    debounceMs: 0,
                    onChanged() {
                        // The remote smoke proves subscription establishment only. Notification delivery/invalidation is
                        // covered by deterministic SDK integration tests and must not require mutating the live catalog.
                    },
                },
            },
        },
    );
    const transport = new StreamableHTTPClientTransport(new URL(input.mcpUrl), { fetch: authenticatedFetch });

    try {
        await client.connect(transport);
        const discoverResult = client.getDiscoverResult();
        const listResult = await client.listTools();
        const runtimeHealthResult = await client.callTool({ name: 'mcp_runtime_health', arguments: {} });
        const subscription = client.autoOpenedSubscription;
        const subscriptionOpened = subscription?.honoredFilter?.toolsListChanged === true;
        let subscriptionClose = {
            ok: false,
            outcome: /** @type {'local' | 'graceful' | 'remote' | null} */ (null),
            error: /** @type {string | null} */ (null),
        };
        if (subscription) {
            try {
                await subscription.close();
                const outcome = await subscription.closed;
                subscriptionClose = { ok: outcome === 'local', outcome, error: null };
            } catch (error) {
                subscriptionClose = {
                    ok: false,
                    outcome: null,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        }
        const discoveryRequest = findLatestRequest(requestEvidence, 'server/discover');
        const toolsListRequest = findLatestRequest(requestEvidence, 'tools/list');
        const toolsCallRequest = findLatestRequest(requestEvidence, 'tools/call');
        const subscriptionRequest = findLatestRequest(requestEvidence, 'subscriptions/listen');
        return {
            protocolEra: '2026',
            protocolVersion: MCP_PROTOCOL_MODERN_VERSION,
            discovery: {
                ok: Boolean(discoverResult && isSuccessStatus(discoveryRequest?.status)),
                ...(discoveryRequest?.status === null || discoveryRequest?.status === undefined
                    ? {}
                    : { status: discoveryRequest.status }),
                body: discoverResult ?? null,
            },
            runtimeHealth: {
                ok: isSuccessStatus(toolsCallRequest?.status) && runtimeHealthResult.isError !== true,
                ...(toolsCallRequest?.status === null || toolsCallRequest?.status === undefined
                    ? {}
                    : { status: toolsCallRequest.status }),
                body: { result: runtimeHealthResult },
            },
            authenticatedToolsList: {
                ok: isSuccessStatus(toolsListRequest?.status) && Array.isArray(listResult.tools),
                ...(toolsListRequest?.status === null || toolsListRequest?.status === undefined
                    ? {}
                    : { status: toolsListRequest.status }),
                body: { result: listResult },
            },
            subscription: {
                ok: subscriptionOpened && isSuccessStatus(subscriptionRequest?.status) && subscriptionClose.ok,
                ...(subscriptionRequest?.status === null || subscriptionRequest?.status === undefined
                    ? {}
                    : { status: subscriptionRequest.status }),
                body: {
                    opened: subscriptionOpened,
                    honoredFilter: subscription?.honoredFilter ?? null,
                    closedAs: subscriptionClose.outcome,
                },
                ...(subscriptionClose.error ? { error: subscriptionClose.error } : {}),
            },
            subscriptionClose,
            requestEvidence,
            serverVersion: client.getServerVersion()?.version ?? null,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failure = {
            ok: false,
            error: message,
            durationMs: Date.now() - startedAtMs,
        };
        return {
            protocolEra: '2026',
            protocolVersion: MCP_PROTOCOL_MODERN_VERSION,
            discovery: failure,
            runtimeHealth: failure,
            authenticatedToolsList: failure,
            subscription: failure,
            subscriptionClose: { ok: false, outcome: null, error: message },
            requestEvidence,
            serverVersion: client.getServerVersion()?.version ?? null,
        };
    } finally {
        await client.close().catch(() => {});
    }
}

/** @param {ModernRequestEvidence[]} evidence @param {string} method */
function findLatestRequest(evidence, method) {
    return [...evidence].reverse().find((row) => row.method === method) ?? null;
}

/** @param {number | null | undefined} status */
function isSuccessStatus(status) {
    return typeof status === 'number' && status >= 200 && status < 300;
}

/** @param {string | null} value */
function normalizeHeader(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
}
