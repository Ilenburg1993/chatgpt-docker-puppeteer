// @ts-check
/**
 * src/copilot/terminal/http-handlers.js
 *
 * Handlers de lógica pura para os endpoints do Terminal LLM-B.
 *
 * Cada handler recebe parâmetros tipados e retorna `{ status, body }` (ou `null` para endpoints de streaming SSE, que
 * exigem acesso direto ao `res`). Isso permite reutilização por:
 *
 * - `terminal/server.js` — servidor HTTP raw (porta 3009, node:http)
 * - Express router em `api/http-bridge.js` — fachada REST unificada
 *
 * Padrão: **Command Pattern** — cada função encapsula uma intenção de domínio.
 *
 * @module copilot/terminal/http-handlers
 */

import {
    BUILTIN_HANDLER_MAP,
    getCustomToolDefinitions,
    registerCustomTool,
    removeCustomTool,
} from '#copilot/config/tools/registry';
import { getToolsConfig, patchToolsConfig } from '#copilot/config/tools/state';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { alwaysAliveAgent } from '../agent/always-alive.js';
import { setBackgroundCompactionThreshold } from '../agent/session-manager.js';
import { listIssues, listPrs, listRuns } from '../bridges/gh-bridge.js';
import { gitLog, gitStatus } from '../bridges/git-bridge.js';
import { conversationHub } from '../conversation-hub/hub.js';
import { conversationStore } from '../conversation-hub/store.js';
import { sendTurn } from './dialog.js';
import {
    attachmentToEmbed,
    embedMultiple,
    getFileCacheStats,
    MAX_EMBED_BYTES,
    readFileContext,
} from './file-context.js';
import { getBusy, getHubSessionId, getPlanMode, getSseClients, getSseCriticalClients } from './state.js';

// ─── Tipos auxiliares ─────────────────────────────────────────────────────────

/**
 * Resultado padrão de um handler HTTP.
 *
 * @typedef {{ status: number; body: unknown; cors?: boolean }} HandlerResult
 */

/**
 * Valores válidos para o campo `from` nos endpoints /inject e /pipeline. SEC-N03: aceitar apenas remetentes conhecidos
 * para evitar injeção de contexto.
 *
 * @type {ReadonlySet<string>}
 */
const ALLOWED_FROM = new Set(['llm-a', 'user', 'system', 'llm_a']);

// ─── GET /health ──────────────────────────────────────────────────────────────

/**
 * Retorna o status atual do agente e do dialog loop.
 *
 * @returns {HandlerResult}
 */
export function handleHealth() {
    const snapshot = alwaysAliveAgent.getStatusSnapshot();
    // UPG-N22/GAP-N06 (fix): incluir status do ConversationHub no /health
    let hubInfo = { initialized: false, activeSessions: 0 };
    if (conversationHub.isReady) {
        try {
            const activeSessions = conversationStore.listHubSessions({ status: 'active' });
            hubInfo = { initialized: true, activeSessions: activeSessions.length };
        } catch {
            hubInfo = { initialized: true, activeSessions: -1 };
        }
    }
    return {
        status: 200,
        body: {
            ok: true,
            dialogLoopActive: alwaysAliveAgent.dialogLoopActive,
            agentStatus: alwaysAliveAgent.status,
            busy: getBusy(),
            hubSessionId: getHubSessionId(),
            sseClients: getSseClients().size,
            model: alwaysAliveAgent.model,
            reasoningEffort: alwaysAliveAgent.reasoningEffort ?? 'high',
            // AA.5: dados reais de uso de contexto
            contextWindow: snapshot.contextWindow,
            // AB.3: estatísticas de cache
            cacheStats: { fileContext: getFileCacheStats() },
            // UPG-N22: status do ConversationHub
            hub: hubInfo,
        },
    };
}

// ─── GET /sessions ────────────────────────────────────────────────────────────

// ─── GET /context ─────────────────────────────────────────────────────────────

/**
 * UPG-04: Endpoint dedicado para monitoramento de uso de contexto.
 *
 * @returns {HandlerResult}
 */
