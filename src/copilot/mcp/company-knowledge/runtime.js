// @ts-check
/** Bounded local Company Knowledge corpus, cache, scanner, search and fetch runtime. */

import { createHash } from 'node:crypto';
import path from 'node:path';

/** @typedef {import('./config.js').CompanyKnowledgeProcessConfig} CompanyKnowledgeProcessConfig */
/** @typedef {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} McpWorkspaceCapability */

/**
 * @typedef {{
 *     id: string;
 *     title: string;
 *     url: string;
 *     path: string;
 *     text: string;
 *     sizeBytes: number;
 *     mtimeMs: number;
 *     truncated: boolean;
 *     sha256: string;
 * }} CompanyKnowledgeDocument
 *
 * @typedef {{ id: string; title: string; url: string }} CompanyKnowledgeSearchResult
 */

const DEFAULT_SEARCH_RESULT_LIMIT = 10;

export const MAX_QUERY_LENGTH = 512;

const MAX_DOCUMENT_BYTES = 768 * 1024;

const MAX_DOCUMENT_TEXT_BYTES = 256 * 1024;

const MAX_TITLE_LENGTH = 140;

const MAX_TOKEN_COUNT = 16;

const MAX_METADATA_STRING_LENGTH = 512;

const DOCUMENT_EXTENSIONS = Object.freeze(['.md', '.mdx', '.txt', '.json', '.jsonc', '.yaml', '.yml']);

const SKIPPED_DIRECTORY_NAMES = Object.freeze([
    '.ai',
    '.cache',
    '.git',
    '.github',
    '.husky',
    'artifacts',
    'coverage',
    'dist',
    'logs',
    'node_modules',
    'tmp',
]);

/**
 * Cache lifetime follows both workspace and immutable configuration generation by weak identity. A discarded process
 * host/config generation therefore cannot remain strongly retained by this wire module.
 *
 * @type {WeakMap<object, WeakMap<object, { expiresAt: number; documents: CompanyKnowledgeDocument[] }>>}
 */
let corpusCacheByWorkspace = new WeakMap();

export function resetCompanyKnowledgeCorpusCacheForTests() {
    corpusCacheByWorkspace = new WeakMap();
}

/**
 * @param {McpWorkspaceCapability} workspace
 * @param {string} query
 * @param {CompanyKnowledgeProcessConfig} config
 * @returns {Promise<CompanyKnowledgeSearchResult[]>}
 */
