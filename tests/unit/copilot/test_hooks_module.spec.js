// @ts-check
/**
 * Testes unitários do sistema de hooks isolado em src/copilot/hooks/
 *
 * Cobertura:
 *
 * - factory.js (createHooks e presets via hooks/)
 * - permission-handler.js
 * - prompt-transformer.js (Gap 1)
 * - tool-interceptor.js (Gap 2 + Gap 3)
 * - user-input.js (Gap 5)
 * - bus.js (Gap 6)
 * - registry.js
 * - composer.js
 * - presets/minimal, audit, safe, deny-all, interactive
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';

// ─── Imports diretos dos novos módulos ────────────────────────────────────────
import {
    attachBus,
    AuditRingBuffer,
    composeHandlers,
    composePreToolUseHandlers,
    conditional,
    createAllowlistHook,
    createArgSanitizerHook,
    createAuditHooks,
    createAuditPostToolHandler,
    createAuditPreset,
    createBlocklistHook,
    createCircuitBreakerHandler,
    createContextInjector,
    createContextualErrorHandler,
    createDenyAllHooks,
    createDenyAllPreset,
    createErrorHandler,
    createErrorNotifierHook,
    createHooks,
    createInteractivePreset,
    createLoggingPromptHook,
    createMinimalHooks,
    createMinimalPreset,
    createPermissionHandler,
    createPostToolEnricher,
    createProductionHooks,
    createPromptTransformer,
    createQueuedInputHandler,
    createSafeHooks,
    createSafePreset,
    createSensitiveDataRedactor,
    createSessionHooks,
    createStaticInputHandler,
    fallback,
    getAuditTail,
    globalAuditBuffer,
    HookBus,
    HookRegistry,
    pipeline,
    raceWithTimeout,
    SDK_HOOKS,
} from '../../../src/copilot/hooks/index.js';

// ─── Helpers de mock ──────────────────────────────────────────────────────────

/** @param {string} toolName @param {object} [args] */
const preInput = (toolName, args = {}) => ({
    toolName,
    toolArgs: args,
    timestamp: Date.now(),
    cwd: '/tmp',
});

/** @param {string} toolName */
const postInput = (toolName) => ({
    toolName,
    toolArgs: {},
    toolResult: 'resultado',
    timestamp: Date.now(),
    cwd: '/tmp',
});

/** @param {string} sessionId */
const inv = (sessionId = 'test-session') => ({ sessionId });

// ─── Seção 1: factory.js ──────────────────────────────────────────────────────

describe('hooks/factory › createHooks', () => {
    it('retorna todos os 6 hook slots quando auditLog: true', () => {
        const h = createHooks({ auditLog: true });
        assert.ok(typeof h.onPreToolUse === 'function');
        assert.ok(typeof h.onPostToolUse === 'function');
        assert.ok(typeof h.onUserPromptSubmitted === 'function');
        assert.ok(typeof h.onSessionStart === 'function');
        assert.ok(typeof h.onSessionEnd === 'function');
        assert.ok(typeof h.onErrorOccurred === 'function');
    });

    it('retorna onPreToolUse sem config (os outros são opcionais)', () => {
        const h = createHooks();
        assert.ok(typeof h.onPreToolUse === 'function');
    });

    it('onPreToolUse permite tool quando sem allowTools', async () => {
        const h = createHooks();
        const result = await h.onPreToolUse(preInput('shell'), inv());
        assert.strictEqual(result?.permissionDecision, 'allow');
    });

    it('onPreToolUse nega tool na denyTools', async () => {
        const h = createHooks({ denyTools: ['shell'] });
        const result = await h.onPreToolUse(preInput('shell'), inv());
        assert.strictEqual(result?.permissionDecision, 'deny');
    });

    it('onPreToolUse nega tool fora da allowTools', async () => {
        const h = createHooks({ allowTools: ['read_file'] });
        const result = await h.onPreToolUse(preInput('shell'), inv());
        assert.strictEqual(result?.permissionDecision, 'deny');
    });

    it('onPreToolUse permite tool na allowTools', async () => {
        const h = createHooks({ allowTools: ['read_file'] });
        const result = await h.onPreToolUse(preInput('read_file'), inv());
        assert.strictEqual(result?.permissionDecision, 'allow');
    });

    it('onPreToolUse nega por denyPatterns', async () => {
        const h = createHooks({ denyPatterns: [/^rm/] });
        const result = await h.onPreToolUse(preInput('rm_rf'), inv());
        assert.strictEqual(result?.permissionDecision, 'deny');
    });

    it('createMinimalHooks permite tudo', async () => {
        const h = createMinimalHooks();
        const r1 = await h.onPreToolUse(preInput('shell'), inv());
        const r2 = await h.onPreToolUse(preInput('delete_file'), inv());
        assert.strictEqual(r1?.permissionDecision, 'allow');
        assert.strictEqual(r2?.permissionDecision, 'allow');
    });

    it('createDenyAllHooks nega tudo', async () => {
        const h = createDenyAllHooks();
        const result = await h.onPreToolUse(preInput('read_file'), inv());
        assert.strictEqual(result?.permissionDecision, 'deny');
    });

    it('createAuditHooks permite tudo (apenas loga)', async () => {
        const h = createAuditHooks();
        const result = await h.onPreToolUse(preInput('run_code'), inv());
        assert.strictEqual(result?.permissionDecision, 'allow');
    });

    it('createSafeHooks nega shell por padrão', async () => {
        const h = createSafeHooks();
        const result = await h.onPreToolUse(preInput('shell'), inv());
        assert.strictEqual(result?.permissionDecision, 'deny');
    });

    it('createErrorNotifierHook invoca callback com error info', async () => {
        let called = false;
        const h = createErrorNotifierHook((err, ctx) => {
            called = true;
            assert.ok(ctx === 'rate_limit');
        });
        await h(
            {
                error: new Error('too many'),
                errorContext: 'rate_limit',
                recoverable: true,
                timestamp: Date.now(),
                cwd: '/tmp',
            },
            inv(),
        );
        assert.ok(called);
    });
});

