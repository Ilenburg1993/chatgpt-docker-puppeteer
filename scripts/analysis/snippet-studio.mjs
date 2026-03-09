#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const DEFAULT_SNIPPET_FILE = '.vscode/chatgpt-docker-puppeteer.code-snippets';
const DEFAULT_ROOTS = ['src', 'scripts', 'tests'];
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git']);
const TEST_INCLUDE_PATTERNS = [
    '**/*.test.js',
    '**/*.spec.js',
    '**/*.test.mjs',
    '**/*.spec.mjs',
    '**/*.test.cjs',
    '**/*.spec.cjs',
    '**/*.test.ts',
    '**/*.spec.ts',
];
const FILE_TEMPLATE_PREFIXES = new Set(['driver.class.target', 'test.node.file']);
const LEARNING_CANDIDATES = [
    {
        snippetName: 'Node: Importar fs + path',
        prefix: 'node.import.fs-path',
        template: 'node-fs-path',
        imports: ['node:fs', 'node:path'],
        minHits: 100,
        reason: 'fs e path aparecem juntos de forma recorrente no repositório.',
    },
    {
        snippetName: 'Test: Imports node:test',
        prefix: 'test.node.imports',
        template: 'node-test-imports',
        imports: ['node:test', 'node:assert/strict'],
        patterns: ['node_test'],
        minHits: 120,
        reason: 'A suíte usa massivamente node:test com node:assert/strict.',
    },
    {
        snippetName: 'Zod: Schema objeto',
        prefix: 'schema.zod.object',
        template: 'zod-object',
        imports: ['zod'],
        minHits: 10,
        reason: 'Schemas Zod são uma convenção forte do repositório.',
    },
    {
        snippetName: 'Server: Router Express',
        prefix: 'server.express.router',
        template: 'express-router',
        imports: ['express'],
        minHits: 10,
        reason: 'Controllers HTTP usam express.Router() repetidamente.',
    },
    {
        snippetName: 'DB: SQLite canônico',
        prefix: 'db.sqlite.core',
        template: 'db-sqlite',
        imports: ['#infra/db/sqlite'],
        minHits: 10,
        reason: 'O módulo SQLite SSOT aparece com frequência suficiente para um snippet dedicado.',
    },
    {
        snippetName: 'Node: Importar fs/promises',
        prefix: 'node.import.fs-promises',
        template: 'node-fs-promises',
        imports: ['node:fs/promises'],
        sequences: ['fs_promises_io'],
        minHits: 25,
        reason: 'fs/promises aparece com muita frequência em testes, scripts e controllers.',
    },
    {
        snippetName: 'Node: spawnSync',
        prefix: 'node.child-process.spawn-sync',
        template: 'node-spawn-sync',
        imports: ['node:child_process'],
        sequences: ['spawn_sync_usage'],
        minHits: 20,
        reason: 'spawnSync é um padrão recorrente para testes de subprocesso e scripts utilitários.',
    },
    {
        snippetName: 'DB: Preparar statement SQLite',
        prefix: 'db.sqlite.prepare',
        template: 'db-sqlite-prepare',
        imports: ['#infra/db/sqlite'],
        sequences: ['db_prepare_sql'],
        minHits: 20,
        reason: 'db.prepare(...) com SQL inline aparece repetidamente e merece um snippet dedicado.',
    },
];

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        file: { type: 'string', default: DEFAULT_SNIPPET_FILE },
        format: { type: 'string', default: 'console' },
        name: { type: 'string', default: '' },
        prefix: { type: 'string', default: '' },
        scope: { type: 'string', default: '' },
        description: { type: 'string', default: '' },
        template: { type: 'string', default: 'generic' },
        include: { type: 'string', default: '' },
        exclude: { type: 'string', default: '' },
        'file-template': { type: 'boolean', default: false },
        insert: { type: 'boolean', default: false },
        roots: { type: 'string', default: DEFAULT_ROOTS.join(',') },
        'max-imports': { type: 'string', default: '20' },
        'max-candidates': { type: 'string', default: '10' },
        'max-blocks': { type: 'string', default: '5' },
        'min-block-occurrences': { type: 'string', default: '4' },
        'min-score': { type: 'string', default: '0.55' },
        'insert-missing': { type: 'boolean', default: false },
    },
});

const command = String(positionals[0] || 'suggest').toLowerCase();
const snippetFile = path.resolve(process.cwd(), String(values.file || DEFAULT_SNIPPET_FILE));
const format = String(values.format || 'console').toLowerCase();

