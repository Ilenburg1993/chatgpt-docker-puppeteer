// @ts-check
/**
 * src/copilot/server/routes/sdk/session-crud.js
 *
 * @module copilot/server/routes/sdk/session-crud
 * @see EventBus
 */

import { toError } from '#copilot/core';
import { Router } from 'express';
import { resolveSdkRouteSharedDeps } from './deps.js';
import { rateLimitMiddleware, validateBody, validateModel, withErrorHandler } from './session-middleware.js';
import { CreateSessionBodySchema, ResumeSessionBodySchema } from './session-schemas.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {import('#copilot/sdk/types').SessionListFilter} SessionListFilter
 *
 * @typedef {ReturnType<import('./deps.js').buildDefaultSdkRouteSharedDeps>} SdkRouteDeps
 */

const router = Router();

/**
 * Lista sessões ativas do registry em memória com metadados derivados.
 *
 * @param {SdkRouteDeps} routeDeps
 * @returns {{ sessionId: string; model: string; createdAt: number; messagesCount: number; activeMs: number }[]}
 */
function listActiveSessions(routeDeps) {
    return routeDeps.sdkSession.listActiveClientSessions().map(({ sessionId, model, createdAt, messagesCount }) =>
        routeDeps.sdkSessionOwnership.attachSdkSessionOwnership(
            {
                sessionId,
                model,
                createdAt,
                messagesCount,
                activeMs: Date.now() - createdAt,
            },
            sessionId,
        ),
    );
}

/**
 * Anexa metadata canônica de runtime às respostas do adapter SDK.
 *
 * @template {Record<string, unknown>} T
 * @param {SdkRouteDeps} routeDeps
 * @param {T} payload
 * @returns {T & {
 *     runtimeId?: string;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 * }}
 */
function withRuntimeMeta(routeDeps, payload) {
    return {
        ...payload,
        ...routeDeps.sdkRuntimeProjection.buildRuntimeRouteMetaPayload(routeDeps),
    };
}

/**
 * Valida e normaliza `provider` usando o boundary canônico do SDK.
 *
 * @param {SdkRouteDeps} routeDeps
 * @param {unknown} provider
 * @param {Res} res
 * @returns {import('#copilot/sdk/types').ProviderConfig | undefined}
 */
function normalizeRouteProvider(routeDeps, provider, res) {
    if (provider === undefined) return undefined;
    try {
        return routeDeps.sdkSession.validateProviderConfig(
            /** @type {import('#copilot/sdk/types').ProviderConfig} */ (/** @type {unknown} */ (provider)),
        );
    } catch (error) {
        res.status(400).json(withRuntimeMeta(routeDeps, { ok: false, error: toProviderValidationMessage(error) }));
        return undefined;
    }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function toProviderValidationMessage(error) {
    return toError(error).message;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/active  +  GET /sessions/last
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista sessões ativas no registry em memória (sessões com conexão aberta neste processo).
 */
router.get('/sessions/active', (_req, res) => {
    const routeDeps = resolveSdkRouteSharedDeps(/** @type {Req} */ (_req));
    const active = listActiveSessions(routeDeps);
    res.json(withRuntimeMeta(routeDeps, { ok: true, count: active.length, sessions: active }));
});

/**
 * Retorna o ID da última sessão criada ou modificada (via CopilotClient.getLastSessionId).
 */
router.get('/sessions/last', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const meta = await routeDeps.sdkSessionOwnership.resolveSdkSessionRouteMeta({
            getForegroundSessionId: routeDeps.sdkSession.getForegroundClientSessionId,
            getLastSessionId: routeDeps.sdkSession.getLastClientSessionId,
        });
        res.json({
            ok: true,
            ...routeDeps.sdkRuntimeProjection.buildRuntimeRouteMetaPayload(routeDeps),
            lastSessionId: meta.lastSessionId,
            canonicalSessionId: meta.canonicalSessionId,
            sharedBinding: meta.sharedBinding,
        });
    });
});

/**
 * Retorna o binding canônico entre a sessão SDK ativa e a sessão conversacional.
 */
router.get('/sessions/binding', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const meta = await routeDeps.sdkSessionOwnership.resolveSdkSessionRouteMeta({
            getForegroundSessionId: routeDeps.sdkSession.getForegroundClientSessionId,
            getLastSessionId: routeDeps.sdkSession.getLastClientSessionId,
        });
        res.json(withRuntimeMeta(routeDeps, { ok: true, ...meta }));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/foreground  +  PUT /sessions/foreground/:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna o sessionId da sessão atualmente em foreground no CopilotClient.
 */
router.get('/sessions/foreground', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const meta = await routeDeps.sdkSessionOwnership.resolveSdkSessionRouteMeta({
            getForegroundSessionId: routeDeps.sdkSession.getForegroundClientSessionId,
            getLastSessionId: routeDeps.sdkSession.getLastClientSessionId,
        });
        res.json({
            ok: true,
            ...routeDeps.sdkRuntimeProjection.buildRuntimeRouteMetaPayload(routeDeps),
            foregroundSessionId: meta.foregroundSessionId,
            canonicalSessionId: meta.canonicalSessionId,
            sharedBinding: meta.sharedBinding,
        });
    });
});

