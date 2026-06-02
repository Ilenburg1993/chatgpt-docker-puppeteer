// @ts-check
/**
 * Presenter puro para narrativa de tools no terminal.
 *
 * O SDK envia eventos de tool em formatos diferentes conforme origem. Este módulo concentra a heurística visual: nome
 * legível, caminho provável, intenção operacional e preview seguro para stdout.
 *
 * @module copilot/terminal/tool-activity-presenter
 */

import { resolveToolName } from '#copilot/config';
import { introspectToolTargets } from '../../core/tool-target-introspection.js';

const FILE_OPERATION_PATTERNS = /** @type {const} */ ([
    { match: /\b(read|view|open|cat|show)\b/i, operation: 'read', label: 'lendo arquivo' },
    { match: /\b(write|create|save)\b/i, operation: 'write', label: 'escrevendo arquivo' },
    { match: /\b(edit|patch|apply|update|replace)\b/i, operation: 'edit', label: 'editando arquivo' },
    { match: /\b(copy|cp)\b/i, operation: 'copy', label: 'copiando arquivo' },
    { match: /\b(move|mv|rename)\b/i, operation: 'move', label: 'movendo arquivo' },
    { match: /\b(delete|remove|rm)\b/i, operation: 'delete', label: 'removendo arquivo' },
    { match: /\b(list|ls|glob|find|search)\b/i, operation: 'list', label: 'inspecionando arquivos' },
]);

const INSPECTION_TOOL_PATTERNS = /** @type {const} */ ([
    { match: /\b(get|read|show)\s+(workspace|agent|system|session)\s+(info|state|context)\b/i, label: 'inspecionando contexto' },
    { match: /\b(get|show)\s+(telemetry|metrics|health|status|capabilities)\b/i, label: 'inspecionando diagnóstico' },
    { match: /\b(list|show)\s+(available\s+)?tools\b/i, label: 'inspecionando tools' },
    { match: /\b(skill|invoke\s+skill|task|todo)\b/i, label: 'inspecionando recurso do agente' },
]);

const GENERIC_TOOL_NAMES = new Set(['external_tool', 'external tool', 'tool', 'unknown', 'unknown_tool']);

/** @type {Readonly<Record<string, string>>} */
const HUMAN_TOOL_NAMES = Object.freeze({
    ask_user: 'Pergunta ao operador',
    request_user_input: 'Pergunta ao operador',
    report_intent: 'Intent capturado',
    report_intent_local: 'Intent capturado',
    read_file_content: 'Ler arquivo',
    create_file: 'Criar arquivo',
    write_file: 'Escrever arquivo',
    move_file: 'Mover arquivo',
    copy_file: 'Copiar arquivo',
    delete_file: 'Excluir arquivo',
    get_session_state: 'Estado da sessão',
    hooks_get_pending_tasks: 'Pendências de hooks',
    read_briefing: 'Briefing da sessão',
    get_workspace_info: 'Contexto do workspace',
    get_telemetry: 'Telemetria',
    exec_command: 'Executar comando',
    bash: 'Executar comando',
    shell: 'Executar comando',
    browser_action: 'Ação no navegador',
});

const TOOL_ID_PATTERNS = [
    /^chatcmpl-tool-[a-z0-9-]+$/iu,
    /^toolu_[a-z0-9]+$/iu,
    /^call_[a-z0-9_-]+$/iu,
    /^ext:[a-z0-9_-]+/iu,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu,
];

/**
 * @typedef {'read' | 'write' | 'edit' | 'copy' | 'move' | 'delete' | 'list' | 'run' | 'inspect' | 'ask' | 'intent' | 'unknown'} TerminalToolOperation
 *
 * @typedef {{
 *     toolName: string;
 *     canonicalToolName: string | null;
 *     displayToolName: string;
 *     operation: TerminalToolOperation;
 *     label: string;
 *     path: string | null;
 *     target: string | null;
 *     fileTargets: string[];
 *     urlTargets: string[];
 *     searchTerms: string[];
 *     patchFiles: string[];
 *     lineRange: { start: number | null; end: number | null } | null;
 *     detail: string;
 *     startLine: string;
 *     progressLinePrefix: string;
 *     completeLine: (success: boolean, durationLabel: string) => string;
 * }} TerminalToolActivityPresentation
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectOrNull(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectOrParsedJson(value) {
    const object = objectOrNull(value);
    if (object) return object;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text.startsWith('{')) return null;
    try {
        const parsed = JSON.parse(text);
        return objectOrNull(parsed);
    } catch {
        return null;
    }
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function stringOrNull(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
export function isGenericTerminalToolName(value) {
    if (!value) return true;
    return GENERIC_TOOL_NAMES.has(value.trim().toLowerCase());
}

/**
 * - Normaliza payload de argumentos de tool, incluindo eventos externos que chegam como `{ data: { arguments:
 *   string|object } }`.
 *
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function normalizeToolArgsPayload(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const base = /** @type {Record<string, unknown>} */ (raw);
    const wrappedArgs = base['arguments'] ?? base['args'] ?? null;
    if (wrappedArgs === null || wrappedArgs === undefined) return base;
    if (typeof wrappedArgs === 'string') {
        try {
            const parsed = JSON.parse(wrappedArgs);
            if (parsed && typeof parsed === 'object') {
                return /** @type {Record<string, unknown>} */ (parsed);
            }
        } catch {
            // fallback para payload original
        }
    }
    if (wrappedArgs && typeof wrappedArgs === 'object') {
        return /** @type {Record<string, unknown>} */ (wrappedArgs);
    }
    return base;
}

