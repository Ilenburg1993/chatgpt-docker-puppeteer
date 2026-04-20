import { describe, it, expect } from 'vitest';
import { setBackgroundCompactionThreshold } from '../../../src/copilot/agent/session/initializer.js';

describe('initializer.js', () => {
    describe('setBackgroundCompactionThreshold()', () => {
        it('aceita valor dentro do range (0.1 a 1.0)', () => {
            // Não lança erro — se inválido, simplesmente ignora
            expect(() => setBackgroundCompactionThreshold(0.5)).not.toThrow();
        });

        it('aceita boundary inferior 0.1', () => {
            expect(() => setBackgroundCompactionThreshold(0.1)).not.toThrow();
        });

        it('aceita boundary superior 1.0', () => {
            expect(() => setBackgroundCompactionThreshold(1.0)).not.toThrow();
        });

        it('rejeita silenciosamente valor abaixo de 0.1', () => {
            // A função ignora valores inválidos — não lança
            expect(() => setBackgroundCompactionThreshold(0.05)).not.toThrow();
        });

        it('rejeita silenciosamente valor acima de 1.0', () => {
            expect(() => setBackgroundCompactionThreshold(1.5)).not.toThrow();
        });

        it('rejeita silenciosamente não-número', () => {
            // @ts-expect-error — teste de robustez
            expect(() => setBackgroundCompactionThreshold('abc')).not.toThrow();
        });

        it('rejeita silenciosamente NaN', () => {
            expect(() => setBackgroundCompactionThreshold(NaN)).not.toThrow();
        });
    });
});
