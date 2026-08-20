// @ts-check
/**
 * Governed dependency maintenance for the workspace root.
 *
 * This module intentionally exposes only two fixed workflows:
 *
 * - inspect the current root package against npm registry `latest` versions via the already-installed npm-check-updates;
 * - upgrade the root package manifests and installed tree using the packageManager-pinned npm version; lock resolution
 *   runs without lifecycle scripts, while the final install deliberately enables them and verifies native bindings.
 *
 * No arbitrary command, package name, registry URL, cwd or environment override is accepted by callers.
 *
 * @module copilot/mcp/control-plane/dependency-maintenance
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { writeFileAtomic } from '#copilot/infra/public/io';
import { createWorkspaceIo } from '#copilot/infra/public/workspace-io';
import { getMcpWorkspaceRoot } from './paths.js';

export const MCP_DEPENDENCY_MAINTENANCE_VERSION = 2;

const PACKAGE_JSON = 'package.json';
const PACKAGE_LOCK = 'package-lock.json';
const DEFAULT_TIMEOUT_MS = 180_000;
const UPGRADE_TIMEOUT_MS = 900_000;
const MAX_OUTPUT_BYTES = 512 * 1024;
const NCU_COMMAND = 'npx';
const NCU_BASE_ARGS = ['--no-install', 'npm-check-updates'];
const NATIVE_SMOKE_SCRIPT = 'src/copilot/mcp/scripts/dependency-native-smoke.js';
export const MCP_DEPENDENCY_TRUSTED_INSTALL_SCRIPT_PACKAGES = Object.freeze([
    'better-sqlite3',
    'esbuild',
    'koffi',
    'node-pty',
    'onnxruntime-node',
    'protobufjs',
    'puppeteer',
    'sharp',
    'vue-demi',
]);
const TRUSTED_INSTALL_SCRIPT_PACKAGE_SET = new Set(MCP_DEPENDENCY_TRUSTED_INSTALL_SCRIPT_PACKAGES);
const { readTextFresh: readWorkspaceTextFresh } = createWorkspaceIo({ workspaceRoot: getMcpWorkspaceRoot() });

/**
 * @typedef {{
 *     success: boolean;
 *     command: string;
 *     args: string[];
 *     exitCode: number | null;
 *     signal: NodeJS.Signals | null;
 *     timedOut: boolean;
 *     durationMs: number;
 *     stdout: string;
 *     stderr: string;
 *     outputTruncated: boolean;
 *     phase?: string;
 * }} FixedCommandResult
 */

/**
 * Return root dependency versions that npm-check-updates says can move to the current registry `latest` tag.
 *
 * @param {{ timeoutMs?: number }} [options]
 */
