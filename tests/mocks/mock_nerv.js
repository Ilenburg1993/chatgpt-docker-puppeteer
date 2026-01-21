/**
 * Mock do NERV (Event Bus)
 * Para uso em testes que precisam simular eventos do NERV
 * @audit-level 50 - Test infrastructure
 *
 * IMPORTANTE: Este mock reflete a API real do NERV que usa envelopes estruturados,
 * não a API EventEmitter simples (eventName, data).
 */

const sinon = require('sinon');
const EventEmitter = require('events');

/**
 * Helper para extrair nome do evento de um envelope NERV.
 * Suporta múltiplos formatos de envelope (novo/legado).
 *
 * @param {Object} envelope - Envelope NERV estruturado
 * @returns {string} Nome do evento
 */
function extrairNomeEvento(envelope) {
    // Formato novo (NERV 2.x): envelope.type.action_code
    if (envelope.type && envelope.type.action_code) {
        return envelope.type.action_code;
    }

    // Formato alternativo: envelope.actionCode
    if (envelope.actionCode) {
        return envelope.actionCode;
    }

    // Formato legado: envelope.kind
    if (envelope.kind) {
        return envelope.kind;
    }

    // Fallback
    return 'UNKNOWN_EVENT';
}

/**
 * Cria um NERV mockado com EventEmitter real
 * @returns {Object} NERV mockado
 */
function criarNERVMock() {
    const emitter = new EventEmitter();

    const mock = {
        // EventEmitter nativo (para compatibilidade com testes que usam on/once)
        _emitter: emitter,

        // Métodos principais do NERV - ACEITA ENVELOPES

        /**
         * emit() - Método de baixo nível que aceita envelope completo
         * @param {Object} envelope - Envelope NERV estruturado
         * @returns {boolean} true se emitido com sucesso
         */
        emit: sinon.spy(envelope => {
            const eventName = extrairNomeEvento(envelope);
            emitter.emit(eventName, envelope);
            emitter.emit('*', envelope); // Listeners genéricos
            return true;
        }),

        /**
         * emitCommand() - Emite envelope de comando
         * @param {Object} envelope - Envelope de comando
         * @returns {boolean} true se emitido com sucesso
         */
        emitCommand: sinon.spy(envelope => {
            const eventName = extrairNomeEvento(envelope);
            emitter.emit(eventName, envelope);
            emitter.emit('command', envelope);
            return true;
        }),

        /**
         * emitEvent() - Emite envelope de evento
         * @param {Object} envelope - Envelope de evento
         * @returns {boolean} true se emitido com sucesso
         */
        emitEvent: sinon.spy(envelope => {
            const eventName = extrairNomeEvento(envelope);
            emitter.emit(eventName, envelope);
            emitter.emit('event', envelope);
            return true;
        }),

        /**
         * emitAck() - Emite envelope de ACK
         * @param {Object} envelope - Envelope de ACK
         * @returns {boolean} true se emitido com sucesso
         */
        emitAck: sinon.spy(envelope => {
            const eventName = extrairNomeEvento(envelope);
            emitter.emit(eventName, envelope);
            emitter.emit('ack', envelope);
            return true;
        }),

        // Métodos de inscrição (compatibilidade com EventEmitter)
        on: sinon.spy((...args) => emitter.on(...args)),
        once: sinon.spy((...args) => emitter.once(...args)),
        off: sinon.spy((...args) => emitter.off(...args)),

        // Estado interno
        _eventos: {},
        _inscricoes: {},

        // Helpers para testes

        /**
         * Obtém envelopes emitidos, opcionalmente filtrados por actionCode
         * @param {string} [actionCode] - Código de ação para filtrar (opcional)
         * @returns {Array} Lista de envelopes emitidos
         */
        obterEventosEmitidos: function (actionCode) {
            const calls = this.emit.getCalls();

            if (!actionCode) {
                // Retorna todos os envelopes
                return calls.map(call => call.args[0]);
            }

            // Filtra por actionCode
            return calls
                .filter(call => {
                    const envelope = call.args[0];
                    return extrairNomeEvento(envelope) === actionCode;
                })
                .map(call => call.args[0]);
        },

        obterInscricoes: function (nomeEvento) {
            return this._emitter.listenerCount(nomeEvento);
        },

        limpar: function () {
            this.emit.resetHistory();
            this.emitCommand.resetHistory();
            this.emitEvent.resetHistory();
            this.emitAck.resetHistory();
            this.on.resetHistory();
            this.once.resetHistory();
            this.off.resetHistory();
            this._emitter.removeAllListeners();
            this._eventos = {};
            this._inscricoes = {};
        },

        /**
         * Verifica se um envelope com determinado actionCode foi emitido
         * @param {string} actionCode - Código de ação para verificar
         * @returns {boolean} true se foi emitido
         */
        verificarEventoEmitido: function (actionCode) {
            return this.emit.getCalls().some(call => {
                const envelope = call.args[0];
                return extrairNomeEvento(envelope) === actionCode;
            });
        },

        /**
         * Aguarda por um envelope com determinado actionCode
         * @param {string} actionCode - Código de ação para aguardar
         * @param {number} [timeout=5000] - Timeout em ms
         * @returns {Promise<Object>} Envelope recebido
         */
        aguardarEvento: function (actionCode, timeout = 5000) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error(`Timeout aguardando evento: ${actionCode}`));
                }, timeout);

                this._emitter.once(actionCode, envelope => {
                    clearTimeout(timer);
                    resolve(envelope);
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
        emit: sinon.stub().returns(true),
        emitCommand: sinon.stub().returns(true),
        emitEvent: sinon.stub().returns(true),
        emitAck: sinon.stub().returns(true),
        on: sinon.stub(),
        once: sinon.stub(),
        off: sinon.stub(),

        limpar: function () {
            this.emit.resetHistory();
            this.emitCommand.resetHistory();
            this.emitEvent.resetHistory();
            this.emitAck.resetHistory();
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
