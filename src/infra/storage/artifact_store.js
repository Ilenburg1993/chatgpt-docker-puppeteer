// @ts-check - Type checking rigoroso habilitado (arquivo core)
//
// Node.js 24+ — ESM
// Convenções:
// - Escrita: sempre sob ARTIFACTS_ROOT (env > constante).
// - Leitura: valida que o path do DB não escapa do root.
// - Repo getArtifactById pode ser sync ou async (suportado).
// - Paths relativos são validados/normalizados em POSIX (forward slashes) para estabilidade cross-platform.

import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { deleteArtifactById, getArtifactById } from '#infra/db/artifact_repo';
import { ARTIFACTS_DIR } from '#infra/fs/paths';
import { atomicWrite } from '#infra/io';

/**
 * ✅ P1-22: Artifact size limits to prevent disk exhaustion Configurable via environment variables
 */
const MAX_TEXT_ARTIFACT_BYTES = Number(process.env.MAX_TEXT_ARTIFACT_BYTES) || 50 * 1024 * 1024; // 50 MB
const MAX_BINARY_ARTIFACT_BYTES = Number(process.env.MAX_BINARY_ARTIFACT_BYTES) || 100 * 1024 * 1024; // 100 MB
const MAX_JSON_ARTIFACT_BYTES = Number(process.env.MAX_JSON_ARTIFACT_BYTES) || 10 * 1024 * 1024; // 10 MB

/**
 * @typedef {object} PutArtifactResult
 * @property {string} kind
 * @property {string} mime
 * @property {string} storageUri
 * @property {number} sizeBytes
 * @property {string | null} sha256
 */

/**
 * Resolve the artifacts root directory (absolute). Env precedence: MAESTRO_ARTIFACTS_DIR > ARTIFACTS_DIR > default
 * constant.
 *
 * @returns {string}
 */
function _resolveArtifactsRoot() {
    const fromEnv = process.env.MAESTRO_ARTIFACTS_DIR || process.env.ARTIFACTS_DIR || null;
    return path.resolve(fromEnv || ARTIFACTS_DIR);
}

/**
 * True iff filePath is inside rootDir (or equals rootDir), after resolution.
 *
 * @param {string} rootDir
 * @param {string} filePath
 * @returns {boolean}
 */
function _isUnderRoot(rootDir, filePath) {
    try {
        const root = path.resolve(String(rootDir || ''));
        const full = path.resolve(String(filePath || ''));
        return full === root || full.startsWith(root + path.sep);
    } catch {
        return false;
    }
}

/**
 * Strictly validates and normalizes a relative path (POSIX-style). Rejects: empty, absolute, path traversal, NUL bytes.
 *
 * Returns a forward-slash path suitable for joining with the artifacts root.
 *
 * @param {string} rel
 * @returns {string}
 */
function _safeRel(rel) {
    const raw = String(rel ?? '')
        .replace(/\0/g, '')
        .replace(/\\/g, '/')
        .trim();

    if (!raw) throw new Error('artifact relPath required');
    if (path.posix.isAbsolute(raw)) throw new Error('artifact relPath must be relative');

    const normalized = path.posix.normalize(raw);

    // Traversal after normalize:
    // - exactly ".."
    // - starts with "../"
    // - contains "/../"
    if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
        throw new Error('artifact relPath may not contain ..');
    }

    // Optional hardening: forbid current-dir segments explicitly
    if (normalized === '.' || normalized.startsWith('./') || normalized.includes('/./')) {
        throw new Error('artifact relPath may not contain . segments');
    }

    return normalized;
}

/**
 * @param {string} text
 * @returns {string}
 */
