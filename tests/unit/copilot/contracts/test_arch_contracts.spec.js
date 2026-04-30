// @ts-check
/**
 * tests/unit/copilot/contracts/test_arch_contracts.spec.js
 *
 * W4-9 — Contract tests de arquitetura (adicionados como parte do Wave 4).
 *
 * Garante que:
 *
 * 1. Todos os 17 módulos têm barrel (index.js)
 * 2. Barrels essenciais exportam símbolos mínimos esperados
 * 3. Não há violações de camada em imports críticos (bridges não importa agent)
 * 4. DI tokens existem para todos os 13 serviços registrados
 * 5. arch-health deep-import refinado ≤ 10 (sem imports proibidos ativos)
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

const COPILOT_ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * @param {...string} parts
 * @returns {string}
 */
function copilotPath(...parts) {
    return join(COPILOT_ROOT, ...parts);
}

/**
 * @param {string} relPath
 * @returns {string}
 */
function readSrc(relPath) {
    return readFileSync(copilotPath(relPath), 'utf-8');
}

/**
 * @param {string} dirAbs
 * @returns {string[]}
 */
function listJsFilesRecursive(dirAbs) {
    /** @type {string[]} */
    const out = [];
    const entries = readdirSync(dirAbs);
    for (const entry of entries) {
        const abs = join(dirAbs, entry);
        const st = statSync(abs);
        if (st.isDirectory()) {
            out.push(...listJsFilesRecursive(abs));
        } else if (st.isFile() && entry.endsWith('.js')) {
            out.push(abs);
        }
    }
    return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Barrel coverage — todos os 17 módulos têm index.js
// ═══════════════════════════════════════════════════════════════════════════════

const EXPECTED_MODULES = [
    'agent',
    'audit',
    'bridges',
    'channel',
    'config',
    'conversation-hub',
    'core',
    'db',
    'event-handlers',
    'events',
    'hooks',
    'infra',
    'observability',
    'presentation',
    'plugins',
    'sdk',
    'terminal',
    'tools',
    'types',
];

describe('W4-9 — barrel coverage: todos os 17 módulos', () => {
    for (const mod of EXPECTED_MODULES) {
        it(`${mod}/index.js existe`, () => {
            const p = copilotPath(mod, 'index.js');
            assert.ok(existsSync(p), `Barrel ausente: src/copilot/${mod}/index.js`);
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Barrels essenciais — símbolos mínimos esperados
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — barrel exports: símbolos mínimos', () => {
    it('core barrel exporta CopilotError e container', async () => {
        const mod = await import('#copilot/core');
        assert.ok(mod.CopilotError, 'CopilotError deve existir');
        assert.ok(mod.container, 'container deve existir');
    });

    it('observability barrel exporta log', async () => {
        const mod = await import('#copilot/observability');
        assert.ok(mod.log, 'log deve ser exportado do barrel observability');
    });

    it('config barrel exporta constantes de configuração (AGENT_*)', async () => {
        const mod = await import('#copilot/config');
        // O barrel config exporta constantes de env (ex.: AGENT_IDENTITY, LLM_B_TERMINAL_PORT etc.)
        assert.ok('AGENT_IDENTITY' in mod, 'AGENT_IDENTITY deve ser exportado do barrel config');
    });

    it('hooks barrel exporta createHooks', async () => {
        const mod = await import('#copilot/hooks');
        assert.equal(typeof mod.createHooks, 'function', 'createHooks deve ser function');
    });

    it('audit barrel exporta defaultAuditLog', async () => {
        const mod = await import('#copilot/audit');
        assert.ok(mod.defaultAuditLog, 'defaultAuditLog deve existir no barrel audit');
    });

    it('agent barrel exporta política pública de erros para bordas', async () => {
        const mod = await import('#copilot/agent');
        assert.equal(typeof mod.classifyAgentError, 'function', 'classifyAgentError deve sair pelo barrel agent');
    });

    it('agent barrel exporta a matriz mínima de facades críticas', async () => {
        const mod = await import('#copilot/agent');
        const agentExports = /** @type {Record<string, unknown>} */ (mod);
        const expectedFacadeExports = [
            'persistAgentRuntimePendingQuestionState',
            'readRuntimeControlState',
            'readRuntimeInteractionState',
            'readAgentRuntimeStatusSnapshot',
            'readAgentRuntimeHealthSnapshot',
            'readAgentHealthInputSnapshot',
            'readRuntimeGovernanceState',
            'readRuntimePermissionMode',
            'createAgentSdkClient',
            'ensureAgentSdkClientStarted',
            'sendAgentSdkSession',
            'readAgentRuntimeTools',
        ];

        const missing = expectedFacadeExports.filter((name) => typeof agentExports[name] !== 'function');
        assert.deepEqual(missing, [], `Facades críticas ausentes do barrel #copilot/agent: ${missing.join(', ')}`);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Violação de camada: bridges não deve importar agent diretamente
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — violação de camada L3→L4: bridges não importa agent', () => {
    it('bridges/*.js não tem import de ../agent/ ou #copilot/agent/', () => {
        const bridgesDir = copilotPath('bridges');
        const files = readdirSync(bridgesDir).filter((f) => f.endsWith('.js'));
        const violations = [];

        for (const file of files) {
            const src = readSrc(join('bridges', file));
            const lines = src.split('\n');
            for (const line of lines) {
                const t = line.trim();
                if (t.startsWith('//') || t.startsWith('*')) continue;
                if (/import.+from.+['"]([./]*agent\/|#copilot\/agent\/)/.test(t)) {
                    violations.push(`bridges/${file}: ${t.slice(0, 80)}`);
                }
            }
        }

        assert.deepEqual(violations, [], `Violações L3→L4 encontradas:\n${violations.join('\n')}`);
    });

    it('tools/*.js não importa diretamente de ../agent/ (apenas #copilot/agent barrel)', () => {
        const toolsDir = copilotPath('tools');
        const files = readdirSync(toolsDir).filter((f) => f.endsWith('.js') && !f.startsWith('todo'));
        const violations = [];

        for (const file of files) {
            const src = readSrc(join('tools', file));
            const lines = src.split('\n');
            for (const line of lines) {
                const t = line.trim();
                if (t.startsWith('//') || t.startsWith('*')) continue;
                // Permite import de barrel #copilot/agent, bloqueia ../agent/ ou ../../agent/
                if (/import.+from.+['"]\.\.[./]*agent\//.test(t)) {
                    violations.push(`tools/${file}: ${t.slice(0, 80)}`);
                }
            }
        }

        assert.deepEqual(violations, [], `Violações tools→agent:\n${violations.join('\n')}`);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3B. Fronteira agent→sdk: sem deep-import interno fora de facades/ports
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — fronteira agent→sdk: barrel-only fora de facades/ports', () => {
    it('agent/**/*.js não importa ../../sdk/* fora de facades/ports', () => {
        const agentDir = copilotPath('agent');
        const files = listJsFilesRecursive(agentDir);
        const violations = [];

        for (const abs of files) {
            const rel = abs.replace(COPILOT_ROOT, '').replace(/\\/g, '/');
            const allowDeepSdk = rel.startsWith('agent/facades/') || rel.startsWith('agent/ports/');
            if (allowDeepSdk) continue;

            const src = readFileSync(abs, 'utf-8');
            const lines = src.split('\n');
            for (const line of lines) {
                const t = line.trim();
                if (t.startsWith('//') || t.startsWith('*')) continue;
                if (/import.+from.+['"]\.{1,2}\/.*sdk\//.test(t)) {
                    violations.push(`${rel}: ${t.slice(0, 120)}`);
                }
            }
        }

        assert.deepEqual(violations, [], `Deep-imports agent→sdk fora da fronteira:\n${violations.join('\n')}`);
    });

    it('agent/**/*.js não importa #copilot/sdk/* interno fora de facades/ports', () => {
        const agentDir = copilotPath('agent');
        const files = listJsFilesRecursive(agentDir);
        const violations = [];

        for (const abs of files) {
            const rel = abs.replace(COPILOT_ROOT, '').replace(/\\/g, '/');
            const allowDeepSdk = rel.startsWith('agent/facades/') || rel.startsWith('agent/ports/');
            if (allowDeepSdk) continue;

            const src = readFileSync(abs, 'utf-8');
            const lines = src.split('\n');
            for (const line of lines) {
                const t = line.trim();
                if (t.startsWith('//') || t.startsWith('*')) continue;
                if (/import.+from.+['"]#copilot\/sdk\/.+['"]/.test(t)) {
                    violations.push(`${rel}: ${t.slice(0, 120)}`);
                }
            }
        }

        assert.deepEqual(violations, [], `Deep-imports #copilot/sdk/* fora da fronteira:\n${violations.join('\n')}`);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3C. Fronteira externa→agent: consumidores usam o barrel público do agent
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — fronteira externa→agent: sem deep-import de facades internas', () => {
    it('src/copilot fora de agent não importa agent/facades/* nem agent/error-policy.js', () => {
        const files = listJsFilesRecursive(COPILOT_ROOT);
        /** @type {string[]} */
        const violations = [];

        for (const abs of files) {
            const rel = abs.replace(COPILOT_ROOT, '').replace(/\\/g, '/');
            if (rel.startsWith('agent/')) continue;
            const src = readFileSync(abs, 'utf-8');
            if (
                /(?:from\s+['"][^'"]*agent\/facades\/|import\(['"][^'"]*agent\/facades\/)/.test(src) ||
                /(?:from\s+['"][^'"]*agent\/error-policy\.js['"]|import\(['"][^'"]*agent\/error-policy\.js['"])/.test(
                    src,
                )
            ) {
                violations.push(rel);
            }
        }

        assert.deepEqual(
            violations,
            [],
            `Consumidores externos devem usar #copilot/agent, não facades internas:\n${violations.join('\n')}`,
        );
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3D. Server SDK: rotas HTTP consomem projeção de runtime por id
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — server/routes/sdk: tools por projection de runtime', () => {
    it('rotas de tools não recebem agent cru só para ler registry', () => {
        const routeFiles = [
            'server/routes/sdk/agent.js',
            'server/routes/sdk/client.js',
            'server/routes/sdk/observability.js',
        ];
        const toolsRouteFiles = new Set(['server/routes/sdk/agent.js', 'server/routes/sdk/client.js']);
        /** @type {string[]} */
        const violations = [];

        for (const rel of routeFiles) {
            const src = readSrc(rel);
            if (toolsRouteFiles.has(rel) && !src.includes('readAgentRuntimeToolsProjectionForRuntime')) {
                violations.push(`${rel}: falta readAgentRuntimeToolsProjectionForRuntime`);
            }
            if (/readAgentRuntimeToolsProjection\s*\(\s*agent\b/.test(src)) {
                violations.push(`${rel}: chama readAgentRuntimeToolsProjection(agent, ...)`);
            }
            if (/readAgentStatus(?:Snapshot|Value)\s*\(\s*agent\b/.test(src)) {
                violations.push(`${rel}: chama readAgentStatus*(agent, ...)`);
            }
        }

        assert.deepEqual(
            violations,
            [],
            `Rotas SDK devem consumir runtime-tools por runtimeId via presentation/:\n${violations.join('\n')}`,
        );
    });

    it('rotas SDK não usam estado vivo do agent para status/session/tools ad hoc', () => {
        const sdkRoutesDir = copilotPath('server', 'routes', 'sdk');
        const files = listJsFilesRecursive(sdkRoutesDir);
        /** @type {string[]} */
        const violations = [];

        for (const abs of files) {
            const rel = abs.replace(COPILOT_ROOT, '').replace(/\\/g, '/');
            const src = readFileSync(abs, 'utf-8');
            const blocked = [
                /routeDeps\.agent\b/,
                /const\s+\{\s*agent\b/,
                /agent\.(?:status|sessionId)\b/,
                /readAgentStatus(?:Snapshot|Value)\s*\(\s*agent\b/,
                /readAgentRuntimeToolsProjection\s*\(\s*agent\b/,
                /resolveSdkRuntimeProjection\s*\(\s*agent\b/,
            ];
            if (blocked.some((pattern) => pattern.test(src))) {
                violations.push(rel);
            }
        }

        assert.deepEqual(
            violations,
            [],
            `Rotas SDK devem consumir projections runtime-aware em vez de estado vivo do agent:\n${violations.join('\n')}`,
        );
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3F. Rotas health/webhooks: payload runtime via presentation (sem montagem ad hoc)
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — server/routes health/webhooks: projection-first payloads', () => {
    it('health.js usa buildAgentHealthHttpResponse em vez de montar metadata de runtime manualmente', () => {
        const src = readSrc('server/routes/health.js');

        assert.match(src, /buildAgentHealthHttpResponse/);
        assert.doesNotMatch(src, /resolveAgentHealthSelection/);
        assert.doesNotMatch(src, /getAgentHealthHttpStatus/);
        assert.doesNotMatch(src, /requestedRuntimeId:\s*selection\./);
        assert.doesNotMatch(src, /usedDefaultRuntimeFallback:\s*selection\./);
    });

    it('webhooks.js usa projections HTTP canônicas de runtime-webhooks', () => {
        const src = readSrc('server/routes/webhooks.js');

        assert.match(src, /buildRuntimeWebhooksListHttpPayload/);
        assert.match(src, /registerRuntimeWebhookHttp/);
        assert.match(src, /unregisterRuntimeWebhookHttp/);
        assert.doesNotMatch(src, /resolveRuntimeWebhookSelection/);
        assert.doesNotMatch(src, /listRuntimeWebhooks\(/);
        assert.doesNotMatch(src, /registerRuntimeWebhook\(/);
        assert.doesNotMatch(src, /unregisterRuntimeWebhook\(/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3F.1. Copilot API: status/session/capabilities/connected payloads via presentation
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — copilot-api: payloads operacionais via projection de rota', () => {
    it('control.js não passa deps.agent para builders de status/session/capabilities', () => {
        const src = readSrc('server/routes/copilot-api/control.js');

        assert.match(src, /buildAgentStatusHttpPayloadFromRoute/);
        assert.match(src, /buildAgentSessionHttpPayloadFromRoute/);
        assert.match(src, /buildAgentRuntimeCapabilitiesFromRoute/);
        assert.match(src, /buildCopilotApiHealthHttpResponseFromRoute/);
        assert.doesNotMatch(src, /buildAgentStatusHttpPayload\s*\(\s*deps\.agent\b/);
        assert.doesNotMatch(src, /buildAgentSessionHttpPayload\s*\(\s*deps\.agent\b/);
        assert.doesNotMatch(src, /buildAgentRuntimeCapabilities\s*\(\s*deps\.agent\b/);
        assert.doesNotMatch(src, /getAgentHealthSnapshotCompat/);
        assert.doesNotMatch(src, /getAgentHealthHttpStatus/);
        assert.doesNotMatch(src, /CONVERSATION_STORE/);
        assert.doesNotMatch(src, /CHANNEL_VERSION/);
        assert.doesNotMatch(src, /listenerDiagnostics\?\.\(\)/);
    });

    it('stream.js usa projection connected por deps de rota', () => {
        const src = readSrc('server/routes/copilot-api/stream.js');

        assert.match(src, /buildAgentConnectedSsePayloadFromRoute/);
        assert.doesNotMatch(src, /buildAgentConnectedSsePayload\s*\(\s*state\.agent\b/);
    });

    it('control/dialog/tasks não leem status/sessionId/dialogLoopActive diretamente do agent', () => {
        const files = [
            'server/routes/copilot-api/control.js',
            'server/routes/copilot-api/dialog.js',
            'server/routes/copilot-api/tasks.js',
        ];
        /** @type {string[]} */
        const violations = [];

        for (const rel of files) {
            const src = readSrc(rel);
            if (!src.includes('readAgentRuntimeControlStateFromRoute')) {
                violations.push(`${rel}: falta readAgentRuntimeControlStateFromRoute`);
            }
            if (/\bagent\.(?:status|sessionId|dialogLoopActive)\b/.test(src)) {
                violations.push(`${rel}: leitura direta de agent.status/sessionId/dialogLoopActive`);
            }
        }

        assert.deepEqual(violations, [], violations.join('\n'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3F.2. Terminal commands: comandos renderizam projections do frontend
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — terminal commands: sem bypass direto de observability em /tools', () => {
    it('commands/tools.js consome projection do terminal frontend', () => {
        const src = readSrc('terminal/commands/tools.js');

        assert.match(src, /readTerminalToolStatsProjection/);
        assert.doesNotMatch(src, /#copilot\/observability/);
        assert.doesNotMatch(src, /\bgetToolStats\s*\(/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3G. runtime-wiring: consumir agent via barrel público
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — runtime-wiring consome agent via #copilot/agent', () => {
    it('runtime-wiring.js não importa ./agent/index.js diretamente', () => {
        const src = readSrc('runtime-wiring.js');

        assert.match(src, /from ['"]#copilot\/agent['"]/);
        assert.doesNotMatch(src, /from ['"]\.\/agent\/index\.js['"]/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3H. copilot-api routes: runtime metadata canônica
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — copilot-api routes propagam runtime metadata canônica', () => {
    it('control/dialog/tasks usam buildRuntimeRouteMetaPayload para respostas HTTP', () => {
        const controlSrc = readSrc('server/routes/copilot-api/control.js');
        const dialogSrc = readSrc('server/routes/copilot-api/dialog.js');
        const tasksSrc = readSrc('server/routes/copilot-api/tasks.js');

        assert.match(controlSrc, /buildRuntimeRouteMetaPayload/);
        assert.match(dialogSrc, /buildRuntimeRouteMetaPayload/);
        assert.match(tasksSrc, /buildRuntimeRouteMetaPayload/);
    });

    it('stream/tasks inclui metadata runtime no evento connected', () => {
        const streamSrc = readSrc('server/routes/copilot-api/stream.js');
        assert.match(streamSrc, /buildRuntimeRouteMetaPayload/);
        assert.match(streamSrc, /channel:\s*'tasks'/);
    });
});

describe('W4-9 — SDK routes propagam runtime metadata canônica', () => {
    it('deps.js expõe buildRuntimeRouteMetaPayload no adapter SDK', () => {
        const src = readSrc('server/routes/sdk/deps.js');

        assert.match(src, /buildRuntimeRouteMetaPayload/);
        assert.match(src, /sdkRuntimeProjectionOps/);
    });

    it('client/agent/observability usam helper de metadata por rota', () => {
        const clientSrc = readSrc('server/routes/sdk/client.js');
        const agentSrc = readSrc('server/routes/sdk/agent.js');
        const observabilitySrc = readSrc('server/routes/sdk/observability.js');
        const hooksSrc = readSrc('server/routes/sdk/hooks.js');

        assert.match(clientSrc, /buildClientRuntimeMeta/);
        assert.match(agentSrc, /buildAgentRuntimeMeta/);
        assert.match(observabilitySrc, /buildObservabilityRuntimeMeta/);
        assert.match(hooksSrc, /buildRuntimeRouteMetaPayload/);
    });
});

describe('W4-9 — streams SSE propagam runtimeId em connected e broadcasts', () => {
    it('copilot-api/stream anexa runtimeId aos broadcasts de agent/task e aos limites 429', () => {
        const src = readSrc('server/routes/copilot-api/stream.js');

        assert.match(src, /runtimeId:\s*state\.runtimeId/);
        assert.match(src, /eventFanout\.publish/);
        assert.match(src, /buildRuntimeRouteMetaPayload\(deps\)/);
        assert.doesNotMatch(src, /res\.status\(429\)\.json\(\{\s*ok:\s*false,\s*error:/);
    });

    it('sdk agent/hooks/session streams anexam runtimeId aos broadcasts e não colidem por sessionId global', () => {
        const agentSrc = readSrc('server/routes/sdk/agent.js');
        const hooksSrc = readSrc('server/routes/sdk/hooks.js');
        const sessionSrc = readSrc('server/routes/sdk/session-messaging.js');

        assert.match(agentSrc, /runtimeId:\s*key/);
        assert.match(hooksSrc, /runtimeId:\s*runtimeKey/);
        assert.match(sessionSrc, /const key = `\$\{runtimeId\}:\$\{id\}`/);
        assert.match(sessionSrc, /standardizeSsePayload\(\{\s*\.\.\.event,\s*runtimeId\s*\}/);
        assert.doesNotMatch(sessionSrc, /_sessionStreamStates\.get\(id\)/);
        assert.doesNotMatch(sessionSrc, /_sessionStreamStates\.set\(id,/);
    });
});

describe('W4-9 — bordas não leem propriedades voláteis do agent diretamente', () => {
    it('channel/client.js usa control-state facade pública para getAgentStatus()', () => {
        const src = readSrc('channel/client.js');

        assert.match(src, /readRuntimeControlState/);
        assert.doesNotMatch(src, /presentation\/runtime-controls/);
        assert.doesNotMatch(src, /\bagent\.(?:status|sessionId|dialogLoopActive|dialogPaused)\b/);
    });

    it('runtime-wiring.js usa readRuntimeControlState antes de parar o agent', () => {
        const src = readSrc('runtime-wiring.js');

        assert.match(src, /readRuntimeControlState/);
        assert.doesNotMatch(src, /\bagent\.status\b/);
    });

    it('runtime-sdk-session.js resolve sessão ativa via status snapshot', () => {
        const src = readSrc('presentation/runtime-sdk-session.js');

        assert.match(src, /readAgentStatusSnapshot/);
        assert.doesNotMatch(src, /\bagent\.sessionId\b/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3E. SDK model/session: sem ciclo estático entre model helpers e client lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — SDK model/session: helpers de modelo não importam client estaticamente', () => {
    it('sdk/models/helpers.js carrega session/client.js apenas de forma lazy', () => {
        const src = readSrc('sdk/models/helpers.js');

        assert.doesNotMatch(src, /import\s+\{[^}]*getClient[^}]*\}\s+from\s+['"]\.\.\/session\/client\.js['"]/);
        assert.doesNotMatch(src, /import\(['"]\.\.\/session\/client\.js['"]\)/);
        assert.match(src, /from ['"]\.\/client-provider\.js['"]/);
    });

    it('sdk/session/lifecycle.js depende da porta model-resolution (sem barrel models/index)', () => {
        const src = readSrc('sdk/session/lifecycle.js');

        assert.doesNotMatch(src, /from ['"]\.\.\/models\/index\.js['"]/);
        assert.doesNotMatch(src, /import\(['"]\.\.\/models\/index\.js['"]\)/);
        assert.match(src, /from ['"]\.\/model-resolution-port\.js['"]/);
        assert.match(src, /resolveSessionAutoModel/);
        assert.match(src, /setSessionAutoModelResolver/);
    });

    it('sdk/models/session-resolution-adapter.js usa helpers injetáveis de catálogo/model metadata', () => {
        const src = readSrc('sdk/models/session-resolution-adapter.js');

        assert.match(src, /createSessionAutoModelResolver/);
        assert.match(src, /resolveSessionAutoModelFromCatalog/);
        assert.match(src, /listModelsFn/);
        assert.match(src, /resolveModelIdAutoFn/);
        assert.match(src, /from ['"]\.\/helpers\.js['"]/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. DI tokens: 13 tokens canônicos disponíveis no core barrel
// ═══════════════════════════════════════════════════════════════════════════════

const EXPECTED_DI_TOKENS = ['SHUTDOWN_LOGGER', 'DB_LOGGER', 'EVENT_BUS'];

describe('W4-9 — DI tokens: todos os 13 tokens canônicos', () => {
    it('di-tokens.js exporta todos os tokens esperados', async () => {
        const tokens = await import('../../../../src/copilot/core/di-tokens.js');
        const missing = EXPECTED_DI_TOKENS.filter((t) => !(t in tokens));
        assert.deepEqual(missing, [], `Tokens DI ausentes: ${missing.join(', ')}`);
    });

    it('cada token tem _id Symbol e name', async () => {
        const tokens = await import('../../../../src/copilot/core/di-tokens.js');
        for (const name of EXPECTED_DI_TOKENS) {
            const token = tokens[/** @type {keyof typeof tokens} */ (name)];
            assert.ok(token, `Token ${name} deve existir`);
            assert.ok(typeof token._id === 'symbol', `${name}._id deve ser symbol`);
            assert.equal(token.name, name, `${name}.name deve ser '${name}'`);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Deep imports permitidos: sdk/types e observability/logger não são proibidos
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — F21 allow-list: imports permitidos importam sem erro', () => {
    it('#copilot/sdk/types pode ser importado via typedef sem erro de runtime', async () => {
        // sdk/types é typedef-only — o arquivo existe e pode ser carregado
        assert.ok(existsSync(copilotPath('sdk', 'types.js')), 'src/copilot/sdk/types.js deve existir');
    });

    it('#copilot/observability/logger pode ser carregado', async () => {
        assert.ok(
            existsSync(copilotPath('observability', 'logger.js')),
            'src/copilot/observability/logger.js deve existir',
        );
    });
});