// ─── Seção 2: permission-handler.js ──────────────────────────────────────────

describe('hooks/permission-handler › createPermissionHandler', () => {
    it('mode approve-all: aprova tudo', async () => {
        const handler = createPermissionHandler({ allowAll: true });
        const result = await handler({ kind: 'shell', toolCallId: '1', toolName: 'shell' });
        assert.ok(
            ['approved'].includes(result?.kind ?? result),
            `esperado approved, recebido: ${JSON.stringify(result)}`,
        );
    });

    it('mode deny-all: nega ferramentas listadas', async () => {
        const handler = createPermissionHandler({ denyTools: ['shell'] });
        const result = await handler({ kind: 'shell', toolCallId: '1', toolName: 'shell' });
        assert.ok(
            result?.kind === 'denied-by-rules' || result === false,
            `esperado denied-by-rules ou false, recebido: ${JSON.stringify(result)}`,
        );
    });
});

// ─── Seção 3: prompt-transformer.js (Gap 1) ───────────────────────────────────

describe('hooks/prompt-transformer (Gap 1 — modifiedPrompt)', () => {
    it('passthrough: sem transformFn retorna {} sem modifiedPrompt', async () => {
        const hook = createPromptTransformer();
        const result = await hook({ prompt: 'Olá', timestamp: Date.now(), cwd: '/tmp' });
        assert.deepStrictEqual(result, {});
    });

    it('transformFn: retorna modifiedPrompt quando prompt muda', async () => {
        const hook = createPromptTransformer({ transformFn: (p) => `PREFIXO: ${p}` });
        const result = await hook({ prompt: 'teste', timestamp: Date.now(), cwd: '/tmp' });
        assert.ok(result.modifiedPrompt?.startsWith('PREFIXO:'));
    });

    it('transformFn: não retorna modifiedPrompt quando resultado é igual', async () => {
        const hook = createPromptTransformer({ transformFn: (p) => p });
        const result = await hook({ prompt: 'sem mudança', timestamp: Date.now(), cwd: '/tmp' });
        assert.deepStrictEqual(result, {});
    });

    it('sensitivePattern: redacta tokens Bearer', async () => {
        const hook = createPromptTransformer({
            sensitivePattern: /Bearer\s+\S+/gi,
            sensitiveReplacement: '[REDACTED]',
        });
        const result = await hook({
            prompt: 'token: Bearer abc123xyz faz isso',
            timestamp: Date.now(),
            cwd: '/tmp',
        });
        assert.ok(result.modifiedPrompt?.includes('[REDACTED]'), 'deve redactar o token');
        assert.ok(!result.modifiedPrompt?.includes('abc123xyz'));
    });

    it('createSensitiveDataRedactor: redacta api-key', async () => {
        const hook = createSensitiveDataRedactor();
        const result = await hook({
            prompt: 'use api-key: secretABC123 para autenticar',
            timestamp: Date.now(),
            cwd: '/tmp',
        });
        assert.ok(result.modifiedPrompt?.includes('[REDACTED]'));
    });

    it('createContextInjector: injeta prefix e suffix', async () => {
        const hook = createContextInjector({ prefix: 'SYS:', suffix: 'END' });
        const result = await hook({ prompt: 'user msg', timestamp: Date.now(), cwd: '/tmp' });
        assert.ok(result.modifiedPrompt?.startsWith('SYS:'));
        assert.ok(result.modifiedPrompt?.endsWith('END'));
    });

    it('createLoggingPromptHook: retorna {} sem modifiedPrompt', async () => {
        const hook = createLoggingPromptHook();
        const result = await hook({ prompt: 'log test', timestamp: Date.now(), cwd: '/tmp' });
        assert.deepStrictEqual(result, {});
    });
});

// ─── Seção 4: tool-interceptor.js (Gap 2 + Gap 3) ────────────────────────────

