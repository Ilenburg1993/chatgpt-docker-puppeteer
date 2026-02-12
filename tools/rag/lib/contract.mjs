import crypto from 'node:crypto';

export const SCHEMA_VERSION = 1;
export const CHUNKER_VERSION = 'v1';

// Embedding model (LOCAL Ollama only - v5.0)
// NOTE: Embeddings are NOT available on Ollama Cloud
// For text generation (coding/chat), use OllamaClient with qwen3-coder-next or qwen3-next
export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text:latest';

// Base URL for LOCAL Ollama (embeddings only - v5.0)
// Generation models use cloud URL (https://ollama.com) - see OllamaClient
// Fallback: Uses OLLAMA_LOCAL_BASE_URL env var if set
export const DEFAULT_OLLAMA_BASE_URL =
    process.env.OLLAMA_LOCAL_BASE_URL ||
    'http://host.docker.internal:11434/v1';

// Chunking limits optimized by file type
export const MAX_CHUNK_CHARS_CODE = 800;  // Code: smaller chunks for precision
export const MAX_CHUNK_CHARS_DOCS = 1200; // Docs: larger chunks for context
export const MAX_CHUNK_CHARS = MAX_CHUNK_CHARS_CODE; // Default (backward compat)

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