export async function inspectRootDependencyUpdates(options = {}) {
    const timeoutMs = normalizeTimeout(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    const [result, runtimeNpm] = await Promise.all([
        runFixedCommand(NCU_COMMAND, [...NCU_BASE_ARGS, '--jsonUpgraded', '--target', 'latest'], { timeoutMs }),
        runFixedCommand('npm', ['--version'], { timeoutMs: Math.min(timeoutMs, 30_000) }),
    ]);
    const upgrades = result.success ? parseNcuJson(result.stdout) : {};
    const current = await readRootPackageVersions();
    const declaredNpmVersion = current['npm'] ?? null;
    const runtimeNpmVersion = runtimeNpm.success ? runtimeNpm.stdout.trim() || null : null;
    const rows = Object.entries(upgrades)
        .map(([name, latest]) => {
            const currentSpec = current[name] ?? null;
            return {
                name,
                current: currentSpec,
                latest: String(latest),
                semverClass: classifySpecUpgrade(currentSpec, String(latest)),
            };
        })
        .sort((left, right) => left.name.localeCompare(right.name));
    return {
        success: result.success,
        maintenanceVersion: MCP_DEPENDENCY_MAINTENANCE_VERSION,
        packageJson: PACKAGE_JSON,
        target: 'latest',
        scriptsExecuted: false,
        packageManager: declaredNpmVersion ? `npm@${declaredNpmVersion}` : null,
        runtimeNpmVersion,
        runtimeNpmAligned: Boolean(declaredNpmVersion && runtimeNpmVersion === declaredNpmVersion),
        runtimeNpmProbe: summarizeCommandResult(runtimeNpm),
        updateCount: rows.length,
        updates: rows,
        command: summarizeCommandResult(result),
    };
}

/**
 * Upgrade the root package to registry latest versions. The caller must have already established an acceptable dirty
 * worktree policy. The function snapshots the incoming package.json/package-lock.json exactly and restores that
 * incoming state on failure before reconciling node_modules, so pre-existing manifest work is preserved rather than
 * discarded.
 *
 * @param {{ timeoutMs?: number; install?: boolean }} [options]
 */
export async function upgradeRootDependenciesToLatest(options = {}) {
    const workspaceRoot = getMcpWorkspaceRoot();
    const packagePath = path.join(workspaceRoot, PACKAGE_JSON);
    const lockPath = path.join(workspaceRoot, PACKAGE_LOCK);
    const before = {
        packageJson: (await readWorkspaceTextFresh(packagePath, { includeHash: false })).content,
        packageLock: (await readWorkspaceTextFresh(lockPath, { includeHash: false })).content,
    };
    const timeoutMs = normalizeTimeout(options.timeoutMs, UPGRADE_TIMEOUT_MS);
    const install = options.install !== false;
    /** @type {FixedCommandResult[]} */
    const steps = [];
    /** @type {Record<string, unknown> | null} */
    let nativeSmoke = null;
    /** @type {Record<string, unknown> | null} */
    let installScriptPolicy = null;

    try {
        const ncu = await runMaintenanceStep(
            'ncu-update',
            NCU_COMMAND,
            [...NCU_BASE_ARGS, '-u', '--target', 'latest'],
            { timeoutMs },
        );
        steps.push(ncu);
        if (!ncu.success) {
            await restoreRootManifests(before);
            return buildUpgradeFailure('npm-check-updates failed; manifests restored.', steps, {
                rollbackPerformed: true,
                rollbackTreeReconciled: true,
            });
        }

        const npmVersion = await readDeclaredNpmVersion();
        const lock = await runDeclaredNpmStep(
            'lock-resolution',
            npmVersion,
            ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
            timeoutMs,
        );
        steps.push(lock);
        if (!lock.success) {
            await restoreRootManifests(before);
            return buildUpgradeFailure('Dependency resolution failed; package manifests restored.', steps, {
                rollbackPerformed: true,
                rollbackTreeReconciled: true,
                npmVersion,
            });
        }

        if (install) {
            const installed = await runDeclaredNpmStep(
                'final-install',
                npmVersion,
                ['install', '--no-audit', '--no-fund'],
                timeoutMs,
            );
            steps.push(installed);
            if (!installed.success) {
                const rollback = await restoreAndReconcileDependencyTree(before, timeoutMs, steps);
                return buildUpgradeFailure('Final dependency installation failed after lock resolution.', steps, {
                    rollbackPerformed: true,
                    rollbackTreeReconciled: rollback.treeReconciled,
                    npmVersion,
                    rollbackNpmVersion: rollback.npmVersion,
                });
            }

            const scriptGate = await reconcileInstallScriptPolicy(npmVersion, timeoutMs, steps);
            installScriptPolicy = scriptGate;
            if (!scriptGate.success) {
                const rollback = await restoreAndReconcileDependencyTree(before, timeoutMs, steps);
                return buildUpgradeFailure(scriptGate.error ?? 'Dependency install-script policy gate failed.', steps, {
                    rollbackPerformed: true,
                    rollbackTreeReconciled: rollback.treeReconciled,
                    npmVersion,
                    rollbackNpmVersion: rollback.npmVersion,
                    installScriptPolicy: scriptGate,
                });
            }

            const smokeResult = await runMaintenanceStep('native-smoke', process.execPath, [NATIVE_SMOKE_SCRIPT], {
                timeoutMs: Math.min(timeoutMs, DEFAULT_TIMEOUT_MS),
            });
            steps.push(smokeResult);
            nativeSmoke = parseJsonObject(smokeResult.stdout);
            if (!smokeResult.success || nativeSmoke?.['success'] !== true) {
                const rollback = await restoreAndReconcileDependencyTree(before, timeoutMs, steps);
                return buildUpgradeFailure('Native dependency smoke failed after installation.', steps, {
                    rollbackPerformed: true,
                    rollbackTreeReconciled: rollback.treeReconciled,
                    npmVersion,
                    rollbackNpmVersion: rollback.npmVersion,
                    nativeSmoke,
                });
            }
        }

        const afterAudit = await inspectRootDependencyUpdates({ timeoutMs: Math.min(timeoutMs, DEFAULT_TIMEOUT_MS) });
        return {
            success: true,
            maintenanceVersion: MCP_DEPENDENCY_MAINTENANCE_VERSION,
            target: 'latest',
            installed: install,
            packageManager: `npm@${npmVersion}`,
            lockResolutionScriptsExecuted: false,
            finalInstallScriptsExecuted: install,
            nativeSmoke,
            installScriptPolicy,
            rollbackPerformed: false,
            rollbackTreeReconciled: null,
            remainingUpdateCount: afterAudit.updateCount,
            remainingUpdates: afterAudit.updates,
            steps: steps.map(summarizeCommandResult),
        };
    } catch (error) {
        const rollback = await restoreAndReconcileDependencyTree(before, timeoutMs, steps).catch(() => ({
            treeReconciled: false,
            npmVersion: null,
        }));
        return {
            success: false,
            maintenanceVersion: MCP_DEPENDENCY_MAINTENANCE_VERSION,
            target: 'latest',
            installed: false,
            lockResolutionScriptsExecuted: false,
            finalInstallScriptsExecuted: install,
            rollbackPerformed: true,
            rollbackTreeReconciled: rollback.treeReconciled,
            rollbackNpmVersion: rollback.npmVersion,
            error: error instanceof Error ? error.message : String(error),
            steps: steps.map(summarizeCommandResult),
        };
    }
}

/** @param {string} packageJsonText @returns {string | null} */
export function readDeclaredNpmVersionFromPackageText(packageJsonText) {
    const parsed = JSON.parse(packageJsonText);
    const packageManager = typeof parsed.packageManager === 'string' ? parsed.packageManager.trim() : '';
    const match = /^npm@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u.exec(packageManager);
    return match?.[1] ?? null;
}

/** @returns {Promise<string>} */
async function readDeclaredNpmVersion() {
    const packageText = (
        await readWorkspaceTextFresh(path.join(getMcpWorkspaceRoot(), PACKAGE_JSON), { includeHash: false })
    ).content;
    const version = readDeclaredNpmVersionFromPackageText(packageText);
    if (!version)
        throw new Error('package.json must declare an exact npm packageManager version before dependency maintenance.');
    return version;
}

/**
 * @param {string} phase
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeoutMs: number }} options
 */
async function runMaintenanceStep(phase, command, args, options) {
    const result = await runFixedCommand(command, args, options);
    return { ...result, phase };
}

/**
 * Run npm through the version declared by packageManager instead of assuming the container-global npm matches it.
 *
 * @param {string} phase
 * @param {string} npmVersion
 * @param {string[]} npmArgs
 * @param {number} timeoutMs
 */
function runDeclaredNpmStep(phase, npmVersion, npmArgs, timeoutMs) {
    return runMaintenanceStep(phase, NCU_COMMAND, ['--yes', `--package=npm@${npmVersion}`, 'npm', ...npmArgs], {
        timeoutMs,
    });
}

/**
 * @param {{ packageJson: string; packageLock: string }} before
 * @param {number} timeoutMs
 * @param {FixedCommandResult[]} steps
 */
async function restoreAndReconcileDependencyTree(before, timeoutMs, steps) {
    await restoreRootManifests(before);
    const npmVersion = readDeclaredNpmVersionFromPackageText(before.packageJson);
    if (!npmVersion) return { treeReconciled: false, npmVersion: null };
    const restoreInstall = await runDeclaredNpmStep(
        'rollback-install',
        npmVersion,
        ['install', '--no-audit', '--no-fund'],
        timeoutMs,
    );
    steps.push(restoreInstall);
    if (!restoreInstall.success) return { treeReconciled: false, npmVersion };
    const smoke = await runMaintenanceStep('rollback-native-smoke', process.execPath, [NATIVE_SMOKE_SCRIPT], {
        timeoutMs: Math.min(timeoutMs, DEFAULT_TIMEOUT_MS),
    });
    steps.push(smoke);
    const parsedSmoke = parseJsonObject(smoke.stdout);
    return { treeReconciled: smoke.success && parsedSmoke?.['success'] === true, npmVersion };
}

/**
 * @param {Record<string, unknown> | null} payload
 */
export function summarizeInstallScriptPolicy(payload) {
    const rows = Array.isArray(payload?.['allowScripts']) ? payload['allowScripts'] : [];
    const pending = [];
    for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const record = /** @type {Record<string, unknown>} */ (row);
        const name = typeof record['name'] === 'string' ? record['name'] : '';
        const changes = Array.isArray(record['changes']) ? record['changes'] : [];
        if (
            !name ||
            !changes.some(
                (change) =>
                    change && typeof change === 'object' && !Array.isArray(change) && change['change'] === 'pending',
            )
        ) {
            continue;
        }
        pending.push(name);
    }
    const uniquePending = [...new Set(pending)].sort();
    const trustedPending = uniquePending.filter((name) => TRUSTED_INSTALL_SCRIPT_PACKAGE_SET.has(name));
    const untrustedPending = uniquePending.filter((name) => !TRUSTED_INSTALL_SCRIPT_PACKAGE_SET.has(name));
    return {
        pending: uniquePending,
        pendingCount: uniquePending.length,
        trustedPending,
        untrustedPending,
        trustedPackageNames: [...MCP_DEPENDENCY_TRUSTED_INSTALL_SCRIPT_PACKAGES],
    };
}