describe('hooks/tool-interceptor (Gap 2 — modifiedArgs)', () => {
    it('sem regras: permite tool e não modifica args', async () => {
        const hook = createArgSanitizerHook();
        const result = await hook(preInput('shell', { cmd: 'ls' }));
        assert.strictEqual(result.permissionDecision, 'allow');
        assert.ok(!result.modifiedArgs, 'não deve ter modifiedArgs');
    });

    it('defaults: injeta arg ausente', async () => {
        const hook = createArgSanitizerHook({ defaults: { shell: { timeout: 5000 } } });
        const result = await hook(preInput('shell', {}));
        assert.strictEqual(result.permissionDecision, 'allow');
        assert.strictEqual(result.modifiedArgs?.timeout, 5000);
    });

    it('defaults: não sobrescreve arg já presente', async () => {
        const hook = createArgSanitizerHook({ defaults: { shell: { timeout: 5000 } } });
        const result = await hook(preInput('shell', { timeout: 9000 }));
        assert.ok(!result.modifiedArgs, 'arg já presente não deve gerar modifiedArgs');
    });

    it('overrides: força sobreescrita', async () => {
        const hook = createArgSanitizerHook({ overrides: { shell: { allowSudo: false } } });
        const result = await hook(preInput('shell', { allowSudo: true }));
        assert.strictEqual(result.modifiedArgs?.allowSudo, false);
    });

    it('stripArgs: remove arg especificado', async () => {
        const hook = createArgSanitizerHook({ stripArgs: { shell: ['dangerous'] } });
        const result = await hook(preInput('shell', { cmd: 'ls', dangerous: 'yes' }));
        assert.strictEqual(result.permissionDecision, 'allow');
        assert.ok(result.modifiedArgs && !('dangerous' in result.modifiedArgs));
    });

    it('createBlocklistHook: nega tool na lista', async () => {
        const hook = createBlocklistHook(['shell', 'bash']);
        const r1 = await hook(preInput('shell'));
        const r2 = await hook(preInput('read_file'));
        assert.strictEqual(r1.permissionDecision, 'deny');
        assert.strictEqual(r2.permissionDecision, 'allow');
    });

    it('createAllowlistHook: permite só as tools listadas', async () => {
        const hook = createAllowlistHook(['read_file', 'list_dir']);
        const r1 = await hook(preInput('shell'));
        const r2 = await hook(preInput('read_file'));
        assert.strictEqual(r1.permissionDecision, 'deny');
        assert.strictEqual(r2.permissionDecision, 'allow');
    });
});

describe('hooks/tool-interceptor (Gap 3 — onPostToolUse additionalContext)', () => {
    it('sem contextFn: retorna {}', async () => {
        const hook = createPostToolEnricher();
        const result = await hook(postInput('read_file'));
        assert.deepStrictEqual(result, {});
    });

    it('contextFn: retorna additionalContext', async () => {
        const hook = createPostToolEnricher({
            contextFn: (input) => `tool ${input.toolName} executada`,
        });
        const result = await hook(postInput('read_file'));
        assert.ok(result.additionalContext?.includes('read_file'));
    });
});

// ─── Seção 5: user-input.js (Gap 5) ──────────────────────────────────────────

describe('hooks/user-input (Gap 5)', () => {
    it('createStaticInputHandler: responde por substring da pergunta', async () => {
        const handler = createStaticInputHandler({ continuar: 'sim', cancelar: 'nao' });
        const r1 = await handler({ question: 'Deseja continuar?' });
        const r2 = await handler({ question: 'Deseja cancelar?' });
        assert.strictEqual(r1.answer, 'sim');
        assert.strictEqual(r2.answer, 'nao');
    });

    it('createStaticInputHandler: usa defaultAnswer quando sem match', async () => {
        const handler = createStaticInputHandler({}, 'padrão');
        const result = await handler({ question: 'Pergunta sem match' });
        assert.strictEqual(result.answer, 'padrão');
        assert.strictEqual(result.wasFreeform, true);
    });

    it('createQueuedInputHandler: handler fica pendente até answerNext', async () => {
        const { handler, answerNext, listPending } = createQueuedInputHandler();

        let resolved = false;
        const pending = handler({ question: 'Confirmar?' }).then((r) => {
            resolved = true;
            return r;
        });

        // Verifica que está pendente
        assert.ok(listPending().length === 1);
        assert.ok(!resolved);

        // Responde
        answerNext({ answer: 'sim', wasFreeform: false });
        const result = await pending;
        assert.strictEqual(result.answer, 'sim');
    });

    it('createQueuedInputHandler: answerNext retorna false quando fila vazia', () => {
        const { answerNext } = createQueuedInputHandler();
        const result = answerNext({ answer: 'x', wasFreeform: false });
        assert.strictEqual(result, false);
    });
});

// ─── Seção 6: bus.js (Gap 6) ──────────────────────────────────────────────────

describe('hooks/bus (Gap 6 — HookBus)', () => {
    it('HookBus emite eventos por nome de hook', () => {
        const bus = new HookBus();
        let received = null;
        bus.on('pre_tool_use', (event) => {
            received = event;
        });
        bus.emitHook('pre_tool_use', 'sess-1', { toolName: 'shell' }, { permissionDecision: 'allow' });
        assert.ok(received !== null);
        assert.strictEqual(received.hookName, 'pre_tool_use');
        assert.strictEqual(received.sessionId, 'sess-1');
    });

    it('HookBus emite evento wildcard (*)', () => {
        const bus = new HookBus();
        const events = [];
        bus.on('*', (e) => events.push(e.hookName));
        bus.emitHook('session_start', 'sess-2', {}, null);
        bus.emitHook('session_end', 'sess-2', {}, null);
        assert.deepStrictEqual(events, ['session_start', 'session_end']);
    });

    it('attachBus: onPreToolUse observado sem alterar resultado', async () => {
        const hooks = createHooks();
        const bus = new HookBus();
        const events = [];
        bus.on('pre_tool_use', (e) => events.push(e.hookName));

        const withBus = attachBus(hooks, bus);
        const result = await withBus.onPreToolUse(preInput('shell'), inv());
        assert.strictEqual(result?.permissionDecision, 'allow');
        assert.strictEqual(events.length, 1);
    });
});

// ─── Seção 7: registry.js ─────────────────────────────────────────────────────

