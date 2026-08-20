#!/usr/bin/env node
// @ts-check
/**
 * Runtime audit for the active VS Code TypeScript 7 native LSP session.
 *
 * This intentionally complements — never replaces — CLI typecheck. CLI creates a fresh project snapshot; the editor
 * keeps a long-lived incremental LSP session whose watcher registrations, activation-time options and memory state can
 * diverge. The audit makes that divergence observable without requiring a DevContainer rebuild.
 *
 * Usage: node scripts/analysis/typescript-lsp-health.mjs node scripts/analysis/typescript-lsp-health.mjs --json node
 * scripts/analysis/typescript-lsp-health.mjs --verify-cli
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { globSync } from 'glob';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DEFAULT_PROJECT = path.join(ROOT, 'src', 'copilot', 'tsconfig.json');
const VSCODE_LOG_ROOT = path.join('/home/node', '.vscode-server', 'data', 'logs');
const CANONICAL_TS7_PACKAGE = path.join(ROOT, 'node_modules', '@typescript', 'native', 'package.json');

/** @param {string} file */
function readText(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return null;
    }
}

/** @param {string} file */
function readNullSeparated(file) {
    return (readText(file) ?? '')
        .split('\0')
        .map((value) => value.trim())
        .filter(Boolean);
}

/** @param {string} text @param {string} key */
function parseStatusKiB(text, key) {
    const match = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, 'mu'));
    return match?.[1] ? Number(match[1]) * 1024 : null;
}

/** @param {string} text */
function parseSmapsRollup(text) {
    return {
        pssBytes: parseStatusKiB(text, 'Pss'),
        pssAnonBytes: parseStatusKiB(text, 'Pss_Anon'),
        pssFileBytes: parseStatusKiB(text, 'Pss_File'),
        swapBytes: parseStatusKiB(text, 'Swap'),
    };
}

/** @param {string} cmdline */
export function isNativeTs7LspCommand(cmdline) {
    const normalized = cmdline.toLowerCase();
    return normalized.includes('--lsp') && /(?:^|[/\s])(?:tsc|tsgo)(?:\s|$)/u.test(normalized);
}

/** @param {string} cmdline */
function extensionVersionFromCommand(cmdline) {
    return /typescriptteam\.native-preview-([\d.]+)-[^/\s]+/iu.exec(cmdline)?.[1] ?? null;
}

function collectNativeTs7Processes() {
    /**
     * @type {{
     *     pid: number;
     *     ppid: number | null;
     *     command: string;
     *     executable: string | null;
     *     extensionVersion: string | null;
     *     rssBytes: number | null;
     *     pssBytes: number | null;
     *     pssAnonBytes: number | null;
     *     pssFileBytes: number | null;
     *     swapBytes: number | null;
     *     goMemLimit: string | null;
     * }[]}
     */
    const rows = [];
    let entries;
    try {
        entries = fs.readdirSync('/proc', { withFileTypes: true });
    } catch {
        return rows;
    }
    for (const entry of entries) {
        if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
        const pid = Number(entry.name);
        const commandParts = readNullSeparated(`/proc/${pid}/cmdline`);
        const cmdline = commandParts.join(' ');
        if (!isNativeTs7LspCommand(cmdline)) continue;
        const status = readText(`/proc/${pid}/status`) ?? '';
        const smaps = parseSmapsRollup(readText(`/proc/${pid}/smaps_rollup`) ?? '');
        const environ = readNullSeparated(`/proc/${pid}/environ`);
        const goMemLimit =
            environ.find((value) => value.startsWith('GOMEMLIMIT='))?.slice('GOMEMLIMIT='.length) ?? null;
        const ppid = Number(status.match(/^PPid:\s+(\d+)/mu)?.[1]);
        rows.push({
            pid,
            ppid: Number.isFinite(ppid) ? ppid : null,
            command: cmdline,
            executable: commandParts[0] ?? null,
            extensionVersion: extensionVersionFromCommand(cmdline),
            rssBytes: parseStatusKiB(status, 'VmRSS'),
            ...smaps,
            goMemLimit,
        });
    }
    return rows.sort((left, right) => left.pid - right.pid);
}

