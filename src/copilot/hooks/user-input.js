// @ts-check
/**
 * Compat layer de user input para hooks.
 *
 * Na arquitetura 2.0/2.1, o núcleo canônico de `ask_user` / `onUserInputRequest` fica em `sdk/session/user-input.js`.
 * Este módulo preserva a API histórica de `#copilot/hooks` delegando 100% da lógica para o SDK.
 *
 * @module copilot/hooks/user-input
 */

export { createQueuedInputHandler, createReadlineInputHandler, createStaticInputHandler } from '#copilot/sdk';