/**
 * @param {string} npmVersion
 * @param {number} timeoutMs
 * @param {FixedCommandResult[]} steps
 */
async function reconcileInstallScriptPolicy(npmVersion, timeoutMs, steps) {
    const initialAudit = await runDeclaredNpmStep(
        'install-scripts-audit',
        npmVersion,
        ['install-scripts', 'ls', '--json'],
        Math.min(timeoutMs, DEFAULT_TIMEOUT_MS),
    );
    steps.push(initialAudit);
    const initialPayload = parseJsonObject(initialAudit.stdout);
    const initial = summarizeInstallScriptPolicy(initialPayload);
    if (!initialAudit.success || !initialPayload) {
        return { success: false, error: 'Could not audit npm install-script policy.', initial };
    }
    if (initial.untrustedPending.length > 0) {
        return {
            success: false,
            error: `Untrusted install-script packages require explicit policy review: ${initial.untrustedPending.join(', ')}`,
            initial,
        };
    }

    /** @type {string[]} */
    let approved = [];
    if (initial.trustedPending.length > 0) {
        approved = [...initial.trustedPending];
        const approval = await runDeclaredNpmStep(
            'install-scripts-approve-trusted',
            npmVersion,
            ['install-scripts', 'approve', ...approved],
            Math.min(timeoutMs, DEFAULT_TIMEOUT_MS),
        );
        steps.push(approval);
        if (!approval.success) {
            return { success: false, error: 'Trusted install-script approval failed.', initial, approved };
        }
        const rebuild = await runDeclaredNpmStep(
            'rebuild-approved-install-scripts',
            npmVersion,
            ['rebuild', ...approved, '--no-audit', '--no-fund'],
            timeoutMs,
        );
        steps.push(rebuild);
        if (!rebuild.success) {
            return {
                success: false,
                error: 'Rebuild after trusted install-script approval failed.',
                initial,
                approved,
            };
        }
    }

    const stalePolicy = await pruneStaleTrustedAllowScripts();
    const verifyAudit = await runDeclaredNpmStep(
        'install-scripts-verify',
        npmVersion,
        ['install-scripts', 'ls', '--json'],
        Math.min(timeoutMs, DEFAULT_TIMEOUT_MS),
    );
    steps.push(verifyAudit);
    const verifyPayload = parseJsonObject(verifyAudit.stdout);
    const final = summarizeInstallScriptPolicy(verifyPayload);
    if (!verifyAudit.success || !verifyPayload || final.pendingCount > 0) {
        return {
            success: false,
            error: 'Install-script policy still has pending packages after reconciliation.',
            initial,
            approved,
            stalePolicy,
            final,
        };
    }
    return { success: true, initial, approved, stalePolicy, final };
}

