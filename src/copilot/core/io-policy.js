import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { validateUrlString } from './security/url-validator.js';

export const IO_POLICY_VERSION = '2026-08-18.r4.repo-text-scripts.v1';

/**
 * Número máximo de redirects HTTP permitidos por política canônica. O valor é informativo; adaptadores que suportam
 * redirect manual devem respeitá-lo.
 */
export const IO_URL_MAX_REDIRECTS = 5;

/** @type {Readonly<Record<string, { maxBytes: number; maxLines: number }>>} */
export const IO_OPERATION_ADVISORY_LIMITS = Object.freeze({
    read: Object.freeze({ maxBytes: 256 * 1024, maxLines: 2_000 }),
    write: Object.freeze({ maxBytes: 512 * 1024, maxLines: 0 }),
    append: Object.freeze({ maxBytes: 256 * 1024, maxLines: 0 }),
    scan: Object.freeze({ maxBytes: 0, maxLines: 4_000 }),
    search: Object.freeze({ maxBytes: 0, maxLines: 1_500 }),
    fetch: Object.freeze({ maxBytes: 256 * 1024, maxLines: 2_000 }),
    stat: Object.freeze({ maxBytes: 0, maxLines: 0 }),
    mkdir: Object.freeze({ maxBytes: 0, maxLines: 0 }),
});

