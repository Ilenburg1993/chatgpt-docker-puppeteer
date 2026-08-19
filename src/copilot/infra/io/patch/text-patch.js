// @ts-check
/**
 * Patch textual puro.
 *
 * @module copilot/infra/io/patch/text-patch
 */

import { utf8ByteLength } from '../../shared/buffer.js';
import { countPhysicalTextLines, lineNumberAtTextOffset } from '../../shared/text-lines.js';

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

/**
 * @param {string} content
 * @param {string} needle
 * @param {number} [maxOffsets]
 * @returns {{ offsets: number[]; truncated: boolean }}
 */
function findOccurrenceOffsets(content, needle, maxOffsets = Number.POSITIVE_INFINITY) {
    /** @type {number[]} */
    const offsets = [];
    let index = 0;
    while (index <= content.length) {
        const found = content.indexOf(needle, index);
        if (found === -1) break;
        offsets.push(found);
        if (offsets.length >= maxOffsets) return { offsets, truncated: true };
        index = found + needle.length;
    }
    return { offsets, truncated: false };
}

/**
 * Bounded line-location evidence for retrying an ambiguous exact-string patch without another file read.
 *
 * @param {string} content
 * @param {number[]} offsets
 * @param {number} [maxLines]
 */
function occurrenceLineEvidence(content, offsets, maxLines = 16) {
    const selected = offsets.slice(0, maxLines);
    return {
        occurrenceLines: selected.map((offset) => lineNumberAtTextOffset(content, offset)),
        occurrenceLinesTruncated: offsets.length > selected.length,
    };
}

const PATCH_RECOVERY_MAX_SCAN_CHARS = 4 * 1024 * 1024;
const PATCH_RECOVERY_MAX_OCCURRENCES = 17;
const PATCH_RECOVERY_MAX_EVIDENCE_LINES = 12;
const PATCH_RECOVERY_MAX_FRAGMENTS = 3;
const PATCH_RECOVERY_MIN_FRAGMENT_CHARS = 6;
const PATCH_RECOVERY_MAX_FRAGMENT_CHARS = 96;

/** @param {string} content */
function detectPatchNewlineStyle(content) {
    let lf = 0;
    let crlf = 0;
    let cr = 0;
    for (let index = 0; index < content.length; index += 1) {
        const char = content[index];
        if (char === '\r') {
            if (content[index + 1] === '\n') {
                crlf += 1;
                index += 1;
            } else {
                cr += 1;
            }
        } else if (char === '\n') {
            lf += 1;
        }
    }
    const kinds = Number(lf > 0) + Number(crlf > 0) + Number(cr > 0);
    if (kinds === 0) return 'none';
    if (kinds > 1) return 'mixed';
    if (crlf > 0) return 'crlf';
    if (cr > 0) return 'cr';
    return 'lf';
}

/** @param {string} value */
function normalizePatchLineEndings(value) {
    return value.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');
}

/** @param {string} value */
function normalizePatchWhitespace(value) {
    return normalizePatchLineEndings(value).replace(/[ \t]+/gu, ' ');
}

/**
 * @param {string} content
 * @param {string} needle
 */
function boundedPatchOccurrenceEvidence(content, needle) {
    if (!needle) {
        return {
            occurrenceCount: 0,
            occurrenceCountExact: true,
            occurrenceLines: [],
            occurrenceLinesTruncated: false,
        };
    }
    const { offsets, truncated } = findOccurrenceOffsets(content, needle, PATCH_RECOVERY_MAX_OCCURRENCES);
    const selected = offsets.slice(0, PATCH_RECOVERY_MAX_EVIDENCE_LINES);
    return {
        occurrenceCount: offsets.length,
        occurrenceCountExact: !truncated,
        occurrenceLines: selected.map((offset) => lineNumberAtTextOffset(content, offset)),
        occurrenceLinesTruncated: truncated || offsets.length > selected.length,
    };
}

