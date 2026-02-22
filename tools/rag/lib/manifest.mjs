import { promises as fs } from 'node:fs';
import { SCHEMA_VERSION, CHUNKER_VERSION, DEFAULT_EMBEDDING_MODEL, DEFAULT_OLLAMA_BASE_URL } from './contract.mjs';

export function createEmptyManifest() {
    const now = Date.now();
    return {
        schema_version: SCHEMA_VERSION,
        created_at: now,
        updated_at: now,
        fingerprint: { xxhash64: true, sha256: true },
        chunker_version: CHUNKER_VERSION,
        embedding: { model: DEFAULT_EMBEDDING_MODEL, dim: null, base_url_default: DEFAULT_OLLAMA_BASE_URL },
        last_scope: null,
        last_scope_hash: null,
        files: {},
    };
}

export async function loadManifest(paths) {
    try {
        const raw = await fs.readFile(paths.manifestPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.schema_version !== SCHEMA_VERSION) {
            throw new Error(
                `SCHEMA_VERSION_MISMATCH: Index schema is v${parsed?.schema_version || 'unknown'}, ` +
                    `but code expects v${SCHEMA_VERSION}.\n\n` +
                    `Solution: Reset the index (this will re-index all files):\n` +
                    `  npm run rag:reset -- --yes\n` +
                    `  npm run rag:index\n`
            );
        }
        if (!parsed.files || typeof parsed.files !== 'object') {
            parsed.files = {};
        }
        if (!parsed.embedding) {
            parsed.embedding = { model: DEFAULT_EMBEDDING_MODEL, dim: null, base_url_default: DEFAULT_OLLAMA_BASE_URL };
        }
        if (!('dim' in parsed.embedding)) {
            parsed.embedding.dim = null;
        }
        if (!parsed.embedding.model) {
            parsed.embedding.model = DEFAULT_EMBEDDING_MODEL;
        }
        if (!parsed.embedding.base_url_default) {
            parsed.embedding.base_url_default = DEFAULT_OLLAMA_BASE_URL;
        }
        if (!Object.prototype.hasOwnProperty.call(parsed, 'last_scope')) {
            parsed.last_scope = null;
        }
        if (!Object.prototype.hasOwnProperty.call(parsed, 'last_scope_hash')) {
            parsed.last_scope_hash = null;
        }
        if (!parsed.chunker_version) {
            parsed.chunker_version = CHUNKER_VERSION;
        }
        return parsed;
    } catch (err) {
        if (err?.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}
