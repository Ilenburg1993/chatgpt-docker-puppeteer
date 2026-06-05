// @ts-check
/**
 * src/copilot/tools/introspection/tool-contract-verifier.js
 *
 * Verificador de contrato de tools registradas no runtime.
 *
 * Objetivo: detectar gaps de metadados/configuração de forma centralizada para rastreabilidade operacional.
 *
 * @module copilot/tools/introspection/tool-contract-verifier
 */

/**
 * @typedef {import('#copilot/sdk/types').ToolRegistry} ToolRegistry
 */

import {
    buildToolDefinitionMetadata,
    isHighImpactToolRisk,
    permissionModeSkipsPrompts,
} from './tool-metadata.js';

/**
 * @typedef {'error' | 'warning' | 'notice' | 'decision'} ToolContractIssueSeverity
 */

/**
 * @typedef {{
 *     severity: ToolContractIssueSeverity;
 *     code: string;
 *     toolName: string;
 *     message: string;
 * }} ToolContractIssue
 */

/**
 * @typedef {{
 *     generatedAt: number;
 *     totalTools: number;
 *     ok: boolean;
 *     errorCount: number;
 *     warningCount: number;
 *     missingDescriptionCount: number;
 *     missingParametersCount: number;
 *     invalidParametersCount: number;
 *     missingCategoryCount: number;
 *     missingTagsCount: number;
 *     missingInstructionsCount: number;
 *     riskySkipPermissionCount: number;
 *     autonomySkipPermissionCount: number;
 *     noticeCount: number;
 *     decisionCount: number;
 *     permissionMode: import('./tool-metadata.js').ToolPermissionMode;
 *     metadataCoverage: {
 *         descriptionPct: number;
 *         parametersPct: number;
 *         categoryPct: number;
 *         tagsPct: number;
 *         instructionsPct: number;
 *     };
 *     metadataByName: Record<string, import('./tool-metadata.js').ToolDefinitionMetadata>;
 *     issues: ToolContractIssue[];
 * }} ToolContractReport
 */

/**
 * @param {number} value
 * @returns {number}
 */
function roundOne(value) {
    return Math.round(value * 10) / 10;
}

/**
 * @param {number} part
 * @param {number} total
 * @returns {number}
 */
function pct(part, total) {
    if (total <= 0) return 100;
    return roundOne((part / total) * 100);
}

/**
 * @param {unknown} schema
 * @returns {boolean}
 */
function isUsableSchema(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
    const record = /** @type {Record<string, unknown>} */ (schema);
    if (typeof record['type'] === 'string') return true;
    if (typeof record['$ref'] === 'string') return true;
    if (record['properties'] && typeof record['properties'] === 'object') return true;
    if (Array.isArray(record['oneOf']) || Array.isArray(record['anyOf']) || Array.isArray(record['allOf'])) {
        return true;
    }
    if ('additionalProperties' in record) return true;
    return false;
}

/**
 * @returns {ToolContractReport}
 */
export function createEmptyToolContractReport() {
    return {
        generatedAt: Date.now(),
        totalTools: 0,
        ok: true,
        errorCount: 0,
        warningCount: 0,
        missingDescriptionCount: 0,
        missingParametersCount: 0,
        invalidParametersCount: 0,
        missingCategoryCount: 0,
        missingTagsCount: 0,
        missingInstructionsCount: 0,
        riskySkipPermissionCount: 0,
        autonomySkipPermissionCount: 0,
        noticeCount: 0,
        decisionCount: 0,
        permissionMode: 'selective',
        metadataCoverage: {
            descriptionPct: 100,
            parametersPct: 100,
            categoryPct: 100,
            tagsPct: 100,
            instructionsPct: 100,
        },
        metadataByName: {},
        issues: [],
    };
}

/**
 * Verifica o contrato das tools registradas no ToolRegistry.
 *
 * @param {ToolRegistry | null | undefined} registry
 * @param {{ permissionMode?: import('./tool-metadata.js').ToolPermissionMode }} [options]
 * @returns {ToolContractReport}
 */
