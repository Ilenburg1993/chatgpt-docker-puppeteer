#!/usr/bin/env node
/**
 * Gera o openapi.json atualizado com todas as rotas canônicas de server/routes/. Uso: node scripts/gen-openapi.mjs >
 * src/copilot/api/openapi.json
 */

import { readFileSync, writeFileSync } from 'node:fs';

const specPath = new URL('../src/copilot/api/openapi.json', import.meta.url).pathname;
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

// Update info
spec.info.version = '2.0.0';
spec.info.description =
    'API REST do módulo copilot — endpoints canônicos em server/routes/. ' +
    'Rotas legadas em api/ são stubs @deprecated que delegam para server/routes/.';

// ── helpers ────────────────────────────────────────────────────────────────────

function jsonRes(desc = 'OK') {
    return {
        [desc === 'Created' ? '201' : '200']: {
            description: desc,
            content: { 'application/json': { schema: { type: 'object' } } },
        },
    };
}

function jsonBody() {
    return { content: { 'application/json': { schema: { type: 'object' } } } };
}

function pathParam(name) {
    return { name, in: 'path', required: true, schema: { type: 'string' } };
}

function _queryParam(name, type = 'string') {
    return { name, in: 'query', schema: { type } };
}

function route(method, path, tag, summary, extra = {}) {
    const opId = `${method}_${path
        .replace(/^\/api\/copilot\//, '')
        .replace(/[/{}-]+/g, '_')
        .replace(/_$/, '')}`;
    const entry = { summary, operationId: opId, tags: [tag], responses: jsonRes() };
    if (extra.body) entry.requestBody = jsonBody();
    if (extra.params) entry.parameters = extra.params;
    if (extra.responses) Object.assign(entry.responses, extra.responses);
    const fullPath = path;
    if (!spec.paths[fullPath]) spec.paths[fullPath] = {};
    spec.paths[fullPath][method] = entry;
}

// ── copilot-api/control.js ─────────────────────────────────────────────────────
route('get', '/api/copilot/agent/status', 'agent', 'GET /agent/status — snapshot de status');
route('get', '/api/copilot/agent/health', 'agent', 'GET /agent/health — health check do agent');
route('get', '/api/copilot/agent/session', 'agent', 'GET /agent/session — info da sessão ativa');
route('post', '/api/copilot/agent/start', 'agent', 'POST /agent/start — inicia o agente (admin)', { body: true });
route('post', '/api/copilot/agent/stop', 'agent', 'POST /agent/stop — para o agente (admin)', { body: true });
route('get', '/api/copilot/agent/permissions', 'agent', 'GET /agent/permissions — lista permissões');
route('post', '/api/copilot/agent/permissions', 'agent', 'POST /agent/permissions — atualiza permissões (admin)', {
    body: true,
});
route('post', '/api/copilot/agent/steer', 'agent', 'POST /agent/steer — steering imediato', { body: true });

// ── copilot-api/tasks.js ───────────────────────────────────────────────────────
route('post', '/api/copilot/agent/send', 'agent', 'POST /agent/send — envia mensagem ao agente', { body: true });
route('post', '/api/copilot/agent/answer', 'agent', 'POST /agent/answer — responde pergunta pendente', { body: true });

// ── copilot-api/stream.js ──────────────────────────────────────────────────────
route('get', '/api/copilot/agent/stream/tasks', 'agent', 'GET /agent/stream/tasks — SSE filtrado por tarefas');

// ── copilot-api/dialog.js ──────────────────────────────────────────────────────
route('post', '/api/copilot/agent/dialog/start', 'agent', 'POST /agent/dialog/start — inicia Dialog Loop', {
    body: true,
});
route('post', '/api/copilot/agent/dialog/turn', 'agent', 'POST /agent/dialog/turn — turno de diálogo', { body: true });
route('post', '/api/copilot/agent/dialog/stop', 'agent', 'POST /agent/dialog/stop — encerra Dialog Loop', {
    body: true,
});

// ── routes/agent.js ────────────────────────────────────────────────────────────
route('get', '/api/copilot/context', 'agent', 'GET /context — contexto atual do agent');
route('get', '/api/copilot/quota', 'agent', 'GET /quota — quota de tokens');
route('get', '/api/copilot/pr-budget', 'agent', 'GET /pr-budget — budget de pull requests');
route('get', '/api/copilot/handoff', 'agent', 'GET /handoff — lista handoffs pendentes');
route('post', '/api/copilot/inject', 'agent', 'POST /inject — injeta mensagem no agente', { body: true });
route('post', '/api/copilot/pipeline', 'agent', 'POST /pipeline — executa pipeline', { body: true });
route('post', '/api/copilot/dialog/pause', 'agent', 'POST /dialog/pause — pausa diálogo');
route('post', '/api/copilot/dialog/resume', 'agent', 'POST /dialog/resume — retoma diálogo');
route('post', '/api/copilot/handoff/{id}/accept', 'agent', 'POST /handoff/:id/accept — aceita handoff', {
    body: true,
    params: [pathParam('id')],
});
route('post', '/api/copilot/handoff/{id}/reject', 'agent', 'POST /handoff/:id/reject — rejeita handoff', {
    body: true,
    params: [pathParam('id')],
});

