// @ts-check
/**
 * Comandos SDK-first do terminal LLM-B.
 *
 * @module copilot/terminal/commands/sdk
 */

import { randomUUID } from 'node:crypto';

import { CANONICAL_LOCAL_FS_TOOL_NAMES, decideSdkFsRouting, toError } from '#copilot/core';
import { utf8ByteLength } from '#copilot/infra/public/buffer';
import { summarizeModelGatewaySdkQuotaSnapshots } from '#copilot/model-gateway';
import { isRuntimeElicitationSchema, normalizeElicitationContentWithSchema } from '../../core/elicitation-schema.js';
import {
    clearNextTurnRequestHeaders,
    getNextTurnRequestHeaders,
    setNextTurnRequestHeaders,
} from '../../presentation/state/index.js';
import { printTerminalHumanQuestionCard } from '../events/presenters/human-question/index.js';
import { compactTerminalDiagnosticId, formatTerminalToolPathForOperator } from '../events/presenters/tools/index.js';
import { readTerminalIoActivityProjection } from '../events/projections/index.js';
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
} from '../state/sdk/index.js';
import {
    formatTerminalRelativeAge,
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeRows,
    terminalThemeText,
    terminalThemeWrappedRow,
} from '../state/ui/index.js';
import { callWithRuntimeTarget, extractRuntimeTarget, renderRuntimeTargetLabel } from './runtime-target.js';

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
function renderSdkSessionPresence(value) {
    return typeof value === 'string' && value.trim() ? 'sessão ativa' : 'sem sessão SDK';
}

