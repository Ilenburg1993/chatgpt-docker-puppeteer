// @ts-check
/**
 * src/copilot/services/tool-service.js
 *
 * Fachada de alto nível para operações de ferramentas, consolidando tools + hooks + bridges.
 *
 * @module copilot/services/tool-service
 */

import { container, EVENT_BUS } from '#copilot/core';
import { SERVICE_TOOL_INVOKED } from '#copilot/events';
import { log } from '#copilot/observability';
import { allTools, buildTool, getDisabledTools, isToolDisabled } from '#copilot/tools';

/**
 * Fachada de ferramentas — consolida operações de tools, hooks e bridges.
 */
export class ToolService {
    /** @type {import('../core/event-bus.js').EventBus | null} */
    #eventBus = null;

    /**
     * Obtém EventBus (lazy).
     *
     * @returns {import('../core/event-bus.js').EventBus | null}
     */
    #bus() {
        if (!this.#eventBus) {
            try {
                this.#eventBus = container.resolve(EVENT_BUS);
            } catch {
                // EventBus não registrado
            }
        }
        return this.#eventBus;
    }

    /**
     * Constroi a ferramenta configurada para uso em sessão.
     *
     * @param {any} [options] - Opções de construção de tool.
     * @returns {any}
     */
    buildTool(options) {
        log('DEBUG', '[ToolService] construindo ferramenta');
        const tool = buildTool(options);
        this.#bus()?.emit({ type: SERVICE_TOOL_INVOKED });
        return tool;
    }

    /**
     * Lista todas as ferramentas registradas.
     *
     * @returns {any[]}
     */
    listAll() {
        return allTools;
    }

    /**
     * Lista ferramentas desabilitadas.
     *
     * @returns {string[]}
     */
    getDisabled() {
        return getDisabledTools();
    }

    /**
     * Verifica se uma ferramenta está desabilitada.
     *
     * @param {string} toolName
     * @returns {boolean}
     */
    isDisabled(toolName) {
        return isToolDisabled(toolName);
    }
}

/**
 * Cria instância de ToolService.
 *
 * @returns {ToolService}
 */
export function createToolService() {
    return new ToolService();
}
