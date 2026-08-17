// @ts-check

import { describe, expect, it } from 'vitest';

import { resolveModelGatewayAdmissionCandidateSelectionPolicy } from '../../../../src/copilot/model-gateway/control-plane/runtime-admission-policy.js';

describe('runtime admission selection policy', () => {
    it('relaxes require_runtime_proof only for pre-proof candidate discovery when agent admission is mandatory', () => {
        expect(
            resolveModelGatewayAdmissionCandidateSelectionPolicy('require_runtime_proof', {
                requireAgentAdmission: true,
            }),
        ).toEqual({
            requestedSelectionPolicy: 'require_runtime_proof',
            candidateSelectionPolicy: 'prefer_runtime_proved',
            relaxedForAdmission: true,
        });
    });

    it('preserves the requested policy when no agent admission bridge is required', () => {
        expect(
            resolveModelGatewayAdmissionCandidateSelectionPolicy('require-runtime-proof', {
                requireAgentAdmission: false,
            }),
        ).toEqual({
            requestedSelectionPolicy: 'require_runtime_proof',
            candidateSelectionPolicy: 'require_runtime_proof',
            relaxedForAdmission: false,
        });
        expect(
            resolveModelGatewayAdmissionCandidateSelectionPolicy('prefer_runtime_proved', {
                requireAgentAdmission: true,
            }),
        ).toEqual({
            requestedSelectionPolicy: 'prefer_runtime_proved',
            candidateSelectionPolicy: 'prefer_runtime_proved',
            relaxedForAdmission: false,
        });
    });
});
