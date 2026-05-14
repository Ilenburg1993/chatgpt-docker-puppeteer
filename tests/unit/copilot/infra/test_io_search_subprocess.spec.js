// @ts-check

import { describe, expect, it } from 'vitest';

import { execSearchFile } from '../../../../src/copilot/infra/io/search/subprocess.js';

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

    it('rejeita executável ou argumentos com byte nulo', async () => {
        await expect(execSearchFile('node\u0000bad', [])).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
        await expect(execSearchFile(process.execPath, ['ok\u0000bad'])).rejects.toMatchObject({
            code: 'ERR_INVALID_ARG_VALUE',
        });
    });
});
