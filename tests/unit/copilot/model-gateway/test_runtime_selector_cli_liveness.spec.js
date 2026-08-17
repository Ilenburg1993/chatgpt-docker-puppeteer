// @ts-check

import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const RUNTIME_SELECTOR = 'scripts/model-gateway/commands/model-gateway-runtime-selector.mjs';

function runRuntimeSelectorDry() {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        execFile(
            process.execPath,
            [
                RUNTIME_SELECTOR,
                '--json',
                '--profile=repo_agent',
                '--runtime-source=file',
                '--selection-policy=metadata_first',
                '--preferred-probes=chat,agent',
                '--block-failed-probes=chat,agent',
            ],
            { cwd: process.cwd(), timeout: 8_000, maxBuffer: 16 * 1024 * 1024 },
            (error, stdout, stderr) => {
                const elapsedMs = Date.now() - startedAt;
                if (error) {
                    reject(Object.assign(error, { stdout, stderr, elapsedMs }));
                    return;
                }
                resolve({ stdout, stderr, elapsedMs });
            },
        );
    });
}

describe('Model Gateway runtime-selector CLI liveness', () => {
    it('completes a metadata-only dry selection without retaining the Copilot SDK substrate', async () => {
        const result = await runRuntimeSelectorDry();
        const summary = JSON.parse(result.stdout);

        expect(result.elapsedMs).toBeLessThan(8_000);
        expect(result.stderr).toBe('');
        expect(summary).toMatchObject({
            policyResolution: {
                mode: 'metadata_first',
            },
            runtimeSelectorPlan: {
                schema: 'model-gateway-runtime-selector-plan',
            },
        });
    }, 10_000);
});
