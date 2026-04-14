// @ts-check
/**
 * tests/unit/copilot/config/test_system_prompt_modular.spec.js
 *
 * Testes unitários para o módulo modular de system prompt (Faixa I). Cobre: seções individuais, assembler dual-mode,
 * mode switching, facade backward compat.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Seções individuais
// ─────────────────────────────────────────────────────────────────────────────

describe('system-prompt-modular › seções individuais', () => {
    const sectionFiles = [
        'identity',
        'tone',
        'tool-efficiency',
        'environment-context',
        'code-change-rules',
        'guidelines',
        'safety',
        'tool-instructions',
        'custom-instructions',
        'last-instructions',
    ];

    for (const name of sectionFiles) {
        it(`seção "${name}" deve exportar CONTENT (string) e ACTION (string)`, async () => {
            const mod = await import(`../../../../src/copilot/config/system-prompt/sections/${name}.js`);
            expect(typeof mod.CONTENT).toBe('string');
            expect(mod.CONTENT.length).toBeGreaterThan(10);
            expect(typeof mod.ACTION).toBe('string');
            expect(['replace', 'append']).toContain(mod.ACTION);
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTIONS map
// ─────────────────────────────────────────────────────────────────────────────

describe('system-prompt-modular › SECTIONS map', () => {
    it('deve conter exatamente 10 seções', async () => {
        const { SECTIONS } = await import('../../../../src/copilot/config/system-prompt/index.js');
        expect(Object.keys(SECTIONS)).toHaveLength(10);
    });

    it('deve conter as 10 chaves SDK esperadas', async () => {
        const { SECTIONS } = await import('../../../../src/copilot/config/system-prompt/index.js');
        const expectedKeys = [
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
        for (const key of expectedKeys) {
            expect(SECTIONS).toHaveProperty(key);
            expect(typeof SECTIONS[key].CONTENT).toBe('string');
            expect(typeof SECTIONS[key].ACTION).toBe('string');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// mode.js
// ─────────────────────────────────────────────────────────────────────────────

describe('system-prompt-modular › mode', () => {
    it('getMode() deve retornar "replace" por padrão', async () => {
        const { getMode } = await import('../../../../src/copilot/config/system-prompt/mode.js');
        expect(getMode()).toBe('replace');
    });

    it('setMode() deve mudar o modo para "customize"', async () => {
        const { getMode, setMode } = await import('../../../../src/copilot/config/system-prompt/mode.js');
        const original = getMode();
        try {
            setMode('customize');
            expect(getMode()).toBe('customize');
        } finally {
            setMode(/** @type {'replace' | 'customize'} */ (original));
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSystemMessage — modo replace
// ─────────────────────────────────────────────────────────────────────────────

