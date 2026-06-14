// @ts-check
/**
 * Policy canônica de configuração e erros do @babel/parser.
 *
 * @module copilot/infra/parse/babel-policy
 */

import { extname } from 'node:path';

/**
 * @param {string} filePath
 * @param {'js' | 'ts'} lang
 * @returns {Record<string, unknown>}
 */
export function resolveBabelParserOptions(filePath, lang) {
    const lowerPath = filePath.toLowerCase();
    const ext = extname(lowerPath);
    const sourceType = ext === '.cjs' || ext === '.cts' ? 'commonjs' : ext === '.mjs' || ext === '.mts' ? 'module' : 'unambiguous';
    /** @type {unknown[]} */
    const plugins = [];

    if (lang === 'ts') {
        const dts = /\.d\.(?:ts|mts|cts)$/u.test(lowerPath);
        const disallowAmbiguousJSXLike = ext === '.mts' || ext === '.cts';
        plugins.push(['typescript', { dts, disallowAmbiguousJSXLike }]);
        if (ext === '.tsx') plugins.push('jsx');
    } else {
        plugins.push('jsx');
    }
    plugins.push('decorators-legacy');

    return {
        sourceType,
        sourceFilename: filePath,
        plugins,
        errorRecovery: true,
        attachComment: true,
        createImportExpressions: true,
    };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function formatBabelParserError(error) {
    if (!error || typeof error !== 'object') return String(error);
    const value = /** @type {{ code?: unknown; reasonCode?: unknown; message?: unknown; loc?: { line?: unknown; column?: unknown } }} */ (
        error
    );
    const code = typeof value.code === 'string' ? value.code : 'BABEL_PARSER_ERROR';
    const reason = typeof value.reasonCode === 'string' ? value.reasonCode : null;
    const line = Number(value.loc?.line);
    const column = Number(value.loc?.column);
    const location = Number.isFinite(line) ? `@${line}:${Number.isFinite(column) ? column : 0}` : '';
    const message = typeof value.message === 'string' ? value.message.replace(/\s+\(\d+:\d+\)$/u, '') : '';
    return [code, reason, location, message].filter(Boolean).join(':');
}