// ── routes/config.js ───────────────────────────────────────────────────────────
route('get', '/api/copilot/config', 'config', 'GET /config — configuração atual');
route('get', '/api/copilot/config/skills', 'config', 'GET /config/skills — lista skills ativas');
route('get', '/api/copilot/config/tools', 'config', 'GET /config/tools — lista tools config');
route('get', '/api/copilot/config/tools/custom', 'config', 'GET /config/tools/custom — lista tools custom');
route(
    'put',
    '/api/copilot/config/infinite-session',
    'config',
    'PUT /config/infinite-session — toggle sessão infinita',
    { body: true },
);
route('put', '/api/copilot/config/skills', 'config', 'PUT /config/skills — atualiza skills', { body: true });
route('put', '/api/copilot/config/tools', 'config', 'PUT /config/tools — atualiza tools config', { body: true });
route('post', '/api/copilot/config/tools/custom', 'config', 'POST /config/tools/custom — registra tool custom', {
    body: true,
});
route(
    'delete',
    '/api/copilot/config/tools/custom/{name}',
    'config',
    'DELETE /config/tools/custom/:name — remove tool custom',
    {
        params: [pathParam('name')],
    },
);

// ── routes/memory.js ───────────────────────────────────────────────────────────
route('get', '/api/copilot/memory', 'memory', 'GET /memory — lista memories');
route('post', '/api/copilot/memory', 'memory', 'POST /memory — armazena memory', { body: true });
route('delete', '/api/copilot/memory/{memoryId}', 'memory', 'DELETE /memory/:memoryId — remove memory', {
    params: [pathParam('memoryId')],
});

// ── routes/git.js ──────────────────────────────────────────────────────────────
route('get', '/api/copilot/git/status', 'git', 'GET /git/status — status git');
route('get', '/api/copilot/git/log', 'git', 'GET /git/log — log de commits');
route('get', '/api/copilot/gh/issues', 'git', 'GET /gh/issues — lista issues');
route('get', '/api/copilot/gh/prs', 'git', 'GET /gh/prs — lista pull requests');
route('get', '/api/copilot/gh/ci', 'git', 'GET /gh/ci — status CI');

// ── routes/sse.js ──────────────────────────────────────────────────────────────
route('get', '/api/copilot/events', 'sse', 'GET /events — SSE stream de eventos');
route('get', '/api/copilot/events/critical', 'sse', 'GET /events/critical — SSE eventos críticos');

// ── routes/health.js ───────────────────────────────────────────────────────────
route('get', '/api/copilot/health', 'health', 'GET /health — health check geral');
route('get', '/api/copilot/hub-health', 'health', 'GET /hub-health — health do ConversationHub');
route('get', '/api/copilot/ws/info', 'health', 'GET /ws/info — info do WebSocket');

// ── routes/observability.js ────────────────────────────────────────────────────
route('get', '/api/copilot/errors', 'observability', 'GET /errors — lista erros recentes');
route('get', '/api/copilot/tool-stats', 'observability', 'GET /tool-stats — estatísticas de tools');
route('post', '/api/copilot/system/reset', 'observability', 'POST /system/reset — reset do sistema');
route('get', '/api/copilot/metrics', 'observability', 'GET /metrics — métricas Prometheus');

// Add x-canonical-source to all paths to indicate source module
for (const [path, methods] of Object.entries(spec.paths)) {
    let source = 'server/routes/';
    if (
        path.includes('/agent/') &&
        !path.includes('/agent/info') &&
        !path.includes('/agent/tools') &&
        !path.includes('/agent/telemetry')
    ) {
        if (
            path.includes('/dialog/start') ||
            path.includes('/dialog/turn') ||
            path.includes('/dialog/stop') ||
            path.includes('/stream') ||
            path.includes('/status') ||
            path.includes('/health') ||
            path.includes('/session') ||
            path.includes('/start') ||
            path.includes('/stop') ||
            path.includes('/permissions') ||
            path.includes('/steer') ||
            path.includes('/send') ||
            path.includes('/answer')
        ) {
            source = 'server/routes/copilot-api/';
        }
    }
    for (const method of Object.values(methods)) {
        method['x-canonical-source'] = source;
    }
}

// Sort paths for readability
const sortedPaths = {};
for (const key of Object.keys(spec.paths).sort()) {
    sortedPaths[key] = spec.paths[key];
}
spec.paths = sortedPaths;

writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');
console.log('Updated openapi.json — total paths:', Object.keys(spec.paths).length);