/**
 * Define qual sessão está em foreground no CopilotClient (a sessão que o CLI prioriza).
 */
router.put('/sessions/foreground/:id', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const { id } = req.params;
        await routeDeps.sdkSession.setForegroundClientSessionId(id);
        routeDeps.sdkSessionOwnership.rememberSdkSessionOwnership(id);
        res.json(
            withRuntimeMeta(
                routeDeps,
                routeDeps.sdkSessionOwnership.attachSdkSessionOwnership({ ok: true, foregroundSessionId: id }, id),
            ),
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista todas as sessões disponíveis no disco (via CopilotClient.listSessions).
 *
 * @example
 *     // GET /api/sdk/sessions?repository=owner/repo&branch=main
 */
router.get('/sessions', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        /** @type {SessionListFilter} */
        const filter = {};
        if (req.query['repository']) filter.repository = String(req.query['repository']);
        if (req.query['branch']) filter.branch = String(req.query['branch']);
        if (req.query['cwd']) filter.cwd = String(req.query['cwd']);

        const sessions = await routeDeps.sdkSession.listAllClientSessions(
            Object.keys(filter).length ? filter : undefined,
        );
        const active = new Set(listActiveSessions(routeDeps).map((s) => s.sessionId));

        const enriched = sessions.map((s) => ({
            ...routeDeps.sdkSessionOwnership.attachSdkSessionOwnership(s, s.sessionId),
            isActive: active.has(s.sessionId),
        }));
        res.json(withRuntimeMeta(routeDeps, { ok: true, count: enriched.length, sessions: enriched }));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria uma nova sessão SDK.
 *
 * Body:
 *
 * ```json
 * {
 *     "model": "claude-sonnet-4-5", // opcional, exceto quando provider custom exige modelo
 *     "sessionId": "my-id", // opcional — ID customizado
 *     "configDir": "/tmp/copilot-config", // opcional
 *     "systemMessage": { "content": "..." }, // opcional
 *     "infiniteSessions": { "enabled": true }, // opcional (padrão: habilitado)
 *     "workingDirectory": "/caminho/do/projeto", // opcional
 *     "streaming": true, // opcional — emite message_delta via SSE
 *     "reasoningEffort": "high", // opcional — "low" | "medium" | "high" | "xhigh"
 *     "availableTools": ["read_file"], // opcional — whitelist de tools
 *     "excludedTools": ["run_in_terminal"], // opcional — blacklist de tools
 *     "mcpServers": {}, // opcional — MCP servers locais/remotos do SDK
 *     "customAgents": [], // opcional — agentes customizados
 *     "agent": "reviewer", // opcional — custom agent inicial
 *     "skillDirectories": [".github/skills"], // opcional
 *     "disabledSkills": ["legacy-skill"], // opcional
 *     "clientName": "my-app", // opcional — identificador no User-Agent
 *     "provider": { "type": "openai", "baseUrl": "..." } // opcional — BYOK
 * }
 * ```
 */
router.post(
    '/sessions',
    rateLimitMiddleware(10, 'create_session'),
    validateBody(CreateSessionBodySchema),
    (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const {
                model,
                sessionId,
                systemMessage,
                infiniteSessions,
                workingDirectory,
                streaming,
                provider,
                reasoningEffort,
                configDir,
                availableTools,
                excludedTools,
                mcpServers,
                customAgents,
                agent,
                skillDirectories,
                disabledSkills,
                clientName,
            } = req.body ?? {};

            /** @type {string | undefined} */
            let safeModel;
            if (model !== undefined) {
                const modelResult = validateModel(model);
                if (!modelResult.ok) {
                    res.status(400).json(withRuntimeMeta(routeDeps, { ok: false, error: modelResult.error }));
                    return;
                }
                safeModel = modelResult.model;
            }
            const safeProvider = normalizeRouteProvider(routeDeps, provider, res);
            if (provider !== undefined && safeProvider === undefined) {
                return;
            }
            if (safeProvider !== undefined && safeModel === undefined) {
                res.status(400).json(
                    withRuntimeMeta(routeDeps, {
                        ok: false,
                        error: 'Campo "model" é obrigatório quando "provider" customizado é informado.',
                    }),
                );
                return;
            }

            /** @type {Partial<import('#copilot/sdk/types').SessionConfig>} */
            const sessionOptions = routeDeps.sdkSession.pickDefined({
                sessionId,
                clientName,
                reasoningEffort,
                configDir,
                systemMessage,
                availableTools,
                excludedTools,
                workingDirectory,
                streaming,
                mcpServers,
                customAgents,
                agent,
                skillDirectories,
                disabledSkills,
                infiniteSessions,
            });
            if (safeProvider !== undefined) sessionOptions.provider = safeProvider;
            if (safeModel !== undefined) sessionOptions.model = safeModel;

            const session = await routeDeps.sdkSession.createClientSession(
                /** @type {import('#copilot/sdk/types').SessionConfig} */ ({
                    onPermissionRequest: routeDeps.sdkSession.approveAll,
                    ...sessionOptions,
                }),
            );

            routeDeps.sdkSessionOwnership.rememberSdkSessionOwnership(session.sessionId);

            res.status(201).json(
                withRuntimeMeta(
                    routeDeps,
                    routeDeps.sdkSessionOwnership.attachSdkSessionOwnership(
                        {
                            ok: true,
                            sessionId: session.sessionId,
                            model: safeModel ?? null,
                            workspacePath: session.workspacePath ?? null,
                        },
                        session.sessionId,
                    ),
                ),
            );
        });
    },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detalhes de uma sessão específica (combina metadata do disco + estado do registry).
 */
router.get('/sessions/:id', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const { id } = req.params;

        // Busca todas as sessões no disco e filtra pela ID solicitada
        const all = await routeDeps.sdkSession.listAllClientSessions();
        const meta = all.find((s) => s.sessionId === id);

        const entry = routeDeps.sdkSession.getClientSession(id);

        if (!meta && !entry) {
            res.status(404).json(withRuntimeMeta(routeDeps, { ok: false, error: `Sessão "${id}" não encontrada.` }));
            return;
        }

        res.json(
            withRuntimeMeta(
                routeDeps,
                routeDeps.sdkSessionOwnership.attachSdkSessionOwnership(
                    {
                        ok: true,
                        sessionId: id,
                        isActive: Boolean(entry),
                        model: entry?.model ?? null,
                        messagesCount: entry?.messagesCount ?? 0,
                        activeMs: entry ? Date.now() - entry.createdAt : null,
                        workspacePath: entry?.session.workspacePath ?? null,
                        metadata: meta ?? null,
                    },
                    id,
                ),
            ),
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /sessions/:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SEC-ROUTE-001: Middleware interno para proteger endpoints destrutivos. Exige BRIDGE_ADMIN_TOKEN se configurado
 * (defesa em profundidade sobre SDK_API_TOKEN).
 *
 * @type {import('express').RequestHandler}
 */
function _requireAdminForDestructive(req, res, next) {
    const routeDeps = resolveSdkRouteSharedDeps(req);
    const adminToken = routeDeps.bridgeAdminToken;
    if (!adminToken) return next(); // token não configurado — comportamento legado (dev)
    const authHeader = req.headers['x-admin-token'] ?? req.headers['authorization'] ?? '';
    const provided = String(authHeader).replace(/^Bearer\s+/i, '');
    if (provided !== adminToken) {
        res.status(403).json(
            withRuntimeMeta(routeDeps, { ok: false, error: 'Forbidden: token admin inválido ou ausente.' }),
        );
        return;
    }
    return next();
}

/**
 * Deleta permanentemente uma sessão do disco (irreversível). Se a sessão estiver ativa no registry, desconecta antes de
 * deletar.
 */
router.delete('/sessions/:id', _requireAdminForDestructive, (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);

        // SEC-N10 (fix): exigir confirmação explícita para operação irreversível
        const confirmHeader = req.headers['x-confirm-delete'];
        if (confirmHeader !== 'true') {
            res.status(400).json(
                withRuntimeMeta(routeDeps, {
                    ok: false,
                    error: 'Operação irreversível. Adicione o header "X-Confirm-Delete: true" para confirmar.',
                }),
            );
            return;
        }

        // Desconectar do registry se ativo
        await routeDeps.sdkSession.disconnectClientSession(id);
        const sharedBinding = routeDeps.sdkSessionOwnership.forgetSdkSessionOwnership(id);

        const client = await routeDeps.sdkSession.getClient();
        await client.deleteSession(id);
        routeDeps.sdkObservability.log('INFO', `[sdk-api] Sessão deletada: ${id}`);
        res.json(
            withRuntimeMeta(routeDeps, {
                ok: true,
                message: `Sessão "${id}" deletada permanentemente.`,
                sharedBinding,
            }),
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/disconnect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Desconecta uma sessão ativa sem deletá-la do disco.
 */
router.post('/sessions/:id/disconnect', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const { id } = req.params;

        const entry = routeDeps.sdkSession.getClientSession(id);
        if (!entry) {
            res.status(404).json(
                withRuntimeMeta(routeDeps, {
                    ok: false,
                    error: `Sessão "${id}" não está ativa no registry.`,
                }),
            );
            return;
        }

        await routeDeps.sdkSession.disconnectClientSession(id);
        const sharedBinding = routeDeps.sdkSessionOwnership.forgetSdkSessionOwnership(id);
        routeDeps.sdkObservability.log('INFO', `[sdk-api] Sessão desconectada (preservada em disco): ${id}`);
        res.json(
            withRuntimeMeta(routeDeps, {
                ok: true,
                message: `Sessão "${id}" desconectada. Use POST /sessions/${id}/resume para retomar.`,
                sharedBinding,
            }),
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/resume
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retoma uma sessão existente (conecta ao histórico preservado no disco).
 *
 * Body:
 *
 * ```json
 * {
 *     "model": "gpt-4.1", // opcional — modelo para retomada
 *     "reasoningEffort": "high", // opcional
 *     "streaming": true, // opcional
 *     "availableTools": ["read_file"], // opcional
 *     "excludedTools": ["run_in_terminal"], // opcional
 *     "provider": { "type": "openai", "baseUrl": "..." }, // opcional
 *     "mcpServers": {}, // opcional
 *     "customAgents": [], // opcional
 *     "agent": "reviewer", // opcional
 *     "skillDirectories": [".github/skills"], // opcional
 *     "disabledSkills": ["legacy-skill"], // opcional
 *     "disableResume": true // opcional — reconexão silenciosa
 * }
 * ```
 */
router.post('/sessions/:id/resume', validateBody(ResumeSessionBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const {
            clientName,
            model,
            reasoningEffort,
            configDir,
            systemMessage,
            availableTools,
            excludedTools,
            provider,
            workingDirectory,
            streaming,
            mcpServers,
            customAgents,
            agent,
            skillDirectories,
            disabledSkills,
            infiniteSessions,
            disableResume,
        } = req.body ?? {};

        /** @type {string | undefined} */
        let safeModel;
        if (model !== undefined) {
            const modelResult = validateModel(model);
            if (!modelResult.ok) {
                res.status(400).json(withRuntimeMeta(routeDeps, { ok: false, error: modelResult.error }));
                return;
            }
            safeModel = modelResult.model;
        }
        const safeProvider = normalizeRouteProvider(routeDeps, provider, res);
        if (provider !== undefined && safeProvider === undefined) {
            return;
        }
        if (safeProvider !== undefined && safeModel === undefined) {
            res.status(400).json(
                withRuntimeMeta(routeDeps, {
                    ok: false,
                    error: 'Campo "model" é obrigatório quando "provider" customizado é informado.',
                }),
            );
            return;
        }

        /** @type {Partial<import('#copilot/sdk/types').ResumeSessionConfig>} */
        const resumeOptions = routeDeps.sdkSession.pickDefined({
            clientName,
            reasoningEffort,
            configDir,
            systemMessage,
            availableTools,
            excludedTools,
            workingDirectory,
            streaming,
            mcpServers,
            customAgents,
            agent,
            skillDirectories,
            disabledSkills,
            infiniteSessions,
            disableResume,
        });
        if (safeProvider !== undefined) resumeOptions.provider = safeProvider;
        if (safeModel !== undefined) resumeOptions.model = safeModel;

        const session = await routeDeps.sdkSession.resumeClientSession(
            id,
            /** @type {import('#copilot/sdk/types').ResumeSessionConfig} */ ({
                onPermissionRequest: routeDeps.sdkSession.approveAll,
                ...resumeOptions,
            }),
        );
        routeDeps.sdkSessionOwnership.rememberSdkSessionOwnership(session.sessionId);
        res.json(
            withRuntimeMeta(
                routeDeps,
                routeDeps.sdkSessionOwnership.attachSdkSessionOwnership(
                    {
                        ok: true,
                        sessionId: session.sessionId,
                        workspacePath: session.workspacePath ?? null,
                    },
                    session.sessionId,
                ),
            ),
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/:id/compaction-history
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna o histórico de compaction (start/complete) para uma sessão.
 */
router.get('/sessions/:id/compaction-history', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const { id } = req.params;
        const history = routeDeps.sdkObservability.getCompactionHistory(String(id));
        res.json(withRuntimeMeta(routeDeps, { ok: true, sessionId: id, entries: history, count: history.length }));
    });
});

export default router;