export function handleGetContext() {
    const snapshot = alwaysAliveAgent.getStatusSnapshot();
    const cw = snapshot.contextWindow;
    if (!cw) {
        return {
            status: 200,
            cors: true,
            body: {
                ok: true,
                tokens: 0,
                tokenLimit: 0,
                utilization: 0,
                utilizationPercent: 0,
                lastCheckpointPath: null,
                warning: 'none',
            },
        };
    }
    const utilization = cw.utilization;
    /** @type {'none' | 'moderate' | 'high' | 'critical'} */
    let warning = 'none';
    if (utilization >= 0.95) warning = 'critical';
    else if (utilization >= 0.8) warning = 'high';
    else if (utilization >= 0.6) warning = 'moderate';
    return {
        status: 200,
        cors: true,
        body: {
            ok: true,
            tokens: cw.tokens,
            tokenLimit: cw.tokenLimit,
            utilization,
            utilizationPercent: Math.round(utilization * 100),
            lastCheckpointPath: null,
            warning,
        },
    };
}

// ─── GET /sessions ────────────────────────────────────────────────────────────

/**
 * Lista hub_sessions persistidas.
 *
 * @param {{ limit?: number; offset?: number; status?: string }} params
 * @returns {HandlerResult}
 */
export function handleListSessions({ limit = 20, offset = 0, status } = {}) {
    try {
        const sessions = conversationStore.listHubSessions({
            limit: isNaN(limit) ? 20 : limit,
            offset: isNaN(offset) ? 0 : offset,
            status: /** @type {any} */ (status),
        });
        return { status: 200, cors: true, body: { ok: true, sessions, current: getHubSessionId() } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /sessions/:id/turns ──────────────────────────────────────────────────

/**
 * Retorna os turnos de uma sessão específica.
 *
 * @param {{ sessionId: string; limit?: number; offset?: number }} params
 * @returns {HandlerResult}
 */
export function handleListTurns({ sessionId, limit = 50, offset = 0 }) {
    try {
        const turns = conversationStore.readTurns(sessionId, {
            limit: isNaN(limit) ? 50 : limit,
            offset: isNaN(offset) ? 0 : offset,
        });
        return { status: 200, cors: true, body: { ok: true, turns, sessionId } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── POST /memory ─────────────────────────────────────────────────────────────

/**
 * Armazena uma memória semântica.
 *
 * @param {{ content?: string; tag?: string }} body
 * @returns {HandlerResult}
 */
export function handleStoreMemory(body) {
    if (!body?.content) {
        return { status: 400, body: { ok: false, error: '"content" obrigatório' } };
    }
    try {
        const _hubSessionId = getHubSessionId();
        const id = conversationStore.storeMemory({
            content: body.content,
            tag: body.tag ?? 'geral',
            ...(_hubSessionId ? { hubSessionId: _hubSessionId } : {}),
        });
        return { status: 201, body: { ok: true, id } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /memory ──────────────────────────────────────────────────────────────

/**
 * Recupera memórias semânticas.
 *
 * @param {{ tag?: string | null; search?: string | null; limit?: number }} params
 * @returns {HandlerResult}
 */
export function handleRecallMemories({ tag, search, limit = 20 } = {}) {
    try {
        const memories = conversationStore.recallMemories({
            ...(tag ? { tag } : {}),
            ...(search ? { search } : {}),
            limit: isNaN(/** @type {number} */ (limit)) ? 20 : /** @type {number} */ (limit),
        });
        return { status: 200, cors: true, body: { ok: true, memories } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── DELETE /memory/:id ───────────────────────────────────────────────────────

/**
 * Remove uma memória semântica.
 *
 * @param {{ memoryId: string }} params
 * @returns {HandlerResult}
 */
export function handleDeleteMemory({ memoryId }) {
    try {
        const deleted = conversationStore.deleteMemory(memoryId);
        return { status: deleted ? 200 : 404, cors: true, body: { ok: deleted, id: memoryId } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── POST /pipeline ───────────────────────────────────────────────────────────

/**
 * Executa uma sequência ordenada de turnos (pipeline).
 *
 * @param {{ steps?: { prompt: string; waitMs?: number; from?: string }[]; from?: string } | null} body
 * @returns {Promise<HandlerResult>}
 */
export async function handlePipeline(body) {
    if (!Array.isArray(body?.steps) || body.steps.length === 0) {
        return { status: 400, body: { ok: false, error: '"steps" deve ser um array não vazio' } };
    }

    // GAP-N02 (fix): limitar número de steps para evitar fila de turnos massiva
    const MAX_PIPELINE_STEPS = 20;
    if (body.steps.length > MAX_PIPELINE_STEPS) {
        return {
            status: 400,
            body: {
                ok: false,
                error: `Máximo ${MAX_PIPELINE_STEPS} steps por pipeline (recebido: ${body.steps.length})`,
            },
        };
    }

    // SEC-N03 (fix): validar campo `from` global do pipeline
    const rawGlobalFrom = body.from ?? 'llm-a';
    const globalFrom = typeof rawGlobalFrom === 'string' && ALLOWED_FROM.has(rawGlobalFrom) ? rawGlobalFrom : 'llm-a';
    /** @type {{ step: number; prompt: string; reply: string | null; durationMs: number }[]} */
    const results = [];

    for (let i = 0; i < body.steps.length; i++) {
        const step = body.steps[i];
        if (!step?.prompt) continue;
        const rawStepFrom = step.from ?? globalFrom;
        const from = ALLOWED_FROM.has(rawStepFrom) ? rawStepFrom : globalFrom;

        if (step.waitMs && step.waitMs > 0) {
            await new Promise((r) => setTimeout(r, step.waitMs));
        }

        const t0 = Date.now();
        const reply = await sendTurn(step.prompt, from).catch(() => null);
        results.push({ step: i + 1, prompt: step.prompt, reply: reply ?? null, durationMs: Date.now() - t0 });

        if (reply === null) {
            return {
                status: 409,
                body: {
                    ok: false,
                    error: `Step ${i + 1} retornou null (erro interno na LLM-B) — pipeline interrompido`,
                    results,
                },
            };
        }
    }

    return { status: 200, body: { ok: true, results } };
}

// ─── POST /inject ─────────────────────────────────────────────────────────────

/**
 * Injeta uma mensagem na LLM-B e aguarda resposta.
 *
 * Aceita opcionalmente:
 *
 * - `context_files: string[]` — lê o conteúdo de cada arquivo e o embute como bloco markdown antes da mensagem.
 * - `attachments` — **arquitetura zero-PR (ATT-04)**: todos os tipos são convertidos em texto embeddado no cliente
 *   Node.js e enviados via dialog loop (`ask_user`). Nenhum attachment cria nova PR via `session.send()`.
 *
 *   Tipos suportados:
 *
 *   - `{ type: 'file', path: string }` — lê o arquivo e embute o conteúdo como bloco markdown.
 *   - `{ type: 'directory', path: string }` — lista e embute os arquivos do diretório.
 *   - `{ type: 'selection', text: string, filePath?: string }` — embute o texto selecionado como bloco markdown.
 *   - `{ content: string, path?: string }` — embute o conteúdo inline como bloco markdown.
 *
 * @param {{
 *     message?: string;
 *     from?: string;
 *     timeout?: number;
 *     context_files?: string[];
 *     attachments?: {
 *         type?: string;
 *         content?: string;
 *         path?: string;
 *         displayName?: string;
 *         filePath?: string;
 *         selection?: object;
 *         text?: string;
 *     }[];
 * } | null} body
 * @returns {Promise<HandlerResult>}
 */
export async function handleInject(body) {
    const message = body?.message?.trim();
    if (!message) {
        return { status: 400, body: { ok: false, error: '"message" é obrigatório' } };
    }

    // SEC-N03 (fix): validar campo `from` — aceitar apenas valores conhecidos
    const rawFrom = body?.from ?? 'llm-a';
    const from = typeof rawFrom === 'string' && ALLOWED_FROM.has(rawFrom) ? rawFrom : 'llm-a';

    // Embed de context_files, se fornecidos
    let enrichedMessage = message;
    const contextFiles = Array.isArray(body?.context_files) ? body.context_files : [];
    if (contextFiles.length > 0) {
        try {
            const ctxs = await Promise.all(contextFiles.map(readFileContext));
            enrichedMessage = embedMultiple(ctxs, message);
        } catch (/** @type {any} */ embedErr) {
            return {
                status: 400,
                body: { ok: false, error: `Falha ao processar context_files: ${embedErr.message}` },
            };
        }
    }

    // ATT-04: todos os attachment types são convertidos em texto embeddado (zero-PR).
    // Nenhum attachment cria nova PR — tudo vai via dialog loop (ask_user).
    const rawAttachments = Array.isArray(body?.attachments) ? body.attachments : [];
    if (rawAttachments.length > 0) {
        const embedParts = await Promise.all(rawAttachments.map(attachmentToEmbed));
        const validParts = embedParts.filter(/** @type {(s: string | null) => s is string} */ (s) => s !== null);
        if (validParts.length > 0) {
            // GAP-Q10 fix: limitar total de bytes embeddados ao mesmo MAX_EMBED_BYTES
            let totalBytes = 0;
            const limitedParts = [];
            for (const part of validParts) {
                const partBytes = Buffer.byteLength(part, 'utf8');
                if (totalBytes + partBytes > MAX_EMBED_BYTES) break;
                limitedParts.push(part);
                totalBytes += partBytes;
            }
            if (limitedParts.length > 0) {
                enrichedMessage = limitedParts.join('\n\n') + '\n\n' + enrichedMessage;
            }
        }
    }

    const t0 = Date.now();
    try {
        // ATT-04: caminho único — dialog loop, zero nova PR
        const reply = await sendTurn(enrichedMessage, from);
        return {
            status: reply !== null ? 200 : 409,
            body: { ok: reply !== null, reply: reply ?? null, durationMs: Date.now() - t0, from },
        };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /gh/issues ───────────────────────────────────────────────────────────

/**
 * Lista GitHub issues via gh CLI.
 *
 * @param {{ state?: string; limit?: number; page?: number }} params
 * @returns {Promise<HandlerResult>}
 */
export async function handleGhIssues({ state = 'open', limit = 15, page = 1 } = {}) {
    try {
        const result = await listIssues({ state: /** @type {any} */ (state), perPage: limit, page });
        return {
            status: 200,
            cors: true,
            body: { ok: true, issues: result.items, hasMore: result.hasMore, page: result.page },
        };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /gh/prs ──────────────────────────────────────────────────────────────

/**
 * Lista GitHub pull requests via gh CLI.
 *
 * @param {{ state?: string; limit?: number; page?: number }} params
 * @returns {Promise<HandlerResult>}
 */
export async function handleGhPrs({ state = 'open', limit = 15, page = 1 } = {}) {
    try {
        const result = await listPrs({ state: /** @type {any} */ (state), perPage: limit, page });
        return {
            status: 200,
            cors: true,
            body: { ok: true, prs: result.items, hasMore: result.hasMore, page: result.page },
        };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /gh/ci ───────────────────────────────────────────────────────────────

/**
 * Lista GitHub CI runs via gh CLI.
 *
 * @param {{ limit?: number; page?: number }} params
 * @returns {Promise<HandlerResult>}
 */
export async function handleGhCi({ limit = 15, page = 1 } = {}) {
    try {
        const result = await listRuns({ perPage: limit, page });
        return {
            status: 200,
            cors: true,
            body: { ok: true, runs: result.items, hasMore: result.hasMore, page: result.page },
        };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /git/status ──────────────────────────────────────────────────────────

/**
 * Retorna o status do git.
 *
 * @returns {Promise<HandlerResult>}
 */
export async function handleGitStatus() {
    try {
        const entries = await gitStatus();
        return { status: 200, cors: true, body: { ok: true, entries } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /git/log ─────────────────────────────────────────────────────────────

/**
 * Retorna o log do git.
 *
 * @param {{ n?: number }} params
 * @returns {Promise<HandlerResult>}
 */
export async function handleGitLog({ n = 20 } = {}) {
    try {
        const entries = await gitLog({ n });
        return { status: 200, cors: true, body: { ok: true, entries } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── Utilitários SSE ──────────────────────────────────────────────────────────

/**
 * Obtém os conjuntos de clientes SSE (leitura apenas, sem lógica de registro). O registro/remoção de clientes permanece
 * em `server.js` pois requer `req`/`res`.
 *
 * @returns {{ all: Set<import('node:http').ServerResponse>; critical: Set<import('node:http').ServerResponse> }}
 */
export function getSseClientSets() {
    return { all: getSseClients(), critical: getSseCriticalClients() };
}

// ─── GET /config ──────────────────────────────────────────────────────────────

/**
 * Retorna configuração dinâmica atual da sessão LLM-B.
 *
 * @returns {HandlerResult}
 */
export function handleGetConfig() {
    const snapshot = alwaysAliveAgent.getStatusSnapshot();
    return {
        status: 200,
        cors: true,
        body: {
            ok: true,
            model: alwaysAliveAgent.model,
            reasoningEffort: alwaysAliveAgent.reasoningEffort ?? 'high',
            planMode: getPlanMode(),
            dialogLoopActive: alwaysAliveAgent.dialogLoopActive,
            busy: getBusy(),
            hubSessionId: getHubSessionId(),
            port: Number(process.env.LLM_B_TERMINAL_PORT ?? 3009),
            // AA.5: expor dados reais de uso de contexto
            contextWindow: snapshot.contextWindow,
            // AC.3: último checkpoint da compaction
            lastCheckpointPath: snapshot.lastCheckpointPath,
            // AC.1: threshold dinâmico de compaction
            infiniteSession: getInfiniteSessionConfig(),
        },
    };
}

// ─── InfiniteSession config dinâmico (AC.1) ───────────────────────────────────

/** @type {{ backgroundCompactionThreshold: number }} */
let _infiniteSessionConfig = { backgroundCompactionThreshold: 0.75 };

/**
 * Retorna a configuração atual de InfiniteSession.
 *
 * @returns {{ backgroundCompactionThreshold: number }}
 */
export function getInfiniteSessionConfig() {
    return { ..._infiniteSessionConfig };
}

/**
 * Atualiza o threshold de compaction dinâmico. Aplicado na próxima sessão criada/retomada.
 *
 * @param {{ backgroundCompactionThreshold?: number }} body - Parâmetros de configuração
 * @returns {HandlerResult}
 */
export function handleSetInfiniteSessionConfig(body) {
    const { backgroundCompactionThreshold } = body ?? {};
    if (backgroundCompactionThreshold !== undefined) {
        if (
            typeof backgroundCompactionThreshold !== 'number' ||
            backgroundCompactionThreshold < 0.1 ||
            backgroundCompactionThreshold > 1.0
        ) {
            return {
                status: 400,
                body: { ok: false, error: 'backgroundCompactionThreshold deve ser um número entre 0.1 e 1.0' },
            };
        }
        _infiniteSessionConfig = { ..._infiniteSessionConfig, backgroundCompactionThreshold };
        setBackgroundCompactionThreshold(backgroundCompactionThreshold);
    }
    return { status: 200, cors: true, body: { ok: true, infiniteSession: getInfiniteSessionConfig() } };
}

// ── GET /config/skills + PUT /config/skills (AG.3) ───────────────────────────

const SKILLS_PATH = join(resolve(import.meta.dirname, '../../../..'), 'skills.json');

/**
 * @typedef {Object} SkillsConfig
 * @property {string[]} paths - Lista de caminhos de arquivos/diretórios de contexto fixado
 */

/**
 * Lê o skills.json do disco. Retorna configuração padrão se o arquivo não existir.
 *
 * @returns {SkillsConfig}
 */
function readSkillsConfig() {
    if (!existsSync(SKILLS_PATH)) return { paths: [] };
    try {
        const raw = readFileSync(SKILLS_PATH, 'utf8');
        return JSON.parse(raw);
    } catch {
        return { paths: [] };
    }
}

/**
 * Persiste o skills.json no disco.
 *
 * @param {SkillsConfig} config
 * @returns {void}
 */
function writeSkillsConfig(config) {
    writeFileSync(SKILLS_PATH, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * GET /config/skills — retorna a lista de skills (paths pinned) configurados.
 *
 * @returns {HandlerResult}
 */
export function handleGetSkills() {
    return { status: 200, cors: true, body: { ok: true, skills: readSkillsConfig() } };
}

/**
 * PUT /config/skills — atualiza a lista de paths pinned. Espera `{ paths: string[] }` no body.
 *
 * @param {unknown} body
 * @returns {HandlerResult}
 */
export function handleSetSkills(body) {
    const { paths } = /** @type {any} */ (body) ?? {};
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) {
        return { status: 400, body: { ok: false, error: 'body deve conter { paths: string[] }' } };
    }
    const config = { paths };
    writeSkillsConfig(config);
    return { status: 200, cors: true, body: { ok: true, skills: config } };
}

// ── GET /config/tools + PUT /config/tools (AH.2) ─────────────────────────────

/**
 * GET /config/tools — retorna a configuração atual de allowlist/denylist de ferramentas.
 *
 * @returns {HandlerResult}
 */
export function handleGetToolsConfig() {
    return { status: 200, cors: true, body: { ok: true, tools: getToolsConfig() } };
}

/**
 * PUT /config/tools — atualiza allowlist e/ou denylist de ferramentas em runtime. Espera `{ allowlist?: string[] |
 * null; denylist?: string[] }`.
 *
 * @param {unknown} rawBody
 * @returns {HandlerResult}
 */
export function handleSetToolsConfig(rawBody) {
    const body = /** @type {any} */ (rawBody) ?? {};

    if ('allowlist' in body) {
        if (
            body.allowlist !== null &&
            (!Array.isArray(body.allowlist) || body.allowlist.some((/** @type {unknown} */ t) => typeof t !== 'string'))
        ) {
            return { status: 400, body: { ok: false, error: 'allowlist deve ser string[] ou null' } };
        }
        patchToolsConfig({ allowlist: body.allowlist });
    }

    if ('denylist' in body) {
        if (!Array.isArray(body.denylist) || body.denylist.some((/** @type {unknown} */ t) => typeof t !== 'string')) {
            return { status: 400, body: { ok: false, error: 'denylist deve ser string[]' } };
        }
        patchToolsConfig({ denylist: body.denylist });
    }

    return { status: 200, cors: true, body: { ok: true, tools: getToolsConfig() } };
}

// ── GET /config/tools/custom + POST /config/tools/custom + DELETE /config/tools/custom/:name (AI.2) ──

/**
 * GET /config/tools/custom — lista as custom tools registradas em runtime.
 *
 * @returns {HandlerResult}
 */
export function handleGetCustomTools() {
    const tools = getCustomToolDefinitions();
    const availableHandlers = [...BUILTIN_HANDLER_MAP.keys()];
    return { status: 200, cors: true, body: { ok: true, tools, availableHandlers } };
}

/**
 * POST /config/tools/custom — registra uma nova custom tool declarativa. Espera `{ name, description, handlerId,
 * parameters? }`.
 *
 * @param {unknown} rawBody
 * @returns {HandlerResult}
 */
export function handleRegisterCustomTool(rawBody) {
    const body = /** @type {any} */ (rawBody) ?? {};
    if (typeof body.name !== 'string' || !body.name) {
        return { status: 400, body: { ok: false, error: 'name (string) é obrigatório' } };
    }
    if (typeof body.description !== 'string' || !body.description) {
        return { status: 400, body: { ok: false, error: 'description (string) é obrigatória' } };
    }
    if (typeof body.handlerId !== 'string' || !body.handlerId) {
        return { status: 400, body: { ok: false, error: 'handlerId (string) é obrigatório' } };
    }
    const result = registerCustomTool({
        name: body.name,
        description: body.description,
        handlerId: body.handlerId,
        parameters: body.parameters ?? undefined,
    });
    if (!result.ok) return { status: 400, body: { ok: false, error: result.error } };
    return { status: 201, cors: true, body: { ok: true, tool: { name: body.name, handlerId: body.handlerId } } };
}

/**
 * DELETE /config/tools/custom/:name — remove uma custom tool pelo nome.
 *
 * @param {string} name
 * @returns {HandlerResult}
 */
export function handleDeleteCustomTool(name) {
    if (!name) return { status: 400, body: { ok: false, error: 'name é obrigatório' } };
    const result = removeCustomTool(name);
    if (!result.ok) return { status: 404, body: { ok: false, error: result.error } };
    return { status: 200, cors: true, body: { ok: true } };
}

// ─── GET /metrics ─────────────────────────────────────────────────────────────

/**
 * UPG-PROP-08 (fix): endpoint `/metrics` compatível com Prometheus para exposição de métricas operacionais do agente
 * LLM-B. Retorna texto no formato Prometheus text exposition format (version 0.0.4).
 *
 * Métricas expostas:
 *
 * - `llmb_agent_status` (gauge 0/1) — status atual do agente
 * - `llmb_queue_size` (gauge) — tarefas pendentes na fila
 * - `llmb_send_count_total` (counter) — total de mensagens enviadas
 * - `llmb_sse_clients` (gauge) — SSE clients conectados
 * - `llmb_context_tokens` (gauge) — tokens usados no context window
 * - `llmb_context_token_limit` (gauge) — limite de tokens do context window
 * - `llmb_context_utilization` (gauge) — utilização do context window (0.0–1.0)
 *
 * @returns {{ status: number; contentType: string; body: string }}
 */
export function handleMetrics() {
    const snapshot = alwaysAliveAgent.getStatusSnapshot();
    const statusValue = snapshot.status === 'running' || snapshot.status === 'busy' ? 1 : 0;
    const queueSize = snapshot.queueSize ?? 0;
    const sendCount = snapshot.sendCount ?? 0;
    const sseClients = getSseClients().size;
    const cw = snapshot.contextWindow;

    const lines = [
        '# HELP llmb_agent_status Current agent status (1=active, 0=inactive)',
        '# TYPE llmb_agent_status gauge',
        `llmb_agent_status ${statusValue}`,
        '',
        '# HELP llmb_queue_size Number of tasks pending in the queue',
        '# TYPE llmb_queue_size gauge',
        `llmb_queue_size ${queueSize}`,
        '',
        '# HELP llmb_send_count_total Total messages sent since last start',
        '# TYPE llmb_send_count_total counter',
        `llmb_send_count_total ${sendCount}`,
        '',
        '# HELP llmb_sse_clients Number of connected SSE clients',
        '# TYPE llmb_sse_clients gauge',
        `llmb_sse_clients ${sseClients}`,
        '',
        '# HELP llmb_context_tokens Context window tokens used',
        '# TYPE llmb_context_tokens gauge',
        `llmb_context_tokens ${cw?.tokens ?? 0}`,
        '',
        '# HELP llmb_context_token_limit Context window token limit',
        '# TYPE llmb_context_token_limit gauge',
        `llmb_context_token_limit ${cw?.tokenLimit ?? 0}`,
        '',
        '# HELP llmb_context_utilization Context window utilization ratio (0.0 to 1.0)',
        '# TYPE llmb_context_utilization gauge',
        `llmb_context_utilization ${cw?.utilization ?? 0}`,
        '',
    ];
    return {
        status: 200,
        contentType: 'text/plain; version=0.0.4; charset=utf-8',
        body: lines.join('\n'),
    };
}

// ─── Pause / Resume ───────────────────────────────────────────────────────────

/**
 * NEW-PAUSE: Handler para POST /dialog/pause. Pausa o dialog loop preservando o sessionId para retomada sem consumir
 * PR.
 *
 * @returns {Promise<{ status: number; body: object }>}
 */
export async function handleDialogPause() {
    if (!alwaysAliveAgent.dialogLoopActive) {
        return { status: 409, body: { ok: false, error: 'Dialog loop não está ativo.' } };
    }
    try {
        await alwaysAliveAgent.pauseDialogLoop();
        return {
            status: 200,
            body: { ok: true, message: 'Dialog loop pausado. Use POST /dialog/resume para retomar.' },
        };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

/**
 * NEW-PAUSE: Handler para POST /dialog/resume. Retoma o dialog loop a partir de estado pausado (sem novo PR se sessão
 * ainda ativa).
 *
 * @returns {Promise<{ status: number; body: object }>}
 */
export async function handleDialogResume() {
    if (alwaysAliveAgent.dialogLoopActive) {
        return { status: 409, body: { ok: false, error: 'Dialog loop já está ativo.' } };
    }
    try {
        await alwaysAliveAgent.resumeDialogLoop();
        return { status: 200, body: { ok: true, message: 'Dialog loop retomado.' } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── Quota ────────────────────────────────────────────────────────────────────

/**
 * RF-PR-04: Handler para GET /quota. Retorna dados de cota de PRs a partir do estado persistido (atualizado por
 * `assistant.usage`).
 *
 * @returns {{ status: number; body: object }}
 */
export function handleGetQuota() {
    const snapshot = alwaysAliveAgent.getStatusSnapshot();
    const prInfo = alwaysAliveAgent.lastPrInfo ?? null;
    return {
        status: 200,
        body: {
            ok: true,
            sendCount: snapshot?.sendCount ?? 0,
            dialogLoopActive: alwaysAliveAgent.dialogLoopActive,
            sessionId: alwaysAliveAgent.sessionId ?? null,
            lastPrConsumedAt: prInfo?.ts ?? null,
            lastPrModel: prInfo?.model ?? null,
            lastPrCost: prInfo?.cost ?? null,
            lastQuotaSnapshots: prInfo?.quotaSnapshots ?? null,
        },
    };
}