describe('system-prompt-modular › buildSystemMessage (replace)', () => {
    it('deve retornar mode: "replace" com content string', async () => {
        const { buildSystemMessage, setMode } = await import('../../../../src/copilot/config/system-prompt/index.js');
        setMode('replace');
        const msg = buildSystemMessage();
        expect(msg.mode).toBe('replace');
        expect(typeof (/** @type {any} */ (msg).content)).toBe('string');
    });

    it('content deve conter headers para as 10 seções', async () => {
        const { buildSystemMessage, setMode } = await import('../../../../src/copilot/config/system-prompt/index.js');
        setMode('replace');
        const msg = buildSystemMessage();
        const content = /** @type {any} */ (msg).content;
        const keys = [
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
        for (const key of keys) {
            expect(content).toContain(`# ${key}`);
        }
    });

    it('seções devem ser separadas por ---', async () => {
        const { buildSystemMessage, setMode } = await import('../../../../src/copilot/config/system-prompt/index.js');
        setMode('replace');
        const msg = buildSystemMessage();
        expect(/** @type {any} */ (msg).content).toContain('\n\n---\n\n');
    });

    it('deve incluir extraContext como seção operational_context', async () => {
        const { buildSystemMessage, setMode } = await import('../../../../src/copilot/config/system-prompt/index.js');
        setMode('replace');
        const msg = buildSystemMessage({ extraContext: 'briefing-xyz-123' });
        const content = /** @type {any} */ (msg).content;
        expect(content).toContain('# operational_context');
        expect(content).toContain('briefing-xyz-123');
    });

    it('sem extraContext não deve ter seção operational_context', async () => {
        const { buildSystemMessage, setMode } = await import('../../../../src/copilot/config/system-prompt/index.js');
        setMode('replace');
        const msg = buildSystemMessage();
        expect(/** @type {any} */ (msg).content).not.toContain('# operational_context');
    });

    it('content deve conter LLM-B', async () => {
        const { buildSystemMessage, setMode } = await import('../../../../src/copilot/config/system-prompt/index.js');
        setMode('replace');
        const msg = buildSystemMessage();
        expect(/** @type {any} */ (msg).content).toContain('LLM-B');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSystemMessage — modo customize
// ─────────────────────────────────────────────────────────────────────────────

describe('system-prompt-modular › buildSystemMessage (customize)', () => {
    it('deve retornar mode: "customize" com sections object', async () => {
        const { buildSystemMessage, setMode } = await import('../../../../src/copilot/config/system-prompt/index.js');
        setMode('customize');
        try {
            const msg = buildSystemMessage();
            expect(msg.mode).toBe('customize');
            expect(typeof (/** @type {any} */ (msg).sections)).toBe('object');
        } finally {
            setMode('replace');
        }
    });

    it('deve ter 10 seções no sections object', async () => {
        const { buildSystemMessage, setMode } = await import('../../../../src/copilot/config/system-prompt/index.js');
        setMode('customize');
        try {
            const msg = buildSystemMessage();
            const sections = /** @type {any} */ (msg).sections;
            expect(Object.keys(sections)).toHaveLength(10);
        } finally {
            setMode('replace');
        }
    });

    it('cada seção deve ter action e content', async () => {
        const { buildSystemMessage, setMode } = await import('../../../../src/copilot/config/system-prompt/index.js');
        setMode('customize');
        try {
            const msg = buildSystemMessage();
            const sections = /** @type {any} */ (msg).sections;
            for (const [, section] of Object.entries(sections)) {
                expect(/** @type {any} */ (section)).toHaveProperty('action');
                expect(/** @type {any} */ (section)).toHaveProperty('content');
            }
        } finally {
            setMode('replace');
        }
    });

    it('extraContext deve ir no campo content do config', async () => {
        const { buildSystemMessage, setMode } = await import('../../../../src/copilot/config/system-prompt/index.js');
        setMode('customize');
        try {
            const msg = buildSystemMessage({ extraContext: 'extra-ctx-abc' });
            expect(/** @type {any} */ (msg).content).toBe('extra-ctx-abc');
        } finally {
            setMode('replace');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildHookContextMessage
// ─────────────────────────────────────────────────────────────────────────────

describe('system-prompt-modular › buildHookContextMessage', () => {
    it('deve retornar mode: "customize" com guidelines append para hookContext não-vazio', async () => {
        const { buildHookContextMessage } = await import('../../../../src/copilot/config/system-prompt/index.js');
        const msg = buildHookContextMessage('meu briefing');
        expect(msg.mode).toBe('customize');
        const guidelines = /** @type {any} */ (msg).sections?.guidelines;
        expect(guidelines.action).toBe('append');
        expect(guidelines.content).toContain('meu briefing');
    });

    it('deve retornar mode: "append" com string vazia para hookContext vazio/falsy', async () => {
        const { buildHookContextMessage } = await import('../../../../src/copilot/config/system-prompt/index.js');
        const msg = buildHookContextMessage('');
        expect(msg.mode).toBe('append');
        expect(/** @type {any} */ (msg).content).toBe('');
    });

    it('hookContext deve incluir lembrete de vscode_askQuestions', async () => {
        const { buildHookContextMessage } = await import('../../../../src/copilot/config/system-prompt/index.js');
        const msg = buildHookContextMessage('algo');
        const content = /** @type {any} */ (msg).sections?.guidelines?.content;
        expect(content).toContain('vscode_askQuestions');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Facade backward compat (system-prompt.js)
// ─────────────────────────────────────────────────────────────────────────────

describe('system-prompt-modular › facade backward compat', () => {
    it('deve re-exportar as 7 constantes legadas', async () => {
        const m = await import('../../../../src/copilot/config/system-prompt.js');
        expect(typeof m.AGENT_IDENTITY).toBe('string');
        expect(typeof m.AGENT_TONE).toBe('string');
        expect(typeof m.TOOL_EFFICIENCY).toBe('string');
        expect(typeof m.ENVIRONMENT_CONTEXT).toBe('string');
        expect(typeof m.CODE_CHANGE_RULES).toBe('string');
        expect(typeof m.AGENT_GUIDELINES).toBe('string');
        expect(typeof m.LAST_INSTRUCTIONS).toBe('string');
    });

    it('constantes devem ser idênticas ao CONTENT das seções modulares', async () => {
        const facade = await import('../../../../src/copilot/config/system-prompt.js');
        const { SECTIONS } = await import('../../../../src/copilot/config/system-prompt/index.js');
        expect(facade.AGENT_IDENTITY).toBe(SECTIONS.identity.CONTENT);
        expect(facade.AGENT_TONE).toBe(SECTIONS.tone.CONTENT);
        expect(facade.TOOL_EFFICIENCY).toBe(SECTIONS.tool_efficiency.CONTENT);
        expect(facade.ENVIRONMENT_CONTEXT).toBe(SECTIONS.environment_context.CONTENT);
        expect(facade.CODE_CHANGE_RULES).toBe(SECTIONS.code_change_rules.CONTENT);
        expect(facade.AGENT_GUIDELINES).toBe(SECTIONS.guidelines.CONTENT);
        expect(facade.LAST_INSTRUCTIONS).toBe(SECTIONS.last_instructions.CONTENT);
    });

    it('buildAlwaysAliveSystemMessage deve delegar ao buildSystemMessage', async () => {
        const { buildAlwaysAliveSystemMessage } = await import('../../../../src/copilot/config/system-prompt.js');
        const msg = buildAlwaysAliveSystemMessage();
        expect(msg.mode).toBe('replace');
        expect(typeof (/** @type {any} */ (msg).content)).toBe('string');
        expect(/** @type {any} */ (msg).content).toContain('LLM-B');
    });

    it('buildHookContextAppendMessage deve delegar ao buildHookContextMessage', async () => {
        const { buildHookContextAppendMessage } = await import('../../../../src/copilot/config/system-prompt.js');
        const msg = buildHookContextAppendMessage('ctx-test');
        expect(msg.mode).toBe('customize');
        const content = /** @type {any} */ (msg).sections?.guidelines?.content;
        expect(content).toContain('ctx-test');
    });

    it('buildAppendSystemMessage e buildReplaceSystemMessage continuam funcionando', async () => {
        const m = await import('../../../../src/copilot/config/system-prompt.js');
        const append = m.buildAppendSystemMessage('test');
        expect(append.mode).toBe('append');
        const replace = m.buildReplaceSystemMessage('test');
        expect(replace.mode).toBe('replace');
    });

    it('SYSTEM_PROMPT_SECTIONS deve existir com 10 chaves', async () => {
        const { SYSTEM_PROMPT_SECTIONS } = await import('../../../../src/copilot/config/system-prompt.js');
        expect(Object.keys(SYSTEM_PROMPT_SECTIONS)).toHaveLength(10);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integração config barrel
// ─────────────────────────────────────────────────────────────────────────────

describe('system-prompt-modular › integração config barrel', () => {
    it('barrel deve exportar novas funções modulares', async () => {
        const m = await import('../../../../src/copilot/config/index.js');
        expect(typeof m.buildSystemMessage).toBe('function');
        expect(typeof m.buildHookContextMessage).toBe('function');
        expect(typeof m.getSystemPromptMode).toBe('function');
        expect(typeof m.setSystemPromptMode).toBe('function');
        expect(m.SYSTEM_PROMPT_MODULAR_SECTIONS).toBeDefined();
        expect(Object.keys(m.SYSTEM_PROMPT_MODULAR_SECTIONS)).toHaveLength(10);
    });

    it('barrel deve continuar exportando funções legadas', async () => {
        const m = await import('../../../../src/copilot/config/index.js');
        expect(typeof m.buildAlwaysAliveSystemMessage).toBe('function');
        expect(typeof m.buildHookContextAppendMessage).toBe('function');
        expect(typeof m.buildAppendSystemMessage).toBe('function');
        expect(typeof m.buildReplaceSystemMessage).toBe('function');
        expect(typeof m.AGENT_IDENTITY).toBe('string');
    });
});