/**
 * Remove stale exact-version approvals only for the repository-maintained trusted package set. Unknown/manual policy
 * entries are preserved byte-for-byte at the semantic JSON level.
 */
async function pruneStaleTrustedAllowScripts() {
    const workspaceRoot = getMcpWorkspaceRoot();
    const packagePath = path.join(workspaceRoot, PACKAGE_JSON);
    const lockPath = path.join(workspaceRoot, PACKAGE_LOCK);
    const packageText = (await readWorkspaceTextFresh(packagePath, { includeHash: false })).content;
    const parsedPackage = JSON.parse(packageText);
    const allowScripts = parsedPackage.allowScripts;
    if (!allowScripts || typeof allowScripts !== 'object' || Array.isArray(allowScripts)) {
        return { changed: false, removed: [] };
    }
    const lock = JSON.parse((await readWorkspaceTextFresh(lockPath, { includeHash: false })).content);
    const packages = lock?.packages && typeof lock.packages === 'object' ? lock.packages : {};
    /** @type {Map<string, Set<string>>} */
    const lockedVersions = new Map(MCP_DEPENDENCY_TRUSTED_INSTALL_SCRIPT_PACKAGES.map((name) => [name, new Set()]));
    for (const [packagePathKey, metadata] of Object.entries(packages)) {
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue;
        for (const name of MCP_DEPENDENCY_TRUSTED_INSTALL_SCRIPT_PACKAGES) {
            if (packagePathKey === `node_modules/${name}` || packagePathKey.endsWith(`/node_modules/${name}`)) {
                const version = metadata['version'];
                if (typeof version === 'string') lockedVersions.get(name)?.add(version);
            }
        }
    }
    const removed = [];
    for (const key of Object.keys(allowScripts)) {
        const name = MCP_DEPENDENCY_TRUSTED_INSTALL_SCRIPT_PACKAGES.find((candidate) =>
            key.startsWith(`${candidate}@`),
        );
        if (!name) continue;
        const version = key.slice(name.length + 1);
        if (!lockedVersions.get(name)?.has(version)) {
            delete allowScripts[key];
            removed.push(key);
        }
    }
    if (removed.length === 0) return { changed: false, removed: [] };
    await writeFileAtomic(packagePath, `${JSON.stringify(parsedPackage, null, 2)}\n`, {
        encoding: 'utf8',
        riskClass: 'high',
        advisoryLimits: { domain: 'dependency-maintenance-allow-scripts-prune', file: PACKAGE_JSON },
    });
    return { changed: true, removed: removed.sort() };
}

