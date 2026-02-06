import fs from 'fs/promises';
import path from 'node:path';
import * as logger from '#core/logger';

/**
 * Diretório de templates.
 */
const TEMPLATES_DIR = path.join(import.meta.dirname, 'templates');

/**
 * WorkflowGenerator - Gera workflows a partir de templates.
 */
class WorkflowGenerator {
    constructor({ templatesDir = TEMPLATES_DIR } = {}) {
        this.templatesDir = templatesDir;
        this.templatesCache = new Map();
    }

    /**
     * Carrega um template do disco.
     *
     * @param {string} templateId - ID do template (ex: 'book_writing')
     * @returns {Promise<Object>} - Template carregado
     */
    async loadTemplate(templateId) {
        // Verifica cache
        if (this.templatesCache.has(templateId)) {
            return this.templatesCache.get(templateId);
        }

        const templatePath = path.join(this.templatesDir, `${templateId}.json`);

        try {
            const content = await fs.readFile(templatePath, 'utf8');
            const template = JSON.parse(content);

            // Valida estrutura básica
            if (!template.id || !template.workflow_template) {
                throw new Error(`Template ${templateId} inválido: falta id ou workflow_template`);
            }

            // Cacheia
            this.templatesCache.set(templateId, template);

            logger.log('INFO', `[WorkflowGenerator] Template carregado: ${templateId}`);
            return template;
        } catch (error) {
            logger.log('ERROR', `[WorkflowGenerator] Erro ao carregar template ${templateId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Gera um workflow a partir de um template.
     *
     * @param {string} templateId - ID do template
     * @param {Object} params - Parâmetros fornecidos pelo usuário
     * @returns {Promise<Object>} - Workflow estruturado
     */
    async generateWorkflow(templateId, params = {}) {
        const template = await this.loadTemplate(templateId);

        // 1. Valida parâmetros
        const validatedParams = this._validateParams(template, params);

        // 2. Cria contexto com defaults + params
        const context = this._buildContext(template, validatedParams);

        // 3. Expande steps (repeat_for_each)
        const expandedSteps = await this._expandSteps(template.workflow_template.steps, context);

        // 4. Substitui placeholders em todos os steps
        const finalSteps = this._replacePlaceholders(expandedSteps, context);

        // 5. Monta workflow final
        const workflow = {
            id: `workflow-${Date.now()}`,
            template_id: templateId,
            template_version: template.version,
            created_at: new Date().toISOString(),
            params: validatedParams,
            steps: finalSteps,
            metadata: {
                total_steps: finalSteps.length,
                estimated_cost: template.cost_estimate,
                estimated_time: template.execution_estimate,
                success_criteria: template.success_criteria
            }
        };

        logger.log('INFO', `[WorkflowGenerator] Workflow gerado: ${templateId} → ${finalSteps.length} steps`);
        return workflow;
    }

    /**
     * Valida parâmetros fornecidos contra schema do template.
     */
    _validateParams(template, params) {
        const validated = {};
        const errors = [];

        // Itera sobre params definidos no template
        for (const [key, schema] of Object.entries(template.params || {})) {
            const value = params[key];

            // Verifica required
            if (schema.required && (value === undefined || value === null)) {
                errors.push(`Parâmetro obrigatório ausente: ${key}`);
                continue;
            }

            // Usa default se não fornecido
            if (value === undefined || value === null) {
                validated[key] = schema.default;
                continue;
            }

            // Valida tipo
            if (schema.type === 'number' && typeof value !== 'number') {
                errors.push(`Parâmetro ${key} deve ser number, recebeu ${typeof value}`);
                continue;
            }

            if (schema.type === 'string' && typeof value !== 'string') {
                errors.push(`Parâmetro ${key} deve ser string, recebeu ${typeof value}`);
                continue;
            }

            // Valida range (para numbers)
            if (schema.type === 'number') {
                if (schema.min !== undefined && value < schema.min) {
                    errors.push(`Parâmetro ${key} deve ser >= ${schema.min}, recebeu ${value}`);
                    continue;
                }
                if (schema.max !== undefined && value > schema.max) {
                    errors.push(`Parâmetro ${key} deve ser <= ${schema.max}, recebeu ${value}`);
                    continue;
                }
            }

            validated[key] = value;
        }

        if (errors.length > 0) {
            throw new Error(`Validação de parâmetros falhou:\n${errors.join('\n')}`);
        }

        return validated;
    }

    /**
     * Constrói contexto completo (params + computed values).
     */
    _buildContext(template, params) {
        return {
            ...params,
            // Computed values podem ser adicionados aqui
            template_id: template.id,
            template_name: template.name
        };
    }

    /**
     * Expande steps que têm repeat_for_each.
     *
     * NOTA: Por ora, implementação simplificada que expande baseado em num_chapters.
     * Versão completa integraria com outline gerado.
     */
    async _expandSteps(steps, context) {
        const expanded = [];

        for (const step of steps) {
            // Se step tem repeat_for_each, expande
            if (step.repeat_for_each) {
                // Exemplo: repeat_for_each: "outline.chapters"
                // Por ora, expande baseado em num_chapters do context
                const numChapters = context.num_chapters || 1;

                for (let i = 1; i <= numChapters; i++) {
                    const expandedStep = JSON.parse(JSON.stringify(step)); // Deep clone
                    delete expandedStep.repeat_for_each;

                    // Substitui {{chapter_num}} no ID
                    expandedStep.id = expandedStep.id.replace('{{chapter_num}}', i);

                    // Adiciona chapter_num ao context local deste step
                    expandedStep._context = {
                        chapter_num: i,
                        chapter_title: `Chapter ${i}` // Placeholder, seria do outline real
                    };

                    expanded.push(expandedStep);
                }
            } else {
                // Step normal, adiciona direto
                expanded.push(step);
            }
        }

        return expanded;
    }

    /**
     * Substitui placeholders ({{param}}) em todos os campos dos steps.
     */
    _replacePlaceholders(steps, context) {
        const replaced = [];

        for (const step of steps) {
            const stepContext = {
                ...context,
                ...(step._context || {}) // Merge context local do step
            };

            const replacedStep = this._recursiveReplace(step, stepContext);

            // Remove _context interno (usado apenas para expansão)
            delete replacedStep._context;

            replaced.push(replacedStep);
        }

        return replaced;
    }

    /**
     * Substitui placeholders recursivamente em um objeto.
     */
    _recursiveReplace(obj, context) {
        if (typeof obj === 'string') {
            return this._replacePlaceholdersInString(obj, context);
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this._recursiveReplace(item, context));
        }

        if (obj !== null && typeof obj === 'object') {
            const replaced = {};
            for (const [key, value] of Object.entries(obj)) {
                replaced[key] = this._recursiveReplace(value, context);
            }
            return replaced;
        }

        return obj;
    }

    /**
     * Substitui placeholders em uma string.
     * Ex: "Write chapter {{chapter_num}}" → "Write chapter 5"
     */
    _replacePlaceholdersInString(str, context) {
        return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            if (key in context) {
                return String(context[key]);
            }
            // Se placeholder não encontrado, mantém original
            return match;
        });
    }

    /**
     * Lista todos os templates disponíveis.
     *
     * @returns {Promise<string[]>} - Array de IDs de templates
     */
    async listTemplates() {
        try {
            const files = await fs.readdir(this.templatesDir);
            const templates = files
                .filter(f => f.endsWith('.json'))
                .map(f => f.replace('.json', ''));

            return templates;
        } catch (error) {
            logger.log('ERROR', `[WorkflowGenerator] Erro ao listar templates: ${error.message}`);
            throw error;
        }
    }

    /**
     * Limpa cache de templates.
     */
    clearCache() {
        this.templatesCache.clear();
        logger.log('INFO', '[WorkflowGenerator] Cache limpo');
    }
}

export { WorkflowGenerator };
