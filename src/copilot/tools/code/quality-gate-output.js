// @ts-check
/**
 * Utilitários puros de normalização de saída para `quality_gate`.
 *
 * Mantidos fora do handler para permitir testes rápidos sem executar npm/scripts.
 *
 * @module copilot/tools/code/quality-gate-output
 */

export const DEFAULT_QUALITY_GATE_OUTPUT_MAX_CHARS = 20_000;
export const DEFAULT_QUALITY_GATE_MAX_FAILING_FILES = 50;

/**
 * @typedef {{
 *     text: string;
 *     truncated: boolean;
 *     originalChars: number;
 *     originalBytes: number;
 *     returnedChars: number;
 *     returnedBytes: number;
 * }} QualityGateTextSummary
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function asText(value) {
    return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/**
 * @param {string} text
 * @returns {number}
 */
function byteLength(text) {
    return Buffer.byteLength(text, 'utf8');
}

/**
 * @param {unknown} value
 * @param {number} [maxChars]
 * @returns {QualityGateTextSummary}
 */
export function summarizeQualityGateText(value, maxChars = DEFAULT_QUALITY_GATE_OUTPUT_MAX_CHARS) {
    const text = asText(value);
    const safeMaxChars = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : DEFAULT_QUALITY_GATE_OUTPUT_MAX_CHARS;
    const truncated = text.length > safeMaxChars;
    const returned = truncated ? `${text.slice(0, Math.max(0, safeMaxChars - 120))}\n…[truncated by quality_gate]…` : text;
    return {
        text: returned,
        truncated,
        originalChars: text.length,
        originalBytes: byteLength(text),
        returnedChars: returned.length,
        returnedBytes: byteLength(returned),
    };
}

const FILE_TOKEN_RE = /(?:^|\s|['"(])([\w./\\-]+\.(?:cjs|cts|js|json|jsx|mjs|mts|ts|tsx|md|yml|yaml))(?:[:)\s'",]|$)/g;

/**
 * @param {unknown} output
 * @param {unknown} error
 * @param {number} [maxFiles]
 * @returns {string[]}
 */
export function extractQualityGateFailingFiles(output, error, maxFiles = DEFAULT_QUALITY_GATE_MAX_FAILING_FILES) {
    const text = `${asText(output)}\n${asText(error)}`;
    const limit = Number.isFinite(maxFiles) && maxFiles > 0 ? Math.floor(maxFiles) : DEFAULT_QUALITY_GATE_MAX_FAILING_FILES;
    /** @type {string[]} */
    const files = [];
    const seen = new Set();
    for (const match of text.matchAll(FILE_TOKEN_RE)) {
        const candidate = String(match[1] ?? '').replaceAll('\\', '/');
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        files.push(candidate);
        if (files.length >= limit) break;
    }
    return files;
}

/**
 * @param {{
 *     gate: string;
 *     scope: string;
 *     script: string;
 *     command: string;
 *     description: string;
 *     artifacts?: string[];
 *     stdout: string;
 *     error?: string;
 *     exitCode: number;
 *     durationMs: number;
 *     timedOut?: boolean;
 * }} input
 */
export function buildQualityGateResultEnvelope(input) {
    const timedOut = input.timedOut === true;
    const ok = input.exitCode === 0 && !timedOut;
    const output = summarizeQualityGateText(input.stdout);
    const error = summarizeQualityGateText(input.error);
    return {
        success: ok,
        ok,
        gate: input.gate,
        scope: input.scope,
        script: input.script,
        command: input.command,
        description: input.description,
        durationMs: input.durationMs,
        exitCode: input.exitCode,
        timedOut,
        output: output.text,
        error: error.text,
        outputTruncated: output.truncated,
        errorTruncated: error.truncated,
        outputOriginalBytes: output.originalBytes,
        errorOriginalBytes: error.originalBytes,
        checks: [{ name: input.gate, ok, exitCode: input.exitCode }],
        failingFiles: extractQualityGateFailingFiles(input.stdout, input.error),
        artifacts: input.artifacts ?? [],
        terminalSummary: timedOut
            ? `quality_gate ${input.gate} excedeu timeout com exitCode=${input.exitCode}.`
            : ok
              ? `quality_gate ${input.gate} passou.`
              : `quality_gate ${input.gate} falhou com exitCode=${input.exitCode}.`,
    };
}
