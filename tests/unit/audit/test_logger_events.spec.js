// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AUDIT_EVENT_TYPES } from '../../../scripts/audit/lib/event_types.mjs';
import { createAuditLogger } from '../../../scripts/audit/lib/logger.mjs';

test('audit logger emits monotonic seq and validates payload shape', () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-logger-'));
    const logger = /** @type {any} */ (
        createAuditLogger(
            /** @type {any} */ ({
                runId: 'RUN_TEST',
                runDir,
                logFormat: 'jsonl',
                enableConsole: false,
            }),
        )
    );

    logger.emit({
        event_type: AUDIT_EVENT_TYPES.RUN_STARTED,
        status: 'running',
        message: 'start',
    });
    logger.emit({
        event_type: AUDIT_EVENT_TYPES.STEP_STARTED,
        // missing phase/step_id to force validation warning
        status: 'running',
        message: 'bad payload',
    });

    const eventsPath = path.join(runDir, 'events.jsonl');
    const lines = fs
        .readFileSync(eventsPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].seq, 1);
    assert.equal(lines[1].seq, 2);
    assert.equal(lines[1].event_schema_version, '1.1');
    assert.ok(Array.isArray(lines[1].validation_errors));
    assert.ok(lines[1].validation_errors.length > 0);
});