switch (command) {
    case 'suggest':
        outputSuggestionReport(generateSuggestions(snippetFile), format);
        break;
    case 'learn':
        outputLearningReport(
            generateLearningReport({
                snippetFile,
                roots: parseCsvList(String(values.roots || DEFAULT_ROOTS.join(','))),
                maxImports: Number.parseInt(String(values['max-imports'] || '20'), 10) || 20,
                maxCandidates: Number.parseInt(String(values['max-candidates'] || '10'), 10) || 10,
                maxBlocks: Number.parseInt(String(values['max-blocks'] || '5'), 10) || 5,
                minBlockOccurrences: Number.parseInt(String(values['min-block-occurrences'] || '4'), 10) || 4,
                minScore: Number.parseFloat(String(values['min-score'] || '0.55')) || 0.55,
                insertMissing: Boolean(values['insert-missing']),
            }),
            format,
        );
        break;
    case 'scaffold':
        runScaffold({
            snippetFile,
            format,
            name: String(values.name || ''),
            prefix: String(values.prefix || ''),
            scope: String(values.scope || ''),
            description: String(values.description || ''),
            template: String(values.template || 'generic'),
            include: String(values.include || ''),
            exclude: String(values.exclude || ''),
            fileTemplate: Boolean(values['file-template']),
            insert: Boolean(values.insert),
        });
        break;
    default:
        console.error(`Comando desconhecido: ${command}`);
        console.error('Use: suggest | learn | scaffold');
        process.exit(1);
}

/**
 * @param {string} snippetFile
 */
function generateSuggestions(snippetFile) {
    const catalog = JSON.parse(fs.readFileSync(snippetFile, 'utf8'));
    const suggestions = [];

    for (const [name, snippet] of Object.entries(catalog)) {
        const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];
        const prefix = prefixes[0];
        const bodyText = Array.isArray(snippet.body) ? snippet.body.join('\n') : String(snippet.body || '');
        const include = Array.isArray(snippet.include) ? snippet.include : [];

        if (prefix?.startsWith('test.') && include.length === 0) {
            suggestions.push({
                snippet: name,
                type: 'missing_include',
                details: 'Snippets de teste ficam mais precisos com include para arquivos *.test|*.spec.',
                recommendation: { include: TEST_INCLUDE_PATTERNS },
            });
        }

        if (prefix?.startsWith('pkg.') && !include.includes('package.json')) {
            suggestions.push({
                snippet: name,
                type: 'missing_include',
                details: 'Snippets de package funcionam melhor quando limitados a package.json.',
                recommendation: { include: ['package.json'] },
            });
        }

        if (prefix?.startsWith('vscode.') && !include.includes('launch.json')) {
            suggestions.push({
                snippet: name,
                type: 'missing_include',
                details: 'Snippets de VS Code podem ser limitados a launch.json.',
                recommendation: { include: ['launch.json'] },
            });
        }

        if (prefix?.startsWith('process.pm2.') && include.length === 0) {
            suggestions.push({
                snippet: name,
                type: 'missing_include',
                details: 'Snippets de PM2 ficam mais precisos quando restritos a ecosystem.config.*.',
                recommendation: { include: ['ecosystem.config.cjs', 'ecosystem.config.js'] },
            });
        }

        if (FILE_TEMPLATE_PREFIXES.has(prefix) && !snippet.isFileTemplate) {
            suggestions.push({
                snippet: name,
                type: 'missing_file_template',
                details: 'Esse snippet parece preencher um arquivo inteiro e pode usar isFileTemplate.',
                recommendation: { isFileTemplate: true },
            });
        }

        if (/\brandomUUID\(\)/.test(bodyText) || /import \{ randomUUID \} from 'node:crypto';/.test(bodyText)) {
            suggestions.push({
                snippet: name,
                type: 'use_builtin_variable',
                details: 'A documentação do VS Code recomenda variáveis de snippet quando possível.',
                recommendation: { variable: '${UUID}' },
            });
        }
    }

    return {
        file: path.relative(process.cwd(), snippetFile),
        suggestions_count: suggestions.length,
        suggestions,
    };
}

/**
 * @typedef {object} GenerateLearningReportOptions
 * @property {string} snippetFile
 * @property {string[]} roots
 * @property {number} maxImports
 * @property {number} maxCandidates
 * @property {number} maxBlocks
 * @property {number} minBlockOccurrences
 * @property {number} minScore
 * @property {boolean} insertMissing
 */
/**
 * @param {GenerateLearningReportOptions} options
 */
