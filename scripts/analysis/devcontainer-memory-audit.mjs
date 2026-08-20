#!/usr/bin/env node
// @ts-check
/**
 * Auditor de memória do DevContainer/WSL orientado a comparação arquitetural.
 *
 * Diferencia memória anônima de file-backed/page cache e usa PSS por processo quando o kernel permite ler
 * `/proc/<pid>/smaps_rollup`. O objetivo é evitar diagnósticos baseados apenas em RSS ou no agregado mostrado pelo
 * host.
 *
 * Uso: node scripts/analysis/devcontainer-memory-audit.mjs node scripts/analysis/devcontainer-memory-audit.mjs --json
 * node scripts/analysis/devcontainer-memory-audit.mjs --json --output /tmp/memory-baseline.json node
 * scripts/analysis/devcontainer-memory-audit.mjs --top 30
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

/**
 * @typedef {{
 *     pid: number;
 *     ppid: number | null;
 *     uid: number | null;
 *     name: string;
 *     command: string;
 *     cwd: string | null;
 *     group: string;
 *     rssBytes: number;
 *     pssBytes: number;
 *     pssAnonBytes: number;
 *     pssFileBytes: number;
 *     pssShmemBytes: number;
 *     privateBytes: number;
 *     swapBytes: number;
 *     hasSmapsRollup: boolean;
 * }} ProcessMemoryRow
 */

/** @param {string} file */
function readText(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return null;
    }
}

