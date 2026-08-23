// @ts-check
/**
 * tests/unit/copilot/test_structured_message.spec.js
 *
 * Testes unitários do protocolo StructuredMessage (Sprint A).
 *
 * Cobertura:
 *
 * - StructuredMessageSchema (Zod): campos válidos/inválidos/defaults
 * - buildStructuredRequest(): criação com validação
 * - buildStructuredResponse(): resposta com output obrigatório
 * - serializeStructuredMessage(): JSON puro e com instrução
 * - parseStructuredResponse(): estratégias de parse (JSON puro, bloco ```json, embutido, fallback null)
 * - isStructuredMessage(): type guard
 * - RESPONSE_TYPES, PRIORITY_LEVELS: constantes corretas
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    PRIORITY_LEVELS,
    RESPONSE_TYPES,
    StructuredMessageSchema,
    buildStructuredRequest,
    buildStructuredResponse,
    isStructuredMessage,
    parseStructuredResponse,
    serializeStructuredMessage,
} from '#copilot/channel/structured-message';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** @returns {Parameters<typeof buildStructuredRequest>[0]} */
function validInput() {
    return {
        context: 'Sprint A implementado. 1419 testes.',
        intent: 'Confirmar que novos testes passam',
        priority: 'high',
        responseType: 'diagnostic',
    };
}

// ─── StructuredMessageSchema ──────────────────────────────────────────────────

describe('StructuredMessageSchema', () => {
    it('aceita input válido mínimo', () => {
        const result = StructuredMessageSchema.safeParse({
            context: 'ctx',
            intent: 'intent',
            responseType: 'diagnostic',
        });
        assert.ok(result.success, `Deveria aceitar: ${JSON.stringify(result.error?.errors ?? [])}`);
        // defaults aplicados
        assert.equal(result.data.version, '1.0');
        assert.equal(result.data.priority, 'medium');
    });

    it('aplica default version=1.0', () => {
        const result = StructuredMessageSchema.safeParse({ context: 'c', intent: 'i', responseType: 'plan' });
        assert.ok(result.success);
        assert.equal(result.data.version, '1.0');
    });

    it('aplica default priority=medium', () => {
        const result = StructuredMessageSchema.safeParse({ context: 'c', intent: 'i', responseType: 'code' });
        assert.ok(result.success);
        assert.equal(result.data.priority, 'medium');
    });

    it('aceita todos os responseType válidos', () => {
        const types = ['diagnostic', 'plan', 'code', 'question', 'confirmation', 'error'];
        for (const responseType of types) {
            const result = StructuredMessageSchema.safeParse({ context: 'c', intent: 'i', responseType });
            assert.ok(result.success, `responseType '${responseType}' deveria ser aceito`);
        }
    });

    it('aceita todos os priority válidos', () => {
        const priorities = ['low', 'medium', 'high', 'critical'];
        for (const priority of priorities) {
            const result = StructuredMessageSchema.safeParse({
                context: 'c',
                intent: 'i',
                responseType: 'diagnostic',
                priority,
            });
            assert.ok(result.success, `priority '${priority}' deveria ser aceito`);
        }
    });

    it('rejeita responseType inválido', () => {
        const result = StructuredMessageSchema.safeParse({ context: 'c', intent: 'i', responseType: 'invalid' });
        assert.ok(!result.success);
    });

    it('rejeita priority inválido', () => {
        const result = StructuredMessageSchema.safeParse({
            context: 'c',
            intent: 'i',
            responseType: 'diagnostic',
            priority: 'urgent',
        });
        assert.ok(!result.success);
    });

    it('rejeita context vazio', () => {
        const result = StructuredMessageSchema.safeParse({ context: '', intent: 'i', responseType: 'diagnostic' });
        assert.ok(!result.success);
    });

    it('rejeita intent vazio', () => {
        const result = StructuredMessageSchema.safeParse({ context: 'c', intent: '', responseType: 'diagnostic' });
        assert.ok(!result.success);
    });

    it('aceita campo output opcional', () => {
        const result = StructuredMessageSchema.safeParse({
            context: 'c',
            intent: 'i',
            responseType: 'diagnostic',
            output: 'resultado aqui',
        });
        assert.ok(result.success);
        assert.equal(result.data.output, 'resultado aqui');
    });

    it('aceita campo meta opcional', () => {
        const result = StructuredMessageSchema.safeParse({
            context: 'c',
            intent: 'i',
            responseType: 'diagnostic',
            meta: { sprint: 'A', testCount: 1419 },
        });
        assert.ok(result.success);
        assert.deepEqual(result.data.meta, { sprint: 'A', testCount: 1419 });
    });

    it('aceita toolsUsed como array de strings', () => {
        const result = StructuredMessageSchema.safeParse({
            context: 'c',
            intent: 'i',
            responseType: 'diagnostic',
            toolsUsed: ['bash', 'file'],
        });
        assert.ok(result.success);
        assert.deepEqual(result.data.toolsUsed, ['bash', 'file']);
    });
});

