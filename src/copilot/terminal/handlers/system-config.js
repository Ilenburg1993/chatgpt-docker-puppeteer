// @ts-check
/**
 * src/copilot/terminal/handlers-system-config.js
 *
 * Handlers de sistema: health, config, SSE clients, skills, tools, custom tools.
 *
 * @module copilot/terminal/handlers-system-config
 * @see EventBus
 * @see module:copilot/terminal/route-table
 */

import { ALWAYS_ALIVE_AGENT } from '#copilot/agent';
import { getMcpStatus } from '#copilot/bridges';
import { LLM_B_TERMINAL_PORT } from '#copilot/config';
import { CONVERSATION_STORE, HUB } from '#copilot/conversation-hub';
import { container } from '#copilot/core';
import { METRICS_STORE } from '#copilot/observability';
import {
    BUILTIN_HANDLER_MAP,
    getCustomToolDefinitions,
    getToolsConfig,
    patchToolsConfig,
    registerCustomTool,
    removeCustomTool,
} from '#copilot/sdk';
import { setBackgroundCompactionThreshold } from '#copilot/services';
import { existsSync } from 'node:fs';
import { readFile as readFileAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { safeJsonParse } from '../../core/safe-json.js';
import { getSseClients, getSseCriticalClients } from '../../infra/sse/state.js';
import { getFileCacheStats } from '../file-context.js';
import { getBusy, getHubSessionId, getPlanMode } from '../state.js';

/**
 * @typedef {import('./shared.js').HandlerResult} HandlerResult
 */

// ─── GET /health ──────────────────────────────────────────────────────────────

/**
 * Retorna o status atual do agente e do dialog loop.
 *
 * @returns {HandlerResult}
 */
export function handleHealth() {
    const snapshot = container.resolve(ALWAYS_ALIVE_AGENT).getStatusSnapshot();
    let hubInfo = { initialized: false, activeSessions: 0 };
    if (container.resolve(HUB).isReady) {
        try {
            const activeSessions = container.resolve(CONVERSATION_STORE).countHubSessions({ status: 'active' });
            hubInfo = { initialized: true, activeSessions };
        } catch {
            hubInfo = { initialized: true, activeSessions: -1 };
        }
    }
    return {
        status: 200,
        body: {
            ok: true,
            dialogLoopActive: container.resolve(ALWAYS_ALIVE_AGENT).dialogLoopActive,
            agentStatus: container.resolve(ALWAYS_ALIVE_AGENT).status,
            busy: getBusy(),
            hubSessionId: getHubSessionId(),
            sseClients: getSseClients().size,
            model: container.resolve(ALWAYS_ALIVE_AGENT).model,
            reasoningEffort: container.resolve(ALWAYS_ALIVE_AGENT).reasoningEffort ?? 'high',
            contextWindow: snapshot.contextWindow,
            cacheStats: { fileContext: getFileCacheStats() },
            hub: hubInfo,
            metrics: (() => {
                const s = container.resolve(METRICS_STORE).getSummary();
                return {
                    tokens: {
                        input: s.tokens.inputTokens,
                        output: s.tokens.outputTokens,
                        cacheRead: s.tokens.cacheReadTokens,
                        total: s.tokens.inputTokens + s.tokens.outputTokens,
                    },
                    tasks: { completed: s.tasks.completed, failed: s.tasks.failed },
                    dialog: { turns: s.dialog.turnsTotal, success: s.dialog.turnsSuccess },
                };
            })(),
            uptime: Math.round(process.uptime()),
            memoryMB: Math.round(process.memoryUsage.rss() / 1_048_576),
            mcp: getMcpStatus(),
            operationMode: (() => {
                const s = getMcpStatus();
                return s.available && s.toolCount > 0 && !s.circuitOpen ? 'connected' : 'standalone';
            })(),
        },
    };
}

// ─── SSE Clients ──────────────────────────────────────────────────────────────

/**
 * Obtém os conjuntos de clientes SSE.
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
    const snapshot = container.resolve(ALWAYS_ALIVE_AGENT).getStatusSnapshot();
    return {
        status: 200,
        cors: true,
        body: {
            ok: true,
            model: container.resolve(ALWAYS_ALIVE_AGENT).model,
            reasoningEffort: container.resolve(ALWAYS_ALIVE_AGENT).reasoningEffort ?? 'high',
            planMode: getPlanMode(),
            dialogLoopActive: container.resolve(ALWAYS_ALIVE_AGENT).dialogLoopActive,
            busy: getBusy(),
            hubSessionId: getHubSessionId(),
            port: LLM_B_TERMINAL_PORT,
            contextWindow: snapshot.contextWindow,
            lastCheckpointPath: snapshot.lastCheckpointPath,
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
 * Atualiza o threshold de compaction dinâmico.
 *
 * @param {{ backgroundCompactionThreshold?: number }} body
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
 * @property {string[]} paths
 */

/**
 * Lê o skills.json do disco.
 *
 * @returns {Promise<SkillsConfig>}
 */
async function readSkillsConfig() {
    if (!existsSync(SKILLS_PATH)) return { paths: [] };
    try {
        const raw = await readFileAsync(SKILLS_PATH, 'utf8');
        const result = safeJsonParse(raw, '[system-config/readSkillsConfig]');
        return result.ok ? /** @type {SkillsConfig} */ (result.data) : { paths: [] };
    } catch {
        return { paths: [] };
    }
}

/**
 * Persiste o skills.json no disco.
 *
 * @param {SkillsConfig} config
 * @returns {Promise<void>}
 */
async function writeSkillsConfig(config) {
    await writeFileAsync(SKILLS_PATH, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * GET /config/skills — retorna a lista de skills configurados.
 *
 * @returns {Promise<HandlerResult>}
 */
export async function handleGetSkills() {
    const skills = await readSkillsConfig();
    return { status: 200, cors: true, body: { ok: true, skills } };
}

/**
 * PUT /config/skills — atualiza a lista de paths pinned.
 *
 * @param {unknown} body
 * @returns {Promise<HandlerResult>}
 */
export async function handleSetSkills(body) {
    const { paths } = /** @type {Record<string, unknown>} */ (body) ?? {};
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) {
        return { status: 400, body: { ok: false, error: 'body deve conter { paths: string[] }' } };
    }
    const config = { paths };
    await writeSkillsConfig(config);
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
 * PUT /config/tools — atualiza allowlist e/ou denylist de ferramentas em runtime.
 *
 * @param {unknown} rawBody
 * @returns {Promise<HandlerResult>}
 */
export async function handleSetToolsConfig(rawBody) {
    const body = /** @type {Record<string, unknown>} */ (rawBody) ?? {};

    if ('allowlist' in body) {
        if (
            body['allowlist'] !== null &&
            (!Array.isArray(body['allowlist']) ||
                body['allowlist'].some((/** @type {unknown} */ t) => typeof t !== 'string'))
        ) {
            return { status: 400, body: { ok: false, error: 'allowlist deve ser string[] ou null' } };
        }
        await patchToolsConfig({ allowlist: body['allowlist'] });
    }

    if ('denylist' in body) {
        if (
            !Array.isArray(body['denylist']) ||
            body['denylist'].some((/** @type {unknown} */ t) => typeof t !== 'string')
        ) {
            return { status: 400, body: { ok: false, error: 'denylist deve ser string[]' } };
        }
        await patchToolsConfig({ denylist: body['denylist'] });
    }

    return { status: 200, cors: true, body: { ok: true, tools: getToolsConfig() } };
}

// ── Custom tools (AI.2) ─────────────────────────────────────────────────────

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
 * POST /config/tools/custom — registra uma nova custom tool declarativa.
 *
 * @param {unknown} rawBody
 * @returns {Promise<HandlerResult>}
 */
export async function handleRegisterCustomTool(rawBody) {
    const body = /** @type {Record<string, unknown>} */ (rawBody) ?? {};
    if (typeof body['name'] !== 'string' || !body['name']) {
        return { status: 400, body: { ok: false, error: 'name (string) é obrigatório' } };
    }
    if (typeof body['description'] !== 'string' || !body['description']) {
        return { status: 400, body: { ok: false, error: 'description (string) é obrigatória' } };
    }
    if (typeof body['handlerId'] !== 'string' || !body['handlerId']) {
        return { status: 400, body: { ok: false, error: 'handlerId (string) é obrigatório' } };
    }
    const result = await registerCustomTool({
        name: body['name'],
        description: body['description'],
        handlerId: body['handlerId'],
        ...(body['parameters'] != null && {
            parameters: /** @type {Record<string, unknown>} */ (body['parameters']),
        }),
    });
    if (!result.ok) return { status: 400, body: { ok: false, error: result.error } };
    return { status: 201, cors: true, body: { ok: true, tool: { name: body['name'], handlerId: body['handlerId'] } } };
}

/**
 * DELETE /config/tools/custom/:name — remove uma custom tool pelo nome.
 *
 * @param {Record<string, unknown>} params
 * @returns {Promise<HandlerResult>}
 */
export async function handleDeleteCustomTool(params) {
    const name = typeof params['name'] === 'string' ? params['name'] : undefined;
    if (!name) return { status: 400, body: { ok: false, error: 'name é obrigatório' } };
    const result = await removeCustomTool(name);
    if (!result.ok) return { status: 404, body: { ok: false, error: result.error } };
    return { status: 200, cors: true, body: { ok: true } };
}
