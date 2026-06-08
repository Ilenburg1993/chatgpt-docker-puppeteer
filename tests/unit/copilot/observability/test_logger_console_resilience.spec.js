// @ts-check

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, vi } from 'vitest';

describe('observability/logger.js — console resilience', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('não lança quando stdout falha com EIO', async () => {
        const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => {
            const error = /** @type {NodeJS.ErrnoException} */ (new Error('write EIO'));
            error.code = 'EIO';
            throw error;
        });

        const { log } = await import('../../../../src/copilot/observability/logger.js');
        log.setLevel('INFO');
        log.setConsoleLevel('INFO');

        assert.doesNotThrow(() => {
            log('INFO', '[test] stdout should not crash runtime');
        });

        assert.ok(write.mock.calls.length >= 1);
    });

    it('não lança quando stderr falha com EPIPE', async () => {
        const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => {
            const error = /** @type {NodeJS.ErrnoException} */ (new Error('broken pipe'));
            error.code = 'EPIPE';
            throw error;
        });

        const { log } = await import('../../../../src/copilot/observability/logger.js');
        log.setLevel('ERROR');
        log.setConsoleLevel('ERROR');

        assert.doesNotThrow(() => {
            log('ERROR', '[test] stderr should not crash runtime');
        });

        assert.ok(write.mock.calls.length >= 1);
    });

    it('redige tokens GitHub/BYOK em log, audit e metric persistidos', async () => {
        const originalLogDir = process.env.COPILOT_LOG_DIR;
        const originalLogLevel = process.env.COPILOT_LOG_LEVEL;
        const logDir = mkdtempSync(join(tmpdir(), 'copilot-logger-redaction-'));
        const githubToken = 'ghs_abcdefghijklmnopqrstuvwxyz1234567890';
        const byokToken = 'sk-testsecret1234567890';

        try {
            process.env.COPILOT_LOG_DIR = logDir;
            process.env.COPILOT_LOG_LEVEL = 'DEBUG';

            const { audit, getRecentLogs, log, metric } = await import('../../../../src/copilot/observability/logger.js');

            log.setConsoleLevel('FATAL');
            log('INFO', `direct gitHubToken=${githubToken} Authorization: Bearer ${byokToken}`, {
                taskId: 'redaction-test',
                extra: { gitHubToken: githubToken },
            });
            log('INFO', { gitHubToken: githubToken, provider: { apiKey: byokToken } });
            audit('sdk.session.create', { gitHubToken: githubToken, headers: { Authorization: `Bearer ${byokToken}` } });
            metric('sdk.session.create', { gitHubToken: githubToken, providerToken: byokToken, tokens: 42 });

            const agentLog = readFileSync(join(logDir, 'agent.log'), 'utf8');
            const auditLog = readFileSync(join(logDir, 'audit.log'), 'utf8');
            const metricsLog = readFileSync(join(logDir, 'metrics.log'), 'utf8');
            const persisted = `${agentLog}\n${auditLog}\n${metricsLog}`;

            assert.equal(persisted.includes(githubToken), false);
            assert.equal(persisted.includes(byokToken), false);
            assert.match(persisted, /\[redacted\]/);
            assert.match(metricsLog, /"tokens":42/);

            const recent = JSON.stringify(getRecentLogs(10));
            assert.equal(recent.includes(githubToken), false);
            assert.equal(recent.includes(byokToken), false);
        } finally {
            if (originalLogDir === undefined) delete process.env.COPILOT_LOG_DIR;
            else process.env.COPILOT_LOG_DIR = originalLogDir;
            if (originalLogLevel === undefined) delete process.env.COPILOT_LOG_LEVEL;
            else process.env.COPILOT_LOG_LEVEL = originalLogLevel;
            rmSync(logDir, { recursive: true, force: true });
        }
    });
});
