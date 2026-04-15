// @ts-check
/**
 * src/copilot/api/express/session-crud.js
 *
 * @module copilot/api/express/session-crud
 * @see EventBus
 */

import { BRIDGE_ADMIN_TOKEN as _BRIDGE_ADMIN_TOKEN } from '#copilot/config';
import { getCompactionHistory, log } from '#copilot/observability';
import { Router } from 'express';
import { approveAll, createSessionService, pickDefined } from '../../../services/session-service.js';
import {
    CreateSessionBodySchema,
    rateLimitMiddleware,
    ResumeSessionBodySchema,
    validateBody,
    validateModel,
    withErrorHandler,
} from './session-middleware.js';

const sessionService = createSessionService();

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {import('#copilot/sdk/types').SessionListFilter} SessionListFilter
 */

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/active  +  GET /sessions/last
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista sessões ativas no registry em memória (sessões com conexão aberta neste processo).
 */
router.get('/sessions/active', (_req, res) => {
    const active = sessionService.listActive();
    res.json({ ok: true, count: active.length, sessions: active });
});

/**
 * Retorna o ID da última sessão criada ou modificada (via CopilotClient.getLastSessionId).
 */
router.get('/sessions/last', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const sessionId = await sessionService.getLastSessionId();
        res.json({ ok: true, lastSessionId: sessionId ?? null });
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
        const sessionId = await sessionService.getForegroundSessionId();
        res.json({ ok: true, foregroundSessionId: sessionId ?? null });
    });
});

/**
 * Define qual sessão está em foreground no CopilotClient (a sessão que o CLI prioriza).
 */
router.put('/sessions/foreground/:id', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { id } = req.params;
        await sessionService.setForegroundSessionId(id);
        res.json({ ok: true, foregroundSessionId: id });
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
        /** @type {SessionListFilter} */
        const filter = {};
        if (req.query['repository']) filter.repository = String(req.query['repository']);
        if (req.query['branch']) filter.branch = String(req.query['branch']);
        if (req.query['cwd']) filter.cwd = String(req.query['cwd']);

        const sessions = await sessionService.listSessions(Object.keys(filter).length ? filter : undefined);
        const active = new Set(sessionService.listActive().map((s) => s.sessionId));

        const enriched = sessions.map((s) => ({
            ...s,
            isActive: active.has(s.sessionId),
        }));
        res.json({ ok: true, count: enriched.length, sessions: enriched });
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
 *     "model": "claude-sonnet-4-5", // OBRIGATÓRIO — nome do modelo
 *     "sessionId": "my-id", // opcional — ID customizado
 *     "systemMessage": { "content": "..." }, // opcional
 *     "infiniteSessions": { "enabled": true }, // opcional (padrão: habilitado)
 *     "workingDirectory": "/caminho/do/projeto", // opcional
 *     "streaming": true, // opcional — emite message_delta via SSE
 *     "reasoningEffort": "high", // opcional — "low" | "medium" | "high" | "xhigh"
 *     "availableTools": ["read_file"], // opcional — whitelist de tools
 *     "excludedTools": ["run_in_terminal"], // opcional — blacklist de tools
 *     "customAgents": [], // opcional — agentes customizados
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
            const {
                model,
                sessionId,
                systemMessage,
                infiniteSessions,
                workingDirectory,
                streaming,
                provider,
                reasoningEffort,
                availableTools,
                excludedTools,
                customAgents,
                clientName,
            } = req.body ?? {};

            const modelResult = validateModel(model);
            if (!modelResult.ok) {
                res.status(400).json({ ok: false, error: modelResult.error });
                return;
            }
            const safeModel = modelResult.model;

            const session = await sessionService.createSession({
                onPermissionRequest: approveAll,
                model: safeModel,
                ...pickDefined({
                    sessionId,
                    systemMessage,
                    infiniteSessions,
                    workingDirectory,
                    streaming,
                    provider,
                    reasoningEffort,
                    availableTools,
                    excludedTools,
                    customAgents,
                    clientName,
                }),
            });

            res.status(201).json({
                ok: true,
                sessionId: session.sessionId,
                model: safeModel,
                workspacePath: session.workspacePath ?? null,
            });
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
        const { id } = req.params;

        // Busca todas as sessões no disco e filtra pela ID solicitada
        const all = await sessionService.listSessions();
        const meta = all.find((s) => s.sessionId === id);

        const entry = sessionService.getSession(id);

        if (!meta && !entry) {
            res.status(404).json({ ok: false, error: `Sessão "${id}" não encontrada.` });
            return;
        }

        res.json({
            ok: true,
            sessionId: id,
            isActive: Boolean(entry),
            model: entry?.model ?? null,
            messagesCount: entry?.messagesCount ?? 0,
            activeMs: entry ? Date.now() - entry.createdAt : null,
            workspacePath: entry?.session.workspacePath ?? null,
            metadata: meta ?? null,
        });
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
    const adminToken = _BRIDGE_ADMIN_TOKEN;
    if (!adminToken) return next(); // token não configurado — comportamento legado (dev)
    const authHeader = req.headers['x-admin-token'] ?? req.headers['authorization'] ?? '';
    const provided = String(authHeader).replace(/^Bearer\s+/i, '');
    if (provided !== adminToken) {
        res.status(403).json({ ok: false, error: 'Forbidden: token admin inválido ou ausente.' });
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
        const id = /** @type {string} */ (req.params['id']);

        // SEC-N10 (fix): exigir confirmação explícita para operação irreversível
        const confirmHeader = req.headers['x-confirm-delete'];
        if (confirmHeader !== 'true') {
            res.status(400).json({
                ok: false,
                error: 'Operação irreversível. Adicione o header "X-Confirm-Delete: true" para confirmar.',
            });
            return;
        }

        // Desconectar do registry se ativo
        await sessionService.disconnectSession(id);

        const client = await sessionService.getClient();
        await client.deleteSession(id);
        log('INFO', `[sdk-api] Sessão deletada: ${id}`);
        res.json({ ok: true, message: `Sessão "${id}" deletada permanentemente.` });
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
        const { id } = req.params;

        const entry = sessionService.getSession(id);
        if (!entry) {
            res.status(404).json({
                ok: false,
                error: `Sessão "${id}" não está ativa no registry.`,
            });
            return;
        }

        await sessionService.disconnectSession(id);
        log('INFO', `[sdk-api] Sessão desconectada (preservada em disco): ${id}`);
        res.json({ ok: true, message: `Sessão "${id}" desconectada. Use POST /sessions/${id}/resume para retomar.` });
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
 *     "model": "gpt-4.1" // opcional — modelo para retomada
 * }
 * ```
 */
router.post('/sessions/:id/resume', validateBody(ResumeSessionBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const id = /** @type {string} */ (req.params.id);
        const { model } = req.body ?? {};

        const session = await sessionService.resumeSession(
            id,
            model ? { onPermissionRequest: approveAll, model } : { onPermissionRequest: approveAll },
        );
        res.json({
            ok: true,
            sessionId: session.sessionId,
            workspacePath: session.workspacePath ?? null,
        });
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
        const { id } = req.params;
        const history = getCompactionHistory(String(id));
        res.json({ ok: true, sessionId: id, entries: history, count: history.length });
    });
});

export default router;
