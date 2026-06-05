// @ts-check

import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import { launchTerminalDialogLoopBootstrap } from '../../../src/copilot/terminal/repl/repl.js';

describe('terminal/repl dialog bootstrap', () => {
    it('transforma falha do dialog loop em log observável sem propagar para o boot', async () => {
        const printlnFn = vi.fn();
        const logFn = vi.fn();

        await expect(
            launchTerminalDialogLoopBootstrap({
                ensureDialogLoopFn: vi.fn(async () => {
                    throw new Error('READY lento');
                }),
                printlnFn,
                logFn: /** @type {typeof import('../../../src/copilot/observability/index.js').log} */ (
                    /** @type {unknown} */ (logFn)
                ),
            }),
        ).resolves.toBeUndefined();

        const output = printlnFn.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
        expect(output).toContain('READY lento');
        expect(output).toContain('Boot');
        expect(output).not.toContain('[erro de boot]');
        expect(output).not.toContain('\\x1b[');
        expect(logFn).toHaveBeenCalledWith('ERROR', expect.stringContaining('READY lento'));
    });

    it('startRepl não aguarda ensureDialogLoop diretamente dentro da fase de boot', async () => {
        const source = await readFile(new URL('../../../src/copilot/terminal/repl/repl.js', import.meta.url), 'utf8');
        const startReplBody = source.slice(source.indexOf('export async function startRepl'));

        expect(startReplBody).toContain('void launchTerminalDialogLoopBootstrap({ injectPort });');
        expect(startReplBody).not.toContain('await ensureDialogLoop();');
    });
});
