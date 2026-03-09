// @ts-check
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} PublishJsonOptions
 * @property {string} outputDir
 * @property {string} runDir
 */
/**
 * @param {import('./lib/schema.mjs').AuditRunV3} report
 * @param {PublishJsonOptions} options
 * @returns {{ path: string; runReportPath: string }}
 */
export function publishJson(report, options) {
    fs.mkdirSync(options.outputDir, { recursive: true });

    const safeRunId = String(report.run_id).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(options.outputDir, `audit_report_${safeRunId}.json`);
    fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const schemaToken = String(report.schema_version || '3.0').replace(/\./g, '_');
    const runReportPath = options.runDir ? path.join(options.runDir, `audit_report_v${schemaToken}.json`) : filePath;
    if (options.runDir) {
        fs.mkdirSync(options.runDir, { recursive: true });
        fs.writeFileSync(runReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }

    return { path: filePath, runReportPath };
}