describe('hooks/registry › SDK_HOOKS', () => {
    it('SDK_HOOKS registra todos os 8 hooks do SDK', () => {
        const list = SDK_HOOKS.list();
        assert.strictEqual(list.length, 8);
    });

    it('SDK_HOOKS.isRegistered: conhecido e desconhecido', () => {
        assert.ok(SDK_HOOKS.isRegistered('onPreToolUse'));
        assert.ok(!SDK_HOOKS.isRegistered('onNaoExiste'));
    });

    it('SDK_HOOKS.validate: retorna null para input válido', () => {
        const result = SDK_HOOKS.validate('onPreToolUse', {
            toolName: 'shell',
            toolArgs: {},
            timestamp: 0,
            cwd: '/tmp',
        });
        assert.strictEqual(result, null);
    });

    it('SDK_HOOKS.validate: mensagem de erro quando campo ausente', () => {
        const result = SDK_HOOKS.validate('onPreToolUse', { toolName: 'shell' });
        assert.ok(typeof result === 'string' && result.includes('toolArgs'));
    });

    it('HookRegistry.register e get', () => {
        const reg = new HookRegistry();
        reg.register('custom_hook', {
            description: 'Hook customizado',
            inputFields: ['customField'],
            outputFields: ['customResult'],
            canModifyInput: false,
            canAbort: false,
        });
        const schema = reg.get('custom_hook');
        assert.ok(schema?.description.includes('customizado'));
    });
});

// ─── Seção 8: composer.js ─────────────────────────────────────────────────────

describe('hooks/composer', () => {
    it('composeHandlers: para no primeiro que retorna permissionDecision', async () => {
        let calls = 0;
        const h1 = async () => {
            calls++;
            return { permissionDecision: 'deny' };
        };
        const h2 = async () => {
            calls++;
            return { permissionDecision: 'allow' };
        };
        const composed = composeHandlers(h1, h2);
        const result = await composed(preInput('shell'), inv());
        assert.strictEqual(result?.permissionDecision, 'deny');
        assert.strictEqual(calls, 1, 'h2 não deve ter sido chamado');
    });

    it('composePreToolUseHandlers (da factory): funciona como composeHandlers', async () => {
        const deny = async () => ({ permissionDecision: 'deny' });
        const allow = async () => ({ permissionDecision: 'allow' });
        const composed = composePreToolUseHandlers(deny, allow);
        const result = await composed(preInput('shell'), inv());
        assert.strictEqual(result?.permissionDecision, 'deny');
    });

    it('pipeline: todos os handlers executam e o resultado é merged', async () => {
        const h1 = async () => ({ additionalContext: 'contexto1' });
        const h2 = async () => ({ additionalContext: 'contexto2' });
        const pipe = pipeline(h1, h2);
        const result = await pipe(postInput('shell'), inv());
        // último sobrescreve
        assert.strictEqual(result?.additionalContext, 'contexto2');
    });

    it('fallback: usa fallback quando primário lança', async () => {
        const primary = async () => {
            throw new Error('falhou');
        };
        const fallbackFn = async () => ({ permissionDecision: 'allow' });
        const composed = fallback(primary, fallbackFn);
        const result = await composed(preInput('shell'), inv());
        assert.strictEqual(result?.permissionDecision, 'allow');
    });

    it('conditional: executa handler só quando predicado true', async () => {
        let executed = false;
        const handler = async () => {
            executed = true;
            return { permissionDecision: 'deny' };
        };
        const elseH = async () => ({ permissionDecision: 'allow' });
        const hook = conditional((input) => input.toolName === 'shell', handler, elseH);

        const r1 = await hook(preInput('read_file'), inv());
        assert.strictEqual(r1?.permissionDecision, 'allow');
        assert.ok(!executed);

        const r2 = await hook(preInput('shell'), inv());
        assert.strictEqual(r2?.permissionDecision, 'deny');
        assert.ok(executed);
    });

    it('raceWithTimeout: retorna resultado do handler quando resolve antes do timeout', async () => {
        const handler = async () => ({ permissionDecision: 'deny' });
        const wrapped = raceWithTimeout(handler, 5000);
        const result = await wrapped(preInput('shell'), inv());
        assert.strictEqual(result?.permissionDecision, 'deny');
    });

    it('raceWithTimeout: retorna undefined quando handler excede timeout', async () => {
        const handler = () => new Promise((resolve) => setTimeout(() => resolve({ permissionDecision: 'deny' }), 500));
        const wrapped = raceWithTimeout(handler, 10);
        const result = await wrapped(preInput('shell'), inv());
        assert.strictEqual(result, undefined);
    });

    it('raceWithTimeout: limpa timer quando handler resolve primeiro (sem leak)', async () => {
        // Se o timer não for limpo, o teste pode vazar o setTimeout.
        // Verificamos indiretamente: handler rápido deve resolver sem pendências.
        const handler = async () => ({ additionalContext: 'ok' });
        const wrapped = raceWithTimeout(handler, 60_000);
        const result = await wrapped(postInput('shell'), inv());
        assert.strictEqual(result?.additionalContext, 'ok');
    });
});

// ─── Seção 9: presets standalone (Gap 7) ──────────────────────────────────────

describe('hooks/presets/minimal', () => {
    it('preset.hooks.onPreToolUse permite tudo', async () => {
        const { hooks } = createMinimalPreset();
        const r = await hooks.onPreToolUse(preInput('shell'), inv());
        assert.strictEqual(r?.permissionDecision, 'allow');
    });

    it('preset.hooks.onSessionEnd não lança', async () => {
        const { hooks } = createMinimalPreset();
        await assert.doesNotReject(() => hooks.onSessionEnd({ reason: 'manual', timestamp: Date.now(), cwd: '/tmp' }));
    });
});

