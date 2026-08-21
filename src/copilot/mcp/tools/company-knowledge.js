// @ts-check
/**
 * Read-only Company Knowledge tools for ChatGPT deep research / data-only apps.
 *
 * The OpenAI connector expects exact `search` and `fetch` tool names for Company Knowledge-style retrieval. These tools
 * intentionally expose only a bounded, local, documentation-oriented corpus; they do not perform network access and do
 * not read arbitrary paths outside the configured corpus roots.
 *
 * @module copilot/mcp/tools/company-knowledge
 */

import { createWorkspaceIo } from '#copilot/infra/public/filesystem/workspace';
import {
    errorResult,
    getMcpWorkspaceRoot,
    okResult,
    readOnlyAnnotations,
    resolveReadPath,
} from '#copilot/mcp/control-plane';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

export const COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME = 'search';
export const COMPANY_KNOWLEDGE_FETCH_TOOL_NAME = 'fetch';
export const COMPANY_KNOWLEDGE_WIDGET_URI = 'ui://copilot/company-knowledge/v2.html';

const DEFAULT_REPOSITORY_WEB_BASE = 'https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/blob/main';
const DEFAULT_SEARCH_RESULT_LIMIT = 10;
const DEFAULT_CORPUS_CACHE_TTL_MS = 30_000;
const DEFAULT_MAX_DOCUMENTS = 600;
const MAX_QUERY_LENGTH = 512;
const MAX_DOCUMENT_BYTES = 768 * 1024;
const MAX_DOCUMENT_TEXT_BYTES = 256 * 1024;
const MAX_TITLE_LENGTH = 140;
const MAX_TOKEN_COUNT = 16;
const MAX_METADATA_STRING_LENGTH = 512;

const DEFAULT_CORPUS_ROOTS = Object.freeze([
    'AUDITORIA-CLAUDE-2026-06-10.md',
    'README.md',
    'CHANGELOG.md',
    'src/copilot/README.md',
    'src/copilot/mcp/README.md',
    'src/copilot/docs',
    'src/copilot/model-gateway/docs',
    'src/copilot/model-gateway/README.md',
]);

const companyKnowledgeWorkspaceIo = createWorkspaceIo({ workspaceRoot: getMcpWorkspaceRoot() });

