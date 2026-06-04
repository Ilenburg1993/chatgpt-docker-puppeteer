// @ts-check

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('terminal command import side effects', () => {
    it('renderiza /terminal libs detail sem inicializar logs laterais de DB', () => {
        const script = `
            import { cmdTerminal } from './src/copilot/terminal/commands/terminal.js';
            const lines = [];
            cmdTerminal({ println: (text) => lines.push(text) }, 'libs detail');
            console.log(lines.join('\\n'));
        `;

        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, NO_COLOR: '1' },
            maxBuffer: 1024 * 1024,
            timeout: 10_000,
        });

        expect(output).toContain('Libs auxiliares do terminal');
        expect(output).toContain('Estado');
        expect(output).toContain('Default');
        expect(output).not.toContain('[db]');
        expect(output).not.toContain('SQLite copilot ready');
    });
});
