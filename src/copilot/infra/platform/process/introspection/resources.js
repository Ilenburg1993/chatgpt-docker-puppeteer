// @ts-check
/**
 * Process/container resource introspection without workspace filesystem authority.
 *
 * Linux cgroup v2 pseudo-files are fixed implementation details of this capability. No caller-controlled path enters
 * the reader, reads are bounded and final symlinks are rejected. On non-Linux or hosts without cgroup v2 the cgroup
 * projection is null-valued while portable Node OS/process metrics remain available.
 *
 * @module copilot/infra/platform/process/introspection/resources
 */

import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { availableParallelism, freemem, loadavg, totalmem } from 'node:os';

const CGROUP_V2_MEMORY_CURRENT = '/sys/fs/cgroup/memory.current';
const CGROUP_V2_MEMORY_MAX = '/sys/fs/cgroup/memory.max';
const CGROUP_V2_MEMORY_EVENTS = '/sys/fs/cgroup/memory.events';
const MAX_CGROUP_TEXT_BYTES = 16 * 1024;
const CGROUP_MEMORY_EVENT_KEYS = Object.freeze(['low', 'high', 'max', 'oom', 'oom_kill', 'oom_group_kill']);

/**
 * @typedef {Readonly<{
 *   observedAt:string;
 *   processRssBytes:number;
 *   systemFreeBytes:number;
 *   systemTotalBytes:number;
 *   systemFreeRatio:number|null;
 *   loadAverage:readonly [number,number,number];
 *   availableParallelism:number;
 *   cgroup:Readonly<{
 *     memoryCurrentBytes:number|null;
 *     memoryMaxBytes:number|null;
 *     memoryUsageRatio:number|null;
 *     events:Readonly<Record<string,number>>|null;
 *   }>;
 * }>} ProcessResourceSnapshot
 */

/** @param {string} text */
export function parseCgroupMemoryEvents(text) {
    /** @type {Record<string, number>} */
    const events = {};
    for (const line of String(text ?? '').split(/\r?\n/u)) {
        const [key, rawValue, ...rest] = line.trim().split(/\s+/u);
        if (!key || rawValue === undefined || rest.length > 0 || !CGROUP_MEMORY_EVENT_KEYS.includes(key)) continue;
        const value = Number(rawValue);
        if (Number.isSafeInteger(value) && value >= 0) events[key] = value;
    }
    return Object.freeze(events);
}

/** @param {string} text */
export function parseCgroupMemoryLimit(text) {
    const normalized = String(text ?? '').trim();
    if (!normalized || normalized === 'max') return null;
    const value = Number(normalized);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** @param {string} filePath */
async function readOptionalBoundedSpecialText(filePath) {
    if (process.platform !== 'linux') return null;
    let handle;
    try {
        handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        const bytes = Buffer.allocUnsafe(MAX_CGROUP_TEXT_BYTES + 1);
        let offset = 0;
        while (offset < bytes.byteLength) {
            const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, null);
            if (bytesRead === 0) break;
            offset += bytesRead;
        }
        if (offset > MAX_CGROUP_TEXT_BYTES) return null;
        return bytes.subarray(0, offset).toString('utf8');
    } catch {
        return null;
    } finally {
        await handle?.close().catch(() => undefined);
    }
}

/** @param {number} value */
function roundResourceRatio(value) {
    return Math.round(value * 1_000_000) / 1_000_000;
}

/** @returns {Promise<ProcessResourceSnapshot>} */
export async function readProcessResourceSnapshot() {
    const [currentText, maxText, eventsText] = await Promise.all([
        readOptionalBoundedSpecialText(CGROUP_V2_MEMORY_CURRENT),
        readOptionalBoundedSpecialText(CGROUP_V2_MEMORY_MAX),
        readOptionalBoundedSpecialText(CGROUP_V2_MEMORY_EVENTS),
    ]);
    const memoryCurrentBytes = currentText === null ? null : parseCgroupMemoryLimit(currentText);
    const memoryMaxBytes = maxText === null ? null : parseCgroupMemoryLimit(maxText);
    const systemTotalBytes = totalmem();
    const systemFreeBytes = freemem();
    const systemFreeRatio = systemTotalBytes > 0 ? roundResourceRatio(systemFreeBytes / systemTotalBytes) : null;
    const memoryUsageRatio =
        memoryCurrentBytes !== null && memoryMaxBytes !== null && memoryMaxBytes > 0
            ? roundResourceRatio(memoryCurrentBytes / memoryMaxBytes)
            : null;
    const loads = loadavg();
    return Object.freeze({
        observedAt: new Date().toISOString(),
        processRssBytes: process.memoryUsage().rss,
        systemFreeBytes,
        systemTotalBytes,
        systemFreeRatio,
        loadAverage: Object.freeze(
            /** @type {[number,number,number]} */ ([loads[0] ?? 0, loads[1] ?? 0, loads[2] ?? 0]),
        ),
        availableParallelism: availableParallelism(),
        cgroup: Object.freeze({
            memoryCurrentBytes,
            memoryMaxBytes,
            memoryUsageRatio,
            events: eventsText === null ? null : parseCgroupMemoryEvents(eventsText),
        }),
    });
}
