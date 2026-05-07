// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildActivityAwareGuidance,
    buildFailureRecoveryLines,
    buildTerminalOperationalGuidance,
} from '../../../../src/copilot/terminal/auto-briefing.js';

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

    // ── A.9: severity e nextCommand ──────────────────────────────────────────

    it('A.9: retorna severity info em modo local-fs-primary sem warnings', () => {
        const guidance = buildTerminalOperationalGuidance({
            sdkFsRouting: { mode: 'local-fs-primary', reason: 'ready' },
            toolLoad: { hasCanonicalLocalFsTools: true },
            instructionLoad: { sectionsMissingFileCount: 0, appendFileMissingCount: 0 },
        });

        expect(guidance.severity).toBe('info');
        expect(guidance.nextCommand).toBeTruthy();
        expect(guidance.nextCommand).toContain('/fs');
    });

    it('A.9: retorna severity warn quando há warnings', () => {
        const guidance = buildTerminalOperationalGuidance({
            sdkFsRouting: { mode: 'local-fs-primary', reason: 'tools-missing' },
            toolLoad: { hasCanonicalLocalFsTools: false },
            instructionLoad: { sectionsMissingFileCount: 0, appendFileMissingCount: 0 },
        });

        expect(guidance.severity).toBe('warn');
    });

    it('A.9: retorna severity error no modo degraded', () => {
        const guidance = buildTerminalOperationalGuidance({
            sdkFsRouting: { mode: 'degraded', reason: 'boot-failure' },
            toolLoad: { hasCanonicalLocalFsTools: false },
            instructionLoad: { sectionsMissingFileCount: 0, appendFileMissingCount: 0 },
        });

        expect(guidance.severity).toBe('error');
    });

    it('A.9: nextCommand sdk-workspace-only aponta para /workspace', () => {
        const guidance = buildTerminalOperationalGuidance({
            sdkFsRouting: { mode: 'sdk-workspace-only', reason: 'fs-unavailable' },
            toolLoad: { hasCanonicalLocalFsTools: false },
            instructionLoad: { sectionsMissingFileCount: 0, appendFileMissingCount: 0 },
        });

        expect(guidance.nextCommand).toContain('/workspace');
    });

    // ── A.9: buildActivityAwareGuidance ─────────────────────────────────────

    it('A.9: buildActivityAwareGuidance sem lastIoEntry retorna guidance base', () => {
        const guidance = buildActivityAwareGuidance({ mode: 'local-fs-primary' });

        expect(guidance.mode).toBe('local-fs-primary');
        expect(guidance.severity).toBe('info');
        expect(guidance.nextCommand).toBeTruthy();
        expect(guidance.nextCommand).toContain('/activity');
    });

    it('A.9: buildActivityAwareGuidance com lastIoEntry falha de read sugere /status → /fs read', () => {
        const guidance = buildActivityAwareGuidance({
            mode: 'local-fs-primary',
            lastIoEntry: { operation: 'read', target: 'src/main.js', success: false, engine: 'io-engine' },
        });

        expect(guidance.nextCommand).toContain('/status');
        expect(guidance.nextCommand).toContain('/fs read');
    });

    it('A.9: buildActivityAwareGuidance com lastIoEntry sucesso de write sugere /fs read', () => {
        const guidance = buildActivityAwareGuidance({
            mode: 'local-fs-primary',
            lastIoEntry: { operation: 'write', target: 'src/foo.js', success: true, engine: 'io-engine' },
        });

        expect(guidance.nextCommand).toContain('/fs read');
    });

    it('A.9: buildActivityAwareGuidance com warnings extras eleva severity para warn', () => {
        const guidance = buildActivityAwareGuidance({
            mode: 'local-fs-primary',
            warnings: ['dependência faltando'],
            lastIoEntry: null,
        });

        expect(guidance.severity).toBe('warn');
        expect(guidance.warnings).toContain('dependência faltando');
    });

    it('A.9: buildActivityAwareGuidance modo degraded sempre severity error', () => {
        const guidance = buildActivityAwareGuidance({ mode: 'degraded' });

        expect(guidance.severity).toBe('error');
        expect(guidance.nextCommand).toContain('/status');
    });

    it('A.9: buildFailureRecoveryLines inclui nextCommand quando presente', () => {
        const guidance = buildActivityAwareGuidance({
            mode: 'local-fs-primary',
            lastIoEntry: { operation: 'scan', target: 'src/', success: false, engine: null },
        });

        const lines = buildFailureRecoveryLines(guidance);
        const combined = lines.join('\n');
        expect(combined).toContain('Próximo:');
        expect(combined).toContain('/fs list');
    });
});
