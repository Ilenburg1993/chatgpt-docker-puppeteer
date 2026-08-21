#!/usr/bin/env node
// @ts-check
/**
 * Auditor de alinhamento entre o plano sintático Babel 8 e a autoridade semântica TypeScript 7.
 *
 * Princípio arquitetural:
 *
 * - Babel 8: parsing/projeções AST leves para IO, graph, JSDoc e governance;
 * - TypeScript 7 native: projeto, resolução, diagnósticos, tipos e language service;
 * - Babel transforms/presets: ausentes do pipeline principal enquanto `noEmit`/Node 24 tornam transpilation redundante.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { parse as babelParse } from '@babel/parser';
import { API as TypeScriptNativeAPI } from '@typescript/native/unstable/sync';
import { globSync } from 'glob';

import {
    BABEL_PARSER_POLICY_VERSION,
    formatBabelParserError,
    resolveBabelParserOptions,
} from '#copilot/infra/public/diagnostic/code-analysis';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const SOURCE_EXTENSIONS = '{js,mjs,cjs,jsx,ts,mts,cts,tsx}';
const CANONICAL_TS7_CONFIGS = ['tsconfig.node.json', 'tsconfig.browser.json', 'tsconfig.tools.json'];

const { values } = parseArgs({
    options: {
        json: { type: 'boolean', default: false },
        scope: { type: 'string', default: '' },
        'no-ts7': { type: 'boolean', default: false },
    },
});

/** @param {string} file */
function parserLanguage(file) {
    return /\.(?:ts|mts|cts|tsx)$/iu.test(file) ? /** @type {const} */ ('ts') : /** @type {const} */ ('js');
}

/** @param {string} packageName */
function packageVersion(packageName) {
    try {
        return String(require(`${packageName}/package.json`).version ?? 'unknown');
    } catch {
        return 'unavailable';
    }
}

/** @param {string} version */
function major(version) {
    const match = /^(\d+)/u.exec(version);
    return match ? Number(match[1]) : null;
}

function directBabelDependencies() {
    const merged = { ...(PACKAGE.dependencies ?? {}), ...(PACKAGE.devDependencies ?? {}) };
    return Object.fromEntries(
        Object.entries(merged)
            .filter(([name]) => name.startsWith('@babel/'))
            .sort(),
    );
}

/** @param {Record<string, string>} direct */
function forbiddenDirectBabelPackages(direct) {
    return Object.keys(direct).filter(
        (name) =>
            name === '@babel/core' ||
            name.startsWith('@babel/preset-') ||
            name.startsWith('@babel/plugin-transform-') ||
            name.startsWith('@babel/plugin-syntax-'),
    );
}

function lockfileBabelMajors() {
    /** @type {Record<string, { packages: number; examples: string[] }>} */
    const majors = {};
    for (const [location, entry] of Object.entries(LOCK.packages ?? {})) {
        if (!location.includes('node_modules/@babel/')) continue;
        const packageName = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
        if (!packageName.startsWith('@babel/')) continue;
        const version = String(/** @type {any} */ (entry)?.version ?? 'unknown');
        const versionMajor = major(version);
        const key = versionMajor === null ? 'unknown' : String(versionMajor);
        const bucket = (majors[key] ??= { packages: 0, examples: [] });
        bucket.packages += 1;
        if (bucket.examples.length < 8) {
            bucket.examples.push(`${packageName}@${version}`);
        }
    }
    return majors;
}

/** @param {string[]} roots */
function collectSourceFiles(roots) {
    return globSync(
        roots.map((root) => `${root.replace(/\/$/u, '')}/**/*.${SOURCE_EXTENSIONS}`),
        {
            cwd: ROOT,
            absolute: true,
            nodir: true,
            ignore: ['**/node_modules/**', '**/dist/**', '**/.ai/**', '**/coverage/**'],
        },
    ).sort();
}

/** @param {string[]} files */
function auditBabelCorpus(files) {
    const started = performance.now();
    let bytes = 0;
    let recoveredErrors = 0;
    /** @type {{ file: string; errors: string[] }[]} */
    const recovered = [];
    /** @type {{ file: string; error: string }[]} */
    const thrown = [];

    for (const absoluteFile of files) {
        const source = fs.readFileSync(absoluteFile, 'utf8');
        bytes += Buffer.byteLength(source);
        const relativeFile = path.relative(ROOT, absoluteFile).replace(/\\/gu, '/');
        try {
            const ast = babelParse(
                source,
                /** @type {any} */ (
                    resolveBabelParserOptions(absoluteFile, parserLanguage(absoluteFile), { profile: 'structure' })
                ),
            );
            const errors = (ast.errors ?? []).map(formatBabelParserError);
            recoveredErrors += errors.length;
            if (errors.length > 0 && recovered.length < 30) recovered.push({ file: relativeFile, errors });
        } catch (error) {
            if (thrown.length < 30) thrown.push({ file: relativeFile, error: formatBabelParserError(error) });
        }
    }

    return {
        files: files.length,
        bytes,
        durationMs: Number((performance.now() - started).toFixed(1)),
        throughputMiBPerSec:
            bytes > 0
                ? Number((bytes / 1024 / 1024 / Math.max(0.001, (performance.now() - started) / 1000)).toFixed(1))
                : 0,
        thrownCount: thrown.length,
        thrown,
        recoveredErrors,
        recovered,
    };
}

