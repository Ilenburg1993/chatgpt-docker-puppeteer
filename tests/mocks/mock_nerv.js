/**
 * Mock do NERV (Event Bus)
 * Para uso em testes que precisam simular eventos do NERV
 * @audit-level 50 - Test infrastructure
 */

const sinon = require('sinon');
const EventEmitter = require('events');

/**
 * Cria um NERV mockado com EventEmitter real
 * @returns {Object} NERV mockado
 */
function criarNERVMock() {
    const emitter = new EventEmitter();

    const mock = {
        // EventEmitter nativo
        _emitter: emitter,

        // Métodos principais do NERV
        emit: sinon.spy((...args) => emitter.emit(...args)),
        on: sinon.spy((...args) => emitter.on(...args)),
        once: sinon.spy((...args) => emitter.once(...args)),
        off: sinon.spy((...args) => emitter.off(...args)),

        // Estado interno
        _eventos: {},
        _inscricoes: {},

        // Helpers para testes
        obterEventosEmitidos: function (nomeEvento) {
            if (!nomeEvento) {
                return this.emit.getCalls().map(call => ({
                    evento: call.args[0],
                    dados: call.args.slice(1)
                }));
            }
            return this.emit
                .getCalls()
                .filter(call => call.args[0] === nomeEvento)
                .map(call => call.args.slice(1));
        },

        obterInscricoes: function (nomeEvento) {
            return this._emitter.listenerCount(nomeEvento);
        },

        limpar: function () {
            this.emit.resetHistory();
            this.on.resetHistory();
            this.once.resetHistory();
            this.off.resetHistory();
            this._emitter.removeAllListeners();
            this._eventos = {};
            this._inscricoes = {};
        },

        verificarEventoEmitido: function (nomeEvento) {
            return this.emit.getCalls().some(call => call.args[0] === nomeEvento);
        },

        aguardarEvento: function (nomeEvento, timeout = 5000) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error(`Timeout aguardando evento: ${nomeEvento}`));
                }, timeout);

                this._emitter.once(nomeEvento, (...args) => {
                    clearTimeout(timer);
                    resolve(args);
                });
            });
        }
    };

    return mock;
}

/**
 * Cria um NERV simplificado (sem EventEmitter)
 * Útil para testes que só precisam verificar chamadas
 */
function criarNERVSimples() {
    return {
        emit: sinon.stub(),
        on: sinon.stub(),
        once: sinon.stub(),
        off: sinon.stub(),

        limpar: function () {
            this.emit.resetHistory();
            this.on.resetHistory();
            this.once.resetHistory();
            this.off.resetHistory();
        }
    };
}

module.exports = {
    criarNERVMock,
    criarNERVSimples
};
