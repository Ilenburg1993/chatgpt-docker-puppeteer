// @ts-check
/** Bounded diagnostic evidence for exact patch misses; never authorizes a mutation. */
import { lineNumberAtTextOffset } from '#copilot/infra/internal/platform';
import { findOccurrenceOffsets } from './occurrences.js';

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