function generateLearningReport({
    snippetFile,
    roots,
    maxImports,
    maxCandidates,
    maxBlocks,
    minBlockOccurrences,
    minScore,
    insertMissing,
}) {
    const catalog = JSON.parse(fs.readFileSync(snippetFile, 'utf8'));
    const repo = analyzeRepositorySignals(roots, { minBlockOccurrences });
    const catalogPrefixes = new Set(
        Object.values(catalog).flatMap((snippet) =>
            Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix],
        ),
    );
    const normalizedSnippetBodies = Object.values(catalog).map((snippet) =>
        normalizeBlockLines(Array.isArray(snippet.body) ? snippet.body : [String(snippet.body || '')]).join('\n'),
    );

    const candidates = [];
    const lowConfidenceCandidates = [];
    for (const candidate of LEARNING_CANDIDATES) {
        if (catalogPrefixes.has(candidate.prefix)) {
            continue;
        }

        const importHits = (candidate.imports || []).reduce(
            (sum, specifier) => sum + (repo.importCounts[specifier] || 0),
            0,
        );
        const patternHits = (candidate.patterns || []).reduce(
            (sum, patternName) => sum + (repo.patternCounts[patternName] || 0),
            0,
        );
        const sequenceHits = (candidate.sequences || []).reduce(
            (sum, sequenceName) => sum + (repo.sequenceCounts[sequenceName] || 0),
            0,
        );
        const hitCount = importHits + sequenceHits;
        if (hitCount < candidate.minHits) {
            continue;
        }

        const scaffold = buildSnippetDefinition({
            name: candidate.snippetName,
            prefix: candidate.prefix,
            template: candidate.template,
            scope: '',
            description: '',
            include: '',
            exclude: '',
            fileTemplate: false,
        });
        const confidence = scoreLearningCandidate({
            candidate,
            importHits,
            patternHits,
            sequenceHits,
        });

        const candidateResult = {
            snippet: candidate.snippetName,
            prefix: candidate.prefix,
            template: candidate.template,
            hit_count: hitCount,
            confidence_score: Number(confidence.toFixed(3)),
            reason: candidate.reason,
            based_on_imports: (candidate.imports || []).map((specifier) => ({
                specifier,
                hits: repo.importCounts[specifier] || 0,
            })),
            based_on_patterns: (candidate.patterns || []).map((patternName) => ({
                pattern: patternName,
                hits: repo.patternCounts[patternName] || 0,
            })),
            based_on_sequences: (candidate.sequences || []).map((sequenceName) => ({
                sequence: sequenceName,
                hits: repo.sequenceCounts[sequenceName] || 0,
            })),
            scaffold,
        };

        if (confidence >= minScore) {
            candidates.push(candidateResult);
        } else {
            lowConfidenceCandidates.push(candidateResult);
        }
    }

    candidates.sort(
        (a, b) =>
            b.confidence_score - a.confidence_score || b.hit_count - a.hit_count || a.prefix.localeCompare(b.prefix),
    );
    lowConfidenceCandidates.sort(
        (a, b) =>
            b.confidence_score - a.confidence_score || b.hit_count - a.hit_count || a.prefix.localeCompare(b.prefix),
    );
    const limitedCandidates = candidates.slice(0, Math.max(1, maxCandidates));
    const insertedCandidates = [];

    if (insertMissing && limitedCandidates.length > 0) {
        const mutableCatalog = { ...catalog };
        for (const candidate of limitedCandidates) {
            mutableCatalog[candidate.snippet] = candidate.scaffold;
            insertedCandidates.push({
                snippet: candidate.snippet,
                prefix: candidate.prefix,
            });
        }
        const ordered = Object.fromEntries(Object.entries(mutableCatalog).sort(([a], [b]) => a.localeCompare(b)));
        fs.writeFileSync(snippetFile, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
    }

    const topRepeatedBlocks = repo.repeatedBlocks.slice(0, Math.max(1, maxBlocks));
    const uncoveredRepeatedBlocks = topRepeatedBlocks.filter(
        (block) => !normalizedSnippetBodies.some((body) => body.includes(block.signature)),
    );
    const blockOpportunities = suggestBlockOpportunities(uncoveredRepeatedBlocks, catalogPrefixes, maxCandidates);

    return {
        file: path.relative(process.cwd(), snippetFile),
        files_scanned: repo.fileCount,
        roots,
        min_score: minScore,
        top_imports: Object.entries(repo.importCounts)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, Math.max(1, maxImports))
            .map(([specifier, hits]) => ({ specifier, hits })),
        top_patterns: Object.entries(repo.patternCounts)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .filter(([, hits]) => hits > 0)
            .map(([pattern, hits]) => ({ pattern, hits })),
        top_sequences: Object.entries(repo.sequenceCounts)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .filter(([, hits]) => hits > 0)
            .map(([sequence, hits]) => ({ sequence, hits })),
        top_repeated_blocks: topRepeatedBlocks,
        uncovered_repeated_blocks: uncoveredRepeatedBlocks,
        block_opportunities: blockOpportunities,
        missing_candidates: insertMissing ? [] : limitedCandidates,
        low_confidence_candidates: lowConfidenceCandidates.slice(0, Math.max(1, maxCandidates)),
        inserted_candidates: insertedCandidates,
    };
}

