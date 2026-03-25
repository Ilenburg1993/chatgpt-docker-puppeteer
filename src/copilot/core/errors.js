// @ts-check
/**
 * src/copilot/core/errors.js
 *
 * Classes de erro semântico para o módulo copilot.
 *
 * Fornece uma hierarquia de erros tipados que routers, bridges e agentes podem lançar e capturar com tratamento
 * diferenciado por tipo.
 *
 * @module copilot/core/errors
 */

/**
 * Erro base para o módulo copilot.
 *
 * @extends {Error}
 */
export class CopilotError extends Error {
    /**
     * @param {string} message - Mensagem descritiva do erro.
     * @param {string} [code='COPILOT_ERROR'] - Código semântico do erro. Default is `'COPILOT_ERROR'`
     */
    constructor(message, code = 'COPILOT_ERROR') {
        super(message);
        this.name = 'CopilotError';
        /** @type {string} */
        this.code = code;
    }
}

/**
 * Erro de sessão do Copilot SDK. Lançado quando há falha na criação, restauração ou gerenciamento de sessões.
 *
 * @extends {CopilotError}
 */
export class SessionError extends CopilotError {
    /**
     * @param {string} message - Mensagem descritiva do erro.
     * @param {string} [code='SESSION_ERROR'] - Código semântico do erro. Default is `'SESSION_ERROR'`
     */
    constructor(message, code = 'SESSION_ERROR') {
        super(message, code);
        this.name = 'SessionError';
    }
}

/**
 * Erro de bridge (HTTP, NERV, Git, GH, MCP). Lançado quando há falha na comunicação com serviços externos ou internos.
 *
 * @extends {CopilotError}
 */
export class BridgeError extends CopilotError {
    /**
     * @param {string} message - Mensagem descritiva do erro.
     * @param {string} [code='BRIDGE_ERROR'] - Código semântico do erro. Default is `'BRIDGE_ERROR'`
     */
    constructor(message, code = 'BRIDGE_ERROR') {
        super(message, code);
        this.name = 'BridgeError';
    }
}