export async function searchCompanyKnowledge(workspace, query, config) {
    const normalizedQuery = normalizeSearchText(query).slice(0, MAX_QUERY_LENGTH);
    const tokens = tokenize(normalizedQuery);
    if (tokens.length === 0) return [];
    const documents = await loadCompanyKnowledgeDocuments(workspace, config);
    return documents
        .map((document) => ({ document, score: scoreDocument(document, normalizedQuery, tokens) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.document.path.localeCompare(right.document.path))
        .slice(0, DEFAULT_SEARCH_RESULT_LIMIT)
        .map(({ document }) => ({
            id: document.id,
            title: document.title,
            url: document.url,
        }));
}

/**
 * @param {McpWorkspaceCapability} workspace
 * @param {string} id
 * @param {CompanyKnowledgeProcessConfig} config
 * @returns {Promise<CompanyKnowledgeDocument | null>}
 */
export async function fetchCompanyKnowledgeDocument(workspace, id, config) {
    const decodedPath = decodeCompanyKnowledgeDocumentId(id);
    if (!decodedPath) return null;
    const documents = await loadCompanyKnowledgeDocuments(workspace, config);
    return documents.find((document) => document.path === decodedPath && document.id === id) ?? null;
}

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {import('./config.js').CompanyKnowledgeProcessConfig} config
 * @returns {Promise<CompanyKnowledgeDocument[]>}
 */
async function loadCompanyKnowledgeDocuments(workspace, config) {
    let byConfig = corpusCacheByWorkspace.get(workspace);
    if (!byConfig) {
        byConfig = new WeakMap();
        corpusCacheByWorkspace.set(workspace, byConfig);
    }
    const now = Date.now();
    const cached = byConfig.get(config);
    if (cached && cached.expiresAt >= now) return cached.documents;
    const documents = await buildCompanyKnowledgeCorpus(workspace, config);
    byConfig.set(config, {
        expiresAt: now + config.cacheTtlMs,
        documents,
    });
    return documents;
}

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {import('./config.js').CompanyKnowledgeProcessConfig} config
 * @returns {Promise<CompanyKnowledgeDocument[]>}
 */
async function buildCompanyKnowledgeCorpus(workspace, config) {
    /** @type {string[]} */
    const candidateFiles = [];
    const maxDocuments = config.maxDocuments;
    for (const root of config.corpusRoots) {
        if (candidateFiles.length >= maxDocuments) break;
        const resolved = await workspace.resolveReadPath(root);
        if (!resolved.ok) continue;
        const rootStats = await safeStat(workspace.io, resolved.resolved);
        if (!rootStats) continue;
        if (rootStats.isFile()) {
            if (isCompanyKnowledgeFile(resolved.resolved)) candidateFiles.push(resolved.resolved);
            continue;
        }
        if (rootStats.isDirectory()) {
            await collectCompanyKnowledgeFiles(workspace.io, resolved.resolved, candidateFiles, maxDocuments, 0);
        }
    }

    const uniqueFiles = uniqueStrings(candidateFiles).sort((left, right) =>
        path.relative(workspace.workspaceRoot, left).localeCompare(path.relative(workspace.workspaceRoot, right)),
    );
    /** @type {CompanyKnowledgeDocument[]} */
    const documents = [];
    for (const filePath of uniqueFiles.slice(0, maxDocuments)) {
        const document = await readCompanyKnowledgeDocument(workspace, filePath, config);
        if (document) documents.push(document);
    }
    return documents;
}

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability['io']} workspaceIo
 * @param {string} directory
 * @param {string[]} files
 * @param {number} maxFiles
 * @param {number} depth
 * @returns {Promise<void>}
 */
async function collectCompanyKnowledgeFiles(workspaceIo, directory, files, maxFiles, depth) {
    if (files.length >= maxFiles || depth > 8) return;
    const entries = (await workspaceIo.listDirectoryNamesFresh(directory)).entries;
    for (const entryName of entries) {
        if (files.length >= maxFiles) return;
        if (entryName.startsWith('.') || SKIPPED_DIRECTORY_NAMES.includes(entryName)) continue;
        const fullPath = path.join(directory, entryName);
        const info = (await workspaceIo.lstatPath(fullPath)).stats;
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) {
            await collectCompanyKnowledgeFiles(workspaceIo, fullPath, files, maxFiles, depth + 1);
            continue;
        }
        if (info.isFile() && isCompanyKnowledgeFile(fullPath)) files.push(fullPath);
    }
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isCompanyKnowledgeFile(filePath) {
    return DOCUMENT_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {string} filePath
 * @param {import('./config.js').CompanyKnowledgeProcessConfig} config
 * @returns {Promise<CompanyKnowledgeDocument | null>}
 */
async function readCompanyKnowledgeDocument(workspace, filePath, config) {
    const root = workspace.workspaceRoot;
    const relativePath = normalizeWorkspaceRelativePath(path.relative(root, filePath));
    if (!relativePath || relativePath.startsWith('../')) return null;
    const fileStats = await safeStat(workspace.io, filePath);
    if (!fileStats || !fileStats.isFile()) return null;
    const boundedReadBytes = Math.min(fileStats.size, MAX_DOCUMENT_BYTES);
    const snapshot = await workspace.io.readBytesFresh(filePath, { includeHash: true });
    const raw = snapshot.content;
    const truncatedByFileBudget = raw.byteLength > boundedReadBytes;
    const readBuffer = truncatedByFileBudget ? raw.subarray(0, boundedReadBytes) : raw;
    const { text, truncated: truncatedByTextBudget } = truncateTextByBytes(
        readBuffer.toString('utf8'),
        MAX_DOCUMENT_TEXT_BYTES,
    );
    return {
        id: encodeCompanyKnowledgeDocumentId(relativePath),
        title: inferDocumentTitle(relativePath, text),
        url: buildDocumentUrl(relativePath, config),
        path: relativePath,
        text,
        sizeBytes: fileStats.size,
        mtimeMs: fileStats.mtimeMs,
        truncated: truncatedByFileBudget || truncatedByTextBudget,
        sha256: snapshot.contentHash ?? createHash('sha256').update(raw).digest('hex'),
    };
}

/** @param {string} relativePath @returns {string} */
export function encodeCompanyKnowledgeDocumentId(relativePath) {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    return `repo:${Buffer.from(normalized, 'utf8').toString('base64url')}`;
}

/** @param {string} id @returns {string | null} */
export function decodeCompanyKnowledgeDocumentId(id) {
    if (!String(id).startsWith('repo:')) return null;
    try {
        const decoded = Buffer.from(String(id).slice('repo:'.length), 'base64url').toString('utf8');
        const normalized = normalizeWorkspaceRelativePath(decoded);
        if (!normalized || normalized.startsWith('../') || path.isAbsolute(normalized)) return null;
        return normalized;
    } catch {
        return null;
    }
}

/**
 * @param {string} relativePath
 * @param {import('./config.js').CompanyKnowledgeProcessConfig} config
 * @returns {string}
 */
function buildDocumentUrl(relativePath, config) {
    const encodedPath = normalizeWorkspaceRelativePath(relativePath)
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
    return `${config.repositoryWebBase}/${encodedPath}`;
}

/**
 * @param {string} relativePath
 * @param {string} text
 * @returns {string}
 */
function inferDocumentTitle(relativePath, text) {
    const heading = text
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => /^#{1,3}\s+\S/u.test(line));
    const title = heading ? heading.replace(/^#{1,3}\s+/u, '').trim() : path.basename(relativePath);
    return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : title;
}

/**
 * @param {CompanyKnowledgeDocument} document
 * @param {string} normalizedQuery
 * @param {string[]} tokens
 * @returns {number}
 */
function scoreDocument(document, normalizedQuery, tokens) {
    const haystackTitle = normalizeSearchText(document.title);
    const haystackPath = normalizeSearchText(document.path);
    const haystackText = normalizeSearchText(document.text);
    let score = 0;
    if (normalizedQuery && haystackTitle.includes(normalizedQuery)) score += 60;
    if (normalizedQuery && haystackPath.includes(normalizedQuery)) score += 35;
    if (normalizedQuery && haystackText.includes(normalizedQuery)) score += 20;
    for (const token of tokens) {
        if (haystackTitle.includes(token)) score += 12;
        if (haystackPath.includes(token)) score += 8;
        if (haystackText.includes(token)) score += 2;
    }
    if (
        tokens.every(
            (token) => haystackText.includes(token) || haystackTitle.includes(token) || haystackPath.includes(token),
        )
    ) {
        score += 10;
    }
    return score;
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeSearchText(value) {
    return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9_./:-]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function tokenize(value) {
    return uniqueStrings(
        normalizeSearchText(value)
            .split(/\s+/u)
            .filter((token) => token.length >= 2),
    ).slice(0, MAX_TOKEN_COUNT);
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeWorkspaceRelativePath(value) {
    return String(value).replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+/gu, '/').trim();
}

/**
 * @param {string} text
 * @param {number} maxBytes
 * @returns {{ text: string; truncated: boolean }}
 */
function truncateTextByBytes(text, maxBytes) {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes <= maxBytes) return { text, truncated: false };
    return {
        text: `${Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8')}\n\n[truncated]`,
        truncated: true,
    };
}

/**
 * @param {string} value
 * @returns {string}
 */
function truncateMetadataString(value) {
    const text = String(value)
        .replace(/[\r\n\t]+/gu, ' ')
        .trim();
    return text.length > MAX_METADATA_STRING_LENGTH
        ? `${text.slice(0, MAX_METADATA_STRING_LENGTH - 1).trimEnd()}…`
        : text;
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
    return [...new Set(values.map((value) => String(value)).filter(Boolean))];
}

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability['io']} workspaceIo
 * @param {string} filePath
 * @returns {Promise<import('node:fs').Stats | null>}
 */
async function safeStat(workspaceIo, filePath) {
    try {
        return (await workspaceIo.lstatPath(filePath)).stats;
    } catch {
        return null;
    }
}

/**
 * Build the bounded metadata projection returned by the fetch wire adapter.
 * @param {CompanyKnowledgeDocument} document
 */
export function buildCompanyKnowledgeDocumentMetadata(document) {
    return {
        source: 'workspace-company-knowledge',
        path: truncateMetadataString(document.path),
        sizeBytes: document.sizeBytes,
        mtimeMs: document.mtimeMs,
        truncated: document.truncated,
        sha256: document.sha256,
    };
}