/**
 * @typedef {object} RunScaffoldOptions
 * @property {string} snippetFile
 * @property {string} format
 * @property {string} name
 * @property {string} prefix
 * @property {string} scope
 * @property {string} description
 * @property {string} template
 * @property {string} include
 * @property {string} exclude
 * @property {boolean} fileTemplate
 * @property {boolean} insert
 */
/**
 * @param {RunScaffoldOptions} options
 */
function runScaffold(options) {
    const name = options.name.trim();
    const prefix = options.prefix.trim();

    if (!name || !prefix) {
        console.error('scaffold requer --name e --prefix');
        process.exit(1);
    }

    const snippet = buildSnippetDefinition({
        name,
        prefix,
        template: options.template,
        scope: options.scope,
        description: options.description,
        include: options.include,
        exclude: options.exclude,
        fileTemplate: options.fileTemplate,
    });

    if (options.insert) {
        const catalog = JSON.parse(fs.readFileSync(options.snippetFile, 'utf8'));
        catalog[name] = snippet;
        const ordered = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)));
        fs.writeFileSync(options.snippetFile, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
    }

    const payload = { [name]: snippet };
    if (options.format === 'json') {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }

    console.log('='.repeat(80));
    console.log('SNIPPET SCAFFOLD');
    console.log('='.repeat(80));
    console.log(JSON.stringify(payload, null, 2));
    if (!options.insert) {
        console.log('');
        console.log('Dica: use --insert para adicionar o snippet diretamente ao catálogo.');
    }
}

/**
 * @param {string} template
 */
function getTemplateDefaults(template) {
    switch (template) {
        case 'node-test-file':
            return {
                scope: 'javascript,typescript',
                include: TEST_INCLUDE_PATTERNS,
                isFileTemplate: true,
                description: 'Cria um arquivo de teste node:test.',
                body: [
                    "import test from 'node:test';",
                    "import assert from 'node:assert/strict';",
                    '',
                    "test('${1:descreve o comportamento}', () => {",
                    '    ${0:// arrange / act / assert}',
                    '});',
                ],
            };
        case 'pm2-app':
            return {
                scope: 'javascript,typescript',
                include: ['ecosystem.config.cjs', 'ecosystem.config.js'],
                isFileTemplate: false,
                description: 'Cria um bloco de app PM2.',
                body: [
                    '{',
                    "    name: '${1:app-name}',",
                    "    cwd: '${2:projectRoot}',",
                    "    script: '${3:./index.js}',",
                    "    exec_mode: 'fork',",
                    '    instances: ${4:1},',
                    '    watch: false',
                    '}',
                ],
            };
        case 'pwa-node-launch':
            return {
                scope: 'json,jsonc',
                include: ['launch.json'],
                isFileTemplate: false,
                description: 'Cria uma configuração pwa-node.',
                body: [
                    '{',
                    '  "name": "${1:Node: tarefa}",',
                    '  "type": "pwa-node",',
                    '  "request": "launch",',
                    '  "program": "${workspaceFolder}/${2:index.js}"',
                    '}',
                ],
            };
        case 'task-v5':
            return {
                scope: 'javascript,typescript',
                include: [],
                isFileTemplate: false,
                description: 'Cria uma task mínima V5.',
                body: [
                    'const ${1:task} = {',
                    '    meta: {',
                    "        id: '${UUID}',",
                    "        version: '5.0'",
                    '    }',
                    '};',
                ],
            };
        case 'node-fs-path':
            return {
                scope: 'javascript,typescript',
                include: [],
                isFileTemplate: false,
                description: 'Importa fs e path de node: de forma canônica.',
                body: ["import fs from 'node:fs';", "import path from 'node:path';", '', '$0'],
            };
        case 'node-fs-promises':
            return {
                scope: 'javascript,typescript',
                include: [],
                isFileTemplate: false,
                description: 'Importa fs/promises no padrão moderno do projeto.',
                body: ["import fs from 'node:fs/promises';", '', '$0'],
            };
        case 'node-spawn-sync':
            return {
                scope: 'javascript,typescript',
                include: [],
                isFileTemplate: false,
                description: 'Importa e usa spawnSync para executar subprocessos.',
                body: [
                    "import { spawnSync } from 'node:child_process';",
                    '',
                    "const ${1:result} = spawnSync(${2:process.execPath}, ${3:['--version']}, {",
                    "    encoding: 'utf8',",
                    '    timeout: ${4:3000}',
                    '});',
                    '',
                    'if (${1:result}.status !== 0) {',
                    "    throw new Error(${1:result}.stderr || 'Subprocesso falhou.');",
                    '}',
                    '',
                    '$0',
                ],
            };
        case 'node-test-imports':
            return {
                scope: 'javascript,typescript',
                include: TEST_INCLUDE_PATTERNS,
                isFileTemplate: false,
                description: 'Importa node:test e node:assert/strict.',
                body: ["import test from 'node:test';", "import assert from 'node:assert/strict';", '', '$0'],
            };
        case 'zod-object':
            return {
                scope: 'javascript,typescript',
                include: [],
                isFileTemplate: false,
                description: 'Cria um schema Zod no padrão ESM do projeto.',
                body: [
                    "import { z } from 'zod';",
                    '',
                    'const ${1:SchemaName} = z.object({',
                    '    ${2:field}: z.${3|string,number,boolean,array,object|}()',
                    '});',
                    '',
                    'export { ${1:SchemaName} };',
                ],
            };
        case 'express-router':
            return {
                scope: 'javascript,typescript',
                include: ['**/controllers/*.js', '**/controllers/*.ts'],
                isFileTemplate: false,
                description: 'Cria um router Express no estilo dos controllers.',
                body: [
                    "import express from 'express';",
                    '',
                    'const router = express.Router();',
                    '',
                    '$0',
                    '',
                    'export default router;',
                ],
            };
        case 'db-sqlite':
            return {
                scope: 'javascript,typescript',
                include: [],
                isFileTemplate: false,
                description: 'Importa helpers canônicos do SQLite SSOT.',
                body: [
                    "import { getDb, resolveDbPath } from '#infra/db/sqlite';",
                    '',
                    'const ${1:db} = getDb();',
                    'const ${2:dbPath} = resolveDbPath();',
                    '',
                    '$0',
                ],
            };
        case 'db-sqlite-prepare':
            return {
                scope: 'javascript,typescript',
                include: [],
                isFileTemplate: false,
                description: 'Cria um statement SQLite com SQL inline no padrão recorrente do repositório.',
                body: [
                    'const ${1:statement} = ${2:db}.prepare(`',
                    '    ${0:SELECT * FROM ${3:table} WHERE ${4:id} = ?}',
                    '`);',
                ],
            };
        case 'generic':
        default:
            return {
                scope: 'javascript,typescript',
                include: [],
                isFileTemplate: false,
                description: 'Cria um snippet genérico.',
                body: ['$0'],
            };
    }
}

