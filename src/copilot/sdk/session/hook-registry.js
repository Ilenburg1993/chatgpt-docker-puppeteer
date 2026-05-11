// @ts-check
/**
 * Registry canônico de hooks em superfície SDK.
 *
 * @module copilot/sdk/session/hook-registry
 */

export class HookRegistry {
    constructor() {
        /** @type {Map<string, Record<string, unknown>>} */
        this._schemas = new Map();
    }

    /**
     * @param {string} name
     * @param {Record<string, unknown>} schema
     * @returns {this}
     */
    register(name, schema) {
        this._schemas.set(name, { name, ...schema });
        return this;
    }

    /**
     * @param {string} name
     * @returns {Record<string, unknown> | undefined}
     */
    get(name) {
        return this._schemas.get(name);
    }

    /**
     * @returns {Record<string, unknown>[]}
     */
    list() {
        return [...this._schemas.values()];
    }

    /**
     * @param {string} name
     * @returns {boolean}
     */
    isRegistered(name) {
        return this._schemas.has(name);
    }

    /**
     * @param {string} name
     * @param {Record<string, unknown>} input
     * @returns {string | null}
     */
    validate(name, input) {
        const schema = this._schemas.get(name);
        if (!schema) return `Hook '${name}' não está registrado`;
        const inputFields = Array.isArray(schema['inputFields']) ? schema['inputFields'] : [];
        for (const field of inputFields) {
            if (typeof field === 'string' && !(field in input)) {
                return `Hook '${name}': campo obrigatório '${field}' ausente no input`;
            }
        }
        return null;
    }

    /**
     * @returns {Record<string, object>}
     */
    toJSON() {
        /** @type {Record<string, object>} */
        const result = {};
        for (const schema of this._schemas.values()) {
            const hookName = typeof schema['name'] === 'string' ? schema['name'] : 'unknown';
            result[hookName] = {
                description: schema['description'],
                inputFields: schema['inputFields'],
                outputFields: schema['outputFields'],
                canModifyInput: schema['canModifyInput'],
                canAbort: schema['canAbort'],
            };
        }
        return result;
    }
}

/** @type {Readonly<HookRegistry>} */
export const SDK_HOOKS = Object.freeze(
    new HookRegistry()
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
                'Handler de permissão (obrigatório). Chamado antes de cada tool para approve/deny. Kinds: shell, write, read, mcp, custom-tool, url, memory, hook.',
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
        }),
);
