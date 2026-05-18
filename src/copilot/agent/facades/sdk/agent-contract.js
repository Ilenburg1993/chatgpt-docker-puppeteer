// @ts-check
/**
 * src/copilot/agent/facades/sdk/agent-contract.js
 *
 * Validação de contrato de ferramentas de agentes na inicialização de sessão.
 *
 * Este módulo valida que:
 *
 * 1. Nomes de agentes são reconhecidos
 * 2. Ferramentas declaradas por agentes podem ser resolvidas (canônicas ou legadas)
 * 3. Ferramentas obrigatórias (tier.must) estão disponíveis
 * 4. Ferramentas recomendadas (tier.should) estão disponíveis (apenas avisos)
 *
 * A validação roda durante a inicialização de sessão em initOrResumeSession().
 *
 * @module copilot/agent/facades/sdk/agent-contract
 */

import { normalizeAgentToolList, resolveToolName } from '#copilot/config';
import { SdkCustomAgentConfigSchema } from '#copilot/core';

/**
 * Valida contratos de ferramentas de agentes na inicialização de sessão.
 *
 * Verificações:
 *
 * - Cada nome de agente é válido (string não vazia)
 * - Cada lista de ferramentas do agente é válida (array não vazio se o agente estiver habilitado)
 * - Nomes de ferramentas podem ser resolvidos (canônicos ou legados)
 * - Ferramentas obrigatórias (tier.must) estão disponíveis
 *
 * Retorno:
 *
 * - errors: falhas de validação (bloqueiam a sessão se não vazio)
 * - warnings: problemas não críticos (registrados, mas permitem prosseguir)
 * - contractLog: trilha de auditoria dos agentes validados
 *
 * @example
 *     const result = validateAgentContracts([
 *         { name: 'explore', tools: ['read_file_content', 'grep'] },
 *         { name: 'task', tools: ['bash'] },
 *     ]);
 *     if (result.errors.length > 0) {
 *         throw new Error(`Validação de contrato de agente falhou: ${result.errors.join('; ')}`);
 *     }
 *
 * @param {{
 *     name: string;
 *     tools?: string[] | null | undefined;
 *     displayName?: string;
 *     description?: string | undefined;
 *     prompt?: string;
 *     mcpServers?: Record<string, import('@github/copilot-sdk').MCPServerConfig>;
 *     infer?: boolean;
 *     skills?: string[];
 *     priority?: 'maestro';
 *     toolTiers?: { must?: string[]; should?: string[]; optional?: string[] };
 * }[]} customAgents
 *   - Configurações de agente
 *
 * @param {Set<string> | undefined} [availableTools] - Set de nomes de ferramentas disponíveis (validação mais rígida).
 *   Opcional.
 * @param {{ skillDirectories?: string[]; disabledSkills?: string[] }} [options] - Contexto opcional da sessão para
 *   validar preload de skills por subagente.
 * @returns {{ errors: string[]; warnings: string[]; contractLog: Record<string, any> }}
 */