function auditTs7() {
    const api = new TypeScriptNativeAPI();
    const started = performance.now();
    try {
        const openProjects = CANONICAL_TS7_CONFIGS.map((config) => path.join(ROOT, config));
        const snapshot = api.updateSnapshot({ openProjects });
        try {
            const projects = snapshot.getProjects().map((project) => {
                const program = project.program;
                const diagnostics = {
                    config: program.getConfigFileParsingDiagnostics().length,
                    syntactic: program.getSyntacticDiagnostics().length,
                    bind: program.getBindDiagnostics().length,
                    semantic: program.getSemanticDiagnostics().length,
                    global: program.getGlobalDiagnostics().length,
                };
                return {
                    config: path.relative(ROOT, project.configFileName).replace(/\\/gu, '/'),
                    roots: project.rootFiles.length,
                    sourceFiles: program.getSourceFileNames().length,
                    diagnostics,
                    diagnosticTotal: Object.values(diagnostics).reduce((sum, count) => sum + count, 0),
                };
            });
            return {
                durationMs: Number((performance.now() - started).toFixed(1)),
                projects,
                diagnosticTotal: projects.reduce((sum, project) => sum + project.diagnosticTotal, 0),
            };
        } finally {
            snapshot.dispose();
        }
    } finally {
        api.close();
    }
}

const requestedScope = String(values.scope || '').trim();
const roots = requestedScope ? [requestedScope] : ['src', 'scripts', 'tests'];
const files = collectSourceFiles(roots);
const directBabel = directBabelDependencies();
const directVersions = {
    parser: packageVersion('@babel/parser'),
    traverse: packageVersion('@babel/traverse'),
    types: packageVersion('@babel/types'),
};
const babelCorpus = auditBabelCorpus(files);
const ts7 = values['no-ts7'] ? null : auditTs7();
const forbiddenDirect = forbiddenDirectBabelPackages(directBabel);
const directBabel8 = Object.values(directVersions).every((version) => major(version) === 8);
const lockfileBabel = lockfileBabelMajors();
const nonBabel8LockMajors = Object.keys(lockfileBabel).filter((versionMajor) => versionMajor !== '8');
const ok =
    directBabel8 &&
    nonBabel8LockMajors.length === 0 &&
    forbiddenDirect.length === 0 &&
    babelCorpus.thrownCount === 0 &&
    (ts7?.diagnosticTotal ?? 0) === 0;

const report = {
    schemaVersion: '1.1.0',
    capturedAt: new Date().toISOString(),
    policyVersion: BABEL_PARSER_POLICY_VERSION,
    contract: {
        syntaxAuthority: '@babel/parser@8',
        semanticAuthority: '@typescript/native@7',
        transformationAuthority: 'none (Node 24 + TypeScript noEmit)',
        astSharingBoundary:
            'share content snapshots/hashes/projections; do not structured-clone full ASTs across workers',
    },
    runtime: {
        node: process.version,
        babel: directVersions,
        typescriptNative: packageVersion('@typescript/native'),
        typescriptCompat: packageVersion('typescript'),
    },
    dependencies: {
        directBabel,
        forbiddenDirect,
        lockfileBabelMajors: lockfileBabel,
        nonBabel8LockMajors,
    },
    scope: roots,
    babelCorpus,
    ts7,
    ok,
};

if (values.json) {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log(`Babel 8 / TypeScript 7 alignment — ${ok ? 'OK' : 'FAILED'}`);
    console.log(`policy=${report.policyVersion}`);
    console.log(
        `babel parser=${directVersions.parser} traverse=${directVersions.traverse} types=${directVersions.types} ` +
            `files=${babelCorpus.files} parse=${babelCorpus.durationMs}ms thrown=${babelCorpus.thrownCount} recovered=${babelCorpus.recoveredErrors}`,
    );
    console.log(`direct transform/preset packages=${forbiddenDirect.length}`);
    if (ts7) {
        console.log(
            `ts7=${report.runtime.typescriptNative} diagnostics=${ts7.diagnosticTotal} duration=${ts7.durationMs}ms`,
        );
        for (const project of ts7.projects) {
            console.log(
                `  ${project.config}: roots=${project.roots} sources=${project.sourceFiles} diagnostics=${project.diagnosticTotal}`,
            );
        }
    }
    const lockMajors = Object.entries(report.dependencies.lockfileBabelMajors)
        .map(([versionMajor, entry]) => `${versionMajor}:${entry.packages}`)
        .join(' ');
    console.log(`lockfile Babel majors: ${lockMajors || 'none'}`);
    if (nonBabel8LockMajors.length > 0) {
        console.log(`forbidden non-Babel-8 lockfile majors: ${nonBabel8LockMajors.join(', ')}`);
    }
    if (babelCorpus.recovered.length > 0) {
        console.log(`recoverable Babel diagnostics (non-fatal): ${babelCorpus.recovered.length} file(s)`);
        for (const item of babelCorpus.recovered.slice(0, 5)) console.log(`  ${item.file}: ${item.errors.join(', ')}`);
    }
    if (forbiddenDirect.length > 0) console.log(`forbidden direct Babel transforms: ${forbiddenDirect.join(', ')}`);
}

if (!ok) process.exitCode = 1;
