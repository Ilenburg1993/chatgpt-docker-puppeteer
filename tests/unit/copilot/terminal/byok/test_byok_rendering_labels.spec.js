// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    countLabel,
    formatTerminalDurationSeconds,
    joinTerminalSummary,
    renderByokCapabilityLine,
    renderByokSourceLabel,
    renderByokTokenLabel,
    renderByokTokenList,
    yesNoPlain,
} from '../../../../../src/copilot/terminal/byok/rendering/labels.js';

describe('terminal BYOK rendering labels', () => {
    it('preserva a taxonomia textual usada pelo cockpit', () => {
        assert.equal(renderByokSourceLabel('model-gateway:model'), 'catálogo normalizado');
        assert.equal(renderByokTokenLabel('deferred_until_turn_boundary'), 'diferido até limite do turno');
        assert.equal(renderByokTokenLabel('blocked:provider_health_cooldown:rate-limit'), 'bloqueada por cooldown de limite de taxa');
        assert.equal(renderByokTokenList(['chat', 'vision']), 'chat, visão');
    });

    it('formata resumos, capacidades e durações sem dependências de runtime', () => {
        assert.equal(countLabel(1, 'modelo', 'modelos'), '1 modelo');
        assert.equal(countLabel(2, 'modelo', 'modelos'), '2 modelos');
        assert.equal(joinTerminalSummary(['a', null, false, 'b']), 'a · b');
        assert.equal(formatTerminalDurationSeconds(65), '1m 5s');
        assert.equal(formatTerminalDurationSeconds(7200), '2h');
        assert.equal(yesNoPlain(undefined), '-');
        assert.equal(
            renderByokCapabilityLine({ reasoningEffort: true, sdkReasoningEffort: false, vision: true, contextWindowTokens: 128000 }),
            'raciocínio sim · SDK não · visão sim · contexto 128000',
        );
    });
});
