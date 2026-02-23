import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Core Config Completo - Configuração (Vitest)', () => {
    it('deve existir e ser JSON válido', () => {
        const configPath = path.join(import.meta.dirname, '../../../config.json');

        expect(fs.existsSync(configPath)).toBe(true);

        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content);

        expect(config).toBeTruthy();
    });

    it('deve ter campos obrigatórios', () => {
        const configPath = path.join(import.meta.dirname, '../../../config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

        const required = ['DEBUG_PORT', 'IDLE_SLEEP', 'CYCLE_DELAY', 'allowedDomains'];
        for (const field of required) {
            expect(field in config).toBe(true);
        }
    });

    // ... additional examples could be copied similarly
});