const DEFAULT_SENSITIVE_OUTPUT_PATTERNS = Object.freeze([
    {
        regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
        replacement: 'Bearer [redacted]',
    },
    {
        regex: /(api[_-]?key\s*[:=]\s*)(["']?)[A-Za-z0-9._-]{8,}\2/gi,
        replacement: '$1[redacted]',
    },
    {
        regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
        replacement: '[redacted-gh-token]',
    },
]);

/** @type {ReadonlyArray<RegExp>} */
export const DEFAULT_BLOCKED_READ_PATH_PATTERNS = Object.freeze([
    /\.env$/i,
    /\.env\./i,
    /\.pem$/i,
    /\.key$/i,
    /secret/i,
    /\.passwd$/i,
    /credentials/i,
    /\.pfx$/i,
    /\.p12$/i,
    /id_rsa/i,
    /id_ed25519/i,
    /\.npmrc$/i,
    /\.netrc$/i,
]);

/**
 * Write policy blocks secrets/credential material and opaque native/binary executables.
 * Textual scripts (.sh/.ps1/.bat/.cmd) remain repository source: editing them is not execution, and execution is
 * governed by a separate tool boundary. Treating text scripts as unconditionally unwritable made legitimate
 * DevContainer/CI maintenance impossible while JS/TS with equivalent execution power remained editable.
 *
 * @type {ReadonlyArray<RegExp>}
 */
export const DEFAULT_BLOCKED_WRITE_PATH_PATTERNS = Object.freeze([
    ...DEFAULT_BLOCKED_READ_PATH_PATTERNS,
    /\.exe$/i,
    /\.msi$/i,
    /\.dll$/i,
    /\.so$/i,
    /\.dylib$/i,
]);

/** @type {readonly string[]} */
export const DEFAULT_BLOCKED_PATH_SEGMENTS = Object.freeze([
    '.git',
    '.env',
    '.ssh',
    '.aws',
    '.pem',
    'id_rsa',
    'id_ed25519',
    'node_modules',
]);

/**
 * @typedef {object} IoPathPolicySuccess
 * @property {true} ok
 * @property {string} absolutePath
 * @property {string} relativePath
 * @property {string} workspaceRoot
 * @property {string} policyVersion
 * @property {readonly string[]} blockedSegments
 * @property {string} realPath
 * @property {boolean} symlinkResolved
 */

/**
 * @typedef {object} IoPathPolicyFailure
 * @property {false} ok
 * @property {string} reason
 * @property {string} code
 * @property {string} policyVersion
 */

/**
 * @typedef {IoPathPolicySuccess | IoPathPolicyFailure} IoPathPolicyResult
 */

/**
 * @param {string} inputPath
 * @param {{
 *     workspaceRoot?: string;
 *     blockedSegments?: readonly string[];
 *     blockedPatterns?: readonly RegExp[];
 *     allowOutsideWorkspace?: boolean;
 *     mode?:
 *         | 'read'
 *         | 'write'
 *         | 'append'
 *         | 'scan'
 *         | 'search'
 *         | 'fetch'
 *         | 'copy'
 *         | 'move'
 *         | 'delete'
 *         | 'patch'
 *         | 'mkdir'
 *         | 'stat';
 * }} [options]
 * @returns {IoPathPolicyResult}
 */
export function evaluateIoPathPolicy(inputPath, options = {}) {
    if (typeof inputPath !== 'string' || !inputPath.trim()) {
        return fail('Path is required', 'PATH_REQUIRED');
    }

    if (inputPath.includes('\0')) {
        return fail('Path contains null byte', 'PATH_NULL_BYTE');
    }

    const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    const blockedSegments = normalizeBlockedSegments(options.blockedSegments || DEFAULT_BLOCKED_PATH_SEGMENTS);
    const allowOutsideWorkspace = options.allowOutsideWorkspace === true;
    const mode = normalizePathPolicyMode(options.mode);
    const blockedPatterns = normalizeBlockedPatterns(options.blockedPatterns, mode);

    const normalizedInput = normalizeInputPath(inputPath.trim());
    const candidateAbsolutePath = path.resolve(workspaceRoot, normalizedInput);

    const containment = evaluatePathContainment(workspaceRoot, candidateAbsolutePath);
    if (!allowOutsideWorkspace && containment.outsideWorkspace) {
        return fail('Path traversal attempt detected', 'PATH_TRAVERSAL');
    }

    const pathSegments = splitPathSegments(containment.relativePath || normalizedInput);
    const blockedHit = pathSegments.find((segment) => blockedSegments.includes(segment.toLowerCase()));
    if (blockedHit) {
        return fail(`Access to protected path segment "${blockedHit}" is blocked`, 'PATH_BLOCKED');
    }
    const blockedPattern = findBlockedPathPattern(candidateAbsolutePath, blockedPatterns);
    if (blockedPattern) {
        return fail(
            `Access to protected path basename "${path.basename(candidateAbsolutePath)}" is blocked`,
            'PATH_BLOCKED',
        );
    }

    return {
        ok: true,
        absolutePath: candidateAbsolutePath,
        relativePath: containment.relativePath,
        workspaceRoot,
        policyVersion: IO_POLICY_VERSION,
        blockedSegments,
        realPath: candidateAbsolutePath,
        symlinkResolved: false,
    };
}

/**
 * Resolve realpath/parent realpath para fechar traversal via symlink sem bloquear criação de paths novos.
 *
 * @param {Parameters<typeof evaluateIoPathPolicy>[0]} inputPath
 * @param {Parameters<typeof evaluateIoPathPolicy>[1]} [options]
 * @returns {Promise<IoPathPolicyResult>}
 */
export async function evaluateIoPathPolicyAsync(inputPath, options = {}) {
    const base = evaluateIoPathPolicy(inputPath, options);
    if (!base.ok) return base;

    const allowOutsideWorkspace = options.allowOutsideWorkspace === true;
    const mode = normalizePathPolicyMode(options.mode);
    const blockedSegments = normalizeBlockedSegments(options.blockedSegments || DEFAULT_BLOCKED_PATH_SEGMENTS);
    const blockedPatterns = normalizeBlockedPatterns(options.blockedPatterns, mode);
    const realTarget = await resolveRealTargetForPolicy(base.absolutePath);
    const containment = evaluatePathContainment(base.workspaceRoot, realTarget.realPath);

    if (!allowOutsideWorkspace && containment.outsideWorkspace) {
        return fail('Path resolves outside workspace after symlink normalization', 'PATH_SYMLINK_OUTSIDE');
    }

    const blockedHit = splitPathSegments(containment.relativePath || realTarget.realPath).find((segment) =>
        blockedSegments.includes(segment.toLowerCase()),
    );
    if (blockedHit) {
        return fail(`Access to protected real path segment "${blockedHit}" is blocked`, 'PATH_BLOCKED');
    }
    const blockedPattern = findBlockedPathPattern(realTarget.realPath, blockedPatterns);
    if (blockedPattern) {
        return fail(
            `Access to protected real path basename "${path.basename(realTarget.realPath)}" is blocked`,
            'PATH_BLOCKED',
        );
    }

    return {
        ...base,
        relativePath: containment.relativePath,
        realPath: realTarget.realPath,
        symlinkResolved: realTarget.realPath !== base.absolutePath,
    };
}

/**
 * @param {{
 *     operation?: string;
 *     maxBytes?: number;
 *     maxLines?: number;
 * }} [options]
 */
export function resolveIoAdvisoryLimits(options = {}) {
    const operation =
        typeof options.operation === 'string' && options.operation.trim().length > 0
            ? options.operation.trim().toLowerCase()
            : 'read';
    const defaults = IO_OPERATION_ADVISORY_LIMITS[operation] ?? { maxBytes: 256 * 1024, maxLines: 2_000 };
    const requestedMaxBytes = options.maxBytes;
    const requestedMaxLines = options.maxLines;
    const maxBytes =
        typeof requestedMaxBytes === 'number' && Number.isFinite(requestedMaxBytes) && requestedMaxBytes > 0
            ? requestedMaxBytes
            : defaults.maxBytes;
    const maxLines =
        typeof requestedMaxLines === 'number' && Number.isFinite(requestedMaxLines) && requestedMaxLines >= 0
            ? requestedMaxLines
            : defaults.maxLines;
    return {
        operation,
        maxBytes,
        maxLines,
        advisory: true,
        policyVersion: IO_POLICY_VERSION,
    };
}

/**
 * @param {{
 *     input: string;
 *     allowPrivateNetworks?: boolean;
 *     allowLocalhost?: boolean;
 *     maxRedirects?: number;
 * }} options
 */
export function evaluateIoUrlPolicy(options) {
    const input = typeof options?.input === 'string' ? options.input.trim() : '';
    if (!input) {
        return {
            ok: false,
            reason: 'URL is required',
            code: 'URL_REQUIRED',
            policyVersion: IO_POLICY_VERSION,
        };
    }

    void options.allowPrivateNetworks;
    void options.allowLocalhost;
    const validation = validateUrlString(input);

    if (!validation.safe || !validation.parsed) {
        return {
            ok: false,
            reason: validation.reason || 'Invalid URL',
            code: 'URL_BLOCKED',
            policyVersion: IO_POLICY_VERSION,
        };
    }

    return {
        ok: true,
        url: validation.parsed,
        maxRedirects:
            typeof options.maxRedirects === 'number' && options.maxRedirects >= 0
                ? options.maxRedirects
                : IO_URL_MAX_REDIRECTS,
        policyVersion: IO_POLICY_VERSION,
    };
}

/**
 * @param {{
 *     text: string;
 *     patterns?: { regex: RegExp; replacement?: string }[];
 * }} options
 */
export function sanitizeIoTextOutput(options) {
    const sourceText = typeof options?.text === 'string' ? options.text : '';
    const patterns =
        Array.isArray(options?.patterns) && options.patterns.length > 0
            ? options.patterns
            : DEFAULT_SENSITIVE_OUTPUT_PATTERNS;

    let redactions = 0;
    let text = sourceText;
    for (const pattern of patterns) {
        if (!(pattern?.regex instanceof RegExp)) continue;
        const replacement = typeof pattern.replacement === 'string' ? pattern.replacement : '[redacted]';
        text = text.replace(pattern.regex, () => {
            redactions += 1;
            return replacement;
        });
    }

    return {
        text,
        sanitized: redactions > 0,
        redactions,
        policyVersion: IO_POLICY_VERSION,
    };
}

/**
 * @param {readonly string[] | undefined} blockedSegments
 * @returns {readonly string[]}
 */
function normalizeBlockedSegments(blockedSegments) {
    if (!Array.isArray(blockedSegments) || blockedSegments.length === 0) {
        return DEFAULT_BLOCKED_PATH_SEGMENTS;
    }
    return Object.freeze(blockedSegments.map((segment) => `${segment || ''}`.trim().toLowerCase()).filter(Boolean));
}

/**
 * @param {readonly RegExp[] | undefined} blockedPatterns
 * @param {string} mode
 * @returns {readonly RegExp[]}
 */
function normalizeBlockedPatterns(blockedPatterns, mode) {
    if (Array.isArray(blockedPatterns) && blockedPatterns.length > 0) return blockedPatterns;
    return mode === 'write' || mode === 'append' || mode === 'delete' || mode === 'move' || mode === 'copy'
        ? DEFAULT_BLOCKED_WRITE_PATH_PATTERNS
        : DEFAULT_BLOCKED_READ_PATH_PATTERNS;
}

/**
 * @param {string | undefined} mode
 * @returns {string}
 */
function normalizePathPolicyMode(mode) {
    const normalized = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
    if (normalized === 'write' || normalized === 'append' || normalized === 'delete') return normalized;
    if (normalized === 'move' || normalized === 'copy' || normalized === 'patch') return 'write';
    if (normalized === 'mkdir') return 'write';
    return 'read';
}

/**
 * @param {string} workspaceRoot
 * @param {string} candidateAbsolutePath
 */
function evaluatePathContainment(workspaceRoot, candidateAbsolutePath) {
    const relativePath = path.relative(workspaceRoot, candidateAbsolutePath);
    return {
        relativePath,
        outsideWorkspace: relativePath === '' ? false : relativePath.startsWith('..') || path.isAbsolute(relativePath),
    };
}

/**
 * @param {string} filePath
 * @param {readonly RegExp[]} blockedPatterns
 */
function findBlockedPathPattern(filePath, blockedPatterns) {
    const basename = path.basename(filePath);
    return blockedPatterns.find((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(basename);
    });
}

/**
 * @param {string} absolutePath
 * @returns {Promise<{ realPath: string }>}
 */
async function resolveRealTargetForPolicy(absolutePath) {
    const unresolvedSegments = [];
    let candidate = absolutePath;

    while (true) {
        try {
            const realAncestor = await realpath(candidate);
            return {
                realPath:
                    unresolvedSegments.length === 0
                        ? realAncestor
                        : path.join(realAncestor, ...unresolvedSegments.reverse()),
            };
        } catch (error) {
            const code = String(/** @type {{ code?: unknown }} */ (error)?.code ?? '');
            if (code !== 'ENOENT' && code !== 'ENOTDIR') return { realPath: absolutePath };

            const parent = path.dirname(candidate);
            if (parent === candidate) return { realPath: absolutePath };
            unresolvedSegments.push(path.basename(candidate));
            candidate = parent;
        }
    }
}

/**
 * @param {string} inputPath
 * @returns {string}
 */
function normalizeInputPath(inputPath) {
    return inputPath.replace(/\\/g, '/');
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function splitPathSegments(value) {
    return value
        .split(/[\\/]/g)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.toLowerCase());
}

/**
 * @param {string} reason
 * @param {string} code
 * @returns {IoPathPolicyFailure}
 */
function fail(reason, code) {
    return {
        ok: false,
        reason,
        code,
        policyVersion: IO_POLICY_VERSION,
    };
}