/**
 * @param {Record<string, unknown>} record
 * @param {string[]} keys
 * @returns {string | null}
 */
function readFirstSpecificToolName(record, keys) {
    for (const key of keys) {
        const value = stringOrNull(record[key]);
        if (value && !isGenericTerminalToolName(value)) return value;
    }
    return null;
}

/**
 * Eventos de tool do SDK podem chegar como `external_tool`, `tool` ou `unknown` no topo, enquanto a identidade real
 * vive dentro de `data`, `payload`, `input`, `args` ou `arguments` serializado. A UX inteira depende deste ponto central
 * para não espalhar casos especiais nos renderers.
 *
 * @param {Record<string, unknown>} evt
 * @returns {string | null}
 */
function inferNestedToolName(evt) {
    const candidates = [
        evt,
        evt['data'],
        evt['payload'],
        evt['input'],
        evt['args'],
        evt['arguments'],
        objectOrParsedJson(evt['data']),
        objectOrParsedJson(evt['payload']),
        objectOrParsedJson(evt['input']),
        objectOrParsedJson(evt['args']),
        objectOrParsedJson(evt['arguments']),
    ];
    for (const candidate of candidates) {
        const object = objectOrParsedJson(candidate);
        if (!object) continue;
        const name = readFirstSpecificToolName(object, [
            'canonicalToolName',
            'canonicalName',
            'toolName',
            'tool_name',
            'mcpToolName',
            'requestedTool',
            'targetTool',
            'functionName',
            'commandName',
            'name',
            'tool',
            'operation',
        ]);
        if (name) return name;
    }
    return null;
}

/**
 * - @param {unknown} args
 *
 * @returns {string | null}
 */
function inferQuestion(args) {
    const data = objectOrNull(args);
    if (!data) return null;
    return stringOrNull(data['question']) ?? stringOrNull(data['message']) ?? stringOrNull(data['prompt']);
}

/**
 * @param {Record<string, unknown>} record
 * @returns {string | null}
 */
function inferIntentText(record) {
    const candidates = [
        record,
        objectOrNull(record['args']),
        objectOrNull(record['arguments']),
        objectOrNull(record['input']),
        objectOrNull(record['data']),
        objectOrParsedJson(record['args']),
        objectOrParsedJson(record['arguments']),
        objectOrParsedJson(record['input']),
        objectOrParsedJson(record['data']),
    ];
    for (const candidate of candidates) {
        if (!candidate) continue;
        const intent =
            stringOrNull(candidate['intent']) ??
            stringOrNull(candidate['message']) ??
            stringOrNull(candidate['summary']) ??
            stringOrNull(candidate['description']);
        if (intent) return intent;
    }
    return null;
}

/**
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
function isInternalCallIdentifier(value) {
    if (!value) return false;
    const text = value.trim();
    return TOOL_ID_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * @param {string} toolName
 * @param {string | null} canonicalToolName
 * @returns {string}
 */
function resolveHumanToolName(toolName, canonicalToolName) {
    const canonical = canonicalToolName?.trim();
    if (canonical && HUMAN_TOOL_NAMES[canonical]) return HUMAN_TOOL_NAMES[canonical];
    const raw = toolName.trim();
    if (/^io\.read(?:\.|$)/iu.test(raw)) return 'Leitura local';
    if (/^io\.(?:write|append|mkdir)(?:\.|$)/iu.test(raw)) return 'Escrita local';
    if (/^io\.(?:move|copy|patch)(?:\.|$)/iu.test(raw)) return 'Alteração local';
    if (/^io\.(?:delete|remove)(?:\.|$)/iu.test(raw)) return 'Exclusão local';
    if (/^io\.(?:scan|search|stat|fetch)(?:\.|$)/iu.test(raw)) return 'Inspeção local';
    return HUMAN_TOOL_NAMES[raw] ?? raw;
}

