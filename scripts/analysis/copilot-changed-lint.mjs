import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const COPILOT_LINT_ROOTS = Object.freeze(['src/copilot/', 'tests/unit/copilot/']);
const COPILOT_LINT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx']);
const GENERATED_COPILOT_PREFIXES = Object.freeze(['src/copilot/.ai/']);

/** @param {string} value */
function normalizeRepositoryPath(value) {
    return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

/**
 * Select only lintable Copilot source/test files from an arbitrary changed-path set.
 * Deleted paths are excluded by the Git queries before this function is called.
 *
 * @param {Iterable<string>} paths
 */
export function selectChangedCopilotLintPaths(paths) {
    return [...new Set([...paths].map(normalizeRepositoryPath))]
        .filter(Boolean)
        .filter((candidate) => COPILOT_LINT_ROOTS.some((root) => candidate.startsWith(root)))
        .filter((candidate) => !GENERATED_COPILOT_PREFIXES.some((prefix) => candidate.startsWith(prefix)))
        .filter((candidate) => COPILOT_LINT_EXTENSIONS.has(path.posix.extname(candidate)))
        .sort((left, right) => left.localeCompare(right));
}

/** @param {string} stdout */
export function parseNulSeparatedPaths(stdout) {
    return stdout
        .split('\0')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

/** @param {string} cwd @param {string[]} args */
function readGitPaths(cwd, args) {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        const stderr = String(result.stderr ?? '').trim();
        throw new Error(
            `git ${args.join(' ')} failed with exit ${String(result.status)}${stderr ? `: ${stderr}` : ''}`,
        );
    }
    return parseNulSeparatedPaths(String(result.stdout ?? ''));
}

/** @param {string} cwd */
export function collectChangedCopilotLintPaths(cwd) {
    const changed = new Set([
        ...readGitPaths(cwd, ['diff', '--name-only', '-z', '--diff-filter=ACMR', '--']),
        ...readGitPaths(cwd, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR', '--']),
        ...readGitPaths(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--']),
    ]);
    return selectChangedCopilotLintPaths(changed);
}

/** @param {{ cwd?: string; env?: NodeJS.ProcessEnv }} [options] */
export function runChangedCopilotLint(options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const env = options.env ?? process.env;
    const files = collectChangedCopilotLintPaths(cwd);
    const startedAt = Date.now();
    if (files.length === 0) {
        process.stdout.write('[lint:copilot:changed] files=0 skipped=true durationMs=0\n');
        return 0;
    }

    const eslintCli = path.join(cwd, 'node_modules', 'eslint', 'bin', 'eslint.js');
    const cacheLocation =
        env['COPILOT_ESLINT_CACHE_LOCATION'] ??
        path.join(env['HOME'] ?? '/home/node', '.cache', 'eslint', '.eslintcache');
    const result = spawnSync(
        process.execPath,
        ['--max-old-space-size=6144', eslintCli, ...files, '--cache', '--cache-location', cacheLocation],
        {
            cwd,
            env,
            stdio: 'inherit',
            windowsHide: true,
        },
    );
    const durationMs = Date.now() - startedAt;
    if (result.error) {
        process.stderr.write(
            `[lint:copilot:changed] files=${String(files.length)} durationMs=${String(durationMs)} error=${result.error.message}\n`,
        );
        return 1;
    }
    const exitCode = Number(result.status ?? (result.signal ? 1 : 0));
    process.stdout.write(
        `[lint:copilot:changed] files=${String(files.length)} durationMs=${String(durationMs)} exitCode=${String(exitCode)}\n`,
    );
    return exitCode;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) process.exitCode = runChangedCopilotLint();
