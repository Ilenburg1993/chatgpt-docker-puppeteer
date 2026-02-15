import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {Date} date
 */
function formatSnapshotStamp(date) {
    const y = String(date.getFullYear());
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}_${hh}-${mm}`;
}

/**
 * @param {{ masterPath: string, snapshotsDir: string, report?: import('./lib/schema.mjs').AuditRunV3, now?: Date }} options
 * @returns {{ path: string }}
 */
export function publishSnapshot(options) {
    const now = options.now || new Date();
    const stamp = formatSnapshotStamp(now);
    const fileName = `BUG_AUDIT_${stamp}.md`;

    fs.mkdirSync(options.snapshotsDir, { recursive: true });
    const snapshotPath = path.join(options.snapshotsDir, fileName);

    const content = fs.readFileSync(options.masterPath, 'utf8');

    const header = options.report
        ? [
            '<!-- SNAPSHOT_METADATA_START -->',
            `- schema_version: ${options.report.schema_version}`,
            `- run_id: ${options.report.run_id}`,
            `- focus_mode: ${options.report.focus_mode}`,
            `- partial: ${options.report.summary.partial}`,
            `- eta_final_ms: ${options.report.eta.eta_ms}`,
            `- generated_at: ${now.toISOString()}`,
            '<!-- SNAPSHOT_METADATA_END -->',
            '',
        ].join('\n')
        : '';

    fs.writeFileSync(snapshotPath, `${header}${content}`, 'utf8');

    return { path: snapshotPath };
}
