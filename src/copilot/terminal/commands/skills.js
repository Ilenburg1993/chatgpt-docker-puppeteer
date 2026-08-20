// @ts-check
/**
 * src/copilot/terminal/commands/skills.js
 *
 * Comando `/skills` do REPL LLM-B para gerenciar arquivos de contexto "pinned".
 *
 * Subcomandos:
 *
 * - `/skills list` — lista caminhos configurados
 * - `/skills add <path>` — adiciona um caminho à lista
 * - `/skills remove <path>` — remove um caminho da lista
 * - `/skills reload` — força reload do PinnedFilesLoader se ativo
 *
 * @module copilot/terminal/commands/skills
 * @see EventBus
 */

import { handleGetSkills, handleSetSkills } from '../handlers/index.js';
import { terminalThemeHeadline, terminalThemeRow, terminalThemeText } from '../state/ui/index.js';

/**
 * @typedef {Object} CmdContext
 * @property {(msg: string) => void} println - Função de saída de texto no REPL
 */

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function countLabel(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Handler do comando `/skills`.
 *
 * @param {CmdContext} ctx
 * @param {string} [arg] - Subcomando e argumentos (e.g. "add ./docs", "remove ./docs", "list")
 * @returns {Promise<void>}
 */
export async function cmdSkills({ println }, arg) {
    const parts = (arg ?? '').trim().split(/\s+/);
    const sub = parts[0] ?? 'list';
    const rest = parts.slice(1).join(' ');

    switch (sub) {
        case 'list':
        case '': {
            // T-09: await para async I/O
            const result = await handleGetSkills();
            const skills = /** @type {{ paths: string[] }} */ (
                /** @type {Record<string, unknown>} */ (result.body)['skills']
            );
            if (!skills.paths.length) {
                println(terminalThemeRow('Skills', 'nenhum caminho configurado', { role: 'muted' }));
            } else {
                println(
                    terminalThemeHeadline('command', 'Skills', [
                        countLabel(skills.paths.length, 'caminho', 'caminhos'),
                    ]),
                );
                for (const p of skills.paths) println(terminalThemeRow('Caminho', p, { role: 'fileRead' }));
            }
            break;
        }

        case 'add': {
            if (!rest) {
                println(terminalThemeRow('Uso', '/skills add <caminho>', { role: 'warn' }));
                break;
            }
            const current = /** @type {{ paths: string[] }} */ (
                /** @type {Record<string, unknown>} */ ((await handleGetSkills()).body)['skills']
            );
            const newPaths = [...new Set([...current.paths, rest])];
            await handleSetSkills({ paths: newPaths });
            println(terminalThemeRow('Adicionado', rest, { role: 'success' }));
            println(terminalThemeRow('Total', String(newPaths.length), { role: 'info' }));
            break;
        }

        case 'remove': {
            if (!rest) {
                println(terminalThemeRow('Uso', '/skills remove <caminho>', { role: 'warn' }));
                break;
            }
            const current = /** @type {{ paths: string[] }} */ (
                /** @type {Record<string, unknown>} */ ((await handleGetSkills()).body)['skills']
            );
            const filtered = current.paths.filter((/** @type {string} */ p) => p !== rest);
            if (filtered.length === current.paths.length) {
                println(terminalThemeRow('Aviso', `caminho não encontrado: ${rest}`, { role: 'warn' }));
                break;
            }
            await handleSetSkills({ paths: filtered });
            println(terminalThemeRow('Removido', rest, { role: 'success' }));
            println(terminalThemeRow('Total', String(filtered.length), { role: 'info' }));
            break;
        }

        case 'reload': {
            // RF-055: PinnedFilesLoader não expõe método reload() público.
            // Para recarregar, reiniciar o processo ou redefinir os paths via /skills add|remove.
            println(terminalThemeRow('Reload', 'manual não disponível via REPL', { role: 'warn' }));
            println(
                terminalThemeText('muted', '  Use /skills add|remove para atualizar os paths, ou reinicie o processo.'),
            );
            break;
        }

        default:
            println(terminalThemeRow('Subcomando', `desconhecido: ${sub}`, { role: 'warn' }));
            println(
                terminalThemeRow('Uso', '/skills [list | add <path> | remove <path> | reload]', { role: 'command' }),
            );
    }
}