export function verifyToolRegistryContracts(registry, options = {}) {
    const permissionMode = options.permissionMode ?? 'selective';
    if (!(registry?.entries instanceof Map)) {
        return {
            ...createEmptyToolContractReport(),
            ok: false,
            errorCount: 1,
            permissionMode,
            issues: [
                {
                    severity: 'error',
                    code: 'REGISTRY_UNAVAILABLE',
                    toolName: '(registry)',
                    message: 'ToolRegistry indisponível para verificação de contrato.',
                },
            ],
        };
    }

    /** @type {ToolContractIssue[]} */
    const issues = [];
    let withDescription = 0;
    let withParameters = 0;
    let withCategory = 0;
    let withTags = 0;
    let withInstructions = 0;

    let missingDescriptionCount = 0;
    let missingParametersCount = 0;
    let invalidParametersCount = 0;
    let missingCategoryCount = 0;
    let missingTagsCount = 0;
    let missingInstructionsCount = 0;
    let riskySkipPermissionCount = 0;
    let autonomySkipPermissionCount = 0;
    /** @type {Record<string, import('./tool-metadata.js').ToolDefinitionMetadata>} */
    const metadataByName = {};

    for (const [entryName, entryValue] of registry.entries) {
        const entry = /** @type {Record<string, unknown>} */ (entryValue ?? {});
        const tool = /** @type {Record<string, unknown>} */ (entry['tool'] ?? {});
        const toolName = typeof tool['name'] === 'string' && tool['name'] ? tool['name'] : entryName;
        const metadata = buildToolDefinitionMetadata(entryName, entryValue, { permissionMode });
        metadataByName[toolName] = metadata;

        if (typeof tool['handler'] !== 'function') {
            issues.push({
                severity: 'error',
                code: 'MISSING_HANDLER',
                toolName,
                message: 'Tool sem handler executável.',
            });
        }

        const description = typeof tool['description'] === 'string' ? tool['description'].trim() : '';
        if (description.length > 0) {
            withDescription += 1;
        } else {
            missingDescriptionCount += 1;
            issues.push({
                severity: 'warning',
                code: 'MISSING_DESCRIPTION',
                toolName,
                message: 'Descrição ausente ou vazia.',
            });
        }

        const hasParametersKey = 'parameters' in tool;
        const parameters = tool['parameters'];
        if (hasParametersKey && parameters !== undefined) {
            if (isUsableSchema(parameters)) {
                withParameters += 1;
            } else {
                invalidParametersCount += 1;
                issues.push({
                    severity: 'error',
                    code: 'INVALID_PARAMETERS_SCHEMA',
                    toolName,
                    message: 'Campo parameters existe, mas não contém JSON Schema utilizável.',
                });
            }
        } else {
            missingParametersCount += 1;
            issues.push({
                severity: 'warning',
                code: 'MISSING_PARAMETERS',
                toolName,
                message: 'Tool sem schema de parâmetros explícito.',
            });
        }

        const category = typeof entry['category'] === 'string' ? entry['category'].trim() : '';
        if (category && category !== 'uncategorized' && category !== 'unknown') {
            withCategory += 1;
        } else {
            missingCategoryCount += 1;
            issues.push({
                severity: 'warning',
                code: 'MISSING_CATEGORY',
                toolName,
                message: 'Categoria ausente/genérica (uncategorized/unknown).',
            });
        }

        const tags = Array.isArray(entry['tags'])
            ? entry['tags'].filter((tag) => typeof tag === 'string' && tag.trim().length > 0)
            : [];
        if (tags.length > 0) {
            withTags += 1;
        } else {
            missingTagsCount += 1;
            issues.push({
                severity: 'warning',
                code: 'MISSING_TAGS',
                toolName,
                message: 'Tool sem tags de classificação.',
            });
        }

        const instructions = typeof tool['instructions'] === 'string' ? tool['instructions'].trim() : '';
        if (instructions.length > 0) {
            withInstructions += 1;
        } else {
            missingInstructionsCount += 1;
            issues.push({
                severity: 'warning',
                code: 'MISSING_INSTRUCTIONS',
                toolName,
                message: 'Tool sem instructions para orientar uso pelo modelo.',
            });
        }

        const declaredSkipPermission = tool['skipPermission'] === true;
        const highImpact = !metadata.readOnly && isHighImpactToolRisk(metadata.risk);
        if (metadata.effectiveSkipPermission && highImpact) {
            if (permissionModeSkipsPrompts(permissionMode)) {
                autonomySkipPermissionCount += 1;
                issues.push({
                    severity: 'decision',
                    code: 'AUTONOMY_SKIP_PERMISSION',
                    toolName,
                    message:
                        `autonomia efetiva em tool ${metadata.operation} (${metadata.risk}) por ` +
                        `${metadata.autonomyReason ?? `permissionMode=${permissionMode}`}.`,
                });
            } else if (declaredSkipPermission) {
                riskySkipPermissionCount += 1;
                issues.push({
                    severity: 'warning',
                    code: 'RISKY_SKIP_PERMISSION',
                    toolName,
                    message:
                        `skipPermission=true em tool ${metadata.operation} potencialmente mutável ` +
                        `(risk=${metadata.risk}, category=${category || 'unknown'}).`,
                });
            }
        }
    }

    const totalTools = registry.entries.size;
    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
    const noticeCount = issues.filter((issue) => issue.severity === 'notice').length;
    const decisionCount = issues.filter((issue) => issue.severity === 'decision').length;

    return {
        generatedAt: Date.now(),
        totalTools,
        ok: errorCount === 0,
        errorCount,
        warningCount,
        noticeCount,
        decisionCount,
        missingDescriptionCount,
        missingParametersCount,
        invalidParametersCount,
        missingCategoryCount,
        missingTagsCount,
        missingInstructionsCount,
        riskySkipPermissionCount,
        autonomySkipPermissionCount,
        permissionMode,
        metadataCoverage: {
            descriptionPct: pct(withDescription, totalTools),
            parametersPct: pct(withParameters, totalTools),
            categoryPct: pct(withCategory, totalTools),
            tagsPct: pct(withTags, totalTools),
            instructionsPct: pct(withInstructions, totalTools),
        },
        metadataByName,
        issues,
    };
}
