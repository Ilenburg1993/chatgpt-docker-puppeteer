// @ts-check
/**
 * Comandos SDK-first do terminal LLM-B.
 *
 * @module copilot/terminal/commands/sdk
 */

import { toError } from '#copilot/core';
import {
    compactTerminalSdkSession,
    createTerminalSdkWorkspaceFile,
    getTerminalSdkQuota,
    listTerminalSdkModels,
    listTerminalSdkTools,
    listTerminalSdkWorkspaceFiles,
    readTerminalRuntimeState,
    readTerminalSdkWorkspaceFile,
    requestTerminalSdkElicitation,
} from '../frontend/llm-b-runtime.js';
import {
    classifyTerminalSdkQuota,
    clearTerminalElicitation,
    getTerminalElicitation,
    listTerminalElicitations,
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
        } else if (sub === 'compact') {
            const result = await callWithRuntimeTarget(compactTerminalSdkSession, runtimeId);
            println(`\n  \x1b[32m✓ SDK compaction solicitada.\x1b[0m\n  \x1b[90m${pretty(result, 700)}\x1b[0m\n`);
        } else {
            const state = readTerminalRuntimeState(runtimeId);
            println('\n  \x1b[36mSDK Runtime\x1b[0m');
            println(`  runtime  \x1b[90m${state.runtimeId}\x1b[0m`);
            println(`  session  \x1b[90m${state.sessionId ?? '-'}\x1b[0m`);
            println(`  model    \x1b[33m${state.model}\x1b[0m  reasoning=\x1b[33m${state.reasoningEffort}\x1b[0m`);
            await renderSdkQuota({ println }, runtimeId, { compact: true });
            println('  \x1b[90mUso: /sdk models | /sdk tools [model] | /sdk quota | /sdk compact\x1b[0m\n');
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
        if (sub === 'show') {
            renderElicitationEntry({ println }, getTerminalElicitation(rest[0] || 'latest'));
        } else if (sub === 'clear') {
            const ok = clearTerminalElicitation(rest[0] || 'latest');
            println(
                ok
                    ? '\x1b[32m  Elicitation removida da UX local.\x1b[0m'
                    : '\x1b[33m  Elicitation não encontrada.\x1b[0m',
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
            const message = rest.shift() ?? 'Informe os dados solicitados.';
            const parsed = parseJsonObject(rest);
            if (parsed.error || !parsed.json) {
                println(`\x1b[31m  JSON inválido: ${parsed.error ?? 'schema ausente'}\x1b[0m`);
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
                        `  ${statusColor}${entry.id}\x1b[0m  ${entry.mode}  ${entry.message.slice(0, 90)}${entry.source ? `  \x1b[90mvia ${entry.source}\x1b[0m` : ''}`,
                    );
                }
            }
            println(
                '  \x1b[90mUso: /elicitation [list|all|show latest|clear <id>|request <msg>|request-json <msg> <schemaJson>]\x1b[0m',
            );
            println(
                '  \x1b[90mask_user = conversa READY/REPLY; elicitation = formulário/URL estruturado do SDK.\x1b[0m\n',
            );
        }
    } catch (e) {
        println(`\n  \x1b[31m✗ Elicitation SDK: ${toError(e).message}\x1b[0m\n`);
    }
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
    if (entry.requestedSchema) println(`\n  schema:\n${pretty(entry.requestedSchema, 2500)}`);
    println(
        '\n  \x1b[90mNota: eventos elicitation.requested são diferentes de ask_user. Nesta versão do SDK local não há método público tipado para responder a uma elicitation recebida por evento; /elicitation request usa a operação de UI elicitation da façade RPC de sessão.\x1b[0m\n',
    );
}