describe('hooks/presets/audit', () => {
    it('registra atividade no audit trail', async () => {
        const { hooks, getAuditTrail, clearAuditTrail } = createAuditPreset();
        clearAuditTrail();
        await hooks.onPreToolUse(preInput('shell'), inv());
        const trail = getAuditTrail();
        assert.ok(trail.length >= 1);
        const last = trail[trail.length - 1];
        assert.strictEqual(last?.data?.hookName, 'onPreToolUse');
    });

    it('clearAuditTrail: limpa o trail', async () => {
        const { hooks, getAuditTrail, clearAuditTrail } = createAuditPreset();
        await hooks.onPreToolUse(preInput('shell'), inv());
        clearAuditTrail();
        assert.strictEqual(getAuditTrail().length, 0);
    });
});

describe('hooks/presets/safe', () => {
    it('pede "ask" para shell', async () => {
        const { hooks } = createSafePreset();
        const r = await hooks.onPreToolUse(preInput('shell'), inv());
        assert.strictEqual(r?.permissionDecision, 'ask');
    });

    it('nega tools do extraDenyTools', async () => {
        const { hooks } = createSafePreset({ extraDenyTools: ['forbidden_tool'] });
        const r = await hooks.onPreToolUse(preInput('forbidden_tool'), inv());
        assert.strictEqual(r?.permissionDecision, 'deny');
    });

    it('recuperável → retry; irrecuperável → abort', async () => {
        const { hooks } = createSafePreset();
        const rRetry = await hooks.onErrorOccurred({
            error: 'oops',
            errorContext: 'net',
            recoverable: true,
            timestamp: Date.now(),
            cwd: '/',
        });
        const rAbort = await hooks.onErrorOccurred({
            error: 'oops',
            errorContext: 'net',
            recoverable: false,
            timestamp: Date.now(),
            cwd: '/',
        });
        assert.strictEqual(rRetry?.errorHandling, 'retry');
        assert.strictEqual(rAbort?.errorHandling, 'abort');
    });
});

describe('hooks/presets/deny-all', () => {
    it('nega tudo por padrão', async () => {
        const { hooks } = createDenyAllPreset();
        const r = await hooks.onPreToolUse(preInput('read_file'), inv());
        assert.strictEqual(r?.permissionDecision, 'deny');
    });

    it('excetuadas são permitidas', async () => {
        const { hooks } = createDenyAllPreset({ exceptTools: ['read_file'] });
        const r = await hooks.onPreToolUse(preInput('read_file'), inv());
        assert.strictEqual(r?.permissionDecision, 'allow');
    });

    it('onSessionStart retorna additionalContext de modo restrito', async () => {
        const { hooks } = createDenyAllPreset();
        const r = await hooks.onSessionStart({ source: 'new', timestamp: Date.now(), cwd: '/' });
        assert.ok(r?.additionalContext?.includes('RESTRITO'));
    });
});

describe('hooks/presets/interactive', () => {
    it('pede "ask" para tools não listadas', async () => {
        const { hooks } = createInteractivePreset();
        const r = await hooks.onPreToolUse(preInput('write_file'), inv());
        assert.strictEqual(r?.permissionDecision, 'ask');
    });

    it('autoAllow: read_file é permitido automaticamente', async () => {
        const { hooks } = createInteractivePreset();
        const r = await hooks.onPreToolUse(preInput('read_file'), inv());
        assert.strictEqual(r?.permissionDecision, 'allow');
    });

    it('autoDeny: nega explicitamente', async () => {
        const { hooks } = createInteractivePreset({ autoDenyTools: ['danger'] });
        const r = await hooks.onPreToolUse(preInput('danger'), inv());
        assert.strictEqual(r?.permissionDecision, 'deny');
    });
});

// ─── Seção 10: createSessionHooks (session-lifecycle.js) ─────────────────────

describe('hooks/session-lifecycle › createSessionHooks', () => {
    /** @returns {import('../../../src/copilot/hooks/types.js').SessionLifecycleContext} */
    function makeCtx(overrides = {}) {
        return {
            emitWebhook: async () => {},
            getModel: () => 'gpt-4',
            scheduleFallback: () => {},
            emit: () => {},
            ...overrides,
        };
    }

    it('onSessionStart: retorna additionalContext com sessionId e model', async () => {
        const ctx = makeCtx();
        const { onSessionStart } = createSessionHooks(ctx);
        const result = await onSessionStart({ source: 'new' }, { sessionId: 'test-123' });
        assert.ok(result.additionalContext?.includes('test-123'));
        assert.ok(result.additionalContext?.includes('gpt-4'));
    });

    it('onSessionEnd: não lança', async () => {
        const ctx = makeCtx();
        const { onSessionEnd } = createSessionHooks(ctx);
        await assert.doesNotReject(() =>
            onSessionEnd({ reason: 'complete', timestamp: Date.now(), cwd: '/' }, { sessionId: 'test-123' }),
        );
    });

    it('onErrorOccurred: agenda fallback quando rate_limit e FALLBACK configurado', () => {
        process.env['COPILOT_FALLBACK_MODEL'] = 'gpt-3.5-turbo';
        let scheduled = null;
        const ctx = makeCtx({
            scheduleFallback: (m) => {
                scheduled = m;
            },
        });
        const { onErrorOccurred } = createSessionHooks(ctx);
        onErrorOccurred(
            { error: 'Too many requests', errorContext: 'rate_limit', recoverable: true },
            { sessionId: 'sess' },
        );
        assert.strictEqual(scheduled, 'gpt-3.5-turbo');
        delete process.env['COPILOT_FALLBACK_MODEL'];
    });
});

// ─── error-handler.js ─────────────────────────────────────────────────────────

