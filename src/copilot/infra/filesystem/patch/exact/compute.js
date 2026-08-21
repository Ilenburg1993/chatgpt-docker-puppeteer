// @ts-check
/**
 * Patch textual puro.
 *
 * @module copilot/infra/filesystem/patch/exact/compute
 */

import { countPhysicalTextLines, lineNumberAtTextOffset, utf8ByteLength } from '#copilot/infra/internal/platform';

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
 * Contagem de linhas orientada a delta de patch.
 *
 * Contrato: string vazia conta como 1 linha-base para evitar deltas negativos artificiais ao comparar estados vazios em
 * operações de patch textual.
 *
 * @param {string} content
 * @returns {number}
 */
function countPatchLines(content) {
    return countPhysicalTextLines(content);
}

import { findOccurrenceOffsets, occurrenceLineEvidence } from './occurrences.js';
import { buildPatchNotFoundEvidence } from './recovery-evidence.js';

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

    const occurrenceLimit =
        options.expectedOccurrences === undefined
            ? Number.POSITIVE_INFINITY
            : Math.max(1, options.expectedOccurrences + 1);
    const { offsets, truncated: occurrenceCountTruncated } = findOccurrenceOffsets(
        content,
        options.oldString,
        occurrenceLimit,
    );
    const occurrences = offsets.length;
    if (occurrences === 0) {
        throw createPatchError(
            'old_string não encontrado no arquivo.',
            'ERR_PATCH_NOT_FOUND',
            buildPatchNotFoundEvidence(content, options),
        );
    }
    if (options.expectedOccurrences !== undefined && options.expectedOccurrences !== occurrences) {
        const foundLabel = occurrenceCountTruncated ? `pelo menos ${occurrences}` : String(occurrences);
        throw createPatchError(
            `expected_occurrences=${options.expectedOccurrences}, mas encontrado=${foundLabel}.`,
            'ERR_PATCH_EXPECTED_OCCURRENCES',
            {
                expectedOccurrences: options.expectedOccurrences,
                occurrenceCount: occurrences,
                occurrenceCountExact: !occurrenceCountTruncated,
                ...occurrenceLineEvidence(content, offsets),
            },
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
                firstMatchLine: lineNumberAtTextOffset(content, offsets[0] ?? 0),
                lastMatchLine: lineNumberAtTextOffset(content, offsets[offsets.length - 1] ?? 0),
                ...occurrenceLineEvidence(content, offsets),
            },
        );
    }

    const occurrenceIndex = options.occurrenceIndex ?? null;
    const targetOffset = offsets[(occurrenceIndex ?? 1) - 1] ?? 0;
    const updated = options.replaceAll
        ? content.replaceAll(options.oldString, options.newString)
        : `${content.slice(0, targetOffset)}${options.newString}${content.slice(targetOffset + options.oldString.length)}`;
    const previousBytes = utf8ByteLength(content, 'patch previous content');
    const bytesWritten = utf8ByteLength(updated, 'patch updated content');
    return {
        updated,
        occurrences,
        replacedOccurrences: options.replaceAll ? occurrences : 1,
        bytesWritten,
        previousBytes,
        byteDelta: bytesWritten - previousBytes,
        oldStringBytes: utf8ByteLength(options.oldString, 'patch old_string'),
        newStringBytes: utf8ByteLength(options.newString, 'patch new_string'),
        firstMatchLine: lineNumberAtTextOffset(content, offsets[0] ?? 0),
        lastMatchLine: lineNumberAtTextOffset(content, offsets[offsets.length - 1] ?? 0),
        lineDelta: countPatchLines(updated) - countPatchLines(content),
        occurrenceIndex,
        noop: updated === content,
    };
}