/** @param {{ packageJson: string; packageLock: string }} snapshot */
async function restoreRootManifests(snapshot) {
    const workspaceRoot = getMcpWorkspaceRoot();
    await writeFileAtomic(path.join(workspaceRoot, PACKAGE_JSON), snapshot.packageJson, {
        encoding: 'utf8',
        riskClass: 'high',
        advisoryLimits: { domain: 'dependency-maintenance-rollback', file: PACKAGE_JSON },
    });
    await writeFileAtomic(path.join(workspaceRoot, PACKAGE_LOCK), snapshot.packageLock, {
        encoding: 'utf8',
        riskClass: 'high',
        advisoryLimits: { domain: 'dependency-maintenance-rollback', file: PACKAGE_LOCK },
    });
}

/** @returns {Promise<Record<string, string>>} */
async function readRootPackageVersions() {
    const packageText = (
        await readWorkspaceTextFresh(path.join(getMcpWorkspaceRoot(), PACKAGE_JSON), { includeHash: false })
    ).content;
    const parsed = JSON.parse(packageText);
    const npmVersion = readDeclaredNpmVersionFromPackageText(packageText);
    return {
        ...(parsed.dependencies ?? {}),
        ...(parsed.devDependencies ?? {}),
        ...(parsed.optionalDependencies ?? {}),
        ...(parsed.peerDependencies ?? {}),
        ...(npmVersion ? { npm: npmVersion } : {}),
    };
}

/**
 * @param {string | null} current
 * @param {string} latest
 */
function classifySpecUpgrade(current, latest) {
    const currentVersion = extractNumericVersion(current ?? '');
    const latestVersion = extractNumericVersion(latest);
    if (!currentVersion || !latestVersion) return 'unknown';
    if (latestVersion.major !== currentVersion.major) return 'major';
    if (latestVersion.minor !== currentVersion.minor) return 'minor';
    if (latestVersion.patch !== currentVersion.patch) return 'patch';
    return 'range-or-tag';
}

/** @param {string} value */
function extractNumericVersion(value) {
    const match = String(value).match(/(\d+)\.(\d+)\.(\d+)/u);
    return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

/** @param {string} stdout @returns {Record<string, unknown> | null} */
function parseJsonObject(stdout) {
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end < start) return null;
    try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? /** @type {Record<string, unknown>} */ (parsed)
            : null;
    } catch {
        return null;
    }
}

/** @param {string} stdout */
function parseNcuJson(stdout) {
    const trimmed = stdout.trim();
    if (!trimmed) return {};
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('npm-check-updates did not return a JSON object.');
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('npm-check-updates JSON output was not an object.');
    }
    return /** @type {Record<string, string>} */ (parsed);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeoutMs: number }} options
 * @returns {Promise<FixedCommandResult>}
 */