describe('createErrorHandler', () => {
    it('retorna estratégia fixa "retry"', async () => {
        const handler = createErrorHandler({ strategy: 'retry', maxRetries: 3 });
        const result = await handler({ error: 'oops', errorContext: 'tool', recoverable: true }, { sessionId: 's' });
        assert.strictEqual(result.errorHandling, 'retry');
        // retryCount começa em 1 na primeira chamada
        assert.strictEqual(result.retryCount, 1);
    });

    it('retorna estratégia fixa "skip"', async () => {
        const handler = createErrorHandler({ strategy: 'skip' });
        const result = await handler({ error: 'err', errorContext: 'tool', recoverable: false }, { sessionId: 's' });
        assert.strictEqual(result.errorHandling, 'skip');
    });

    it('usa função de decisão customizada', async () => {
        const handler = createErrorHandler({
            strategy: (input) => (input.errorContext === 'rate_limit' ? 'retry' : 'abort'),
        });
        const r1 = await handler({ error: 'e', errorContext: 'rate_limit', recoverable: true }, { sessionId: 's' });
        assert.strictEqual(r1.errorHandling, 'retry');
        const r2 = await handler({ error: 'e', errorContext: 'other', recoverable: false }, { sessionId: 's' });
        assert.strictEqual(r2.errorHandling, 'abort');
    });

    it('usa "abort" como padrão quando nenhuma opção passada', async () => {
        const handler = createErrorHandler();
        const result = await handler({ error: 'err', errorContext: '', recoverable: false }, { sessionId: 's' });
        assert.strictEqual(result.errorHandling, 'abort');
    });
});

describe('createCircuitBreakerHandler', () => {
    it('permite retries até maxRetries', async () => {
        // maxRetries: 3 → primeira falha = retry (failures=1, 1<3)
        const handler = createCircuitBreakerHandler({ maxRetries: 3, resetAfterMs: 10_000 });
        const r1 = await handler({ error: 'e', errorContext: 'tool_x', recoverable: true }, { sessionId: 's' });
        assert.strictEqual(r1.errorHandling, 'retry');
        const r2 = await handler({ error: 'e', errorContext: 'tool_x', recoverable: true }, { sessionId: 's' });
        assert.strictEqual(r2.errorHandling, 'retry');
    });

    it('aborta quando circuit está aberto após maxRetries', async () => {
        const tripped = [];
        // maxRetries: 1 → na primeira falha, failures++ = 1 >= 1, abre circuit
        const handler = createCircuitBreakerHandler({
            maxRetries: 1,
            resetAfterMs: 10_000,
            onTrip: (ctx) => tripped.push(ctx),
        });
        // primeira falha → abre o circuit (já retorna abort)
        const r1 = await handler({ error: 'e', errorContext: 'ctx_a', recoverable: true }, { sessionId: 's' });
        assert.strictEqual(r1.errorHandling, 'abort');
        assert.ok(tripped.includes('ctx_a'));
        // segunda falha → circuit ainda aberto → abort
        const r2 = await handler({ error: 'e', errorContext: 'ctx_a', recoverable: true }, { sessionId: 's' });
        assert.strictEqual(r2.errorHandling, 'abort');
    });

    it('contextos diferentes têm contadores isolados', async () => {
        // maxRetries: 2 → ctx_1: failures=1 → 1<2 = retry, mas ctx_2 tem failures=0 → retry também
        const handler = createCircuitBreakerHandler({ maxRetries: 2, resetAfterMs: 10_000 });
        // Primeira falha de ctx_1 — failures=1
        await handler({ error: 'e', errorContext: 'ctx_1', recoverable: true }, { sessionId: 's' });
        // Segunda falha de ctx_1 — failures=2 → abre ctx_1
        await handler({ error: 'e', errorContext: 'ctx_1', recoverable: true }, { sessionId: 's' });
        // ctx_2 ainda sem falhas → deve retornar retry
        const r = await handler({ error: 'e', errorContext: 'ctx_2', recoverable: true }, { sessionId: 's' });
        assert.strictEqual(r.errorHandling, 'retry');
    });

    it('fatalPatterns força abort imediato independente de recoverable', async () => {
        const handler = createCircuitBreakerHandler({
            maxRetries: 5,
            resetAfterMs: 10_000,
            fatalPatterns: ['ERR_SOCKET_CLOSED', 'SESSION_FATAL'],
        });
        const r = await handler(
            { error: 'ERR_SOCKET_CLOSED: connection lost', errorContext: 'ctx', recoverable: true },
            { sessionId: 's' },
        );
        assert.strictEqual(r.errorHandling, 'abort');
    });

    it('transientPatterns trata como recuperável quando recoverable=false', async () => {
        const handler = createCircuitBreakerHandler({
            maxRetries: 3,
            resetAfterMs: 10_000,
            transientPatterns: ['ECONNREFUSED', 'ETIMEDOUT'],
        });
        const r = await handler(
            { error: 'connect ECONNREFUSED 127.0.0.1:3000', errorContext: 'ctx', recoverable: false },
            { sessionId: 's' },
        );
        assert.strictEqual(r.errorHandling, 'retry');
    });

    it('onError callback é chamado para cada erro', async () => {
        const errors = [];
        const handler = createCircuitBreakerHandler({
            maxRetries: 3,
            resetAfterMs: 10_000,
            onError: (input) => errors.push(input.error),
        });
        await handler({ error: 'test-error', errorContext: 'ctx', recoverable: true }, { sessionId: 's' });
        assert.strictEqual(errors.length, 1);
        assert.strictEqual(errors[0], 'test-error');
    });
});

