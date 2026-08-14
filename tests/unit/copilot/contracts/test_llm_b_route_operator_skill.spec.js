// @ts-check

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'vitest';

const skillUrl = new URL('../../../../.github/skills/llm-b-route-operator/SKILL.md', import.meta.url);
const protocolUrl = new URL('../../../../.github/skills/llm-b-route-operator/references/route-protocol.md', import.meta.url);
const promptUrl = new URL('../../../../src/copilot/config/system-prompt/sections/custom-instructions.js', import.meta.url);

describe('LLM-B route operator skill', () => {
    it('is discoverable and preserves the same-session promotion contract', async () => {
        const [skill, protocol, prompt] = await Promise.all([
            readFile(skillUrl, 'utf8'),
            readFile(protocolUrl, 'utf8'),
            readFile(promptUrl, 'utf8'),
        ]);

        assert.match(skill, /^name: llm-b-route-operator$/m);
        assert.match(skill, /model_gateway_workflow_plan/);
        assert.match(skill, /model_gateway_probe_execute/);
        assert.match(skill, /model_gateway_route_switch/);
        assert.match(skill, /automaticContinuation\.armed=true/);
        assert.match(skill, /Never create a new SDK session/);
        assert.match(protocol, /deferred_until_turn_boundary/);
        assert.match(protocol, /committed/);
        assert.match(prompt, /llm-b-route-operator/);
    });
});
