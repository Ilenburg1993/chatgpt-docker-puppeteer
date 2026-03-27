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
import { conversationStore } from '../conversation-hub/store.js';
import { sendTurn } from './dialog.js';
import { embedMultiple, getFileCacheStats, readFileContext } from './file-context.js';
import { getBusy, getHubSessionId, getPlanMode, getSseClients, getSseCriticalClients } from './state.js';

// ─── Tipos auxiliares ─────────────────────────────────────────────────────────

/**
 * Resultado padrão de um handler HTTP.
 *
 * @typedef {{ status: number; body: unknown; cors?: boolean }} HandlerResult
 */

// ─── GET /health ──────────────────────────────────────────────────────────────

/**
 * Retorna o status atual do agente e do dialog loop.
 *
 * @returns {HandlerResult}
 */
export function handleHealth() {
    const snapshot = alwaysAliveAgent.getStatusSnapshot();
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

    const globalFrom = body.from ?? 'llm-a';
    /** @type {{ step: number; prompt: string; reply: string | null; durationMs: number }[]} */
    const results = [];

    for (let i = 0; i < body.steps.length; i++) {
        const step = body.steps[i];
        if (!step?.prompt) continue;
        const from = step.from ?? globalFrom;

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
 * - `attachments` — suporte a dois modos:
 *
 *   - **Nativo SDK**: `{ type: 'file'|'directory'|'selection', path: string, ... }` — passados para `sendTurn()` que
 *       internamente usa `alwaysAliveAgent.sendMessage()` (nova PR, único caminho SDK que suporta file attachments).
 *   - **Embed inline (fallback)**: `{ type: 'content', content: string, path?: string }` — embutidos como bloco markdown
 *       na mensagem antes de enviar via dialog loop.
 *
 * ATT-03: ambos os caminhos passam pelo mesmo mutex de serialização em `sendTurn()`, garantindo exclusão mútua.
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

    const from = body?.from ?? 'llm-a';

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

    // AI.5: separar attachments nativos SDK de attachments de conteúdo inline
    const rawAttachments = Array.isArray(body?.attachments) ? body.attachments : [];
    /** @type {import('@github/copilot-sdk').MessageOptions['attachments']} */
    const nativeAttachments = [];

    for (const att of rawAttachments) {
        if (!att) continue;
        if (att.type === 'file' && typeof att.path === 'string') {
            nativeAttachments.push({
                type: 'file',
                path: att.path,
                ...(att.displayName ? { displayName: att.displayName } : {}),
            });
        } else if (att.type === 'directory' && typeof att.path === 'string') {
            nativeAttachments.push({
                type: 'directory',
                path: att.path,
                ...(att.displayName ? { displayName: att.displayName } : {}),
            });
        } else if (att.type === 'selection' && typeof att.filePath === 'string') {
            nativeAttachments.push({
                type: 'selection',
                filePath: att.filePath,
                displayName: att.displayName ?? att.filePath,
                ...(att.selection !== undefined ? { selection: /** @type {any} */ (att.selection) } : {}),
                ...(typeof att.text === 'string' ? { text: att.text } : {}),
            });
        } else if (typeof att.content === 'string') {
            // MELHORIA-03 (fallback): embed de conteúdo inline como bloco markdown
            const label = att.path ?? 'attachment';
            enrichedMessage = `\`\`\`\n${att.content}\n\`\`\`\n*(${label})*\n\n${enrichedMessage}`;
        }
    }

    const t0 = Date.now();
    try {
        // ATT-03: sendTurn aceita nativeAttachments e decide internamente o path de execução
        // (dialog loop para texto simples; sendMessage para attachments nativos SDK).
        // O mutex de sendTurn garante exclusão mútua em ambos os caminhos.
        const reply = await sendTurn(enrichedMessage, from, nativeAttachments.length > 0 ? nativeAttachments : undefined);
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
 * @param {{ state?: string; limit?: number }} params
 * @returns {Promise<HandlerResult>}
 */
export async function handleGhIssues({ state = 'open', limit = 15 } = {}) {
    try {
        const issues = await listIssues({ state: /** @type {any} */ (state), limit });
        return { status: 200, cors: true, body: { ok: true, issues } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /gh/prs ──────────────────────────────────────────────────────────────

/**
 * Lista GitHub pull requests via gh CLI.
 *
 * @param {{ state?: string; limit?: number }} params
 * @returns {Promise<HandlerResult>}
 */
export async function handleGhPrs({ state = 'open', limit = 15 } = {}) {
    try {
        const prs = await listPrs({ state: /** @type {any} */ (state), limit });
        return { status: 200, cors: true, body: { ok: true, prs } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /gh/ci ───────────────────────────────────────────────────────────────

/**
 * Lista GitHub CI runs via gh CLI.
 *
 * @param {{ limit?: number }} params
 * @returns {Promise<HandlerResult>}
 */
export async function handleGhCi({ limit = 15 } = {}) {
    try {
        const runs = await listRuns({ limit });
        return { status: 200, cors: true, body: { ok: true, runs } };
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
