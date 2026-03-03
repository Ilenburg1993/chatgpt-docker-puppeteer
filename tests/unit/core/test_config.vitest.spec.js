// @ts-check
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Core Config Completo - Configuração (Vitest)', () => {
    it('deve existir e ser JSON válido', () => {
        const __dirname = path.dirname(new URL(import.meta.url).pathname);
        const configPath = path.join(__dirname, '../../../config.json');

        assert.ok(fs.existsSync(configPath), 'config.json should exist');

        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content);

        assert.ok(config);
    });

    it('deve ter campos obrigatórios', () => {
        const __dirname = path.dirname(new URL(import.meta.url).pathname);
        const configPath = path.join(__dirname, '../../../config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

        const required = ['DEBUG_PORT', 'SERVER_PORT', 'BROWSER_MODE', 'allowedDomains'];
        for (const field of required) {
            assert.ok(field in config, `missing field ${field}`);
        }
    });

    // ... additional examples could be copied similarly
});