/**
 * @param {{
 *     fileTargets: string[];
 *     urlTargets: string[];
 *     searchTerms: string[];
 *     lineRange: { start: number | null; end: number | null } | null;
 *     primaryTarget: string | null;
 * }} meta
 * @returns {string | null}
 */
function buildTargetSummary(meta) {
    /** @type {string[]} */
    const chunks = [];
    if (meta.fileTargets.length > 0) {
        const preview = meta.fileTargets.slice(0, 2).join(', ');
        const extra = meta.fileTargets.length > 2 ? ` (+${meta.fileTargets.length - 2})` : '';
        chunks.push(`arquivo${meta.fileTargets.length > 1 ? 's' : ''}: ${preview}${extra}`);
    }
    if (meta.urlTargets.length > 0) {
        const preview = meta.urlTargets.slice(0, 2).join(', ');
        const extra = meta.urlTargets.length > 2 ? ` (+${meta.urlTargets.length - 2})` : '';
        chunks.push(`página${meta.urlTargets.length > 1 ? 's' : ''}: ${preview}${extra}`);
    }
    if (meta.searchTerms.length > 0) {
        const preview = meta.searchTerms[0] ?? '';
        chunks.push(`busca: ${compactTerminalToolText(preview, 52)}`);
    }
    if (meta.lineRange) {
        const start = meta.lineRange.start ?? '?';
        const end = meta.lineRange.end ?? '?';
        chunks.push(`linhas ${start}-${end}`);
    }
    if (chunks.length === 0) return meta.primaryTarget;
    return chunks.join(' · ');
}

/**
 * @param {unknown} value
 * @returns {{ operation: TerminalToolOperation; label: string } | null}
 */
function normalizeExplicitOperation(value) {
    const operation = stringOrNull(value)?.toLowerCase().replace(/[_:-]+/g, ' ') ?? null;
    if (!operation) return null;
    if (/\b(read|view|fetch|open)\b/u.test(operation)) return { operation: 'read', label: 'lendo arquivo' };
    if (/\b(write|create|append|mkdir|save)\b/u.test(operation)) {
        return { operation: 'write', label: 'escrevendo arquivo' };
    }
    if (/\b(edit|patch|update|replace)\b/u.test(operation)) return { operation: 'edit', label: 'editando arquivo' };
    if (/\b(copy|cp)\b/u.test(operation)) return { operation: 'copy', label: 'copiando arquivo' };
    if (/\b(move|mv|rename)\b/u.test(operation)) return { operation: 'move', label: 'movendo arquivo' };
    if (/\b(delete|remove|rm|unlink)\b/u.test(operation)) return { operation: 'delete', label: 'removendo arquivo' };
    if (/\b(list|scan|search|stat|glob|find)\b/u.test(operation)) {
        return { operation: 'list', label: 'inspecionando arquivos' };
    }
    if (/\b(run|exec|shell|command|terminal)\b/u.test(operation)) return { operation: 'run', label: 'executando comando' };
    if (/\b(inspect|status|health|diagnostic|telemetry|metrics)\b/u.test(operation)) {
        return { operation: 'inspect', label: 'inspecionando diagnóstico' };
    }
    if (/\b(ask|question|elicitation|input request|request user input|human input)\b/u.test(operation)) {
        return { operation: 'ask', label: 'aguardando decisão humana' };
    }
    if (/\b(intent|report intent)\b/u.test(operation)) return { operation: 'intent', label: 'registrando intenção' };
    return null;
}

/**
 * @param {string} toolName
 * @param {string | null} path
 * @param {unknown} explicitOperation
 * @returns {{ operation: TerminalToolOperation; label: string }}
 */
