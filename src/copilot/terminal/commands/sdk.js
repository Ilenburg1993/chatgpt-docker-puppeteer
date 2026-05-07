// @ts-check
/**
 * Comandos SDK-first do terminal LLM-B.
 *
 * @module copilot/terminal/commands/sdk
 */

import { randomUUID } from 'node:crypto';

import { CANONICAL_LOCAL_FS_TOOL_NAMES, decideSdkFsRouting, toError } from '#copilot/core';
import { fileReadTools, fileWriteTools } from '#copilot/tools';
import { isRuntimeElicitationSchema, normalizeElicitationContentWithSchema } from '../../core/elicitation-schema.js';
import { buildFailureRecoveryLines, buildTerminalOperationalGuidance } from '../auto-briefing.js';
import {
    readTerminalRuntimePermissionMode,
    readTerminalRuntimeState,
    setTerminalRuntimePermissionMode,
} from '../frontend/gateways/agent-runtime.js';
import {
    compactTerminalSdkSession,
    confirmTerminalSdkSessionUi,
    createTerminalSdkWorkspaceFile,
    getTerminalSdkQuota,
    getTerminalSdkSessionCapabilities,
    handleTerminalSdkPendingPermission,
    inputTerminalSdkSessionUi,
    isTerminalSdkSessionUiElicitationAvailable,
    listTerminalSdkModels,
    listTerminalSdkPendingPermissions,
    listTerminalSdkTools,
    listTerminalSdkWorkspaceFiles,
    readTerminalSdkSystemPromptProjection,
    readTerminalSdkWorkspaceFile,
    requestTerminalSdkElicitation,
    resolveTerminalSdkPendingElicitation,
    selectTerminalSdkSessionUi,
} from '../frontend/gateways/sdk-session.js';
import {
    classifyTerminalSdkQuota,
    clearTerminalElicitation,
    clearTerminalPermission,
    getTerminalElicitation,
    getTerminalPermission,
    listTerminalElicitations,
    listTerminalPermissionModeHistory,
    listTerminalPermissions,
    readTerminalElicitationSummary,
    readTerminalPermissionSummary,
    readTerminalUserInputSummary,
    recordTerminalPermissionCompleted,
    recordTerminalPermissionRequested,
} from '../sdk-interactions.js';
import { callWithRuntimeTarget, extractRuntimeTarget } from './runtime-target.js';

/**
 * @typedef {{ println: (text: string) => void }} CommandContext
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectOrNull(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function arrayFromSdkList(value) {
    const data = objectOrNull(value) ?? {};
    if (Array.isArray(value)) return value;
    if (Array.isArray(data['models'])) return data['models'];
    if (Array.isArray(data['tools'])) return data['tools'];
    if (Array.isArray(data['files'])) return data['files'];
    return [];
}

/**
 * @param {{ handler?: Function }} tool
 * @returns {Function}
 */
function getToolHandler(tool) {
    if (typeof tool?.handler === 'function') return tool.handler;
    throw new TypeError('[terminal/workspace] tool sem handler executável.');
}

/**
 * @param {import('#copilot/sdk/types').Tool[]} tools
 * @param {string} name
 * @returns {import('#copilot/sdk/types').Tool}
 */
function findTool(tools, name) {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new TypeError(`[terminal/workspace] tool canônica ausente: ${name}`);
    return tool;
}

