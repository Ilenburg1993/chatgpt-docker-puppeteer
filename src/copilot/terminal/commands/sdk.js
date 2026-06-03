// @ts-check
/**
 * Comandos SDK-first do terminal LLM-B.
 *
 * @module copilot/terminal/commands/sdk
 */

import { randomUUID } from 'node:crypto';

import { CANONICAL_LOCAL_FS_TOOL_NAMES, decideSdkFsRouting, toError } from '#copilot/core';
import { summarizeModelGatewaySdkQuotaSnapshots } from '#copilot/model-gateway';
import { utf8ByteLength } from '#copilot/infra/public/buffer';
import { isRuntimeElicitationSchema, normalizeElicitationContentWithSchema } from '../../core/elicitation-schema.js';
import {
    clearNextTurnRequestHeaders,
    getNextTurnRequestHeaders,
    setNextTurnRequestHeaders,
} from '../../presentation/state/index.js';
import { readTerminalIoActivityProjection } from '../events/index.js';
import {
    compactTerminalSdkSession,
    confirmTerminalSdkSessionUi,
    createTerminalPendingStructuredUserInput,
    createTerminalSdkWorkspaceFile,
    getTerminalPendingStructuredUserInputCount,
    getTerminalSdkQuota,
    getTerminalSdkSessionCapabilities,
    getTerminalSdkUsageMetrics,
    handleTerminalSdkPendingPermission,
    inputTerminalSdkSessionUi,
    isTerminalSdkSessionUiElicitationAvailable,
    listTerminalPendingStructuredUserInputs,
    listTerminalSdkModels,
    listTerminalSdkPendingPermissions,
    listTerminalSdkSkills,
    listTerminalSdkTools,
    listTerminalSdkWorkspaceFiles,
    readTerminalRuntimePermissionMode,
    readTerminalRuntimeState,
    readTerminalSdkSkillsGovernance,
    readTerminalSdkSystemPromptProjection,
    readTerminalSdkWorkspaceFile,
    readTerminalToolRegistrySnapshot,
    requestTerminalSdkElicitation,
    requireTerminalFileTool,
    resetTerminalSdkSessionApprovals,
    resolveTerminalSdkPendingElicitation,
    selectTerminalSdkSessionUi,
    setTerminalRuntimePermissionMode,
    setTerminalSdkDisabledSkills,
} from '../frontend/gateways/index.js';
import {
    buildActivityAwareGuidance,
    buildFailureRecoveryLines,
    buildTerminalOperationalGuidance,
} from '../frontend/operational-guidance/index.js';
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
    terminalPermissionModeSkipsSdkPrompts,
    formatTerminalIsoTimestamp,
} from '../state/sdk/index.js';
import { terminalThemeDivider, terminalThemeHeadline, terminalThemeRow, terminalThemeText } from '../state/ui/index.js';
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
 * @param {number} value
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function pluralPt(value, singular, plural) {
    return `${value} ${value === 1 ? singular : plural}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function activeLabel(value) {
    return value === true ? 'ativo' : 'ausente';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function availableLabel(value) {
    return value === true ? 'sim' : 'não';
}

/**
 * @param {{
 *     forms: number;
 *     permissions: number;
 *     questions: number;
 *     inputs: number;
 * }} waits
 * @returns {string}
 */
function renderHumanSdkWaitCounts(waits) {
    return [
        pluralPt(waits.forms, 'formulário', 'formulários'),
        pluralPt(waits.permissions, 'permissão', 'permissões'),
        pluralPt(waits.questions, 'pergunta', 'perguntas'),
        pluralPt(waits.inputs, 'pergunta estruturada', 'perguntas estruturadas'),
    ].join(' · ');
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function arrayFromSdkList(value) {
    const data = objectOrNull(value) ?? {};
    if (Array.isArray(value)) return value;
    if (Array.isArray(data['models'])) return data['models'];
    if (Array.isArray(data['skills'])) return data['skills'];
    if (Array.isArray(data['tools'])) return data['tools'];
    if (Array.isArray(data['files'])) return data['files'];
    return [];
}

/**
 * @param {string[]} rest
 * @returns {{ projectPaths?: string[]; skillDirectories?: string[] }}
 */
function parseSdkSkillsArgs(rest) {
    /** @type {string[]} */
    const projectPaths = [];
    /** @type {string[]} */
    const skillDirectories = [];
    for (let i = 0; i < rest.length; i++) {
        const token = rest[i];
        const candidate = rest[i + 1] ?? '';
        if ((token === '--project' || token === '--project-path') && candidate.trim()) {
            projectPaths.push(candidate.trim());
            i += 1;
            continue;
        }
        if ((token === '--dir' || token === '--skill-dir') && candidate.trim()) {
            skillDirectories.push(candidate.trim());
            i += 1;
        }
    }
    return {
        ...(projectPaths.length > 0 ? { projectPaths } : {}),
        ...(skillDirectories.length > 0 ? { skillDirectories } : {}),
    };
}

/**
 * @param {string[]} names
 * @returns {string[]}
 */
function normalizeSkillNames(names) {
    return [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/**
 * @param {import('../frontend/gateways/tools.js').TerminalTool} tool
 * @returns {Function}
 */
function getToolHandler(tool) {
    if (typeof tool?.handler === 'function') return tool.handler;
    throw new TypeError('[terminal/workspace] tool sem handler executável.');
}

const createFileTool = requireTerminalFileTool('write', 'create_file');
const writeFileContentTool = requireTerminalFileTool('write', 'write_file_content');
const readFileContentTool = requireTerminalFileTool('read', 'read_file_content');

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
    return `I/O ${operation ?? '-'} · motor ${engine ?? '-'}`;
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
 * @param {string[]} tokens
 * @returns {Record<string, string>}
 */
function parseSdkRequestHeaders(tokens) {
    /** @type {Record<string, string>} */
    const headers = {};
    for (const token of tokens) {
        const idx = token.indexOf('=');
        if (idx <= 0) continue;
        const key = token.slice(0, idx).trim();
        const value = token.slice(idx + 1).trim();
        if (!key || !value) continue;
        headers[key] = value;
    }
    return headers;
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
        bytes: utf8ByteLength(local.content, 'terminal sdk local content'),
        action: payload.overwrite ? 'overwritten' : 'created',
    };
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
    const sdkUi = objectOrNull(caps['ui']) ?? {};
    const sdkWorkspaceAvailable = sdkTools['workspace'] === true;

    const localFsToolNames = [...CANONICAL_LOCAL_FS_TOOL_NAMES];
    const registrySnapshot = readTerminalToolRegistrySnapshot();
    const localFsToolsReady = registrySnapshot.hasCanonicalLocalFsTools === true;
    const contract = registrySnapshot.toolContract;

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
    const routingLabel =
        routingMode === 'local-fs-primary'
            ? 'arquivos locais como rota principal'
            : routingMode === 'sdk-workspace-only'
              ? 'workspace SDK como fallback'
              : 'rota degradada';
    const decisionLabel =
        routingMode === 'local-fs-primary'
            ? 'arquivos locais canônicos primários; workspace SDK fica como auxiliar'
            : routingMode === 'sdk-workspace-only'
              ? 'usar workspace SDK até recuperar ferramentas locais de arquivo'
              : 'restaurar boot/load antes de operar em arquivos';

    println('');
    println(terminalThemeHeadline('accent', 'SDK Doctor', ['roteamento arquivos + SDK']));
    println(
        terminalThemeRow(
            'Superfícies',
            `workspace SDK ${activeLabel(sdkWorkspaceAvailable)} · arquivos locais ${localFsToolsReady ? 'ativos' : 'ausentes'} · terminal local ${activeLabel(registrySnapshot.hasCanonicalLocalExecTools)} · shell legado ${registrySnapshot.hasLegacySdkShellToolsLoaded ? 'carregado' : 'não carregado'} · instruções SDK ${activeLabel(instructionSourcesAvailable)}`,
        ),
    );
    println(
        terminalThemeRow(
            'SDK',
            `lista de ferramentas ${availableLabel(sdkTools['list'] === true)} · quota ${availableLabel(sdkTools['quota'] === true)} · formulário UI ${availableLabel(sdkUi['elicitation'] === true)}`,
        ),
    );
    println(
        terminalThemeRow(
            'Contrato',
            `${contract.ok ? 'ok' : 'atenção'} · falhas ${contract.errorCount} · avisos ${contract.warningCount} · descrição ${contract.metadataCoverage.descriptionPct}% · schema ${contract.metadataCoverage.parametersPct}% · categoria ${contract.metadataCoverage.categoryPct}% · tags ${contract.metadataCoverage.tagsPct}% · instruções ${contract.metadataCoverage.instructionsPct}%`,
            { role: contract.ok ? 'success' : 'warn' },
        ),
    );
    println(terminalThemeRow('Rota', routingLabel, { role: routingMode === 'local-fs-primary' ? 'success' : 'warn' }));
    println(terminalThemeRow('Decisão', decisionLabel));
    println(terminalThemeRow('Domínio', guidance.domainHint));
    println(terminalThemeRow('Contexto', guidance.contextHint));
    if (guidance.warnings.length > 0) {
        println(terminalThemeRow('Atenção', guidance.warnings.join(' | '), { role: 'warn' }));
    }
    println(terminalThemeRow('Motivo', routing.reason));
    println(terminalThemeRow('Arquivos', localFsToolNames.join(', ')));
    if (registrySnapshot.hasLegacySdkShellToolsLoaded && registrySnapshot.hasCanonicalLocalExecTools) {
        println(
            terminalThemeRow(
                'Terminal',
                'shell legado ainda carregado no registry; negar exposição na sessão via excludedTools',
                { role: 'warn' },
            ),
        );
    }
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
    const registrySnapshot = readTerminalToolRegistrySnapshot();
    const localFsToolsReady = registrySnapshot.hasCanonicalLocalFsTools === true;
    const routing = decideSdkFsRouting({
        canonicalFsReady: localFsToolsReady,
        sdkWorkspaceAvailable,
    });
    const [lastIoEntry = null] = readTerminalIoActivityProjection(1);
    const guidance = buildActivityAwareGuidance({
        mode: routing.mode,
        lastIoEntry: lastIoEntry
            ? {
                  operation: lastIoEntry.operation,
                  target: lastIoEntry.target,
                  success: lastIoEntry.success,
                  engine: lastIoEntry.engine,
              }
            : null,
    });
    if (guidance.nextCommand) {
        println(`  \x1b[33m? ${guidance.nextCommand}\x1b[0m`);
    }
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
    return text.length > max ? `${text.slice(0, max)}\n... (${text.length - max} chars restantes)` : text;
}

/**
 * @param {unknown} action
 * @returns {string}
 */
function renderSdkPromptActionLabel(action) {
    const value = typeof action === 'string' ? action.trim() : '';
    if (!value || value === 'none') return 'nenhuma ação imediata';
    if (value === 'observe-live-reload') return 'observar recarregamento vivo';
    if (value === 'resume-session') return 'retomar sessão';
    return value.replace(/_/gu, ' ');
}

/**
 * @param {number} ts
 * @returns {string}
 */
function formatAge(ts) {
    if (!Number.isFinite(ts)) return 'idade n/d';
    const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m${seconds % 60 ? `${seconds % 60}s` : ''}`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h${minutes % 60 ? `${minutes % 60}m` : ''}`;
}

/**
 * @param {string} text
 * @param {number} [max=180] Default is `180`
 * @returns {string}
 */
function compactText(text, max = 180) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
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
 * @param {unknown} schema
 * @returns {{ key: string; field: Record<string, unknown> } | null}
 */
function getSingleElicitationField(schema) {
    if (!isRuntimeElicitationSchema(schema)) return null;
    const entries = Object.entries(schema.properties);
    if (entries.length !== 1) return null;
    const [key, field] = /** @type {[string, unknown]} */ (entries[0]);
    const fieldObj = objectOrNull(field);
    return fieldObj ? { key, field: fieldObj } : null;
}

/**
 * @param {Record<string, unknown>} field
 * @returns {string[]}
 */
function allowedScalarValues(field) {
    if (Array.isArray(field['enum'])) return field['enum'].map((entry) => String(entry));
    const variants = Array.isArray(field['anyOf'])
        ? field['anyOf']
        : Array.isArray(field['oneOf'])
          ? field['oneOf']
          : [];
    return variants.flatMap((variant) => {
        const obj = objectOrNull(variant);
        if (!obj) return [];
        if ('const' in obj) return [String(obj['const'])];
        if (Array.isArray(obj['enum'])) return obj['enum'].map((entry) => String(entry));
        return [];
    });
}

/**
 * @param {string} raw
 * @param {Record<string, unknown>} field
 * @returns {string | number | boolean | string[]}
 */
function coerceElicitationShorthandValue(raw, field) {
    const value = raw.trim();
    const type = field['type'];
    const allowed = allowedScalarValues(field);
    if ((type === 'string' || !type) && allowed.length > 0) {
        const numericIndex = Number(value);
        if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= allowed.length) {
            const selected = allowed[numericIndex - 1];
            if (selected !== undefined) return selected;
        }
    }
    if (type === 'boolean') {
        const lower = value.toLowerCase();
        if (['true', '1', 'yes', 'y', 'sim', 's'].includes(lower)) return true;
        if (['false', '0', 'no', 'n', 'nao', 'não'].includes(lower)) return false;
        throw new TypeError('Valor curto booleano deve ser true/false, yes/no ou sim/não.');
    }
    if (type === 'number' || type === 'integer') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) throw new TypeError('Valor curto numérico deve ser number finito.');
        return parsed;
    }
    if (type === 'array') {
        if (value.startsWith('[')) {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
                throw new TypeError('Valor curto array deve ser JSON string[] ou texto separado por |.');
            }
            return parsed;
        }
        return value
            .split(value.includes('|') ? '|' : ',')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return value;
}

/**
 * @param {string[]} rest
 * @param {unknown} schema
 * @returns {{ ok: true; content: Record<string, string | number | boolean | string[]> | undefined }
 *     | { ok: false; error: string }}
 */
function parseElicitationAcceptContent(rest, schema) {
    const raw = rest.join(' ').trim();
    if (!raw) return { ok: true, content: undefined };

    if (raw.startsWith('{')) {
        const parsed = parseJsonObject(rest);
        if (parsed.error) return { ok: false, error: parsed.error };
        return {
            ok: true,
            content: /** @type {Record<string, string | number | boolean | string[]> | undefined} */ (
                /** @type {unknown} */ (parsed.json ?? undefined)
            ),
        };
    }

    const single = getSingleElicitationField(schema);
    if (!single) {
        return {
            ok: false,
            error: 'Resposta curta só é aceita quando o schema tem exatamente um campo; use JSON object.',
        };
    }

    try {
        return { ok: true, content: { [single.key]: coerceElicitationShorthandValue(raw, single.field) } };
    } catch (e) {
        return { ok: false, error: toError(e).message };
    }
}

/**
 * @param {unknown} schema
 * @returns {string | null}
 */
function describeElicitationShorthand(schema) {
    const single = getSingleElicitationField(schema);
    if (!single) return null;
    const allowed = allowedScalarValues(single.field);
    const suffix = allowed.length > 0 ? ` (${allowed.join(' | ')})` : '';
    return `/elicitation respond <id> accept <${single.key}>${suffix}`;
}

/**
 * @param {string | undefined} action
 * @param {string[]} rest
 * @param {unknown} [schema]
 * @returns {{ ok: true; result: import('../../presentation/contracts/index.js').RuntimeElicitationResult }
 *     | { ok: false; error: string }}
 */
function parseElicitationResult(action, rest, schema) {
    if (action !== 'accept' && action !== 'decline' && action !== 'cancel') {
        return { ok: false, error: 'Acao deve ser accept | decline | cancel.' };
    }
    if (action !== 'accept' && rest.join(' ').trim()) {
        return { ok: false, error: 'JSON content so e aceito para action=accept.' };
    }
    if (action !== 'accept') {
        return { ok: true, result: { action } };
    }
    const parsed = parseElicitationAcceptContent(rest, schema);
    if (!parsed.ok) return parsed;
    const normalized = normalizeElicitationContentWithSchema(parsed.content, schema);
    if (!normalized.ok) {
        return { ok: false, error: normalized.error };
    }
    return { ok: true, result: { action, ...(normalized.content ? { content: normalized.content } : {}) } };
}

/**
 * @param {CommandContext} ctx
 * @param {string | null | undefined} runtimeId
 * @param {{ detail?: boolean }} [options]
 * @returns {void}
 */
function renderSdkWaitsSummary({ println }, runtimeId, options = {}) {
    const detail = options.detail === true;
    const scopedRuntimeId = runtimeId ?? null;
    const pendingElicitations = readTerminalElicitationSummary({ runtimeId: scopedRuntimeId });
    const permissionSummary = readTerminalPermissionSummary({ runtimeId: scopedRuntimeId });
    const userInputSummary = readTerminalUserInputSummary({ runtimeId: scopedRuntimeId });
    const structuredInputs = listTerminalPendingStructuredUserInputs();
    const structuredInputPending = structuredInputs.length || getTerminalPendingStructuredUserInputCount();
    const totalPending =
        pendingElicitations.pending + permissionSummary.pending + userInputSummary.pending + structuredInputPending;

    println('');
    println(terminalThemeHeadline('question', 'Esperas humanas'));
    println(terminalThemeDivider(37));
    println(
        terminalThemeRow('Estado', totalPending > 0 ? `${totalPending} pendência(s)` : 'nenhuma pendência', {
            role: totalPending > 0 ? 'question' : 'success',
        }),
    );
    println(
        detail
            ? terminalThemeRow(
                  'Detalhe',
                  `formulários ${pendingElicitations.pending}${pendingElicitations.latest?.mode ? ` (${pendingElicitations.latest.mode})` : ''} · permissões ${permissionSummary.pending}${permissionSummary.latest ? ` (${permissionSummary.latest.permissionType})` : ''} · perguntas SDK ${userInputSummary.pending}${userInputSummary.latest?.kind ? ` (${userInputSummary.latest.kind})` : ''} · perguntas estruturadas ${structuredInputPending}`,
              )
            : terminalThemeRow('Resumo', renderHumanSdkWaitCounts({
                  forms: pendingElicitations.pending,
                  permissions: permissionSummary.pending,
                  questions: userInputSummary.pending,
                  inputs: structuredInputPending,
              })),
    );

    if (pendingElicitations.pending > 0) {
        println(terminalThemeRow('Ação', `${terminalThemeText('command', '/elicitation show latest')} ${terminalThemeText('muted', '·')} ${terminalThemeText('command', '/elicitation list')}`));
    }
    if (permissionSummary.pending > 0) {
        println(terminalThemeRow('Ação', `${terminalThemeText('command', '/permission show latest')} ${terminalThemeText('muted', '·')} ${terminalThemeText('command', '/permission all')}`));
    }
    if (userInputSummary.pending > 0) {
        println(terminalThemeRow('Ação', `${terminalThemeText('command', '/answer <texto>')} ${terminalThemeText('muted', 'ou responda na conversa ativa')}`));
        const latest = userInputSummary.latest;
        if (latest) {
            const choices = latest.choices.length > 0 ? ` · opções ${latest.choices.join(' | ')}` : '';
            const freeform = latest.allowFreeform ? 'livre' : 'seleção obrigatória';
            println(terminalThemeRow('Pergunta', `${formatAge(latest.createdAt)} · ${latest.kind} · ${freeform}${choices}`));
            if (detail) println(terminalThemeRow('ID', latest.id));
            println(terminalThemeRow('Texto', compactText(latest.question, 220), { role: 'question' }));
        }
    }
    if (structuredInputPending > 0) {
        println(terminalThemeRow('Ação', 'digite a resposta normalmente; o REPL destrava a pergunta estruturada pendente'));
        for (const entry of structuredInputs.slice(0, 3)) {
            const choices = entry.choices.length > 0 ? ` · opções ${entry.choices.join(' | ')}` : '';
            const freeform = entry.allowFreeform ? 'livre' : 'seleção obrigatória';
            println(
                terminalThemeRow('Pergunta', `${formatAge(entry.createdAt)} · ${freeform}${choices}`),
            );
            if (detail) println(terminalThemeRow('ID', entry.requestId));
            println(terminalThemeRow('Texto', compactText(entry.question, 220), { role: 'question' }));
        }
        if (structuredInputs.length > 3) {
            println(terminalThemeRow('Pergunta', `+${structuredInputs.length - 3} pendente(s)`));
        }
    }
    if (totalPending === 0) {
        println(terminalThemeRow('Status', 'Sem bloqueios de input humano do SDK no momento.'));
    }
    println(terminalThemeDivider(37));
    println('');
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function parseChoiceList(value) {
    return value
        .replace(/^['"]|['"]$/gu, '')
        .split('|')
        .map((choice) => choice.trim())
        .filter((choice) => choice.length > 0);
}

/**
 * @param {string[]} rest
 * @returns {{
 *     question: string;
 *     choices: string[];
 *     allowFreeform: boolean;
 * }}
 */
function parseSdkSimulateRequestUserInputArgs(rest) {
    let allowFreeform = true;
    /** @type {string[]} */
    let choices = [];
    /** @type {string[]} */
    const questionParts = [];
    for (let i = 0; i < rest.length; i++) {
        const token = rest[i] ?? '';
        if (!token) continue;
        if (token === '--required' || token === '--no-freeform') {
            allowFreeform = false;
            continue;
        }
        if (token === '--freeform') {
            allowFreeform = true;
            continue;
        }
        if (token === '--choices') {
            const candidate = rest[i + 1] ?? '';
            choices = parseChoiceList(candidate);
            i += 1;
            continue;
        }
        questionParts.push(token);
    }
    return {
        question: questionParts.join(' ').trim() || 'REQUEST_USER_INPUT-SIM: responda para fechar o teste',
        choices,
        allowFreeform,
    };
}

/**
 * @param {CommandContext} ctx
 * @param {string[]} rest
 * @returns {void}
 */
function renderSdkSimulate({ println }, rest) {
    const [kind = '', ...tail] = rest;
    if (kind !== 'request-user-input' && kind !== 'request_user_input') {
        println(
            '\n  \x1b[33mUso: /sdk simulate request-user-input [--choices "sim|nao"] [--required] [pergunta]\x1b[0m\n',
        );
        return;
    }
    const parsed = parseSdkSimulateRequestUserInputArgs(tail);
    const created = createTerminalPendingStructuredUserInput({
        question: parsed.question,
        choices: parsed.choices,
        allowFreeform: parsed.allowFreeform,
        data: { command: '/sdk simulate request-user-input' },
    });
    const mode = parsed.allowFreeform ? 'resposta livre' : 'seleção obrigatória';
    const choices = parsed.choices.length > 0 ? ` · opções ${parsed.choices.join(' | ')}` : '';
    println('');
    println(terminalThemeHeadline('question', 'Pergunta humana estruturada'));
    println(terminalThemeDivider(37));
    println(terminalThemeRow('Status', 'aguardando operador', { role: 'question' }));
    println(terminalThemeRow('Origem', 'diagnóstico de pergunta estruturada'));
    println(terminalThemeRow('Modo', `${mode}${choices}`));
    println(terminalThemeRow('Pergunta', compactText(parsed.question, 220), { role: 'question' }));
    println(
        terminalThemeRow(
            'Ação',
            `digite a resposta normalmente ou use ${terminalThemeText('command', '/answer <texto>')}`,
        ),
    );
    println(terminalThemeRow('Detalhe', terminalThemeText('command', '/sdk waits detail')));
    println(terminalThemeDivider(37));
    println('');
    void created.promise;
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
        `  UI       \x1b[90mformulários ${availableLabel(ui['elicitation'])} · confirmações ${availableLabel(ui['confirm'])} · seleção ${availableLabel(ui['select'])} · texto livre ${availableLabel(ui['input'])}\x1b[0m`,
    );
    println(
        `  tools    \x1b[90mworkspace ${availableLabel(tools['workspace'])} · lista ${availableLabel(tools['list'])} · quota ${availableLabel(tools['quota'])}\x1b[0m`,
    );
    println(
        `  plano    \x1b[90mleitura ${availableLabel(plan['read'])} · escrita ${availableLabel(plan['write'])} · remoção ${availableLabel(plan['delete'])}\x1b[0m`,
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
        } else if (sub === 'skills') {
            await renderSdkSkills({ println }, rest, runtimeId);
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
        } else if (sub === 'headers') {
            renderSdkRequestHeadersSummary({ println }, rest);
        } else if (sub === 'waits') {
            renderSdkWaitsSummary({ println }, runtimeId, {
                detail: rest.includes('detail') || rest.includes('--detail') || rest.includes('debug') || rest.includes('--debug'),
            });
        } else if (sub === 'simulate') {
            renderSdkSimulate({ println }, rest);
        } else if (sub === 'compact') {
            const result = await callWithRuntimeTarget(compactTerminalSdkSession, runtimeId);
            println(`\n  \x1b[32m[OK] SDK compaction solicitada.\x1b[0m\n  \x1b[90m${pretty(result, 700)}\x1b[0m\n`);
        } else {
            const state = readTerminalRuntimeState(runtimeId);
            const pendingElicitations = readTerminalElicitationSummary({ runtimeId: state.runtimeId });
            const permissionSummary = readTerminalPermissionSummary({ runtimeId: state.runtimeId });
            const userInputSummary = readTerminalUserInputSummary({ runtimeId: state.runtimeId });
            const structuredInputPending = getTerminalPendingStructuredUserInputCount();
            println('\n  \x1b[36mSDK do Terminal\x1b[0m');
            println(`  Runtime  \x1b[90m${state.runtimeId}\x1b[0m`);
            println(`  Sessão   \x1b[90m${state.sessionId ?? 'sem sessão SDK'}\x1b[0m`);
            println(`  Modelo   \x1b[33m${state.model}\x1b[0m  \x1b[90mraciocínio ${state.reasoningEffort}\x1b[0m`);
            println(
                `  Esperas  \x1b[90m${renderHumanSdkWaitCounts({
                    forms: pendingElicitations.pending,
                    permissions: permissionSummary.pending,
                    questions: userInputSummary.pending,
                    inputs: structuredInputPending,
                })}\x1b[0m`,
            );
            await renderSdkQuota({ println }, runtimeId, { compact: true });
            println(
                '  \x1b[90mUso: /sdk models | /sdk skills [--project <path>] [--dir <path>] | /sdk tools [model] | /sdk quota | /sdk prompt | /sdk capabilities | /sdk headers [k=v ...|clear] | /sdk waits | /sdk simulate request-user-input | /sdk doctor | /sdk compact\x1b[0m\n',
            );
        }
    } catch (e) {
        println(`\n  \x1b[31m[ERR] SDK: ${toError(e).message}\x1b[0m\n`);
    }
}

/**
 * @param {CommandContext} ctx
 * @param {string[]} rest
 * @returns {void}
 */
function renderSdkRequestHeadersSummary({ println }, rest) {
    const [first = '', ...tail] = rest;
    if (!first) {
        const headers = getNextTurnRequestHeaders();
        println('\n  \x1b[36mRequest Headers do próximo turno\x1b[0m');
        if (!headers) {
            println('  \x1b[90mNenhum header one-shot configurado. Use /sdk headers chave=valor ...\x1b[0m');
        } else {
            for (const [key, value] of Object.entries(headers)) {
                println(`  \x1b[33m${key}\x1b[0m=\x1b[90m${value}\x1b[0m`);
            }
        }
        println(
            '  \x1b[90mObservação: turnos com requestHeaders usam dispatch SDK direto e reanexam a conversa depois da resposta.\x1b[0m\n',
        );
        return;
    }

    if (first === 'clear') {
        clearNextTurnRequestHeaders();
        println('\n  \x1b[90mHeaders one-shot limpos.\x1b[0m\n');
        return;
    }

    const headers = parseSdkRequestHeaders([first, ...tail]);
    if (Object.keys(headers).length === 0) {
        println('\n  \x1b[31m[ERR] Use /sdk headers chave=valor [outra=coisa] ou /sdk headers clear\x1b[0m\n');
        return;
    }
    setNextTurnRequestHeaders(headers);
    println('\n  \x1b[32m[OK] Headers one-shot configurados para o próximo turno do usuário.\x1b[0m');
    for (const [key, value] of Object.entries(headers)) {
        println(`  \x1b[33m${key}\x1b[0m=\x1b[90m${value}\x1b[0m`);
    }
    println(
        '  \x1b[90mEsse próximo turno usará dispatch SDK direto (consome PR) e depois reanexará a conversa.\x1b[0m\n',
    );
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
    if (models.length > 30) println(`  \x1b[90m... ${models.length - 30} modelos omitidos\x1b[0m`);
    println('');
}

/**
 * @param {CommandContext} ctx
 * @param {string[]} rest
 * @param {string | null | undefined} runtimeId
 * @returns {Promise<void>}
 */
async function renderSdkSkills({ println }, rest, runtimeId) {
    const [action = '', ...tail] = rest;
    if (action === 'status') {
        const state = readTerminalRuntimeState(runtimeId);
        println('\n  \x1b[36mSkills SDK Status\x1b[0m');
        println(`  runtime  \x1b[90m${state.runtimeId}\x1b[0m`);
        println(
            '  \x1b[90mUse /sdk skills para discovery, /sdk skills config para governança e /sdk skills agents para projeção por custom agent.\x1b[0m\n',
        );
        return;
    }
    if (action === 'config') {
        await renderSdkSkillsConfig({ println }, runtimeId);
        return;
    }
    if (action === 'agents') {
        await renderSdkSkillsAgents({ println }, runtimeId);
        return;
    }
    if (action === 'disable') {
        await updateSdkDisabledSkills({ println }, 'disable', tail, runtimeId);
        return;
    }
    if (action === 'enable') {
        await updateSdkDisabledSkills({ println }, 'enable', tail, runtimeId);
        return;
    }

    const options = parseSdkSkillsArgs(rest);
    const result = await callWithRuntimeTarget(listTerminalSdkSkills, runtimeId, options);
    const skills = arrayFromSdkList(result);
    const enabledCount = skills.filter((skill) => objectOrNull(skill)?.['enabled'] !== false).length;
    const invocableCount = skills.filter((skill) => objectOrNull(skill)?.['userInvocable'] === true).length;
    /** @type {Map<string, number>} */
    const sourceCounts = new Map();
    for (const skill of skills) {
        const source = String(objectOrNull(skill)?.['source'] ?? 'unknown');
        sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
    const sourceSummary = [...sourceCounts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
        .map(([source, count]) => `${source}=${count}`)
        .join(' · ');

    println(`\n  \x1b[36mSkills SDK (${skills.length})\x1b[0m`);
    println(
        `  \x1b[90mativas ${enabledCount} · desativadas ${skills.length - enabledCount} · invocáveis ${invocableCount}${sourceSummary ? ` · fontes ${sourceSummary}` : ''}\x1b[0m`,
    );
    if (options.projectPaths?.length || options.skillDirectories?.length) {
        const filters = [
            options.projectPaths?.length ? `projeto ${options.projectPaths.join(', ')}` : null,
            options.skillDirectories?.length ? `diretório ${options.skillDirectories.join(', ')}` : null,
        ]
            .filter(Boolean)
            .join(' · ');
        println(`  \x1b[90mfiltros: ${filters}\x1b[0m`);
    }
    for (const skill of skills.slice(0, 40)) {
        const s = objectOrNull(skill) ?? {};
        const name = String(s['name'] ?? skill);
        const desc = String(s['description'] ?? '')
            .replace(/\s+/g, ' ')
            .slice(0, 90);
        const source = String(s['source'] ?? 'unknown');
        const enabled = s['enabled'] !== false;
        const userInvocable = s['userInvocable'] === true;
        const projectPath = typeof s['projectPath'] === 'string' ? s['projectPath'] : null;
        const path = typeof s['path'] === 'string' ? s['path'] : null;
        const badges = [enabled ? 'enabled' : 'disabled', source, userInvocable ? 'slash' : null]
            .filter(Boolean)
            .join(' · ');
        println(
            `  \x1b[33m${name}\x1b[0m${badges ? `  \x1b[90m[${badges}]\x1b[0m` : ''}${desc ? `  \x1b[90m${desc}\x1b[0m` : ''}`,
        );
        if (projectPath) println(`    \x1b[90mprojeto ${projectPath}\x1b[0m`);
        if (path && path !== projectPath) println(`    \x1b[90mcaminho ${path}\x1b[0m`);
    }
    if (skills.length > 40) println(`  \x1b[90m... ${skills.length - 40} skills omitidas\x1b[0m`);
    println(
        '  \x1b[90mcustom agent = definicao declarativa em SessionConfig.customAgents; subagent = uso runtime desse custom agent via eventos subagent.*\x1b[0m',
    );
    println('');
}

/**
 * @param {CommandContext} ctx
 * @param {string | null | undefined} runtimeId
 * @returns {Promise<void>}
 */
async function renderSdkSkillsConfig({ println }, runtimeId) {
    const governance = /** @type {Record<string, unknown>} */ (
        (await callWithRuntimeTarget(readTerminalSdkSkillsGovernance, runtimeId)) ?? {}
    );
    const bootSkills = objectOrNull(governance['bootSkills']) ?? {};
    const discovery = objectOrNull(governance['discovery']) ?? {};
    const semantics = objectOrNull(governance['semantics']) ?? {};
    const discoveredSkills = arrayFromSdkList(discovery);
    const discoveredDisabled = discoveredSkills
        .filter((skill) => objectOrNull(skill)?.['enabled'] === false)
        .map((skill) => String(objectOrNull(skill)?.['name'] ?? ''))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const skillDirectories = Array.isArray(bootSkills['skillDirectories']) ? bootSkills['skillDirectories'] : [];
    const disabledSkills = Array.isArray(bootSkills['disabledSkills']) ? bootSkills['disabledSkills'] : [];

    println('\n  \x1b[36mSkills SDK Config\x1b[0m');
    println(
        `  \x1b[90mdiretórios ${skillDirectories.length} | desativadas no boot ${disabledSkills.length} | desativadas runtime ${discoveredDisabled.length}\x1b[0m`,
    );
    println(`  session dirs      \x1b[90m${skillDirectories.length > 0 ? skillDirectories.join(', ') : '-'}\x1b[0m`);
    println(`  boot disabled     \x1b[90m${disabledSkills.length > 0 ? disabledSkills.join(', ') : '-'}\x1b[0m`);
    println(
        `  runtime disabled  \x1b[90m${discoveredDisabled.length > 0 ? discoveredDisabled.join(', ') : '-'}\x1b[0m`,
    );
    println(`  semantic          \x1b[90m${String(semantics['customAgentDefinition'] ?? '-')}\x1b[0m`);
    println(`  runtime           \x1b[90m${String(semantics['subagentRuntime'] ?? '-')}\x1b[0m`);
    println(`  mutation          \x1b[90m${String(semantics['disabledSkillsMutationScope'] ?? '-')}\x1b[0m`);
    println(
        '  \x1b[90mObservação: disable/enable ajusta disabledSkills no runtime/CLI atual; persiste no escopo server, não reescreve automaticamente o env do processo.\x1b[0m',
    );
    println(
        '  \x1b[90mUso: /sdk skills agents | /sdk skills disable <skill...> | /sdk skills enable <skill...> | /sdk skills [--project <path>] [--dir <path>]\x1b[0m\n',
    );
}

/**
 * @param {CommandContext} ctx
 * @param {string | null | undefined} runtimeId
 * @returns {Promise<void>}
 */
async function renderSdkSkillsAgents({ println }, runtimeId) {
    const governance = /** @type {Record<string, unknown>} */ (
        (await callWithRuntimeTarget(readTerminalSdkSkillsGovernance, runtimeId)) ?? {}
    );
    const customAgents = Array.isArray(governance['customAgents']) ? governance['customAgents'] : [];
    const agentsWithSkills = customAgents.filter((agent) => {
        const entry = objectOrNull(agent);
        return Array.isArray(entry?.['preloadSkills']) && entry['preloadSkills'].length > 0;
    });

    println(`\n  \x1b[36mCustom Agents x Skills (${customAgents.length})\x1b[0m`);
    println(
        `  \x1b[90magentes com preload ${agentsWithSkills.length} | inferíveis ${customAgents.filter((agent) => objectOrNull(agent)?.['infer'] !== false).length}\x1b[0m`,
    );
    println(
        '  \x1b[90mcustom agent = definicao de sessao; subagent = quando o runtime seleciona/invoca esse custom agent e emite subagent.*\x1b[0m',
    );

    for (const agent of customAgents) {
        const entry = objectOrNull(agent) ?? {};
        const name = String(entry['name'] ?? 'unknown');
        const displayName = typeof entry['displayName'] === 'string' ? entry['displayName'] : name;
        const preloadSkills = Array.isArray(entry['preloadSkills']) ? entry['preloadSkills'].map(String) : [];
        const preloadEnabledSkills = Array.isArray(entry['preloadEnabledSkills'])
            ? entry['preloadEnabledSkills'].map(String)
            : [];
        const preloadDisabledSkills = Array.isArray(entry['preloadDisabledSkills'])
            ? entry['preloadDisabledSkills'].map(String)
            : [];
        const infer = entry['infer'] !== false;
        const tools = Array.isArray(entry['tools']) ? entry['tools'].map(String) : null;

        println(
            `  \x1b[33m${name}\x1b[0m  \x1b[90m(${displayName}) | inferir ${String(infer)} | tools ${tools ? tools.join(', ') || '[]' : 'all'}\x1b[0m`,
        );
        if (preloadSkills.length === 0) {
            println('    \x1b[90mpreload skills: -\x1b[0m');
            continue;
        }
        println(`    \x1b[90mpreload ${preloadSkills.join(', ')}\x1b[0m`);
        if (preloadEnabledSkills.length > 0) println(`    \x1b[32mativas ${preloadEnabledSkills.join(', ')}\x1b[0m`);
        if (preloadDisabledSkills.length > 0)
            println(`    \x1b[31mdesativadas ${preloadDisabledSkills.join(', ')}\x1b[0m`);
    }

    if (customAgents.length === 0) {
        println('  \x1b[90mNenhum custom agent configurado nesta sessao.\x1b[0m');
    }
    println('');
}

/**
 * @param {CommandContext} ctx
 * @param {'enable' | 'disable'} action
 * @param {string[]} names
 * @param {string | null | undefined} runtimeId
 * @returns {Promise<void>}
 */
async function updateSdkDisabledSkills({ println }, action, names, runtimeId) {
    const requested = normalizeSkillNames(names);
    if (requested.length === 0) {
        println(`\n  \x1b[31m[ERR] Use /sdk skills ${action} <skill...>\x1b[0m\n`);
        return;
    }

    const governance = /** @type {Record<string, unknown>} */ (
        (await callWithRuntimeTarget(readTerminalSdkSkillsGovernance, runtimeId)) ?? {}
    );
    const discovery = objectOrNull(governance['discovery']) ?? {};
    const currentDisabled = new Set(
        arrayFromSdkList(discovery)
            .filter((skill) => objectOrNull(skill)?.['enabled'] === false)
            .map((skill) => String(objectOrNull(skill)?.['name'] ?? ''))
            .filter(Boolean),
    );

    if (action === 'disable') {
        for (const name of requested) currentDisabled.add(name);
    } else {
        for (const name of requested) currentDisabled.delete(name);
    }

    const disabledSkills = [...currentDisabled].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    await callWithRuntimeTarget(setTerminalSdkDisabledSkills, runtimeId, disabledSkills);

    println(`\n  \x1b[32m[OK] disabledSkills runtime atualizadas via SDK (${action}).\x1b[0m`);
    println(`  \x1b[90msolicitadas ${requested.join(', ')}\x1b[0m`);
    println(`  \x1b[90mdesativadas runtime ${disabledSkills.length > 0 ? disabledSkills.join(', ') : '-'}\x1b[0m`);
    println(
        '  \x1b[90mEscopo: altera o runtime/CLI atual via server RPC; n�o reescreve automaticamente COPILOT_DISABLED_SKILLS do processo.\x1b[0m\n',
    );
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
    const registrySnapshot = readTerminalToolRegistrySnapshot();
    const contract = registrySnapshot.toolContract;
    println('');
    println(terminalThemeHeadline('tool', 'Ferramentas SDK', [model ? `modelo ${model}` : null, `${tools.length} tool(s) nativa(s)`]));
    for (const tool of tools.slice(0, 50)) {
        const t = objectOrNull(tool) ?? {};
        const rawName = String(t['name'] ?? tool);
        const namespacedName = typeof t['namespacedName'] === 'string' ? t['namespacedName'] : null;
        const name = String(namespacedName ?? rawName);
        const desc = String(t['description'] ?? '')
            .replace(/\s+/g, ' ')
            .slice(0, 90);
        const hasParameters = Boolean(t['parameters'] && typeof t['parameters'] === 'object');
        const hasInstructions = typeof t['instructions'] === 'string' && t['instructions'].trim().length > 0;
        const badges = [hasParameters ? 'schema' : null, hasInstructions ? 'instructions' : null]
            .filter(Boolean)
            .join(' · ');
        println(
            `  ${terminalThemeText('command', name)}${badges ? `  ${terminalThemeText('muted', `[${badges.replace('instructions', 'instruções')}]`)}` : ''}${desc ? `  ${terminalThemeText('muted', desc)}` : ''}`,
        );
        if (namespacedName && rawName && namespacedName !== rawName) {
            println(terminalThemeRow('nome bruto', rawName, { role: 'muted' }));
        }
        if (hasInstructions) {
            const instructions = String(t['instructions']).replace(/\s+/g, ' ').slice(0, 140);
            println(terminalThemeRow('instruções', instructions, { role: 'muted' }));
        }
    }
    if (tools.length > 50) println(terminalThemeText('muted', `  ... ${tools.length - 50} tools omitidas`));
    println('');
    println(terminalThemeHeadline('tool', 'Registry local canônico'));
    println(terminalThemeRow('Total', String(registrySnapshot.total), { role: 'info' }));
    println(terminalThemeRow('Arquivos', activeLabel(registrySnapshot.hasCanonicalLocalFsTools), { role: registrySnapshot.hasCanonicalLocalFsTools ? 'success' : 'warn' }));
    println(terminalThemeRow('Terminal', activeLabel(registrySnapshot.hasCanonicalLocalExecTools), { role: registrySnapshot.hasCanonicalLocalExecTools ? 'success' : 'warn' }));
    println(terminalThemeRow('Shell legado', registrySnapshot.hasLegacySdkShellToolsLoaded ? 'carregado' : 'não carregado', { role: registrySnapshot.hasLegacySdkShellToolsLoaded ? 'warn' : 'muted' }));
    println(terminalThemeRow('Desativadas', String(registrySnapshot.disabled.length), { role: registrySnapshot.disabled.length > 0 ? 'warn' : 'muted' }));
    if (registrySnapshot.disabled.length > 0) {
        println(terminalThemeRow('Lista', registrySnapshot.disabled.join(', '), { role: 'muted' }));
    }
    println(
        terminalThemeRow(
            'Contrato',
            `${contract.ok ? 'ok' : 'atenção'} · falhas ${contract.errorCount} · avisos ${contract.warningCount} · descrições ${contract.metadataCoverage.descriptionPct}% · schema ${contract.metadataCoverage.parametersPct}% · categoria ${contract.metadataCoverage.categoryPct}% · tags ${contract.metadataCoverage.tagsPct}% · instruções ${contract.metadataCoverage.instructionsPct}%`,
            { role: contract.ok ? 'success' : 'warn' },
        ),
    );
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
    let usageMetrics = null;
    let usageMetricsError = null;
    try {
        usageMetrics = await callWithRuntimeTarget(getTerminalSdkUsageMetrics, runtimeId);
    } catch (error) {
        usageMetricsError = toError(error).message;
    }
    const data = objectOrNull(result) ?? {};
    const snapshots = objectOrNull(data['quotaSnapshots']) ?? {};
    const quotaSummary = summarizeModelGatewaySdkQuotaSnapshots(result);
    const state = classifyTerminalSdkQuota(result);
    const color = state === 'bad' ? '\x1b[31m' : state === 'warn' ? '\x1b[33m' : '\x1b[32m';
    if (!opts.compact) println('\n  \x1b[36mQuota SDK\x1b[0m');
    for (const row of quotaSummary.rows) {
        const pct = row.remainingPercentage === null ? '?' : `${row.remainingPercentage.toFixed(1)}%`;
        println(
            opts.compact
                ? `  Quota    ${color}${row.quotaId}\x1b[0m  \x1b[33m${pct}\x1b[0m restante · reset \x1b[90m${row.resetAt ?? '-'}\x1b[0m · escopo \x1b[90m${row.scope}\x1b[0m`
                : `  ${color}${row.quotaId}\x1b[0m  \x1b[33m${pct}\x1b[0m restante · reset \x1b[90m${row.resetAt ?? '-'}\x1b[0m · escopo \x1b[90m${row.scope}\x1b[0m`,
        );
    }
    if (Object.keys(snapshots).length === 0) println('  \x1b[90mSem snapshots de quota no retorno SDK.\x1b[0m');
    if (!opts.compact) {
        if (usageMetrics) {
            const summary = pretty(usageMetrics, 700).replace(/\n+/g, ' ');
            println(`  usage rpc  \x1b[90m${summary}\x1b[0m`);
        } else if (usageMetricsError) {
            println(`  usage rpc  \x1b[90mindisponível: ${usageMetricsError}\x1b[0m`);
        }
    }
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
    const yesNo = (/** @type {unknown} */ value) => (value ? 'sim' : 'não');

    println('\n  \x1b[36mSystem Prompt SDK\x1b[0m');
    println(
        `  modo     \x1b[33m${String(status['effectiveMode'] ?? '?')}\x1b[0m  live \x1b[33m${String(status['effectiveLiveMode'] ?? '?')}\x1b[0m  reload \x1b[33m${String(status['liveReloadMechanism'] ?? '?')}\x1b[0m`,
    );
    println(
        `  config   \x1b[90m${String(status['configPath'] ?? '-')}\x1b[0m  auto reload \x1b[33m${yesNo(Boolean(status['autoReload']))}\x1b[0m`,
    );
    println(
        `  sdk      \x1b[90mcustomize ${yesNo(Boolean(sdkCompatibility['supportsCustomizeMode']))} · sources RPC ${yesNo(Boolean(sdkCompatibility['supportsInstructionSourcesRpc']))}\x1b[0m`,
    );
    println(
        `  digest   \x1b[90m${String(revision['digest'] ?? '-')}\x1b[0m  seções \x1b[33m${sections.length}\x1b[0m  anexos \x1b[33m${appendFiles.length}\x1b[0m`,
    );
    println(
        `  sessão   \x1b[90m${String(sessionId ?? '-')}\x1b[0m  fontes \x1b[33m${sessionAvailable ? 'disponíveis' : 'nenhuma'}\x1b[0m`,
    );
    println(
        `  binding  \x1b[90m${String(binding['digest'] ?? '-')}\x1b[0m  defasado \x1b[33m${yesNo(Boolean(freshness['isStale']))}\x1b[0m  ação \x1b[33m${renderSdkPromptActionLabel(freshness['recommendedAction'])}\x1b[0m`,
    );

    if (freshness['reason']) {
        println(`  ${terminalThemeText('muted', String(freshness['reason']))}`);
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
            println(`\n  \x1b[32m? Arquivo escrito no workspace SDK virtual:\x1b[0m \x1b[33m${path}\x1b[0m`);
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
                    println(`  \x1b[32m✓\x1b[0m ${sourcePath} → ${destinationPath}`);
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
                if (files.length > 80) println(`  \x1b[90m• ${files.length - 80} arquivos omitidos\x1b[0m`);
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
        println(`\n  \x1b[31m? Workspace SDK: ${toError(e).message}\x1b[0m`);
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
                /** @type {import('../../presentation/contracts/index.js').RuntimeInputOptions | undefined} */ (
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
                '  \x1b[90mpergunta humana = conversa READY/REPLY; elicitation = formulário/URL estruturado do SDK; confirm/select/input = conveniências de session.ui.*.\x1b[0m\n',
            );
        }
    } catch (e) {
        println(`\n  \x1b[31m? Elicitation SDK: ${toError(e).message}\x1b[0m\n`);
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
            const sdkPromptsSkipped = terminalPermissionModeSkipsSdkPrompts(current);
            println(`\n  \x1b[36mModo de permissões\x1b[0m  \x1b[33m${current}\x1b[0m`);
            println(
                `  \x1b[90mprompts SDK ${sdkPromptsSkipped ? 'ignorados' : 'seletivos'} · ${sdkPromptsSkipped ? 'sem janelas SDK por padrão' : 'pode solicitar autorização conforme política'}\x1b[0m`,
            );
            println('  \x1b[90mUso: /permission mode <approve_all|audit_only|selective>\x1b[0m\n');
            return;
        }
        if (next !== 'approve_all' && next !== 'audit_only' && next !== 'selective') {
            println('  \x1b[33mUso: /permission mode <approve_all|audit_only|selective>\x1b[0m');
            return;
        }
        const updated = setTerminalRuntimePermissionMode(next, runtimeId);
        const sdkPromptsSkipped = terminalPermissionModeSkipsSdkPrompts(updated);
        println(`\n  \x1b[32m? Modo de permissões atualizado:\x1b[0m \x1b[33m${updated}\x1b[0m\n`);
        println(
            `  \x1b[90mprompts SDK ${sdkPromptsSkipped ? 'ignorados' : 'seletivos'} · ${sdkPromptsSkipped ? 'sem janelas SDK por padrão' : 'pode solicitar autorização conforme política'}\x1b[0m\n`,
        );
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
                println(`  \x1b[31mJSON inválido:\x1b[0m ${toError(error).message}`);
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
    if (sub === 'reset-approvals') {
        const result = await callWithRuntimeTarget(resetTerminalSdkSessionApprovals, runtimeId);
        println(`\n  \x1b[32m✓ Aprovações da sessão resetadas.\x1b[0m`);
        println(`  \x1b[90m${pretty(result, 700)}\x1b[0m\n`);
        return;
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
    println('  \x1b[90mUso: /permission [list|pending|reset-approvals|cockpit|all|show latest|clear <id>|clear all|mode [approve_all|audit_only|selective]|respond <id> <decision> [json]]\x1b[0m');
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
    println(`\n  \x1b[36mFormulário SDK ${entry.id}\x1b[0m`);
    println(`  estado  \x1b[33m${entry.status}\x1b[0m`);
    println(`  modo    \x1b[33m${entry.mode}\x1b[0m`);
    println(`  msg     ${entry.message}`);
    if (entry.url) println(`  url     \x1b[36m${entry.url}\x1b[0m`);
    if (entry.source) println(`  origem  \x1b[90m${entry.source}\x1b[0m`);
    if (entry.toolCallId) println(`  tool    \x1b[90m${entry.toolCallId}\x1b[0m`);
    if (entry.actionable) println('  ação    \x1b[32mrespondível pelo runtime\x1b[0m');
    if (entry.resultAction) println(`  resultado \x1b[33m${entry.resultAction}\x1b[0m`);
    if (entry.resultContent) println(`\n  conteúdo da resposta:\n${pretty(entry.resultContent, 2500)}`);
    if (entry.requestedSchema) println(`\n  schema:\n${pretty(entry.requestedSchema, 2500)}`);
    if (entry.actionable) {
        const shorthand = describeElicitationShorthand(entry.requestedSchema);
        println('\n  \x1b[90mResponda com /elicitation respond <id> <accept|decline|cancel> [json]\x1b[0m');
        if (shorthand) println(`  \x1b[90mAtalho: ${shorthand}\x1b[0m`);
        println('');
    }
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
    println(`  estado      \x1b[33m${entry.status}\x1b[0m`);
    println(`  tipo        \x1b[33m${entry.permissionType}\x1b[0m`);
    if (entry.requestId) println(`  requisição  \x1b[90m${entry.requestId}\x1b[0m`);
    if (entry.granted !== null) println(`  aprovação   \x1b[33m${String(entry.granted)}\x1b[0m`);
    if (entry.result) println(`  resultado   \x1b[33m${entry.result}\x1b[0m`);
    println(`  criada      \x1b[90m${formatTerminalIsoTimestamp(entry.createdAt)}\x1b[0m`);
    if (entry.completedAt) println(`  concluída   \x1b[90m${formatTerminalIsoTimestamp(entry.completedAt)}\x1b[0m`);
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

    println('\n  \x1b[36mPermissões SDK\x1b[0m');
    println(`  pendentes  \x1b[33m${pending.length}\x1b[0m`);
    if (latest) {
        const request = latest.requestId ? ` · requisição ${latest.requestId}` : '';
        println(
            `  recente    \x1b[90m${latest.id}\x1b[0m ${latest.permissionType}${request}`,
        );
    } else {
        println('  recente    \x1b[90m(nenhuma permissão observada)\x1b[0m');
    }

    if (typeRows.length > 0) {
        println('  por tipo   \x1b[90m' + typeRows.map(([type, count]) => `${type} ${count}`).join(' · ') + '\x1b[0m');
    } else {
        println('  por tipo   \x1b[90m(nenhuma pendência)\x1b[0m');
    }

    if (modeChanges.length > 0) {
        println('  mudanças de modo');
        for (const item of modeChanges) {
            println(`    \x1b[90m${formatTerminalIsoTimestamp(item.ts)}\x1b[0m  ${item.mode}`);
        }
    } else {
        println('  mudanças de modo \x1b[90m(sem mudanças recentes no runtime local)\x1b[0m');
    }

    println('  atalhos    \x1b[90m/permission pending · /permission show latest · /permission mode selective\x1b[0m');
    if (latest?.requestId && latest.status === 'pending') {
        println(`  atalho     \x1b[90m/permission respond ${latest.id} approve-once\x1b[0m`);
    }
    println('');
}
