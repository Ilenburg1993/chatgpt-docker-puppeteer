import crypto from 'node:crypto';
import { RAG_SCAN_PROFILES } from './scan.mjs';

const DOC_GLOBS = Object.freeze(['**/*.md', '**/*.mdx']);
const DEFAULT_MAX_FILE_BYTES = 2_000_000;

function parsePositiveInt(rawValue, fallback) {
    const parsed = Number.parseInt(String(rawValue ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDocsMode(rawMode) {
    const normalized = String(rawMode || '')
        .trim()
        .toLowerCase();
    if (normalized === 'exclude' || normalized === 'only') return normalized;
    return 'include';
}

function normalizeProfile(rawProfile) {
    const profile = String(rawProfile || 'core').trim();
    return Object.prototype.hasOwnProperty.call(RAG_SCAN_PROFILES, profile) ? profile : 'core';
}

function parseGlobList(rawValue) {
    if (Array.isArray(rawValue)) {
        return rawValue.flatMap(entry => parseGlobList(entry));
    }
    const raw = String(rawValue ?? '').trim();
    if (!raw) return [];
    return raw
        .split(/[\n,;]/g)
        .map(glob => String(glob || '').trim())
        .filter(Boolean)
        .map(glob => glob.replace(/\\/g, '/'));
}

function uniqueSorted(list) {
    return [...new Set(list)].sort((a, b) => a.localeCompare(b));
}

function toScopeHashPayload(scope) {
    return {
        profile: scope.profile,
        docs_mode: scope.docs_mode,
        include_globs: scope.include_globs,
        exclude_globs: scope.exclude_globs,
        max_file_bytes: scope.max_file_bytes,
    };
}

function buildScopeHash(scope) {
    const payload = JSON.stringify(toScopeHashPayload(scope));
    return crypto.createHash('sha256').update(payload).digest('hex');
}

export function resolveRagScopeConfig(input = {}) {
    const profile = normalizeProfile(input.profile ?? process.env.RAG_PROFILE_DEFAULT ?? 'core');
    const docsMode = normalizeDocsMode(input.docsMode ?? process.env.RAG_DOCS_MODE ?? 'include');
    const includeGlobs = uniqueSorted(parseGlobList(input.includeGlobs ?? process.env.RAG_INCLUDE_GLOBS));
    const excludeGlobsBase = parseGlobList(input.excludeGlobs ?? process.env.RAG_EXCLUDE_GLOBS);
    const excludeGlobs =
        docsMode === 'exclude' ? uniqueSorted([...excludeGlobsBase, ...DOC_GLOBS]) : uniqueSorted(excludeGlobsBase);
    const maxFileBytes = parsePositiveInt(
        input.maxFileBytes ?? process.env.RAG_INDEX_MAX_FILE_BYTES,
        DEFAULT_MAX_FILE_BYTES
    );

    const scope = {
        profile,
        docs_mode: docsMode,
        include_globs: includeGlobs,
        exclude_globs: excludeGlobs,
        max_file_bytes: maxFileBytes,
        scope_hash: '',
    };
    scope.scope_hash = buildScopeHash(scope);

    return {
        profile,
        docsMode,
        includeGlobs,
        excludeGlobs,
        maxFileBytes,
        scope,
        scopeHash: scope.scope_hash,
        docsGlobs: [...DOC_GLOBS],
    };
}
