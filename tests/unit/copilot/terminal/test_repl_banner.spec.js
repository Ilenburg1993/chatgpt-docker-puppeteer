// @ts-check

import { describe, expect, it, vi } from 'vitest';

import { buildTerminalReplBanner } from '../../../../src/copilot/terminal/repl/repl-banner.js';

describe('terminal/repl-banner', () => {
    it('usa banner compacto por padrão', () => {
        const banner = buildTerminalReplBanner(3010);

        expect(banner).toContain('Terminal LLM-B');
        expect(banner).toContain('/help');
        expect(banner).toContain('HTTP :3010');
        expect(banner).toContain('Operar');
        expect(banner).toContain('Entrada');
        expect(banner).toContain('Sistema');
        expect(banner).toContain('texto direto = próxima pergunta');
        expect(banner).not.toContain('texto livre → fila de intervenção');
        expect(banner).not.toContain('/workspace [list|read|write|sync|mirror|promote]');
        expect(banner).not.toContain('\x1b[36m┌');
        expect(banner).not.toContain('\x1b[33m/status');
        expect(banner.split('\n').filter((line) => line.trim().length > 0).length).toBeLessThanOrEqual(6);
    });

    it('mantém banner completo como opt-in explícito', () => {
        vi.stubEnv('COPILOT_TERMINAL_BOOT_MENU', 'full');

        const banner = buildTerminalReplBanner(3010);

        expect(banner).toContain('/workspace [list|read|write|sync|mirror|promote]');
        expect(banner).toContain('GET :3010/config');
        vi.unstubAllEnvs();
    });
});
