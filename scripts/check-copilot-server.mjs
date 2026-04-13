#!/usr/bin/env node
// @ts-check
/**
 * @file Smoke test do servidor copilot dedicado (server/).
 *
 * Verifica que startCopilotServer() sobe, responde em /health,
 * e encerra limpo. Usado manualmente e em CI.
 *
 * Uso: node scripts/check-copilot-server.mjs
 *
 * Onda 3.2 — L56.5.
 */

import { startCopilotServer } from '../src/copilot/server/index.js';

const TEST_PORT = 13009;

let server;
let exitCode = 0;

try {
    console.log('[smoke] Iniciando startCopilotServer na porta', TEST_PORT, '...');
    server = await startCopilotServer({ port: TEST_PORT, skipAuth: true });
    console.log('[smoke] Servidor subiu em porta', server.port);

    // Teste HTTP /health
    const url = `http://127.0.0.1:${TEST_PORT}/health`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`/health retornou HTTP ${res.status}`);
    }
    const body = await res.json();
    if (body.ok !== true && body.status !== 'ok' && body.status !== 'OK') {
        throw new Error(`/health payload inesperado: ${JSON.stringify(body)}`);
    }
    console.log('[smoke] /health OK —', JSON.stringify(body));

    // Teste Socket.IO — verifica que endpoint /socket.io/socket.io.js está acessível
    const sockUrl = `http://127.0.0.1:${TEST_PORT}/socket.io/socket.io.js`;
    const sockRes = await fetch(sockUrl);
    if (!sockRes.ok) {
        // Socket.IO nem foi inicializado (sem orchestrator/store fornecidos)
        console.log('[smoke] Socket.IO client script não servido (modo sem socket) — esperado.');
    } else {
        console.log('[smoke] Socket.IO client script acessível.');
    }

    console.log('[smoke] Todos os checks passaram ✅');
} catch (/** @type {any} */ err) {
    console.error('[smoke] FALHA:', err.message ?? String(err));
    exitCode = 1;
} finally {
    if (server) {
        await server.close().catch((e) => console.error('[smoke] Erro ao fechar servidor:', e));
        console.log('[smoke] Servidor encerrado.');
    }
}

process.exit(exitCode);