const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.json', '.jsonc', '.yaml', '.yml']);
const SKIPPED_DIRECTORY_NAMES = new Set([
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

/** @type {{ key: string; expiresAt: number; documents: CompanyKnowledgeDocument[] } | null} */
let corpusCache = null;

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
 *
 * @typedef {{ id: string; title: string; url: string }} CompanyKnowledgeSearchResult
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function readCompanyKnowledgeCorpusRoots(env = process.env) {
    const configured = env['COPILOT_MCP_COMPANY_KNOWLEDGE_ROOTS'];
    const rawRoots = configured && configured.trim() ? configured.split(',') : DEFAULT_CORPUS_ROOTS;
    return uniqueStrings(rawRoots.map((root) => String(root).trim()).filter(Boolean));
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function readRepositoryWebBase(env = process.env) {
    const value = String(
        env['COPILOT_MCP_COMPANY_KNOWLEDGE_REPOSITORY_WEB_BASE'] ?? DEFAULT_REPOSITORY_WEB_BASE,
    ).trim();
    return value.replace(/\/+$/u, '') || DEFAULT_REPOSITORY_WEB_BASE;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
function readCorpusCacheTtlMs(env = process.env) {
    return readPositiveIntegerEnv(
        env,
        'COPILOT_MCP_COMPANY_KNOWLEDGE_CACHE_TTL_MS',
        DEFAULT_CORPUS_CACHE_TTL_MS,
        0,
        10 * 60 * 1000,
    );
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
function readMaxDocuments(env = process.env) {
    return readPositiveIntegerEnv(env, 'COPILOT_MCP_COMPANY_KNOWLEDGE_MAX_DOCUMENTS', DEFAULT_MAX_DOCUMENTS, 1, 10_000);
}

/**
 * @returns {void}
 */
export function resetCompanyKnowledgeCorpusCacheForTests() {
    corpusCache = null;
}

/**
 * @param {string} query
 * @returns {Promise<CompanyKnowledgeSearchResult[]>}
 */
export async function searchCompanyKnowledge(query) {
    const normalizedQuery = normalizeSearchText(query).slice(0, MAX_QUERY_LENGTH);
    const tokens = tokenize(normalizedQuery);
    if (tokens.length === 0) return [];
    const documents = await loadCompanyKnowledgeDocuments();
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
 * @param {string} id
 * @returns {Promise<CompanyKnowledgeDocument | null>}
 */
export async function fetchCompanyKnowledgeDocument(id) {
    const decodedPath = decodeCompanyKnowledgeDocumentId(id);
    if (!decodedPath) return null;
    const documents = await loadCompanyKnowledgeDocuments();
    return documents.find((document) => document.path === decodedPath && document.id === id) ?? null;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<CompanyKnowledgeDocument[]>}
 */
async function loadCompanyKnowledgeDocuments(env = process.env) {
    const roots = readCompanyKnowledgeCorpusRoots(env);
    const key = JSON.stringify({
        roots,
        maxDocuments: readMaxDocuments(env),
        repositoryWebBase: readRepositoryWebBase(env),
    });
    const now = Date.now();
    if (corpusCache && corpusCache.key === key && corpusCache.expiresAt >= now) return corpusCache.documents;
    const documents = await buildCompanyKnowledgeCorpus(roots, env);
    corpusCache = {
        key,
        expiresAt: now + readCorpusCacheTtlMs(env),
        documents,
    };
    return documents;
}

/**
 * @param {string[]} roots
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<CompanyKnowledgeDocument[]>}
 */
async function buildCompanyKnowledgeCorpus(roots, env) {
    /** @type {string[]} */
    const candidateFiles = [];
    const maxDocuments = readMaxDocuments(env);
    for (const root of roots) {
        if (candidateFiles.length >= maxDocuments) break;
        const resolved = await resolveReadPath(root);
        if (!resolved.ok) continue;
        const rootStats = await safeStat(resolved.resolved);
        if (!rootStats) continue;
        if (rootStats.isFile()) {
            if (isCompanyKnowledgeFile(resolved.resolved)) candidateFiles.push(resolved.resolved);
            continue;
        }
        if (rootStats.isDirectory()) {
            await collectCompanyKnowledgeFiles(resolved.resolved, candidateFiles, maxDocuments, 0);
        }
    }

    const uniqueFiles = uniqueStrings(candidateFiles).sort((left, right) =>
        path.relative(getMcpWorkspaceRoot(), left).localeCompare(path.relative(getMcpWorkspaceRoot(), right)),
    );
    /** @type {CompanyKnowledgeDocument[]} */
    const documents = [];
    for (const filePath of uniqueFiles.slice(0, maxDocuments)) {
        const document = await readCompanyKnowledgeDocument(filePath, env);
        if (document) documents.push(document);
    }
    return documents;
}

/**
 * @param {string} directory
 * @param {string[]} files
 * @param {number} maxFiles
 * @param {number} depth
 * @returns {Promise<void>}
 */
async function collectCompanyKnowledgeFiles(directory, files, maxFiles, depth) {
    if (files.length >= maxFiles || depth > 8) return;
    const entries = (await companyKnowledgeWorkspaceIo.listDirectoryNamesFresh(directory)).entries;
    for (const entryName of entries) {
        if (files.length >= maxFiles) return;
        if (entryName.startsWith('.') || SKIPPED_DIRECTORY_NAMES.has(entryName)) continue;
        const fullPath = path.join(directory, entryName);
        const info = (await companyKnowledgeWorkspaceIo.lstatPath(fullPath)).stats;
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) {
            await collectCompanyKnowledgeFiles(fullPath, files, maxFiles, depth + 1);
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
    return DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * @param {string} filePath
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<CompanyKnowledgeDocument | null>}
 */
async function readCompanyKnowledgeDocument(filePath, env) {
    const root = getMcpWorkspaceRoot();
    const relativePath = normalizeWorkspaceRelativePath(path.relative(root, filePath));
    if (!relativePath || relativePath.startsWith('../')) return null;
    const fileStats = await safeStat(filePath);
    if (!fileStats || !fileStats.isFile()) return null;
    const boundedReadBytes = Math.min(fileStats.size, MAX_DOCUMENT_BYTES);
    const snapshot = await companyKnowledgeWorkspaceIo.readBytesFresh(filePath, { includeHash: true });
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
        url: buildDocumentUrl(relativePath, env),
        path: relativePath,
        text,
        sizeBytes: fileStats.size,
        mtimeMs: fileStats.mtimeMs,
        truncated: truncatedByFileBudget || truncatedByTextBudget,
        sha256: snapshot.contentHash ?? createHash('sha256').update(raw).digest('hex'),
    };
}

/**
 * @param {string} relativePath
 * @returns {string}
 */
export function encodeCompanyKnowledgeDocumentId(relativePath) {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    return `repo:${Buffer.from(normalized, 'utf8').toString('base64url')}`;
}

/**
 * @param {string} id
 * @returns {string | null}
 */
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
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function buildDocumentUrl(relativePath, env = process.env) {
    const encodedPath = normalizeWorkspaceRelativePath(relativePath)
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
    return `${readRepositoryWebBase(env)}/${encodedPath}`;
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
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function readPositiveIntegerEnv(env, name, fallback, minimum, maximum) {
    const parsed = Number(env[name] ?? fallback);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
}

/**
 * @param {string} filePath
 * @returns {Promise<import('node:fs').Stats | null>}
 */
async function safeStat(filePath) {
    try {
        return (await companyKnowledgeWorkspaceIo.lstatPath(filePath)).stats;
    } catch {
        return null;
    }
}

/**
 * @type {import('../registry.js').McpToolDefinition[]}
 */
export const companyKnowledgeTools = [
    {
        name: COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME,
        title: 'Search Company Knowledge',
        description:
            'Search the bounded local Company Knowledge corpus. Read-only; returns only id, title and url for fetchable workspace documents.',
        inputSchema: {
            query: z.string().min(1).max(MAX_QUERY_LENGTH)['describe']('Search query string.'),
        },
        outputSchema: {
            results: z.array(
                z.object({
                    id: z.string(),
                    title: z.string(),
                    url: z.string(),
                }),
            ),
        },
        annotations: readOnlyAnnotations(),
        _meta: {
            ui: { resourceUri: COMPANY_KNOWLEDGE_WIDGET_URI },
            'openai/outputTemplate': COMPANY_KNOWLEDGE_WIDGET_URI,
            'openai/toolInvocation/invoking': 'Buscando conhecimento...',
            'openai/toolInvocation/invoked': 'Busca concluida',
        },
        handler: async ({ query }) => {
            const results = await searchCompanyKnowledge(String(query ?? ''));
            const structured = { results };
            return okResult(structured, JSON.stringify(structured));
        },
    },
    {
        name: COMPANY_KNOWLEDGE_FETCH_TOOL_NAME,
        title: 'Fetch Company Knowledge',
        description:
            'Fetch one document previously returned by Company Knowledge search. Read-only; the id must be a repo:* result id.',
        inputSchema: {
            id: z.string().min(1).max(4096)['describe']('Document id returned by the search tool.'),
        },
        outputSchema: {
            id: z.string(),
            title: z.string(),
            text: z.string(),
            url: z.string(),
            metadata: z.record(z.string(), z.unknown()).optional(),
        },
        annotations: readOnlyAnnotations(),
        _meta: {
            ui: { resourceUri: COMPANY_KNOWLEDGE_WIDGET_URI },
            'openai/outputTemplate': COMPANY_KNOWLEDGE_WIDGET_URI,
            'openai/toolInvocation/invoking': 'Lendo conhecimento...',
            'openai/toolInvocation/invoked': 'Leitura concluida',
        },
        handler: async ({ id }) => {
            const document = await fetchCompanyKnowledgeDocument(String(id ?? ''));
            if (!document) {
                return errorResult('Company Knowledge document not found.', {
                    code: 'COMPANY_KNOWLEDGE_DOCUMENT_NOT_FOUND',
                    hint: 'Call search first and pass an id returned by that tool.',
                });
            }
            const structured = {
                id: document.id,
                title: document.title,
                text: document.text,
                url: document.url,
                metadata: {
                    source: 'workspace-company-knowledge',
                    path: truncateMetadataString(document.path),
                    sizeBytes: document.sizeBytes,
                    mtimeMs: document.mtimeMs,
                    truncated: document.truncated,
                    sha256: document.sha256,
                },
            };
            return okResult(structured, JSON.stringify(structured));
        },
    },
];

export const companyKnowledgeTestHarness = {
    decodeCompanyKnowledgeDocumentId,
    encodeCompanyKnowledgeDocumentId,
    fetchCompanyKnowledgeDocument,
    readCompanyKnowledgeCorpusRoots,
    resetCompanyKnowledgeCorpusCacheForTests,
    searchCompanyKnowledge,
};
