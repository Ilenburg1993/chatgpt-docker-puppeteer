// @ts-check
/**
 * Node-host MCP HTTP request handler assembly and era dispatcher.
 *
 * Canonical hardened replacement for the shared HTTP adapter. It accepts Node HTTP/1.1 requests and Node HTTP/2
 * compatibility requests, reads bounded MCP JSON POST bodies only at the Streamable HTTP boundary, and centralizes the
 * HTTP surface hardening needed by the OAuth/MCP/Cloudflare roadmap:
 *
 * - OAuth authorization endpoint is deliberately excluded from CORS.
 * - MCP protected resource discovery is exposed through RFC 9728-style metadata and WWW-Authenticate challenges.
 * - Cloudflare/HTTP/2+ response hygiene is improved with deterministic headers and no-transform on live MCP responses.
 * - CORS is route-specific, origin-restricted and never wildcarded for browser origins.
 * - HTTP/2 compatibility requests use :authority/:scheme when Host is absent.
 *
 * Version: 1.5.0
 *
 * @module copilot/mcp/adapters/http/handler
 */
import { toNodeHandler, toWebRequest } from '@modelcontextprotocol/node';
import { isLegacyRequest } from '@modelcontextprotocol/server';

import {
    buildProtectedResourceMetadata,
    createDevOAuthRuntime,
    createMcpAuthResourceServerRuntime,
    createOAuthReplayCapability,
    readDevOAuthProcessConfig,
    readMcpAuthRuntimeConfig,
    readOAuthReplayStoreConfig,
} from '#copilot/mcp/public/auth';
import { buildChatGptConnectorProfile } from '#copilot/mcp/public/connection';
import {
    activateMcpHttpRequestActivity,
    activateMcpHttpToolRequestTiming,
    logMcp,
    recordMcpHttpRequestRpcMethod,
    recordMcpHttpTransportMode,
    runWithMcpHttpToolTimingContext,
} from '#copilot/mcp/public/observability';
import { recordMcpToolsListObserved } from '#copilot/mcp/public/protocol/catalog';
import { MCP_PROTOCOL_LEGACY_DEFAULT_VERSION } from '#copilot/mcp/public/protocol/version';
import { createCopilotMcpServer } from '#copilot/mcp/public/server';
import { createMcpModernHttpHandler } from '#copilot/mcp/public/transport/http/modern';
import { readMcpHttpStatefulProcessConfig } from '#copilot/mcp/public/transport/http/stateful/config';
import { createMcpHttpSessionRuntimeForConfig } from '#copilot/mcp/public/transport/http/stateful/runtime';
import { randomUUID } from 'node:crypto';
import { readMcpHttpJsonBody } from '../http-body.js';
import { setMcpHttpProtocolResponseHeaders } from '../http-protocol.js';
import { buildAuthContext, buildAuthContextFromWebRequest } from './auth-context.js';
import { readMcpHttpRequestPolicy } from './config.js';
import { validateMcpAcceptHeader, validateMcpProtocolVersionHeader, validateMcpRequestEnvelope } from './envelope.js';
import { buildMcpHttpHealthPayload } from './health.js';
import { createMcpAnonymousRateLimiter } from './rate-limiter.js';
import { buildRequestUrl, readCloudflareRayColo, readHeader } from './request-identity.js';
import {
    PUBLIC_METADATA_CACHE_CONTROL,
    safeEnd,
    setNoStoreResponseHeaders,
    writeEmpty,
    writeJson,
    writeMcpTransportError,
    writeMethodNotAllowed,
    writeText,
} from './response.js';
import { buildCorsPolicy, KNOWN_ROUTE_METHODS, MCP_PATH, readCorsRoutePolicy } from './route-policy.js';
import { readMcpHttpSessionRuntimeState } from './runtime-state.js';
import {
    isAllowedOrigin,
    rejectAccessTokenInUri,
    setCorsHeaders,
    setDefaultSecurityHeaders,
    shouldIssueMcpUnauthorizedChallenge,
    writeCorsForbidden,
    writeMcpRateLimited,
    writeMcpUnauthorizedChallenge,
} from './security.js';
import {
    classifyMcpCompatibilityContinuity,
    classifyMcpCompatibilityRpcClass,
    classifyMcpHttpRoute,
    readMcpJsonRpcMethodLabel,
    readMcpToolCallName,
} from './telemetry.js';

