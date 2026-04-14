// @ts-check
/**
 * tests/unit/copilot/test_system_prompt.spec.js
 *
 * Testes unitários para src/copilot/config/system-prompt.js (Sprint 22). Cobre: constantes exportadas,
 * buildAppendSystemMessage, buildReplaceSystemMessage, buildAlwaysAliveSystemMessage, buildHookContextAppendMessage.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ─────────────────────────────────────────────────────────────────────────────
// system-prompt — exportações do módulo
// ─────────────────────────────────────────────────────────────────────────────

describe('system-prompt › exportações do módulo', () => {
    it('deve exportar SYSTEM_PROMPT_SECTIONS com as chaves esperadas', async () => {
        const { SYSTEM_PROMPT_SECTIONS } = await import('#copilot/config/system-prompt');
        assert.ok(SYSTEM_PROMPT_SECTIONS);
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
        for (const key of expected) {
            assert.ok(Object.keys(SYSTEM_PROMPT_SECTIONS).includes(key), `Seção "${key}" deveria existir`);
        }
    });

    it('SYSTEM_PROMPT_SECTIONS deve conter 10 seções (SDK v0.2.0)', async () => {
        const { SYSTEM_PROMPT_SECTIONS } = await import('#copilot/config/system-prompt');
        assert.strictEqual(Object.keys(SYSTEM_PROMPT_SECTIONS).length, 10);
    });

    it('deve exportar as constantes de texto de identidade', async () => {
        const {
            AGENT_IDENTITY,
            AGENT_TONE,
            ENVIRONMENT_CONTEXT,
            CODE_CHANGE_RULES,
            AGENT_GUIDELINES,
            LAST_INSTRUCTIONS,
            TOOL_EFFICIENCY,
        } = await import('#copilot/config/system-prompt');
        assert.ok(typeof AGENT_IDENTITY === 'string' && AGENT_IDENTITY.length > 0);
        assert.ok(typeof AGENT_TONE === 'string' && AGENT_TONE.length > 0);
        assert.ok(typeof ENVIRONMENT_CONTEXT === 'string' && ENVIRONMENT_CONTEXT.length > 0);
        assert.ok(typeof CODE_CHANGE_RULES === 'string' && CODE_CHANGE_RULES.length > 0);
        assert.ok(typeof AGENT_GUIDELINES === 'string' && AGENT_GUIDELINES.length > 0);
        assert.ok(typeof LAST_INSTRUCTIONS === 'string' && LAST_INSTRUCTIONS.length > 0);
        assert.ok(typeof TOOL_EFFICIENCY === 'string' && TOOL_EFFICIENCY.length > 0);
    });

    it('deve exportar as funções builders', async () => {
        const m = await import('#copilot/config/system-prompt');
        assert.ok(typeof m.buildAppendSystemMessage === 'function');
        assert.ok(typeof m.buildReplaceSystemMessage === 'function');
        assert.ok(typeof m.buildAlwaysAliveSystemMessage === 'function');
        assert.ok(typeof m.buildHookContextAppendMessage === 'function');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildAppendSystemMessage
// ─────────────────────────────────────────────────────────────────────────────

describe('system-prompt › buildAppendSystemMessage', () => {
    it('deve retornar objeto com mode: "append" e content correto', async () => {
        const { buildAppendSystemMessage } = await import('#copilot/config/system-prompt');
        const msg = buildAppendSystemMessage('Meu contexto');
        assert.strictEqual(msg.mode, 'append');
        assert.strictEqual(/** @type {any} */ (msg).content, 'Meu contexto');
    });

    it('deve aceitar string vazia', async () => {
        const { buildAppendSystemMessage } = await import('#copilot/config/system-prompt');
        const msg = buildAppendSystemMessage('');
        assert.strictEqual(msg.mode, 'append');
        assert.strictEqual(/** @type {any} */ (msg).content, '');
    });

    it('deve aceitar conteúdo longo com markdown', async () => {
        const { buildAppendSystemMessage } = await import('#copilot/config/system-prompt');
        const content = '# Título\n\n- item 1\n- item 2\n\n**negrito**';
        const msg = buildAppendSystemMessage(content);
        assert.strictEqual(/** @type {any} */ (msg).content, content);
    });

    it('não deve incluir campo "guidelines"', async () => {
        const { buildAppendSystemMessage } = await import('#copilot/config/system-prompt');
        const msg = buildAppendSystemMessage('texto');
        assert.ok(!('guidelines' in msg), 'Campo guidelines não deve existir no SystemMessageConfig');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildReplaceSystemMessage
// ─────────────────────────────────────────────────────────────────────────────

describe('system-prompt › buildReplaceSystemMessage', () => {
    it('deve retornar objeto com mode: "replace" e content correto', async () => {
        const { buildReplaceSystemMessage } = await import('#copilot/config/system-prompt');
        const msg = buildReplaceSystemMessage('Sistema completo');
        assert.strictEqual(msg.mode, 'replace');
        assert.strictEqual(/** @type {any} */ (msg).content, 'Sistema completo');
    });

    it('deve aceitar prompt longo com múltiplas seções', async () => {
        const { buildReplaceSystemMessage } = await import('#copilot/config/system-prompt');
        const longPrompt = Array.from({ length: 50 }, (_, i) => `Linha ${i + 1}`).join('\n');
        const msg = buildReplaceSystemMessage(longPrompt);
        assert.strictEqual(msg.mode, 'replace');
        assert.ok(/** @type {any} */ (msg).content.includes('Linha 50'));
    });

    it('não deve conter campos de mode: "append"', async () => {
        const { buildReplaceSystemMessage } = await import('#copilot/config/system-prompt');
        const msg = buildReplaceSystemMessage('X');
        assert.strictEqual(msg.mode, 'replace');
        // "append" é o default — qualquer campo extra indicaria erro de construção
        assert.ok(!('sections' in msg));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildAlwaysAliveSystemMessage
// ─────────────────────────────────────────────────────────────────────────────

describe('system-prompt › buildAlwaysAliveSystemMessage', () => {
    it('deve retornar mode: "replace" com content não-vazio', async () => {
        const { buildAlwaysAliveSystemMessage } = await import('#copilot/config/system-prompt');
        const msg = buildAlwaysAliveSystemMessage();
        assert.strictEqual(msg.mode, 'replace');
        const content = /** @type {any} */ (msg).content;
        assert.ok(typeof content === 'string' && content.length > 100);
    });

    it('deve incluir as seções principais no content', async () => {
        const { buildAlwaysAliveSystemMessage } = await import('#copilot/config/system-prompt');
        const msg = buildAlwaysAliveSystemMessage();
        const content = /** @type {any} */ (msg).content;
        assert.ok(content.includes('# identity'), 'Deve conter seção identity');
        assert.ok(content.includes('# tone'), 'Deve conter seção tone');
        assert.ok(content.includes('# tool_efficiency'), 'Deve conter seção tool_efficiency');
        assert.ok(content.includes('# environment_context'), 'Deve conter seção environment_context');
        assert.ok(content.includes('# code_change_rules'), 'Deve conter seção code_change_rules');
        assert.ok(content.includes('# guidelines'), 'Deve conter seção guidelines');
        assert.ok(content.includes('# last_instructions'), 'Deve conter seção last_instructions');
    });

    it('deve incluir extraContext quando fornecido', async () => {
        const { buildAlwaysAliveSystemMessage } = await import('#copilot/config/system-prompt');
        const msg = buildAlwaysAliveSystemMessage({ extraContext: 'contexto-especial-xyz' });
        const content = /** @type {any} */ (msg).content;
        assert.ok(content.includes('contexto-especial-xyz'), 'extraContext deve estar no prompt');
        assert.ok(content.includes('# operational_context'), 'Deve ter seção operational_context');
    });

    it('não deve incluir seção de contexto quando extraContext vazio', async () => {
        const { buildAlwaysAliveSystemMessage } = await import('#copilot/config/system-prompt');
        const msg = buildAlwaysAliveSystemMessage({ extraContext: '' });
        const content = /** @type {any} */ (msg).content;
        assert.ok(!content.includes('# operational_context'), 'Não deve ter seção operational_context vazia');
    });

    it('deve aceitar chamada sem argumentos', async () => {
        const { buildAlwaysAliveSystemMessage } = await import('#copilot/config/system-prompt');
        assert.doesNotThrow(() => buildAlwaysAliveSystemMessage());
    });

    it('as seções devem ser separadas por divisores ---', async () => {
        const { buildAlwaysAliveSystemMessage } = await import('#copilot/config/system-prompt');
        const msg = buildAlwaysAliveSystemMessage();
        const content = /** @type {any} */ (msg).content;
        assert.ok(content.includes('\n\n---\n\n'), 'Seções devem ser separadas por ---');
    });

    it('content deve conter LLM-B como identidade do agente', async () => {
        const { buildAlwaysAliveSystemMessage } = await import('#copilot/config/system-prompt');
        const msg = buildAlwaysAliveSystemMessage();
        assert.ok(/** @type {any} */ (msg).content.includes('LLM-B'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildHookContextAppendMessage
// ─────────────────────────────────────────────────────────────────────────────

describe('system-prompt › buildHookContextAppendMessage', () => {
    it('deve retornar mode: "customize" com sections.guidelines (SDK v0.2.0)', async () => {
        const { buildHookContextAppendMessage } = await import('#copilot/config/system-prompt');
        const msg = buildHookContextAppendMessage('meu briefing aqui');
        assert.strictEqual(msg.mode, 'customize');
        const content = /** @type {any} */ (msg).sections?.guidelines?.content;
        assert.ok(content.includes('meu briefing aqui'), 'Deve incluir o hook context');
        assert.ok(content.includes('Hook System'), 'Deve mencionar Hook System');
    });

    it('deve incluir lembrete de vscode_askQuestions no conteúdo', async () => {
        const { buildHookContextAppendMessage } = await import('#copilot/config/system-prompt');
        const msg = buildHookContextAppendMessage('algum contexto');
        const content = /** @type {any} */ (msg).sections?.guidelines?.content;
        assert.ok(content.includes('vscode_askQuestions'), 'Deve incluir lembrete do protocolo');
    });

    it('deve retornar mode: "append" com string vazia quando hookContext é string vazia', async () => {
        const { buildHookContextAppendMessage } = await import('#copilot/config/system-prompt');
        const msg = buildHookContextAppendMessage('');
        assert.strictEqual(msg.mode, 'append');
        assert.strictEqual(/** @type {any} */ (msg).content, '');
    });

    it('não deve lançar exceção com qualquer string válida', async () => {
        const { buildHookContextAppendMessage } = await import('#copilot/config/system-prompt');
        assert.doesNotThrow(() => buildHookContextAppendMessage('abc'));
        assert.doesNotThrow(() => buildHookContextAppendMessage(''));
        assert.doesNotThrow(() => buildHookContextAppendMessage('# Markdown\n\n- item'));
    });

    it('content deve conter o separador ---', async () => {
        const { buildHookContextAppendMessage } = await import('#copilot/config/system-prompt');
        const msg = buildHookContextAppendMessage('briefing');
        const content = /** @type {any} */ (msg).sections?.guidelines?.content;
        assert.ok(content.startsWith('---') || content.includes('\n---\n'), 'Deve iniciar com separador');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integração: config/index.js barrel reexporta system-prompt
// ─────────────────────────────────────────────────────────────────────────────

describe('system-prompt › integração com config/index.js', () => {
    it('barrel deve re-exportar todos os builders e constantes', async () => {
        const m = await import('#copilot/config/index');
        assert.ok(typeof m.buildAppendSystemMessage === 'function');
        assert.ok(typeof m.buildReplaceSystemMessage === 'function');
        assert.ok(typeof m.buildAlwaysAliveSystemMessage === 'function');
        assert.ok(typeof m.buildHookContextAppendMessage === 'function');
        assert.ok(m.SYSTEM_PROMPT_SECTIONS !== undefined);
        assert.ok(typeof m.AGENT_IDENTITY === 'string');
    });
});
