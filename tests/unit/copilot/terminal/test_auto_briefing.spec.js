// @ts-check

import { describe, expect, it } from 'vitest';

import { buildTerminalOperationalGuidance } from '../../../../src/copilot/terminal/auto-briefing.js';

describe('terminal/auto-briefing', () => {
    it('prioriza FS local no modo local-fs-primary', () => {
        const guidance = buildTerminalOperationalGuidance({
            sdkFsRouting: { mode: 'local-fs-primary', reason: 'ready' },
            toolLoad: { hasCanonicalLocalFsTools: true },
            instructionLoad: { sectionsMissingFileCount: 0, appendFileMissingCount: 0 },
        });

        expect(guidance.mode).toBe('local-fs-primary');
        expect(guidance.summary).toContain('FS local canônico');
        expect(guidance.domainHint).toContain('/fs');
        expect(guidance.contextHint).toContain('/sdk doctor');
        expect(guidance.warnings).toHaveLength(0);
    });

    it('sinaliza warnings quando tools/instruções estão degradadas', () => {
        const guidance = buildTerminalOperationalGuidance({
            sdkFsRouting: { mode: 'degraded', reason: 'missing-both' },
            toolLoad: { hasCanonicalLocalFsTools: false },
            instructionLoad: { sectionsMissingFileCount: 2, appendFileMissingCount: 1 },
        });

        expect(guidance.mode).toBe('degraded');
        expect(guidance.summary).toContain('degradado');
        expect(guidance.warnings.join(' ')).toContain('file-tools canônicas locais');
        expect(guidance.warnings.join(' ')).toContain('instruções ausentes');
    });
});
