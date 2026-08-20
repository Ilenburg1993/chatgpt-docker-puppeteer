// @ts-check
/**
 * Policy canônica de configuração e erros do @babel/parser.
 *
 * Babel 8 é o plano sintático leve das tools internas. TypeScript 7 continua sendo a autoridade semântica/projetual;
 * esta policy deliberadamente evita transform plugins/presets e mantém a gramática alinhada às extensões que o TS7
 * interpreta. Perfis distinguem consumidores que precisam de comentários daqueles que só precisam da estrutura AST.
 *
 * @module copilot/infra/parse/babel-policy
 */

import { extname } from 'node:path';

/** Versão observável da policy Babel/TS7 compartilhada pelo runtime e pelos scripts. */
export const BABEL_PARSER_POLICY_VERSION = '2026-08-20.babel8-ts7.v1';

/** @typedef {'symbols' | 'documentation' | 'structure'} BabelParserProfile */
/**
 * @typedef {object} BabelParserOptions
 * @property {BabelParserProfile} [profile] - Perfil de custo/semântica do consumidor.
 */

const BABEL_PARSER_PROFILES = Object.freeze({
    symbols: Object.freeze({ attachComment: true }),
    documentation: Object.freeze({ attachComment: true }),
    structure: Object.freeze({ attachComment: false }),
});

/**
 * @param {BabelParserProfile | undefined} profile
 * @returns {{ attachComment: boolean }}
 */
function resolveProfile(profile) {
    return BABEL_PARSER_PROFILES[profile ?? 'symbols'] ?? BABEL_PARSER_PROFILES.symbols;
}

/**
 * @param {string} filePath
 * @param {'js' | 'ts'} lang
 * @param {BabelParserOptions} [options]
 * @returns {Record<string, unknown>}
 */
export function resolveBabelParserOptions(filePath, lang, options = {}) {
    const lowerPath = filePath.toLowerCase();
    const ext = extname(lowerPath);
    const sourceType =
        ext === '.cjs' || ext === '.cts' ? 'commonjs' : ext === '.mjs' || ext === '.mts' ? 'module' : 'unambiguous';
    const profile = resolveProfile(options.profile);
    /** @type {unknown[]} */
    const plugins = [];

    if (lang === 'ts') {
        const dts = /\.d\.(?:ts|mts|cts)$/u.test(lowerPath);
        const disallowAmbiguousJSXLike = ext === '.mts' || ext === '.cts';
        plugins.push(['typescript', { dts, disallowAmbiguousJSXLike }]);
        if (ext === '.tsx') plugins.push('jsx');
    } else if (ext === '.jsx') {
        // Alinha Babel à semântica de extensão do TS7: JSX não é aceito implicitamente em todo arquivo .js.
        plugins.push('jsx');
    }

    // TypeScript moderno usa decorators padrão quando `experimentalDecorators` não está habilitado. O par de plugins
    // abaixo cobre decorators atuais e auto-accessors sem instalar transform plugins nem reintroduzir semantics legacy.
    plugins.push('decorators', 'decoratorAutoAccessors');

    return {
        sourceType,
        sourceFilename: filePath,
        plugins,
        errorRecovery: true,
        attachComment: profile.attachComment,
        // Mantemos explícito para estabilizar o shape AST mesmo se defaults/documentação variarem entre minors.
        createImportExpressions: true,
    };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function formatBabelParserError(error) {
    if (!error || typeof error !== 'object') return String(error);
    const value =
        /** @type {{ code?: unknown; reasonCode?: unknown; message?: unknown; loc?: { line?: unknown; column?: unknown } }} */ (
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
