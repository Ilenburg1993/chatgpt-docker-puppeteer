// @ts-check
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
/** Caminho padrão do registry v3 de contratos (fonte canônica local). */
const DEFAULT_REGISTRY_PATH = path.join(ROOT, 'contracts', 'registry.json');

const VALID_KINDS = new Set(['static', 'runtime', 'protocol', 'operational', 'chaos']);
const VALID_SEVERITIES = new Set(['P0', 'P1', 'P2', 'P3']);
const VALID_TYPES = new Set(['bug', 'gap', 'falha de contrato', 'incompletude', 'upgrade']);
const VALID_STATUSES = new Set(['draft', 'active', 'deprecated', 'retired']);
const VALID_ENFORCE_LEVELS = new Set(['off', 'warn', 'p1', 'p0']);

/**
 * @typedef {object} ContractDefinitionV1
 * @property {string} id
 * @property {string} title
 * @property {string} domain
 * @property {string} description
 * @property {'static' | 'runtime' | 'protocol' | 'operational' | 'chaos'} kind
 * @property {'P0' | 'P1' | 'P2' | 'P3'} severity_default
 * @property {'bug' | 'gap' | 'falha de contrato' | 'incompletude' | 'upgrade'} type_default
 * @property {Record<string, unknown>} matcher
 * @property {{ files?: string[]; allowlist_id?: string; allowlist_key?: string }} [allowlist]
 * @property {string[]} test_recipe
 * @property {string} owner
 * @property {'draft' | 'active' | 'deprecated' | 'retired'} status
 * @property {number} version
 * @property {{ level?: 'off' | 'warn' | 'p1' | 'p0' }} [enforcement]
 * @property {string} [source_path]
 */

/**
 * @param {string} filePath
 * @returns {any}
 */
function readJson(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
}

/**
 * @param {ContractDefinitionV1} contract
 * @param {number} index
 * @param {string} sourcePath
 * @returns {string[]}
 */
function validateContract(contract, index, sourcePath) {
    /** @type {string[]} */
    const errors = [];
    const ptr = `${sourcePath}#contracts[${index}]`;

    if (!contract || typeof contract !== 'object') {
        return [`${ptr}: contrato inválido`];
    }

    if (!contract.id || typeof contract.id !== 'string') errors.push(`${ptr}: id obrigatório`);
    if (!contract.title || typeof contract.title !== 'string') errors.push(`${ptr}: title obrigatório`);
    if (!contract.domain || typeof contract.domain !== 'string') errors.push(`${ptr}: domain obrigatório`);
    if (!contract.description || typeof contract.description !== 'string')
        errors.push(`${ptr}: description obrigatório`);
    if (!VALID_KINDS.has(contract.kind)) errors.push(`${ptr}: kind inválido (${String(contract.kind)})`);
    if (!VALID_SEVERITIES.has(contract.severity_default)) errors.push(`${ptr}: severity_default inválido`);
    if (!VALID_TYPES.has(contract.type_default)) errors.push(`${ptr}: type_default inválido`);
    if (!contract.matcher || typeof contract.matcher !== 'object') errors.push(`${ptr}: matcher obrigatório`);
    if (!Array.isArray(contract.test_recipe) || contract.test_recipe.length === 0)
        errors.push(`${ptr}: test_recipe obrigatório`);
    if (!contract.owner || typeof contract.owner !== 'string') errors.push(`${ptr}: owner obrigatório`);
    if (!VALID_STATUSES.has(contract.status)) errors.push(`${ptr}: status inválido`);
    if (!Number.isFinite(contract.version) || contract.version < 1) errors.push(`${ptr}: version inválido`);

    const enforceLevel = contract.enforcement?.level || 'warn';
    if (!VALID_ENFORCE_LEVELS.has(enforceLevel)) {
        errors.push(`${ptr}: enforcement.level inválido (${String(enforceLevel)})`);
    }

    return errors;
}

