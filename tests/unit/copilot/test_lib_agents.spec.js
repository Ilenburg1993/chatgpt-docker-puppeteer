// @ts-check
/**
 * tests/unit/copilot/test_lib_agents.spec.js
 *
 * Testes unitários para src/copilot/lib/agents.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    READ_ONLY_TOOLS,
    buildAgentList,
    createAgent,
    createAnalystAgent,
    createFullAccessAgent,
    createReadOnlyAgent,
    filterInferableAgents,
    isValidAgentName,
} from '#copilot/sdk/agents';

// ─── createAgent ─────────────────────────────────────────────────────────────

describe('createAgent', () => {
    it('deve criar config com name e prompt obrigatórios', () => {
        const agent = createAgent({ name: 'bot', prompt: 'Você é um assistente.' });
        assert.equal(agent.name, 'bot');
        assert.equal(agent.prompt, 'Você é um assistente.');
    });

    it('deve incluir campos opcionais quando fornecidos', () => {
        const mcpServers = { myServer: /** @type {any} */ ({ url: 'http://localhost:3000' }) };
        const agent = createAgent({
            name: 'rich-bot',
            prompt: 'Prompt completo.',
            displayName: 'Rich Bot',
            description: 'Agente cheio de configurações.',
            tools: ['read_file', 'grep_search'],
            mcpServers,
            infer: false,
        });

        assert.equal(agent.displayName, 'Rich Bot');
        assert.equal(agent.description, 'Agente cheio de configurações.');
        assert.deepEqual(agent.tools, ['read_file', 'grep_search']);
        assert.deepEqual(agent.mcpServers, mcpServers);
        assert.equal(agent.infer, false);
    });

    it('deve aceitar tools = null (acesso a todas as ferramentas)', () => {
        const agent = createAgent({ name: 'all-tools', prompt: 'Pode tudo.', tools: null });
        assert.equal(agent.tools, null);
    });

    it('deve omitir campos opcionais quando não fornecidos', () => {
        const agent = createAgent({ name: 'minimal', prompt: 'Mínimo.' });
        assert.equal(Object.prototype.hasOwnProperty.call(agent, 'displayName'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(agent, 'description'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(agent, 'tools'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(agent, 'mcpServers'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(agent, 'infer'), false);
    });

    it('deve lançar erro quando name está ausente', () => {
        assert.throws(() => createAgent({ name: '', prompt: 'ok' }), /createAgent.*"name"/);
    });

    it('deve lançar erro quando name não é string', () => {
        assert.throws(
            () => Reflect.apply(createAgent, undefined, [{ name: 42, prompt: 'ok' }]),
            /createAgent.*"name"/,
        );
    });

    it('deve lançar erro quando prompt está ausente', () => {
        assert.throws(() => createAgent({ name: 'ok', prompt: '' }), /createAgent.*"prompt"/);
    });
});

// ─── createReadOnlyAgent ─────────────────────────────────────────────────────

describe('createReadOnlyAgent', () => {
    it('deve criar agente com READ_ONLY_TOOLS por padrão', () => {
        const agent = createReadOnlyAgent('auditor', 'Analise o código.');
        assert.deepEqual(agent.tools, READ_ONLY_TOOLS);
    });

    it('deve adicionar extraTools às ferramentas de leitura', () => {
        const agent = createReadOnlyAgent('auditor', 'Analise.', {
            extraTools: ['custom_tool'],
        });
        assert.ok(Array.isArray(agent.tools));
        assert.ok(/** @type {string[]} */ (agent.tools).includes('read_file_content'));
        assert.ok(/** @type {string[]} */ (agent.tools).includes('custom_tool'));
    });

    it('deve definir description padrão', () => {
        const agent = createReadOnlyAgent('r', 'P');
        assert.ok(agent.description?.includes('somente-leitura'));
    });

    it('deve sobrescrever description via opts', () => {
        const agent = createReadOnlyAgent('r', 'P', { description: 'Custom desc' });
        assert.equal(agent.description, 'Custom desc');
    });

    it('deve definir displayName quando fornecido', () => {
        const agent = createReadOnlyAgent('r', 'P', { displayName: 'Leitura' });
        assert.equal(agent.displayName, 'Leitura');
    });
});

// ─── createFullAccessAgent ───────────────────────────────────────────────────

describe('createFullAccessAgent', () => {
    it('deve criar agente com tools = null', () => {
        const agent = createFullAccessAgent('superbot', 'Faz tudo.');
        assert.equal(agent.tools, null);
    });

    it('deve ter description padrão sobre acesso irrestrito', () => {
        const agent = createFullAccessAgent('s', 'p');
        assert.ok(agent.description?.includes('irrestrito'));
    });

    it('deve aceitar opts.displayName e opts.description', () => {
        const agent = createFullAccessAgent('s', 'p', {
            displayName: 'Super Bot',
            description: 'Custom',
        });
        assert.equal(agent.displayName, 'Super Bot');
        assert.equal(agent.description, 'Custom');
    });
});

// ─── createAnalystAgent ──────────────────────────────────────────────────────

describe('createAnalystAgent', () => {
    it('deve criar agente analista com READ_ONLY_TOOLS', () => {
        const agent = createAnalystAgent('analyst', 'Analise tudo.');
        assert.deepEqual(agent.tools, READ_ONLY_TOOLS);
    });

    it('description deve mencionar "analista"', () => {
        const agent = createAnalystAgent('a', 'p');
        assert.ok(agent.description?.includes('analista'));
    });

    it('displayName padrão deve ser igual ao name', () => {
        const agent = createAnalystAgent('inspection-bot', 'p');
        assert.equal(agent.displayName, 'inspection-bot');
    });

    it('deve aceitar opts.displayName', () => {
        const agent = createAnalystAgent('a', 'p', { displayName: 'Analista' });
        assert.equal(agent.displayName, 'Analista');
    });
});

// ─── buildAgentList ──────────────────────────────────────────────────────────

describe('buildAgentList', () => {
    it('deve retornar array com os agentes passados', () => {
        const a1 = createAgent({ name: 'a1', prompt: 'p1' });
        const a2 = createAgent({ name: 'a2', prompt: 'p2' });
        const list = buildAgentList(a1, a2);
        assert.equal(list.length, 2);
        assert.equal(list[0]?.name, 'a1');
        assert.equal(list[1]?.name, 'a2');
    });

    it('deve retornar array vazio se chamado sem argumentos', () => {
        const list = buildAgentList();
        assert.deepEqual(list, []);
    });
});

// ─── isValidAgentName ────────────────────────────────────────────────────────

describe('isValidAgentName', () => {
    it('deve aceitar nomes alfanuméricos simples', () => {
        assert.ok(isValidAgentName('bot'));
        assert.ok(isValidAgentName('myAgent'));
        assert.ok(isValidAgentName('agent123'));
    });

    it('deve aceitar nomes com hífen e underscore', () => {
        assert.ok(isValidAgentName('my-agent'));
        assert.ok(isValidAgentName('my_agent'));
        assert.ok(isValidAgentName('agent-v2'));
    });

    it('deve rejeitar string vazia', () => {
        assert.equal(isValidAgentName(''), false);
    });

    it('deve rejeitar nomes com espaço', () => {
        assert.equal(isValidAgentName('my agent'), false);
    });

    it('deve rejeitar nomes iniciando com hífen', () => {
        assert.equal(isValidAgentName('-invalid'), false);
    });

    it('deve rejeitar não-strings', () => {
        assert.equal(isValidAgentName(/** @type {any} */ (null)), false);
        assert.equal(isValidAgentName(/** @type {any} */ (42)), false);
    });
});

// ─── filterInferableAgents ───────────────────────────────────────────────────

describe('filterInferableAgents', () => {
    it('deve incluir agentes sem campo infer (default = true)', () => {
        const agent = createAgent({ name: 'a', prompt: 'p' });
        assert.equal(filterInferableAgents([agent]).length, 1);
    });

    it('deve incluir agentes com infer = true', () => {
        const agent = createAgent({ name: 'a', prompt: 'p', infer: true });
        assert.equal(filterInferableAgents([agent]).length, 1);
    });

    it('deve excluir agentes com infer = false', () => {
        const agent = createAgent({ name: 'a', prompt: 'p', infer: false });
        assert.equal(filterInferableAgents([agent]).length, 0);
    });

    it('deve filtrar corretamente lista mista', () => {
        const a1 = createAgent({ name: 'a1', prompt: 'p', infer: true });
        const a2 = createAgent({ name: 'a2', prompt: 'p', infer: false });
        const a3 = createAgent({ name: 'a3', prompt: 'p' });
        const result = filterInferableAgents([a1, a2, a3]);
        assert.equal(result.length, 2);
        assert.ok(result.some((a) => a.name === 'a1'));
        assert.ok(result.some((a) => a.name === 'a3'));
    });
});

// ─── READ_ONLY_TOOLS ─────────────────────────────────────────────────────────

describe('READ_ONLY_TOOLS', () => {
    it('deve ser um array de strings', () => {
        assert.ok(Array.isArray(READ_ONLY_TOOLS));
        assert.ok(READ_ONLY_TOOLS.every((t) => typeof t === 'string'));
    });

    it('deve incluir ferramentas canônicas de leitura e busca', () => {
        assert.ok(READ_ONLY_TOOLS.includes('read_file_content'));
        assert.ok(READ_ONLY_TOOLS.includes('search_in_files'));
    });

    it('deve ter ao menos 4 ferramentas', () => {
        assert.ok(READ_ONLY_TOOLS.length >= 4);
    });
});
