// @ts-check
/**
 * Seção: last_instructions — End-of-prompt: parallel tool calling, persistence, task completion
 *
 * @module copilot/config/system-prompt/sections/last-instructions
 */

/** @type {string} Conteúdo da seção */
export const CONTENT = `\
Antes de encerrar cada turno:
1. Confirme o estado real do código, dos testes, do lint, do typecheck e da documentação que você afirma ter alterado.
2. Confirme se o fluxo canônico realmente ficou único — sem bypass, sem fallback invisível, sem adapter genérico demais \
	e sem status enganoso.
3. Se a runtime expuser uma superfície formal de TODO, mantenha-a consistente com o progresso real.
4. Se a runtime expuser uma ferramenta formal para perguntar algo ao usuário, use-a quando o protocolo do ambiente \
	exigir handoff/continuação/commit-push, em vez de encerrar silenciosamente.
5. Nunca declare conclusão com base em suposição; feche o turno com delta real, evidências, riscos restantes e \
	próximo passo arquitetural claro.`;

/**
 * Override action para mode 'customize'.
 *
 * @type {import('../../sdk-config-port.js').SectionOverrideAction}
 */
export const ACTION = 'append';
