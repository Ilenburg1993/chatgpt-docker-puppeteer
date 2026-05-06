// @ts-check
/**
 * Testes unitários high-level para o system prompt modular.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('system-prompt › exportações do módulo', () => {
    it('expõe builders, live builder e introspecção SDK', async () => {
        const m = await import('#copilot/config/system-prompt');
        assert.ok(typeof m.buildAppendSystemMessage === 'function');
        assert.ok(typeof m.buildReplaceSystemMessage === 'function');
        assert.ok(typeof m.buildAlwaysAliveSystemMessage === 'function');
        assert.ok(typeof m.buildLiveSystemMessage === 'function');
        assert.ok(typeof m.getSystemPromptSdkCompatibility === 'function');
        assert.ok(typeof m.buildSystemPromptPublicProjection === 'function');
        assert.ok(typeof m.readSystemPromptStatus === 'function');
        assert.ok(typeof m.readResolvedSystemPromptUserConfigSync === 'function');
    });

    it('reexporta SYSTEM_PROMPT_SECTIONS com as 10 seções esperadas', async () => {
        const { SYSTEM_PROMPT_SECTIONS } = await import('#copilot/config/system-prompt');
        const expected = [
            'identity',
            'tone',
            'tool_efficiency',
            'environment_context',
            'code_change_rules',
            'guidelines',
            'safety',
            'tool_instructions',
            'custom_instructions',
            'last_instructions',
        ];
        assert.deepEqual(Object.keys(SYSTEM_PROMPT_SECTIONS), expected);
    });
});

describe('system-prompt › builders públicos', () => {
    it('buildAppendSystemMessage e buildReplaceSystemMessage continuam estáveis', async () => {
        const { buildAppendSystemMessage, buildReplaceSystemMessage } = await import('#copilot/config/system-prompt');
        assert.deepEqual(buildAppendSystemMessage('ctx'), { mode: 'append', content: 'ctx' });
        assert.deepEqual(buildReplaceSystemMessage('ctx'), { mode: 'replace', content: 'ctx' });
    });

    it('buildAlwaysAliveSystemMessage agora usa append por padrão', async () => {
        const { buildAlwaysAliveSystemMessage, resetMode } = await import('#copilot/config/system-prompt');
        resetMode();
        const msg = buildAlwaysAliveSystemMessage();
        assert.equal(msg.mode, 'append');
        assert.ok(typeof (/** @type {any} */ (msg).content) === 'string');
        assert.ok(/** @type {any} */ (msg).content.includes('# identity'));
        assert.ok(/** @type {any} */ (msg).content.includes('LLM-B'));
    });

    it('buildAlwaysAliveSystemMessage aceita replace explícito', async () => {
        const { buildAlwaysAliveSystemMessage } = await import('#copilot/config/system-prompt');
        const msg = buildAlwaysAliveSystemMessage({ mode: 'replace', extraContext: 'ctx' });
        assert.equal(msg.mode, 'replace');
        assert.ok(/** @type {any} */ (msg).content.includes('# operational_context'));
    });

    it('buildHookContextAppendMessage usa customize/guidelines append', async () => {
        const { buildHookContextAppendMessage } = await import('#copilot/config/system-prompt');
        const msg = buildHookContextAppendMessage('briefing');
        assert.equal(msg.mode, 'customize');
        assert.equal(/** @type {any} */ (msg).sections.guidelines.action, 'append');
        assert.ok(/** @type {any} */ (msg).sections.guidelines.content.includes('briefing'));
    });
});

describe('system-prompt › integração com config barrel', () => {
    it('reexporta builders e configuração do usuário', async () => {
        const m = await import('#copilot/config');
        assert.ok(typeof m.buildSystemMessage === 'function');
        assert.ok(typeof m.buildLiveSystemMessage === 'function');
        assert.ok(typeof m.readSystemPromptStatus === 'function');
        assert.ok(typeof m.readResolvedSystemPromptUserConfigSync === 'function');
        assert.ok(typeof m.DEFAULT_EXCLUDED_TOOLS?.[Symbol.iterator] === 'function');
    });
});
