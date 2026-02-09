// @ts-check - Type checking rigoroso habilitado (arquivo core)
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ARTIFACTS_DIR } from '#infra/fs/paths';
import { atomicWrite } from '#infra/io';
import { getArtifactById } from '#infra/db/artifact_repo';

function _resolveArtifactsRoot() {
    const fromEnv = process.env.MAESTRO_ARTIFACTS_DIR || process.env.ARTIFACTS_DIR || null;
    return path.resolve(fromEnv || ARTIFACTS_DIR);
}

function _safeRel(rel) {
    const raw = String(rel || '').replace(/\\/g, '/').trim();
    if (!raw) throw new Error('artifact relPath required');
    if (raw.includes('..')) throw new Error('artifact relPath may not contain ..');
    if (path.isAbsolute(raw)) throw new Error('artifact relPath must be relative');
    return raw;
}

function _sha256Text(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function _sha256Bytes(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Writes an artifact file and returns storage pointers/metadata (no DB write).
 */
async function putText({ kind, text, relPath, ext = 'txt', mime = 'text/plain', computeSha256 = false } = {}) {
    const root = _resolveArtifactsRoot();
    const safe = _safeRel(relPath || `${kind || 'artifact'}/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
    const fullPath = path.join(root, safe);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    const body = String(text ?? '');
    await atomicWrite(fullPath, body, 'utf-8');

    return {
        kind: String(kind || 'artifact'),
        mime: String(mime || 'text/plain'),
        storageUri: fullPath,
        sizeBytes: Buffer.byteLength(body, 'utf8'),
        sha256: computeSha256 ? _sha256Text(body) : null,
    };
}

/**
 * Writes a binary artifact file and returns storage pointers/metadata (no DB write).
 */
async function putBuffer({ kind, buffer, relPath, ext = 'bin', mime = 'application/octet-stream', computeSha256 = false } = {}) {
    const root = _resolveArtifactsRoot();
    const safe = _safeRel(relPath || `${kind || 'artifact'}/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
    const fullPath = path.join(root, safe);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? '');
    await atomicWrite(fullPath, body);

    return {
        kind: String(kind || 'artifact'),
        mime: String(mime || 'application/octet-stream'),
        storageUri: fullPath,
        sizeBytes: Number(body.byteLength) || 0,
        sha256: computeSha256 ? _sha256Bytes(body) : null,
    };
}

async function putJson({ kind, json, relPath, ext = 'json', mime = 'application/json', computeSha256 = false } = {}) {
    const body = JSON.stringify(json ?? null, null, 2);
    return await putText({ kind, text: body, relPath, ext, mime, computeSha256 });
}

function resolveUri(artifactId) {
    const row = getArtifactById(artifactId);
    return row?.storage_uri || null;
}

async function readText(artifactId) {
    const uri = resolveUri(artifactId);
    if (!uri) return null;
    return await fs.readFile(uri, 'utf8');
}

async function stat(artifactId) {
    const row = getArtifactById(artifactId);
    if (!row) return null;
    let fsStat = null;
    try {
        fsStat = await fs.stat(row.storage_uri);
    } catch (_) {
        fsStat = null;
    }
    return { ...row, fsStat };
}

export { putText, putBuffer, putJson, readText, stat, resolveUri, _resolveArtifactsRoot };
