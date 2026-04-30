// @ts-check

import { beforeAll, describe, expect, it } from 'vitest';

/** @type {typeof import('../../../src/copilot/presentation/index.js')} */
let presentation;

beforeAll(async () => {
    presentation = await import('../../../src/copilot/presentation/index.js');
});

describe('presentation/index.js — contrato', () => {
    it('expõe o accessor canônico de runtime e namespaces compartilhados', () => {
        expect(typeof presentation.getDefaultAgentRuntime).toBe('function');
        expect(typeof presentation.getAgentRuntime).toBe('function');
        expect(typeof presentation.requireAgentRuntime).toBe('function');
        expect(typeof presentation.listKnownAgentRuntimes).toBe('function');
        expect(typeof presentation.readDefaultAgentRuntimeOverview).toBe('function');
        expect(typeof presentation.normalizeAgentContextWindowProjection).toBe('function');
        expect(typeof presentation.getDefaultAgentRuntimeControlsTarget).toBe('function');
        expect(typeof presentation.createAgentRuntimeSnapshot).toBe('function');
        expect(typeof presentation.saveAgentRuntimeSnapshot).toBe('function');
        expect(typeof presentation.listAgentRuntimeSnapshots).toBe('function');
        expect(typeof presentation.loadAgentRuntimeSnapshot).toBe('function');
        expect(typeof presentation.detectLang).toBe('function');
        expect(typeof presentation.extractAtReferences).toBe('function');
        expect(typeof presentation.readFileContext).toBe('function');
        expect(typeof presentation.clearFileCache).toBe('function');
        expect(typeof presentation.sendRuntimeDialogTurn).toBe('function');
        expect(typeof presentation.readRuntimeFileContext).toBe('function');
        expect(typeof presentation.embedRuntimeMultiple).toBe('function');
        expect(typeof presentation.recordRuntimeInjectHistory).toBe('function');
        expect(typeof presentation.readRuntimeInjectHistory).toBe('function');
        expect(typeof presentation.readRuntimeBusyState).toBe('function');
        expect(typeof presentation.readRuntimeHubSessionId).toBe('function');
        expect(typeof presentation.pauseDefaultAgentDialogLoop).toBe('function');
        expect(typeof presentation.resumeDefaultAgentDialogLoop).toBe('function');
        expect(typeof presentation.stopDefaultAgentDialogLoopAuthorized).toBe('function');
        expect(typeof presentation.getAgentHealthSnapshotCompat).toBe('function');
        expect(typeof presentation.buildAgentModuleHealth).toBe('function');
        expect(typeof presentation.readRuntimeLifecycleSnapshot).toBe('function');
        expect(typeof presentation.buildRuntimeLifecycleSummary).toBe('function');
        expect(typeof presentation.normalizeRuntimeRouteMeta).toBe('function');
        expect(typeof presentation.buildRuntimeRouteMetaPayload).toBe('function');
        expect(typeof presentation.buildRuntimeRouteMetaFromSelection).toBe('function');
        expect(typeof presentation.readAgentStatusSnapshot).toBe('function');
        expect(typeof presentation.readAgentStatusValue).toBe('function');
        expect(typeof presentation.buildAgentStatusHttpPayload).toBe('function');
        expect(typeof presentation.buildAgentStatusHttpPayloadFromRoute).toBe('function');
        expect(typeof presentation.buildAgentSessionHttpPayload).toBe('function');
        expect(typeof presentation.buildAgentSessionHttpPayloadFromRoute).toBe('function');
        expect(typeof presentation.buildAgentConnectedSsePayload).toBe('function');
        expect(typeof presentation.buildAgentConnectedSsePayloadFromRoute).toBe('function');
        expect(typeof presentation.agentControl).toBe('object');
        expect(typeof presentation.systemConfigPresentation).toBe('object');
        expect(typeof presentation.systemMetricsPresentation).toBe('object');
    });
});
