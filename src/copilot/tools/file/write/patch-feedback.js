// @ts-check
/**
 * Feedback específico de `patch_file`.
 *
 * @module copilot/tools/file/write/patch-feedback
 */

export const PATCH_FEEDBACK_FIX = /** @type {const} */ ({
    ERR_PATCH_INVALID_OLD_STRING:
        'Envie old_string não vazio, copiado literalmente do conteúdo lido mais recentemente.',
    ERR_PATCH_INVALID_NEW_STRING: 'Envie new_string como string; use string vazia apenas quando quiser deletar texto.',
    ERR_PATCH_NOOP:
        'Altere new_string para produzir diferença real, ou use allowNoop=true quando quiser registrar dry-run/no-op.',
    ERR_PATCH_NOT_FOUND:
        'Releia o arquivo com read_file_content, copie um trecho atual e inclua contexto suficiente em old_string.',
    ERR_PATCH_EXPECTED_OCCURRENCES:
        'Releia o arquivo e ajuste expected_occurrences, ou refine old_string para o número exato de matches desejado.',
    ERR_PATCH_AMBIGUOUS_MATCH:
        'Refine old_string com mais contexto, use occurrence_index para escolher a ocorrência, ou use replace_all com expected_occurrences.',
    ERR_PATCH_CONFLICTING_MODE:
        'Escolha apenas um modo: replace_all para todos os matches ou occurrence_index para um match específico.',
    ERR_PATCH_INVALID_OCCURRENCE_INDEX: 'Use occurrence_index inteiro e baseado em 1.',
    ERR_PATCH_OCCURRENCE_INDEX_OUT_OF_RANGE:
        'Releia o arquivo e use occurrence_index dentro da contagem de matches atual.',
    EEXPECTEDHASH:
        'O arquivo mudou desde a leitura anterior. Releia o arquivo, atualize expectedHash e tente novamente.',
});

/**
 * @typedef {keyof typeof PATCH_FEEDBACK_FIX | 'ERR_PATCH_FAILED'} PatchFailureCode
 */

const PATCH_FEEDBACK_CATEGORY = /** @type {const} */ ({
    ERR_PATCH_INVALID_OLD_STRING: 'invalid-parameters',
    ERR_PATCH_INVALID_NEW_STRING: 'invalid-parameters',
    ERR_PATCH_NOOP: 'invalid-parameters',
    ERR_PATCH_NOT_FOUND: 'not-found',
    ERR_PATCH_EXPECTED_OCCURRENCES: 'conflict',
    ERR_PATCH_AMBIGUOUS_MATCH: 'invalid-parameters',
    ERR_PATCH_CONFLICTING_MODE: 'invalid-parameters',
    ERR_PATCH_INVALID_OCCURRENCE_INDEX: 'invalid-parameters',
    ERR_PATCH_OCCURRENCE_INDEX_OUT_OF_RANGE: 'invalid-parameters',
    EEXPECTEDHASH: 'conflict',
});

/**
 * @param {PatchFailureCode | string | undefined} code
 * @returns {string}
 */
export function patchFailureNextAction(code) {
    if (code === 'EEXPECTEDHASH')
        return 'Releia o arquivo com includeHash=true, atualize expectedHash e repita o patch.';
    if (code === 'ERR_PATCH_NOT_FOUND') return 'Releia o trecho atual e envie old_string literal com mais contexto.';
    if (code === 'ERR_PATCH_AMBIGUOUS_MATCH') {
        return 'Use occurrence_index para um match especifico ou replace_all com expected_occurrences.';
    }
    if (code === 'ERR_PATCH_EXPECTED_OCCURRENCES') {
        return 'Releia o arquivo e ajuste expected_occurrences para a contagem atual.';
    }
    if (code === 'ERR_PATCH_NOOP')
        return 'Altere new_string ou use allowNoop=true se a validacao sem mudanca for intencional.';
    if (code === 'ERR_PATCH_INVALID_OLD_STRING') return 'Envie old_string nao vazio copiado da leitura mais recente.';
    if (code === 'ERR_PATCH_CONFLICTING_MODE') return 'Escolha replace_all ou occurrence_index, nunca ambos.';
    if (code === 'ERR_PATCH_OCCURRENCE_INDEX_OUT_OF_RANGE')
        return 'Releia a contagem de matches e escolha occurrence_index valido.';
    return 'Releia o arquivo, reduza o escopo do patch e tente novamente com dryRun=true.';
}

/**
 * @param {PatchFailureCode | string | undefined} code
 * @param {string} message
 * @param {Record<string, unknown>} details
 * @param {Record<string, unknown>} [receivedParameters]
 * @returns {{
 *     operation: 'patch';
 *     path: string | null;
 *     status: 'failed';
 *     code: string;
 *     summary: string;
 *     nextAction: string;
 * }}
 */
export function buildPatchFailureTerminalSummary(code, message, details, receivedParameters = {}) {
    const rawPath = details['path'] ?? receivedParameters['path'];
    const path = typeof rawPath === 'string' && rawPath.length > 0 ? rawPath : null;
    const normalizedCode = typeof code === 'string' && code.length > 0 ? code : 'ERR_PATCH_FAILED';
    const target = path ? `${path} · ` : '';
    return {
        operation: 'patch',
        path,
        status: 'failed',
        code: normalizedCode,
        summary: `Patch falhou: ${target}${normalizedCode} · ${message}`,
        nextAction: patchFailureNextAction(normalizedCode),
    };
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
export function readErrorCode(error) {
    if (!error || typeof error !== 'object') return undefined;
    const code = /** @type {Record<string, unknown>} */ (error)['code'];
    return typeof code === 'string' ? code : undefined;
}

/**
 * @param {unknown} error
 * @returns {Record<string, unknown>}
 */
export function readErrorDetails(error) {
    if (!error || typeof error !== 'object') return {};
    const details = /** @type {Record<string, unknown>} */ (error)['details'];
    return details && typeof details === 'object' && !Array.isArray(details)
        ? /** @type {Record<string, unknown>} */ (details)
        : {};
}

/**
 * @param {unknown} error
 * @returns {import('../../infra/tool-feedback.js').ToolFailureCategory | undefined}
 */
export function patchFailureCategory(error) {
    const code = readErrorCode(error);
    if (!code) return undefined;
    return PATCH_FEEDBACK_CATEGORY[/** @type {keyof typeof PATCH_FEEDBACK_CATEGORY} */ (code)];
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
export function patchFailureFix(error) {
    const code = readErrorCode(error);
    if (!code) return undefined;
    return PATCH_FEEDBACK_FIX[/** @type {keyof typeof PATCH_FEEDBACK_FIX} */ (code)];
}
