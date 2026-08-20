// @ts-check
/**
 * Audita afirmacoes publicas da LLM-B contra o ledger canonico de tool lifecycle.
 *
 * Texto do modelo nao e prova operacional. Quando a resposta publica afirma que uma tool mutavel executou com sucesso,
 * a UX do terminal precisa conferir se o `turn-trace` registrou lifecycle compatível. Este modulo e deliberadamente
 * conservador: so acusa quando ha nome de tool explicito e linguagem positiva de conclusao na mesma linha.
 *
 * @module copilot/terminal/dialog/assistant-tool-claim-audit
 */

import { terminalThemeRow, terminalThemeText } from '../state/dialog/index.js';
import { SEPARATOR, println } from './output.js';

const SUCCESS_VERBS =
    '(?:execut(?:ad[ao]s?|ed|ou|ei)?|conclu(?:id[ao]s?|iu)|aplicad[ao]s?|applied|done|success|sucesso|ok|status:?\\s*(?:applied|ok|success)|returned|retornou|confirm|presente|limp[ao]|removed|deleted)';

const TOOL_CLAIM_RULES = /** @type {const} */ ([
    {
        toolName: 'report_intent',
        operation: 'intent',
        label: 'Intenção capturada',
        pattern: new RegExp(`\\breport_intent\\b.{0,180}\\b${SUCCESS_VERBS}\\b`, 'iu'),
    },
    {
        toolName: 'read_file_content',
        operation: 'read',
        label: 'Leitura de arquivo',
        pattern: new RegExp(`\\bread_file_content\\b.{0,180}\\b${SUCCESS_VERBS}\\b`, 'iu'),
    },
    {
        toolName: 'create_file',
        operation: 'write',
        label: 'Criação/escrita de arquivo',
        pattern: new RegExp(`\\bcreate_file\\b.{0,180}\\b${SUCCESS_VERBS}\\b`, 'iu'),
    },
    {
        toolName: 'patch_file',
        operation: 'edit',
        label: 'Edição de arquivo',
        pattern: new RegExp(`\\bpatch_file\\b.{0,180}\\b${SUCCESS_VERBS}\\b`, 'iu'),
    },
    {
        toolName: 'delete_file',
        operation: 'delete',
        label: 'Exclusão de arquivo',
        pattern: new RegExp(`\\bdelete_file\\b.{0,180}\\b${SUCCESS_VERBS}\\b`, 'iu'),
    },
    {
        toolName: 'ask_user',
        operation: 'ask',
        label: 'Pergunta ao operador',
        pattern: new RegExp(`\\bask_user\\b.{0,180}\\b${SUCCESS_VERBS}\\b`, 'iu'),
    },
]);

/**
 * @typedef {{
 *     toolName: string;
 *     operation: string;
 *     label: string;
 *     line: string;
 *     lineNumber: number;
 *     evidenceOperations: string[];
 * }} AssistantToolClaimAuditFinding
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isCompletedStatus(value) {
    const status = normalizeText(value);
    return status === 'completed' || status === 'concluída' || status === 'concluida' || status === 'done';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function operationKey(value) {
    return normalizeText(value).replace(/\s+/gu, '_');
}

/**
 * @param {ReturnType<typeof import('../state/turn-trace-state.js').readTerminalTurnTraceProjection>} projection
 * @returns {Set<string>}
 */
function collectCompletedEvidenceOperations(projection) {
    const evidence = new Set();
    const traces = [projection.current, ...projection.recent].filter(Boolean);
    for (const trace of traces) {
        for (const tool of trace?.tools ?? []) {
            if (!isCompletedStatus(tool.status) || tool.success === false) continue;
            const operation = operationKey(tool.operation);
            if (operation) evidence.add(operation);
            const toolName = operationKey(tool.toolName);
            if (toolName) evidence.add(toolName);
        }
        for (const file of trace?.files ?? []) {
            const operation = operationKey(file.operation);
            if (operation) evidence.add(operation);
        }
        for (const userInput of trace?.userInputs ?? []) {
            if (userInput.status === 'requested' || userInput.status === 'answered') evidence.add('ask');
        }
    }
    return evidence;
}

/**
 * @param {{
 *     reply: string | null | undefined;
 *     projection: ReturnType<typeof import('../state/turn-trace-state.js').readTerminalTurnTraceProjection>;
 * }} input
 * @returns {AssistantToolClaimAuditFinding[]}
 */
export function auditAssistantToolClaims({ reply, projection }) {
    const text = typeof reply === 'string' ? reply : '';
    if (!text.trim()) return [];
    const evidence = collectCompletedEvidenceOperations(projection);
    const evidenceOperations = Array.from(evidence).sort();
    /** @type {AssistantToolClaimAuditFinding[]} */
    const findings = [];
    const lines = text.split(/\r?\n/u);

    for (const [index, rawLine] of lines.entries()) {
        const line = rawLine.trim();
        if (!line) continue;
        for (const rule of TOOL_CLAIM_RULES) {
            if (!rule.pattern.test(line)) continue;
            if (evidence.has(rule.operation) || evidence.has(rule.toolName)) continue;
            findings.push({
                toolName: rule.toolName,
                operation: rule.operation,
                label: rule.label,
                line,
                lineNumber: index + 1,
                evidenceOperations,
            });
        }
    }

    return findings;
}

/**
 * @param {AssistantToolClaimAuditFinding[]} findings
 * @returns {boolean}
 */
export function renderAssistantToolClaimAuditFindings(findings) {
    if (findings.length === 0) return false;
    println(SEPARATOR);
    println(terminalThemeRow('Verificação de tools', 'alegação pública sem lifecycle comprovado', { role: 'warn' }));
    println('');
    for (const finding of findings) {
        const evidence = finding.evidenceOperations.length > 0 ? finding.evidenceOperations.join(', ') : 'nenhuma';
        println(
            `  ${terminalThemeText('warn', '!')} ${terminalThemeText('warn', finding.label)} ` +
                terminalThemeText(
                    'muted',
                    `linha ${finding.lineNumber} menciona ${finding.toolName}, mas o ledger recente não registrou ${finding.operation} concluído.`,
                ),
        );
        println(`    ${terminalThemeText('muted', `Evidência disponível: ${evidence}`)}`);
    }
    println('');
    return true;
}
