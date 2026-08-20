// @ts-check

import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import {
    buildTerminalStandaloneBannerView,
    printStandaloneBanner,
} from '../../../../src/copilot/terminal/terminal-phases/boot-banner.js';

describe('terminal/terminal-phases/boot-banner', () => {
    it('projeta modo standalone com aviso de MCP indisponível', () => {
        const view = buildTerminalStandaloneBannerView(
            { serverUrl: 'http://127.0.0.1:3009', bootPreflight: null },
            {
                getMcpStatusFn: () => ({ available: false, toolCount: 0, circuitOpen: false }),
            },
        );

        assert.equal(view.operationMode, 'standalone');
        assert.equal(view.mcpToolCount, 0);
        assert.equal(
            view.lines.some((line) => line.includes('local · MCP remoto ausente · FS/terminal locais ativos')),
            true,
        );
        assert.equal(
            view.lines.some((line) => line.includes('Ações') && line.includes('ferramentas locais ativas')),
            false,
        );
        assert.equal(
            view.lines.some((line) => line.includes('/session sdk')),
            true,
        );
        assert.equal(
            view.lines.some(
                (line) => line.includes('API local') && line.includes('/tools') && line.includes('/events'),
            ),
            true,
        );
        assert.equal(
            view.lines.some((line) => line.includes('┌─ Terminal Permanente')),
            false,
        );
    });

    it('imprime aviso de preflight quando warnings existem', () => {
        const printlnFn = vi.fn();

        printStandaloneBanner(
            {
                serverUrl: 'http://127.0.0.1:3009',
                bootPreflight: { ok: false, pingOk: false, warnings: ['CLI indisponível'] },
            },
            {
                printlnFn,
                getMcpStatusFn: () => ({ available: true, toolCount: 7, circuitOpen: false }),
            },
        );

        const output = printlnFn.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
        assert.match(output, /MCP conectado/);
        assert.match(output, /CLI indisponível/);
    });
});
