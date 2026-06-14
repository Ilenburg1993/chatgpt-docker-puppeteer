// @ts-check

import { describe, expect, it } from 'vitest';

import { execSearchFile, streamSearchFile } from '../../../../src/copilot/infra/io/search/subprocess.js';

describe('infra/io/search/subprocess', () => {
    it('executa subprocesso com stdout/stderr coletados', async () => {
        const result = await execSearchFile(process.execPath, [
            '-e',
            "process.stdout.write('alpha'); process.stderr.write('note');",
        ]);

        expect(result).toEqual({ stdout: 'alpha', stderr: 'note' });
    });

    it('preserva stdout/stderr e status em saída não zero', async () => {
        await expect(
            execSearchFile(process.execPath, [
                '-e',
                "process.stdout.write('partial'); process.stderr.write('missing'); process.exit(1);",
            ]),
        ).rejects.toMatchObject({
            code: 1,
            status: 1,
            stdout: 'partial',
            stderr: 'missing',
        });
    });

    it('interrompe coleta quando stdout excede maxBuffer', async () => {
        await expect(
            execSearchFile(process.execPath, ['-e', "process.stdout.write('abcdefghij');"], { maxBuffer: 4 }),
        ).rejects.toMatchObject({
            code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        });
    });

    it('streama stdout por linha e encerra com sucesso quando callback pede parada', async () => {
        /** @type {string[]} */
        const lines = [];
        const result = await streamSearchFile(
            process.execPath,
            [
                '-e',
                "let i = 0; const t = setInterval(() => { console.log(`line-${i++}`); if (i > 100) clearInterval(t); }, 1);",
            ],
            {
                collectStdout: false,
                timeout: 5_000,
                onStdoutLine(line) {
                    lines.push(line);
                    return lines.length < 3;
                },
            },
        );

        expect(result).toMatchObject({ stdout: '', stoppedEarly: true });
        expect(lines).toEqual(['line-0', 'line-1', 'line-2']);
    });

    it('preserva UTF-8 quando um code point atravessa chunks de stdout', async () => {
        /** @type {string[]} */
        const lines = [];
        const result = await streamSearchFile(
            process.execPath,
            [
                '-e',
                "process.stdout.write(Buffer.from([0xf0, 0x9f])); setTimeout(() => process.stdout.write(Buffer.from([0x98, 0x80, 0x0a])), 20);",
            ],
            { onStdoutLine: (line) => void lines.push(line) },
        );

        expect(lines).toEqual(['😀']);
        expect(result.stdout).toBe('😀');
    });

    it('rejeita stdout textual com UTF-8 inválido', async () => {
        await expect(
            streamSearchFile(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0xff, 0x0a]));']),
        ).rejects.toMatchObject({ code: 'EUTF8SEARCHOUTPUT' });
    });

    it('rejeita executável ou argumentos com byte nulo', async () => {
        await expect(execSearchFile('node\u0000bad', [])).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
        await expect(execSearchFile(process.execPath, ['ok\u0000bad'])).rejects.toMatchObject({
            code: 'ERR_INVALID_ARG_VALUE',
        });
    });
});
