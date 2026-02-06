import crypto from 'node:crypto';

export const SCHEMA_VERSION = 1;
export const CHUNKER_VERSION = 'v1';
export const DEFAULT_EMBEDDING_MODEL = 'qwen3-embedding:4b';
export const DEFAULT_OLLAMA_BASE_URL = 'http://host.docker.internal:11434/v1';

export function sha256Hex(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

export function sha256HexForString(text) {
    return sha256Hex(Buffer.from(text, 'utf8'));
}

export function normalizeRelPath(pathLike) {
    return String(pathLike).split('\\').join('/');
}

export function buildFileId(relPath) {
    return sha256HexForString(`file:${normalizeRelPath(relPath)}`);
}

export function buildChunkId({ relPath, startByte, endByte, contentSha256, chunkerVersion = CHUNKER_VERSION }) {
    const base = `${normalizeRelPath(relPath)}:${startByte}:${endByte}:${contentSha256}:${chunkerVersion}`;
    return sha256HexForString(base);
}

