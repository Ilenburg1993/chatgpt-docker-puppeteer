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
 * @see module:copilot/always-alive
 * @see module:copilot/agent/dialog-loop-manager
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

/**
 * Erro de configuração. Lançado quando parâmetros de entrada, opções ou configurações são inválidos.
 *
 * @extends {CopilotError}
 */
export class ConfigError extends CopilotError {
    /**
     * @param {string} message - Mensagem descritiva do erro.
     * @param {string} [code='CONFIG_ERROR'] - Código semântico do erro. Default is `'CONFIG_ERROR'`
     */
    constructor(message, code = 'CONFIG_ERROR') {
        super(message, code);
        this.name = 'ConfigError';
    }
}

/**
 * Erro de tool. Lançado quando há falha na execução, registro ou validação de tools.
 *
 * @extends {CopilotError}
 */
export class ToolError extends CopilotError {
    /**
     * @param {string} message - Mensagem descritiva do erro.
     * @param {string} [code='TOOL_ERROR'] - Código semântico do erro. Default is `'TOOL_ERROR'`
     */
    constructor(message, code = 'TOOL_ERROR') {
        super(message, code);
        this.name = 'ToolError';
    }
}

/**
 * Erro de timeout. Lançado quando uma operação excede o tempo limite.
 *
 * @extends {CopilotError}
 */
export class TimeoutError extends CopilotError {
    /**
     * @param {string} message - Mensagem descritiva do erro.
     * @param {string} [code='TIMEOUT'] - Código semântico do erro. Default is `'TIMEOUT'`
     */
    constructor(message, code = 'TIMEOUT') {
        super(message, code);
        this.name = 'TimeoutError';
    }
}

/**
 * Erro de validação. Lançado quando dados de entrada falham em validação de schema/formato.
 *
 * @extends {CopilotError}
 */
export class ValidationError extends CopilotError {
    /**
     * @param {string} message - Mensagem descritiva do erro.
     * @param {string} [code='VALIDATION_ERROR'] - Código semântico do erro. Default is `'VALIDATION_ERROR'`
     */
    constructor(message, code = 'VALIDATION_ERROR') {
        super(message, code);
        this.name = 'ValidationError';
    }
}

/**
 * Erro de transição de estado inválida (ex: FSM do AgentContext).
 *
 * @extends {CopilotError}
 */
export class StateTransitionError extends CopilotError {
    /**
     * @param {string} message - Mensagem descritiva do erro.
     * @param {string} [code='STATE_TRANSITION'] - Código semântico do erro. Default is `'STATE_TRANSITION'`
     */
    constructor(message, code = 'STATE_TRANSITION') {
        super(message, code);
        this.name = 'StateTransitionError';
    }
}
