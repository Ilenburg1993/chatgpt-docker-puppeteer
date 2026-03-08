// @ts-check
import path from 'node:path';

const DOC_EXTENSIONS = new Set(['.md', '.mdx']);
const CONFIG_EXTENSIONS = new Set(['.json', '.yml', '.yaml', '.toml', '.ini', '.env']);
const CONFIG_BASENAMES = new Set(['dockerfile', 'makefile']);

/**
 * @param {string} rawScope
 * @returns {'code-first' | 'docs-first' | 'all'}
 */
export function normalizeIntentScope(rawScope) {
    const scope = String(rawScope || '')
        .trim()
        .toLowerCase();
    if (scope === 'docs-first' || scope === 'all') return scope;
    return 'code-first';
}

/**
 * @param {string | null | undefined} value
 * @param {string | null | undefined} relPath
 * @param {string | null | undefined} extHint
 * @returns {'code' | 'config' | 'docs'}
 */
export function normalizeContentClass(value, relPath, extHint = null) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    if (normalized === 'code' || normalized === 'config' || normalized === 'docs') {
        return normalized;
    }
    return classifyContentClass(relPath, extHint);
}

/**
 * @param {string | null | undefined} relPath
 * @param {string | null | undefined} extHint
 * @returns {'code' | 'config' | 'docs'}
 */
export function classifyContentClass(relPath, extHint = null) {
    const rel = String(relPath || '').replace(/\\/g, '/');
    const base = path.posix.basename(rel).toLowerCase();
    const ext = String(extHint || path.posix.extname(base) || '').toLowerCase();

    if (DOC_EXTENSIONS.has(ext)) return 'docs';
    if (CONFIG_EXTENSIONS.has(ext)) return 'config';
    if (CONFIG_BASENAMES.has(base)) return 'config';
    if (base.endsWith('.env.example')) return 'config';
    if (base.endsWith('.dockerfile')) return 'config';

    return 'code';
}

/**
 * @param {'code' | 'config' | 'docs'} contentClass
 * @param {'code-first' | 'docs-first' | 'all'} intentScope
 * @returns {boolean}
 */
export function isPreferredByIntent(contentClass, intentScope) {
    if (intentScope === 'all') return true;
    if (intentScope === 'docs-first') return contentClass === 'docs';
    return contentClass === 'code' || contentClass === 'config';
}
