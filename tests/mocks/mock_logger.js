/**
 * Mock do Logger
 * Para uso em testes que não precisam de logging real
 * @audit-level 50 - Test infrastructure
 */

const sinon = require('sinon');

/**
 * Cria um logger mockado com todos os métodos
 * @returns {Object} Logger mockado com spies do sinon
 */
function criarLoggerMock() {
    return {
        log: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),

        // Helpers para asserções
        obterLogs: function (nivel) {
            if (!nivel) {
                return this.log.getCalls().map(call => call.args);
            }
            return this[nivel].getCalls().map(call => call.args);
        },

        limpar: function () {
            this.log.resetHistory();
            this.info.resetHistory();
            this.warn.resetHistory();
            this.error.resetHistory();
            this.debug.resetHistory();
        },

        verificarChamado: function (nivel, mensagem) {
            const chamadas = this[nivel].getCalls();
            return chamadas.some(call => call.args.some(arg => typeof arg === 'string' && arg.includes(mensagem)));
        }
    };
}

/**
 * Cria um logger silencioso (noop)
 * Útil quando você não quer poluir a saída dos testes
 */
function criarLoggerSilencioso() {
    return {
        log: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {}
    };
}

module.exports = {
    criarLoggerMock,
    criarLoggerSilencioso
};
