#!/usr/bin/env node
// @ts-check
/**
 * scripts/generate-openapi.mjs
 *
 * Gera spec OpenAPI 3.0 a partir dos route files Express canônicos do copilot.
 *
 * Escaneia `src/copilot/server/routes/` usando regex para capturar `router.<method>('<path>', ...)` e gerar um skeleton
 * OpenAPI básico.
 *
 * Uso: node scripts/generate-openapi.mjs [--output <path>]
 *
 * O spec gerado é um skeleton — types de request/response devem ser refinados manualmente.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const ROUTES_DIR = resolve(import.meta.dirname, '../src/copilot/server/routes');
const DEFAULT_OUTPUT = resolve(import.meta.dirname, '../src/copilot/server/routes/openapi.json');

const ROUTE_RE = /router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g;

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function walkJs(dir) {
    /** @type {string[]} */
    const out = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...(await walkJs(full)));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Retorna o prefixo HTTP real aplicado pelo composition root `server/router.js`.
 *
 * @param {string} relFile
 * @returns {string}
 */
function routePrefixFor(relFile) {
    if (relFile.startsWith('sdk/')) return '/sdk';
    if (relFile === 'config.js') return '/config';
    if (relFile === 'memory.js') return '/memory';
    return '';
}

/**
 * @param {string} prefix
 * @param {string} path
 * @returns {string}
 */
function joinHttpPath(prefix, path) {
    const normalizedPrefix = prefix === '/' ? '' : prefix.replace(/\/+$/, '');
    const normalizedPath = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
    return `${normalizedPrefix}${normalizedPath}` || '/';
}

/**
 * Converte path Express (:param) para OpenAPI ({param}).
 *
 * @param {string} path
 * @returns {string}
 */
function toOpenApiPath(path) {
    return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
}

/**
 * Extrai parâmetros de path.
 *
 * @param {string} path
 * @returns {{ name: string; in: string; required: boolean; schema: { type: string } }[]}
 */
function extractParams(path) {
    const params = [];
    const re = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
    let m;
    while ((m = re.exec(path)) !== null) {
        params.push({
            name: /** @type {string} */ (m[1]),
            in: 'path',
            required: true,
            schema: { type: 'string' },
        });
    }
    return params;
}

async function main() {
    const outputArg = process.argv.indexOf('--output');
    const outputPath = outputArg >= 0 ? /** @type {string} */ (process.argv[outputArg + 1]) : DEFAULT_OUTPUT;

    const jsFiles = await walkJs(ROUTES_DIR);

    /** @type {Record<string, Record<string, object>>} */
    const paths = {};

    for (const file of jsFiles) {
        const relFile = relative(ROUTES_DIR, file);
        if (relFile.endsWith('README.md') || relFile.endsWith('deps.js') || relFile.endsWith('middleware.js')) continue;

        const content = await readFile(file, 'utf8');
        const prefix = routePrefixFor(relFile);
        let match;
        ROUTE_RE.lastIndex = 0;
        while ((match = ROUTE_RE.exec(content)) !== null) {
            const method = /** @type {string} */ (match[1]).toLowerCase();
            const rawPath = /** @type {string} */ (match[2]);
            const oaPath = toOpenApiPath(joinHttpPath(prefix, rawPath));
            const params = extractParams(oaPath);

            if (!paths[oaPath]) paths[oaPath] = {};

            /** @type {Record<string, unknown>} */
            const operation = {
                summary: `${method.toUpperCase()} ${rawPath}`,
                operationId: `${method}_${rawPath.replace(/[/:{}]/g, '_').replace(/^_+|_+$/g, '')}`,
                tags: [relFile.replace(/\.js$/, '').replaceAll('/', ':')],
                responses: {
                    200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
                },
            };

            if (params.length) operation['parameters'] = params;
            if (['post', 'put', 'patch'].includes(method)) {
                operation['requestBody'] = {
                    content: { 'application/json': { schema: { type: 'object' } } },
                };
            }

            paths[oaPath][method] = operation;
        }
    }

    const spec = {
        openapi: '3.0.3',
        info: {
            title: 'Copilot SDK API',
            version: '1.0.0',
            description:
                'API REST do módulo copilot — endpoints canônicos em server/routes para sessões, agent, SDK, observabilidade, hooks e webhooks.',
        },
        servers: [{ url: 'http://localhost:3001', description: 'Dev server' }],
        paths,
    };

    const json = JSON.stringify(spec, null, 2);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json + '\n', 'utf8');

    const pathCount = Object.keys(paths).length;
    const opCount = Object.values(paths).reduce((sum, methods) => sum + Object.keys(methods).length, 0);
    console.log(`✓ OpenAPI spec gerado: ${outputPath}`);
    console.log(`  ${pathCount} paths, ${opCount} operações`);
}

main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
