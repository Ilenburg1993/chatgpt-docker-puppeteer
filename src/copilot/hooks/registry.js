// @ts-check
/**
 * src/copilot/hooks/registry.js
 *
 * HookRegistry: registro centralizado e introspecção de hooks disponíveis.
 *
 * Permite listar, validar e documentar todos os hooks do sistema, tanto os 6 do SDK quanto eventuais hooks
 * customizados.
 *
 * @module copilot/hooks/registry
 * @see module:copilot/hooks/types
 */

/**
 * @typedef {import('./types.js').HookSchema} HookSchema
 */

/**
 * Registro tipado de hooks com seus contratos (input/output fields).
 */
export class HookRegistry {
    constructor() {
        /** @type {Map<string, HookSchema>} */
        this._schemas = new Map();
    }

    /**
     * Registra um hook com seu schema.
     *
     * @param {string} name
     * @param {Omit<HookSchema, 'name'>} schema
     * @returns {this}
     */
    register(name, schema) {
        this._schemas.set(name, { name, ...schema });
        return this;
    }

    /**
     * Retorna o schema de um hook registrado.
     *
     * @param {string} name
     * @returns {HookSchema | undefined}
     */
    get(name) {
        return this._schemas.get(name);
    }

    /**
     * Lista todos os hooks registrados.
     *
     * @returns {HookSchema[]}
     */
    list() {
        return [...this._schemas.values()];
    }

    /**
     * Verifica se um hook está registrado.
     *
     * @param {string} name
     * @returns {boolean}
     */
    isRegistered(name) {
        return this._schemas.has(name);
    }

    /**
     * Valida que um objeto de input contém os campos obrigatórios de um hook. Retorna null se válido, ou mensagem de
     * erro se inválido.
     *
     * @param {string} name
     * @param {Record<string, unknown>} input
     * @returns {string | null}
     */
    validate(name, input) {
        const schema = this._schemas.get(name);
        if (!schema) return `Hook '${name}' não está registrado`;

        for (const field of schema.inputFields) {
            if (!(field in input)) {
                return `Hook '${name}': campo obrigatório '${field}' ausente no input`;
            }
        }
        return null;
    }

    /**
     * Retorna um objeto com informações resumidas de todos os hooks para APIs de introspecção.
     *
     * @returns {Record<string, object>}
     */
    toJSON() {
        /** @type {Record<string, object>} */
        const result = {};
        for (const schema of this._schemas.values()) {
            result[schema.name] = {
                description: schema.description,
                inputFields: schema.inputFields,
                outputFields: schema.outputFields,
                canModifyInput: schema.canModifyInput,
                canAbort: schema.canAbort,
            };
        }
        return result;
    }
}

/**
 * Registry pré-populado com todos os hooks do SDK `@github/copilot-sdk`.
 *
 * @type {HookRegistry}
 */
export const SDK_HOOKS = new HookRegistry()
    .register('onPreToolUse', {
        description: 'Intercepta tool antes de executar. Pode allow/deny ou modificar args.',
        inputFields: ['toolName', 'toolArgs', 'timestamp', 'cwd'],
        outputFields: ['permissionDecision', 'modifiedArgs', 'additionalContext'],
        canModifyInput: true,
        canAbort: true,
    })
    .register('onPostToolUse', {
        description: 'Processa resultado após execução da tool. Pode adicionar contexto ao modelo.',
        inputFields: ['toolName', 'toolArgs', 'toolResult', 'timestamp', 'cwd'],
        outputFields: ['additionalContext'],
        canModifyInput: false,
        canAbort: false,
    })
    .register('onUserPromptSubmitted', {
        description: 'Intercepta prompt do usuário. Pode modificar o prompt antes do processamento.',
        inputFields: ['prompt', 'timestamp', 'cwd'],
        outputFields: ['modifiedPrompt'],
        canModifyInput: true,
        canAbort: false,
    })
    .register('onSessionStart', {
        description: 'Executado ao iniciar ou retomar sessão. Pode injetar contexto inicial.',
        inputFields: ['source', 'timestamp', 'cwd'],
        outputFields: ['additionalContext'],
        canModifyInput: false,
        canAbort: false,
    })
    .register('onSessionEnd', {
        description: 'Limpeza ao encerrar sessão.',
        inputFields: ['reason', 'timestamp', 'cwd'],
        outputFields: [],
        canModifyInput: false,
        canAbort: false,
    })
    .register('onErrorOccurred', {
        description: 'Controle de recuperação de erros com estratégias retry/skip/abort.',
        inputFields: ['error', 'errorContext', 'recoverable', 'timestamp', 'cwd'],
        outputFields: ['errorHandling', 'retryCount'],
        canModifyInput: false,
        canAbort: true,
    })
    .register('onPermissionRequest', {
        description:
            'Handler de permissão (obrigatório). Chamado antes de cada tool para approve/deny. ' +
            'Kinds: shell, write, read, mcp, custom-tool, url, memory, hook.',
        inputFields: ['kind', 'toolCallId', 'toolName'],
        outputFields: ['kind'],
        canModifyInput: false,
        canAbort: true,
    })
    .register('onUserInputRequest', {
        description: 'Handler para ask_user (input interativo). Habilita a tool nativa ask_user do CLI.',
        inputFields: ['question', 'choices', 'allowFreeform'],
        outputFields: ['answer', 'wasFreeform'],
        canModifyInput: false,
        canAbort: false,
    });
