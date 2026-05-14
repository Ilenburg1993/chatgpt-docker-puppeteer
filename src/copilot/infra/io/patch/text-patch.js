// @ts-check
/**
 * Patch textual puro.
 *
 * @module copilot/infra/io/patch/text-patch
 */

/**
 * @typedef {{
 *     code?: string;
 *     details?: Record<string, unknown>;
 * }} PatchErrorFields
 */

/**
 * @param {string} message
 * @param {string} code
 * @param {Record<string, unknown>} [details]
 * @returns {Error & PatchErrorFields}
 */
function createPatchError(message, code, details = {}) {
    const error = /** @type {Error & PatchErrorFields} */ (new Error(message));
    error.code = code;
    error.details = details;
    return error;
}

/**
 * @param {string} content
 * @returns {number}
 */
function countLines(content) {
    return content.length === 0 ? 1 : content.split('\n').length;
}

/**
 * @param {string} content
 * @param {number} offset
 * @returns {number}
 */
function lineNumberAt(content, offset) {
    if (offset <= 0) return 1;
    return content.slice(0, offset).split('\n').length;
}

/**
 * @param {string} content
 * @param {string} needle
 * @returns {number[]}
 */
function findOccurrenceOffsets(content, needle) {
    /** @type {number[]} */
    const offsets = [];
    let index = 0;
    while (index <= content.length) {
        const found = content.indexOf(needle, index);
        if (found === -1) break;
        offsets.push(found);
        index = found + needle.length;
    }
    return offsets;
}

/**
 * @param {string} content
 * @param {string} oldString
 * @param {string} newString
 * @param {number} occurrenceIndex One-based.
 * @returns {string}
 */
function replaceOccurrenceAt(content, oldString, newString, occurrenceIndex) {
    let seen = 0;
    let cursor = 0;
    let out = '';
    while (cursor <= content.length) {
        const found = content.indexOf(oldString, cursor);
        if (found === -1) return `${out}${content.slice(cursor)}`;
        seen += 1;
        out += content.slice(cursor, found);
        out += seen === occurrenceIndex ? newString : oldString;
        cursor = found + oldString.length;
    }
    return out;
}

/**
 * @param {string} content
 * @param {{
 *     oldString: string;
 *     newString: string;
 *     replaceAll?: boolean;
 *     expectedOccurrences?: number;
 *     occurrenceIndex?: number;
 *     allowNoop?: boolean;
 * }} options
 * @returns {{
 *     updated: string;
 *     occurrences: number;
 *     replacedOccurrences: number;
 *     bytesWritten: number;
 *     previousBytes: number;
 *     byteDelta: number;
 *     oldStringBytes: number;
 *     newStringBytes: number;
 *     firstMatchLine: number;
 *     lastMatchLine: number;
 *     lineDelta: number;
 *     occurrenceIndex: number | null;
 *     noop: boolean;
 * }}
 */
export function computeTextPatch(content, options) {
    if (typeof options.oldString !== 'string' || options.oldString.length === 0) {
        throw createPatchError('old_string deve ser uma string não vazia.', 'ERR_PATCH_INVALID_OLD_STRING');
    }
    if (typeof options.newString !== 'string') {
        throw createPatchError('new_string deve ser uma string.', 'ERR_PATCH_INVALID_NEW_STRING');
    }
    if (options.oldString === options.newString && !options.allowNoop) {
        throw createPatchError(
            'Patch sem efeito: old_string e new_string são iguais. Ajuste new_string ou use allowNoop=true.',
            'ERR_PATCH_NOOP',
        );
    }

    const offsets = findOccurrenceOffsets(content, options.oldString);
    const occurrences = offsets.length;
    if (occurrences === 0) {
        throw createPatchError('old_string não encontrado no arquivo.', 'ERR_PATCH_NOT_FOUND', {
            oldStringChars: options.oldString.length,
        });
    }
    if (options.expectedOccurrences !== undefined && options.expectedOccurrences !== occurrences) {
        throw createPatchError(
            `expected_occurrences=${options.expectedOccurrences}, mas encontrado=${occurrences}.`,
            'ERR_PATCH_EXPECTED_OCCURRENCES',
            { expectedOccurrences: options.expectedOccurrences, occurrenceCount: occurrences },
        );
    }
    if (options.replaceAll && options.occurrenceIndex !== undefined) {
        throw createPatchError(
            'Use replace_all ou occurrence_index, não ambos na mesma chamada.',
            'ERR_PATCH_CONFLICTING_MODE',
            { replaceAll: true, occurrenceIndex: options.occurrenceIndex },
        );
    }
    if (options.occurrenceIndex !== undefined) {
        if (!Number.isInteger(options.occurrenceIndex) || options.occurrenceIndex < 1) {
            throw createPatchError('occurrence_index deve ser inteiro >= 1.', 'ERR_PATCH_INVALID_OCCURRENCE_INDEX', {
                occurrenceIndex: options.occurrenceIndex,
            });
        }
        if (options.occurrenceIndex > occurrences) {
            throw createPatchError(
                `occurrence_index=${options.occurrenceIndex}, mas encontrado=${occurrences}.`,
                'ERR_PATCH_OCCURRENCE_INDEX_OUT_OF_RANGE',
                { occurrenceIndex: options.occurrenceIndex, occurrenceCount: occurrences },
            );
        }
    }
    if (!options.replaceAll && options.occurrenceIndex === undefined && occurrences > 1) {
        throw createPatchError(
            `old_string encontrado ${occurrences} vezes. Inclua mais contexto, use occurrence_index, ou use replace_all com expected_occurrences.`,
            'ERR_PATCH_AMBIGUOUS_MATCH',
            {
                occurrenceCount: occurrences,
                firstMatchLine: lineNumberAt(content, offsets[0] ?? 0),
                lastMatchLine: lineNumberAt(content, offsets[offsets.length - 1] ?? 0),
            },
        );
    }

    const occurrenceIndex = options.occurrenceIndex ?? null;
    const updated = options.replaceAll
        ? content.split(options.oldString).join(options.newString)
        : replaceOccurrenceAt(content, options.oldString, options.newString, occurrenceIndex ?? 1);
    const previousBytes = Buffer.byteLength(content, 'utf8');
    const bytesWritten = Buffer.byteLength(updated, 'utf8');
    return {
        updated,
        occurrences,
        replacedOccurrences: options.replaceAll ? occurrences : 1,
        bytesWritten,
        previousBytes,
        byteDelta: bytesWritten - previousBytes,
        oldStringBytes: Buffer.byteLength(options.oldString, 'utf8'),
        newStringBytes: Buffer.byteLength(options.newString, 'utf8'),
        firstMatchLine: lineNumberAt(content, offsets[0] ?? 0),
        lastMatchLine: lineNumberAt(content, offsets[offsets.length - 1] ?? 0),
        lineDelta: countLines(updated) - countLines(content),
        occurrenceIndex,
        noop: updated === content,
    };
}