// ─── Constantes ───────────────────────────────────────────────────────────────

describe('RESPONSE_TYPES', () => {
    it('contém os 6 tipos esperados', () => {
        assert.deepEqual(Object.keys(RESPONSE_TYPES).sort(), [
            'code',
            'confirmation',
            'diagnostic',
            'error',
            'plan',
            'question',
        ]);
    });

    it('cada chave tem o mesmo valor string', () => {
        for (const [k, v] of Object.entries(RESPONSE_TYPES)) {
            assert.equal(k, v);
        }
    });
});

describe('PRIORITY_LEVELS', () => {
    it('contém os 4 níveis esperados', () => {
        assert.deepEqual(Object.keys(PRIORITY_LEVELS).sort(), ['critical', 'high', 'low', 'medium']);
    });

    it('cada chave tem o mesmo valor string', () => {
        for (const [k, v] of Object.entries(PRIORITY_LEVELS)) {
            assert.equal(k, v);
        }
    });
});

// ─── buildStructuredRequest ───────────────────────────────────────────────────

describe('buildStructuredRequest', () => {
    it('retorna mensagem válida com campos obrigatórios', () => {
        const msg = buildStructuredRequest(validInput());
        assert.equal(msg.context, validInput().context);
        assert.equal(msg.intent, validInput().intent);
        assert.equal(msg.priority, 'high');
        assert.equal(msg.responseType, 'diagnostic');
        assert.equal(msg.version, '1.0');
    });

    it('aplica defaults quando omitidos', () => {
        const msg = buildStructuredRequest({ context: 'c', intent: 'i', responseType: 'plan' });
        assert.equal(msg.version, '1.0');
        assert.equal(msg.priority, 'medium');
    });

    it('lança ZodError para input inválido', () => {
        assert.throws(
            () => buildStructuredRequest({ context: '', intent: 'i', responseType: 'plan' }),
            (/** @type {any} */ err) => err.constructor.name === 'ZodError',
        );
    });

    it('preserva campos opcionais quando fornecidos', () => {
        const msg = buildStructuredRequest({
            ...validInput(),
            output: 'conteúdo',
            turnNumber: 3,
            meta: { sprint: 'A' },
        });
        assert.equal(msg.output, 'conteúdo');
        assert.equal(msg.turnNumber, 3);
        assert.deepEqual(msg.meta, { sprint: 'A' });
    });
});

// ─── buildStructuredResponse ──────────────────────────────────────────────────

describe('buildStructuredResponse', () => {
    it('cria resposta válida com output', () => {
        const resp = buildStructuredResponse({
            context: 'sprint A concluído',
            intent: 'confirmar testes',
            responseType: 'diagnostic',
            output: '1419 testes passando. Sem falhas.',
        });
        assert.equal(resp.output, '1419 testes passando. Sem falhas.');
        assert.equal(resp.responseType, 'diagnostic');
    });
});

// ─── serializeStructuredMessage ───────────────────────────────────────────────

describe('serializeStructuredMessage', () => {
    it('retorna string com prefixo de instrução por default', () => {
        const msg = buildStructuredRequest(validInput());
        const serialized = serializeStructuredMessage(msg);
        assert.ok(serialized.includes('STRUCTURED_PROTOCOL_V1:'), 'Deve incluir instrução de protocolo');
        assert.ok(serialized.includes('"context"'), 'Deve incluir JSON');
    });

    it('retorna JSON puro quando includeInstruction=false', () => {
        const msg = buildStructuredRequest(validInput());
        const serialized = serializeStructuredMessage(msg, { includeInstruction: false });
        // Deve ser JSON parseável
        const parsed = JSON.parse(serialized);
        assert.equal(parsed.context, validInput().context);
        assert.ok(!serialized.includes('STRUCTURED_PROTOCOL_V1:'), 'Não deve ter instrução');
    });

    it('JSON puro contém todos os campos da mensagem', () => {
        const msg = buildStructuredRequest(validInput());
        const json = JSON.parse(serializeStructuredMessage(msg, { includeInstruction: false }));
        assert.ok('context' in json);
        assert.ok('intent' in json);
        assert.ok('priority' in json);
        assert.ok('responseType' in json);
        assert.ok('version' in json);
    });
});