function latestTypeScriptLog() {
    if (!fs.existsSync(VSCODE_LOG_ROOT)) return null;
    const logs = globSync('**/TypeScript 7.log', {
        cwd: VSCODE_LOG_ROOT,
        absolute: true,
        nodir: true,
    });
    return (
        logs
            .map((file) => {
                try {
                    return { file, mtimeMs: fs.statSync(file).mtimeMs };
                } catch {
                    return null;
                }
            })
            .filter((entry) => entry !== null)
            .sort((left, right) => right.mtimeMs - left.mtimeMs)[0] ?? null
    );
}

/** @param {string} text */
export function parseNativeTs7Log(text) {
    const lines = text.split(/\r?\n/u);
    let sessionStartIndex = 0;
    for (let index = 0; index < lines.length; index += 1) {
        if (/Starting language server|Restarting TypeScript language server/iu.test(lines[index] ?? '')) {
            sessionStartIndex = index;
        }
    }
    const sessionLines = lines.slice(sessionStartIndex);
    const watcherErrors = sessionLines.filter((line) => line.includes('errors updating watches:'));
    const allWatcherErrors = lines.filter((line) => line.includes('errors updating watches:'));
    const projectCandidates = sessionLines.flatMap((line) => {
        const direct = /Project '([^']+)'/u.exec(line)?.[1];
        if (direct) return [direct];
        const configured = /Found default configured project for .*?: (.+?)(?: \(in |$)/u.exec(line)?.[1];
        return configured ? [configured] : [];
    });
    const resolvedExecutables = sessionLines
        .map((line) => /Resolved to (.+)$/u.exec(line)?.[1] ?? null)
        .filter((value) => value !== null);
    const configuredLimits = sessionLines
        .map((line) => /Setting GOMEMLIMIT=(\S+)/u.exec(line)?.[1] ?? null)
        .filter((value) => value !== null);
    return {
        lineCount: lines.length,
        sessionStartLine: sessionStartIndex + 1,
        sessionStartText: lines[sessionStartIndex] ?? null,
        watcherErrorsSinceSessionStart: watcherErrors.length,
        watcherErrorsTotal: allWatcherErrors.length,
        recentWatcherErrors: watcherErrors.slice(-20),
        activeProject: projectCandidates.at(-1) ?? null,
        resolvedExecutable: resolvedExecutables.at(-1) ?? null,
        configuredGoMemLimit: configuredLimits.at(-1) ?? null,
    };
}

function expectedWorkspaceGoMemLimit() {
    const settings = readText(path.join(ROOT, '.vscode', 'settings.json')) ?? '';
    return /"js\/ts\.server\.goMemLimit"\s*:\s*"([^"]+)"/u.exec(settings)?.[1] ?? null;
}

function canonicalTs7Version() {
    try {
        const parsed = JSON.parse(readText(CANONICAL_TS7_PACKAGE) ?? 'null');
        return parsed && typeof parsed === 'object' && typeof parsed.version === 'string' ? parsed.version : null;
    } catch {
        return null;
    }
}

