// @ts-check
/**
 * Immutable process configuration for the Company Knowledge domain.
 *
 * Corpus selection, repository links, cache policy and Apps SDK widget origin are one feature-level generation. Tools
 * and protocol projections consume this normalized value instead of independently consulting ambient process state.
 *
 * @module copilot/mcp/company-knowledge/config
 */

import { createHash } from 'node:crypto';

export const COMPANY_KNOWLEDGE_PROCESS_CONFIG_SCHEMA_VERSION = 1;
export const COMPANY_KNOWLEDGE_PROCESS_CONFIG_KIND = 'copilot-mcp-company-knowledge-process-config';
export const DEFAULT_COMPANY_KNOWLEDGE_REPOSITORY_WEB_BASE =
    'https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/blob/main';
export const DEFAULT_COMPANY_KNOWLEDGE_CACHE_TTL_MS = 30_000;
export const DEFAULT_COMPANY_KNOWLEDGE_MAX_DOCUMENTS = 600;
export const DEFAULT_COMPANY_KNOWLEDGE_WIDGET_DOMAIN = 'https://mcp.aurelin.org';
export const DEFAULT_COMPANY_KNOWLEDGE_CORPUS_ROOTS = Object.freeze([
    'AUDITORIA-CLAUDE-2026-06-10.md',
    'README.md',
    'CHANGELOG.md',
    'src/copilot/README.md',
    'src/copilot/mcp/README.md',
    'src/copilot/docs',
    'src/copilot/model-gateway/docs',
    'src/copilot/model-gateway/README.md',
]);

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-company-knowledge-process-config';
 *     corpusRoots: readonly string[];
 *     repositoryWebBase: string;
 *     cacheTtlMs: number;
 *     maxDocuments: number;
 *     widgetDomain: string;
 *     corpusConfigKey: string;
 * }>} CompanyKnowledgeProcessConfig
 */

/**
 * Capture one immutable Company Knowledge process generation.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {CompanyKnowledgeProcessConfig}
 */
export function readCompanyKnowledgeProcessConfig(env = process.env) {
    const corpusRoots = Object.freeze(readCompanyKnowledgeCorpusRoots(env));
    const repositoryWebBase = normalizeRepositoryWebBase(env['COPILOT_MCP_COMPANY_KNOWLEDGE_REPOSITORY_WEB_BASE']);
    const cacheTtlMs = readBoundedInteger(
        env['COPILOT_MCP_COMPANY_KNOWLEDGE_CACHE_TTL_MS'],
        DEFAULT_COMPANY_KNOWLEDGE_CACHE_TTL_MS,
        0,
        10 * 60 * 1000,
    );
    const maxDocuments = readBoundedInteger(
        env['COPILOT_MCP_COMPANY_KNOWLEDGE_MAX_DOCUMENTS'],
        DEFAULT_COMPANY_KNOWLEDGE_MAX_DOCUMENTS,
        1,
        10_000,
    );
    const widgetDomain = resolveWidgetDomain(env);
    const corpusConfigKey = createHash('sha256')
        .update(`${corpusRoots.join('\n')}\n${repositoryWebBase}\n${cacheTtlMs}\n${maxDocuments}`)
        .digest('hex');
    return Object.freeze({
        schemaVersion: COMPANY_KNOWLEDGE_PROCESS_CONFIG_SCHEMA_VERSION,
        kind: COMPANY_KNOWLEDGE_PROCESS_CONFIG_KIND,
        corpusRoots,
        repositoryWebBase,
        cacheTtlMs,
        maxDocuments,
        widgetDomain,
        corpusConfigKey,
    });
}

/**
 * @param {CompanyKnowledgeProcessConfig | NodeJS.ProcessEnv | undefined} [input]
 * @returns {CompanyKnowledgeProcessConfig}
 */
export function resolveCompanyKnowledgeProcessConfig(input = undefined) {
    return isCompanyKnowledgeProcessConfig(input) ? input : readCompanyKnowledgeProcessConfig(input);
}

/** @param {unknown} value @returns {value is CompanyKnowledgeProcessConfig} */
export function isCompanyKnowledgeProcessConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = /** @type {Record<string, unknown>} */ (value);
    return (
        record['schemaVersion'] === COMPANY_KNOWLEDGE_PROCESS_CONFIG_SCHEMA_VERSION &&
        record['kind'] === COMPANY_KNOWLEDGE_PROCESS_CONFIG_KIND
    );
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function readCompanyKnowledgeCorpusRoots(env = {}) {
    const configured = env['COPILOT_MCP_COMPANY_KNOWLEDGE_ROOTS'];
    const rawRoots = configured && configured.trim() ? configured.split(',') : DEFAULT_COMPANY_KNOWLEDGE_CORPUS_ROOTS;
    return uniqueStrings(rawRoots.map((root) => String(root).trim()).filter(Boolean));
}

/** @param {NodeJS.ProcessEnv} env */
function resolveWidgetDomain(env) {
    const explicit = String(env['COPILOT_MCP_WIDGET_DOMAIN'] ?? '').trim();
    if (explicit) return normalizeDedicatedHttpsOrigin(explicit, true);
    for (const candidate of [
        env['COPILOT_MCP_CLOUDFLARE_PUBLIC_MCP_URL'],
        env['COPILOT_MCP_PUBLIC_URL'],
        DEFAULT_COMPANY_KNOWLEDGE_WIDGET_DOMAIN,
    ]) {
        const normalized = normalizeDedicatedHttpsOrigin(String(candidate ?? '').trim(), false);
        if (normalized) return normalized;
    }
    return DEFAULT_COMPANY_KNOWLEDGE_WIDGET_DOMAIN;
}

/** @param {unknown} value */
function normalizeRepositoryWebBase(value) {
    const normalized = String(value ?? DEFAULT_COMPANY_KNOWLEDGE_REPOSITORY_WEB_BASE)
        .trim()
        .replace(/\/+$/u, '');
    return normalized || DEFAULT_COMPANY_KNOWLEDGE_REPOSITORY_WEB_BASE;
}

/** @param {string} value @param {boolean} strictOrigin */
function normalizeDedicatedHttpsOrigin(value, strictOrigin) {
    if (!value) return '';
    try {
        const parsed = new URL(value);
        const exactOrigin =
            parsed.pathname === '/' && !parsed.search && !parsed.hash && !parsed.username && !parsed.password;
        if (parsed.protocol !== 'https:' || (strictOrigin && !exactOrigin)) {
            if (strictOrigin) {
                throw new Error('expected a dedicated HTTPS origin without path, query, hash, or userinfo');
            }
            return '';
        }
        return parsed.origin;
    } catch (error) {
        if (strictOrigin) {
            throw new Error(
                `Invalid COPILOT_MCP_WIDGET_DOMAIN: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
            );
        }
        return '';
    }
}

/** @param {unknown} value @param {number} fallback @param {number} minimum @param {number} maximum */
function readBoundedInteger(value, fallback, minimum, maximum) {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
}

/** @param {readonly string[]} values */
function uniqueStrings(values) {
    return [...new Set(values.map((value) => String(value)).filter(Boolean))];
}