describe('createContextualErrorHandler', () => {
    it('mapeia errorContext para estratégia correta', async () => {
        const handler = createContextualErrorHandler({ rate_limit: 'retry', permission: 'skip' }, 'abort');
        const r1 = await handler({ error: 'e', errorContext: 'rate_limit', recoverable: true }, { sessionId: 's' });
        assert.strictEqual(r1.errorHandling, 'retry');
        const r2 = await handler({ error: 'e', errorContext: 'permission', recoverable: false }, { sessionId: 's' });
        assert.strictEqual(r2.errorHandling, 'skip');
        const r3 = await handler({ error: 'e', errorContext: 'unknown', recoverable: false }, { sessionId: 's' });
        assert.strictEqual(r3.errorHandling, 'abort');
    });
});

// ─── presets/production.js ────────────────────────────────────────────────────

describe('createProductionHooks', () => {
    it('retorna hooks e onPermissionRequest', () => {
        const { hooks, onPermissionRequest } = createProductionHooks();
        assert.ok(typeof hooks.onPreToolUse === 'function');
        assert.ok(typeof hooks.onPostToolUse === 'function');
        assert.ok(typeof hooks.onUserPromptSubmitted === 'function');
        assert.ok(typeof hooks.onSessionStart === 'function');
        assert.ok(typeof hooks.onSessionEnd === 'function');
        assert.ok(typeof hooks.onErrorOccurred === 'function');
        assert.ok(typeof onPermissionRequest === 'function');
    });

    it('onPreToolUse: solicita confirmação para tool fora do allowList quando toolAllowList fornecido', async () => {
        const { hooks } = createProductionHooks({ toolAllowList: ['read_file', 'list_dir'] });
        const result = await hooks.onPreToolUse(
            { toolName: 'run_in_terminal', toolArgs: {}, timestamp: Date.now(), cwd: '/tmp' },
            { sessionId: 'prod-test' },
        );
        // production preset pede confirmação (ask), não nega diretamente, para tools fora do allowList
        assert.ok(result.permissionDecision === 'ask' || result.permissionDecision === 'deny');
    });

    it('onPreToolUse: permite tool dentro do allowList', async () => {
        const { hooks } = createProductionHooks({ toolAllowList: ['read_file', 'list_dir'] });
        const result = await hooks.onPreToolUse(
            { toolName: 'read_file', toolArgs: {}, timestamp: Date.now(), cwd: '/tmp' },
            { sessionId: 'prod-test' },
        );
        assert.strictEqual(result.permissionDecision, 'allow');
    });

    it('onErrorOccurred: usa circuit-breaker por padrão', async () => {
        // circuitBreakerMaxRetries: 2 → abre depois de 2 falhas; 1ª = retry
        const { hooks } = createProductionHooks({ circuitBreakerMaxRetries: 2 });
        const r1 = await hooks.onErrorOccurred(
            { error: 'e', errorContext: 'circuit_test', recoverable: true },
            { sessionId: 's' },
        );
        assert.strictEqual(r1.errorHandling, 'retry');
    });

    it('onSessionStart: retorna additionalContext', async () => {
        const { hooks } = createProductionHooks();
        const result = await hooks.onSessionStart({ sessionId: 'p-1', source: 'new' }, { sessionId: 'p-1' });
        assert.ok(typeof result.additionalContext === 'string');
        assert.ok(result.additionalContext.includes('p-1'));
    });
});

// ─── Seção N: hooks/audit.js (Gap 10) ────────────────────────────────────────

describe('hooks/audit › AuditRingBuffer', () => {
    it('começa vazio', () => {
        const buf = new AuditRingBuffer({ capacity: 10 });
        assert.strictEqual(buf.size, 0);
        assert.strictEqual(buf.total, 0);
        assert.deepStrictEqual(buf.tail(), []);
    });

    it('push e tail retornam entrada inserida', () => {
        const buf = new AuditRingBuffer({ capacity: 10 });
        /** @type {import('../../../src/copilot/hooks/types.js').AuditEntry} */
        const entry = {
            toolName: 'read_file',
            toolArgs: {},
            toolResult: 'ok',
            sessionId: 's1',
            ts: new Date().toISOString(),
            durationMs: 5,
        };
        buf.push(entry);
        assert.strictEqual(buf.size, 1);
        assert.strictEqual(buf.total, 1);
        const tail = buf.tail(1);
        assert.strictEqual(tail.length, 1);
        assert.strictEqual(tail[0].toolName, 'read_file');
    });

    it('tail(n) com n > size retorna todas as entradas disponíveis', () => {
        const buf = new AuditRingBuffer({ capacity: 10 });
        buf.push({ toolName: 'a', toolArgs: {}, toolResult: '', sessionId: 's', ts: '', durationMs: 0 });
        buf.push({ toolName: 'b', toolArgs: {}, toolResult: '', sessionId: 's', ts: '', durationMs: 0 });
        const tail = buf.tail(50);
        assert.strictEqual(tail.length, 2);
    });

    it('comportamento circular — sobrescreve entradas mais antigas quando cheio', () => {
        const buf = new AuditRingBuffer({ capacity: 3 });
        for (let i = 0; i < 5; i++) {
            buf.push({ toolName: `t${i}`, toolArgs: {}, toolResult: '', sessionId: 's', ts: '', durationMs: 0 });
        }
        assert.strictEqual(buf.size, 3); // limitado por capacity
        assert.strictEqual(buf.total, 5); // total > capacity
        const tail = buf.tail(3);
        // deve retornar as 3 mais recentes: t2, t3, t4
        assert.deepStrictEqual(
            tail.map((e) => e.toolName),
            ['t2', 't3', 't4'],
        );
    });

    it('tail(n) retorna em ordem cronológica (mais antiga → mais recente)', () => {
        const buf = new AuditRingBuffer({ capacity: 5 });
        for (let i = 0; i < 4; i++) {
            buf.push({ toolName: `tool_${i}`, toolArgs: {}, toolResult: '', sessionId: 's', ts: '', durationMs: 0 });
        }
        const tail = buf.tail(4);
        assert.deepStrictEqual(
            tail.map((e) => e.toolName),
            ['tool_0', 'tool_1', 'tool_2', 'tool_3'],
        );
    });

    it('clear() esvazia o buffer', () => {
        const buf = new AuditRingBuffer({ capacity: 5 });
        buf.push({ toolName: 'x', toolArgs: {}, toolResult: '', sessionId: 's', ts: '', durationMs: 0 });
        buf.clear();
        assert.strictEqual(buf.size, 0);
        assert.strictEqual(buf.total, 0);
        assert.deepStrictEqual(buf.tail(), []);
    });

    it('tail() com buffer exatamente cheio retorna capacity entradas', () => {
        const buf = new AuditRingBuffer({ capacity: 4 });
        for (let i = 0; i < 4; i++) {
            buf.push({ toolName: `t${i}`, toolArgs: {}, toolResult: '', sessionId: 's', ts: '', durationMs: 0 });
        }
        assert.strictEqual(buf.tail(10).length, 4);
    });
});