function runFixedCommand(command, args, options) {
    return new Promise((resolve) => {
        const startedAt = performance.now();
        const child = spawn(command, args, {
            cwd: getMcpWorkspaceRoot(),
            env: {
                ...process.env,
                NO_COLOR: '1',
                FORCE_COLOR: '0',
                npm_config_audit: 'false',
                npm_config_fund: 'false',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
        });
        let stdout = '';
        let stderr = '';
        let outputTruncated = false;
        /** @param {string} current @param {string | Buffer} chunk */
        const append = (current, chunk) => {
            if (Buffer.byteLength(current) >= MAX_OUTPUT_BYTES) {
                outputTruncated = true;
                return current;
            }
            const combined = current + String(chunk);
            if (Buffer.byteLength(combined) <= MAX_OUTPUT_BYTES) return combined;
            outputTruncated = true;
            return Buffer.from(combined).subarray(0, MAX_OUTPUT_BYTES).toString('utf8');
        };
        child.stdout?.on('data', (chunk) => {
            stdout = append(stdout, chunk);
        });
        child.stderr?.on('data', (chunk) => {
            stderr = append(stderr, chunk);
        });
        let timedOut = false;
        let settled = false;
        const timer = setTimeout(() => {
            timedOut = true;
            killChildTree(child.pid);
        }, options.timeoutMs);
        timer.unref();
        child.once('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
                success: false,
                command,
                args,
                exitCode: null,
                signal: null,
                timedOut,
                durationMs: Math.round(performance.now() - startedAt),
                stdout,
                stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`,
                outputTruncated,
            });
        });
        child.once('close', (exitCode, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
                success: exitCode === 0 && !timedOut,
                command,
                args,
                exitCode,
                signal,
                timedOut,
                durationMs: Math.round(performance.now() - startedAt),
                stdout,
                stderr,
                outputTruncated,
            });
        });
    });
}

/** @param {number | undefined} pid */
function killChildTree(pid) {
    if (!pid) return;
    try {
        if (process.platform === 'win32') process.kill(pid, 'SIGKILL');
        else process.kill(-pid, 'SIGKILL');
    } catch {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // already exited
        }
    }
}

/** @param {FixedCommandResult} result */
function summarizeCommandResult(result) {
    return {
        ...(result.phase ? { phase: result.phase } : {}),
        success: result.success,
        command: result.command,
        args: result.args,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        outputTruncated: result.outputTruncated,
        stdoutTail: tailText(result.stdout, 8_000),
        stderrTail: tailText(result.stderr, 8_000),
    };
}

/** @param {string} value @param {number} maxBytes */
function tailText(value, maxBytes) {
    const bytes = Buffer.from(value);
    return bytes.length <= maxBytes ? value : bytes.subarray(bytes.length - maxBytes).toString('utf8');
}

/** @param {number | undefined} value @param {number} fallback */
function normalizeTimeout(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(30_000, Math.min(1_800_000, Math.round(numeric)));
}

/**
 * @param {string} error
 * @param {FixedCommandResult[]} steps
 * @param {{
 *     rollbackPerformed: boolean;
 *     rollbackTreeReconciled: boolean;
 *     npmVersion?: string;
 *     rollbackNpmVersion?: string | null;
 *     nativeSmoke?: Record<string, unknown> | null;
 *     installScriptPolicy?: Record<string, unknown> | null;
 * }} rollback
 */
function buildUpgradeFailure(error, steps, rollback) {
    return {
        success: false,
        maintenanceVersion: MCP_DEPENDENCY_MAINTENANCE_VERSION,
        target: 'latest',
        installed: false,
        lockResolutionScriptsExecuted: false,
        finalInstallScriptsExecuted: steps.some((step) => step.phase === 'final-install'),
        rollbackPerformed: rollback.rollbackPerformed,
        rollbackTreeReconciled: rollback.rollbackTreeReconciled,
        ...(rollback.npmVersion ? { packageManager: `npm@${rollback.npmVersion}` } : {}),
        ...(rollback.rollbackNpmVersion ? { rollbackPackageManager: `npm@${rollback.rollbackNpmVersion}` } : {}),
        ...(rollback.nativeSmoke ? { nativeSmoke: rollback.nativeSmoke } : {}),
        ...(rollback.installScriptPolicy ? { installScriptPolicy: rollback.installScriptPolicy } : {}),
        error,
        steps: steps.map(summarizeCommandResult),
    };
}
