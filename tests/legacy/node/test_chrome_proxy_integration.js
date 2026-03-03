// @ts-check
// @ts-nocheck
import { log } from '#core/logger';

// Configuração de teste
process.env.NODE_ENV = 'test';
process.env.CHROME_PROXY_ENABLED = 'true';
process.env.CHROME_PROXY_PORT = '9224';
process.env.CHROME_PORT = '9225';

/**
 * Função exportada: testChromeProxyIntegration.
 * @returns {Promise<void>}
 */
async function testChromeProxyIntegration() {
    log('INFO', '========================================');
    log('INFO', 'TESTE: Integração Chrome Proxy + Pool');
    log('INFO', '========================================');

    let chromeProxy = null;
    let nerv = null;
    let browserPool = null;

    const results = {
        proxyStart: false,
        proxyHealth: false,
        poolValidation: false,
        poolConnection: false,
        nervEvents: [],
        shutdown: false,
    };

    try {
        // ===== 1. Iniciar NERV =====
        log('INFO', '[TEST] 1/6: Criando NERV...');
        const nervFactory = await import('#nerv/nerv').then(m => m.default ?? m);
        const nervConstants = await import('#shared/nerv/constants').then(m => m.default ?? m);
        const { createNERV } = nervFactory;
        const { CONNECTION_MODES } = nervConstants;

        nerv = await createNERV({
            mode: CONNECTION_MODES.LOCAL,
            correlation: true,
            bufferSize: 100,
            telemetry: true,
        });

        // Captura eventos NERV
        nerv.onEvent(envelope => {
            results.nervEvents.push({
                actor: envelope.identity?.actor,
                action: envelope.type?.action_code,
                payload: envelope.payload,
                timestamp: Date.now(),
            });
        });

        log('INFO', '[TEST] ✅ NERV criado');

        // ===== 2. Iniciar Chrome Proxy Service =====
        log('INFO', '[TEST] 2/6: Iniciando Chrome Proxy Service...');

        const ChromeProxyService = await import('#infra/proxy/chromeProxyService').then(m => m.default ?? m);
        const CONFIG = await import('#core/config').then(m => m.default ?? m);

        chromeProxy = new ChromeProxyService({
            PUBLIC_IP: CONFIG.CHROME_PROXY_HOST || '192.168.0.2',
            CHROME_PORT: CONFIG.CHROME_PORT || 9225,
            PROXY_PORT: CONFIG.CHROME_PROXY_PORT || 9224,
            LOG_LEVEL: 'INFO',
        });

        chromeProxy.setNERV(nerv);
        await chromeProxy.start();

        results.proxyStart = true;
        log('INFO', '[TEST] ✅ Chrome Proxy Service online');

        // ===== 3. Validar Health Endpoint =====
        log('INFO', '[TEST] 3/6: Validando health endpoint do proxy...');

        const healthUrl = `http://192.168.0.2:9224/health`;
        const healthRes = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
        const healthData = await healthRes.json();

        if (healthData.status === 'ok') {
            results.proxyHealth = true;
            log('INFO', `[TEST] ✅ Proxy health OK: ${JSON.stringify(healthData)}`);
        } else {
            throw new Error(`Proxy health inválido: ${healthData.status}`);
        }

        // ===== 4. Criar Browser Pool (com validação de proxy) =====
        log('INFO', '[TEST] 4/6: Criando Browser Pool (deve validar proxy)...');

        const BrowserPoolManager = await import('#infra/browser_pool/pool_manager').then(m => m.default ?? m);

        browserPool = new BrowserPoolManager({
            poolSize: 1, // 1 instância apenas para teste
            allocationStrategy: 'round-robin',
            healthCheckInterval: 60000,
            browserEndpoint: {
                url: `http://${CONFIG.CHROME_PROXY_HOST || '192.168.0.2'}:${CONFIG.CHROME_PROXY_PORT || 9224}`,
            },
        });

        // Esta chamada deve:
        // 1. Validar proxy (novo método _validateProxyAvailability)
        // 2. Usar .ensureBrowser() (correção do bug)
        await browserPool.initialize();

        results.poolValidation = true;
        results.poolConnection = true;
        log('INFO', '[TEST] ✅ Browser Pool inicializado com sucesso');

        // ===== 5. Validar Eventos NERV =====
        log('INFO', '[TEST] 5/6: Verificando eventos NERV emitidos...');

        const infraReadyEvents = results.nervEvents.filter(
            e => e.action === 'INFRA_READY' && e.payload?.component === 'ChromeProxyService'
        );

        if (infraReadyEvents.length > 0) {
            log('INFO', `[TEST] ✅ Evento INFRA_READY capturado: ${JSON.stringify(infraReadyEvents[0])}`);
        } else {
            log('WARN', '[TEST] ⚠️ Evento INFRA_READY não foi capturado');
        }

        // ===== 6. Shutdown Gracioso =====
        log('INFO', '[TEST] 6/6: Executando shutdown gracioso...');

        if (browserPool) {
            await browserPool.shutdown();
            log('INFO', '[TEST] ✅ Browser Pool encerrado');
        }

        if (chromeProxy) {
            await chromeProxy.stop();
            log('INFO', '[TEST] ✅ Chrome Proxy Service parado');
        }

        results.shutdown = true;

        // ===== RESULTADO FINAL =====
        log('INFO', '');
        log('INFO', '========================================');
        log('INFO', 'RESULTADO DO TESTE');
        log('INFO', '========================================');
        log('INFO', `Proxy Start:       ${results.proxyStart ? '✅' : '❌'}`);
        log('INFO', `Proxy Health:      ${results.proxyHealth ? '✅' : '❌'}`);
        log('INFO', `Pool Validation:   ${results.poolValidation ? '✅' : '❌'}`);
        log('INFO', `Pool Connection:   ${results.poolConnection ? '✅' : '❌'}`);
        log('INFO', `NERV Events:       ${results.nervEvents.length} eventos capturados`);
        log('INFO', `Shutdown:          ${results.shutdown ? '✅' : '❌'}`);
        log('INFO', '========================================');

        const allPassed =
            results.proxyStart &&
            results.proxyHealth &&
            results.poolValidation &&
            results.poolConnection &&
            results.shutdown;

        if (allPassed) {
            log('INFO', '✅ TESTE PASSOU - Integração completa funcional!');
            process.exit(0);
        } else {
            log('ERROR', '❌ TESTE FALHOU - Verificar resultados acima');
            process.exit(1);
        }
    } catch (error) {
        log('ERROR', `❌ TESTE FALHOU: ${error.message}`);
        log('ERROR', error.stack);

        // Cleanup em caso de erro
        try {
            if (browserPool) await browserPool.shutdown();
            if (chromeProxy) await chromeProxy.stop();
        } catch (cleanupError) {
            log('WARN', `Erro no cleanup: ${cleanupError.message}`);
        }

        process.exit(1);
    }
}

// Executa teste
if (import.meta.filename === process.argv[1]) {
    log('INFO', '⚠️ ATENÇÃO: Este teste requer Chrome rodando em localhost:9225');
    log('INFO', '⚠️ Execute: bash scripts/start-chrome.sh OU scripts\\start-chrome.bat');
    log('INFO', '');

    setTimeout(() => {
        testChromeProxyIntegration();
    }, 1000);
}

export { testChromeProxyIntegration };