/** @type {readonly (readonly [string, string])[]} */
const SDK_DEFAULT_COMMAND_ROWS = Object.freeze([
    ['Modelos', '/sdk models · /sdk tools [model]'],
    ['Skills', '/sdk skills [--project <path>] [--dir <path>]'],
    ['Rotina', '/sdk quota · /sdk waits · /sdk prompt · /sdk capabilities'],
    ['Headers', '/sdk headers [k=v ...|clear]'],
    ['Simular', '/sdk simulate pergunta · /sdk doctor · /sdk compact'],
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderPermissionModeLabel(value) {
    const mode = String(value ?? '').trim();
    if (mode === 'approve_all') return 'automáticas';
    if (mode === 'audit_only') return 'auditoria sem janelas';
    if (mode === 'selective') return 'seletivas';
    return mode.replace(/[._-]+/gu, ' ') || 'n/d';
}

/**
 * @param {unknown} value
 * @returns {'approve_all' | 'audit_only' | 'selective' | null}
 */
function parsePermissionModeInput(value) {
    const mode = String(value ?? '')
        .trim()
        .toLowerCase();
    if (
        mode === 'approve_all' ||
        mode === 'automatico' ||
        mode === 'automático' ||
        mode === 'auto' ||
        mode === 'tudo'
    ) {
        return 'approve_all';
    }
    if (mode === 'audit_only' || mode === 'auditoria' || mode === 'audit') return 'audit_only';
    if (mode === 'selective' || mode === 'seletivo' || mode === 'seletiva') return 'selective';
    return null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderPermissionTypeLabel(value) {
    const type = String(value ?? '').trim();
    if (type === 'file_write' || type === 'write' || type === 'fs.write') return 'escrita de arquivo';
    if (type === 'file_read' || type === 'read' || type === 'fs.read') return 'leitura de arquivo';
    if (type === 'file_delete' || type === 'delete' || type === 'fs.delete') return 'exclusão de arquivo';
    if (type === 'file_move' || type === 'move' || type === 'fs.move') return 'movimento de arquivo';
    if (type === 'shell' || type === 'terminal.exec') return 'execução no terminal';
    return type.replace(/[._-]+/gu, ' ') || 'n/d';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderPermissionDecisionLabel(value) {
    const decision = String(value ?? '').trim();
    if (decision === 'approved' || decision === 'approve-once') return 'aprovada uma vez';
    if (decision === 'approve-for-session') return 'aprovada para a sessão';
    if (decision === 'approve-for-location') return 'aprovada para este local';
    if (decision === 'reject' || decision === 'not-approved') return 'recusada';
    if (decision === 'user-not-available') return 'operador indisponível';
    return decision.replace(/[._-]+/gu, ' ') || '';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderElicitationResultActionLabel(value) {
    const action = String(value ?? '').trim();
    if (action === 'accept') return 'aceito';
    if (action === 'decline') return 'recusado';
    if (action === 'cancel' || action === 'cancelled' || action === 'canceled') return 'cancelado';
    return action.replace(/[._-]+/gu, ' ') || 'n/d';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderElicitationModeLabel(value) {
    const mode = String(value ?? '').trim();
    if (mode === 'form') return 'formulário estruturado';
    if (mode === 'url') return 'link externo';
    if (mode === 'confirm') return 'confirmação';
    if (mode === 'select') return 'seleção';
    if (mode === 'input') return 'entrada curta';
    return mode.replace(/[._-]+/gu, ' ') || 'n/d';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderSdkInteractionStatusLabel(value) {
    const status = String(value ?? '').trim();
    if (status === 'pending') return 'aguardando operador';
    if (status === 'completed') return 'concluído';
    return status.replace(/[._-]+/gu, ' ') || 'n/d';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderSdkInteractionSourceLabel(value) {
    const source = String(value ?? '').trim();
    if (!source) return 'n/d';
    if (source === 'permissions.listPending') return 'permissões pendentes via SDK';
    if (source === 'session.ui.elicitation') return 'formulário SDK';
    if (source === 'session.ui.input') return 'entrada SDK';
    if (source === 'session.ui.confirm') return 'confirmação SDK';
    if (source === 'session.ui.select') return 'seleção SDK';
    return source.replace(/[._-]+/gu, ' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderSdkHandle(value) {
    const text = String(value ?? '').trim();
    if (!text) return 'n/d';
    if (text.length <= 18) return text;
    return `${text.slice(0, 10)}…${text.slice(-6)}`;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isSdkDiagnosticDetailToken(value) {
    const token = String(value ?? '')
        .trim()
        .toLowerCase();
    return (
        token === 'detail' ||
        token === 'details' ||
        token === 'raw' ||
        token === 'debug' ||
        token === 'full' ||
        token === '--detail' ||
        token === '--raw' ||
        token === '--debug' ||
        token === '--full'
    );
}

/**
 * @param {string[]} rest
 * @returns {{ id: string; detail: boolean }}
 */
function parseSdkShowArgs(rest) {
    const detail = rest.some((token) => isSdkDiagnosticDetailToken(token));
    const id = rest.find((token) => !isSdkDiagnosticDetailToken(token)) ?? 'latest';
    return { id, detail };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderSdkQuotaResetLabel(value) {
    if (value == null || value === '') return '-';
    const parsed =
        value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(String(value));
    if (!Number.isFinite(parsed)) return String(value);
    const now = Date.now();
    const relative = formatTerminalRelativeAge(parsed, now);
    return parsed >= now ? `em ${relative.replace(/^há\s+/u, '')}` : relative;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderSdkQuotaScopeLabel(value) {
    const scope = String(value ?? '').trim();
    if (scope === 'copilot_sdk_entitlement') return 'limite do SDK';
    if (scope === 'copilot_chat') return 'chat Copilot';
    if (scope === 'premium_interactions') return 'billing legacy por request (SDK)';
    return scope.replace(/[._-]+/gu, ' ') || 'n/d';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderSdkQuotaIdLabel(value) {
    const quotaId = String(value ?? '').trim();
    if (quotaId === 'premium_interactions') return 'Billing legacy por request (SDK)';
    if (quotaId === 'completions') return 'completions';
    if (quotaId === 'chat') return 'chat';
    return quotaId.replace(/[._-]+/gu, ' ') || 'quota';
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
 * @param {unknown} value
 * @returns {string}
 */
function renderOperatorPath(value) {
    const text = typeof value === 'string' ? value : value == null ? '' : String(value);
    return formatTerminalToolPathForOperator(text) || text || '-';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderAuditTrace(value) {
    return (
        compactTerminalDiagnosticId(typeof value === 'string' ? value : value == null ? '' : String(value), 12) ??
        'sem id'
    );
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
        println(terminalThemeRow('Próximo', guidance.nextCommand, { role: 'command' }));
    }
    for (const line of buildFailureRecoveryLines(guidance)) {
        println(terminalThemeRow('Recuperação', line));
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
        terminalThemeRow(
            'Estado',
            totalPending > 0 ? pluralPt(totalPending, 'pendência', 'pendências') : 'nenhuma pendência',
            {
                role: totalPending > 0 ? 'question' : 'success',
            },
        ),
    );
    println(
        detail
            ? terminalThemeRow(
                  'Detalhe',
                  `formulários ${pendingElicitations.pending}${pendingElicitations.latest?.mode ? ` (${pendingElicitations.latest.mode})` : ''} · permissões ${permissionSummary.pending}${permissionSummary.latest ? ` (${renderPermissionTypeLabel(permissionSummary.latest.permissionType)})` : ''} · perguntas SDK ${userInputSummary.pending}${userInputSummary.latest?.kind ? ` (${userInputSummary.latest.kind})` : ''} · perguntas estruturadas ${structuredInputPending}`,
              )
            : terminalThemeRow(
                  'Resumo',
                  renderHumanSdkWaitCounts({
                      forms: pendingElicitations.pending,
                      permissions: permissionSummary.pending,
                      questions: userInputSummary.pending,
                      inputs: structuredInputPending,
                  }),
              ),
    );

    if (pendingElicitations.pending > 0) {
        println(
            terminalThemeRow(
                'Ação',
                `${terminalThemeText('command', '/elicitation show latest')} ${terminalThemeText('muted', '·')} ${terminalThemeText('command', '/elicitation list')}`,
            ),
        );
    }
    if (permissionSummary.pending > 0) {
        println(
            terminalThemeRow(
                'Ação',
                `${terminalThemeText('command', '/permission show latest')} ${terminalThemeText('muted', '·')} ${terminalThemeText('command', '/permission all')}`,
            ),
        );
    }
    if (userInputSummary.pending > 0) {
        println(
            terminalThemeRow(
                'Ação',
                `${terminalThemeText('command', '/answer <texto>')} ${terminalThemeText('muted', 'ou responda na conversa ativa')}`,
            ),
        );
        const latest = userInputSummary.latest;
        if (latest) {
            const choices = latest.choices.length > 0 ? ` · opções ${latest.choices.join(' | ')}` : '';
            const freeform = 'texto livre permitido';
            println(
                terminalThemeRow('Pergunta', `${formatAge(latest.createdAt)} · ${latest.kind} · ${freeform}${choices}`),
            );
            if (detail) println(terminalThemeRow('ID', latest.id));
            println(terminalThemeRow('Texto', compactText(latest.question, 220), { role: 'question' }));
        }
    }
    if (structuredInputPending > 0) {
        println(
            terminalThemeRow('Ação', 'digite a resposta normalmente; o REPL destrava a pergunta estruturada pendente'),
        );
        for (const entry of structuredInputs.slice(0, 3)) {
            const choices = entry.choices.length > 0 ? ` · opções ${entry.choices.join(' | ')}` : '';
            const freeform = 'texto livre permitido';
            println(terminalThemeRow('Pergunta', `${formatAge(entry.createdAt)} · ${freeform}${choices}`));
            if (detail) println(terminalThemeRow('ID', entry.requestId));
            println(terminalThemeRow('Texto', compactText(entry.question, 220), { role: 'question' }));
        }
        if (structuredInputs.length > 3) {
            println(terminalThemeRow('Pergunta', `+${pluralPt(structuredInputs.length - 3, 'pendente', 'pendentes')}`));
        }
    }
    if (totalPending === 0) {
        println(
            terminalThemeRow(
                'Status',
                'sem espera humana viva agora; normal após resume silencioso ou sem ask_user/elicitation/permission',
            ),
        );
        println(terminalThemeRow('Histórico', '/session sdk waits · auditoria bruta em /events --raw'));
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
        if (token === '--required' || token === '--legacy-required') {
            allowFreeform = true;
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
    if (kind !== 'pergunta' && kind !== 'question' && kind !== 'request-user-input' && kind !== 'request_user_input') {
        println('');
        println(
            terminalThemeRow('Uso', '/sdk simulate pergunta [--choices "sim|nao"] [--required legado] [texto]', {
                role: 'command',
            }),
        );
        println(
            terminalThemeRow('Compatível', '/sdk simulate request-user-input continua aceito para automações legadas', {
                role: 'muted',
            }),
        );
        println('');
        return;
    }
    const parsed = parseSdkSimulateRequestUserInputArgs(tail);
    const created = createTerminalPendingStructuredUserInput({
        question: parsed.question,
        choices: parsed.choices,
        allowFreeform: true,
        data: { command: '/sdk simulate pergunta' },
    });
    println('');
    printTerminalHumanQuestionCard(println, {
        title: 'Pergunta humana estruturada',
        question: compactText(parsed.question, 220),
        choices: parsed.choices,
        allowFreeform: true,
        source: 'diagnóstico de pergunta estruturada',
        state: 'aguardando operador',
        includeDivider: true,
    });
    println(terminalThemeRow('Mais detalhes', terminalThemeText('command', '/sdk waits detail')));
    println(terminalThemeDivider(37));
    println('');
    void created.promise;
}

/**
 * @param {CommandContext} ctx
 * @param {string | null | undefined} runtimeId
 * @param {{ detail?: boolean }} [options]
 * @returns {void}
 */
function renderSdkCapabilitiesSummary({ println }, runtimeId, options = {}) {
    const capabilities = callWithRuntimeTarget(getTerminalSdkSessionCapabilities, runtimeId);
    const caps = objectOrNull(capabilities) ?? {};
    const ui = objectOrNull(caps['ui']) ?? {};
    const tools = objectOrNull(caps['tools']) ?? {};
    const plan = objectOrNull(caps['plan']) ?? {};

    println('');
    println(terminalThemeHeadline('accent', 'Capacidades SDK', ['UI', 'tools', 'plano']));
    println(terminalThemeDivider(58));
    println(
        terminalThemeRow(
            'UI',
            `formulários ${availableLabel(ui['elicitation'])} · confirmações ${availableLabel(ui['confirm'])} · seleção ${availableLabel(ui['select'])} · texto livre ${availableLabel(ui['input'])}`,
        ),
    );
    println(
        terminalThemeRow(
            'Tools',
            `workspace ${availableLabel(tools['workspace'])} · lista ${availableLabel(tools['list'])} · quota ${availableLabel(tools['quota'])}`,
        ),
    );
    println(
        terminalThemeRow(
            'Plano',
            `leitura ${availableLabel(plan['read'])} · escrita ${availableLabel(plan['write'])} · remoção ${availableLabel(plan['delete'])}`,
        ),
    );
    if (options.detail) {
        println(terminalThemeRow('Retorno', pretty(capabilities, 1200)));
    } else {
        println(
            terminalThemeRow('Mais detalhes', '/sdk capabilities detail · /sdk doctor · /sdk waits', {
                role: 'command',
            }),
        );
    }
    println('');
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
            renderSdkCapabilitiesSummary({ println }, runtimeId, {
                detail:
                    rest.includes('detail') ||
                    rest.includes('--detail') ||
                    rest.includes('raw') ||
                    rest.includes('--raw'),
            });
        } else if (sub === 'headers') {
            renderSdkRequestHeadersSummary({ println }, rest);
        } else if (sub === 'waits') {
            renderSdkWaitsSummary({ println }, runtimeId, {
                detail:
                    rest.includes('detail') ||
                    rest.includes('--detail') ||
                    rest.includes('debug') ||
                    rest.includes('--debug'),
            });
        } else if (sub === 'simulate') {
            renderSdkSimulate({ println }, rest);
        } else if (sub === 'compact') {
            const result = await callWithRuntimeTarget(compactTerminalSdkSession, runtimeId);
            println('');
            println(terminalThemeRow('SDK', 'compactação solicitada', { role: 'success' }));
            println(terminalThemeRow('Retorno', pretty(result, 700)));
            println('');
        } else {
            const state = readTerminalRuntimeState(runtimeId);
            const pendingElicitations = readTerminalElicitationSummary({ runtimeId: state.runtimeId });
            const permissionSummary = readTerminalPermissionSummary({ runtimeId: state.runtimeId });
            const userInputSummary = readTerminalUserInputSummary({ runtimeId: state.runtimeId });
            const structuredInputPending = getTerminalPendingStructuredUserInputCount();
            println('');
            println(terminalThemeHeadline('accent', 'SDK do Terminal', [renderRuntimeTargetLabel(state.runtimeId)]));
            println(terminalThemeDivider(58));
            println(terminalThemeRow('Sessão', renderSdkSessionPresence(state.sessionId)));
            println(
                terminalThemeRow('Modelo', `${state.model} · raciocínio ${state.reasoningEffort}`, { role: 'command' }),
            );
            println(
                terminalThemeRow(
                    'Esperas',
                    renderHumanSdkWaitCounts({
                        forms: pendingElicitations.pending,
                        permissions: permissionSummary.pending,
                        questions: userInputSummary.pending,
                        inputs: structuredInputPending,
                    }),
                ),
            );
            await renderSdkQuota({ println }, runtimeId, { compact: true });
            for (const [label, command] of SDK_DEFAULT_COMMAND_ROWS) {
                println(terminalThemeWrappedRow(label, command, { role: 'command', columns: 76 }));
            }
            println('');
        }
    } catch (e) {
        println('');
        println(terminalThemeRow('SDK', toError(e).message, { role: 'error' }));
        println('');
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
        println('');
        println(terminalThemeHeadline('accent', 'Headers do próximo turno'));
        if (!headers) {
            println(terminalThemeRow('Status', 'nenhum header one-shot configurado'));
            println(terminalThemeRow('Uso', '/sdk headers chave=valor ...', { role: 'command' }));
        } else {
            for (const [key, value] of Object.entries(headers)) {
                println(terminalThemeRow(key, value, { role: 'command', width: 18 }));
            }
        }
        println(
            terminalThemeRow(
                'Observação',
                'turnos com requestHeaders usam dispatch SDK direto e reanexam a conversa depois da resposta',
            ),
        );
        println('');
        return;
    }

    if (first === 'clear') {
        clearNextTurnRequestHeaders();
        println('');
        println(terminalThemeRow('Headers', 'one-shot limpos', { role: 'success' }));
        println('');
        return;
    }

    const headers = parseSdkRequestHeaders([first, ...tail]);
    if (Object.keys(headers).length === 0) {
        println('');
        println(terminalThemeRow('Headers', 'nenhum par chave=valor válido informado', { role: 'error' }));
        println(
            terminalThemeRow('Uso', '/sdk headers chave=valor [outra=coisa] ou /sdk headers clear', {
                role: 'command',
            }),
        );
        println('');
        return;
    }
    setNextTurnRequestHeaders(headers);
    println('');
    println(terminalThemeRow('Headers', 'one-shot configurados para o próximo turno do usuário', { role: 'success' }));
    for (const [key, value] of Object.entries(headers)) {
        println(terminalThemeRow(key, value, { role: 'command', width: 18 }));
    }
    println(
        terminalThemeRow('Fluxo', 'o próximo turno usa dispatch SDK direto, consome PR e depois reanexa a conversa'),
    );
    println('');
}

/**
 * @param {Record<string, unknown>} model
 * @param {string} field
 * @returns {string}
 */
function renderSdkModelStringList(model, field) {
    const value = model[field];
    if (!Array.isArray(value)) return '';
    return value.map(String).filter(Boolean).join(', ');
}

/**
 * @param {Record<string, unknown>} model
 * @returns {string}
 */
function renderSdkModelOptions(model) {
    const details = [];
    const effort = renderSdkModelStringList(model, 'supportedReasoningEfforts');
    const summaries = renderSdkModelStringList(model, 'supportedReasoningSummaries');
    const contextTiers = renderSdkModelStringList(model, 'supportedContextTiers');
    if (effort) details.push(`raciocínio ${effort}`);
    if (summaries) details.push(`resumo ${summaries}`);
    if (contextTiers) details.push(`contexto ${contextTiers}`);
    return details.join(' · ');
}

/**
 * @param {CommandContext} ctx
 * @param {string | null | undefined} runtimeId
 * @returns {Promise<void>}
 */
async function renderSdkModels({ println }, runtimeId) {
    const result = await callWithRuntimeTarget(listTerminalSdkModels, runtimeId);
    const models = arrayFromSdkList(result);
    println('');
    println(
        terminalThemeHeadline('accent', 'Modelos SDK', [
            `${models.length} ${models.length === 1 ? 'modelo' : 'modelos'}`,
        ]),
    );
    for (const model of models.slice(0, 30)) {
        const m = objectOrNull(model) ?? {};
        const id = String(m['id'] ?? m['name'] ?? model);
        const options = renderSdkModelOptions(m);
        println(terminalThemeRow('Modelo', options ? `${id} · ${options}` : id, { role: 'command' }));
    }
    if (models.length > 30)
        println(
            terminalThemeRow('Omitidos', `${models.length - 30} ${models.length - 30 === 1 ? 'modelo' : 'modelos'}`),
        );
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
        println('');
        println(terminalThemeHeadline('accent', 'Status das Skills SDK'));
        println(terminalThemeRow('Ambiente', renderRuntimeTargetLabel(state.runtimeId)));
        println(
            terminalThemeRows(
                'Uso',
                [
                    '/sdk skills para discovery',
                    '/sdk skills config para governança',
                    '/sdk skills agents para custom agents',
                ],
                { role: 'command' },
            ),
        );
        println('');
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

    println('');
    println(terminalThemeHeadline('accent', 'Skills SDK', [pluralPt(skills.length, 'skill', 'skills')]));
    println(
        terminalThemeRow(
            'Resumo',
            `ativas ${enabledCount} · desativadas ${skills.length - enabledCount} · invocáveis ${invocableCount}${sourceSummary ? ` · fontes ${sourceSummary}` : ''}`,
        ),
    );
    if (options.projectPaths?.length || options.skillDirectories?.length) {
        const filters = [
            options.projectPaths?.length ? `projeto ${options.projectPaths.join(', ')}` : null,
            options.skillDirectories?.length ? `diretório ${options.skillDirectories.join(', ')}` : null,
        ]
            .filter(Boolean)
            .join(' · ');
        println(terminalThemeRow('Filtros', filters));
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
            terminalThemeRow('Skill', `${name}${badges ? ` · ${badges}` : ''}${desc ? ` · ${desc}` : ''}`, {
                role: enabled ? 'command' : 'muted',
            }),
        );
        if (projectPath) println(terminalThemeRow('Projeto', renderOperatorPath(projectPath)));
        if (path && path !== projectPath) println(terminalThemeRow('Caminho', renderOperatorPath(path)));
    }
    if (skills.length > 40) println(terminalThemeRow('Omitidas', pluralPt(skills.length - 40, 'skill', 'skills')));
    println(
        terminalThemeRow(
            'Vocabulário',
            'custom agent = definição em SessionConfig.customAgents; subagent = uso runtime via eventos subagent.*',
        ),
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

    println('');
    println(terminalThemeHeadline('accent', 'Configuração das Skills SDK'));
    println(
        terminalThemeRow(
            'Resumo',
            `diretórios ${skillDirectories.length} · desativadas no boot ${disabledSkills.length} · desativadas na sessão ${discoveredDisabled.length}`,
        ),
    );
    println(terminalThemeRow('Dirs sessão', skillDirectories.length > 0 ? skillDirectories.join(', ') : '-'));
    println(terminalThemeRow('Boot off', disabledSkills.length > 0 ? disabledSkills.join(', ') : '-'));
    println(terminalThemeRow('Sessão off', discoveredDisabled.length > 0 ? discoveredDisabled.join(', ') : '-'));
    println(terminalThemeRow('Semântica', String(semantics['customAgentDefinition'] ?? '-')));
    println(terminalThemeRow('Subagente', String(semantics['subagentRuntime'] ?? '-')));
    println(terminalThemeRow('Mutação', String(semantics['disabledSkillsMutationScope'] ?? '-')));
    println(
        terminalThemeRows('Observação', [
            'disable/enable ajusta disabledSkills na sessão/CLI atual',
            'não reescreve automaticamente o env do processo',
        ]),
    );
    println(
        terminalThemeRows(
            'Uso',
            [
                '/sdk skills agents',
                '/sdk skills disable <skill...>',
                '/sdk skills enable <skill...>',
                '/sdk skills [--project <path>] [--dir <path>]',
            ],
            { role: 'command' },
        ),
    );
    println('');
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

    println('');
    println(
        terminalThemeHeadline('accent', 'Custom Agents e Skills', [pluralPt(customAgents.length, 'agent', 'agents')]),
    );
    println(
        terminalThemeRow(
            'Resumo',
            `agentes com preload ${agentsWithSkills.length} · inferíveis ${customAgents.filter((agent) => objectOrNull(agent)?.['infer'] !== false).length}`,
        ),
    );
    println(
        terminalThemeRow(
            'Vocabulário',
            'custom agent = definição de sessão; subagent = runtime selecionando/invocando esse custom agent',
        ),
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
            terminalThemeRow(
                'Agente',
                `${name} (${displayName}) · inferir ${String(infer)} · ferramentas ${tools ? tools.join(', ') || '[]' : 'todas'}`,
                { role: 'command' },
            ),
        );
        if (preloadSkills.length === 0) {
            println(terminalThemeRow('Preload', '-'));
            continue;
        }
        println(terminalThemeRow('Preload', preloadSkills.join(', ')));
        if (preloadEnabledSkills.length > 0)
            println(terminalThemeRow('Ativas', preloadEnabledSkills.join(', '), { role: 'success' }));
        if (preloadDisabledSkills.length > 0)
            println(terminalThemeRow('Desativadas', preloadDisabledSkills.join(', '), { role: 'error' }));
    }

    if (customAgents.length === 0) {
        println(terminalThemeRow('Status', 'nenhum custom agent configurado nesta sessão'));
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
        println('');
        println(terminalThemeRow('Skills', 'nenhuma skill informada', { role: 'error' }));
        println(terminalThemeRow('Uso', `/sdk skills ${action} <skill...>`, { role: 'command' }));
        println('');
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

    println('');
    println(terminalThemeRow('Skills', `lista da sessão atualizada via SDK (${action})`, { role: 'success' }));
    println(terminalThemeRow('Solicitadas', requested.join(', ')));
    println(terminalThemeRow('Sessão off', disabledSkills.length > 0 ? disabledSkills.join(', ') : '-'));
    println(
        terminalThemeRow(
            'Escopo',
            'altera a sessão/CLI atual via server RPC; não reescreve automaticamente COPILOT_DISABLED_SKILLS do processo',
        ),
    );
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
    const registrySnapshot = readTerminalToolRegistrySnapshot();
    const contract = registrySnapshot.toolContract;
    println('');
    println(
        terminalThemeHeadline('tool', 'Ferramentas SDK', [
            model ? `modelo ${model}` : null,
            pluralPt(tools.length, 'ferramenta nativa', 'ferramentas nativas'),
        ]),
    );
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
    if (tools.length > 50)
        println(terminalThemeRow('Omitidas', pluralPt(tools.length - 50, 'ferramenta', 'ferramentas')));
    println('');
    println(terminalThemeHeadline('tool', 'Registry local canônico'));
    println(terminalThemeRow('Total', String(registrySnapshot.total), { role: 'info' }));
    println(
        terminalThemeRow('Arquivos', activeLabel(registrySnapshot.hasCanonicalLocalFsTools), {
            role: registrySnapshot.hasCanonicalLocalFsTools ? 'success' : 'warn',
        }),
    );
    println(
        terminalThemeRow('Terminal', activeLabel(registrySnapshot.hasCanonicalLocalExecTools), {
            role: registrySnapshot.hasCanonicalLocalExecTools ? 'success' : 'warn',
        }),
    );
    println(
        terminalThemeRow(
            'Terminal SDK legado',
            registrySnapshot.hasLegacySdkShellToolsLoaded ? 'carregado' : 'não carregado',
            { role: registrySnapshot.hasLegacySdkShellToolsLoaded ? 'warn' : 'muted' },
        ),
    );
    println(
        terminalThemeRow('Desativadas', String(registrySnapshot.disabled.length), {
            role: registrySnapshot.disabled.length > 0 ? 'warn' : 'muted',
        }),
    );
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
    const role = state === 'bad' ? 'error' : state === 'warn' ? 'warn' : 'success';
    if (!opts.compact) {
        println('');
        println(terminalThemeHeadline('accent', 'Quota SDK'));
    }
    for (const row of quotaSummary.rows) {
        const pct = row.remainingPercentage === null ? '?' : `${row.remainingPercentage.toFixed(1)}%`;
        const quotaLabel = renderSdkQuotaIdLabel(row.quotaId);
        println(
            terminalThemeRow(
                opts.compact ? 'Quota' : quotaLabel,
                `${opts.compact ? `${quotaLabel} · ` : ''}${pct} restante · reset ${renderSdkQuotaResetLabel(row.resetAt)} · fonte ${renderSdkQuotaScopeLabel(row.scope)}`,
                { role },
            ),
        );
    }
    if (Object.keys(snapshots).length === 0) println(terminalThemeRow('Quota', 'sem snapshots no retorno SDK'));
    if (!opts.compact) {
        if (usageMetrics) {
            const summary = pretty(usageMetrics, 700).replace(/\n+/g, ' ');
            println(terminalThemeRow('Usage RPC', summary));
        } else if (usageMetricsError) {
            println(terminalThemeRow('Usage RPC', `indisponível: ${usageMetricsError}`, { role: 'warn' }));
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

    println('');
    println(terminalThemeHeadline('accent', 'System Prompt SDK'));
    println(
        terminalThemeRow(
            'Modo',
            `${String(status['effectiveMode'] ?? '?')} · live ${String(status['effectiveLiveMode'] ?? '?')} · reload ${String(status['liveReloadMechanism'] ?? '?')}`,
            { role: 'command' },
        ),
    );
    println(
        terminalThemeRow(
            'Config',
            `${String(status['configPath'] ?? '-')} · auto reload ${yesNo(Boolean(status['autoReload']))}`,
        ),
    );
    println(
        terminalThemeRow(
            'SDK',
            `customize ${yesNo(Boolean(sdkCompatibility['supportsCustomizeMode']))} · sources RPC ${yesNo(Boolean(sdkCompatibility['supportsInstructionSourcesRpc']))}`,
        ),
    );
    println(
        terminalThemeRow(
            'Digest',
            `${String(revision['digest'] ?? '-')} · seções ${sections.length} · anexos ${appendFiles.length}`,
        ),
    );
    println(
        terminalThemeRow(
            'Sessão',
            `${renderSdkSessionPresence(sessionId)} · fontes ${sessionAvailable ? 'disponíveis' : 'nenhuma'}`,
        ),
    );
    println(
        terminalThemeRow(
            'Binding',
            `${String(binding['digest'] ?? '-')} · defasado ${yesNo(Boolean(freshness['isStale']))} · ação ${renderSdkPromptActionLabel(freshness['recommendedAction'])}`,
        ),
    );

    if (freshness['reason']) {
        println(terminalThemeRow('Motivo', String(freshness['reason'])));
    }

    if (limitations.length > 0) {
        println(terminalThemeHeadline('warn', 'Limitações'));
        for (const limitation of limitations.slice(0, 4)) {
            println(terminalThemeRow('Limite', String(limitation), { role: 'warn' }));
        }
    }

    if (instructionSources) {
        println(terminalThemeHeadline('accent', 'Fontes de instrução'));
        println(terminalThemeRow('Retorno', pretty(instructionSources, 1200)));
    } else if (instructionSourcesError) {
        println(terminalThemeRow('Fontes', `indisponíveis: ${String(instructionSourcesError)}`, { role: 'warn' }));
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
    const rawOutput =
        rest.includes('--raw') || rest.includes('raw') || rest.includes('--json') || rest.includes('json');
    try {
        if (sub === 'read') {
            const path = rest.join(' ').trim();
            if (!path) {
                println(terminalThemeRow('Uso', '/workspace read <path>', { role: 'command' }));
                return;
            }
            const result = await callWithRuntimeTarget(readTerminalSdkWorkspaceFile, runtimeId, path);
            println('');
            println(terminalThemeHeadline('fileRead', 'Workspace SDK virtual', [renderOperatorPath(path)]));
            println(terminalThemeRow('Escopo', 'SDK virtual; não é FS local'));
            println(terminalThemeRow('Retorno', pretty(result, 4000)));
            println('');
        } else if (sub === 'write') {
            const path = rest.shift();
            const content = rest.join(' ');
            if (!path || !content) {
                println(terminalThemeRow('Uso', '/workspace write <path> <content>', { role: 'command' }));
                return;
            }
            const result = await callWithRuntimeTarget(createTerminalSdkWorkspaceFile, runtimeId, path, content);
            println('');
            println(terminalThemeRow('Workspace', 'arquivo escrito no SDK virtual', { role: 'success' }));
            println(terminalThemeRow('Arquivo', renderOperatorPath(path), { role: 'fileWrite' }));
            println(terminalThemeRow('Retorno', pretty(result, 500)));
            println('');
        } else if (sub === 'sync' || sub === 'materialize') {
            const sourcePath = rest[0] ?? '';
            if (!sourcePath.trim()) {
                println(
                    terminalThemeRow('Uso', '/workspace sync <sdkPath> [--to <localPath>] [--overwrite]', {
                        role: 'command',
                    }),
                );
                return;
            }
            const flags = parseWorkspaceMaterializeFlags(rest.slice(1));
            const destinationPath = flags.to ?? sourcePath;
            const readResult = await callWithRuntimeTarget(readTerminalSdkWorkspaceFile, runtimeId, sourcePath);
            const content = workspaceReadContent(readResult);
            if (content === null) {
                println('');
                println(
                    terminalThemeRow('Workspace', 'conteúdo não textual/indisponível para materialização', {
                        role: 'error',
                    }),
                );
                println(terminalThemeRow('Retorno', pretty(readResult, 900)));
                println('');
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
                println('');
                println(
                    terminalThemeRow('Materialização', String(writeResult['error'] ?? 'erro desconhecido'), {
                        role: 'error',
                    }),
                );
                println(
                    terminalThemeRow(
                        'Correção',
                        'use --overwrite para substituir arquivo local já existente quando apropriado',
                        { role: 'command' },
                    ),
                );
                println('');
                await renderCommandFailureGuidance(println, runtimeId);
                return;
            }

            println('');
            println(terminalThemeRow('Materialização', 'SDK para FS concluída', { role: 'success' }));
            println(terminalThemeRow('Origem', renderOperatorPath(sourcePath), { role: 'fileRead' }));
            println(terminalThemeRow('Destino', renderOperatorPath(destinationPath), { role: 'fileWrite' }));
            const io = ioSummary(writeResult);
            if (io) println(terminalThemeRow('I/O', io));
            println(terminalThemeRow('Bytes', String(writeResult['bytesWritten'] ?? content.length)));
            println('');
        } else if (sub === 'mirror' || sub === 'sync-all') {
            const flags = parseWorkspaceMaterializeFlags(rest);
            const targetRoot = flags.to ?? '.copilot/sdk-workspace-mirror';
            const listResult = await callWithRuntimeTarget(listTerminalSdkWorkspaceFiles, runtimeId);
            const files = workspaceListPaths(listResult);
            if (files.length === 0) {
                println('');
                println(
                    terminalThemeRow('Workspace', 'SDK virtual vazio ou sem paths materializáveis', { role: 'warn' }),
                );
                println(terminalThemeRow('Retorno', pretty(listResult, 900)));
                println('');
                return;
            }

            let ok = 0;
            let fail = 0;
            for (const sourcePath of files) {
                const readResult = await callWithRuntimeTarget(readTerminalSdkWorkspaceFile, runtimeId, sourcePath);
                const content = workspaceReadContent(readResult);
                if (content === null) {
                    fail += 1;
                    println(
                        terminalThemeRow('Ignorado', `${renderOperatorPath(sourcePath)} · conteúdo não textual`, {
                            role: 'warn',
                        }),
                    );
                    continue;
                }
                const destinationPath = `${targetRoot.replace(/\/$/u, '')}/${sourcePath}`;
                const writeResult = await materializeWorkspaceFile(
                    { println },
                    { destinationPath, content, overwrite: flags.overwrite },
                );
                if (writeResult['success'] === true) {
                    ok += 1;
                    println(
                        terminalThemeRow(
                            'Mirror',
                            `${renderOperatorPath(sourcePath)} → ${renderOperatorPath(destinationPath)}`,
                            { role: 'success' },
                        ),
                    );
                } else {
                    fail += 1;
                    println(
                        terminalThemeRow(
                            'Mirror',
                            `${renderOperatorPath(sourcePath)} · ${String(writeResult['error'] ?? 'erro')}`,
                            {
                                role: 'error',
                            },
                        ),
                    );
                }
            }

            println('');
            println(
                terminalThemeRow(
                    'Mirror SDK',
                    `concluído · ok ${ok} · falhas ${fail} · destino ${renderOperatorPath(targetRoot)}`,
                    {
                        role: fail > 0 ? 'warn' : 'success',
                    },
                ),
            );
            println('');
        } else if (sub === 'promote' || sub === 'push' || sub === 'import') {
            const sourcePath = rest[0] ?? '';
            if (!sourcePath.trim()) {
                println(
                    terminalThemeRow('Uso', '/workspace promote <localPath> [--to <sdkPath>] [--overwrite]', {
                        role: 'command',
                    }),
                );
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
                println('');
                println(terminalThemeRow('Promoção', result.reason, { role: 'error' }));
                if (result.conflict) {
                    println(
                        terminalThemeRow(
                            'Conflito',
                            'política fail-if-exists · ação conflict · use --overwrite com intenção explícita',
                            { role: 'warn' },
                        ),
                    );
                }
                println(terminalThemeRow('Auditoria', `trace ${renderAuditTrace(result.traceId)}`));
                println('');
                await renderCommandFailureGuidance(println, runtimeId);
                return;
            }

            println('');
            println(terminalThemeRow('Promoção', 'FS para SDK concluída', { role: 'success' }));
            println(terminalThemeRow('Origem', renderOperatorPath(sourcePath), { role: 'fileRead' }));
            println(terminalThemeRow('Destino', renderOperatorPath(destinationPath), { role: 'fileWrite' }));
            println(
                terminalThemeRow(
                    'Política',
                    `${flags.overwrite ? 'overwrite' : 'fail-if-exists'} · ação ${result.action} · bytes ${result.bytes} · auditoria ${renderAuditTrace(result.traceId)}`,
                ),
            );
            println('');
        } else {
            const result = await callWithRuntimeTarget(listTerminalSdkWorkspaceFiles, runtimeId);
            const files = arrayFromSdkList(result);
            println('');
            println(
                terminalThemeHeadline('fileRead', 'Workspace SDK virtual', [
                    files.length ? `${files.length} ${files.length === 1 ? 'arquivo' : 'arquivos'}` : 'vazio',
                ]),
            );
            if (files.length > 0) {
                for (const file of files.slice(0, 80)) {
                    const f = objectOrNull(file) ?? {};
                    println(
                        terminalThemeRow('Arquivo', renderOperatorPath(f['path'] ?? f['name'] ?? file), {
                            role: 'fileRead',
                        }),
                    );
                }
                if (files.length > 80)
                    println(
                        terminalThemeRow(
                            'Omitidos',
                            `${files.length - 80} ${files.length - 80 === 1 ? 'arquivo' : 'arquivos'}`,
                        ),
                    );
            } else if (rawOutput) {
                println(terminalThemeRow('Retorno', pretty(result, 1500)));
            } else {
                println(terminalThemeRow('Estado', 'nenhum arquivo no workspace SDK virtual', { role: 'muted' }));
                println(
                    terminalThemeRow('Escopo', 'SDK virtual separado do FS local; use /fs list para o repositório'),
                );
            }
            println(terminalThemeWrappedRow('Listar', '/workspace list', { role: 'command', columns: 76 }));
            println(
                terminalThemeWrappedRow('SDK', '/workspace read <path> · /workspace write <path> <content>', {
                    role: 'command',
                    columns: 76,
                }),
            );
            println(
                terminalThemeWrappedRow('Sync', '/workspace sync <sdkPath> --to <localPath> [--overwrite]', {
                    role: 'command',
                    columns: 76,
                }),
            );
            println(
                terminalThemeWrappedRow('Mirror', '/workspace mirror --to <localDir> [--overwrite]', {
                    role: 'command',
                    columns: 76,
                }),
            );
            println(
                terminalThemeWrappedRow('Promover', '/workspace promote <localPath> --to <sdkPath> [--overwrite]', {
                    role: 'command',
                    columns: 76,
                }),
            );
            println(terminalThemeWrappedRow('Contrato', 'list/read/write ficam no workspace SDK virtual'));
            println(terminalThemeWrappedRow('Materializar', 'sync/mirror copiam SDK para FS local'));
            println(terminalThemeWrappedRow('Importar', 'promote copia FS local para SDK virtual'));
            println('');
        }
    } catch (e) {
        println('');
        println(terminalThemeRow('Workspace', toError(e).message, { role: 'error' }));
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
            println('');
            println(
                terminalThemeRow('Confirmação', `session.ui.confirm concluído · ${String(result)}`, {
                    role: 'success',
                }),
            );
            println('');
        } else if (sub === 'select') {
            const { left, right } = splitAtDoubleDash(rest);
            const message = left.join(' ').trim() || 'Selecione uma opção';
            const options = right
                .join(' ')
                .split('|')
                .map((item) => item.trim())
                .filter(Boolean);
            if (options.length === 0) {
                println(
                    terminalThemeRow('/elicitation', 'Uso: /elicitation select <mensagem> -- opcao1|opcao2|opcao3', {
                        role: 'command',
                    }),
                );
                return;
            }
            const result = await callWithRuntimeTarget(selectTerminalSdkSessionUi, runtimeId, message, options);
            println('');
            println(
                terminalThemeRow('Seleção', `session.ui.select concluído · ${String(result)}`, { role: 'success' }),
            );
            println('');
        } else if (sub === 'input') {
            const { left, right } = splitAtDoubleDash(rest);
            const message = left.join(' ').trim() || 'Informe um valor';
            const parsed = parseJsonObject(right);
            if (parsed.error) {
                println(terminalThemeRow('JSON', `inválido: ${parsed.error}`, { role: 'error' }));
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
            println('');
            println(terminalThemeRow('Entrada', `session.ui.input concluído · ${String(result)}`, { role: 'success' }));
            println('');
        } else if (sub === 'capabilities') {
            const available = await Promise.resolve(
                callWithRuntimeTarget(isTerminalSdkSessionUiElicitationAvailable, runtimeId),
            );
            const ok = available;
            println('');
            println(terminalThemeHeadline('question', 'Session UI'));
            println(terminalThemeDivider(37));
            println(
                terminalThemeRow('Session UI', ok ? 'disponível' : 'indisponível', { role: ok ? 'success' : 'warn' }),
            );
            println(terminalThemeDivider(37));
            println('');
        } else if (sub === 'show') {
            const showArgs = parseSdkShowArgs(rest);
            renderElicitationEntry({ println }, getTerminalElicitation(showArgs.id, { runtimeId }), {
                detail: showArgs.detail,
            });
        } else if (sub === 'clear') {
            const ok = clearTerminalElicitation(rest[0] || 'latest');
            println(
                terminalThemeRow('Formulário', ok ? 'removido da UX local' : 'não encontrado', {
                    role: ok ? 'success' : 'warn',
                }),
            );
        } else if (sub === 'respond') {
            const [id = 'latest', action, ...jsonRest] = rest;
            const entry = getTerminalElicitation(id, { runtimeId });
            if (!entry) {
                println(terminalThemeRow('Formulário', 'não encontrado', { role: 'warn' }));
                return;
            }
            const parsedResult = parseElicitationResult(action, jsonRest, entry.requestedSchema);
            if (!parsedResult.ok) {
                println(terminalThemeRow('Resposta', `inválida: ${parsedResult.error}`, { role: 'error' }));
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
                    ? `\n${terminalThemeRow('Formulário', `respondido · ${entry.id}`, { role: 'success' })}\n`
                    : `\n${terminalThemeRow('Formulário', `não está mais pendente · ${entry.id}`, { role: 'warn' })}\n`,
            );
        } else if (sub === 'request') {
            const message = rest.join(' ').trim() || 'Informe os dados solicitados.';
            const result = await callWithRuntimeTarget(
                requestTerminalSdkElicitation,
                runtimeId,
                message,
                defaultElicitationSchema(),
            );
            println('');
            println(terminalThemeRow('Formulário', 'Elicitation SDK concluída', { role: 'success' }));
            println(terminalThemeRow('Resultado', pretty(result, 1500)));
            println('');
        } else if (sub === 'request-json') {
            const { left, right } = splitAtDoubleDash(rest);
            const message =
                (right.length > 0 ? left.join(' ').trim() : rest.shift()) ?? 'Informe os dados solicitados.';
            const parsed = parseJsonObject(right.length > 0 ? right : rest);
            if (parsed.error || !parsed.json) {
                println(terminalThemeRow('JSON', `inválido: ${parsed.error ?? 'schema ausente'}`, { role: 'error' }));
                return;
            }
            if (!isRuntimeElicitationSchema(parsed.json)) {
                println(
                    terminalThemeRow('Schema', 'inválido: esperado { "type": "object", "properties": { ... } }.', {
                        role: 'error',
                    }),
                );
                return;
            }
            const result = await callWithRuntimeTarget(requestTerminalSdkElicitation, runtimeId, message, parsed.json);
            println('');
            println(terminalThemeRow('Formulário', 'Elicitation SDK concluída', { role: 'success' }));
            println(terminalThemeRow('Resultado', pretty(result, 1500)));
            println('');
        } else {
            const entries = listTerminalElicitations({ includeCompleted: sub === 'all', runtimeId });
            if (entries.length === 0) {
                println('');
                println(terminalThemeRow('Formulários', 'nenhum pendente na UX local'));
            } else {
                println('');
                println(terminalThemeHeadline('question', 'Formulários SDK', [String(entries.length)]));
                println(terminalThemeDivider(37));
                for (const entry of entries) {
                    println(
                        terminalThemeRow(
                            'Formulário',
                            `${entry.id} · ${entry.mode}${entry.actionable ? ' · respondível' : ''} · ${entry.message.slice(0, 90)}${entry.source ? ` · via ${entry.source}` : ''}`,
                            { role: entry.status === 'pending' ? 'question' : 'muted' },
                        ),
                    );
                }
                println(terminalThemeDivider(37));
            }
            println(
                terminalThemeRow(
                    'Uso',
                    '/elicitation [list|all|capabilities|confirm|select|input|show|clear|request|request-json|respond]',
                    { role: 'command' },
                ),
            );
            println(
                terminalThemeRow(
                    'Nota',
                    'pergunta humana = conversa READY/REPLY; elicitation = formulário/URL estruturado do SDK.',
                ),
            );
            println('');
        }
    } catch (e) {
        println(`\n${terminalThemeRow('Elicitation SDK', toError(e).message, { role: 'error' })}\n`);
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
            println('');
            println(terminalThemeHeadline('question', 'Modo de permissões'));
            println(terminalThemeDivider(37));
            println(terminalThemeRow('Modo', renderPermissionModeLabel(current), { role: 'warn' }));
            println(
                terminalThemeRow(
                    'Prompts SDK',
                    `${sdkPromptsSkipped ? 'ignorados' : 'seletivos'} · ${sdkPromptsSkipped ? 'sem janelas SDK por padrão' : 'pode solicitar autorização conforme política'}`,
                ),
            );
            println(terminalThemeRow('Uso', '/permission mode <automatico|auditoria|seletivo>', { role: 'command' }));
            println(terminalThemeDivider(37));
            println('');
            return;
        }
        const nextMode = parsePermissionModeInput(next);
        if (!nextMode) {
            println(
                terminalThemeRow('/permission', 'Uso: /permission mode <automatico|auditoria|seletivo>', {
                    role: 'command',
                }),
            );
            return;
        }
        const updated = setTerminalRuntimePermissionMode(nextMode, runtimeId);
        const sdkPromptsSkipped = terminalPermissionModeSkipsSdkPrompts(updated);
        println('');
        println(
            terminalThemeRow('Modo', `permissões atualizadas: ${renderPermissionModeLabel(updated)}`, {
                role: 'success',
            }),
        );
        println(
            terminalThemeRow(
                'Prompts SDK',
                `${sdkPromptsSkipped ? 'ignorados' : 'seletivos'} · ${sdkPromptsSkipped ? 'sem janelas SDK por padrão' : 'pode solicitar autorização conforme política'}`,
            ),
        );
        println('');
        return;
    }
    if (sub === 'show') {
        const showArgs = parseSdkShowArgs(rest);
        renderPermissionEntry({ println }, getTerminalPermission(showArgs.id, { runtimeId }), {
            detail: showArgs.detail,
        });
        return;
    }
    if (sub === 'respond' || sub === 'resolve') {
        const idArg = rest[0];
        const actionArg = rest[1];
        const payloadArg = rest.slice(2).join(' ').trim();
        const entry = getTerminalPermission(idArg || 'latest', { runtimeId });
        if (!entry || !entry.requestId) {
            println(
                terminalThemeRow('Permissão', 'não encontrada ou sem requestId canônico para responder', {
                    role: 'warn',
                }),
            );
            return;
        }
        const decision = parsePermissionDecision(actionArg);
        if (!decision) {
            println(
                terminalThemeRow(
                    '/permission',
                    'Uso: /permission respond <id|latest> <approve-once|approve-for-session|approve-for-location|reject|user-not-available> [json]',
                    { role: 'command' },
                ),
            );
            return;
        }
        /** @type {Record<string, unknown>} */
        let payload = {};
        if (payloadArg) {
            try {
                const parsed = JSON.parse(payloadArg);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    println(terminalThemeRow('Payload', 'opcional deve ser um JSON object', { role: 'warn' }));
                    return;
                }
                payload = /** @type {Record<string, unknown>} */ (parsed);
            } catch (error) {
                println(terminalThemeRow('JSON', `inválido: ${toError(error).message}`, { role: 'error' }));
                return;
            }
        }
        const permissionResult = /** @type {{ kind: string } & Record<string, unknown>} */ ({
            ...decision,
            ...payload,
        });
        const validationError = validatePermissionDecisionResult(permissionResult);
        if (validationError) {
            println(terminalThemeRow('Permissão', validationError, { role: 'warn' }));
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
        println('');
        println(
            terminalThemeRow('Permissão', `resposta enviada · ${entry.requestId} · ${decision.kind}`, {
                role: 'success',
            }),
        );
        println(terminalThemeRow('Resultado', pretty(result, 700)));
        println('');
        return;
    }
    if (sub === 'pending') {
        const remote = await callWithRuntimeTarget(listTerminalSdkPendingPermissions, runtimeId);
        const resolvedRuntimeId = readTerminalRuntimeState(runtimeId).runtimeId;
        if (!remote.available) {
            println('');
            println(terminalThemeRow('Permissões', 'listagem ativa indisponível no SDK atual', { role: 'warn' }));
            println(terminalThemeRow('Fallback', 'usando estado observado local (/permission list).'));
            println('');
        } else {
            const requests = Array.isArray(remote.requests) ? remote.requests : [];
            println('');
            println(terminalThemeHeadline('question', 'Permissões pendentes via RPC', [String(requests.length)]));
            println(terminalThemeDivider(37));
            println(terminalThemeRow('Fonte', String(remote.source ?? 'unknown')));
            if (requests.length === 0) {
                println(
                    terminalThemeRow('Permissões', 'nenhuma pendente reportada pela sessão SDK', { role: 'success' }),
                );
                println(terminalThemeDivider(37));
                println('');
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
                println(
                    terminalThemeRow('Permissão', `alça ${requestId} · ${renderPermissionTypeLabel(permissionType)}`, {
                        role: 'question',
                    }),
                );
            }
            println(terminalThemeDivider(37));
            println('');
            return;
        }
    }
    if (sub === 'reset-approvals') {
        const result = await callWithRuntimeTarget(resetTerminalSdkSessionApprovals, runtimeId);
        println('');
        println(terminalThemeRow('Aprovações', 'sessão resetada', { role: 'success' }));
        println(terminalThemeRow('Resultado', pretty(result, 700)));
        println('');
        return;
    }
    if (sub === 'cockpit' || sub === 'panel') {
        renderPermissionCockpit({ println }, runtimeId);
        return;
    }
    if (sub === 'clear') {
        const ok = clearTerminalPermission(rest[0] || 'latest');
        println(
            terminalThemeRow('Permissão', ok ? 'removida da UX local' : 'não encontrada', {
                role: ok ? 'success' : 'warn',
            }),
        );
        return;
    }

    const entries = listTerminalPermissions({ includeCompleted: sub === 'all', runtimeId });
    if (entries.length === 0) {
        println('');
        println(terminalThemeRow('Permissões', 'nenhuma pendente na UX local'));
    } else {
        println('');
        println(terminalThemeHeadline('question', 'Permissões SDK', [String(entries.length)]));
        println(terminalThemeDivider(37));
        for (const entry of entries) {
            const result = entry.granted == null ? entry.result : entry.granted ? 'approved' : 'not-approved';
            println(
                terminalThemeRow(
                    'Permissão',
                    `${entry.id} · ${renderPermissionTypeLabel(entry.permissionType)} · ${entry.status}${result ? ` · ${renderPermissionDecisionLabel(result)}` : ''}`,
                    { role: entry.status === 'pending' ? 'question' : entry.granted === false ? 'warn' : 'muted' },
                ),
            );
        }
        println(terminalThemeDivider(37));
    }
    println(
        terminalThemeRow('Uso', '/permission [list|pending|reset-approvals|cockpit|all|show|clear|mode|respond]', {
            role: 'command',
        }),
    );
    println(
        terminalThemeRow('Nota', 'Permissões são decididas pelo SDK/hook; este comando é observabilidade operacional.'),
    );
    println('');
}

/**
 * @param {CommandContext} ctx
 * @param {ReturnType<typeof getTerminalElicitation>} entry
 * @param {{ detail?: boolean }} [options]
 * @returns {void}
 */
function renderElicitationEntry({ println }, entry, options = {}) {
    if (!entry) {
        println(terminalThemeRow('Formulário', 'não encontrado', { role: 'warn' }));
        return;
    }
    const detail = options.detail === true;
    println('');
    println(
        terminalThemeHeadline('question', 'Formulário SDK', [
            renderSdkInteractionStatusLabel(entry.status),
            detail ? `id ${entry.id}` : null,
        ]),
    );
    println(terminalThemeDivider(37));
    println(
        terminalThemeRow('Estado', renderSdkInteractionStatusLabel(entry.status), {
            role: entry.status === 'pending' ? 'question' : 'muted',
        }),
    );
    println(terminalThemeRow('Modo', renderElicitationModeLabel(entry.mode)));
    println(terminalThemeRow('Mensagem', entry.message, { role: 'question' }));
    if (entry.url) println(terminalThemeRow('URL', entry.url, { role: 'command' }));
    if (entry.source) println(terminalThemeRow('Origem', renderSdkInteractionSourceLabel(entry.source)));
    if (detail && entry.toolCallId) println(terminalThemeRow('Tool call', renderSdkHandle(entry.toolCallId)));
    if (detail && entry.requestId) println(terminalThemeRow('Alça', renderSdkHandle(entry.requestId)));
    if (entry.actionable) println(terminalThemeRow('Ação', 'respondível pela sessão', { role: 'success' }));
    if (entry.resultAction)
        println(
            terminalThemeRow('Resultado', renderElicitationResultActionLabel(entry.resultAction), { role: 'warn' }),
        );
    println(terminalThemeRow('Criado', formatTerminalRelativeAge(entry.createdAt)));
    if (entry.completedAt) println(terminalThemeRow('Concluído', formatTerminalRelativeAge(entry.completedAt)));
    println(terminalThemeDivider(37));
    if (entry.actionable) {
        const shorthand = describeElicitationShorthand(entry.requestedSchema);
        println(
            terminalThemeRow('Responder', '/elicitation respond latest <accept|decline|cancel> [json]', {
                role: 'command',
            }),
        );
        if (shorthand) println(terminalThemeRow('Atalho', shorthand, { role: 'command' }));
    }
    if (detail) {
        if (entry.resultContent) println(`\n  conteúdo da resposta:\n${pretty(entry.resultContent, 2500)}`);
        if (entry.requestedSchema) println(`\n  schema:\n${pretty(entry.requestedSchema, 2500)}`);
        if (entry.data) println(`\n  data:\n${pretty(entry.data, 2500)}`);
    } else {
        println(terminalThemeRow('Mais detalhes', '/elicitation show latest detail', { role: 'command' }));
    }
    println('');
}

/**
 * @param {CommandContext} ctx
 * @param {ReturnType<typeof getTerminalPermission>} entry
 * @param {{ detail?: boolean }} [options]
 * @returns {void}
 */
function renderPermissionEntry({ println }, entry, options = {}) {
    if (!entry) {
        println(terminalThemeRow('Permissão', 'não encontrada', { role: 'warn' }));
        return;
    }
    const detail = options.detail === true;
    println('');
    println(
        terminalThemeHeadline('question', 'Permissão SDK', [
            renderSdkInteractionStatusLabel(entry.status),
            detail ? `id ${entry.id}` : null,
        ]),
    );
    println(terminalThemeDivider(37));
    println(
        terminalThemeRow('Estado', renderSdkInteractionStatusLabel(entry.status), {
            role: entry.status === 'pending' ? 'question' : 'muted',
        }),
    );
    println(terminalThemeRow('Tipo', renderPermissionTypeLabel(entry.permissionType), { role: 'warn' }));
    if (detail && entry.requestId) println(terminalThemeRow('Alça', renderSdkHandle(entry.requestId)));
    if (entry.granted !== null)
        println(
            terminalThemeRow('Aprovação', entry.granted ? 'aprovada' : 'não aprovada', {
                role: entry.granted ? 'success' : 'warn',
            }),
        );
    if (entry.result)
        println(terminalThemeRow('Resultado', renderPermissionDecisionLabel(entry.result), { role: 'warn' }));
    println(terminalThemeRow('Criada', formatTerminalRelativeAge(entry.createdAt)));
    if (entry.completedAt) println(terminalThemeRow('Concluída', formatTerminalRelativeAge(entry.completedAt)));
    if (entry.status === 'pending' && entry.requestId) {
        println(
            terminalThemeRow(
                'Ação',
                '/permission respond latest <approve-once|approve-for-session|approve-for-location|reject|user-not-available>',
                { role: 'command' },
            ),
        );
    }
    println(terminalThemeDivider(37));
    if (detail) {
        println(`\n  data:\n${pretty(entry.data, 2500)}\n`);
    } else {
        println(terminalThemeRow('Mais detalhes', '/permission show latest detail', { role: 'command' }));
        println('');
    }
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
        const key = renderPermissionTypeLabel(entry.permissionType || 'unknown');
        byType.set(key, (byType.get(key) ?? 0) + 1);
    }
    const typeRows = [...byType.entries()].sort((a, b) => b[1] - a[1]);
    const latest = readTerminalPermissionSummary({ runtimeId: scopedRuntimeId }).latest;
    const modeChanges = listTerminalPermissionModeHistory({ limit: 4 });

    println('');
    println(terminalThemeHeadline('question', 'Permissões SDK'));
    println(terminalThemeDivider(37));
    println(
        terminalThemeRow('Pendentes', String(pending.length), { role: pending.length > 0 ? 'question' : 'success' }),
    );
    if (latest) {
        const request = latest.requestId ? ` · alça ${latest.requestId}` : '';
        println(
            terminalThemeRow('Recente', `${latest.id} · ${renderPermissionTypeLabel(latest.permissionType)}${request}`),
        );
    } else {
        println(terminalThemeRow('Recente', '(nenhuma permissão observada)'));
    }

    if (typeRows.length > 0) {
        println(terminalThemeRow('Por tipo', typeRows.map(([type, count]) => `${type} ${count}`).join(' · ')));
    } else {
        println(terminalThemeRow('Por tipo', '(nenhuma pendência)'));
    }

    if (modeChanges.length > 0) {
        println(terminalThemeHeadline('question', 'Mudanças de modo'));
        for (const item of modeChanges) {
            println(
                terminalThemeRow(
                    'Mudança',
                    `${formatTerminalRelativeAge(item.ts)} · ${renderPermissionModeLabel(item.mode)}`,
                ),
            );
        }
    } else {
        println(terminalThemeRow('Mudanças', '(sem mudanças recentes no runtime local)'));
    }

    println(
        terminalThemeRow('Atalhos', '/permission pending · /permission show latest · /permission mode seletivo', {
            role: 'command',
        }),
    );
    if (latest?.requestId && latest.status === 'pending') {
        println(terminalThemeRow('Atalho', `/permission respond ${latest.id} approve-once`, { role: 'command' }));
    }
    println(terminalThemeDivider(37));
    println('');
}