const createFileTool = findTool(fileWriteTools, 'create_file');
const writeFileContentTool = findTool(fileWriteTools, 'write_file_content');
const readFileContentTool = findTool(fileReadTools, 'read_file_content');

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function workspaceReadContent(value) {
    if (typeof value === 'string') return value;
    const data = objectOrNull(value);
    if (!data) return null;
    if (typeof data['content'] === 'string') return data['content'];
    if (typeof data['text'] === 'string') return data['text'];
    return null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function workspaceListPaths(value) {
    return arrayFromSdkList(value)
        .map((item) => {
            if (typeof item === 'string') return item;
            const entry = objectOrNull(item);
            if (!entry) return null;
            const path = entry['path'] ?? entry['name'] ?? null;
            return typeof path === 'string' ? path : null;
        })
        .filter((item) => typeof item === 'string');
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function localReadContent(value) {
    if (typeof value === 'string') return value;
    const data = objectOrNull(value);
    if (!data || data['success'] === false) return null;
    if (typeof data['content'] === 'string') return data['content'];
    if (typeof data['text'] === 'string') return data['text'];
    return null;
}

/**
 * @param {Record<string, unknown>} result
 * @returns {string}
 */
function ioSummary(result) {
    const io = objectOrNull(result['io']) ?? {};
    const operation = typeof io['operation'] === 'string' ? io['operation'] : null;
    const engine = typeof io['engine'] === 'string' ? io['engine'] : null;
    if (!operation && !engine) return '';
    return `io=${operation ?? '-'} · engine=${engine ?? '-'}`;
}

/**
 * @param {string[]} rest
 * @returns {{ overwrite: boolean; to: string | null }}
 */
function parseWorkspaceMaterializeFlags(rest) {
    let overwrite = false;
    let to = null;
    for (let i = 0; i < rest.length; i++) {
        const token = rest[i];
        if (token === '--overwrite') {
            overwrite = true;
            continue;
        }
        if (token === '--to') {
            const candidate = rest[i + 1] ?? '';
            if (candidate.trim()) {
                to = candidate.trim();
                i += 1;
            }
        }
    }
    return { overwrite, to };
}

/**
 * @param {{ println: (text: string) => void }} ctx
 * @param {{ destinationPath: string; content: string; overwrite: boolean }} payload
 * @returns {Promise<Record<string, unknown>>}
 */
async function materializeWorkspaceFile(ctx, payload) {
    void ctx;
    const tool = payload.overwrite ? writeFileContentTool : createFileTool;
    const args = payload.overwrite
        ? { path: payload.destinationPath, content: payload.content, encoding: 'utf8' }
        : {
              path: payload.destinationPath,
              content: payload.content,
              overwrite: false,
              createParentDirs: true,
          };
    const result = await getToolHandler(tool)(args);
    return objectOrNull(result) ?? { success: false, error: 'materialização retornou payload inválido.' };
}

/**
 * @param {string} sourcePath
 * @returns {Promise<{ content: string; raw: Record<string, unknown> } | null>}
 */
async function readLocalFileForWorkspace(sourcePath) {
    const result = await getToolHandler(readFileContentTool)({ path: sourcePath, encoding: 'utf8' });
    const raw = objectOrNull(result) ?? {};
    const content = localReadContent(result);
    return content === null ? null : { content, raw };
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isWorkspaceMissingError(error) {
    const message = toError(error).message.toLowerCase();
    return (
        message.includes('enoent') ||
        message.includes('not found') ||
        message.includes('no such file') ||
        message.includes('missing')
    );
}

/**
 * @param {{ println: (text: string) => void }} ctx
 * @param {{ sourcePath: string; destinationPath: string; overwrite: boolean; runtimeId?: string | null }} payload
 * @returns {Promise<
 *     | { ok: true; traceId: string; result: unknown; bytes: number; action: 'created' | 'overwritten' }
 *     | { ok: false; traceId: string; reason: string; conflict?: boolean }
 * >}
 */
async function promoteLocalFileToWorkspace(ctx, payload) {
    void ctx;
    const traceId = randomUUID();
    const local = await readLocalFileForWorkspace(payload.sourcePath);
    if (!local) {
        return { ok: false, traceId, reason: 'arquivo local não textual/indisponível para promoção' };
    }

    if (!payload.overwrite) {
        try {
            await callWithRuntimeTarget(readTerminalSdkWorkspaceFile, payload.runtimeId, payload.destinationPath);
            return {
                ok: false,
                traceId,
                reason: 'destino já existe no workspace SDK; use --overwrite para substituir',
                conflict: true,
            };
        } catch (error) {
            if (!isWorkspaceMissingError(error)) throw error;
        }
    }

    const result = await callWithRuntimeTarget(
        createTerminalSdkWorkspaceFile,
        payload.runtimeId,
        payload.destinationPath,
        local.content,
    );
    return {
        ok: true,
        traceId,
        result,
        bytes: Buffer.byteLength(local.content, 'utf8'),
        action: payload.overwrite ? 'overwritten' : 'created',
    };
}

/**
 * @param {import('#copilot/sdk/types').Tool[]} tools
 * @param {string} name
 * @returns {boolean}
 */
function hasTool(tools, name) {
    return tools.some((tool) => tool.name === name);
}

/**
 * @param {CommandContext} ctx
 * @param {string | null | undefined} runtimeId
 * @returns {Promise<void>}
 */
async function renderSdkDoctor({ println }, runtimeId) {
    const capabilities = callWithRuntimeTarget(getTerminalSdkSessionCapabilities, runtimeId);
    const caps = objectOrNull(capabilities) ?? {};
    const sdkTools = objectOrNull(caps['tools']) ?? {};
    const sdkWorkspaceAvailable = sdkTools['workspace'] === true;

    const localFsToolNames = [...CANONICAL_LOCAL_FS_TOOL_NAMES];
    const localFsToolsReady = localFsToolNames.every(
        (name) => hasTool(fileReadTools, name) || hasTool(fileWriteTools, name),
    );

    const promptProjection = await callWithRuntimeTarget(readTerminalSdkSystemPromptProjection, runtimeId);
    const instructionSourcesAvailable =
        Boolean(promptProjection['instructionSources']) || !promptProjection['instructionSourcesError'];

    const routing = decideSdkFsRouting({
        canonicalFsReady: localFsToolsReady,
        sdkWorkspaceAvailable,
    });
    const routingMode = routing.mode;
    const guidance = buildTerminalOperationalGuidance({
        sdkFsRouting: routing,
        toolLoad: {
            hasCanonicalLocalFsTools: localFsToolsReady,
        },
        instructionLoad: {
            sectionsMissingFileCount: 0,
            appendFileMissingCount: instructionSourcesAvailable ? 0 : 1,
        },
    });

    println('\n  \x1b[36mSDK Doctor — roteamento SDK x FS\x1b[0m');
    println(
        `  surfaces   \x1b[90msdk.workspace=${String(sdkWorkspaceAvailable)} · local.fs.canônico=${String(localFsToolsReady)} · instructionSources=${String(instructionSourcesAvailable)}\x1b[0m`,
    );
    println(`  mode       \x1b[33m${routingMode}\x1b[0m`);
    if (routingMode === 'local-fs-primary') {
        println('  decis�o    \x1b[32mFS local can�nico prim�rio (SDK workspace como auxiliar).\x1b[0m');
    } else if (routingMode === 'sdk-workspace-only') {
        println('  decis�o    \x1b[33mFallback em workspace SDK at� recuperar file-tools locais.\x1b[0m');
    } else {
        println('  decis�o    \x1b[31mDegradado: restaurar boot/load antes de operar em arquivo.\x1b[0m');
    }
    println(`  dom�nio    \x1b[90m${guidance.domainHint}\x1b[0m`);
    println(`  contexto   \x1b[90m${guidance.contextHint}\x1b[0m`);
    if (guidance.warnings.length > 0) {
        println(`  aten��o    \x1b[33m${guidance.warnings.join(' | ')}\x1b[0m`);
    }
    println(`  razão      \x1b[90m${routing.reason}\x1b[0m`);
    println(`  local fs   \x1b[90m${localFsToolNames.join(', ')}\x1b[0m`);
    println('');
}

/**
 * @param {(line: string) => void} println
 * @param {string | null | undefined} runtimeId
 * @returns {Promise<void>}
 */
async function renderCommandFailureGuidance(println, runtimeId) {
    const capabilities = callWithRuntimeTarget(getTerminalSdkSessionCapabilities, runtimeId);
    const caps = objectOrNull(capabilities) ?? {};
    const sdkTools = objectOrNull(caps['tools']) ?? {};
    const sdkWorkspaceAvailable = sdkTools['workspace'] === true;
    const localFsToolsReady = [...CANONICAL_LOCAL_FS_TOOL_NAMES].every(
        (name) => hasTool(fileReadTools, name) || hasTool(fileWriteTools, name),
    );
    const routing = decideSdkFsRouting({
        canonicalFsReady: localFsToolsReady,
        sdkWorkspaceAvailable,
    });
    const guidance = buildTerminalOperationalGuidance({
        sdkFsRouting: routing,
        toolLoad: { hasCanonicalLocalFsTools: localFsToolsReady },
        instructionLoad: { sectionsMissingFileCount: 0, appendFileMissingCount: 0 },
    });
    for (const line of buildFailureRecoveryLines(guidance)) {
        println(`  \x1b[90m${line}\x1b[0m`);
    }
}

/**
 * @param {unknown} value
 * @param {number} [max=1000] Default is `1000`
 * @returns {string}
 */
function pretty(value, max = 1000) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} chars restantes)` : text;
}

/**
 * @param {string[]} rest
 * @returns {{ json: Record<string, unknown> | null; error: string | null }}
 */
function parseJsonObject(rest) {
    const raw = rest.join(' ').trim();
    if (!raw) return { json: null, error: null };
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { json: null, error: 'JSON deve ser um objeto.' };
        }
        return { json: /** @type {Record<string, unknown>} */ (parsed), error: null };
    } catch (e) {
        return { json: null, error: toError(e).message };
    }
}

/**
 * @param {string[]} parts
 * @returns {{ left: string[]; right: string[] }}
 */
function splitAtDoubleDash(parts) {
    const idx = parts.indexOf('--');
    if (idx === -1) return { left: parts, right: [] };
    return {
        left: parts.slice(0, idx),
        right: parts.slice(idx + 1),
    };
}

/**
 * @returns {Record<string, unknown>}
 */
function defaultElicitationSchema() {
    return {
        type: 'object',
        properties: {
            answer: {
                type: 'string',
                title: 'Resposta',
            },
        },
        required: ['answer'],
    };
}

/**
 * @param {string | undefined} action
 * @param {string[]} rest
 * @param {unknown} [schema]
 * @returns {{ ok: true; result: import('../../presentation/types.js').RuntimeElicitationResult }
 *     | { ok: false; error: string }}
 */
function parseElicitationResult(action, rest, schema) {
    if (action !== 'accept' && action !== 'decline' && action !== 'cancel') {
        return { ok: false, error: 'Ação deve ser accept | decline | cancel.' };
    }
    if (action !== 'accept' && rest.join(' ').trim()) {
        return { ok: false, error: 'JSON content só é aceito para action=accept.' };
    }
    if (action !== 'accept') {
        return { ok: true, result: { action } };
    }
    const parsed = parseJsonObject(rest);
    if (parsed.error) {
        return { ok: false, error: parsed.error };
    }
    const content = parsed.json
        ? /** @type {Record<string, string | number | boolean | string[]>} */ (/** @type {unknown} */ (parsed.json))
        : undefined;
    const normalized = normalizeElicitationContentWithSchema(content, schema);
    if (!normalized.ok) {
        return { ok: false, error: normalized.error };
    }
    return { ok: true, result: { action, ...(normalized.content ? { content: normalized.content } : {}) } };
}

/**
 * @param {CommandContext} ctx
 * @param {string | null | undefined} runtimeId
 * @returns {void}
 */
function renderSdkWaitsSummary({ println }, runtimeId) {
    const scopedRuntimeId = runtimeId ?? null;
    const pendingElicitations = readTerminalElicitationSummary({ runtimeId: scopedRuntimeId });
    const permissionSummary = readTerminalPermissionSummary({ runtimeId: scopedRuntimeId });
    const userInputSummary = readTerminalUserInputSummary({ runtimeId: scopedRuntimeId });
    const totalPending = pendingElicitations.pending + permissionSummary.pending + userInputSummary.pending;
    const headlineColor = totalPending > 0 ? '\x1b[33m' : '\x1b[32m';

    println(`\n  \x1b[36mSDK Waits\x1b[0m`);
    println(
        `  status   ${headlineColor}${totalPending > 0 ? `${totalPending} pendência(s)` : 'nenhuma pendência'}\x1b[0m`,
    );
    println(
        `  waits    \x1b[90melicitation=${pendingElicitations.pending}${pendingElicitations.latest?.mode ? ` (${pendingElicitations.latest.mode})` : ''} · permission=${permissionSummary.pending}${permissionSummary.latest ? ` (${permissionSummary.latest.permissionType})` : ''} · ask_user=${userInputSummary.pending}${userInputSummary.latest?.kind ? ` (${userInputSummary.latest.kind})` : ''}\x1b[0m`,
    );

    if (pendingElicitations.pending > 0) {
        println('  ação     \x1b[90m/elicitation show latest · /elicitation list\x1b[0m');
    }
    if (permissionSummary.pending > 0) {
        println('  ação     \x1b[90m/permission show latest · /permission all\x1b[0m');
    }
    if (userInputSummary.pending > 0) {
        println('  ação     \x1b[90m/answer <texto> ou responda na conversa ativa\x1b[0m');
    }
    if (totalPending === 0) {
        println('  \x1b[90mSem bloqueios de input humano do SDK no momento.\x1b[0m');
    }
    println('');
}

/**
 * @param {CommandContext} ctx
 * @param {string | null | undefined} runtimeId
 * @returns {void}
 */
function renderSdkCapabilitiesSummary({ println }, runtimeId) {
    const capabilities = callWithRuntimeTarget(getTerminalSdkSessionCapabilities, runtimeId);
    const caps = objectOrNull(capabilities) ?? {};
    const ui = objectOrNull(caps['ui']) ?? {};
    const tools = objectOrNull(caps['tools']) ?? {};
    const plan = objectOrNull(caps['plan']) ?? {};

    println('\n  \x1b[36mSDK Capabilities\x1b[0m');
    println(
        `  ui       \x1b[90melicitation=${String(ui['elicitation'] ?? false)} · confirm=${String(ui['confirm'] ?? false)} · select=${String(ui['select'] ?? false)} · input=${String(ui['input'] ?? false)}\x1b[0m`,
    );
    println(
        `  tools    \x1b[90mworkspace=${String(tools['workspace'] ?? false)} · list=${String(tools['list'] ?? false)} · quota=${String(tools['quota'] ?? false)}\x1b[0m`,
    );
    println(
        `  plan     \x1b[90mread=${String(plan['read'] ?? false)} · write=${String(plan['write'] ?? false)} · delete=${String(plan['delete'] ?? false)}\x1b[0m`,
    );
    println(`  raw      \x1b[90m${pretty(capabilities, 1200)}\x1b[0m\n`);
}

/**
 * @param {string | undefined} raw
 * @returns {{
 *     kind: 'approve-once' | 'approve-for-session' | 'approve-for-location' | 'reject' | 'user-not-available';
 * } | null}
 */
function parsePermissionDecision(raw) {
    const value = (raw ?? '').trim().toLowerCase();
    if (!value) return null;
    if (value === 'approve' || value === 'approve-once') return { kind: 'approve-once' };
    if (value === 'approve-for-session' || value === 'session') return { kind: 'approve-for-session' };
    if (value === 'approve-for-location' || value === 'location') return { kind: 'approve-for-location' };
    if (value === 'reject' || value === 'deny') return { kind: 'reject' };
    if (value === 'user-not-available' || value === 'unavailable') return { kind: 'user-not-available' };
    return null;
}

/**
 * @param {{ kind: string } & Record<string, unknown>} result
 * @returns {string | null}
 */
function validatePermissionDecisionResult(result) {
    if (result.kind === 'approve-for-session' && !objectOrNull(result['approval'])) {
        return 'approve-for-session exige payload JSON com "approval" object.';
    }
    if (result.kind === 'approve-for-location') {
        if (!objectOrNull(result['approval'])) return 'approve-for-location exige payload JSON com "approval" object.';
        if (typeof result['locationKey'] !== 'string' || result['locationKey'].trim().length === 0) {
            return 'approve-for-location exige payload JSON com "locationKey" string.';
        }
    }
    return null;
}

/**
 * @param {CommandContext} ctx
 * @param {string} [arg]
 * @returns {Promise<void>}
 */
export async function cmdSdk({ println }, arg = '') {
    const { runtimeId, arg: cleanArg } = extractRuntimeTarget(arg);
    const [sub = 'status', ...rest] = cleanArg.trim().split(/\s+/).filter(Boolean);
    try {
        if (sub === 'models') {
            await renderSdkModels({ println }, runtimeId);
        } else if (sub === 'tools') {
            await renderSdkTools({ println }, rest[0], runtimeId);
        } else if (sub === 'quota') {
            await renderSdkQuota({ println }, runtimeId);
        } else if (sub === 'prompt') {
            await renderSdkSystemPrompt({ println }, runtimeId);
        } else if (sub === 'doctor') {
            await renderSdkDoctor({ println }, runtimeId);
        } else if (sub === 'capabilities' || sub === 'caps') {
            renderSdkCapabilitiesSummary({ println }, runtimeId);
        } else if (sub === 'waits') {
            renderSdkWaitsSummary({ println }, runtimeId);
        } else if (sub === 'compact') {
            const result = await callWithRuntimeTarget(compactTerminalSdkSession, runtimeId);
            println(`\n  \x1b[32m✓ SDK compaction solicitada.\x1b[0m\n  \x1b[90m${pretty(result, 700)}\x1b[0m\n`);
        } else {
            const state = readTerminalRuntimeState(runtimeId);
            const pendingElicitations = readTerminalElicitationSummary({ runtimeId: state.runtimeId });
            const permissionSummary = readTerminalPermissionSummary({ runtimeId: state.runtimeId });
            const userInputSummary = readTerminalUserInputSummary({ runtimeId: state.runtimeId });
            println('\n  \x1b[36mSDK Runtime\x1b[0m');
            println(`  runtime  \x1b[90m${state.runtimeId}\x1b[0m`);
            println(`  session  \x1b[90m${state.sessionId ?? '-'}\x1b[0m`);
            println(`  model    \x1b[33m${state.model}\x1b[0m  reasoning=\x1b[33m${state.reasoningEffort}\x1b[0m`);
            println(
                `  waits    \x1b[90melicitation=${pendingElicitations.pending}${pendingElicitations.latest?.mode ? ` (${pendingElicitations.latest.mode})` : ''} · permission=${permissionSummary.pending}${permissionSummary.latest ? ` (${permissionSummary.latest.permissionType})` : ''} · ask_user=${userInputSummary.pending}${userInputSummary.latest?.kind ? ` (${userInputSummary.latest.kind})` : ''}\x1b[0m`,
            );
            await renderSdkQuota({ println }, runtimeId, { compact: true });
            println(
                '  \x1b[90mUso: /sdk models | /sdk tools [model] | /sdk quota | /sdk prompt | /sdk capabilities | /sdk waits | /sdk doctor | /sdk compact\x1b[0m\n',
            );
        }
    } catch (e) {
        println(`\n  \x1b[31m✗ SDK: ${toError(e).message}\x1b[0m\n`);
    }
}

/**
 * @param {CommandContext} ctx
 * @param {string | null | undefined} runtimeId
 * @returns {Promise<void>}
 */
async function renderSdkModels({ println }, runtimeId) {
    const result = await callWithRuntimeTarget(listTerminalSdkModels, runtimeId);
    const models = arrayFromSdkList(result);
    println(`\n  \x1b[36mModelos SDK (${models.length})\x1b[0m`);
    for (const model of models.slice(0, 30)) {
        const m = objectOrNull(model) ?? {};
        const id = String(m['id'] ?? m['name'] ?? model);
        const effort = Array.isArray(m['supportedReasoningEfforts']) ? m['supportedReasoningEfforts'].join(',') : '';
        println(`  \x1b[33m${id}\x1b[0m${effort ? `  \x1b[90mreasoning: ${effort}\x1b[0m` : ''}`);
    }
    if (models.length > 30) println(`  \x1b[90m… ${models.length - 30} modelos omitidos\x1b[0m`);
    println('');
}

/**
 * @param {CommandContext} ctx
 * @param {string | undefined} model
 * @param {string | null | undefined} runtimeId
 * @returns {Promise<void>}
 */
async function renderSdkTools({ println }, model, runtimeId) {
    const result = await callWithRuntimeTarget(listTerminalSdkTools, runtimeId, { model: model || undefined });
    const tools = arrayFromSdkList(result);
    println(`\n  \x1b[36mTools SDK${model ? ` para ${model}` : ''} (${tools.length})\x1b[0m`);
    for (const tool of tools.slice(0, 50)) {
        const t = objectOrNull(tool) ?? {};
        const name = String(t['namespacedName'] ?? t['name'] ?? tool);
        const desc = String(t['description'] ?? '')
            .replace(/\s+/g, ' ')
            .slice(0, 90);
        println(`  \x1b[33m${name}\x1b[0m${desc ? `  \x1b[90m${desc}\x1b[0m` : ''}`);
    }
    if (tools.length > 50) println(`  \x1b[90m… ${tools.length - 50} tools omitidas\x1b[0m`);
    println('');
}

/**
 * @param {CommandContext} ctx
 * @param {string | null | undefined} runtimeId
 * @param {{ compact?: boolean }} [opts]
 * @returns {Promise<void>}
 */
async function renderSdkQuota({ println }, runtimeId, opts = {}) {
    const result = await callWithRuntimeTarget(getTerminalSdkQuota, runtimeId);
    const data = objectOrNull(result) ?? {};
    const snapshots = objectOrNull(data['quotaSnapshots']) ?? {};
    const state = classifyTerminalSdkQuota(result);
    const color = state === 'bad' ? '\x1b[31m' : state === 'warn' ? '\x1b[33m' : '\x1b[32m';
    if (!opts.compact) println('\n  \x1b[36mQuota SDK\x1b[0m');
    for (const [name, snapshot] of Object.entries(snapshots)) {
        const snap = objectOrNull(snapshot) ?? {};
        const remaining = Number(snap['remainingPercentage']);
        const pct = Number.isFinite(remaining) ? `${(remaining * 100).toFixed(1)}%` : '?';
        println(
            `  ${color}${name}\x1b[0m  restante=\x1b[33m${pct}\x1b[0m  reset=\x1b[90m${snap['resetDate'] ?? '-'}\x1b[0m`,
        );
    }
    if (Object.keys(snapshots).length === 0) println('  \x1b[90mSem snapshots de quota no retorno SDK.\x1b[0m');
    if (!opts.compact) println('');
}

/**
 * @param {CommandContext} ctx
 * @param {string | null | undefined} runtimeId
 * @returns {Promise<void>}
 */
async function renderSdkSystemPrompt({ println }, runtimeId) {
    const projection = await callWithRuntimeTarget(readTerminalSdkSystemPromptProjection, runtimeId);
    const unified = objectOrNull(projection['projection']) ?? {};
    const status = objectOrNull(unified['status']) ?? objectOrNull(projection['systemPrompt']) ?? {};
    const binding = objectOrNull(unified['binding']) ?? objectOrNull(projection['binding']) ?? {};
    const freshness = objectOrNull(unified['freshness']) ?? objectOrNull(projection['freshness']) ?? {};
    const session = objectOrNull(unified['session']) ?? {};
    const sourcesEnvelope = objectOrNull(unified['instructionSources']) ?? {};
    const sections = Array.isArray(status['sections']) ? status['sections'] : [];
    const appendFiles = Array.isArray(status['appendFiles']) ? status['appendFiles'] : [];
    const sdkCompatibility =
        objectOrNull(unified['sdkCompatibility']) ?? objectOrNull(status['sdkCompatibility']) ?? {};
    const revision = objectOrNull(status['revision']) ?? {};
    const limitations = Array.isArray(status['limitations']) ? status['limitations'] : [];
    const instructionSources = sourcesEnvelope['value'] ?? projection['instructionSources'];
    const instructionSourcesError = sourcesEnvelope['error'] ?? projection['instructionSourcesError'];
    const sessionId = typeof session['id'] === 'string' ? session['id'] : projection['sessionId'];
    const sessionAvailable =
        typeof session['available'] === 'boolean' ? session['available'] : Boolean(projection['sessionAvailable']);

    println('\n  \x1b[36mSystem Prompt SDK\x1b[0m');
    println(
        `  mode     \x1b[33m${String(status['effectiveMode'] ?? '?')}\x1b[0m  live=\x1b[33m${String(status['effectiveLiveMode'] ?? '?')}\x1b[0m  reload=\x1b[33m${String(status['liveReloadMechanism'] ?? '?')}\x1b[0m`,
    );
    println(
        `  config   \x1b[90m${String(status['configPath'] ?? '-')}\x1b[0m  autoReload=\x1b[33m${String(status['autoReload'] ?? false)}\x1b[0m`,
    );
    println(
        `  sdk      \x1b[90mcustomize=${String(sdkCompatibility['supportsCustomizeMode'] ?? false)} · sourcesRpc=${String(sdkCompatibility['supportsInstructionSourcesRpc'] ?? false)}\x1b[0m`,
    );
    println(
        `  digest   \x1b[90m${String(revision['digest'] ?? '-')}\x1b[0m  sections=\x1b[33m${sections.length}\x1b[0m  appendFiles=\x1b[33m${appendFiles.length}\x1b[0m`,
    );
    println(
        `  session  \x1b[90m${String(sessionId ?? '-')}\x1b[0m  sources=\x1b[33m${sessionAvailable ? 'available' : 'none'}\x1b[0m`,
    );
    println(
        `  binding  \x1b[90m${String(binding['digest'] ?? '-')}\x1b[0m  stale=\x1b[33m${String(Boolean(freshness['isStale']))}\x1b[0m  action=\x1b[33m${String(freshness['recommendedAction'] ?? 'none')}\x1b[0m`,
    );

    if (freshness['reason']) {
        println(`  \x1b[90m${String(freshness['reason'])}[0m`);
    }

    if (limitations.length > 0) {
        println('  \x1b[36mLimitações\x1b[0m');
        for (const limitation of limitations.slice(0, 4)) {
            println(`  \x1b[90m• ${String(limitation)}\x1b[0m`);
        }
    }

    if (instructionSources) {
        println(`  \x1b[36mInstruction sources\x1b[0m\n  \x1b[90m${pretty(instructionSources, 1200)}\x1b[0m`);
    } else if (instructionSourcesError) {
        println(`  \x1b[33mInstruction sources indisponíveis:\x1b[0m ${String(instructionSourcesError)}`);
    }

    println('');
}

/**
 * @param {CommandContext} ctx
 * @param {string} [arg]
 * @returns {Promise<void>}
 */
export async function cmdWorkspace({ println }, arg = '') {
    const { runtimeId, arg: cleanArg } = extractRuntimeTarget(arg);
    const [sub = 'list', ...rest] = cleanArg.trim().split(/\s+/).filter(Boolean);
    try {
        if (sub === 'read') {
            const path = rest.join(' ').trim();
            if (!path) {
                println('\x1b[33m  Uso: /workspace read <path>\x1b[0m');
                return;
            }
            const result = await callWithRuntimeTarget(readTerminalSdkWorkspaceFile, runtimeId, path);
            println(
                `\n  \x1b[36m${path}\x1b[0m  \x1b[90m(SDK virtual; não FS local)\x1b[0m\n${pretty(result, 4000)}\n`,
            );
        } else if (sub === 'write') {
            const path = rest.shift();
            const content = rest.join(' ');
            if (!path || !content) {
                println('\x1b[33m  Uso: /workspace write <path> <content>\x1b[0m');
                return;
            }
            const result = await callWithRuntimeTarget(createTerminalSdkWorkspaceFile, runtimeId, path, content);
            println(`\n  \x1b[32m✓ Arquivo escrito no workspace SDK virtual:\x1b[0m \x1b[33m${path}\x1b[0m`);
            println(`  \x1b[90m${pretty(result, 500)}\x1b[0m\n`);
        } else if (sub === 'sync' || sub === 'materialize') {
            const sourcePath = rest[0] ?? '';
            if (!sourcePath.trim()) {
                println('\x1b[33m  Uso: /workspace sync <sdkPath> [--to <localPath>] [--overwrite]\x1b[0m');
                return;
            }
            const flags = parseWorkspaceMaterializeFlags(rest.slice(1));
            const destinationPath = flags.to ?? sourcePath;
            const readResult = await callWithRuntimeTarget(readTerminalSdkWorkspaceFile, runtimeId, sourcePath);
            const content = workspaceReadContent(readResult);
            if (content === null) {
                println('\n  \x1b[31m✗ Workspace SDK: conteúdo não textual/indisponível para materialização.\x1b[0m');
                println(`  \x1b[90m${pretty(readResult, 900)}\x1b[0m\n`);
                await renderCommandFailureGuidance(println, runtimeId);
                return;
            }

            const writeResult = await materializeWorkspaceFile(
                { println },
                {
                    destinationPath,
                    content,
                    overwrite: flags.overwrite,
                },
            );
            if (writeResult['success'] !== true) {
                println(
                    `\n  \x1b[31m✗ Materialização SDK→FS falhou:\x1b[0m ${String(writeResult['error'] ?? 'erro desconhecido')}`,
                );
                println(
                    '  \x1b[90mUse --overwrite para substituir arquivo local já existente quando apropriado.\x1b[0m\n',
                );
                await renderCommandFailureGuidance(println, runtimeId);
                return;
            }

            println(
                `\n  \x1b[32m✓ SDK→FS materializado:\x1b[0m \x1b[33m${sourcePath}\x1b[0m → \x1b[33m${destinationPath}\x1b[0m`,
            );
            const io = ioSummary(writeResult);
            if (io) println(`  \x1b[90m${io}\x1b[0m`);
            println(`  \x1b[90mbytes=${String(writeResult['bytesWritten'] ?? content.length)}\x1b[0m\n`);
        } else if (sub === 'mirror' || sub === 'sync-all') {
            const flags = parseWorkspaceMaterializeFlags(rest);
            const targetRoot = flags.to ?? '.copilot/sdk-workspace-mirror';
            const listResult = await callWithRuntimeTarget(listTerminalSdkWorkspaceFiles, runtimeId);
            const files = workspaceListPaths(listResult);
            if (files.length === 0) {
                println('\n  \x1b[33mWorkspace SDK virtual vazio ou sem paths materializáveis.\x1b[0m');
                println(`  \x1b[90m${pretty(listResult, 900)}\x1b[0m\n`);
                return;
            }

            let ok = 0;
            let fail = 0;
            for (const sourcePath of files) {
                const readResult = await callWithRuntimeTarget(readTerminalSdkWorkspaceFile, runtimeId, sourcePath);
                const content = workspaceReadContent(readResult);
                if (content === null) {
                    fail += 1;
                    println(`  \x1b[31m✗ skip\x1b[0m ${sourcePath} (conteúdo não textual)`);
                    continue;
                }
                const destinationPath = `${targetRoot.replace(/\/$/u, '')}/${sourcePath}`;
                const writeResult = await materializeWorkspaceFile(
                    { println },
                    { destinationPath, content, overwrite: flags.overwrite },
                );
                if (writeResult['success'] === true) {
                    ok += 1;
                    println(`  \x1b[32m✓\x1b[0m ${sourcePath} ? ${destinationPath}`);
                } else {
                    fail += 1;
                    println(`  \x1b[31m✗\x1b[0m ${sourcePath} (${String(writeResult['error'] ?? 'erro')})`);
                }
            }

            println(
                `\n  \x1b[36mMirror SDK→FS concluído\x1b[0m  \x1b[90mok=${ok} · fail=${fail} · root=${targetRoot}\x1b[0m\n`,
            );
        } else if (sub === 'promote' || sub === 'push' || sub === 'import') {
            const sourcePath = rest[0] ?? '';
            if (!sourcePath.trim()) {
                println('\x1b[33m  Uso: /workspace promote <localPath> [--to <sdkPath>] [--overwrite]\x1b[0m');
                return;
            }
            const flags = parseWorkspaceMaterializeFlags(rest.slice(1));
            const destinationPath = flags.to ?? sourcePath;
            const result = await promoteLocalFileToWorkspace(
                { println },
                {
                    sourcePath,
                    destinationPath,
                    overwrite: flags.overwrite,
                    runtimeId,
                },
            );
            if (!result.ok) {
                println(`\n  \x1b[31m✗ Promoção FS→SDK falhou:\x1b[0m ${result.reason}`);
                if (result.conflict) {
                    println(
                        '  \x1b[90mpolítica=fail-if-exists · ação=conflict · use --overwrite com intenção explícita\x1b[0m',
                    );
                }
                println(`  \x1b[90mtraceId=${result.traceId}\x1b[0m\n`);
                await renderCommandFailureGuidance(println, runtimeId);
                return;
            }

            println(
                `\n  \x1b[32m✓ FS→SDK promovido:\x1b[0m \x1b[33m${sourcePath}\x1b[0m → \x1b[33m${destinationPath}\x1b[0m`,
            );
            println(
                `  \x1b[90mpolítica=${flags.overwrite ? 'overwrite' : 'fail-if-exists'} · ação=${result.action} · bytes=${result.bytes} · traceId=${result.traceId}\x1b[0m\n`,
            );
        } else {
            const result = await callWithRuntimeTarget(listTerminalSdkWorkspaceFiles, runtimeId);
            const files = arrayFromSdkList(result);
            println(`\n  \x1b[36mWorkspace SDK virtual (${files.length || 'retorno bruto'})\x1b[0m`);
            if (files.length > 0) {
                for (const file of files.slice(0, 80)) {
                    const f = objectOrNull(file) ?? {};
                    println(`  \x1b[33m${String(f['path'] ?? f['name'] ?? file)}\x1b[0m`);
                }
                if (files.length > 80) println(`  \x1b[90m… ${files.length - 80} arquivos omitidos\x1b[0m`);
            } else {
                println(`  \x1b[90m${pretty(result, 1500)}\x1b[0m`);
            }
            println('  \x1b[90mUso: /workspace list | read <path> | write <path> <content>\x1b[0m');
            println(
                '  \x1b[90m     /workspace sync <sdkPath> [--to <localPath>] [--overwrite] · /workspace mirror [--to <localDir>] [--overwrite]\x1b[0m',
            );
            println('  \x1b[90m     /workspace promote <localPath> [--to <sdkPath>] [--overwrite]\x1b[0m');
            println(
                '  \x1b[90mObs: list/read/write operam no workspace SDK virtual; sync/mirror materializam no FS local canônico; promote faz FS→SDK com auditoria.\x1b[0m\n',
            );
        }
    } catch (e) {
        println(`\n  \x1b[31m✗ Workspace SDK: ${toError(e).message}\x1b[0m`);
        await renderCommandFailureGuidance(println, runtimeId);
        println('');
    }
}

/**
 * @param {CommandContext} ctx
 * @param {string} [arg]
 * @returns {Promise<void>}
 */
export async function cmdElicitation({ println }, arg = '') {
    const { runtimeId, arg: cleanArg } = extractRuntimeTarget(arg);
    const [sub = 'list', ...rest] = cleanArg.trim().split(/\s+/).filter(Boolean);
    try {
        if (sub === 'confirm') {
            const message = rest.join(' ').trim() || 'Confirma?';
            const result = await callWithRuntimeTarget(confirmTerminalSdkSessionUi, runtimeId, message);
            println(`\n  \x1b[32m✓ session.ui.confirm concluído.\x1b[0m\n  \x1b[90m${String(result)}\x1b[0m\n`);
        } else if (sub === 'select') {
            const { left, right } = splitAtDoubleDash(rest);
            const message = left.join(' ').trim() || 'Selecione uma opção';
            const options = right
                .join(' ')
                .split('|')
                .map((item) => item.trim())
                .filter(Boolean);
            if (options.length === 0) {
                println('\x1b[33m  Uso: /elicitation select <mensagem> -- opcao1|opcao2|opcao3\x1b[0m');
                return;
            }
            const result = await callWithRuntimeTarget(selectTerminalSdkSessionUi, runtimeId, message, options);
            println(`\n  \x1b[32m✓ session.ui.select concluído.\x1b[0m\n  \x1b[90m${String(result)}\x1b[0m\n`);
        } else if (sub === 'input') {
            const { left, right } = splitAtDoubleDash(rest);
            const message = left.join(' ').trim() || 'Informe um valor';
            const parsed = parseJsonObject(right);
            if (parsed.error) {
                println(`\x1b[31m  JSON inválido: ${parsed.error}\x1b[0m`);
                return;
            }
            const result = await callWithRuntimeTarget(
                inputTerminalSdkSessionUi,
                runtimeId,
                message,
                /** @type {import('../../presentation/types.js').RuntimeInputOptions | undefined} */ (
                    parsed.json ?? undefined
                ),
            );
            println(`\n  \x1b[32m✓ session.ui.input concluído.\x1b[0m\n  \x1b[90m${String(result)}\x1b[0m\n`);
        } else if (sub === 'capabilities') {
            const available = callWithRuntimeTarget(isTerminalSdkSessionUiElicitationAvailable, runtimeId);
            const ok = available;
            println(`\n  \x1b[36mSession UI\x1b[0m`);
            println(`  elicitation  ${ok ? '\x1b[32mavailable\x1b[0m' : '\x1b[33munavailable\x1b[0m'}`);
            println('');
        } else if (sub === 'show') {
            renderElicitationEntry({ println }, getTerminalElicitation(rest[0] || 'latest', { runtimeId }));
        } else if (sub === 'clear') {
            const ok = clearTerminalElicitation(rest[0] || 'latest');
            println(
                ok
                    ? '\x1b[32m  Elicitation removida da UX local.\x1b[0m'
                    : '\x1b[33m  Elicitation não encontrada.\x1b[0m',
            );
        } else if (sub === 'respond') {
            const [id = 'latest', action, ...jsonRest] = rest;
            const entry = getTerminalElicitation(id, { runtimeId });
            if (!entry) {
                println('\x1b[33m  Elicitation não encontrada.\x1b[0m');
                return;
            }
            const parsedResult = parseElicitationResult(action, jsonRest, entry.requestedSchema);
            if (!parsedResult.ok) {
                println(`\x1b[31m  Resposta inválida: ${parsedResult.error}\x1b[0m`);
                return;
            }
            const resolved = callWithRuntimeTarget(
                resolveTerminalSdkPendingElicitation,
                runtimeId,
                entry.id,
                parsedResult.result,
            );
            const ok = resolved;
            println(
                ok
                    ? `\n  \x1b[32m✓ Elicitation respondida.\x1b[0m \x1b[90m${entry.id}\x1b[0m\n`
                    : `\n  \x1b[33mElicitation não está mais pendente.\x1b[0m \x1b[90m${entry.id}\x1b[0m\n`,
            );
        } else if (sub === 'request') {
            const message = rest.join(' ').trim() || 'Informe os dados solicitados.';
            const result = await callWithRuntimeTarget(
                requestTerminalSdkElicitation,
                runtimeId,
                message,
                defaultElicitationSchema(),
            );
            println(`\n  \x1b[32m✓ Elicitation SDK concluída.\x1b[0m\n  \x1b[90m${pretty(result, 1500)}\x1b[0m\n`);
        } else if (sub === 'request-json') {
            const { left, right } = splitAtDoubleDash(rest);
            const message =
                (right.length > 0 ? left.join(' ').trim() : rest.shift()) ?? 'Informe os dados solicitados.';
            const parsed = parseJsonObject(right.length > 0 ? right : rest);
            if (parsed.error || !parsed.json) {
                println(`\x1b[31m  JSON inválido: ${parsed.error ?? 'schema ausente'}\x1b[0m`);
                return;
            }
            if (!isRuntimeElicitationSchema(parsed.json)) {
                println('\x1b[31m  Schema inválido: esperado { "type": "object", "properties": { ... } }.\x1b[0m');
                return;
            }
            const result = await callWithRuntimeTarget(requestTerminalSdkElicitation, runtimeId, message, parsed.json);
            println(`\n  \x1b[32m✓ Elicitation SDK concluída.\x1b[0m\n  \x1b[90m${pretty(result, 1500)}\x1b[0m\n`);
        } else {
            const entries = listTerminalElicitations({ includeCompleted: sub === 'all', runtimeId });
            if (entries.length === 0) {
                println('\n  \x1b[90mNenhuma elicitation pendente na UX local.\x1b[0m');
            } else {
                println(`\n  \x1b[36mElicitations SDK (${entries.length})\x1b[0m`);
                for (const entry of entries) {
                    const statusColor = entry.status === 'pending' ? '\x1b[33m' : '\x1b[90m';
                    println(
                        `  ${statusColor}${entry.id}\x1b[0m  ${entry.mode}${entry.actionable ? '  \x1b[32m[actionable]\x1b[0m' : ''}  ${entry.message.slice(0, 90)}${entry.source ? `  \x1b[90mvia ${entry.source}\x1b[0m` : ''}`,
                    );
                }
            }
            println(
                '  \x1b[90mUso: /elicitation [list|all|capabilities|confirm <msg>|select <msg> -- a|b|c|input <msg> -- {json}|show latest|clear <id>|request <msg>|request-json <msg> -- <schemaJson>|respond <id> <accept|decline|cancel> [json]]\x1b[0m',
            );
            println(
                '  \x1b[90mask_user = conversa READY/REPLY; elicitation = formulário/URL estruturado do SDK; confirm/select/input = conveniências de session.ui.*.\x1b[0m\n',
            );
        }
    } catch (e) {
        println(`\n  \x1b[31m✗ Elicitation SDK: ${toError(e).message}\x1b[0m\n`);
    }
}

/**
 * @param {CommandContext} ctx
 * @param {string} [arg]
 * @returns {Promise<void>}
 */
export async function cmdPermission({ println }, arg = '') {
    const { runtimeId, arg: cleanArg } = extractRuntimeTarget(arg);
    const [sub = 'list', ...rest] = cleanArg.trim().split(/\s+/).filter(Boolean);
    if (sub === 'mode') {
        const next = rest[0];
        if (!next) {
            const current = readTerminalRuntimePermissionMode(runtimeId);
            println(`\n  \x1b[36mPermission mode\x1b[0m  \x1b[33m${current}\x1b[0m`);
            println('  \x1b[90mUso: /permission mode <approve_all|audit_only|selective>\x1b[0m\n');
            return;
        }
        if (next !== 'approve_all' && next !== 'audit_only' && next !== 'selective') {
            println('  \x1b[33mUso: /permission mode <approve_all|audit_only|selective>\x1b[0m');
            return;
        }
        const updated = setTerminalRuntimePermissionMode(next, runtimeId);
        println(`\n  \x1b[32m✓ Permission mode atualizado:\x1b[0m \x1b[33m${updated}\x1b[0m\n`);
        return;
    }
    if (sub === 'show') {
        renderPermissionEntry({ println }, getTerminalPermission(rest[0] || 'latest', { runtimeId }));
        return;
    }
    if (sub === 'respond' || sub === 'resolve') {
        const idArg = rest[0];
        const actionArg = rest[1];
        const payloadArg = rest.slice(2).join(' ').trim();
        const entry = getTerminalPermission(idArg || 'latest', { runtimeId });
        if (!entry || !entry.requestId) {
            println('  \x1b[33mPermissão não encontrada ou sem requestId canônico para responder.\x1b[0m');
            return;
        }
        const decision = parsePermissionDecision(actionArg);
        if (!decision) {
            println(
                '  \x1b[33mUso: /permission respond <id|latest> <approve-once|approve-for-session|approve-for-location|reject|user-not-available> [json]\x1b[0m',
            );
            return;
        }
        /** @type {Record<string, unknown>} */
        let payload = {};
        if (payloadArg) {
            try {
                const parsed = JSON.parse(payloadArg);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    println('  \x1b[33mPayload opcional deve ser um JSON object.\x1b[0m');
                    return;
                }
                payload = /** @type {Record<string, unknown>} */ (parsed);
            } catch (error) {
                println(`  \x1b[31mJSON inválido:\x1b[0m ${error instanceof Error ? error.message : String(error)}`);
                return;
            }
        }
        const permissionResult = /** @type {{ kind: string } & Record<string, unknown>} */ ({
            ...decision,
            ...payload,
        });
        const validationError = validatePermissionDecisionResult(permissionResult);
        if (validationError) {
            println(`  \x1b[33m${validationError}\x1b[0m`);
            return;
        }
        const result = await handleTerminalSdkPendingPermission(entry.requestId, permissionResult, runtimeId);
        recordTerminalPermissionCompleted({
            requestId: entry.requestId,
            permissionType: entry.permissionType,
            result: decision.kind,
            granted: decision.kind !== 'reject' && decision.kind !== 'user-not-available',
            ts: Date.now(),
        });
        println(
            `\n  \x1b[32m✓ Resposta de permissão enviada:\x1b[0m \x1b[90m${entry.requestId}\x1b[0m · ${decision.kind}`,
        );
        println(`  \x1b[90m${pretty(result, 700)}\x1b[0m\n`);
        return;
    }
    if (sub === 'pending') {
        const remote = await callWithRuntimeTarget(listTerminalSdkPendingPermissions, runtimeId);
        const resolvedRuntimeId = readTerminalRuntimeState(runtimeId).runtimeId;
        if (!remote.available) {
            println('\n  \x1b[33mListagem ativa de permissões pendentes indisponível no SDK atual.\x1b[0m');
            println('  \x1b[90mFallback operacional: usando estado observado local (/permission list).\x1b[0m\n');
        } else {
            const requests = Array.isArray(remote.requests) ? remote.requests : [];
            println(`\n  \x1b[36mPermissões pendentes via RPC (${requests.length})\x1b[0m`);
            println(`  \x1b[90msource: ${remote.source ?? 'unknown'}\x1b[0m`);
            if (requests.length === 0) {
                println('  \x1b[32mNenhuma permissão pendente reportada pela sessão SDK.\x1b[0m\n');
                return;
            }
            for (const item of requests) {
                const obj = objectOrNull(item) ?? {};
                const requestId =
                    (typeof obj['requestId'] === 'string' && obj['requestId']) ||
                    (typeof obj['id'] === 'string' && obj['id']) ||
                    'unknown';
                const permissionType =
                    (typeof obj['permissionType'] === 'string' && obj['permissionType']) ||
                    (typeof obj['type'] === 'string' && obj['type']) ||
                    'unknown';
                recordTerminalPermissionRequested({
                    data: {
                        ...obj,
                        requestId,
                        permissionType,
                        runtimeId: resolvedRuntimeId,
                        source: remote.source ?? 'permissions.listPending',
                    },
                    runtimeId: resolvedRuntimeId,
                    ts: Date.now(),
                });
                println(`  \x1b[33m${requestId}\x1b[0m  ${permissionType}`);
            }
            println('');
            return;
        }
    }
    if (sub === 'cockpit' || sub === 'panel') {
        renderPermissionCockpit({ println }, runtimeId);
        return;
    }
    if (sub === 'clear') {
        const ok = clearTerminalPermission(rest[0] || 'latest');
        println(ok ? '\x1b[32m  Permissão removida da UX local.\x1b[0m' : '\x1b[33m  Permissão não encontrada.\x1b[0m');
        return;
    }

    const entries = listTerminalPermissions({ includeCompleted: sub === 'all', runtimeId });
    if (entries.length === 0) {
        println('\n  \x1b[90mNenhuma permissão SDK pendente na UX local.\x1b[0m');
    } else {
        println(`\n  \x1b[36mPermissões SDK (${entries.length})\x1b[0m`);
        for (const entry of entries) {
            const statusColor =
                entry.status === 'pending' ? '\x1b[33m' : entry.granted === false ? '\x1b[31m' : '\x1b[90m';
            const result = entry.granted == null ? entry.result : entry.granted ? 'approved' : 'not-approved';
            println(
                `  ${statusColor}${entry.id}\x1b[0m  ${entry.permissionType}  \x1b[90m${entry.status}${result ? ` · ${result}` : ''}\x1b[0m`,
            );
        }
    }
    println(
        '  \x1b[90mUso: /permission [list|pending|cockpit|all|show latest|clear <id>|clear all|mode [approve_all|audit_only|selective]|respond <id> <decision> [json]]\x1b[0m',
    );
    println('  \x1b[90mPermissões são decididas pelo SDK/hook; este comando é observabilidade operacional.\x1b[0m\n');
}

/**
 * @param {CommandContext} ctx
 * @param {ReturnType<typeof getTerminalElicitation>} entry
 * @returns {void}
 */
function renderElicitationEntry({ println }, entry) {
    if (!entry) {
        println('\x1b[33m  Elicitation não encontrada.\x1b[0m');
        return;
    }
    println(`\n  \x1b[36mElicitation ${entry.id}\x1b[0m`);
    println(`  status  \x1b[33m${entry.status}\x1b[0m`);
    println(`  mode    \x1b[33m${entry.mode}\x1b[0m`);
    println(`  msg     ${entry.message}`);
    if (entry.url) println(`  url     \x1b[36m${entry.url}\x1b[0m`);
    if (entry.source) println(`  source  \x1b[90m${entry.source}\x1b[0m`);
    if (entry.toolCallId) println(`  tool    \x1b[90m${entry.toolCallId}\x1b[0m`);
    if (entry.actionable) println('  action  \x1b[32mrespondível pelo runtime\x1b[0m');
    if (entry.resultAction) println(`  result  \x1b[33m${entry.resultAction}\x1b[0m`);
    if (entry.resultContent) println(`\n  result content:\n${pretty(entry.resultContent, 2500)}`);
    if (entry.requestedSchema) println(`\n  schema:\n${pretty(entry.requestedSchema, 2500)}`);
    println(
        entry.actionable
            ? '\n  \x1b[90mResponda com /elicitation respond <id> <accept|decline|cancel> [json]\x1b[0m\n'
            : '',
    );
}

/**
 * @param {CommandContext} ctx
 * @param {ReturnType<typeof getTerminalPermission>} entry
 * @returns {void}
 */
function renderPermissionEntry({ println }, entry) {
    if (!entry) {
        println('\x1b[33m  Permissão não encontrada.\x1b[0m');
        return;
    }
    println(`\n  \x1b[36mPermissão ${entry.id}\x1b[0m`);
    println(`  status  \x1b[33m${entry.status}\x1b[0m`);
    println(`  type    \x1b[33m${entry.permissionType}\x1b[0m`);
    if (entry.requestId) println(`  request \x1b[90m${entry.requestId}\x1b[0m`);
    if (entry.granted !== null) println(`  granted \x1b[33m${String(entry.granted)}\x1b[0m`);
    if (entry.result) println(`  result  \x1b[33m${entry.result}\x1b[0m`);
    println(`  created \x1b[90m${new Date(entry.createdAt).toISOString()}\x1b[0m`);
    if (entry.completedAt) println(`  done    \x1b[90m${new Date(entry.completedAt).toISOString()}\x1b[0m`);
    if (entry.status === 'pending' && entry.requestId) {
        println(
            '  \x1b[90mAção: /permission respond <id> <approve-once|approve-for-session|approve-for-location|reject|user-not-available>\x1b[0m',
        );
    }
    println(`\n  data:\n${pretty(entry.data, 2500)}\n`);
}

/**
 * @param {CommandContext} ctx
 * @param {string | null | undefined} runtimeId
 * @returns {void}
 */
function renderPermissionCockpit({ println }, runtimeId) {
    const scopedRuntimeId = runtimeId ?? null;
    const pending = listTerminalPermissions({ runtimeId: scopedRuntimeId });
    const byType = new Map();
    for (const entry of pending) {
        const key = entry.permissionType || 'unknown';
        byType.set(key, (byType.get(key) ?? 0) + 1);
    }
    const typeRows = [...byType.entries()].sort((a, b) => b[1] - a[1]);
    const latest = readTerminalPermissionSummary({ runtimeId: scopedRuntimeId }).latest;
    const modeChanges = listTerminalPermissionModeHistory({ limit: 4 });

    println('\n  \x1b[36mPermission cockpit\x1b[0m');
    println(`  pendentes  \x1b[33m${pending.length}\x1b[0m`);
    if (latest) {
        println(
            `  latest     \x1b[90m${latest.id}\x1b[0m ${latest.permissionType}${latest.requestId ? ` · requestId=${latest.requestId}` : ''}`,
        );
    } else {
        println('  latest     \x1b[90m(nenhuma permissão observada)\x1b[0m');
    }

    if (typeRows.length > 0) {
        println('  por tipo   \x1b[90m' + typeRows.map(([type, count]) => `${type}=${count}`).join(' · ') + '\x1b[0m');
    } else {
        println('  por tipo   \x1b[90m(nenhuma pendência)\x1b[0m');
    }

    if (modeChanges.length > 0) {
        println('  mode log');
        for (const item of modeChanges) {
            println(`    \x1b[90m${new Date(item.ts).toLocaleTimeString('pt-BR')}\x1b[0m  ${item.mode}`);
        }
    } else {
        println('  mode log   \x1b[90m(sem mudanças recentes no runtime local)\x1b[0m');
    }

    println('  quick      \x1b[90m/permission pending · /permission show latest · /permission mode selective\x1b[0m');
    if (latest?.requestId && latest.status === 'pending') {
        println(`  quick      \x1b[90m/permission respond ${latest.id} approve-once\x1b[0m`);
    }
    println('');
}
