// @ts-check
/**
 * @typedef {import('./load_registry.mjs').ContractDefinitionV1} ContractDefinitionV1
 */

/**
 * Contratos legados usados para paridade durante migração híbrida.
 * @returns {ContractDefinitionV1[]}
 */
export function getLegacyStaticContracts() {
    return [
        {
            id: 'CONTRACT-STATIC-PUPPETEER-LAUNCH',
            title: 'Puppeteer launch proibido',
            domain: 'logic',
            description: 'Uso de puppeteer.launch() detectado — arquitetura exige connect-only.',
            kind: 'static',
            severity_default: 'P1',
            type_default: 'falha de contrato',
            matcher: {
                engine: 'regex',
                pattern: '\\bpuppeteer\\.launch\\s*\\(',
                flags: 'g',
                scope: 'src',
                ignore_comment_like: true,
                ignore_string_like: true,
            },
            allowlist: { files: [] },
            test_recipe: ['npm run check:forbidden'],
            owner: 'legacy-adapter',
            status: 'active',
            version: 1,
            enforcement: { level: 'p1' },
        },
        {
            id: 'CONTRACT-STATIC-PROCESS-EXIT',
            title: 'process.exit restrito',
            domain: 'logic',
            description: 'Uso de process.exit() detectado — permitido apenas em entrypoints autorizados.',
            kind: 'static',
            severity_default: 'P1',
            type_default: 'falha de contrato',
            matcher: {
                engine: 'regex',
                pattern: 'process\\.exit\\s*\\(',
                flags: 'g',
                scope: 'src',
                ignore_comment_like: true,
                ignore_string_like: true,
            },
            allowlist: {
                files: ['src/main.js', 'src/server/main.js', 'src/server/engine/lifecycle.js'],
            },
            test_recipe: ['npm run check:forbidden'],
            owner: 'legacy-adapter',
            status: 'active',
            version: 1,
            enforcement: { level: 'p1' },
        },
        {
            id: 'CONTRACT-STATIC-HARDCODED-PORTS',
            title: 'Portas hardcoded proibidas',
            domain: 'config',
            description: 'Porta hardcoded detectada (9222/9224) — use configuração via env/CONFIG.',
            kind: 'static',
            severity_default: 'P1',
            type_default: 'falha de contrato',
            matcher: {
                engine: 'regex',
                pattern: '\\b9222\\b|\\b9224\\b',
                flags: 'g',
                scope: 'src',
                ignore_comment_like: true,
                ignore_string_like: true,
            },
            allowlist: {
                files: [
                    'src/core/config.js',
                    'src/infra/ConnectionOrchestrator.js',
                    'src/core/boot_resilience_manager.js',
                    'src/core/doctor.js',
                    'src/infra/browser_pool/pool_manager.js',
                    'src/driver/nerv_adapter/driver_nerv_adapter.js',
                    'src/server/main.js',
                ],
            },
            test_recipe: ['npm run check:forbidden'],
            owner: 'legacy-adapter',
            status: 'active',
            version: 1,
            enforcement: { level: 'p1' },
        },
        {
            id: 'CONTRACT-STATIC-FILE-IPC-ESTADO',
            title: 'estado.json proibido',
            domain: 'logic',
            description: 'Uso de discovery por arquivo (estado.json) detectado — migre para NERV SERVER_READY.',
            kind: 'static',
            severity_default: 'P1',
            type_default: 'falha de contrato',
            matcher: {
                engine: 'regex',
                pattern: 'estado\\.json',
                flags: 'g',
                scope: 'src',
                ignore_comment_like: true,
                ignore_string_like: true,
            },
            allowlist: { files: [] },
            test_recipe: ['npm run check:forbidden'],
            owner: 'legacy-adapter',
            status: 'active',
            version: 1,
            enforcement: { level: 'p1' },
        },
    ];
}

/**
 * @param {{ id: string }[]} contracts
 * @param {*} contracts
  * @returns {object}
 */
export function indexByContractId(contracts) {
    /** @type {Map<string, any>} */
    const map = new Map();
    for (const contract of contracts) {
        map.set(contract.id, contract);
    }
    return map;
}
