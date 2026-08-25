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
 * @module copilot/mcp/maintenance/dependencies/runtime
 */

import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import { createAttachedChildProcessSupervisor } from '#copilot/mcp/public/process/supervision';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

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
const TRUSTED_INSTALL_SCRIPT_PACKAGES = Object.freeze([...MCP_DEPENDENCY_TRUSTED_INSTALL_SCRIPT_PACKAGES]);

/**
 * @typedef {Readonly<{
 *     workspaceRoot: string;
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     readTextFresh: import('#copilot/mcp/public/workspace').McpWorkspaceCapability['io']['readTextFresh'];
 *     writeFileAtomic: import('#copilot/mcp/public/workspace').McpWorkspaceCapability['io']['writeFileAtomic'];
 *     signal: AbortSignal | undefined;
 * }>} DependencyMaintenanceRuntime
 */

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {AbortSignal | undefined} [signal]
 * @returns {DependencyMaintenanceRuntime}
 */
function createDependencyMaintenanceRuntime(workspace, signal) {
    if (!workspace) throw new TypeError('Dependency maintenance requires a workspace capability.');
    return Object.freeze({
        workspaceRoot: workspace.workspaceRoot,
        workspace,
        readTextFresh: workspace.io.readTextFresh,
        writeFileAtomic: workspace.io.writeFileAtomic,
        signal,
    });
}

/**
 * @typedef {{
 *     success: boolean;
 *     command: string;
 *     args: string[];
 *     exitCode: number | null;
 *     signal: NodeJS.Signals | null;
 *     timedOut: boolean;
 *     cancelled: boolean;
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
 * @param {{ workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability; timeoutMs?: number; signal?: AbortSignal }} options
 */
