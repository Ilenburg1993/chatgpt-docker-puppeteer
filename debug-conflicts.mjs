// Debug v6: detecta TODOS os conflitos de built-in tools com a API do SDK
// Usa tentativas incrementais para descobrir todos os nomes conflitantes

import { alwaysAliveAgent } from './src/copilot/agent/always-alive.js';

const conflicts = new Set();
let attempt = 0;

// Interceptar o log do always-alive para capturar erros de conflito
const _oldEmit = alwaysAliveAgent.emit.bind(alwaysAliveAgent);

while (attempt < 20) {
    attempt++;
    try {
        await alwaysAliveAgent.start();
        // Se chegou aqui, boot funcionou
        console.log(`\n[OK] Boot bem-sucedido após ${attempt} tentativas!`);
        console.log(`Conflitos detectados: ${[...conflicts].join(', ')}`);
        await alwaysAliveAgent.stop();
        process.exit(0);
    } catch (e) {
        const match = e.message?.match(/External tool "([^"]+)" conflicts/);
        if (match) {
            conflicts.add(match[1]);
            console.log(`[conflito #${conflicts.size}] ${match[1]}`);
        } else {
            console.error(`[erro não-conflito]: ${e.message}`);
            process.exit(1);
        }
    }
}
console.log(`\nTodos os conflitos detectados: ${[...conflicts].join(', ')}`);
process.exit(0);
