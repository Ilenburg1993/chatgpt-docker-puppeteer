import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const COPILOT_LINT_ROOTS = Object.freeze(['src/copilot/', 'tests/unit/copilot/']);
const COPILOT_TYPE_AWARE_ROOT = 'src/copilot/';
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

/**
 * Type-aware promise lint deliberately covers first-party Copilot source only. Tests keep the historical relaxed lane.
 *
 * @param {Iterable<string>} paths
 */
export function selectChangedCopilotTypeAwarePaths(paths) {
    return selectChangedCopilotLintPaths(paths).filter((candidate) => candidate.startsWith(COPILOT_TYPE_AWARE_ROOT));
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

/**
 * @param {string} label
 * @param {string} executable
 * @param {string[]} args
 * @param {{cwd:string;env:NodeJS.ProcessEnv}} options
 */
function runLintProcess(label, executable, args, options) {
    const result = spawnSync(executable, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: 'inherit',
        windowsHide: true,
    });
    if (result.error) {
        process.stderr.write(`[lint:copilot:changed] phase=${label} error=${result.error.message}\n`);
        return 1;
    }
    return Number(result.status ?? (result.signal ? 1 : 0));
}

/** @param {{ cwd?: string; env?: NodeJS.ProcessEnv }} [options] */
export function runChangedCopilotLint(options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const env = options.env ?? process.env;
    const files = collectChangedCopilotLintPaths(cwd);
    const typeAwareFiles = selectChangedCopilotTypeAwarePaths(files);
    const startedAt = Date.now();
    if (files.length === 0) {
        process.stdout.write('[lint:copilot:changed] files=0 typeAwareFiles=0 skipped=true durationMs=0\n');
        return 0;
    }

    const eslintCli = path.join(cwd, 'node_modules', 'eslint', 'bin', 'eslint.js');
    const cacheLocation =
        env['COPILOT_ESLINT_CACHE_LOCATION'] ??
        path.join(env['HOME'] ?? '/home/node', '.cache', 'eslint', '.eslintcache');
    const eslintExitCode = runLintProcess(
        'eslint',
        process.execPath,
        ['--max-old-space-size=6144', eslintCli, ...files, '--cache', '--cache-location', cacheLocation],
        { cwd, env },
    );
    if (eslintExitCode !== 0) {
        const durationMs = Date.now() - startedAt;
        process.stdout.write(
            `[lint:copilot:changed] files=${String(files.length)} typeAwareFiles=${String(typeAwareFiles.length)} phase=eslint durationMs=${String(durationMs)} exitCode=${String(eslintExitCode)}\n`,
        );
        return eslintExitCode;
    }

    let typeAwareExitCode = 0;
    if (typeAwareFiles.length > 0) {
        const oxlintCli = path.join(cwd, 'node_modules', 'oxlint', 'bin', 'oxlint');
        typeAwareExitCode = runLintProcess(
            'type-aware',
            process.execPath,
            [oxlintCli, '--type-aware', '--tsconfig=tsconfig.node.json', ...typeAwareFiles],
            { cwd, env },
        );
    }

    const durationMs = Date.now() - startedAt;
    process.stdout.write(
        `[lint:copilot:changed] files=${String(files.length)} typeAwareFiles=${String(typeAwareFiles.length)} durationMs=${String(durationMs)} eslintExitCode=${String(eslintExitCode)} typeAwareExitCode=${String(typeAwareExitCode)}\n`,
    );
    return typeAwareExitCode;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) process.exitCode = runChangedCopilotLint();