export async function inspectRootDependencyUpdates(options) {
    const runtime = createDependencyMaintenanceRuntime(options.workspace, options.signal);
    const timeoutMs = normalizeTimeout(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    const [result, runtimeNpm] = await Promise.all([
        runFixedCommand(NCU_COMMAND, [...NCU_BASE_ARGS, '--jsonUpgraded', '--target', 'latest'], {
            timeoutMs,
            cwd: runtime.workspaceRoot,
            ...(runtime.signal ? { signal: runtime.signal } : {}),
        }),
        runFixedCommand('npm', ['--version'], {
            timeoutMs: Math.min(timeoutMs, 30_000),
            cwd: runtime.workspaceRoot,
            ...(runtime.signal ? { signal: runtime.signal } : {}),
        }),
    ]);
    const upgrades = result.success ? parseNcuJson(result.stdout) : {};
    const current = await readRootPackageVersions(runtime);
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
 * @param {{
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     timeoutMs?: number;
 *     install?: boolean;
 *     signal?: AbortSignal;
 * }} options
 */
export async function upgradeRootDependenciesToLatest(options) {
    const runtime = createDependencyMaintenanceRuntime(options.workspace, options.signal);
    const workspaceRoot = runtime.workspaceRoot;
    const packagePath = path.join(workspaceRoot, PACKAGE_JSON);
    const lockPath = path.join(workspaceRoot, PACKAGE_LOCK);
    const before = {
        packageJson: (await runtime.readTextFresh(packagePath, { includeHash: false })).content,
        packageLock: (await runtime.readTextFresh(lockPath, { includeHash: false })).content,
    };
    const timeoutMs = normalizeTimeout(options.timeoutMs, UPGRADE_TIMEOUT_MS);
    const install = options.install !== false;
    /** @type {FixedCommandResult[]} */
    const steps = [];
    if (runtime.signal?.aborted) {
        return {
            success: false,
            maintenanceVersion: MCP_DEPENDENCY_MAINTENANCE_VERSION,
            target: 'latest',
            installed: false,
            lockResolutionScriptsExecuted: false,
            finalInstallScriptsExecuted: false,
            rollbackPerformed: false,
            rollbackTreeReconciled: null,
            cancelled: true,
            error: 'Dependency upgrade cancelled before mutation started.',
            steps: [],
        };
    }
    /** @type {Record<string, unknown> | null} */
    let nativeSmoke = null;
    /** @type {Record<string, unknown> | null} */
    let installScriptPolicy = null;

    try {
        const ncu = await runMaintenanceStep(
            runtime,
            'ncu-update',
            NCU_COMMAND,
            [...NCU_BASE_ARGS, '-u', '--target', 'latest'],
            { timeoutMs },
        );
        steps.push(ncu);
        if (!ncu.success) {
            await restoreRootManifests(runtime, before);
            return buildUpgradeFailure('npm-check-updates failed; manifests restored.', steps, {
                rollbackPerformed: true,
                rollbackTreeReconciled: true,
            });
        }

        const npmVersion = await readDeclaredNpmVersion(runtime);
        const lock = await runDeclaredNpmStep(
            runtime,
            'lock-resolution',
            npmVersion,
            ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
            timeoutMs,
        );
        steps.push(lock);
        if (!lock.success) {
            await restoreRootManifests(runtime, before);
            return buildUpgradeFailure('Dependency resolution failed; package manifests restored.', steps, {
                rollbackPerformed: true,
                rollbackTreeReconciled: true,
                npmVersion,
            });
        }

        if (install) {
            const installed = await runDeclaredNpmStep(
                runtime,
                'final-install',
                npmVersion,
                ['install', '--no-audit', '--no-fund'],
                timeoutMs,
            );
            steps.push(installed);
            if (!installed.success) {
                const rollback = await restoreAndReconcileDependencyTree(runtime, before, timeoutMs, steps);
                return buildUpgradeFailure('Final dependency installation failed after lock resolution.', steps, {
                    rollbackPerformed: true,
                    rollbackTreeReconciled: rollback.treeReconciled,
                    npmVersion,
                    rollbackNpmVersion: rollback.npmVersion,
                });
            }

            const scriptGate = await reconcileInstallScriptPolicy(runtime, npmVersion, timeoutMs, steps);
            installScriptPolicy = scriptGate;
            if (!scriptGate.success) {
                const rollback = await restoreAndReconcileDependencyTree(runtime, before, timeoutMs, steps);
                return buildUpgradeFailure(scriptGate.error ?? 'Dependency install-script policy gate failed.', steps, {
                    rollbackPerformed: true,
                    rollbackTreeReconciled: rollback.treeReconciled,
                    npmVersion,
                    rollbackNpmVersion: rollback.npmVersion,
                    installScriptPolicy: scriptGate,
                });
            }

            const smokeResult = await runMaintenanceStep(
                runtime,
                'native-smoke',
                process.execPath,
                [NATIVE_SMOKE_SCRIPT],
                {
                    timeoutMs: Math.min(timeoutMs, DEFAULT_TIMEOUT_MS),
                },
            );
            steps.push(smokeResult);
            nativeSmoke = parseJsonObject(smokeResult.stdout);
            if (!smokeResult.success || nativeSmoke?.['success'] !== true) {
                const rollback = await restoreAndReconcileDependencyTree(runtime, before, timeoutMs, steps);
                return buildUpgradeFailure('Native dependency smoke failed after installation.', steps, {
                    rollbackPerformed: true,
                    rollbackTreeReconciled: rollback.treeReconciled,
                    npmVersion,
                    rollbackNpmVersion: rollback.npmVersion,
                    nativeSmoke,
                });
            }
        }

        const afterAudit = await inspectRootDependencyUpdates({
            workspace: runtime.workspace,
            timeoutMs: Math.min(timeoutMs, DEFAULT_TIMEOUT_MS),
        });
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
        const rollback = await restoreAndReconcileDependencyTree(runtime, before, timeoutMs, steps).catch(() => ({
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

/** @param {DependencyMaintenanceRuntime} runtime @returns {Promise<string>} */
async function readDeclaredNpmVersion(runtime) {
    const packageText = (
        await runtime.readTextFresh(path.join(runtime.workspaceRoot, PACKAGE_JSON), { includeHash: false })
    ).content;
    const version = readDeclaredNpmVersionFromPackageText(packageText);
    if (!version)
        throw new Error('package.json must declare an exact npm packageManager version before dependency maintenance.');
    return version;
}

/**
 * @param {DependencyMaintenanceRuntime} runtime
 * @param {string} phase
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeoutMs: number; signal?: AbortSignal | null }} options
 */
async function runMaintenanceStep(runtime, phase, command, args, options) {
    const signal = options.signal === null ? undefined : (options.signal ?? runtime.signal);
    const result = await runFixedCommand(command, args, {
        timeoutMs: options.timeoutMs,
        cwd: runtime.workspaceRoot,
        ...(signal ? { signal } : {}),
    });
    return { ...result, phase };
}

/**
 * Run npm through the version declared by packageManager instead of assuming the container-global npm matches it.
 *
 * @param {DependencyMaintenanceRuntime} runtime
 * @param {string} phase
 * @param {string} npmVersion
 * @param {string[]} npmArgs
 * @param {number} timeoutMs
 * @param {{ signal?: AbortSignal | null }} [options]
 */
function runDeclaredNpmStep(runtime, phase, npmVersion, npmArgs, timeoutMs, options = {}) {
    return runMaintenanceStep(
        runtime,
        phase,
        NCU_COMMAND,
        ['--yes', `--package=npm@${npmVersion}`, 'npm', ...npmArgs],
        {
            timeoutMs,
            ...options,
        },
    );
}

/**
 * @param {DependencyMaintenanceRuntime} runtime
 * @param {{ packageJson: string; packageLock: string }} before
 * @param {number} timeoutMs
 * @param {FixedCommandResult[]} steps
 */
async function restoreAndReconcileDependencyTree(runtime, before, timeoutMs, steps) {
    await restoreRootManifests(runtime, before);
    const npmVersion = readDeclaredNpmVersionFromPackageText(before.packageJson);
    if (!npmVersion) return { treeReconciled: false, npmVersion: null };
    const restoreInstall = await runDeclaredNpmStep(
        runtime,
        'rollback-install',
        npmVersion,
        ['install', '--no-audit', '--no-fund'],
        timeoutMs,
        { signal: null },
    );
    steps.push(restoreInstall);
    if (!restoreInstall.success) return { treeReconciled: false, npmVersion };
    const smoke = await runMaintenanceStep(runtime, 'rollback-native-smoke', process.execPath, [NATIVE_SMOKE_SCRIPT], {
        timeoutMs: Math.min(timeoutMs, DEFAULT_TIMEOUT_MS),
        signal: null,
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
    const trustedPending = uniquePending.filter((name) => TRUSTED_INSTALL_SCRIPT_PACKAGES.includes(name));
    const untrustedPending = uniquePending.filter((name) => !TRUSTED_INSTALL_SCRIPT_PACKAGES.includes(name));
    return {
        pending: uniquePending,
        pendingCount: uniquePending.length,
        trustedPending,
        untrustedPending,
        trustedPackageNames: [...MCP_DEPENDENCY_TRUSTED_INSTALL_SCRIPT_PACKAGES],
    };
}

/**
 * @param {DependencyMaintenanceRuntime} runtime
 * @param {string} npmVersion
 * @param {number} timeoutMs
 * @param {FixedCommandResult[]} steps
 */
async function reconcileInstallScriptPolicy(runtime, npmVersion, timeoutMs, steps) {
    const initialAudit = await runDeclaredNpmStep(
        runtime,
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
            runtime,
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
            runtime,
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

    const stalePolicy = await pruneStaleTrustedAllowScripts(runtime);
    const verifyAudit = await runDeclaredNpmStep(
        runtime,
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
 * @param {DependencyMaintenanceRuntime} runtime
 */
async function pruneStaleTrustedAllowScripts(runtime) {
    const workspaceRoot = runtime.workspaceRoot;
    const packagePath = path.join(workspaceRoot, PACKAGE_JSON);
    const lockPath = path.join(workspaceRoot, PACKAGE_LOCK);
    const packageText = (await runtime.readTextFresh(packagePath, { includeHash: false })).content;
    const parsedPackage = JSON.parse(packageText);
    const allowScripts = parsedPackage.allowScripts;
    if (!allowScripts || typeof allowScripts !== 'object' || Array.isArray(allowScripts)) {
        return { changed: false, removed: [] };
    }
    const lock = JSON.parse((await runtime.readTextFresh(lockPath, { includeHash: false })).content);
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
    await runtime.writeFileAtomic(packagePath, `${JSON.stringify(parsedPackage, null, 2)}\n`, {
        encoding: 'utf8',
        riskClass: 'high',
        advisoryLimits: { domain: 'dependency-maintenance-allow-scripts-prune', file: PACKAGE_JSON },
    });
    return { changed: true, removed: removed.sort() };
}

/** @param {DependencyMaintenanceRuntime} runtime @param {{ packageJson: string; packageLock: string }} snapshot */
async function restoreRootManifests(runtime, snapshot) {
    const workspaceRoot = runtime.workspaceRoot;
    await runtime.writeFileAtomic(path.join(workspaceRoot, PACKAGE_JSON), snapshot.packageJson, {
        encoding: 'utf8',
        riskClass: 'high',
        advisoryLimits: { domain: 'dependency-maintenance-rollback', file: PACKAGE_JSON },
    });
    await runtime.writeFileAtomic(path.join(workspaceRoot, PACKAGE_LOCK), snapshot.packageLock, {
        encoding: 'utf8',
        riskClass: 'high',
        advisoryLimits: { domain: 'dependency-maintenance-rollback', file: PACKAGE_LOCK },
    });
}

/** @param {DependencyMaintenanceRuntime} runtime @returns {Promise<Record<string, string>>} */
async function readRootPackageVersions(runtime) {
    const packageText = (
        await runtime.readTextFresh(path.join(runtime.workspaceRoot, PACKAGE_JSON), { includeHash: false })
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
 * Run one fixed maintenance command and resolve only after the attached child and its stdio have emitted `close`.
 * Caller cancellation and deadline expiry request physical process-tree termination through the shared supervisor.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeoutMs: number; cwd: string; signal?: AbortSignal }} options
 * @returns {Promise<FixedCommandResult>}
 */
export async function runFixedCommand(command, args, options) {
    const startedAt = performance.now();
    const { env } = buildMcpChildEnvironment({
        overrides: {
            NO_COLOR: '1',
            FORCE_COLOR: '0',
            npm_config_audit: 'false',
            npm_config_fund: 'false',
        },
    });
    let child;
    try {
        child = spawn(command, args, {
            cwd: options.cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
        });
    } catch (error) {
        return {
            success: false,
            command,
            args,
            exitCode: null,
            signal: null,
            timedOut: false,
            cancelled: options.signal?.aborted === true,
            durationMs: Math.round(performance.now() - startedAt),
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            outputTruncated: false,
        };
    }

    const supervisor = createAttachedChildProcessSupervisor(child, { processGroup: true });
    let stdout = '';
    let stderr = '';
    let outputTruncated = false;
    /** @type {string | null} */
    let spawnError = null;
    let timedOut = false;
    let cancelled = false;
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
    child.once('error', (error) => {
        spawnError = error instanceof Error ? error.message : String(error);
    });

    /** @param {'timeout' | 'caller'} source */
    const requestTermination = (source) => {
        if (supervisor.snapshot().state === 'closed') return;
        if (source === 'timeout') timedOut = true;
        else cancelled = true;
        supervisor.requestTermination({ initialSignal: 'SIGTERM', forceSignal: 'SIGKILL' });
    };
    const timer = setTimeout(() => requestTermination('timeout'), options.timeoutMs);
    timer.unref();
    const abortSignal = options.signal;
    const onAbort = () => requestTermination('caller');
    if (abortSignal?.aborted) onAbort();
    else abortSignal?.addEventListener('abort', onAbort, { once: true });

    const close = await supervisor.closed;
    clearTimeout(timer);
    abortSignal?.removeEventListener('abort', onAbort);
    if (spawnError) stderr = `${stderr}${stderr ? '\n' : ''}${spawnError}`;
    return {
        success: close.exitCode === 0 && !timedOut && !cancelled && spawnError === null,
        command,
        args,
        exitCode: close.exitCode,
        signal: close.signal,
        timedOut,
        cancelled,
        durationMs: Math.round(performance.now() - startedAt),
        stdout,
        stderr,
        outputTruncated,
    };
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
        cancelled: result.cancelled,
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