/** @param {string} file */
function readInteger(file) {
    const value = readText(file)?.trim();
    if (!value || value === 'max') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** @param {string} text */
function parseColonKiB(text) {
    /** @type {Record<string, number>} */
    const values = {};
    for (const line of text.split(/\r?\n/u)) {
        const match = line.match(/^([^:]+):\s+(\d+)\s+kB$/u);
        const key = match?.[1];
        const rawValue = match?.[2];
        if (key && rawValue) values[key] = Number(rawValue) * KIB;
    }
    return values;
}

/** @param {string} text */
function parseSpaceNumbers(text) {
    /** @type {Record<string, number>} */
    const values = {};
    for (const line of text.split(/\r?\n/u)) {
        const match = line.trim().match(/^(\S+)\s+(\d+)$/u);
        const key = match?.[1];
        const rawValue = match?.[2];
        if (key && rawValue) values[key] = Number(rawValue);
    }
    return values;
}

/** @param {string} text */
function parsePsi(text) {
    /** @type {Record<string, Record<string, number>>} */
    const result = {};
    for (const line of text.split(/\r?\n/u)) {
        const parts = line.trim().split(/\s+/u).filter(Boolean);
        const kind = parts.shift();
        if (!kind) continue;
        /** @type {Record<string, number>} */
        const metrics = {};
        for (const part of parts) {
            const [key, raw] = part.split('=');
            const value = Number(raw);
            if (key && Number.isFinite(value)) metrics[key] = value;
        }
        result[kind] = metrics;
    }
    return result;
}

function resolveCgroupDirectory() {
    const base = '/sys/fs/cgroup';
    const selfCgroup = readText('/proc/self/cgroup');
    const unified = selfCgroup
        ?.split(/\r?\n/u)
        .map((line) => line.match(/^0::(.*)$/u)?.[1])
        .find((value) => typeof value === 'string');
    const relative = unified && unified !== '/' ? unified.replace(/^\/+/, '') : '';
    const candidate = relative ? path.join(base, relative) : base;
    if (fs.existsSync(path.join(candidate, 'memory.current'))) return candidate;
    if (fs.existsSync(path.join(base, 'memory.current'))) return base;
    return null;
}

function readCgroupMemory() {
    const directory = resolveCgroupDirectory();
    if (!directory) return null;
    const stat = parseSpaceNumbers(readText(path.join(directory, 'memory.stat')) ?? '');
    const events = parseSpaceNumbers(readText(path.join(directory, 'memory.events')) ?? '');
    return {
        directory,
        currentBytes: readInteger(path.join(directory, 'memory.current')),
        peakBytes: readInteger(path.join(directory, 'memory.peak')),
        swapCurrentBytes: readInteger(path.join(directory, 'memory.swap.current')),
        anonBytes: stat['anon'] ?? null,
        fileBytes: stat['file'] ?? null,
        kernelBytes: stat['kernel'] ?? null,
        slabBytes: stat['slab'] ?? null,
        inactiveFileBytes: stat['inactive_file'] ?? null,
        activeFileBytes: stat['active_file'] ?? null,
        events,
        pressure: parsePsi(readText(path.join(directory, 'memory.pressure')) ?? ''),
    };
}

/** @param {string} statusText */
function parseStatus(statusText) {
    const ppid = Number(statusText.match(/^PPid:\s+(\d+)/mu)?.[1]);
    const uid = Number(statusText.match(/^Uid:\s+(\d+)/mu)?.[1]);
    const rssKiB = Number(statusText.match(/^VmRSS:\s+(\d+)\s+kB/mu)?.[1]);
    return {
        ppid: Number.isFinite(ppid) ? ppid : null,
        uid: Number.isFinite(uid) ? uid : null,
        rssBytes: Number.isFinite(rssKiB) ? rssKiB * KIB : 0,
    };
}

/** @param {number} pid */
function readProcessCwd(pid) {
    try {
        return fs.readlinkSync(`/proc/${pid}/cwd`);
    } catch {
        return null;
    }
}

/** @param {string} command @param {string} name @param {string | null} cwd */
export function classifyProcess(command, name, cwd) {
    const haystack = `${name} ${command} ${cwd ?? ''}`.toLowerCase();
    if (haystack.includes('cloudcode_cli') || haystack.includes('geminicodeassist')) return 'agent:gemini';
    if (haystack.includes('kilocode') || /(?:^|\s|\/)kilo(?:\s|$)/u.test(haystack)) return 'agent:kilo';
    if (haystack.includes('claude-code') || haystack.includes('/.claude/') || /(?:^|\/)claude(?:\s|$)/u.test(haystack))
        return 'agent:claude';
    if (haystack.includes('coderabbit')) return 'agent:coderabbit';
    if (haystack.includes('huggingface')) return 'agent:huggingface';
    if (haystack.includes('opencode')) return 'agent:opencode';
    if (haystack.includes('codex') || haystack.includes('openai.chatgpt')) return 'agent:openai-codex';
    if (
        (haystack.includes('typescriptteam.native-preview') ||
            haystack.includes('/tsgo') ||
            haystack.includes('/tsc')) &&
        haystack.includes('--lsp')
    )
        return 'typescript:tsgo-lsp';
    if (haystack.includes('--type=extensionhost') || haystack.includes('extensionhost')) return 'vscode:extension-host';
    if (haystack.includes('.vscode-server') || haystack.includes('/vscode/vscode-server/'))
        return 'vscode:infrastructure';
    if (haystack.includes('cloudflared')) return 'network:cloudflared';
    if (haystack.includes('chromium') || haystack.includes('chrome')) return 'browser:chromium';
    if (haystack.includes('chatgpt-docker-puppeteer') || haystack.includes('src/copilot/mcp'))
        return 'workspace:node-mcp';
    if (haystack.includes('redis-server')) return 'infra:redis';
    return 'other';
}

/** @param {number} pid */
function readProcess(pid) {
    const procDir = `/proc/${pid}`;
    const statusText = readText(path.join(procDir, 'status'));
    if (!statusText) return null;
    const status = parseStatus(statusText);
    const name = readText(path.join(procDir, 'comm'))?.trim() ?? '';
    const command = (readText(path.join(procDir, 'cmdline')) ?? '').replace(/\0/gu, ' ').trim() || name;
    const cwd = readProcessCwd(pid);
    const rollupText = readText(path.join(procDir, 'smaps_rollup'));
    const rollup = rollupText ? parseColonKiB(rollupText) : {};
    const privateBytes =
        (rollup['Private_Clean'] ?? 0) + (rollup['Private_Dirty'] ?? 0) + (rollup['Private_Hugetlb'] ?? 0);
    /** @type {ProcessMemoryRow} */
    const row = {
        pid,
        ppid: status.ppid,
        uid: status.uid,
        name,
        command,
        cwd,
        group: classifyProcess(command, name, cwd),
        rssBytes: rollup['Rss'] ?? status.rssBytes,
        pssBytes: rollup['Pss'] ?? status.rssBytes,
        pssAnonBytes: rollup['Pss_Anon'] ?? 0,
        pssFileBytes: rollup['Pss_File'] ?? 0,
        pssShmemBytes: rollup['Pss_Shmem'] ?? 0,
        privateBytes,
        swapBytes: rollup['Swap'] ?? 0,
        hasSmapsRollup: Boolean(rollupText),
    };
    return row;
}

function collectProcesses() {
    /** @type {ProcessMemoryRow[]} */
    const rows = [];
    for (const entry of fs.readdirSync('/proc', { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
        const row = readProcess(Number(entry.name));
        if (row) rows.push(row);
    }
    return rows.sort((left, right) => right.pssBytes - left.pssBytes || right.rssBytes - left.rssBytes);
}

/** @param {ProcessMemoryRow[]} processes */
function summarizeGroups(processes) {
    /**
     * @type {Record<
     *     string,
     *     {
     *         processes: number;
     *         rssBytes: number;
     *         pssBytes: number;
     *         pssAnonBytes: number;
     *         pssFileBytes: number;
     *         privateBytes: number;
     *         swapBytes: number;
     *     }
     * >}
     */
    const groups = {};
    for (const row of processes) {
        const group = (groups[row.group] ??= {
            processes: 0,
            rssBytes: 0,
            pssBytes: 0,
            pssAnonBytes: 0,
            pssFileBytes: 0,
            privateBytes: 0,
            swapBytes: 0,
        });
        group.processes += 1;
        group.rssBytes += row.rssBytes;
        group.pssBytes += row.pssBytes;
        group.pssAnonBytes += row.pssAnonBytes;
        group.pssFileBytes += row.pssFileBytes;
        group.privateBytes += row.privateBytes;
        group.swapBytes += row.swapBytes;
    }
    return Object.entries(groups)
        .map(([group, values]) => ({ group, ...values }))
        .sort((left, right) => right.pssBytes - left.pssBytes);
}

function collectSnapshot() {
    const meminfo = parseColonKiB(readText('/proc/meminfo') ?? '');
    const processes = collectProcesses();
    return {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        hostname: readText('/etc/hostname')?.trim() ?? null,
        nodeVersion: process.version,
        system: {
            memTotalBytes: meminfo['MemTotal'] ?? null,
            memAvailableBytes: meminfo['MemAvailable'] ?? null,
            memFreeBytes: meminfo['MemFree'] ?? null,
            cachedBytes: meminfo['Cached'] ?? null,
            swapTotalBytes: meminfo['SwapTotal'] ?? null,
            swapFreeBytes: meminfo['SwapFree'] ?? null,
            pressure: parsePsi(readText('/proc/pressure/memory') ?? ''),
        },
        cgroup: readCgroupMemory(),
        groups: summarizeGroups(processes),
        processes,
    };
}

/** @param {number | null | undefined} bytes */
function humanBytes(bytes) {
    if (bytes == null || !Number.isFinite(bytes)) return '-';
    if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} GiB`;
    return `${(bytes / MIB).toFixed(1)} MiB`;
}

/** @param {string} value @param {number} width */
function pad(value, width) {
    return value.length >= width ? value : value.padEnd(width);
}

/** @param {ReturnType<typeof collectSnapshot>} snapshot @param {number} top */
function printHuman(snapshot, top) {
    console.log('DevContainer memory audit');
    console.log(`captured=${snapshot.capturedAt} node=${snapshot.nodeVersion}`);
    console.log(
        `system: total=${humanBytes(snapshot.system.memTotalBytes)} available=${humanBytes(snapshot.system.memAvailableBytes)} cache=${humanBytes(snapshot.system.cachedBytes)} swap-used=${humanBytes((snapshot.system.swapTotalBytes ?? 0) - (snapshot.system.swapFreeBytes ?? 0))}`,
    );
    if (snapshot.cgroup) {
        console.log(
            `cgroup: current=${humanBytes(snapshot.cgroup.currentBytes)} peak=${humanBytes(snapshot.cgroup.peakBytes)} anon=${humanBytes(snapshot.cgroup.anonBytes)} file=${humanBytes(snapshot.cgroup.fileBytes)} swap=${humanBytes(snapshot.cgroup.swapCurrentBytes)}`,
        );
        const events = snapshot.cgroup.events;
        console.log(
            `cgroup events: oom=${events['oom'] ?? 0} oom_kill=${events['oom_kill'] ?? 0} high=${events['high'] ?? 0} max=${events['max'] ?? 0}`,
        );
    }

    console.log('\nGroups by PSS');
    console.log(
        `${pad('GROUP', 24)} ${pad('PROC', 5)} ${pad('PSS', 11)} ${pad('ANON', 11)} ${pad('FILE', 11)} ${pad('RSS', 11)} PRIVATE`,
    );
    for (const row of snapshot.groups) {
        console.log(
            `${pad(row.group, 24)} ${pad(String(row.processes), 5)} ${pad(humanBytes(row.pssBytes), 11)} ${pad(humanBytes(row.pssAnonBytes), 11)} ${pad(humanBytes(row.pssFileBytes), 11)} ${pad(humanBytes(row.rssBytes), 11)} ${humanBytes(row.privateBytes)}`,
        );
    }

    console.log(`\nTop ${Math.min(top, snapshot.processes.length)} processes by PSS`);
    console.log(`${pad('PID', 7)} ${pad('GROUP', 24)} ${pad('PSS', 11)} ${pad('ANON', 11)} ${pad('FILE', 11)} COMMAND`);
    for (const row of snapshot.processes.slice(0, top)) {
        const command = row.command.length > 100 ? `${row.command.slice(0, 97)}...` : row.command;
        console.log(
            `${pad(String(row.pid), 7)} ${pad(row.group, 24)} ${pad(humanBytes(row.pssBytes), 11)} ${pad(humanBytes(row.pssAnonBytes), 11)} ${pad(humanBytes(row.pssFileBytes), 11)} ${command}`,
        );
    }

    const smapsCount = snapshot.processes.filter((row) => row.hasSmapsRollup).length;
    console.log(`\nsmaps_rollup readable: ${smapsCount}/${snapshot.processes.length} processes.`);
    console.log(
        'Interpretation: compare PSS/anon for resident cost; cgroup file/cache is substantially reclaimable and must not be treated as a leak by itself.',
    );
}

/** @param {string[]} args */
function parseArgs(args) {
    let json = false;
    let top = 20;
    let output = null;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--json') json = true;
        else if (arg === '--top') {
            const parsed = Number(args[index + 1]);
            if (Number.isInteger(parsed) && parsed > 0 && parsed <= 500) top = parsed;
            index += 1;
        } else if (arg === '--output') {
            output = args[index + 1] ?? null;
            index += 1;
        }
    }
    return { json, top, output };
}

const directRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (directRun) {
    const options = parseArgs(process.argv.slice(2));
    const snapshot = collectSnapshot();
    const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
    if (options.output) {
        const destination = path.resolve(options.output);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, serialized, 'utf8');
    }
    if (options.json) process.stdout.write(serialized);
    else printHuman(snapshot, options.top);
}

export { collectSnapshot, humanBytes, parsePsi };
