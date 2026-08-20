// @ts-check
/**
 * CI gate: proves that every active JS/TS-family workspace file belongs to at least one project referenced by the
 * canonical TypeScript 7 strict solution.
 *
 * This gate intentionally does not pretend that Vue SFCs are native `tsc` inputs. They are inventoried and reported
 * separately so the frontend checker can provide its own proof without creating a false TS7-coverage claim.
 *
 * @module check-ts7-strict-coverage
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);
const ROOT = resolve('.');
const STRICT_SOLUTION = resolve('tsconfig.strict.json');
const TSC_RUNNER = resolve('scripts/ci/run-typescript-7.mjs');
const ACTIVE_ROOTS = ['src', 'scripts', 'tests', 'tools', 'config'];
const TS_NATIVE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const SFC_EXTENSIONS = new Set(['.vue']);
const EXCLUDED_DIR_NAMES = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
const EXCLUDED_PREFIXES = ['src/copilot/.ai/'];

/**
 * @param {string} absolute
 * @returns {string}
 */
function repoPath(absolute) {
    return relative(ROOT, absolute).replaceAll('\\', '/');
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isExcluded(path) {
    const normalized = repoPath(path);
    return EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * @param {string} directory
 * @param {ReadonlySet<string>} extensions
 * @returns {string[]}
 */
function listCodeFiles(directory, extensions) {
    /** @type {string[]} */
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
        const absolute = join(directory, entry.name);
        if (isExcluded(absolute)) continue;
        if (entry.isDirectory()) files.push(...listCodeFiles(absolute, extensions));
        else if (entry.isFile() && extensions.has(extname(entry.name))) files.push(resolve(absolute));
    }
    return files;
}

/**
 * @param {ReadonlySet<string>} extensions
 * @returns {string[]}
 */
function inventory(extensions) {
    const files = ACTIVE_ROOTS.flatMap((root) => listCodeFiles(resolve(root), extensions));
    for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
        if (entry.isFile() && extensions.has(extname(entry.name))) files.push(resolve(entry.name));
    }
    return [...new Set(files)].sort();
}

/**
 * @returns {string[]}
 */
function strictProjectConfigs() {
    const solution = /** @type {{ references?: { path?: string }[] }} */ (
        JSON.parse(readFileSync(STRICT_SOLUTION, 'utf8'))
    );
    if (!Array.isArray(solution.references) || solution.references.length === 0) {
        throw new Error('tsconfig.strict.json has no project references');
    }
    return solution.references.map((reference) => {
        if (typeof reference.path !== 'string' || reference.path.trim() === '') {
            throw new Error('tsconfig.strict.json contains an invalid project reference');
        }
        return resolve(reference.path);
    });
}

/**
 * @param {string} project
 * @returns {Promise<string[]>}
 */
async function listProjectFiles(project) {
    const { stdout } = await execFileAsync(
        process.execPath,
        [TSC_RUNNER, '--checkers', '2', '--listFilesOnly', '-p', project],
        {
            cwd: ROOT,
            maxBuffer: 64 * 1024 * 1024,
        },
    );
    return stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((file) => resolve(isAbsolute(file) ? file : join(ROOT, file)));
}

const projects = strictProjectConfigs();
const covered = new Set((await Promise.all(projects.map(listProjectFiles))).flat());
const nativeFiles = inventory(TS_NATIVE_EXTENSIONS);
const vueFiles = inventory(SFC_EXTENSIONS);
const uncovered = nativeFiles.filter((file) => !covered.has(file));

if (uncovered.length > 0) {
    console.error(
        `\n❌ check-ts7-strict-coverage: ${uncovered.length}/${nativeFiles.length} native JS/TS file(s) are outside the strict solution:\n`,
    );
    for (const file of uncovered) console.error(`  ${repoPath(file)}`);
    console.error('\nAdd every active file to an appropriate project referenced by tsconfig.strict.json.\n');
    process.exit(1);
}

console.log(
    `✅ check-ts7-strict-coverage: ${nativeFiles.length}/${nativeFiles.length} native JS/TS files covered by ${projects.length} strict TS7 projects.`,
);
if (vueFiles.length > 0) {
    console.log(
        `ℹ️  check-ts7-strict-coverage: ${vueFiles.length} Vue SFCs inventoried separately; native tsc coverage is not claimed for them.`,
    );
}
