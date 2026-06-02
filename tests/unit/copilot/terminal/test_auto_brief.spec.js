// @ts-check

import { describe, expect, it, vi } from 'vitest';

const { readTerminalByokProjection, readTerminalStatusProjection } = vi.hoisted(() => ({
    readTerminalByokProjection: vi.fn(() => ({
        summary: {
            enabled: false,
            ready: false,
            preset: null,
            providerType: null,
            model: null,
            auth: {
                bearerTokenConfigured: false,
                apiKeyConfigured: false,
                headersConfigured: false,
            },
        },
    })),
    readTerminalStatusProjection: vi.fn(),
}));

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    readTerminalByokProjection,
    readTerminalStatusProjection,
}));

vi.mock('../../../../src/copilot/terminal/state/repl-runtime/index.js', () => ({
    readTerminalDisplayState: () => ({ thinking: true, streaming: true }),
    resolveTerminalBootDisplayPreset: () => 'full',
}));

function createProjection(overrides = {}) {
    return {
        runtimeId: 'default',
        snap: {
            model: 'auto',
            reasoningEffort: 'high',
            isResumed: false,
            resumeCount: 0,
            contextWindow: null,
        },
        toolLoad: {
            total: 0,
            hasCanonicalLocalFsTools: false,
            hasCanonicalLocalExecTools: false,
            hasSdkWorkspaceTooling: false,
            toolContract: {
                ok: true,
                errorCount: 0,
                warningCount: 0,
                metadataCoverage: 1,
            },
        },
        instructionLoad: {
            sectionCount: 0,
            sectionsMissingFileCount: 0,
            appendFileMissingCount: 0,
        },
        sdkFsRouting: { mode: 'degraded', reason: 'boot-partial' },
        timelineSource: 'empty',
        timelineReconciliationStatus: 'empty',
        timelineSyncStatus: 'not_needed',
        timelineSyncReason: 'empty',
        timelineTurnCount: 0,
        persistedTimelineTurnCount: 0,
        dialogLoopActive: false,
        ioRuntime: {
            scopes: { active: 0 },
            parser: { size: 0 },
            cache: { aggregate: { hitRatio: 0 }, l2: { enabled: false } },
            index: { available: true, files: 0 },
        },
        ...overrides,
    };
}

describe('terminal/repl/auto-brief', () => {
    it('não emite aviso transitório de file-tools no boot parcial', async () => {
        readTerminalStatusProjection.mockReturnValue(createProjection());
        const { buildTerminalAutoBrief } = await import('../../../../src/copilot/terminal/repl/auto-brief.js');

        const brief = buildTerminalAutoBrief({ phase: 'boot' });
        const text = brief.lines.join('\n');

        expect(text).toContain('Boot      parcial');
        expect(text).not.toContain('file-tools canônicas locais não estão totalmente disponíveis');
    });

    it('mantém aviso real de instruções ausentes mesmo no boot parcial', async () => {
        readTerminalStatusProjection.mockReturnValue(
            createProjection({
                instructionLoad: {
                    sectionCount: 1,
                    sectionsMissingFileCount: 1,
                    appendFileMissingCount: 0,
                },
            }),
        );
        const { buildTerminalAutoBrief } = await import('../../../../src/copilot/terminal/repl/auto-brief.js');

        const brief = buildTerminalAutoBrief({ phase: 'boot' });
        const text = brief.lines.join('\n');

        expect(text).toContain('Boot      parcial');
        expect(text).toContain('há arquivos de instruções ausentes no reload do system prompt');
    });

    it('preserva modo detalhado por env explícita', async () => {
        readTerminalStatusProjection.mockReturnValue(createProjection());
        vi.stubEnv('COPILOT_TERMINAL_AUTO_BRIEF', 'full');
        const { buildTerminalAutoBrief } = await import('../../../../src/copilot/terminal/repl/auto-brief.js');

        const brief = buildTerminalAutoBrief({ phase: 'boot' });
        const text = brief.lines.join('\n');

        expect(text).toContain('[auto-brief:boot]');
        expect(text).toContain('estado=parcial');
        vi.unstubAllEnvs();
    });
});
