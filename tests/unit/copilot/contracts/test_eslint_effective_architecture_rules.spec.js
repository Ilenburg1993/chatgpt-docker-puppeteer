// @ts-check
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, it } from 'vitest';

const ROOT = process.cwd();
const eslint = new ESLint({ cwd: ROOT });

/**
 * @param {string} relPath
 * @returns {Promise<import('eslint').Linter.Config>}
 */
async function configFor(relPath) {
    const config = await eslint.calculateConfigForFile(join(ROOT, relPath));
    assert.ok(config, `ESLint config não encontrado para ${relPath}`);
    return /** @type {import('eslint').Linter.Config} */ (config);
}

/**
 * @param {unknown} rule
 * @returns {string}
 */
function ruleText(rule) {
    return JSON.stringify(rule);
}

describe('ESLint effective Copilot architecture rules', () => {
    it('mantém Node 24 ESM e IO governance ativos em tools comuns', async () => {
        const config = await configFor('src/copilot/tools/file/read-tools.js');
        const syntaxRule = config.rules?.['no-restricted-syntax'];
        const text = ruleText(syntaxRule);

        assert.match(text, /Node 24\+ ESM/);
        assert.match(text, /Boundary tools→infra/);
        assert.match(text, /Tool factory/);
        assert.match(text, /IO governance/);
    });

    it('mantém index.js de tools como barrel-only sem perder governança de IO', async () => {
        const config = await configFor('src/copilot/tools/file/index.js');
        const syntaxRule = config.rules?.['no-restricted-syntax'];
        const text = ruleText(syntaxRule);

        assert.match(text, /INDEX barrel-only/);
        assert.match(text, /Node 24\+ ESM/);
        assert.match(text, /Boundary tools→infra/);
    });

    it('mantém config→sdk restrito ao sdk-config-port.js', async () => {
        const config = await configFor('src/copilot/config/session-config.js');
        const importsRule = config.rules?.['no-restricted-imports'];

        assert.match(ruleText(importsRule), /Boundary config→sdk/);
    });

    it('mantém terminal sem SDK/tools diretos fora dos gateways', async () => {
        const config = await configFor('src/copilot/terminal/commands/sdk.js');
        const importsRule = config.rules?.['no-restricted-imports'];

        assert.match(ruleText(importsRule), /Boundary terminal→runtime/);
    });

    it('mantém handlers server/routes/sdk compostos por deps.js', async () => {
        const config = await configFor('src/copilot/server/routes/sdk/session-core-routes.js');
        const importsRule = config.rules?.['no-restricted-imports'];

        assert.match(ruleText(importsRule), /Boundary server\/routes\/sdk/);
    });
});
