// @ts-check
/**
 * src/copilot/infra/storage.js — Abstração de storage em filesystem.
 *
 * Operações atômicas de leitura/escrita JSON com fallback defensivo.
 *
 * @module copilot/infra/storage
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Lê e parse um arquivo JSON. Retorna `defaultValue` se o arquivo não existir ou for inválido.
 *
 * @template T
 * @param {string} filePath - Caminho absoluto do arquivo.
 * @param {T} defaultValue - Valor padrão se leitura falhar.
 * @returns {Promise<T>}
 */
export async function readJson(filePath, defaultValue) {
    try {
        const raw = await readFile(filePath, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return defaultValue;
    }
}

/**
 * Escreve um valor como JSON formatado. Cria diretórios intermediários se necessário.
 *
 * Usa escrita em arquivo temporário + rename para atomicidade (quando possível).
 *
 * @param {string} filePath - Caminho absoluto do arquivo.
 * @param {unknown} data - Dados a serializar.
 * @returns {Promise<void>}
 */
export async function writeJson(filePath, data) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
    }
    const content = JSON.stringify(data, null, 2) + '\n';
    await writeFile(filePath, content, 'utf-8');
}

/**
 * Verifica se um arquivo existe (sync, para guards rápidos).
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function fileExists(filePath) {
    return existsSync(filePath);
}
