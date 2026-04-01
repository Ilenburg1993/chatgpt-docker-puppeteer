// @ts-check
// O terminal LLM-B sempre requer o subsistema Copilot SDK habilitado.
// Configuramos antes dos imports para que todos os módulos vejam o valor correto.
if (!process.env['COPILOT_SDK_ENABLED']) process.env['COPILOT_SDK_ENABLED'] = 'true';

/**
 * src/copilot/terminal-server.js
 *
 * Terminal Permanente LLM-B — wrapper de entrypoint.
 *
 * Este arquivo é o ponto de entrada histórico. Toda a lógica foi migrada para `src/copilot/terminal/` (Fase C da
 * refatoração modular). Este wrapper apenas re-exporta `startTerminalServer` e, quando executado diretamente, chama-o.
 *
 * @module copilot/terminal-server
 *
 * @example
 *     ```bash
 *     # Iniciar diretamente:
 *     node --strip-types src/copilot/terminal-server.js
 *
 *     # Injetar mensagem de LLM-A (com servidor ativo):
 *     curl -X POST http://localhost:3009/inject \
 *       -H 'Content-Type: application/json' \
 *       -d '{"message": "Olá LLM-B!", "from": "llm-a"}'
 *     ```;
 */

export { startTerminalServer } from './terminal/index.js';

import { fileURLToPath } from 'node:url';

// Executa diretamente quando chamado via `node terminal-server.js`
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
    const { startTerminalServer } = await import('./terminal/index.js');
    startTerminalServer().catch((e) => {
        console.error('[TerminalServer] Erro fatal:', e);
        process.exit(1);
    });
}
