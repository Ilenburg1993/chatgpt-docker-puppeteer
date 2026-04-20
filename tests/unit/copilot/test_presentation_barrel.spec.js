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
        expect(typeof presentation.agentControl).toBe('object');
        expect(typeof presentation.systemConfigPresentation).toBe('object');
        expect(typeof presentation.systemMetricsPresentation).toBe('object');
    });
});
