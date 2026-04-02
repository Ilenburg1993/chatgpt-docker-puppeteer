// @ts-check
/**
 * src/copilot/hooks/user-input.js
 *
 * Handlers para `onUserInputRequest` do SDK (Gap 5 do roadmap).
 *
 * `onUserInputRequest` é um parâmetro opcional de `createSession`/`resumeSession`. Quando fornecido, habilita a tool
 * built-in `ask_user` do CLI do Copilot. O handler recebe uma pergunta e deve retornar { answer, wasFreeform }.
 *
 * Este módulo fornece fábricas para diferentes estratégias de input:
 *
 * - Interativo via readline (para terminals)
 * - Programático via fila/callback assíncrono
 * - Respostas pré-definidas (mock, para testes)
 *
 * @module copilot/hooks/user-input
 * @see module:copilot/hooks/types
 */

import { log } from '#copilot/observability/logger';
import { createInterface } from 'node:readline';

/**
 * @typedef {import('./types.js').UserInputHandler} UserInputHandler
 *
 * @typedef {import('./types.js').UserInputRequest} UserInputRequest
 *
 * @typedef {import('./types.js').UserInputResponse} UserInputResponse
 *
 * @typedef {import('./types.js').InvocationContext} InvocationContext
 */

/**
 * @typedef {object} InteractiveInputOptions
 * @property {NodeJS.ReadableStream} [input] Stream de input. Default: process.stdin
 * @property {NodeJS.WritableStream} [output] Stream de output. Default: process.stdout
 * @property {string} [prompt] Prefixo da pergunta. Default: '→ '
 */

/**
 * Cria um `onUserInputRequest` handler interativo via readline. Adequado para agentes rodando em terminal com
 * interatividade humana.
 *
 * @example
 *     const session = await client.createSession({
 *         onUserInputRequest: createReadlineInputHandler(),
 *     });
 *
 * @param {InteractiveInputOptions} [opts]
 * @returns {UserInputHandler}
 */
export function createReadlineInputHandler(opts = {}) {
    const { input = process.stdin, output = process.stdout, prompt = '→ ' } = opts;

    /**
     * @param {UserInputRequest} request
     * @returns {Promise<UserInputResponse>}
     */
    return async function onUserInputRequest(request) {
        const rl = createInterface({ input, output, terminal: true });

        const question = request.question ?? '';
        const choices = request.choices ?? [];
        const allowFreeform = request.allowFreeform !== false;

        let displayText = `\n[ask_user] ${question}`;
        if (choices.length > 0) {
            displayText += `\nOpções: ${choices.map((c, i) => `[${i + 1}] ${c}`).join(' | ')}`;
        }
        if (allowFreeform) {
            displayText += '\n(ou texto livre)';
        }
        displayText += `\n${prompt}`;

        return new Promise((resolve) => {
            rl.question(displayText, (answer) => {
                rl.close();
                // Verifica se a resposta é uma opção numérica
                const idx = parseInt(answer.trim(), 10);
                if (!isNaN(idx) && idx >= 1 && idx <= choices.length) {
                    resolve({ answer: choices[idx - 1] ?? '', wasFreeform: false });
                } else {
                    resolve({ answer: answer.trim(), wasFreeform: true });
                }
            });
        });
    };
}

/**
 * Cria um `onUserInputRequest` handler assíncrono controlado por código. Retorna um handler e um
 * `requestInput(question)` para inserir respostas programaticamente.
 *
 * Útil para orquestração via SSE/WebSocket (a resposta vem externamente).
 *
 * @example
 *     const { handler, requestInput } = createQueuedInputHandler();
 *     // Em outro contexto:
 *     const response = await requestInput({ question: '...' });
 *
 * @returns {{
 *     handler: UserInputHandler;
 *     answerNext: (response: UserInputResponse) => boolean;
 *     listPending: () => UserInputRequest[];
 * }}
 */
export function createQueuedInputHandler() {
    /** @type {{ resolve: (r: UserInputResponse) => void; request: UserInputRequest }[]} */
    const queue = [];

    /**
     * @param {UserInputRequest} request
     * @returns {Promise<UserInputResponse>}
     */
    const handler = async (request) => {
        return new Promise((resolve) => {
            // Publica o request na fila para quem estiver ouvindo
            queue.push({ resolve, request });
            log('DEBUG', `[hooks/user-input] ask_user pendente: ${request.question?.slice(0, 80)}`);
        });
    };

    /**
     * Permite que código externo forneça uma resposta para o próximo request pendente.
     *
     * @param {UserInputResponse} response
     * @returns {boolean} true se havia um request pendente, false se a fila estava vazia
     */
    function answerNext(response) {
        const pending = queue.shift();
        if (!pending) return false;
        pending.resolve(response);
        return true;
    }

    /**
     * Lista todos os requests pendentes (para informar a interface externa).
     *
     * @returns {UserInputRequest[]}
     */
    function listPending() {
        return queue.map((q) => q.request);
    }

    return { handler, answerNext, listPending };
}

/**
 * Cria um `onUserInputRequest` handler com respostas pré-definidas. Útil para testes e mocks.
 *
 * @example
 *     const handler = createStaticInputHandler({ 'Continuar?': 'sim' });
 *
 * @param {Record<string, string>} answers Mapa de pergunta → resposta. Usa fuzzy match (substring, case-insensitive).
 * @param {string} [defaultAnswer] Resposta padrão se a pergunta não tiver match. Default: ''.
 * @returns {UserInputHandler}
 */
export function createStaticInputHandler(answers, defaultAnswer = '') {
    return async function onUserInputRequest(request) {
        const q = (request.question ?? '').toLowerCase();
        for (const [pattern, answer] of Object.entries(answers)) {
            if (q.includes(pattern.toLowerCase())) {
                log('DEBUG', `[hooks/user-input] resposta estática para '${pattern}': ${answer}`);
                return { answer, wasFreeform: false };
            }
        }
        log('DEBUG', `[hooks/user-input] resposta padrão para: ${q.slice(0, 60)}`);
        return { answer: defaultAnswer, wasFreeform: true };
    };
}
