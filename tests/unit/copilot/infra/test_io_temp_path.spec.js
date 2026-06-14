// @ts-check

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSiblingTempPath } from '../../../../src/copilot/infra/io/fs/temp-path.js';

describe('infra/io sibling temporary paths', () => {
    it('cria nome oculto, irmão, identificável e com token de 128 bits', () => {
        const target = path.join('/workspace', 'report.txt');
        const temporary = createSiblingTempPath(target, 'write');

        expect(path.dirname(temporary)).toBe(path.dirname(target));
        expect(path.basename(temporary)).toMatch(
            new RegExp(`^\\.report\\.txt\\.${process.pid}\\.[a-f0-9]{32}\\.write\\.tmp$`),
        );
    });

    it('gera nomes independentes para o mesmo destino', () => {
        const target = path.join('/workspace', 'report.txt');

        expect(createSiblingTempPath(target, 'copy')).not.toBe(createSiblingTempPath(target, 'copy'));
    });

    it('mantém nomes longos dentro do orçamento conservador de entrada', () => {
        const target = path.join('/workspace', `${'á'.repeat(180)}.txt`);
        const temporary = createSiblingTempPath(target, 'move');

        expect(Buffer.byteLength(path.basename(temporary), 'utf8')).toBeLessThanOrEqual(240);
        expect(path.basename(temporary)).toMatch(/\.[a-f0-9]{32}\.move\.tmp$/);
        expect(path.basename(temporary)).not.toContain('\uFFFD');
    });

    it('rejeita papéis que poderiam escapar da convenção', () => {
        expect(() => createSiblingTempPath('/workspace/report.txt', '../write')).toThrow(TypeError);
    });
});