export function validateAgentContracts(customAgents, availableTools = undefined, options = {}) {
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const warnings = [];
    /** @type {Record<string, any>} */
    const contractLog = {};
    const sessionSkillDirectories = Array.isArray(options.skillDirectories)
        ? options.skillDirectories.filter((dir) => typeof dir === 'string' && dir.length > 0)
        : [];
    const disabledSkills = new Set(
        Array.isArray(options.disabledSkills)
            ? options.disabledSkills.filter((skill) => typeof skill === 'string' && skill.length > 0)
            : [],
    );

    if (!customAgents || customAgents.length === 0) {
        return { errors, warnings, contractLog };
    }

    for (const agent of customAgents) {
        const structural = SdkCustomAgentConfigSchema.safeParse(agent);
        if (!structural.success) {
            const agentName = typeof agent?.name === 'string' && agent.name ? agent.name : '(unknown)';
            const structuralError = /** @type {{ issues: { path: (string | number)[]; message: string }[] }} */ (
                structural.error
            );
            errors.push(
                `Agente "${agentName}" tem estrutura inválida: ${structuralError.issues
                    .map((issue) => `${issue.path.join('.') || 'root'}=${issue.message}`)
                    .join('; ')}`,
            );
            continue;
        }

        // Valida nome de agente
        if (!agent?.name || typeof agent.name !== 'string') {
            errors.push(`Nome de agente inválido: "${agent?.name}". Deve ser string não vazia.`);
            continue;
        }

        const agentName = agent.name;
        contractLog[agentName] = {
            name: agentName,
            displayName: agent.displayName || agentName,
            toolsRequested: Array.isArray(agent.tools) ? agent.tools : ['*'],
            toolsResolved: [],
            unresolvedTools: [],
            skillsRequested: Array.isArray(agent.skills) ? agent.skills : [],
            wildcard: !Array.isArray(agent.tools) || agent.tools.includes('*'),
            status: 'unknown',
            errors: [],
            warnings: [],
        };

        if ((!agent.description || !agent.description.trim()) && agent.infer !== false) {
            warnings.push(
                `Agente "${agentName}" não declarou description. O SDK aceita isso, mas a seleção automática de subagentes fica menos precisa sem uma descrição específica.`,
            );
            contractLog[agentName].warnings.push('Description ausente para agente inferível');
        }

        if (Array.isArray(agent.skills)) {
            if (agent.skills.length === 0) {
                warnings.push(`Agente "${agentName}" declarou skills=[]. Nenhum preload será aplicado.`);
                contractLog[agentName].warnings.push('Lista de skills vazia');
            } else {
                if (sessionSkillDirectories.length === 0) {
                    warnings.push(
                        `Agente "${agentName}" declara preload de skills (${agent.skills.join(', ')}), mas a sessão não configurou skillDirectories.`,
                    );
                    contractLog[agentName].warnings.push('Skills declaradas sem skillDirectories de sessão');
                }
                const disabledRequested = agent.skills.filter((skill) => disabledSkills.has(skill));
                if (disabledRequested.length > 0) {
                    warnings.push(
                        disabledRequested.length === agent.skills.length
                            ? `Agente "${agentName}" tem todas as skills pré-carregadas desabilitadas: ${disabledRequested.join(', ')}.`
                            : `Agente "${agentName}" tem skills pré-carregadas desabilitadas: ${disabledRequested.join(', ')}.`,
                    );
                    contractLog[agentName].warnings.push(
                        `Skills desabilitadas na sessão: ${disabledRequested.join(', ')}`,
                    );
                }
            }
        }

        // Valida array de ferramentas do agente
        if (agent.tools === null || agent.tools === undefined) {
            contractLog[agentName].toolsResolved =
                availableTools && availableTools instanceof Set ? Array.from(availableTools).sort() : ['*'];
            contractLog[agentName].status = 'ok';
            continue;
        }

        if (!Array.isArray(agent.tools)) {
            errors.push(
                `Agente "${agentName}" tem ferramentas inválidas: deve ser string[]. Recebido ${typeof agent.tools}.`,
            );
            contractLog[agentName].status = 'error';
            contractLog[agentName].errors.push('Array de ferramentas inválido');
            continue;
        }

        if (agent.tools.length === 0) {
            warnings.push(
                `Agente "${agentName}" declarou tools=[]. O SDK aceita isso, mas o agente operará sem ferramentas.`,
            );
            contractLog[agentName].warnings.push('Array de ferramentas vazio');
        }

        // Normaliza nomes de ferramentas (canônico + legado → canônico). `*` é uma declaração simbólica resolvida contra
        // o registro vivo de ferramentas quando disponível.
        const normalized = normalizeAgentToolList(agent.tools);
        if (agent.tools.includes('*') && availableTools && availableTools instanceof Set) {
            normalized.canonical = Array.from(availableTools).sort();
        }

        contractLog[agentName].toolsResolved = normalized.canonical;
        contractLog[agentName].unresolvedTools = normalized.unresolved.filter((tool) => tool !== '*');

        // Marca ferramentas não resolvidas como erro
        if (contractLog[agentName].unresolvedTools.length > 0) {
            const unresolvedStr = contractLog[agentName].unresolvedTools.join(', ');
            errors.push(
                `Agente "${agentName}" declara ferramentas não resolvidas: ${unresolvedStr}. ` +
                    `Essas ferramentas não estão no registro canônico e não têm aliases legados.`,
            );
            contractLog[agentName].errors.push(`Ferramentas não resolvidas: ${unresolvedStr}`);
        }

        // Se availableTools foi fornecido, verifica se todas as ferramentas resolvidas estão realmente disponíveis.
        if (availableTools && availableTools instanceof Set) {
            const unavailable = normalized.canonical.filter((t) => t !== '*' && !availableTools.has(t));
            if (unavailable.length > 0) {
                const unavailableStr = unavailable.join(', ');
                warnings.push(
                    `Agente "${agentName}" declara ferramentas que não estão disponíveis no momento: ${unavailableStr}. ` +
                        `A sessão pode falhar se essas ferramentas forem invocadas.`,
                );
                contractLog[agentName].warnings.push(`Ferramentas indisponíveis: ${unavailableStr}`);
            }
        }

        const tiers = agent.toolTiers;
        if (tiers) {
            const tierMust = normalizeTierTools(tiers.must ?? []);
            const tierShould = normalizeTierTools(tiers.should ?? []);
            const tierOptional = normalizeTierTools(tiers.optional ?? []);

            if (tierMust.unresolved.length > 0) {
                const unresolvedStr = tierMust.unresolved.join(', ');
                errors.push(
                    `Agente "${agentName}" tem ferramentas obrigatórias de tier não resolvidas: ${unresolvedStr}.`,
                );
                contractLog[agentName].errors.push(`Ferramentas obrigatórias de tier não resolvidas: ${unresolvedStr}`);
            }
            if (tierShould.unresolved.length > 0) {
                const unresolvedStr = tierShould.unresolved.join(', ');
                warnings.push(
                    `Agente "${agentName}" tem ferramentas recomendadas de tier não resolvidas: ${unresolvedStr}.`,
                );
                contractLog[agentName].warnings.push(
                    `Ferramentas recomendadas de tier não resolvidas: ${unresolvedStr}`,
                );
            }
            if (tierOptional.unresolved.length > 0) {
                contractLog[agentName].warnings.push(
                    `Ferramentas opcionais de tier não resolvidas: ${tierOptional.unresolved.join(', ')}`,
                );
            }

            if (availableTools && availableTools instanceof Set) {
                const missingMust = tierMust.canonical.filter((tool) => !availableTools.has(tool));
                const missingShould = tierShould.canonical.filter((tool) => !availableTools.has(tool));
                if (missingMust.length > 0) {
                    const missingStr = missingMust.join(', ');
                    errors.push(`Agente "${agentName}" exige ferramentas indisponíveis: ${missingStr}.`);
                    contractLog[agentName].errors.push(`Ferramentas obrigatórias indisponíveis: ${missingStr}`);
                }
                if (missingShould.length > 0) {
                    const missingStr = missingShould.join(', ');
                    warnings.push(`Agente "${agentName}" tem ferramentas recomendadas indisponíveis: ${missingStr}.`);
                    contractLog[agentName].warnings.push(`Ferramentas recomendadas indisponíveis: ${missingStr}`);
                }
            }
        }

        // Determina status final
        if (contractLog[agentName].errors.length > 0) {
            contractLog[agentName].status = 'error';
        } else if (contractLog[agentName].warnings.length > 0) {
            contractLog[agentName].status = 'warning';
        } else {
            contractLog[agentName].status = 'ok';
        }
    }

    return { errors, warnings, contractLog };
}

