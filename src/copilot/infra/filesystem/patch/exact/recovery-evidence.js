// @ts-check
/** Bounded diagnostic evidence for exact patch misses; never authorizes a mutation. */
import { lineNumberAtTextOffset } from '#copilot/infra/internal/platform/text-lines';
import { findOccurrenceOffsets } from './occurrences.js';

const PATCH_RECOVERY_MAX_SCAN_CHARS = 4 * 1024 * 1024;
const PATCH_RECOVERY_MAX_OCCURRENCES = 17;
const PATCH_RECOVERY_MAX_EVIDENCE_LINES = 12;
const PATCH_RECOVERY_MAX_FRAGMENTS = 3;
const PATCH_RECOVERY_MIN_FRAGMENT_CHARS = 6;
const PATCH_RECOVERY_MAX_FRAGMENT_CHARS = 96;
const PATCH_RECOVERY_MAX_EXACT_ANCHOR_CHARS = 32 * 1024;

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
 * Diagnostic-only normalization for accidental literal quote escaping in exact anchors. It never authorizes a write:
 * the real patch still requires byte-exact old_string matching.
 *
 * @param {string} value
 */
function normalizePatchQuoteEscapes(value) {
    return value.replace(/\\(["'`])/gu, '$1');
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

/** @param {string} value @param {'none' | 'mixed' | 'lf' | 'crlf' | 'cr'} style */
function projectPatchNewlineStyle(value, style) {
    const normalized = normalizePatchLineEndings(value);
    if (style === 'crlf') return normalized.replace(/\n/gu, '\r\n');
    if (style === 'cr') return normalized.replace(/\n/gu, '\r');
    if (style === 'lf' || style === 'none') return normalized;
    return null;
}

/**
 * Return one literal recovery anchor only when it is already present exactly once in the original content. The
 * candidate is evidence for the next exact-string call; it never authorizes the current mutation.
 *
 * @param {string} content
 * @param {string} oldString
 * @param {'none' | 'mixed' | 'lf' | 'crlf' | 'cr'} newlineStyle
 */
function buildExactRecoveryAnchor(content, oldString, newlineStyle) {
    if (oldString.length > PATCH_RECOVERY_MAX_EXACT_ANCHOR_CHARS) return null;
    const quoteNormalized = normalizePatchQuoteEscapes(oldString);
    const newlineProjected = projectPatchNewlineStyle(oldString, newlineStyle);
    const quoteAndNewlineProjected = projectPatchNewlineStyle(quoteNormalized, newlineStyle);
    const quoteChanged = quoteNormalized !== oldString;
    const newlineChanged = typeof newlineProjected === 'string' && newlineProjected !== oldString;
    const candidates = [
        ...(quoteChanged && newlineChanged
            ? [{ value: quoteAndNewlineProjected, reason: 'quote-and-line-ending-normalization' }]
            : []),
        ...(quoteChanged ? [{ value: quoteNormalized, reason: 'quote-escape-normalization' }] : []),
        ...(newlineChanged ? [{ value: newlineProjected, reason: 'line-ending-normalization' }] : []),
    ];
    const seen = new Set([oldString]);
    for (const candidate of candidates) {
        if (
            typeof candidate.value !== 'string' ||
            candidate.value.length === 0 ||
            candidate.value.length > PATCH_RECOVERY_MAX_EXACT_ANCHOR_CHARS ||
            seen.has(candidate.value)
        ) {
            continue;
        }
        seen.add(candidate.value);
        const { offsets, truncated } = findOccurrenceOffsets(content, candidate.value, 2);
        if (!truncated && offsets.length === 1) {
            return {
                recoveryOldString: candidate.value,
                recoveryOldStringChars: candidate.value.length,
                recoveryReason: candidate.reason,
                recoveryOccurrenceLine: lineNumberAtTextOffset(content, offsets[0] ?? 0),
                recoveryExactAnchor: true,
                recoveryRereadRequired: false,
            };
        }
    }
    return null;
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
 * Produce bounded, non-mutating evidence from the same content snapshot that failed exact matching. Candidate
 * heuristics are diagnostic only; they never authorize a write.
 *
 * @param {string} content
 * @param {{ oldString: string; newString: string }} options
 */
export function buildPatchNotFoundEvidence(content, options) {
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

    const desired = options.newString.length > 0 ? boundedPatchOccurrenceEvidence(content, options.newString) : null;
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
    const quoteEscapeNormalizedOld = normalizePatchQuoteEscapes(options.oldString);
    const quoteEscapeEvidence =
        quoteEscapeNormalizedOld !== options.oldString
            ? boundedPatchOccurrenceEvidence(content, quoteEscapeNormalizedOld)
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
    const exactRecoveryAnchor = buildExactRecoveryAnchor(
        content,
        options.oldString,
        /** @type {'none' | 'mixed' | 'lf' | 'crlf' | 'cr'} */ (base.newlineStyle),
    );

    return {
        ...base,
        ...(exactRecoveryAnchor ?? {}),
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
        ...(quoteEscapeEvidence
            ? {
                  quoteEscapeNormalizedOccurrenceCount: quoteEscapeEvidence.occurrenceCount,
                  quoteEscapeNormalizedOccurrenceCountExact: quoteEscapeEvidence.occurrenceCountExact,
              }
            : {}),
        candidateFragmentCount: fragments.length,
        candidateLines: [...candidateLines],
        candidateLinesTruncated,
    };
}
