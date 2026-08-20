// Debug v6: detecta TODOS os conflitos de built-in tools com a API do SDK
// Usa tentativas incrementais para descobrir todos os nomes conflitantes

import { alwaysAliveAgent } from './src/copilot/agent/always-alive-singleton.js';

const conflicts = new Set();
let attempt = 0;

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
        const message = e instanceof Error ? e.message : String(e);
        const match = message.match(/External tool "([^"]+)" conflicts/);
        if (match) {
            const conflictName = match[1];
            if (!conflictName) continue;
            conflicts.add(conflictName);
            console.log(`[conflito #${conflicts.size}] ${conflictName}`);
        } else {
            console.error(`[erro não-conflito]: ${message}`);
            process.exit(1);
        }
    }
}
console.log(`\nTodos os conflitos detectados: ${[...conflicts].join(', ')}`);
process.exit(0);
