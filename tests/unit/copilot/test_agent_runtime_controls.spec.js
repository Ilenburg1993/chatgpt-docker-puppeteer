// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    readAgentRuntimeHealthSnapshot: vi.fn(() => null),
    readAgentRuntimeStatusSnapshot: vi.fn(() => ({})),
}));

vi.mock('../../../src/copilot/agent/facades/agent-runtime-status.js', () => ({
    readAgentRuntimeHealthSnapshot: mocks.readAgentRuntimeHealthSnapshot,
    readAgentRuntimeStatusSnapshot: mocks.readAgentRuntimeStatusSnapshot,
}));

import {
    getRuntimeHandoffManager,
    readRuntimeContextFactoryCapabilities,
    readRuntimeControlState,
    readRuntimeGovernanceState,
    readRuntimeInteractionState,
    readRuntimePermissionCapability,
    readRuntimePermissionMode,
    readRuntimeToolRegistry,
    readRuntimeToolRegistryEntries,
    setRuntimePermissionMode,
} from '../../../src/copilot/agent/facades/agent-runtime-controls.js';

describe('agent-runtime-controls facade', () => {
    beforeEach(() => {
        mocks.readAgentRuntimeHealthSnapshot.mockReset();
        mocks.readAgentRuntimeStatusSnapshot.mockReset();
        mocks.readAgentRuntimeHealthSnapshot.mockReturnValue(null);
        mocks.readAgentRuntimeStatusSnapshot.mockReturnValue({});
    });

    it('normaliza status/control state a partir do snapshot público do runtime', () => {
        mocks.readAgentRuntimeStatusSnapshot.mockReturnValue({
            status: 'idle',
            model: 'gpt-5-mini',
            reasoningEffort: 'high',
            sessionId: 'sess-1',
            queueSize: 3,
        });

        const state = readRuntimeControlState(
            /** @type {any} */ ({
                dialogLoopActive: true,
                dialogPaused: false,
            }),
        );

        expect(state).toEqual({
            status: 'idle',
            model: 'gpt-5-mini',
            reasoningEffort: 'high',
            sessionId: 'sess-1',
            dialogLoopActive: true,
            dialogPaused: false,
            queueSize: 3,
        });
    });

    it('resolve estado de interação a partir do runtime e dos snapshots públicos', () => {
        mocks.readAgentRuntimeStatusSnapshot.mockReturnValue({
            pendingQuestion: { kind: 'freeform', text: 'oi' },
        });

        const interaction = readRuntimeInteractionState(
            /** @type {any} */ ({
                pendingQuestion: null,
                pendingQuestionKind: null,
                pendingQuestionShadow: {
                    question: 'shadow',
                    meta: { kind: 'freeform' },
                },
                pendingQuestionShadowKind: null,
                pendingQuestionShadowState: null,
                pendingQuestionShadowExpired: true,
                pendingQuestionShadowAgeMs: 12,
                pendingQuestionShadowExpiresAt: 34,
                pendingQuestionShadowRemainingMs: 0,
            }),
        );

        expect(interaction.pendingQuestion).toEqual({ kind: 'freeform', text: 'oi' });
        expect(interaction.pendingQuestionShadowKind).toBe('freeform');
        expect(interaction.pendingQuestionShadowState).toBe('expired');
        expect(interaction.pendingQuestionShadowAgeMs).toBe(12);
    });

    it('lê handoff manager por façade e retorna null quando indisponível', () => {
        const manager = { getHistory: vi.fn(() => []) };
        expect(getRuntimeHandoffManager(/** @type {any} */ ({ getHandoffManager: () => manager }))).toBe(manager);
        expect(getRuntimeHandoffManager(/** @type {any} */ ({}))).toBeNull();
    });

    it('normaliza governança/capabilities/tool registry por façade única', () => {
        const registry = { register: vi.fn() };
        const state = readRuntimeGovernanceState(
            /** @type {any} */ ({
                getPermissionModeSnapshot: () => 'audit_only',
                getPermissionCapabilitySnapshot: () => ({ handlerAvailable: true }),
                getContextFactoryCapabilitiesSnapshot: () => ({ 'runtime.queue': { provider: 'queue' } }),
                getToolRegistrySnapshot: () => registry,
                getToolRegistryEntriesSnapshot: () => [{ name: 'tool-a' }],
            }),
        );

        expect(state.permissionMode).toBe('audit_only');
        expect(state.permissionCapability).toEqual({ handlerAvailable: true });
        expect(state.contextFactoryCapabilities).toEqual({ 'runtime.queue': { provider: 'queue' } });
        expect(state.toolRegistry).toBe(registry);
        expect(state.toolRegistryEntries).toEqual([{ name: 'tool-a' }]);
        expect(readRuntimePermissionMode(/** @type {any} */ ({ getPermissionModeSnapshot: () => 'selective' }))).toBe(
            'selective',
        );
        expect(
            readRuntimePermissionCapability(
                /** @type {any} */ ({ getPermissionCapabilitySnapshot: () => ({ ok: 1 }) }),
            ),
        ).toEqual({
            ok: 1,
        });
        expect(
            readRuntimeContextFactoryCapabilities(
                /** @type {any} */ ({ getContextFactoryCapabilitiesSnapshot: () => ({ a: { b: 1 } }) }),
            ),
        ).toEqual({ a: { b: 1 } });
        expect(readRuntimeToolRegistry(/** @type {any} */ ({ getToolRegistrySnapshot: () => registry }))).toBe(
            registry,
        );
        expect(
            readRuntimeToolRegistryEntries(/** @type {any} */ ({ getToolRegistryEntriesSnapshot: () => [{ id: 1 }] })),
        ).toEqual([{ id: 1 }]);
    });

    it('setRuntimePermissionMode delega para runtime quando disponível', () => {
        const setPermissionMode = vi.fn();
        setRuntimePermissionMode(/** @type {any} */ ({ setPermissionMode }), 'selective', {
            allowTools: ['bash.run'],
            denyShell: true,
        });
        expect(setPermissionMode).toHaveBeenCalledWith('selective', {
            allowTools: ['bash.run'],
            denyShell: true,
        });
    });
});
