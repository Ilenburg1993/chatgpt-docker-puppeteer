// @ts-check
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {{
 *   runsRoot: string,
 *   maxRuns?: number,
 *   keepRunId?: string,
 * }} options
  * @returns {object}
 */
export function pruneAuditRuns(options) {
    const runsRoot = String(options.runsRoot || '').trim();
    const maxRuns = Math.max(1, Number(options.maxRuns || 30));
    const keepRunId = options.keepRunId ? String(options.keepRunId) : null;

    if (!runsRoot || !fs.existsSync(runsRoot)) {
        return { pruned: [], kept: [] };
    }

    const entries = fs
        .readdirSync(runsRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => {
            const full = path.join(runsRoot, entry.name);
            const stat = fs.statSync(full);
            return {
                run_id: entry.name,
                full_path: full,
                mtime_ms: stat.mtimeMs,
            };
        })
        .sort((a, b) => b.mtime_ms - a.mtime_ms);

    const keep = entries.slice(0, maxRuns).map(item => item.run_id);
    if (keepRunId && !keep.includes(keepRunId)) {
        keep.push(keepRunId);
    }
    const keepSet = new Set(keep);
    const pruned = [];

    for (const item of entries) {
        if (keepSet.has(item.run_id)) {
            continue;
        }
        try {
            fs.rmSync(item.full_path, { recursive: true, force: true });
            pruned.push(item.run_id);
        } catch {
            // ignore retention pruning errors in non-blocking mode
        }
    }

    return {
        pruned,
        kept: Array.from(keepSet),
    };
}
