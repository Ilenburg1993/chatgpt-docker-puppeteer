/**
 * scripts/postinstall.mjs
 *
 * Aplica patches pós-instalação para compatibilidade de pacotes de terceiros.
 *
 * Patch 1: vscode-jsonrpc — adiciona exports map para ESM (subpath /node, /browser). O pacote vscode-jsonrpc@8.2.x não
 * inclui "exports" field, mas o @github/copilot-sdk importa 'vscode-jsonrpc/node' que requer exports map quando o
 * projeto usa "type": "module".
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

function patchVscodeJsonrpc() {
    const pkgPath = resolve(ROOT, 'node_modules', 'vscode-jsonrpc', 'package.json');

    if (!existsSync(pkgPath)) {
        console.log('[postinstall] vscode-jsonrpc não instalado — pulando patch.');
        return;
    }

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

    if (pkg.exports && pkg.exports['./node'] && pkg.exports['./node.js']) {
        console.log('[postinstall] vscode-jsonrpc já possui exports map — sem alteração.');
        return;
    }

    pkg.exports = {
        '.': {
            require: './lib/node/main.js',
            default: './lib/node/main.js',
        },
        './node': {
            require: './node.js',
            default: './node.js',
        },
        './node.js': {
            require: './node.js',
            default: './node.js',
        },
        './browser': {
            require: './browser.js',
            default: './browser.js',
        },
        './browser.js': {
            require: './browser.js',
            default: './browser.js',
        },
    };

    writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t'), 'utf8');
    console.log(`[postinstall] Patch aplicado: vscode-jsonrpc exports map adicionado.`);
}

patchVscodeJsonrpc();