export const MCP_HTTP_HANDLER_IMPLEMENTATION_VERSION = '1.8.0';

/**
 * @typedef {import('node:http').IncomingMessage | import('node:http2').Http2ServerRequest} McpHttpRequest
 *
 * @typedef {import('node:http').ServerResponse | import('node:http2').Http2ServerResponse} McpHttpResponse
 *
 * @typedef {import('../http-protocol.js').McpHttpProtocolState} McpHttpProtocolState
 * @typedef {((req: McpHttpRequest, res: McpHttpResponse) => Promise<void>) & { close: () => Promise<void>; readSessionRuntimeState: () => Record<string, unknown> }} McpHttpRequestHandler
 *
 * @typedef {{
 *     server: ReturnType<typeof import('#copilot/mcp/public/server').readCopilotMcpServerProfile>;
 *     registry: {
 *         policy: import('#copilot/mcp/public/registry').McpRegistryPolicy;
 *         surfacePolicy: import('#copilot/mcp/public/registry').McpToolSurfacePolicy;
 *     };
 *     auth: Readonly<import('#copilot/mcp/public/auth').McpAuthRuntimeConfig & {
 *         issuer: import('#copilot/mcp/public/auth').DevOAuthProcessConfig;
 *         replay: import('#copilot/mcp/public/auth').OAuthReplayStoreConfig;
 *     }>;
 *     toolConfig: import('#copilot/mcp/public/protocol/tools').McpToolConfigProjection;
 *     toolCapabilities: import('#copilot/mcp/public/protocol/tools').McpToolCapabilityProjection;
 *     indexing: { autoBuild: import('#copilot/mcp/public/indexing/auto-build').McpIndexAutoBuildConfig };
 *     transport: { http: {
 *         request: ReturnType<typeof readMcpHttpRequestPolicy>;
 *         stateful: import('#copilot/mcp/public/transport/http/stateful/config').McpHttpStatefulProcessConfig;
 *     } };
 * }} McpHttpProcessConfigProjection
 */

/**
 * Record one bounded compatibility observation without allowing telemetry failure to affect protocol behavior.
 * The audit capability itself performs the privacy projection; this boundary deliberately does not inspect payloads.
 *
 * @param {import('#copilot/mcp/public/protocol/tools').McpToolCapabilityProjection['audit']} audit
 * @param {Record<string, unknown>} observation
 */
function recordMcpCompatibilityObservation(audit, observation) {
    if (!audit) return;
    try {
        const pending = audit.recordCompatibility(observation);
        void pending.catch(() => undefined);
    } catch {
        // Compatibility telemetry is best-effort and must never become a transport failure.
    }
}

/**
 * @param {{
 *     host: string;
 *     port: number;
 *     protocolState: McpHttpProtocolState;
 *     publicScheme?: 'http' | 'https';
 *     database?: import('#copilot/infra/public/database/sqlite').SqliteDatabasePort;
 *     workspace?: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     processConfig?: McpHttpProcessConfigProjection;
 *     authRuntime?: import('#copilot/mcp/public/auth').McpAuthRuntimeConfig & {
 *         issuer: import('#copilot/mcp/public/auth').DevOAuthProcessConfig;
 *         resourceServer: ReturnType<typeof import('#copilot/mcp/public/auth').createMcpAuthResourceServerRuntime>;
 *         issuerRuntime: ReturnType<typeof import('#copilot/mcp/public/auth').createDevOAuthRuntime>;
 *     };
 *     toolCapabilities?: import('#copilot/mcp/public/protocol/tools').McpToolCapabilityProjection;
 * }} options
 * @returns {McpHttpRequestHandler}
 */