/**
 * @param {string[]} tools
 * @returns {{ canonical: string[]; unresolved: string[] }}
 */
function normalizeTierTools(tools) {
    const canonical = new Set();
    const unresolved = [];
    for (const tool of tools) {
        const resolved = resolveToolName(tool);
        if (resolved && resolved !== '*') {
            canonical.add(resolved);
        } else {
            unresolved.push(tool);
        }
    }
    return {
        canonical: Array.from(canonical).sort(),
        unresolved,
    };
}

/**
 * Formata o resultado de validação para exibição/registro.
 *
 * @param {{ errors: string[]; warnings: string[]; contractLog: Object }} result - Resultado de validação de
 *   validateAgentContracts()
 * @returns {string} Resumo formatado
 */
export function formatValidationResult(result) {
    const lines = [];

    if (result.errors.length > 0) {
        lines.push('ERROS DE VALIDAÇÃO DE CONTRATO DE AGENTE:');
        result.errors.forEach((err) => {
            lines.push(`  • ${err}`);
        });
    }

    if (result.warnings.length > 0) {
        lines.push('AVISOS DE VALIDAÇÃO DE CONTRATO DE AGENTE:');
        result.warnings.forEach((warn) => {
            lines.push(`  • ${warn}`);
        });
    }

    if (result.errors.length === 0 && result.warnings.length === 0) {
        lines.push('Todos os contratos de agente foram validados com sucesso.');
    }

    // Acrescenta resumo por agente
    const summaryLines = [];
    for (const [agentName, contract] of Object.entries(result.contractLog)) {
        const status = contract.status === 'ok' ? '[OK]' : contract.status === 'warning' ? '[AVISO]' : '[ERRO]';
        summaryLines.push(`  ${status} ${agentName}: ${contract.toolsResolved.length} ferramentas resolvidas`);
        if (contract.unresolvedTools.length > 0) {
            summaryLines.push(`      não resolvidas: ${contract.unresolvedTools.join(', ')}`);
        }
    }

    if (summaryLines.length > 0) {
        lines.push('');
        lines.push('Resumo por agente:');
        lines.push(...summaryLines);
    }

    return lines.join('\n');
}
