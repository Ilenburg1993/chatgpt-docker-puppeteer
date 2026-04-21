#!/usr/bin/env node
// @ts-check
/**
 * @file Smoke test de socket.io do servidor copilot.
 *
 *   Verifica que o namespace /copilot responde a events básicos. Precisa que um servidor copilot esteja rodando (porta
 *   3009 por default).
 *
 *   Uso: node scripts/check-copilot-socket.mjs [porta]
 *
 *   Onda 3.4 — L58.4.
 */

import { io as socketClient } from 'socket.io-client';
import { startCopilotServer } from '../src/copilot/server/index.js';

const TEST_PORT = 13010;
let server;
let socket;
let exitCode = 0;

try {
    console.log('[socket-smoke] Iniciando servidor na porta', TEST_PORT, '...');
    server = await startCopilotServer({ port: TEST_PORT, skipAuth: true });
    console.log('[socket-smoke] Servidor subiu.');

    // Verificar /ws/info antes de socket
    const wsInfoRes = await fetch(`http://127.0.0.1:${TEST_PORT}/ws/info`);
    const wsInfo = await wsInfoRes.json();
    console.log('[socket-smoke] /ws/info:', JSON.stringify(wsInfo));
    if (wsInfo.ok !== true) throw new Error('/ws/info retornou ok=false');

    // Testar conexão socket (namespace /copilot — apenas se socket foi inicializado)
    if (!wsInfo.socketMounted) {
        console.log('[socket-smoke] Socket.IO não montado (sem orchestrator/store) — esperado em modo sem hub.');
        console.log('[socket-smoke] Todos os checks passaram ✅ (modo sem socket)');
    } else {
        await new Promise((resolve, reject) => {
            socket = socketClient(`http://127.0.0.1:${TEST_PORT}/copilot`, {
                timeout: 4000,
                reconnection: false,
            });

            socket.on('connect', () => {
                console.log('[socket-smoke] Socket /copilot conectado ✅');
                socket.emit('sessions:list', { limit: 5 });
            });

            socket.on('sessions:list:result', (/** @type {{ sessions: unknown[] }} */ data) => {
                console.log('[socket-smoke] sessions:list OK —', data.sessions.length, 'sessões');
                resolve(undefined);
            });

            socket.on('connect_error', (/** @type {Error} */ err) => {
                reject(new Error(`Conexão socket falhou: ${err.message}`));
            });

            setTimeout(() => reject(new Error('Timeout — namespace não respondeu em 4s')), 4500);
        });

        console.log('[socket-smoke] Todos os checks passaram ✅');
    }
} catch (/** @type {any} */ err) {
    console.error('[socket-smoke] FALHA:', err.message ?? String(err));
    exitCode = 1;
} finally {
    if (socket) socket.disconnect();
    if (server) {
        await server.close().catch((e) => console.error('[socket-smoke] Erro ao fechar servidor:', e));
        console.log('[socket-smoke] Servidor encerrado.');
    }
}

process.exit(exitCode);
