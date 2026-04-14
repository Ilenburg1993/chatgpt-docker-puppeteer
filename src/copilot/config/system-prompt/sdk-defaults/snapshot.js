// @ts-check
/**
 * src/copilot/config/system-prompt/sdk-defaults/snapshot.js
 *
 * Script utilitário para gerar um snapshot dos metadados das seções do SDK. Salva em
 * `sdk-defaults/captured-YYYY-MM-DD.json` com as descrições e a estrutura das seções.
 *
 * Para capturar o conteúdo real (injetado em runtime), use `createCaptureConfig()` em uma sessão Copilot ativa — o
 * snapshot de conteúdo pode ser adicionado ao JSON resultante.
 *
 * @module copilot/config/system-prompt/sdk-defaults/snapshot
 */

import { SYSTEM_PROMPT_SECTIONS } from '#copilot/sdk';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Gera o snapshot dos metadados do SDK.
 *
 * @returns {{
 *     timestamp: string;
 *     sdkVersion: string;
 *     sections: Record<string, { description: string; order: number }>;
 * }}
 */
function generateSnapshot() {
    /** @type {Record<string, { description: string; order: number }>} */
    const sections = {};
    let order = 0;

    for (const [key, val] of Object.entries(SYSTEM_PROMPT_SECTIONS || {})) {
        sections[key] = {
            description: /** @type {any} */ (val)?.description || '(sem descrição)',
            order: order++,
        };
    }

    return {
        timestamp: new Date().toISOString(),
        sdkVersion: '>=0.2.0',
        sections,
    };
}

const snapshot = generateSnapshot();
const date = new Date().toISOString().slice(0, 10);
const outPath = join(__dirname, `captured-${date}.json`);

writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
console.log(`[sdk-defaults/snapshot] Salvo em: ${outPath}`);
console.log(`[sdk-defaults/snapshot] ${Object.keys(snapshot.sections).length} seções capturadas.`);