function inferOperation(toolName, path, explicitOperation) {
    const normalizedExplicitOperation = normalizeExplicitOperation(explicitOperation);
    if (normalizedExplicitOperation) return normalizedExplicitOperation;

    const canonical = resolveToolName(toolName) ?? toolName;
    const normalized = `${toolName} ${canonical}`.replace(/[_:-]+/g, ' ');

    if (/\bexternal\s*tool\b/i.test(normalized)) {
        return { operation: 'run', label: 'executando integração externa' };
    }

    if (/\b(ask user|request user input|permission|elicitation)\b/i.test(normalized)) {
        return { operation: 'ask', label: 'aguardando decisão humana' };
    }

    if (/\b(report intent|intent)\b/i.test(normalized)) {
        return { operation: 'intent', label: 'registrando intenção' };
    }

    if (/\b(shell|terminal|exec|bash|command|npm|node|test)\b/i.test(normalized)) {
        return { operation: 'run', label: 'executando comando' };
    }

    if (/\b(report|telemetry|diagnostic|health|status)\b/i.test(normalized)) {
        return { operation: 'inspect', label: 'inspecionando diagnóstico' };
    }

    for (const pattern of INSPECTION_TOOL_PATTERNS) {
        if (pattern.match.test(normalized)) {
            return { operation: 'inspect', label: pattern.label };
        }
    }

    for (const pattern of FILE_OPERATION_PATTERNS) {
        if (pattern.match.test(normalized)) {
            return {
                operation: /** @type {TerminalToolOperation} */ (pattern.operation),
                label: pattern.label,
            };
        }
    }
    if (path) return { operation: 'inspect', label: 'operando arquivo' };
    return { operation: 'inspect', label: 'executando tool genérica' };
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function compactTerminalToolText(text, max = 140) {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > max ? `${compact.slice(0, Math.max(0, max - 1))}…` : compact;
}

/**
 * @param {string | null | undefined} value
 * @param {number} [size=12]
 * @returns {string | null}
 */
export function compactTerminalDiagnosticId(value, size = 12) {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    return text.length <= size ? text : `${text.slice(0, Math.max(0, size))}…`;
}

/**
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
export function isTerminalInternalCallIdentifier(value) {
    return isInternalCallIdentifier(value);
}

/**
 * @param {string} toolName
 * @returns {string}
 */
export function getTerminalHumanToolName(toolName) {
    return resolveHumanToolName(toolName, resolveToolName(toolName));
}

/**
 * @param {TerminalToolOperation} operation
 * @returns {'fileRead' | 'fileWrite' | 'fileEdit' | 'fileDelete' | 'question' | 'thinking' | 'tool'}
 */
export function mapTerminalToolOperationRole(operation) {
    if (operation === 'read') return 'fileRead';
    if (operation === 'write' || operation === 'copy') return 'fileWrite';
    if (operation === 'edit' || operation === 'move') return 'fileEdit';
    if (operation === 'delete') return 'fileDelete';
    if (operation === 'ask') return 'question';
    if (operation === 'intent') return 'thinking';
    return 'tool';
}

/**
 * @param {Record<string, unknown>} evt
 * @param {string} fallbackName
 * @returns {TerminalToolActivityPresentation}
 */
export function buildTerminalToolActivityPresentation(evt, fallbackName = 'tool') {
    const explicitToolName = stringOrNull(evt['toolName']) ?? stringOrNull(evt['name']);
    const nestedToolName = inferNestedToolName(evt);
    const toolName =
        explicitToolName && !isGenericTerminalToolName(explicitToolName)
            ? explicitToolName
            : (nestedToolName ?? fallbackName);
    const canonicalToolName = resolveToolName(toolName);
    const displayToolName = resolveHumanToolName(toolName, canonicalToolName);
    const rawToolArgs = evt['args'] ?? evt['arguments'] ?? evt['input'] ?? evt['data'];
    const toolArgs = normalizeToolArgsPayload(rawToolArgs);
    const toolResult = evt['result'] ?? evt['output'] ?? null;
    const meta = introspectToolTargets({ args: toolArgs, result: toolResult });
    const isStructuredInputTool = (canonicalToolName ?? toolName) === 'request_user_input';
    const isIntentTool = (canonicalToolName ?? toolName) === 'report_intent_local' || toolName === 'report_intent';
    const questionPreview = isStructuredInputTool ? inferQuestion(toolArgs) : null;
    const intentPreview = isIntentTool ? inferIntentText({ ...evt, args: toolArgs }) : null;
    const path = isStructuredInputTool ? null : (meta.fileTargets[0] ?? null);
    const { operation, label } = inferOperation(toolName, path, evt['operation']);
    const targetCandidate =
        questionPreview ?? intentPreview ?? buildTargetSummary(meta) ?? stringOrNull(evt['mcpServerName']) ?? null;
    const target = isInternalCallIdentifier(targetCandidate) ? null : targetCandidate;
    const targetSuffix = target ? ` · ${target}` : '';
    const effectiveLabel = isStructuredInputTool ? 'aguardando decisão humana' : label;
    const detail = `${effectiveLabel}${targetSuffix}`;
    const startLine = target ? `${effectiveLabel}: ${target}` : effectiveLabel;
    const progressLinePrefix = target ? `${displayToolName} · ${target}` : displayToolName;

    return {
        toolName,
        canonicalToolName,
        displayToolName,
        operation,
        label,
        path,
        target,
        fileTargets: meta.fileTargets,
        urlTargets: meta.urlTargets,
        searchTerms: meta.searchTerms,
        patchFiles: meta.patchFiles,
        lineRange: meta.lineRange,
        detail,
        startLine,
        progressLinePrefix,
        completeLine(success, durationLabel) {
            const outcome = success ? 'concluído' : 'falhou';
            const safeDuration =
                typeof durationLabel === 'string' && durationLabel.trim().length > 0 ? durationLabel.trim() : 'n/d';
            return `${effectiveLabel} ${outcome}${targetSuffix} (${safeDuration})`;
        },
    };
}
