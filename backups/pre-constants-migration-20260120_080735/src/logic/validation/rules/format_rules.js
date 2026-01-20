/* ==========================================================================
   src/logic/validation/rules/format_rules.js
   Audit Level: 100 — Industrial Hardening (Structural Integrity - Platinum)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Validar a conformidade estrutural (JSON, Markdown) e
                     padrões sintáticos (Regex) do conteúdo.
   Sincronizado com: scan_engine.js (V1.1), context_engine.js (V1.1).
========================================================================== */

/**
 * Valida se o conteúdo contém um JSON íntegro via análise de profundidade de pilha.
 * [HARDENING] Inclui verificação de sinal de aborto para interromper processamento longo.
 *
 * @param {string} content - Conteúdo acumulado para validação.
 * @param {AbortSignal} [signal] - Sinal de cancelamento opcional.
 * @returns {object} { ok: boolean, reason: string|null }
 */
function validateJSON(content, signal = null) {
    if (!content || typeof content !== 'string') {
        return { ok: false, reason: 'INVALID_INPUT: Conteúdo nulo ou inválido.' };
    }

    let depth = 0;
    let start = -1;
    let found = false;

    for (let i = 0; i < content.length; i++) {
        // [FIX 2.1] Check de aborto periódico para evitar travamento em strings massivas
        if (i % 1000 === 0 && signal?.aborted) {
            return { ok: false, reason: 'VALIDATION_ABORTED: Processamento JSON interrompido.' };
        }

        if (content[i] === '{') {
            if (depth === 0) {
                start = i;
            }
            depth++;
        } else if (content[i] === '}') {
            depth--;
            if (depth === 0 && start !== -1) {
                const jsonCandidate = content.slice(start, i + 1);
                try {
                    JSON.parse(jsonCandidate);
                    found = true;
                    break;
                } catch (e) {
                    return { ok: false, reason: `JSON_CORRUPTED: Estrutura inválida. ${e.message}` };
                }
            }
        }
    }

    if (!found) {
        return { ok: false, reason: 'JSON_NOT_FOUND: Estrutura { } válida não localizada.' };
    }

    return { ok: true, reason: null };
}

/**
 * Valida se o conteúdo atende a um padrão Regex específico.
 *
 * @param {string} content - Conteúdo a ser testado.
 * @param {string} patternStr - String da expressão regular.
 * @param {AbortSignal} [signal] - Sinal de cancelamento.
 */
function validateRegex(content, patternStr, signal = null) {
    if (!patternStr) {
        return { ok: true, reason: null };
    }
    if (signal?.aborted) {
        return { ok: false, reason: 'VALIDATION_ABORTED' };
    }

    try {
        const regex = new RegExp(patternStr, 'i');
        const matches = regex.test(content);

        if (!matches) {
            return {
                ok: false,
                reason: `PATTERN_MISMATCH: O conteúdo não atende ao padrão exigido.`
            };
        }
        return { ok: true, reason: null };
    } catch (e) {
        return { ok: false, reason: 'INVALID_REGEX_RULE: Expressão regular malformada.' };
    }
}

/**
 * Valida se o conteúdo respeita o formato Markdown (presença de blocos de código).
 */
function validateMarkdownCode(content) {
    if (!content || !content.includes('```')) {
        return { ok: false, reason: 'MARKDOWN_ERROR: Blocos de código (```) não localizados.' };
    }
    return { ok: true, reason: null };
}

module.exports = {
    validateJSON,
    validateRegex,
    validateMarkdownCode
};
