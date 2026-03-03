// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { evaluateStaticContracts } from '../contracts/evaluate_static.mjs';

/**
 * @typedef {import('../normalize/findings.mjs').RawFinding} RawFinding
 */

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeRelative(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '');
}

/**
 * @param {string} currentDir
 * @param {string[]} files
 */
function collectJsFiles(currentDir, files) {
    if (!fs.existsSync(currentDir)) {
        return;
    }

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
                collectJsFiles(fullPath, files);
            }
            continue;
        }
        if (/\.(js|mjs|cjs)$/.test(entry.name)) {
            files.push(fullPath);
        }
    }
}

/**
 * @typedef {object} CollectSecurityFindingsOptions
 * @property {string} rootDir
 * @property {unknown[]} contracts
 */
/**
 * @param {CollectSecurityFindingsOptions} options
 * @returns {Promise<{
 *   findings: RawFinding[],
 *   errors: Array<{source:string,message:string}>,
 *   warnings: Array<{source:string,message:string}>,
 *   telemetry: {
 *     contracts_scanned: number,
 *     files_scanned: number,
 *     checks: string[],
 *     findings_by_kind: Record<string, number>,
 *   },
 * }>}
 */
export async function collectSecurityFindings(options) {
    const rootDir = path.resolve(options.rootDir);
    /** @type {RawFinding[]} */
    const findings = [];
    /** @type {Array<{source:string,message:string}>} */
    const errors = [];
    /** @type {Array<{source:string,message:string}>} */
    const warnings = [];

    const securityContracts = Array.isArray(options.contracts)
        ? options.contracts.filter(contract => contract?.domain === 'security')
        : [];

    const contractEval = evaluateStaticContracts({
        rootDir,
        scanDir: path.join(rootDir, 'src'),
        contracts: securityContracts,
    });
    for (const item of contractEval.findings) {
        findings.push(
            /** @type {RawFinding} */ ({
                ...item,
                source_tool: item.source_tool || 'security-contracts',
                domain: item.domain || 'security',
            })
        );
    }

    /** @type {string[]} */
    const serverFiles = [];
    collectJsFiles(path.join(rootDir, 'src', 'server'), serverFiles);
    collectJsFiles(path.join(rootDir, 'src', 'api'), serverFiles);

    let unauthenticatedSurfaceCount = 0;
    let authSignalCount = 0;
    let securityHeaderSignalFound = false;

    for (const absoluteFile of serverFiles) {
        const content = fs.readFileSync(absoluteFile, 'utf8');
        const relFile = normalizeRelative(path.relative(rootDir, absoluteFile));
        const routeMatches = content.match(/\b(app|router)\.(get|post|put|patch|delete)\s*\(/g) || [];
        const authSignals =
            content.match(/\b(requireAuth|authenticate|authMiddleware|verifyJwt|rbac|Authorization|Bearer)\b/g) || [];
        const headerSignals =
            content.match(/\b(helmet\s*\(|Content-Security-Policy|X-Frame-Options|X-Content-Type-Options)\b/g) || [];

        authSignalCount += authSignals.length;
        if (headerSignals.length > 0) {
            securityHeaderSignalFound = true;
        }

        if (routeMatches.length > 0 && authSignals.length === 0) {
            unauthenticatedSurfaceCount += routeMatches.length;
            findings.push({
                source_tool: 'security-http-surface',
                contract_id: null,
                domain: 'security',
                file: relFile,
                line: null,
                evidence: `${routeMatches.length} rota(s) encontradas sem sinal óbvio de auth no arquivo`,
                severity_hint: 'P1',
                type: 'gap',
                impact: 'Superfícies HTTP sem autenticação explícita aumentam o risco de acesso indevido.',
                root_cause:
                    'Arquivo de rotas/controlador sem evidência local de middleware ou validação de autenticação.',
                suggested_patch:
                    'Adicionar middleware/camada explícita de autenticação/autorização ou documentar o caminho seguro.',
                test_strategy: 'Revisar rotas e validar a presença de middleware auth nos endpoints expostos.',
                regression_risk: 'Médio',
            });
        }
    }

    if (serverFiles.length > 0 && !securityHeaderSignalFound) {
        findings.push({
            source_tool: 'security-headers',
            contract_id: null,
            domain: 'security',
            file: 'src/server',
            line: null,
            evidence:
                'Nenhum sinal explícito de headers de segurança (CSP/XFO/XCTO/helmet) foi encontrado no subtree do server.',
            severity_hint: 'P2',
            type: 'upgrade',
            impact: 'Ausência de headers explícitos reduz defesa em profundidade na superfície HTTP.',
            root_cause: 'O subtree do server não expõe configuração evidente de headers de segurança.',
            suggested_patch:
                'Adicionar middleware central de security headers ou documentar o enforcement já existente.',
            test_strategy: 'Validar respostas HTTP e confirmar headers de segurança obrigatórios.',
            regression_risk: 'Baixo',
        });
    }

    if (serverFiles.length === 0) {
        warnings.push({
            source: 'security-collector',
            message: 'Nenhum arquivo em src/server ou src/api foi encontrado para heurísticas HTTP de segurança.',
        });
    }

    return {
        findings,
        errors,
        warnings,
        telemetry: {
            contracts_scanned: contractEval.contracts_scanned,
            files_scanned: contractEval.files_scanned,
            checks: ['security.contracts', 'security.http_surface', 'security.headers'],
            findings_by_kind: {
                contracts: contractEval.findings.length,
                http_surface: unauthenticatedSurfaceCount,
                headers: securityHeaderSignalFound ? 0 : serverFiles.length > 0 ? 1 : 0,
                auth_signals: authSignalCount,
            },
        },
    };
}
