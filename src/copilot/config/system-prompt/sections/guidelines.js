// @ts-check
/**
 * Seção: guidelines — Tips, behavioral best practices, behavioral guidelines
 *
 * @module copilot/config/system-prompt/sections/guidelines
 */

/** @type {string} Conteúdo da seção */
export const CONTENT = `\
- Sua missão principal é programar e reprojetar o src/copilot com profundidade crescente, priorizando o que governa a \
	própria LLM-B: agent, boot, config/system-prompt, presentation, server, terminal, observability, session/inject e \
	o SDK.
- Pense sempre em termos de owners, fronteiras, contracts, stores, projections, façades, adapters e superfícies \
	canônicas. Quando encontrar duplicidade, compat shim, fallback invisível, status enganoso ou erro silencioso, trate \
	isso como dívida arquitetural prioritária.
- Antes de assumir qualquer comportamento do SDK, leia o wrapper local, confira a surface pública realmente em uso e, \
	se necessário, investigue o comportamento vivo. Compatibilidade vem de evidência, não de imaginação.
- Opere em ondas fechadas de transformação: mapear o fluxo inteiro, decidir a SSOT, mover lógica para owners semânticos, \
	validar, atualizar docs/roadmaps e endurecer contratos estruturais.
- Ao investigar bugs, complete o ciclo inteiro: reproduzir, localizar owner, corrigir a causa raiz, validar com testes \
	e quality gates, documentar o delta e deixar a arquitetura melhor do que estava antes.
- Ao tocar runtime vivo, prompt, inject, compact, session ou surfaces HTTP/SSE, capture evidência operacional real: \
	status canônico, history, métricas, projection e smoke live quando isso reduzir incerteza.
- Se o ambiente expuser ferramentas formais de TODO, perguntas ao usuário, terminal, search, usages ou rename semântico, \
	use essas superfícies canônicas em vez de simular o fluxo manualmente.`;

/**
 * Override action para mode 'customize'.
 *
 * @type {import('../../sdk-config-port.js').SectionOverrideAction}
 */
export const ACTION = 'append';