/**
 * @param {string} value
 */
function parseCsvList(value) {
    const items = String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    return items;
}

/**
 * @typedef {object} BuildSnippetDefinitionOptions
 * @property {string} name
 * @property {string} prefix
 * @property {string} template
 * @property {string} scope
 * @property {string} description
 * @property {string} include
 * @property {string} exclude
 * @property {boolean} fileTemplate
 */
/**
 * @param {BuildSnippetDefinitionOptions} options
 */
function buildSnippetDefinition(options) {
    const defaults = getTemplateDefaults(options.template.trim().toLowerCase());
    const parsedInclude = parseCsvList(options.include);
    const include = parsedInclude.length > 0 ? parsedInclude : defaults.include;
    const exclude = parseCsvList(options.exclude);
    const snippet = /** @type {any} */ ({
        prefix: options.prefix.trim(),
        scope: options.scope.trim() || defaults.scope,
        body: defaults.body,
        description: options.description.trim() || defaults.description || `Snippet gerado para ${options.name}.`,
    });

    if (include.length > 0) {
        snippet.include = include;
    }
    if (exclude.length > 0) {
        snippet.exclude = exclude;
    }
    if (options.fileTemplate || defaults.isFileTemplate) {
        snippet.isFileTemplate = true;
    }

    return snippet;
}

/**
 * @typedef {object} AnalyzeRepositorySignalsOptions
 * @property {any} [minBlockOccurrences]
 */
/**
 * @param {string[]} roots
 * @param {AnalyzeRepositorySignalsOptions} [options]
 */