// ─── parseStructuredResponse ─────────────────────────────────────────────────

describe('parseStructuredResponse', () => {
    /** @param {Partial<import('#copilot/channel/structured-message').StructuredMessage>} extra */
    function validJsonStr(extra = {}) {
        return JSON.stringify({
            version: '1.0',
            context: 'Sprint A concluído.',
            intent: 'Confirmar diagnóstico',
            priority: 'high',
            responseType: 'diagnostic',
            output: '1419 testes passando. 0 falhas.',
            ...extra,
        });
    }

    it('parseia JSON puro direto', () => {
        const result = parseStructuredResponse(validJsonStr());
        assert.ok(result !== null);
        assert.equal(result.responseType, 'diagnostic');
        assert.equal(result.output, '1419 testes passando. 0 falhas.');
    });

    it('parseia bloco ```json ... ```', () => {
        const raw = `Aqui está a resposta:\n\`\`\`json\n${validJsonStr()}\n\`\`\`\nFim.`;
        const result = parseStructuredResponse(raw);
        assert.ok(result !== null, 'Deve parsear bloco ```json');
        assert.equal(result.responseType, 'diagnostic');
    });

    it('parseia bloco ``` ... ``` sem label de linguagem', () => {
        const raw = `Resposta:\n\`\`\`\n${validJsonStr()}\n\`\`\``;
        const result = parseStructuredResponse(raw);
        assert.ok(result !== null, 'Deve parsear bloco ``` sem label');
    });

    it('parseia JSON embutido em texto livre', () => {
        const raw = `Olá! Aqui está o resultado: ${validJsonStr()} Espero que ajude.`;
        const result = parseStructuredResponse(raw);
        assert.ok(result !== null, 'Deve parsear JSON embutido em texto');
    });

    it('isola objetos JSON vizinhos e seleciona apenas o StructuredMessage válido', () => {
        const raw = `telemetria={"noise":true} resposta=${validJsonStr({ output: 'ok' })} trailer={"x":1}`;
        const result = parseStructuredResponse(raw);
        assert.ok(result !== null);
        assert.equal(result.output, 'ok');
    });

    it('não quebra balanceamento com braces dentro de strings JSON', () => {
        const raw = `prefixo ${validJsonStr({ output: 'objeto { interno } e "quote"' })} sufixo`;
        const result = parseStructuredResponse(raw);
        assert.ok(result !== null);
        assert.equal(result.output, 'objeto { interno } e "quote"');
    });

    it('retorna null para texto puro sem JSON', () => {
        const result = parseStructuredResponse('Desculpe, não entendi o protocolo. Pode repetir?');
        assert.equal(result, null);
    });

    it('retorna null para string vazia', () => {
        assert.equal(parseStructuredResponse(''), null);
    });

    it('retorna null para JSON inválido (sem campos obrigatórios)', () => {
        const result = parseStructuredResponse('{"foo": "bar", "baz": 123}');
        assert.equal(result, null, 'JSON sem campos obrigatórios deve retornar null');
    });

    it('retorna null para JSON malformado', () => {
        const result = parseStructuredResponse('{context: "faltando aspas"}');
        assert.equal(result, null);
    });

    it('valida e aplica defaults ao parsear (priority padrão)', () => {
        const jsonSemPriority = JSON.stringify({
            context: 'ctx',
            intent: 'intent',
            responseType: 'plan',
            output: 'algo',
        });
        const result = parseStructuredResponse(jsonSemPriority);
        assert.ok(result !== null);
        assert.equal(result.priority, 'medium', 'Deve aplicar default medium');
    });

    it('retorna null para valores nulos', () => {
        assert.equal(Reflect.apply(parseStructuredResponse, undefined, [null]), null);
        assert.equal(Reflect.apply(parseStructuredResponse, undefined, [undefined]), null);
    });
});

// ─── isStructuredMessage ─────────────────────────────────────────────────────

describe('isStructuredMessage', () => {
    it('retorna true para objeto válido', () => {
        const msg = buildStructuredRequest(validInput());
        assert.ok(isStructuredMessage(msg));
    });

    it('retorna false para objeto inválido', () => {
        assert.ok(!isStructuredMessage({ foo: 'bar' }));
        assert.ok(!isStructuredMessage(null));
        assert.ok(!isStructuredMessage(undefined));
        assert.ok(!isStructuredMessage('string'));
        assert.ok(!isStructuredMessage(42));
    });

    it('retorna false para objeto com responseType inválido', () => {
        assert.ok(
            !isStructuredMessage({
                context: 'c',
                intent: 'i',
                responseType: 'invalid',
            }),
        );
    });
});