/**
 * @typedef {object} LoadContractRegistryOptions
 * @property {string | undefined} [registryPath]
 * @property {string[] | undefined} [domainsFilter]
 */
/**
 * @param {LoadContractRegistryOptions} [options]
 * @returns {{
 *     registryPath: string;
 *     registry: unknown;
 *     contracts: ContractDefinitionV1[];
 *     byId: Map<string, ContractDefinitionV1>;
 *     allowlists: Record<string, Record<string, string[]>>;
 *     errors: string[];
 *     warnings: string[];
 * }}
 */
export function loadContractRegistry(options = {}) {
    const registryPath = path.resolve(options.registryPath || DEFAULT_REGISTRY_PATH);
    const registryBaseDir = path.dirname(registryPath);
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const warnings = [];

    if (!fs.existsSync(registryPath)) {
        return {
            registryPath,
            registry: null,
            contracts: [],
            byId: new Map(),
            allowlists: {},
            errors: [`registry não encontrado em ${registryPath}`],
            warnings,
        };
    }

    const registry = readJson(registryPath);
    if (registry?.schema_version !== '1.0') {
        errors.push(`registry.schema_version inválido: ${String(registry?.schema_version)}`);
    }

    const domains = Array.isArray(registry?.domains) ? registry.domains : [];
    const domainsFilter = Array.isArray(options.domainsFilter) ? new Set(options.domainsFilter) : null;
    /** @type {ContractDefinitionV1[]} */
    const contracts = [];

    /** @type {Record<string, Record<string, string[]>>} */
    const allowlists = {};
    const allowlistPaths = Array.isArray(registry?.allowlists) ? registry.allowlists : [];
    for (const relPath of allowlistPaths) {
        const fullPath = path.isAbsolute(String(relPath))
            ? String(relPath)
            : path.resolve(registryBaseDir, String(relPath));
        if (!fs.existsSync(fullPath)) {
            warnings.push(`allowlist não encontrado: ${relPath}`);
            continue;
        }
        const payload = readJson(fullPath);
        const allowlistId = String(payload?.id || path.basename(fullPath, '.json'));
        if (!allowlists[allowlistId]) {
            allowlists[allowlistId] = {};
        }
        const entries = payload?.items && typeof payload.items === 'object' ? payload.items : {};
        for (const [key, value] of Object.entries(entries)) {
            allowlists[allowlistId][key] = Array.isArray(value)
                ? value.map((item) => String(item).replace(/\\/g, '/'))
                : [];
        }
    }

    for (const relPath of domains) {
        const fullPath = path.isAbsolute(String(relPath))
            ? String(relPath)
            : path.resolve(registryBaseDir, String(relPath));
        if (!fs.existsSync(fullPath)) {
            errors.push(`domain file ausente: ${relPath}`);
            continue;
        }
        const payload = readJson(fullPath);
        const domainName = String(payload?.domain || '');
        if (domainsFilter && domainsFilter.size > 0 && !domainsFilter.has(domainName)) {
            continue;
        }
        const domainContracts = Array.isArray(payload?.contracts) ? payload.contracts : [];
        domainContracts.forEach((/** @type {any} */ item, /** @type {any} */ index) => {
            const contract = /** @type {ContractDefinitionV1} */ ({
                ...item,
                source_path: String(relPath),
            });
            errors.push(...validateContract(contract, index, String(relPath)));
            contracts.push(contract);
        });
    }

    /** @type {Map<string, ContractDefinitionV1>} */
    const byId = new Map();
    for (const contract of contracts) {
        if (byId.has(contract.id)) {
            errors.push(`contract id duplicado: ${contract.id}`);
            continue;
        }
        byId.set(contract.id, contract);
    }

    return {
        registryPath,
        registry,
        contracts,
        byId,
        allowlists,
        errors,
        warnings,
    };
}

export { DEFAULT_REGISTRY_PATH };