/** @param {string} oldString */
function selectPatchRecoveryFragments(oldString) {
    const normalized = normalizePatchLineEndings(oldString);
    const lines = normalized
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length >= PATCH_RECOVERY_MIN_FRAGMENT_CHARS);
    const tokens = normalized
        .split(/\s+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= PATCH_RECOVERY_MIN_FRAGMENT_CHARS);
    const ranked = [...lines, ...tokens].sort((left, right) => right.length - left.length);
    const selected = [];
    const seen = new Set();
    for (const candidate of ranked) {
        const fragment = candidate.slice(0, PATCH_RECOVERY_MAX_FRAGMENT_CHARS);
        if (!fragment || seen.has(fragment)) continue;
        seen.add(fragment);
        selected.push(fragment);
        if (selected.length >= PATCH_RECOVERY_MAX_FRAGMENTS) break;
    }
    return selected;
}

/**
 * Produce bounded, non-mutating evidence from the same content snapshot that failed exact matching.
 * Candidate heuristics are diagnostic only; they never authorize a write.
 *
 * @param {string} content
 * @param {{ oldString: string; newString: string }} options
 */
function buildPatchNotFoundEvidence(content, options) {
    const scanEligible = content.length <= PATCH_RECOVERY_MAX_SCAN_CHARS;
    const base = {
        oldStringChars: options.oldString.length,
        newStringChars: options.newString.length,
        currentChars: content.length,
        utf8Bom: content.charCodeAt(0) === 0xfeff,
        newlineStyle: scanEligible ? detectPatchNewlineStyle(content) : 'unknown-large',
        recoveryScan: scanEligible ? 'full-bounded' : 'exact-only-large-content',
    };
    if (!scanEligible) return base;

    const desired =
        options.newString.length > 0 ? boundedPatchOccurrenceEvidence(content, options.newString) : null;
    const normalizedContent = normalizePatchLineEndings(content);
    const normalizedOld = normalizePatchLineEndings(options.oldString);
    const lineEndingEvidence =
        normalizedOld !== options.oldString || normalizedContent !== content
            ? boundedPatchOccurrenceEvidence(normalizedContent, normalizedOld)
            : null;
    const whitespaceContent = normalizePatchWhitespace(content);
    const whitespaceOld = normalizePatchWhitespace(options.oldString);
    const whitespaceEvidence =
        whitespaceOld !== normalizedOld || whitespaceContent !== normalizedContent
            ? boundedPatchOccurrenceEvidence(whitespaceContent, whitespaceOld)
            : null;

    const candidateLines = new Set();
    let candidateLinesTruncated = false;
    const fragments = selectPatchRecoveryFragments(options.oldString);
    for (const fragment of fragments) {
        const evidence = boundedPatchOccurrenceEvidence(content, fragment);
        if (!evidence.occurrenceCountExact || evidence.occurrenceLinesTruncated) candidateLinesTruncated = true;
        for (const line of evidence.occurrenceLines) {
            if (candidateLines.size >= PATCH_RECOVERY_MAX_EVIDENCE_LINES) {
                candidateLinesTruncated = true;
                break;
            }
            candidateLines.add(line);
        }
    }

    const desiredTextPresent = desired !== null && desired.occurrenceCount > 0;
    const convergenceCandidate =
        desired !== null &&
        options.newString.length >= PATCH_RECOVERY_MIN_FRAGMENT_CHARS &&
        desired.occurrenceCount === 1 &&
        desired.occurrenceCountExact;

    return {
        ...base,
        desiredStateEvidenceAvailable: desired !== null,
        desiredTextPresent,
        convergenceCandidate,
        ...(desired
            ? {
                  desiredOccurrenceCount: desired.occurrenceCount,
                  desiredOccurrenceCountExact: desired.occurrenceCountExact,
                  desiredOccurrenceLines: desired.occurrenceLines,
                  desiredOccurrenceLinesTruncated: desired.occurrenceLinesTruncated,
              }
            : {}),
        ...(lineEndingEvidence
            ? {
                  lineEndingNormalizedOccurrenceCount: lineEndingEvidence.occurrenceCount,
                  lineEndingNormalizedOccurrenceCountExact: lineEndingEvidence.occurrenceCountExact,
              }
            : {}),
        ...(whitespaceEvidence
            ? {
                  whitespaceNormalizedOccurrenceCount: whitespaceEvidence.occurrenceCount,
                  whitespaceNormalizedOccurrenceCountExact: whitespaceEvidence.occurrenceCountExact,
              }
            : {}),
        candidateFragmentCount: fragments.length,
        candidateLines: [...candidateLines],
        candidateLinesTruncated,
    };
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