function _sha256Text(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * @param {Buffer} buf
 * @returns {string}
 */
function _sha256Bytes(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Internal: resolves a safe absolute path under the artifacts root.
 *
 * @param {string} root
 * @param {string} rel
 * @returns {string}
 */
function _toFullPath(root, rel) {
    const safeRel = _safeRel(rel);
    const full = path.join(root, safeRel);

    // Defense-in-depth: ensure join didn't escape root.
    if (!_isUnderRoot(root, full)) throw new Error('artifact path escapes artifacts root');

    return full;
}

/**
 * Internal: supports either sync or async repo implementations.
 *
 * @param {string} artifactId
 * @returns {Promise<any>}
 */
async function _getArtifactRow(artifactId) {
    return await Promise.resolve(getArtifactById(artifactId));
}

/**
 * @typedef {object} PutTextOptions
 * @property {any} [kind]
 * @property {any} [text]
 * @property {any} [relPath]
 * @property {any} [ext]
 * @property {any} [mime]
 * @property {any} [computeSha256]
 */
/**
 * Writes a text artifact file and returns storage pointers/metadata (no DB write).
 *
 * @param {any} [params]
 * @returns {Promise<PutArtifactResult>}
 */
async function putText({ kind, text, relPath, ext = 'txt', mime = 'text/plain', computeSha256 = false } = {}) {
    const root = _resolveArtifactsRoot();

    const defaultRel = `${String(kind || 'artifact')}/${Date.now()}-${Math.random().toString(16).slice(2)}.${String(ext || 'txt')}`;
    const fullPath = _toFullPath(root, relPath || defaultRel);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    const body = String(text ?? '');

    // ✅ P1-22: Validate artifact size before writing to prevent disk exhaustion
    const sizeBytes = Buffer.byteLength(body, 'utf8');
    if (sizeBytes > MAX_TEXT_ARTIFACT_BYTES) {
        const error = /** @type {Error & { code?: string; sizeBytes?: number; maxBytes?: number }} */ (
            new Error(
                `Text artifact size ${sizeBytes} bytes exceeds limit ${MAX_TEXT_ARTIFACT_BYTES} bytes (${(MAX_TEXT_ARTIFACT_BYTES / 1024 / 1024).toFixed(1)} MB)`,
            )
        );
        error.code = 'ARTIFACT_SIZE_LIMIT_EXCEEDED';
        error.sizeBytes = sizeBytes;
        error.maxBytes = MAX_TEXT_ARTIFACT_BYTES;
        throw error;
    }

    await atomicWrite(fullPath, body, 'utf8');

    return {
        kind: String(kind || 'artifact'),
        mime: String(mime || 'text/plain'),
        storageUri: fullPath,
        sizeBytes: Buffer.byteLength(body, 'utf8'),
        sha256: computeSha256 ? _sha256Text(body) : null,
    };
}

/**
 * @typedef {object} PutBufferOptions
 * @property {any} [kind]
 * @property {any} [buffer]
 * @property {any} [relPath]
 * @property {any} [ext]
 * @property {any} [mime]
 * @property {any} [computeSha256]
 */
/**
 * Writes a binary artifact file and returns storage pointers/metadata (no DB write).
 *
 * @param {any} [params]
 * @returns {Promise<PutArtifactResult>}
 */
async function putBuffer({
    kind,
    buffer,
    relPath,
    ext = 'bin',
    mime = 'application/octet-stream',
    computeSha256 = false,
} = {}) {
    const root = _resolveArtifactsRoot();

    const defaultRel = `${String(kind || 'artifact')}/${Date.now()}-${Math.random().toString(16).slice(2)}.${String(ext || 'bin')}`;
    const fullPath = _toFullPath(root, relPath || defaultRel);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    /** @type {Buffer} */
    let body;
    if (Buffer.isBuffer(buffer)) {
        body = buffer;
    } else if (buffer instanceof Uint8Array) {
        body = Buffer.from(buffer);
    } else if (typeof buffer === 'string') {
        body = Buffer.from(buffer, 'utf8');
    } else if (buffer == null) {
        body = Buffer.alloc(0);
    } else {
        throw new TypeError('putBuffer: "buffer" must be Buffer, Uint8Array, string, or null/undefined');
    }

    // ✅ P1-22: Validate artifact size before writing to prevent disk exhaustion
    if (body.length > MAX_BINARY_ARTIFACT_BYTES) {
        const error = /** @type {Error & { code?: string; sizeBytes?: number; maxBytes?: number }} */ (
            new Error(
                `Binary artifact size ${body.length} bytes exceeds limit ${MAX_BINARY_ARTIFACT_BYTES} bytes (${(MAX_BINARY_ARTIFACT_BYTES / 1024 / 1024).toFixed(1)} MB)`,
            )
        );
        error.code = 'ARTIFACT_SIZE_LIMIT_EXCEEDED';
        error.sizeBytes = body.length;
        error.maxBytes = MAX_BINARY_ARTIFACT_BYTES;
        throw error;
    }

    await atomicWrite(fullPath, body);

    return {
        kind: String(kind || 'artifact'),
        mime: String(mime || 'application/octet-stream'),
        storageUri: fullPath,
        sizeBytes: Number(body.byteLength) || 0,
        sha256: computeSha256 ? _sha256Bytes(body) : null,
    };
}

/**
 * @typedef {object} PutJsonOptions
 * @property {any} [kind]
 * @property {any} [json]
 * @property {any} [relPath]
 * @property {any} [ext]
 * @property {any} [mime]
 * @property {any} [computeSha256]
 */
/**
 * Stores JSON data as an artifact (pretty-printed).
 *
 * @param {any} [params]
 * @returns {Promise<PutArtifactResult>}
 */
async function putJson({ kind, json, relPath, ext = 'json', mime = 'application/json', computeSha256 = false } = {}) {
    const body = JSON.stringify(json ?? null, null, 2);

    // ✅ P1-22: Validate JSON artifact size before writing (stricter limit than text)
    const sizeBytes = Buffer.byteLength(body, 'utf8');
    if (sizeBytes > MAX_JSON_ARTIFACT_BYTES) {
        const error = /** @type {Error & { code?: string; sizeBytes?: number; maxBytes?: number }} */ (
            new Error(
                `JSON artifact size ${sizeBytes} bytes exceeds limit ${MAX_JSON_ARTIFACT_BYTES} bytes (${(MAX_JSON_ARTIFACT_BYTES / 1024 / 1024).toFixed(1)} MB)`,
            )
        );
        error.code = 'ARTIFACT_SIZE_LIMIT_EXCEEDED';
        error.sizeBytes = sizeBytes;
        error.maxBytes = MAX_JSON_ARTIFACT_BYTES;
        throw error;
    }

    return await putText({ kind, text: body, relPath, ext, mime, computeSha256 });
}

/**
 * Resolves the on-disk URI for an artifact ID, but only if the URI is under the artifacts root. Returns null if the
 * artifact is unknown or points outside the allowed root.
 *
 * Note: expects DB row field `storage_uri` (snake_case). If your repo returns camelCase, adjust here.
 *
 * @param {string} artifactId
 * @returns {Promise<string | null>}
 */
async function resolveUri(artifactId) {
    const row = await _getArtifactRow(artifactId);
    const uri = row?.storage_uri || null;
    if (!uri) return null;

    const root = _resolveArtifactsRoot();
    if (!_isUnderRoot(root, uri)) return null;

    return uri;
}

/**
 * Reads a text artifact by id (utf8). Returns null if unavailable/outside root/missing from disk.
 *
 * @param {string} artifactId
 * @returns {Promise<string | null>}
 */
async function readText(artifactId) {
    const uri = await resolveUri(artifactId);
    if (!uri) return null;
    try {
        return await fs.readFile(uri, 'utf8');
    } catch (/** @type {any} */ _rawErr) {
        const err = /** @type {any} */ (_rawErr);
        if (err.code === 'ENOENT' || err.code === 'EACCES') return null;
        throw err;
    }
}

/**
 * Reads a binary artifact by id. Returns null if unavailable/outside root/missing from disk.
 *
 * @param {string} artifactId
 * @returns {Promise<Buffer | null>}
 */
async function readBuffer(artifactId) {
    const uri = await resolveUri(artifactId);
    if (!uri) return null;
    try {
        return await fs.readFile(uri);
    } catch (/** @type {any} */ _rawErr) {
        const err = /** @type {any} */ (_rawErr);
        if (err.code === 'ENOENT' || err.code === 'EACCES') return null;
        throw err;
    }
}

/**
 * Returns DB row + fsStat when available; flags unavailable when storage uri is missing or outside root.
 *
 * @param {string} artifactId
 * @returns {Promise<unknown | null>}
 */
async function stat(artifactId) {
    const row = await _getArtifactRow(artifactId);
    if (!row) return null;

    const root = _resolveArtifactsRoot();

    // DB row is snake_case (`storage_uri`); do not accidentally read `storageUri` here.
    if (!row.storage_uri || !_isUnderRoot(root, row.storage_uri)) {
        return { ...row, fsStat: null, unavailable: true };
    }

    let fsStat = null;
    try {
        fsStat = await fs.stat(row.storage_uri);
    } catch {
        // stat failed, keep null
    }

    return { ...row, fsStat, unavailable: !fsStat };
}

/**
 * Deletes an artifact: removes the file from disk (if present and under root) and the DB record. Returns true if the DB
 * record was deleted, false if not found.
 *
 * @param {string} artifactId
 * @returns {Promise<boolean>}
 */
async function deleteArtifact(artifactId) {
    const row = await _getArtifactRow(artifactId);
    if (!row) return false;

    // Remove file from disk (best-effort; may already be missing)
    const root = _resolveArtifactsRoot();
    if (row.storage_uri && _isUnderRoot(root, row.storage_uri)) {
        try {
            await fs.unlink(row.storage_uri);
        } catch (/** @type {any} */ _rawErr) {
            const err = /** @type {any} */ (_rawErr);
            if (err.code !== 'ENOENT') throw err;
        }
    }

    deleteArtifactById(artifactId);
    return true;
}

export {
    _isUnderRoot,
    _resolveArtifactsRoot,
    deleteArtifact,
    putBuffer,
    putJson,
    putText,
    readBuffer,
    readText,
    resolveUri,
    stat,
};
