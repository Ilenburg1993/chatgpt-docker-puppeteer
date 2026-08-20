// @ts-check
/**
 * CI gate: compiler suppression directives are forbidden in active workspace code.
 *
 * The TypeScript program must model invalid-input tests, optional dependencies and dynamic runtime boundaries through
 * explicit contracts, `unknown` + narrowing, structural fakes, or runtime validation. Silencing the compiler is not
 * an accepted compatibility mechanism.
 *
 * @module check-ts-suppressions
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const ROOT = resolve('.');
const CODE_ROOTS = ['src', 'scripts', 'tests', 'tools', 'config'];
const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue']);
const EXCLUDED_DIR_NAMES = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
const EXCLUDED_PREFIXES = ['src/copilot/.ai/'];
const DIRECTIVE_RE = /(?:^|\s)(?:\/\/|\/\*)\s*@ts-(ignore|nocheck|expect-error)\b/u;

/**
 * @param {string} directory
 * @returns {string[]}
 */
function listCodeFiles(directory) {
    /** @type {string[]} */
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
        const absolute = join(directory, entry.name);
        const repoPath = relative(ROOT, absolute).replaceAll('\\', '/');
        if (EXCLUDED_PREFIXES.some((prefix) => repoPath.startsWith(prefix))) continue;
        if (entry.isDirectory()) {
            files.push(...listCodeFiles(absolute));
        } else if (entry.isFile() && CODE_EXTENSIONS.has(extname(entry.name))) {
            files.push(absolute);
        }
    }
    return files;
}

const files = CODE_ROOTS.flatMap((root) => {
    const absolute = resolve(root);
    return statSync(absolute).isDirectory() ? listCodeFiles(absolute) : [];
});
for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && CODE_EXTENSIONS.has(extname(entry.name))) files.push(resolve(entry.name));
}

/** @type {Array<{ file: string; line: number; directive: string }>} */
const violations = [];
for (const file of [...new Set(files)].sort()) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        const match = DIRECTIVE_RE.exec(line);
        if (!match) continue;
        violations.push({
            file: relative(ROOT, file).replaceAll('\\', '/'),
            line: index + 1,
            directive: `@ts-${match[1]}`,
        });
    }
}

if (violations.length > 0) {
    console.error(`\n❌ check-ts-suppressions: ${violations.length} compiler suppression directive(s) found:\n`);
    for (const violation of violations) {
        console.error(`  ${violation.file}:${violation.line}  ${violation.directive}`);
    }
    console.error('\nUse explicit types, runtime narrowing or structurally typed test doubles instead of compiler suppression.\n');
    process.exit(1);
}

console.log(`✅ check-ts-suppressions: 0 directives across ${files.length} active code files.`);