/** @param {string | null} executable */
function nativeServerVersion(executable) {
    if (!executable || !path.isAbsolute(executable)) return null;
    const result = spawnSync(executable, ['--version'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 5_000,
        maxBuffer: 256 * 1024,
    });
    if (result.status !== 0) return null;
    return /(?:Version\s+)?(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/u.exec(String(result.stdout ?? '').trim())?.[1] ?? null;
}

/** @param {string} project */
function verifyCliProject(project) {
    const relative = path.relative(ROOT, project) || project;
    const startedAt = performance.now();
    const result = spawnSync('npm', ['run', '-s', 'tsc7', '--', '-p', relative, '--pretty', 'false'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
    });
    return {
        project: relative.replace(/\\/gu, '/'),
        exitCode: result.status,
        signal: result.signal,
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
        stdout: String(result.stdout ?? '').trim(),
        stderr: String(result.stderr ?? '').trim(),
        ok: result.status === 0,
    };
}

/** @param {number | null} bytes */
function formatMiB(bytes) {
    return bytes === null ? 'n/a' : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/** @param {boolean} verifyCli */
function collectReport(verifyCli) {
    const processes = collectNativeTs7Processes();
    const logEntry = latestTypeScriptLog();
    const log = logEntry ? parseNativeTs7Log(readText(logEntry.file) ?? '') : null;
    const expectedGoMemLimit = expectedWorkspaceGoMemLimit();
    const canonicalVersion = canonicalTs7Version();
    const primary = processes[0] ?? null;
    const serverVersion = nativeServerVersion(primary?.executable ?? null);
    const versionMatchesCanonical =
        canonicalVersion !== null && serverVersion !== null && canonicalVersion === serverVersion;
    const project = log?.activeProject && path.isAbsolute(log.activeProject) ? log.activeProject : DEFAULT_PROJECT;
    const cli = verifyCli ? verifyCliProject(project) : null;
    const issues = [];
    if (processes.length === 0) issues.push('native-ts7-lsp-not-running');
    if (processes.length > 1) issues.push(`multiple-native-ts7-lsp-processes:${processes.length}`);
    if (primary && expectedGoMemLimit && primary.goMemLimit !== expectedGoMemLimit) {
        issues.push(`gomemlimit-mismatch:expected=${expectedGoMemLimit}:actual=${primary.goMemLimit ?? 'absent'}`);
    }
    if (primary && canonicalVersion === null) issues.push('canonical-ts7-version-unavailable');
    if (primary && serverVersion === null) issues.push('native-lsp-server-version-unavailable');
    if (primary && canonicalVersion !== null && serverVersion !== null && !versionMatchesCanonical) {
        issues.push(`native-lsp-version-mismatch:workspace=${canonicalVersion}:server=${serverVersion}`);
    }
    if ((log?.watcherErrorsSinceSessionStart ?? 0) > 0) {
        issues.push(`watcher-errors-current-session:${log?.watcherErrorsSinceSessionStart}`);
    }
    if (cli && !cli.ok) issues.push(`cli-project-typecheck-failed:${cli.exitCode ?? 'no-exit-code'}`);
    return {
        schemaVersion: '1.0.0',
        capturedAt: new Date().toISOString(),
        expectedGoMemLimit,
        canonicalVersion,
        serverVersion,
        versionMatchesCanonical,
        processes,
        log: logEntry
            ? {
                  file: logEntry.file,
                  mtimeMs: logEntry.mtimeMs,
                  ...log,
              }
            : null,
        cli,
        issues,
        ok: issues.length === 0,
    };
}

/** @param {ReturnType<typeof collectReport>} report */
function printHuman(report) {
    console.log(`TypeScript 7 LSP health — ${report.ok ? 'OK' : 'ATTENTION'}`);
    const primary = report.processes[0];
    if (primary) {
        console.log(`- pid: ${primary.pid} (VS Code client ${primary.extensionVersion ?? 'bundled/unknown'})`);
        console.log(
            `- TS7 server/workspace: ${report.serverVersion ?? 'unknown'} / ${report.canonicalVersion ?? 'unknown'}${report.versionMatchesCanonical ? ' (match)' : ''}`,
        );
        console.log(`- RSS/PSS: ${formatMiB(primary.rssBytes)} / ${formatMiB(primary.pssBytes)}`);
        console.log(
            `- GOMEMLIMIT: ${primary.goMemLimit ?? 'absent'} (expected ${report.expectedGoMemLimit ?? 'unspecified'})`,
        );
    } else {
        console.log('- native TS7 LSP process: not found');
    }
    if (report.log) {
        console.log(`- project: ${report.log.activeProject ?? 'not observed in current session log'}`);
        console.log(
            `- watcher failures: current=${report.log.watcherErrorsSinceSessionStart}, total-log=${report.log.watcherErrorsTotal}`,
        );
    } else {
        console.log('- TypeScript 7 log: not found');
    }
    if (report.cli)
        console.log(`- exact project CLI: ${report.cli.ok ? 'OK' : 'FAILED'} (${report.cli.durationMs} ms)`);
    if (report.issues.length > 0) {
        console.log('- issues:');
        for (const issue of report.issues) console.log(`  - ${issue}`);
    }
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
    const { values } = parseArgs({
        options: {
            json: { type: 'boolean', default: false },
            'verify-cli': { type: 'boolean', default: false },
            strict: { type: 'boolean', default: false },
        },
    });
    const report = collectReport(Boolean(values['verify-cli']));
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else printHuman(report);
    if (values.strict && !report.ok) process.exitCode = 1;
}
