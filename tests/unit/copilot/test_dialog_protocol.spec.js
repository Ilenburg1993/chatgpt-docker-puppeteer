import { describe, it } from 'node:test';
import {
    DIALOG_PROTO_DONE,
    DIALOG_PROTO_READY,
    DIALOG_PROTO_REPLY,
    DIALOG_PROTO_STOPPED,
    DialogProtocol,
    MESSAGE_KIND,
} from '../../../src/copilot/agent/dialog/protocol.js';

describe('DialogProtocol', () => {
    describe('classify()', () => {
        it('retorna "ready" para READY: prefix', () => {
            expect(DialogProtocol.classify('READY: aguardando')).toBe('ready');
        });

        it('retorna "ready" para string exata "READY"', () => {
            expect(DialogProtocol.classify('READY')).toBe('ready');
        });

        it('retorna "ready" para READY com espaços', () => {
            expect(DialogProtocol.classify('  READY: msg  ')).toBe('ready');
        });

        it('retorna "reply" para REPLY: prefix', () => {
            expect(DialogProtocol.classify('REPLY: resposta aqui')).toBe('reply');
        });

        it('retorna "reply" para DONE: prefix', () => {
            expect(DialogProtocol.classify('DONE: concluído')).toBe('reply');
        });

        it('retorna "stopped" para STOPPED prefix', () => {
            expect(DialogProtocol.classify('STOPPED')).toBe('stopped');
        });

        it('retorna "stopped" para STOP_DIALOG', () => {
            expect(DialogProtocol.classify('STOP_DIALOG')).toBe('stopped');
        });

        it('retorna "question" para texto sem prefixo protocolo', () => {
            expect(DialogProtocol.classify('Qual a previsão do tempo?')).toBe('question');
        });

        it('retorna "question" para string vazia', () => {
            expect(DialogProtocol.classify('')).toBe('question');
        });
    });

    describe('extractReply()', () => {
        it('remove prefixo REPLY: e espaço', () => {
            expect(DialogProtocol.extractReply('REPLY: conteúdo')).toBe('conteúdo');
        });

        it('remove prefixo DONE: e espaço', () => {
            expect(DialogProtocol.extractReply('DONE: fim')).toBe('fim');
        });

        it('é case-insensitive para prefixo', () => {
            expect(DialogProtocol.extractReply('reply: lower')).toBe('lower');
        });

        it('retorna texto trimmed sem prefixo', () => {
            expect(DialogProtocol.extractReply('  REPLY:  espaçado  ')).toBe('espaçado');
        });
    });

    describe('buildBootPrompt()', () => {
        it('contém instruções de protocolo', () => {
            const prompt = DialogProtocol.buildBootPrompt();
            expect(prompt).toContain(DIALOG_PROTO_READY);
            expect(prompt).toContain(DIALOG_PROTO_REPLY);
            expect(prompt).toContain(DIALOG_PROTO_STOPPED);
        });

        it('inclui firstMessage quando fornecida', () => {
            const prompt = DialogProtocol.buildBootPrompt({ firstMessage: 'olá' });
            expect(prompt).toContain('olá');
        });

        it('não inclui firstMessage quando omitida', () => {
            const prompt = DialogProtocol.buildBootPrompt();
            expect(prompt).not.toContain('Primeira mensagem a processar');
        });
    });

    describe('MESSAGE_KIND', () => {
        it('contém as 4 classificações esperadas', () => {
            expect(MESSAGE_KIND.READY).toBe('ready');
            expect(MESSAGE_KIND.REPLY).toBe('reply');
            expect(MESSAGE_KIND.STOPPED).toBe('stopped');
            expect(MESSAGE_KIND.QUESTION).toBe('question');
        });
    });

    describe('constantes de protocolo', () => {
        it('DIALOG_PROTO_READY é "READY:"', () => {
            expect(DIALOG_PROTO_READY).toBe('READY:');
        });

        it('DIALOG_PROTO_REPLY é "REPLY:"', () => {
            expect(DIALOG_PROTO_REPLY).toBe('REPLY:');
        });

        it('DIALOG_PROTO_DONE é "DONE:"', () => {
            expect(DIALOG_PROTO_DONE).toBe('DONE:');
        });

        it('DIALOG_PROTO_STOPPED é "STOPPED"', () => {
            expect(DIALOG_PROTO_STOPPED).toBe('STOPPED');
        });
    });
});