describe('hooks/audit › createAuditPostToolHandler', () => {
    it('retorna função assíncrona', () => {
        const handler = createAuditPostToolHandler();
        assert.ok(typeof handler === 'function');
    });

    it('captura entrada no buffer fornecido', async () => {
        const buf = new AuditRingBuffer({ capacity: 10 });
        const handler = createAuditPostToolHandler(null, buf);
        await handler(
            {
                toolName: 'write_file',
                toolArgs: { path: '/tmp/x' },
                toolResult: 'ok',
                timestamp: new Date().toISOString(),
            },
            { sessionId: 'sess-1' },
        );
        const tail = buf.tail(1);
        assert.strictEqual(tail.length, 1);
        assert.strictEqual(tail[0].toolName, 'write_file');
        assert.strictEqual(tail[0].sessionId, 'sess-1');
    });

    it('chama o logger externo com a entrada', async () => {
        const buf = new AuditRingBuffer({ capacity: 10 });
        /** @type {import('../../../src/copilot/hooks/types.js').AuditEntry[]} */
        const captured = [];
        const handler = createAuditPostToolHandler((e) => captured.push(e), buf);
        await handler(
            { toolName: 'bash', toolArgs: {}, toolResult: 'done', timestamp: new Date().toISOString() },
            { sessionId: 'sess-2' },
        );
        assert.strictEqual(captured.length, 1);
        assert.strictEqual(captured[0].toolName, 'bash');
    });

    it('ignora exceção lançada pelo logger externo (não propaga)', async () => {
        const buf = new AuditRingBuffer({ capacity: 10 });
        const badLogger = () => {
            throw new Error('logger falhou');
        };
        const handler = createAuditPostToolHandler(badLogger, buf);
        // não deve lançar
        await assert.doesNotReject(() =>
            handler(
                { toolName: 'any', toolArgs: {}, toolResult: '', timestamp: new Date().toISOString() },
                { sessionId: 'sess-3' },
            ),
        );
        // entrada ainda foi gravada no buffer
        assert.strictEqual(buf.size, 1);
    });

    it('retorna objeto vazio (compatível com onPostToolUse SDK)', async () => {
        const buf = new AuditRingBuffer({ capacity: 10 });
        const handler = createAuditPostToolHandler(null, buf);
        const result = await handler(
            { toolName: 'list_dir', toolArgs: {}, toolResult: ['a.js'], timestamp: new Date().toISOString() },
            { sessionId: 's' },
        );
        assert.ok(result !== undefined);
        assert.deepStrictEqual(result, {});
    });

    it('usa timestamp do input quando fornecido', async () => {
        const buf = new AuditRingBuffer({ capacity: 10 });
        const ts = '2026-01-01T00:00:00.000Z';
        const handler = createAuditPostToolHandler(null, buf);
        await handler({ toolName: 't', toolArgs: {}, toolResult: '', timestamp: ts }, { sessionId: 's' });
        assert.strictEqual(buf.tail(1)[0].ts, ts);
    });
});

describe('hooks/audit › getAuditTail', () => {
    it('delega ao globalAuditBuffer por padrão', () => {
        globalAuditBuffer.clear();
        globalAuditBuffer.push({
            toolName: 'global_tool',
            toolArgs: {},
            toolResult: '',
            sessionId: 's',
            ts: '',
            durationMs: 0,
        });
        const tail = getAuditTail(5);
        assert.ok(tail.some((e) => e.toolName === 'global_tool'));
        globalAuditBuffer.clear();
    });

    it('aceita buffer personalizado como segundo argumento', () => {
        const buf = new AuditRingBuffer({ capacity: 5 });
        buf.push({ toolName: 'custom', toolArgs: {}, toolResult: '', sessionId: 's', ts: '', durationMs: 0 });
        const tail = getAuditTail(5, buf);
        assert.strictEqual(tail.length, 1);
        assert.strictEqual(tail[0].toolName, 'custom');
    });

    it('retorna vazio quando buffer está vazio', () => {
        const buf = new AuditRingBuffer({ capacity: 5 });
        assert.deepStrictEqual(getAuditTail(10, buf), []);
    });
});
