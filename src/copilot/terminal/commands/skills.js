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
 */

import { handleGetSkills, handleSetSkills } from '../http-handlers.js';

/**
 * @typedef {Object} CmdContext
 * @property {(msg: string) => void} println - Função de saída de texto no REPL
 */

/**
 * Handler do comando `/skills`.
 *
 * @param {CmdContext} ctx
 * @param {string} [arg] - Subcomando e argumentos (e.g. "add ./docs", "remove ./docs", "list")
 * @returns {void}
 */
export function cmdSkills({ println }, arg) {
    const parts = (arg ?? '').trim().split(/\s+/);
    const sub = parts[0] ?? 'list';
    const rest = parts.slice(1).join(' ');

    switch (sub) {
        case 'list':
        case '': {
            const result = handleGetSkills();
            const skills = /** @type {any} */ (result.body).skills;
            if (!skills.paths.length) {
                println('  (nenhum skill/path configurado)');
            } else {
                println(`  Skills (${skills.paths.length}):`);
                for (const p of skills.paths) println(`    · ${p}`);
            }
            break;
        }

        case 'add': {
            if (!rest) {
                println('  Uso: /skills add <caminho>');
                break;
            }
            const current = /** @type {any} */ (handleGetSkills().body).skills;
            const newPaths = [...new Set([...current.paths, rest])];
            handleSetSkills({ paths: newPaths });
            println(`  ✓ Adicionado: ${rest}`);
            println(`  Total de skills: ${newPaths.length}`);
            break;
        }

        case 'remove': {
            if (!rest) {
                println('  Uso: /skills remove <caminho>');
                break;
            }
            const current = /** @type {any} */ (handleGetSkills().body).skills;
            const filtered = current.paths.filter((/** @type {string} */ p) => p !== rest);
            if (filtered.length === current.paths.length) {
                println(`  ⚠ Caminho não encontrado: ${rest}`);
                break;
            }
            handleSetSkills({ paths: filtered });
            println(`  ✓ Removido: ${rest}`);
            println(`  Total de skills: ${filtered.length}`);
            break;
        }

        case 'reload': {
            // RF-055: PinnedFilesLoader não expõe método reload() público.
            // Para recarregar, reiniciar o processo ou redefinir os paths via /skills add|remove.
            println('  ⟳ Reload manual não disponível via REPL.');
            println('  Use /skills add|remove para atualizar os paths, ou reinicie o processo.');
            break;
        }

        default:
            println(`  Subcomando desconhecido: ${sub}`);
            println('  Uso: /skills [list | add <path> | remove <path> | reload]');
    }
}