export function createMcpHttpRequestHandler(options) {
    const statefulConfig = options.processConfig?.transport.http.stateful ?? readMcpHttpStatefulProcessConfig();
    const sessionRuntime = createMcpHttpSessionRuntimeForConfig(statefulConfig, {
        ...(options.database ? { database: options.database } : { store: null }),
    });
    const httpSessionRuntimeCapability = Object.freeze({
        readState: () => readMcpHttpSessionRuntimeState(sessionRuntime, statefulConfig),
    });
    const requestPolicy =
        options.processConfig?.transport.http.request ?? readMcpHttpRequestPolicy(undefined, { statefulConfig });
    const anonymousRateLimiter = createMcpAnonymousRateLimiter(requestPolicy.anonymousRateLimit, requestPolicy.proxy);
    const compatibilityAudit = options.toolCapabilities?.audit;
    const authRuntime =
        options.authRuntime ??
        (() => {
            const snapshot =
                options.processConfig?.auth ??
                Object.freeze({
                    ...readMcpAuthRuntimeConfig(),
                    issuer: readDevOAuthProcessConfig(),
                    replay: readOAuthReplayStoreConfig(),
                });
            const replay = createOAuthReplayCapability(() => options.database ?? null, snapshot.replay);
            return Object.freeze({
                ...snapshot,
                resourceServer: createMcpAuthResourceServerRuntime(replay),
                issuerRuntime: createDevOAuthRuntime({
                    processConfig: snapshot.issuer,
                    replay,
                    ...(compatibilityAudit ? { compatibilityObserver: compatibilityAudit.recordCompatibility } : {}),
                }),
            });
        })();
    const authConfig = authRuntime.config;
    const issuerConfig = authRuntime.issuer;
    /** @param {NonNullable<Parameters<typeof createCopilotMcpServer>[0]>} [serverOptions] */
    const createConfiguredServer = (serverOptions = {}) =>
        createCopilotMcpServer({
            ...serverOptions,
            authRuntime,
            ...(options.processConfig
                ? {
                      profile: options.processConfig.server,
                      registryPolicy: options.processConfig.registry.policy,
                      toolSurfacePolicy: options.processConfig.registry.surfacePolicy,
                      authRuntime,
                      toolConfig: options.processConfig.toolConfig,
                      toolCapabilities: {
                          ...(options.toolCapabilities ?? options.processConfig.toolCapabilities),
                          httpSessionRuntime: httpSessionRuntimeCapability,
                      },
                  }
                : {}),
        });
    const modernMcpHandler = createMcpModernHttpHandler(
        (context) =>
            createConfiguredServer({
                authContext: buildAuthContextFromWebRequest(context.requestInfo),
                ...(options.workspace ? { workspace: options.workspace } : {}),
            }),
        {
            onerror: (error) => {
                logMcp('ERROR', 'MCP 2026 handler error.', {
                    error: error.message,
                });
            },
        },
    );
    const modernNodeHandler = toNodeHandler(modernMcpHandler, {
        onerror: (error) => {
            logMcp('ERROR', 'MCP 2026 Node adapter error.', {
                error: error.message,
            });
        },
    });

    /**
     * @param {McpHttpRequest} req
     * @param {McpHttpResponse} res
     * @returns {Promise<void>}
     */
    const requestHandler = async (req, res) => {
        const requestReceivedAt = Date.now();
        const requestTimingId = randomUUID();
        const edgeColo = readCloudflareRayColo(readHeader(req, 'cf-ray'));
        return runWithMcpHttpToolTimingContext(
            { requestId: requestTimingId, receivedAt: requestReceivedAt, edgeColo },
            async () => {
                try {
                    setDefaultSecurityHeaders(req, res, options, requestPolicy);
                    const protocolSample = options.protocolState.lastRequest;
                    if (protocolSample) setMcpHttpProtocolResponseHeaders(res, protocolSample);

                    const url = buildRequestUrl(req, options, requestPolicy.proxy);
                    const finishRequestActivity = activateMcpHttpRequestActivity({
                        httpMethod: req.method ?? 'UNKNOWN',
                        routeClass: classifyMcpHttpRoute(url.pathname, req.method),
                    });
                    if (finishRequestActivity) {
                        const finishActivity = () => {
                            const response = /** @type {import('node:http').ServerResponse} */ (
                                /** @type {unknown} */ (res)
                            );
                            finishRequestActivity(response.statusCode);
                        };
                        res.once('finish', finishActivity);
                        res.once('close', finishActivity);
                    }
                    const corsPolicy = readCorsRoutePolicy(url.pathname);
                    const requestOrigin = readHeader(req, 'origin');

                    if (requestOrigin && !isAllowedOrigin(requestOrigin, requestPolicy.cors.allowedOrigins)) {
                        writeCorsForbidden(
                            res,
                            corsPolicy ??
                                buildCorsPolicy([req.method || 'GET'], { jsonRpcErrors: url.pathname === MCP_PATH }),
                        );
                        return;
                    }

                    if (corsPolicy) {
                        setCorsHeaders(res, requestOrigin, corsPolicy, requestPolicy.cors.allowedOrigins);
                    }

                    if (req.method === 'OPTIONS') {
                        if (corsPolicy) {
                            writeEmpty(res, 204);
                            return;
                        }
                        if (url.pathname === '/oauth/authorize') {
                            writeMethodNotAllowed(res, KNOWN_ROUTE_METHODS['/oauth/authorize'] ?? ['GET']);
                            return;
                        }
                        writeText(res, 404, 'Not Found');
                        return;
                    }

                    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
                        writeJson(
                            res,
                            200,
                            buildMcpHttpHealthPayload({
                                implementationVersion: MCP_HTTP_HANDLER_IMPLEMENTATION_VERSION,
                                protocolState: options.protocolState,
                                requestPolicy,
                                ...(options.processConfig?.indexing.autoBuild
                                    ? { indexAutoBuildConfig: options.processConfig.indexing.autoBuild }
                                    : {}),
                                sessionRuntime,
                                statefulConfig,
                                anonymousRateLimitRuntime: anonymousRateLimiter.snapshot(),
                            }),
                        );
                        return;
                    }

                    if (req.method === 'GET' && url.pathname === '/chatgpt-connector.json') {
                        const publicMcpUrl = url.searchParams.get('publicMcpUrl') ?? undefined;
                        writeJson(
                            res,
                            200,
                            buildChatGptConnectorProfile(publicMcpUrl === undefined ? {} : { publicMcpUrl }),
                            PUBLIC_METADATA_CACHE_CONTROL,
                        );
                        return;
                    }

                    if (
                        req.method === 'GET' &&
                        (url.pathname === '/.well-known/oauth-protected-resource' ||
                            url.pathname === '/.well-known/oauth-protected-resource/mcp')
                    ) {
                        const resource = url.pathname.endsWith('/mcp')
                            ? `${authConfig.resource}/mcp`
                            : authConfig.resource;
                        writeJson(
                            res,
                            200,
                            buildProtectedResourceMetadata(authConfig, { resource }),
                            PUBLIC_METADATA_CACHE_CONTROL,
                        );
                        return;
                    }

                    if (
                        await authRuntime.issuerRuntime.handleRequest(
                            /** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)),
                            /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)),
                            url,
                            authConfig,
                            issuerConfig,
                        )
                    ) {
                        return;
                    }

                    if (url.pathname === MCP_PATH) {
                        const envelopeError = validateMcpRequestEnvelope(req, requestPolicy.transport);
                        if (envelopeError) {
                            writeMcpTransportError(res, envelopeError.statusCode, envelopeError.error);
                            return;
                        }
                        const acceptHeaderError = validateMcpAcceptHeader(req, requestPolicy.transport);
                        if (acceptHeaderError) {
                            writeMcpTransportError(res, 406, acceptHeaderError);
                            return;
                        }
                        const mcpRouteMethods = KNOWN_ROUTE_METHODS[MCP_PATH] ?? ['POST', 'GET', 'DELETE'];
                        if (!req.method || !mcpRouteMethods.includes(req.method)) {
                            writeMethodNotAllowed(res, mcpRouteMethods);
                            return;
                        }
                        if (rejectAccessTokenInUri(url, res)) return;

                        const anonymousRateLimit = anonymousRateLimiter.consume(req);
                        if (!anonymousRateLimit.allowed) {
                            writeMcpRateLimited(res, anonymousRateLimit.retryAfterSeconds);
                            return;
                        }

                        if (shouldIssueMcpUnauthorizedChallenge(req, authConfig)) {
                            writeMcpUnauthorizedChallenge(res, authConfig);
                            return;
                        }

                        setNoStoreResponseHeaders(res);
                        try {
                            /** @type {unknown} */
                            let parsedMcpBody;
                            /** @type {string | null} */
                            let rpcMethod = null;
                            if (String(req.method ?? '').toUpperCase() === 'POST') {
                                const bodyResult = await readMcpHttpJsonBody(req, {
                                    maxBytes: requestPolicy.transport.maxRequestBodyBytes,
                                });
                                if (!bodyResult.ok) {
                                    writeMcpTransportError(res, bodyResult.statusCode, bodyResult.error);
                                    return;
                                }
                                parsedMcpBody = bodyResult.body;
                                rpcMethod = readMcpJsonRpcMethodLabel(parsedMcpBody);
                                recordMcpHttpRequestRpcMethod(rpcMethod);
                                if (rpcMethod === 'tools/list') {
                                    recordMcpToolsListObserved({
                                        protocolVersion:
                                            readHeader(req, 'mcp-protocol-version') ??
                                            MCP_PROTOCOL_LEGACY_DEFAULT_VERSION,
                                    });
                                }
                                const toolCallName = readMcpToolCallName(parsedMcpBody);
                                if (toolCallName !== undefined) {
                                    const finishToolRequestTiming = activateMcpHttpToolRequestTiming(toolCallName);
                                    if (finishToolRequestTiming) {
                                        const finishTimingOnce = () => finishToolRequestTiming();
                                        res.once('finish', finishTimingOnce);
                                        res.once('close', finishTimingOnce);
                                    }
                                }
                            }

                            const webRequest = await toWebRequest(
                                /** @type {import('@modelcontextprotocol/node').NodeIncomingMessageLike} */ (
                                    /** @type {unknown} */ (req)
                                ),
                                parsedMcpBody,
                            );
                            const legacyRequest = await isLegacyRequest(webRequest, parsedMcpBody);
                            if (!legacyRequest) {
                                recordMcpHttpTransportMode('modern-2026');
                                recordMcpCompatibilityObservation(compatibilityAudit, {
                                    kind: 'protocol-request',
                                    protocolEra: '2026',
                                    transportMode: 'modern-2026',
                                    rpcClass: classifyMcpCompatibilityRpcClass(rpcMethod),
                                    continuity: classifyMcpCompatibilityContinuity({
                                        httpMethod: req.method,
                                        rpcMethod,
                                        lastEventIdPresent: Boolean(readHeader(req, 'last-event-id')),
                                    }),
                                });
                                await modernNodeHandler(
                                    /** @type {import('@modelcontextprotocol/node').NodeIncomingMessageLike} */ (
                                        /** @type {unknown} */ (req)
                                    ),
                                    /** @type {import('@modelcontextprotocol/node').NodeServerResponseLike} */ (
                                        /** @type {unknown} */ (res)
                                    ),
                                    parsedMcpBody,
                                );
                                return;
                            }

                            const protocolVersionError = validateMcpProtocolVersionHeader(req, requestPolicy.transport);
                            if (protocolVersionError) {
                                writeMcpTransportError(res, 400, protocolVersionError);
                                return;
                            }

                            const sessionPolicy = requestPolicy.session;
                            if (sessionPolicy.enabled && String(req.method ?? '').toUpperCase() === 'POST') {
                                const { classifyMcpPostSessionRequirement } =
                                    await import('#copilot/mcp/public/transport/http/stateful/request-contract');
                                const postSessionContract = classifyMcpPostSessionRequirement({
                                    method: req.method,
                                    sessionId: readHeader(req, 'mcp-session-id') ?? null,
                                    body: parsedMcpBody,
                                });
                                if (!postSessionContract.ok) {
                                    if (requestPolicy.enforcePostSessionContract) {
                                        writeMcpTransportError(
                                            res,
                                            postSessionContract.statusCode,
                                            postSessionContract.error,
                                        );
                                        return;
                                    }
                                    logMcp(
                                        'WARN',
                                        'MCP compatibility request violates the 2025 stateful session contract.',
                                        {
                                            kind: postSessionContract.kind,
                                            initializeRequest: postSessionContract.initializeRequest,
                                            sessionIdPresent: Boolean(postSessionContract.sessionId),
                                        },
                                    );
                                }
                            }

                            if (sessionPolicy.enabled) {
                                recordMcpHttpTransportMode('stateful');
                                recordMcpCompatibilityObservation(compatibilityAudit, {
                                    kind: 'protocol-request',
                                    protocolEra: '2025',
                                    transportMode: 'stateful',
                                    rpcClass: classifyMcpCompatibilityRpcClass(rpcMethod),
                                    continuity: classifyMcpCompatibilityContinuity({
                                        httpMethod: req.method,
                                        rpcMethod,
                                        lastEventIdPresent: Boolean(readHeader(req, 'last-event-id')),
                                    }),
                                });
                                const { handleStatefulMcpHttpRequest } =
                                    await import('#copilot/mcp/public/transport/http/stateful/router');
                                await handleStatefulMcpHttpRequest({
                                    req,
                                    res,
                                    url,
                                    parsedMcpBody,
                                    authContext: buildAuthContext(req, url),
                                    protocolVersion:
                                        readHeader(req, 'mcp-protocol-version') ?? MCP_PROTOCOL_LEGACY_DEFAULT_VERSION,
                                    ...(options.database ? { database: options.database } : {}),
                                    ...(options.workspace ? { workspace: options.workspace } : {}),
                                    statefulConfig,
                                    runtime: sessionRuntime,
                                    readHeader,
                                    writeTransportError: writeMcpTransportError,
                                    createServer: (serverOptions) => createConfiguredServer(serverOptions),
                                    resolveAuthBinding: (authContext, requestUrl) =>
                                        authRuntime.resourceServer.resolveSessionBinding(
                                            authContext,
                                            `${requestUrl.origin}${requestUrl.pathname}`,
                                            authConfig,
                                            authRuntime.secrets,
                                        ),
                                });
                                return;
                            }
                            recordMcpHttpTransportMode('stateless-fallback');
                            recordMcpCompatibilityObservation(compatibilityAudit, {
                                kind: 'protocol-request',
                                protocolEra: '2025',
                                transportMode: 'stateless-fallback',
                                rpcClass: classifyMcpCompatibilityRpcClass(rpcMethod),
                                continuity: classifyMcpCompatibilityContinuity({
                                    httpMethod: req.method,
                                    rpcMethod,
                                    lastEventIdPresent: Boolean(readHeader(req, 'last-event-id')),
                                }),
                            });
                            if (sessionPolicy.requested || sessionPolicy.statelessCompat) {
                                logMcp('WARN', 'MCP HTTP compatibility fallback request handled.', {
                                    sessionPolicyReason: sessionPolicy.reason,
                                    statefulRequested: sessionPolicy.requested,
                                    statelessCompat: sessionPolicy.statelessCompat,
                                });
                            }
                            const { handleMcpStatelessCompatibilityRequest } =
                                await import('#copilot/mcp/public/transport/http/compat/stateless');
                            await handleMcpStatelessCompatibilityRequest({
                                req,
                                res,
                                ...(parsedMcpBody === undefined ? {} : { parsedMcpBody }),
                                createServer: () =>
                                    createConfiguredServer({
                                        authContext: buildAuthContext(req, url),
                                        ...(options.workspace ? { workspace: options.workspace } : {}),
                                    }),
                            });
                        } catch (error) {
                            logMcp('ERROR', 'Error handling MCP HTTP request.', {
                                error: error instanceof Error ? error.message : String(error),
                            });
                            if (!res.headersSent) {
                                writeText(res, 500, 'Internal server error');
                            }
                        }
                        return;
                    }

                    const allowedMethods = KNOWN_ROUTE_METHODS[url.pathname];
                    if (allowedMethods && req.method && !allowedMethods.includes(req.method)) {
                        writeMethodNotAllowed(res, allowedMethods);
                        return;
                    }

                    writeText(res, 404, 'Not Found');
                } catch (error) {
                    logMcp('ERROR', 'Unhandled MCP HTTP adapter error.', {
                        error: error instanceof Error ? error.message : String(error),
                    });
                    if (!res.headersSent) {
                        writeText(res, 400, 'Bad Request');
                    } else {
                        safeEnd(res);
                    }
                }
            },
        );
    };

    return Object.assign(requestHandler, {
        close: async () => {
            anonymousRateLimiter.reset();
            const reset = await sessionRuntime.reset();
            await modernMcpHandler.close();
            if (reset.closeFailed > 0) {
                throw new Error(`MCP HTTP session runtime teardown left ${reset.closeFailed} failed closure(s).`);
            }
        },
        readSessionRuntimeState: () => readMcpHttpSessionRuntimeState(sessionRuntime, statefulConfig),
    });
}