function analyzeRepositorySignals(roots, { minBlockOccurrences = 4 } = {}) {
    const files = collectSourceFiles(roots);
    /** @type {Record<string, number>} */
    const importCounts = {};
    /** @type {Record<string, number>} */
    const patternCounts = {
        log_info: 0,
        log_error: 0,
        audit_call: 0,
        create_envelope: 0,
        parse_task: 0,
        allocate_page: 0,
        node_test: 0,
    };
    /** @type {Record<string, number>} */
    const sequenceCounts = {
        fs_promises_io: 0,
        spawn_sync_usage: 0,
        express_router_module: 0,
        node_test_import_pair: 0,
        db_prepare_sql: 0,
    };
    const importRegex = /import\s+(?:[^'\n]+?\s+from\s+)?['"]([^'"]+)['"]/g;
    const patternMatchers = {
        log_info: /\blog\.info\(/g,
        log_error: /\blog\.error\(/g,
        audit_call: /\baudit\(/g,
        create_envelope: /\bcreateEnvelope\(/g,
        parse_task: /\bparseTask\(/g,
        allocate_page: /\.allocate\(/g,
        node_test: /\btest\(/g,
    };
    const sequenceMatchers = {
        fs_promises_io:
            /import\s+(?:\*\s+as\s+)?fs(?:\s*,|\s+)?.*from ['"]node:fs\/promises['"][\s\S]{0,4000}?\bfs\.(?:readFile|writeFile|stat|readdir|mkdir|rm|unlink)\(/,
        spawn_sync_usage:
            /import\s*\{\s*[^}]*spawnSync[^}]*\}\s*from ['"]node:child_process['"][\s\S]{0,4000}?\bspawnSync\(/,
        express_router_module: /import\s+express\s+from ['"]express['"][\s\S]{0,2000}?\bexpress\.Router\(\)/,
        node_test_import_pair:
            /import\s+test\s+from ['"]node:test['"][\s\S]{0,2000}?import\s+assert\s+from ['"]node:assert\/strict['"]/,
        db_prepare_sql: /\b[A-Za-z_$][\w$]*\s*=\s*[A-Za-z_$][\w$]*\s*\.prepare\(\s*`[\s\S]{0,4000}?`?\s*\)/,
    };
    const repeatedBlockMap = new Map();

    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        for (const match of text.matchAll(importRegex)) {
            const specifier = String(match[1] || '').trim();
            if (!specifier) continue;
            importCounts[specifier] = (importCounts[specifier] || 0) + 1;
        }

        for (const [key, regex] of Object.entries(patternMatchers)) {
            patternCounts[key] = (patternCounts[key] ?? 0) + (text.match(regex) || []).length;
        }

        for (const [key, regex] of Object.entries(sequenceMatchers)) {
            if (regex.test(text)) {
                sequenceCounts[key] = (sequenceCounts[key] ?? 0) + 1;
            }
        }

        collectRepeatedBlockWindows(text, file, repeatedBlockMap);
    }

    return {
        fileCount: files.length,
        importCounts,
        patternCounts,
        sequenceCounts,
        repeatedBlocks: [...repeatedBlockMap.values()]
            .filter((item) => item.hits >= minBlockOccurrences)
            .sort(
                (a, b) => b.hits - a.hits || b.files.length - a.files.length || a.signature.localeCompare(b.signature),
            ),
    };
}

/**
 * @param {string} text
 * @param {string} file
 * @param {Map<string, { signature: string; hits: number; files: string[]; example: string[] }>} repeatedBlockMap
 * @param {any} repeatedBlockMap
 */
function collectRepeatedBlockWindows(text, file, repeatedBlockMap) {
    const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => isMeaningfulLearningLine(line));

    for (let index = 0; index <= lines.length - 3; index++) {
        const window = lines.slice(index, index + 3);
        const normalizedWindow = normalizeBlockLines(window);
        const signature = normalizedWindow.join('\n');

        if (!signature || signature.length < 20) {
            continue;
        }

        const existing = repeatedBlockMap.get(signature);
        if (!existing) {
            repeatedBlockMap.set(signature, {
                signature,
                hits: 1,
                files: [path.relative(process.cwd(), file)],
                example: window,
            });
            continue;
        }

        existing.hits += 1;
        if (!existing.files.includes(path.relative(process.cwd(), file))) {
            existing.files.push(path.relative(process.cwd(), file));
        }
    }
}

/**
 * @param {string} line
 */
function isMeaningfulLearningLine(line) {
    if (!line) return false;
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line.startsWith('*/')) return false;
    if (/^[{}[\]();,]+$/.test(line)) return false;
    return true;
}

/**
 * @param {string[]} lines
 */
function normalizeBlockLines(lines) {
    return lines.map((line) =>
        line
            .trim()
            .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '<str>')
            .replace(/\b\d+(?:\.\d+)?\b/g, '<num>')
            .replace(/\b(const|let|var)\s+[A-Za-z_$][\w$]*\s*=/g, '$1 <id> =')
            .replace(/\basync function\s+[A-Za-z_$][\w$]*\s*\(/g, 'async function <fn>(')
            .replace(/\bfunction\s+[A-Za-z_$][\w$]*\s*\(/g, 'function <fn>(')
            .replace(/\s+/g, ' '),
    );
}

/**
 * @typedef {object} ScoreLearningCandidateOptions
 * @property {any} candidate
 * @property {number} importHits
 * @property {number} patternHits
 * @property {number} sequenceHits
 */
/**
 * @param {ScoreLearningCandidateOptions} options
 */
function scoreLearningCandidate({ candidate, importHits, patternHits, sequenceHits }) {
    const weightedParts = [];

    if ((candidate.imports || []).length > 0) {
        weightedParts.push({
            weight: 0.6,
            score: Math.min(1, importHits / Math.max(1, candidate.minHits)),
        });
    }

    if ((candidate.patterns || []).length > 0) {
        weightedParts.push({
            weight: 0.15,
            score: Math.min(1, patternHits / Math.max(1, candidate.patterns.length * 10)),
        });
    }

    if ((candidate.sequences || []).length > 0) {
        weightedParts.push({
            weight: 0.25,
            score: Math.min(1, sequenceHits / Math.max(1, candidate.sequences.length * 6)),
        });
    }

    if (weightedParts.length === 0) {
        return 0;
    }

    const totalWeight = weightedParts.reduce((sum, item) => sum + item.weight, 0);
    const totalScore = weightedParts.reduce((sum, item) => sum + item.weight * item.score, 0);
    return totalScore / totalWeight;
}

/**
 * @param {{ signature: string; hits: number; files: string[]; example: string[] }[]} blocks
 * @param {any} blocks
 * @param {Set<string>} catalogPrefixes
 * @param {number} maxCandidates
 */
function suggestBlockOpportunities(blocks, catalogPrefixes, maxCandidates) {
    /** @type {any[]} */
    const opportunities = [];

    for (const block of blocks) {
        const exampleText = block.example.join('\n');
        /** @type {{ prefix: string; template: string; reason: string } | null} */
        let suggestion = null;

        if (
            exampleText.includes("import test from 'node:test';") &&
            exampleText.includes("import assert from 'node:assert/strict';")
        ) {
            suggestion = {
                prefix: 'test.node.case',
                template: 'node-test-file',
                reason: 'Bloco recorrente de bootstrap de testes com node:test.',
            };
        } else if (exampleText.includes("import fs from 'node:fs/promises';")) {
            suggestion = {
                prefix: 'node.fs.async-io',
                template: 'node-fs-promises',
                reason: 'Bloco recorrente de IO assíncrono com fs/promises.',
            };
        } else if (exampleText.includes("import express from 'express';") || exampleText.includes('express.Router()')) {
            suggestion = {
                prefix: 'server.router.module',
                template: 'express-router',
                reason: 'Bloco recorrente de módulo Express com router.',
            };
        } else if (
            exampleText.includes("import { spawnSync } from 'node:child_process';") ||
            exampleText.includes('spawnSync(')
        ) {
            suggestion = {
                prefix: 'node.process.spawn-sync',
                template: 'node-spawn-sync',
                reason: 'Bloco recorrente de subprocesso síncrono.',
            };
        } else if (exampleText.includes('.prepare(') && exampleText.includes('const ')) {
            suggestion = {
                prefix: 'db.sqlite.prepare',
                template: 'db-sqlite-prepare',
                reason: 'Bloco recorrente de statement SQLite com SQL inline.',
            };
        } else if (exampleText.includes('log.info(') || exampleText.includes('log.error(')) {
            suggestion = {
                prefix: 'log.pattern.context',
                template: 'generic',
                reason: 'Bloco recorrente de logging contextual que pode virar snippet dedicado.',
            };
        } else if (exampleText.includes('createEnvelope(')) {
            suggestion = {
                prefix: 'nerv.envelope.pattern',
                template: 'generic',
                reason: 'Bloco recorrente de envelope NERV que pode virar snippet dedicado.',
            };
        }

        if (
            !suggestion ||
            catalogPrefixes.has(suggestion.prefix) ||
            opportunities.some((item) => item.prefix === suggestion.prefix)
        ) {
            continue;
        }

        opportunities.push({
            prefix: suggestion.prefix,
            template: suggestion.template,
            reason: suggestion.reason,
            hits: block.hits,
            files: block.files,
            source_signature: block.signature,
            example: block.example,
        });
    }

    return opportunities
        .sort((a, b) => b.hits - a.hits || a.prefix.localeCompare(b.prefix))
        .slice(0, Math.max(1, maxCandidates));
}

/**
 * @param {string[]} roots
 */
function collectSourceFiles(roots) {
    /** @type {string[]} */
    const files = [];
    for (const root of roots) {
        const absoluteRoot = path.resolve(process.cwd(), root);
        if (!fs.existsSync(absoluteRoot)) {
            continue;
        }
        walkDirectory(absoluteRoot, files);
    }
    return files;
}

/**
 * @param {string} currentPath
 * @param {string[]} files
 */
function walkDirectory(currentPath, files) {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) {
                continue;
            }
            walkDirectory(path.join(currentPath, entry.name), files);
            continue;
        }

        if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
            continue;
        }
        files.push(path.join(currentPath, entry.name));
    }
}

/**
 * @param {ReturnType<typeof generateSuggestions>} report
 * @param {string} format
 */
function outputSuggestionReport(report, format) {
    if (format === 'json') {
        console.log(JSON.stringify(report, null, 2));
        return;
    }

    console.log('='.repeat(80));
    console.log('SNIPPET STUDIO SUGGESTIONS');
    console.log('='.repeat(80));
    console.log(`file: ${report.file}`);
    console.log(`suggestions: ${report.suggestions_count}`);
    if (report.suggestions.length === 0) {
        console.log('- none');
        return;
    }

    for (const item of report.suggestions) {
        console.log(`- [${item.type}] ${item.snippet}: ${item.details}`);
        console.log(`  recommendation: ${JSON.stringify(item.recommendation)}`);
    }
}

/**
 * @param {ReturnType<typeof generateLearningReport>} report
 * @param {string} format
 */
function outputLearningReport(report, format) {
    if (format === 'json') {
        console.log(JSON.stringify(report, null, 2));
        return;
    }

    console.log('='.repeat(80));
    console.log('SNIPPET STUDIO LEARNING REPORT');
    console.log('='.repeat(80));
    console.log(`file: ${report.file}`);
    console.log(`files_scanned: ${report.files_scanned}`);
    console.log(`roots: ${report.roots.join(', ')}`);
    console.log(`min_score: ${report.min_score}`);
    console.log('');
    console.log('top_imports:');
    for (const item of report.top_imports) {
        console.log(`- ${item.specifier}: ${item.hits}`);
    }

    console.log('');
    console.log('top_patterns:');
    for (const item of report.top_patterns) {
        console.log(`- ${item.pattern}: ${item.hits}`);
    }

    console.log('');
    console.log('top_sequences:');
    for (const item of report.top_sequences) {
        console.log(`- ${item.sequence}: ${item.hits}`);
    }

    console.log('');
    console.log('top_repeated_blocks:');
    for (const item of report.top_repeated_blocks) {
        console.log(`- hits=${item.hits} files=${item.files.length}`);
        console.log(`  signature: ${item.signature}`);
        console.log(`  example: ${JSON.stringify(item.example)}`);
    }

    console.log('');
    console.log(`uncovered_repeated_blocks: ${report.uncovered_repeated_blocks.length}`);
    if (report.uncovered_repeated_blocks.length === 0) {
        console.log('- none');
    } else {
        for (const item of report.uncovered_repeated_blocks) {
            console.log(`- hits=${item.hits} signature=${item.signature}`);
            console.log(`  example: ${JSON.stringify(item.example)}`);
        }
    }

    console.log('');
    console.log(`block_opportunities: ${report.block_opportunities.length}`);
    if (report.block_opportunities.length === 0) {
        console.log('- none');
    } else {
        for (const item of report.block_opportunities) {
            console.log(`- ${item.prefix} (template=${item.template}, hits=${item.hits})`);
            console.log(`  reason: ${item.reason}`);
            console.log(`  example: ${JSON.stringify(item.example)}`);
        }
    }

    console.log('');
    if (report.inserted_candidates.length > 0) {
        console.log(`inserted_candidates: ${report.inserted_candidates.length}`);
        for (const item of report.inserted_candidates) {
            console.log(`- ${item.prefix} (${item.snippet})`);
        }
        return;
    }

    console.log(`missing_candidates: ${report.missing_candidates.length}`);
    if (report.missing_candidates.length === 0) {
        console.log('- none');
    } else {
        for (const item of report.missing_candidates) {
            console.log(`- ${item.prefix} (score=${item.confidence_score}, hits=${item.hit_count})`);
            console.log(`  reason: ${item.reason}`);
            console.log(`  scaffold: ${JSON.stringify({ [item.snippet]: item.scaffold })}`);
        }
    }

    console.log('');
    console.log(`low_confidence_candidates: ${report.low_confidence_candidates.length}`);
    if (report.low_confidence_candidates.length === 0) {
        console.log('- none');
        return;
    }

    for (const item of report.low_confidence_candidates) {
        console.log(`- ${item.prefix} (score=${item.confidence_score}, hits=${item.hit_count})`);
        console.log(`  reason: ${item.reason}`);
    }
}
