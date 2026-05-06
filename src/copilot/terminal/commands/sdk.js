// @ts-check
/**
 * Comandos SDK-first do terminal LLM-B.
 *
 * @module copilot/terminal/commands/sdk
 */

import { toError } from '#copilot/core';
import { isRuntimeElicitationSchema, normalizeElicitationContentWithSchema } from '../../core/elicitation-schema.js';
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
    listTerminalPermissions,
    readTerminalElicitationSummary,
    readTerminalPermissionSummary,
    readTerminalUserInputSummary,
    recordTerminalPermissionCompleted,
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
 * @returns {void}
 */
function renderSdkWaitsSummary({ println }) {
    const pendingElicitations = readTerminalElicitationSummary();
    const permissionSummary = readTerminalPermissionSummary();
    const userInputSummary = readTerminalUserInputSummary();
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
        } else if (sub === 'capabilities' || sub === 'caps') {
            renderSdkCapabilitiesSummary({ println }, runtimeId);
        } else if (sub === 'waits') {
            renderSdkWaitsSummary({ println });
        } else if (sub === 'compact') {
            const result = await callWithRuntimeTarget(compactTerminalSdkSession, runtimeId);
            println(`\n  \x1b[32m✓ SDK compaction solicitada.\x1b[0m\n  \x1b[90m${pretty(result, 700)}\x1b[0m\n`);
        } else {
            const state = readTerminalRuntimeState(runtimeId);
            const pendingElicitations = readTerminalElicitationSummary();
            const permissionSummary = readTerminalPermissionSummary();
            const userInputSummary = readTerminalUserInputSummary();
            println('\n  \x1b[36mSDK Runtime\x1b[0m');
            println(`  runtime  \x1b[90m${state.runtimeId}\x1b[0m`);
            println(`  session  \x1b[90m${state.sessionId ?? '-'}\x1b[0m`);
            println(`  model    \x1b[33m${state.model}\x1b[0m  reasoning=\x1b[33m${state.reasoningEffort}\x1b[0m`);
            println(
                `  waits    \x1b[90melicitation=${pendingElicitations.pending}${pendingElicitations.latest?.mode ? ` (${pendingElicitations.latest.mode})` : ''} · permission=${permissionSummary.pending}${permissionSummary.latest ? ` (${permissionSummary.latest.permissionType})` : ''} · ask_user=${userInputSummary.pending}${userInputSummary.latest?.kind ? ` (${userInputSummary.latest.kind})` : ''}\x1b[0m`,
            );
            await renderSdkQuota({ println }, runtimeId, { compact: true });
            println(
                '  \x1b[90mUso: /sdk models | /sdk tools [model] | /sdk quota | /sdk prompt | /sdk capabilities | /sdk waits | /sdk compact\x1b[0m\n',
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
    const status = objectOrNull(projection['systemPrompt']) ?? {};
    const binding = objectOrNull(projection['binding']) ?? {};
    const freshness = objectOrNull(projection['freshness']) ?? {};
    const sections = Array.isArray(status['sections']) ? status['sections'] : [];
    const appendFiles = Array.isArray(status['appendFiles']) ? status['appendFiles'] : [];
    const sdkCompatibility = objectOrNull(status['sdkCompatibility']) ?? {};
    const revision = objectOrNull(status['revision']) ?? {};
    const limitations = Array.isArray(status['limitations']) ? status['limitations'] : [];

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
        `  session  \x1b[90m${String(projection['sessionId'] ?? '-')}\x1b[0m  sources=\x1b[33m${projection['sessionAvailable'] ? 'available' : 'none'}\x1b[0m`,
    );
    println(
        `  binding  \x1b[90m${String(binding['digest'] ?? '-')}[0m  stale=\x1b[33m${String(Boolean(freshness['isStale']))}[0m  action=\x1b[33m${String(freshness['recommendedAction'] ?? 'none')}[0m`,
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

    if (projection['instructionSources']) {
        println(
            `  \x1b[36mInstruction sources\x1b[0m\n  \x1b[90m${pretty(projection['instructionSources'], 1200)}\x1b[0m`,
        );
    } else if (projection['instructionSourcesError']) {
        println(`  \x1b[33mInstruction sources indisponíveis:\x1b[0m ${String(projection['instructionSourcesError'])}`);
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
            println(`\n  \x1b[36m${path}\x1b[0m\n${pretty(result, 4000)}\n`);
        } else if (sub === 'write') {
            const path = rest.shift();
            const content = rest.join(' ');
            if (!path || !content) {
                println('\x1b[33m  Uso: /workspace write <path> <content>\x1b[0m');
                return;
            }
            const result = await callWithRuntimeTarget(createTerminalSdkWorkspaceFile, runtimeId, path, content);
            println(`\n  \x1b[32m✓ Arquivo escrito no workspace SDK:\x1b[0m \x1b[33m${path}\x1b[0m`);
            println(`  \x1b[90m${pretty(result, 500)}\x1b[0m\n`);
        } else {
            const result = await callWithRuntimeTarget(listTerminalSdkWorkspaceFiles, runtimeId);
            const files = arrayFromSdkList(result);
            println(`\n  \x1b[36mWorkspace SDK (${files.length || 'retorno bruto'})\x1b[0m`);
            if (files.length > 0) {
                for (const file of files.slice(0, 80)) {
                    const f = objectOrNull(file) ?? {};
                    println(`  \x1b[33m${String(f['path'] ?? f['name'] ?? file)}\x1b[0m`);
                }
                if (files.length > 80) println(`  \x1b[90m… ${files.length - 80} arquivos omitidos\x1b[0m`);
            } else {
                println(`  \x1b[90m${pretty(result, 1500)}\x1b[0m`);
            }
            println('  \x1b[90mUso: /workspace list | read <path> | write <path> <content>\x1b[0m\n');
        }
    } catch (e) {
        println(`\n  \x1b[31m✗ Workspace SDK: ${toError(e).message}\x1b[0m\n`);
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
            renderElicitationEntry({ println }, getTerminalElicitation(rest[0] || 'latest'));
        } else if (sub === 'clear') {
            const ok = clearTerminalElicitation(rest[0] || 'latest');
            println(
                ok
                    ? '\x1b[32m  Elicitation removida da UX local.\x1b[0m'
                    : '\x1b[33m  Elicitation não encontrada.\x1b[0m',
            );
        } else if (sub === 'respond') {
            const [id = 'latest', action, ...jsonRest] = rest;
            const entry = getTerminalElicitation(id);
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
            const entries = listTerminalElicitations({ includeCompleted: sub === 'all' });
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
        renderPermissionEntry({ println }, getTerminalPermission(rest[0] || 'latest'));
        return;
    }
    if (sub === 'respond' || sub === 'resolve') {
        const idArg = rest[0];
        const actionArg = rest[1];
        const payloadArg = rest.slice(2).join(' ').trim();
        const entry = getTerminalPermission(idArg || 'latest');
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
        const result = await handleTerminalSdkPendingPermission(
            entry.requestId,
            /** @type {{ kind: string } & Record<string, unknown>} */ ({ kind: decision.kind, ...payload }),
            runtimeId,
        );
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
    if (sub === 'clear') {
        const ok = clearTerminalPermission(rest[0] || 'latest');
        println(ok ? '\x1b[32m  Permissão removida da UX local.\x1b[0m' : '\x1b[33m  Permissão não encontrada.\x1b[0m');
        return;
    }

    const entries = listTerminalPermissions({ includeCompleted: sub === 'all' });
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
        '  \x1b[90mUso: /permission [list|all|show latest|clear <id>|clear all|mode [approve_all|audit_only|selective]|respond <id> <decision> [json]]\x1b[0m',
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
