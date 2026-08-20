// @ts-check
import sinon from 'sinon';

/**
 * Cria um logger mockado com todos os métodos
 *
 * @returns {object} Logger mockado com spies do sinon
 */
function criarLoggerMock() {
    return {
        log: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),

        // Helpers para asserções
        obterLogs: function (/** @type {string | undefined} */ nivel) {
            const self = /** @type {Record<string, any>} */ (this);
            if (!nivel) {
                return self['log'].getCalls().map((/** @type {{ args: unknown[] }} */ call) => call.args);
            }
            return self[nivel].getCalls().map((/** @type {any} */ call) => call.args);
        },

        limpar: function () {
            const self = /** @type {Record<string, any>} */ (this);
            self['log'].resetHistory();
            self['info'].resetHistory();
            self['warn'].resetHistory();
            self['error'].resetHistory();
            self['debug'].resetHistory();
        },

        verificarChamado: function (/** @type {string} */ nivel, /** @type {string} */ mensagem) {
            const self = /** @type {Record<string, any>} */ (this);
            const chamadas = self[nivel].getCalls();
            return chamadas.some((/** @type {any} */ call) =>
                call.args.some((/** @type {unknown} */ arg) => typeof arg === 'string' && arg.includes(mensagem)),
            );
        },
    };
}

/**
 * Cria um logger silencioso (noop) Útil quando você não quer poluir a saída dos testes
 *
 * @returns {object}
 */
function criarLoggerSilencioso() {
    return {
        log: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
    };
}

export { criarLoggerMock, criarLoggerSilencioso };
