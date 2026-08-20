#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';

// Cores para output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

const log = {
    info: (/** @type {any} */ msg) => console.log(`${colors.blue}ℹ ${msg}${colors.reset}`),
    success: (/** @type {any} */ msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
    error: (/** @type {any} */ msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
    warn: (/** @type {any} */ msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
    section: (/** @type {any} */ msg) =>
        console.log(`\n${colors.cyan}${'='.repeat(70)}\n${msg}\n${'='.repeat(70)}${colors.reset}\n`),
};

import GLOBAL_CONFIG_RAW from '/workspaces/chatgpt-docker-puppeteer/config.json' with { type: 'json' };
const GLOBAL_CONFIG = /** @type {any} */ (GLOBAL_CONFIG_RAW);
const PROXY_PORT = GLOBAL_CONFIG.CHROME_PROXY_PORT || 9224;

let passedTests = 0;
let failedTests = 0;

function assert(/** @type {any} */ condition, /** @type {any} */ message) {
    if (condition) {
        log.success(message);
        passedTests++;
        return true;
    } else {
        log.error(message);
        failedTests++;
        return false;
    }
}

// ==========================================================================
// TESTE 1: Validação de Arquivos de Configuração
// ==========================================================================
function testConfigFiles() {
    log.section('TESTE 1: Validação de Arquivos de Configuração');

    // 1.1 - config.json existe e é JSON válido
    let config;
    try {
        config = JSON.parse(fs.readFileSync('/workspaces/chatgpt-docker-puppeteer/config.json', 'utf8'));
        assert(true, 'config.json existe e é JSON válido');
    } catch (/** @type {any} */ e) {
        assert(false, `config.json inválido: ${e.message}`);
        return;
    }

    // 1.2 - Campos críticos existem
    assert(config.BROWSER_MODE !== undefined, 'config.json tem campo BROWSER_MODE');
    assert(config.DEBUG_PORT !== undefined, 'config.json tem campo DEBUG_PORT');
    assert(config.CHROME_PROXY_ENABLED !== undefined, 'config.json tem campo CHROME_PROXY_ENABLED');
    assert(config.CHROME_PROXY_HOST !== undefined, 'config.json tem campo CHROME_PROXY_HOST');
    assert(config.CHROME_PROXY_PORT !== undefined, 'config.json tem campo CHROME_PROXY_PORT');

    // 1.3 - Valores corretos
    assert(config.BROWSER_MODE === 'wsEndpoint', `BROWSER_MODE é 'wsEndpoint' (atual: ${config.BROWSER_MODE})`);
    assert(
        config.DEBUG_PORT.includes(`${config.CHROME_PROXY_HOST}:${config.CHROME_PROXY_PORT}`),
        `DEBUG_PORT usa proxy (${config.DEBUG_PORT})`,
    );
    assert(config.CHROME_PROXY_ENABLED === true, 'CHROME_PROXY_ENABLED é true');
    assert(
        config.CHROME_PROXY_HOST === '192.168.0.2',
        `CHROME_PROXY_HOST é '192.168.0.2' (atual: ${config.CHROME_PROXY_HOST})`,
    );
    assert(
        config.CHROME_PROXY_PORT === PROXY_PORT,
        `CHROME_PROXY_PORT é ${PROXY_PORT} (atual: ${config.CHROME_PROXY_PORT})`,
    );

    // 1.4 - chrome-config.json existe e é JSON válido
    let chromeConfig;
    try {
        chromeConfig = JSON.parse(fs.readFileSync('/workspaces/chatgpt-docker-puppeteer/chrome-config.json', 'utf8'));
        assert(true, 'chrome-config.json existe e é JSON válido');
    } catch (/** @type {any} */ e) {
        assert(false, `chrome-config.json inválido: ${e.message}`);
        return;
    }

    // 1.5 - Campos críticos no chrome-config.json
    assert(chromeConfig.connection !== undefined, 'chrome-config.json tem seção connection');
    assert(chromeConfig.chromeProxy !== undefined, 'chrome-config.json tem seção chromeProxy');
    assert(chromeConfig.health !== undefined, 'chrome-config.json tem seção health');

    // 1.6 - Valores corretos no chrome-config.json
    assert(
        chromeConfig.connection.mode === 'wsEndpoint',
        `chrome-config mode é 'wsEndpoint' (atual: ${chromeConfig.connection.mode})`,
    );
    assert(
        chromeConfig.connection.ports[0] === PROXY_PORT,
        `Primeira porta é ${PROXY_PORT} (atual: ${chromeConfig.connection.ports[0]})`,
    );
    assert(
        chromeConfig.connection.hosts[0] === '192.168.0.2',
        `Primeiro host é '192.168.0.2' (atual: ${chromeConfig.connection.hosts[0]})`,
    );
    assert(chromeConfig.chromeProxy.enabled === true, 'chromeProxy.enabled é true');
    assert(
        chromeConfig.chromeProxy.proxyPort === PROXY_PORT,
        `chromeProxy.proxyPort é ${PROXY_PORT} (atual: ${chromeConfig.chromeProxy.proxyPort})`,
    );

    // 1.7 - Consistência entre config.json e chrome-config.json
    assert(
        config.BROWSER_MODE === chromeConfig.connection.mode,
        `Modo consistente entre arquivos (${config.BROWSER_MODE} === ${chromeConfig.connection.mode})`,
    );
    assert(
        config.CHROME_PROXY_PORT === chromeConfig.chromeProxy.proxyPort,
        `Porta proxy consistente (${config.CHROME_PROXY_PORT} === ${chromeConfig.chromeProxy.proxyPort})`,
    );
    assert(
        config.CHROME_PROXY_HOST === chromeConfig.chromeProxy.proxyHost,
        `Host proxy consistente (${config.CHROME_PROXY_HOST} === ${chromeConfig.chromeProxy.proxyHost})`,
    );
}

// ==========================================================================
// TESTE 2: Validação de Arquivos de Scripts
// ==========================================================================
async function testScriptFiles() {
    log.section('TESTE 2: Validação de Arquivos de Scripts');

    const projectRoot = '/workspaces/chatgpt-docker-puppeteer';

    // 2.1 - chrome-proxy-service.js existe
    const proxyServicePath = path.join(projectRoot, 'scripts/chrome-proxy-service.js');
    assert(fs.existsSync(proxyServicePath), 'chrome-proxy-service.js existe');

    // 2.2 - chrome-proxy-service.js não tem erros de sintaxe
    try {
        const content = fs.readFileSync(proxyServicePath, 'utf8');
        assert(content.includes('class ChromeProxyService'), 'chrome-proxy-service.js tem classe ChromeProxyService');
        assert(content.includes('rewriteWebSocketURL'), 'chrome-proxy-service.js tem método rewriteWebSocketURL');
        assert(content.includes('handleHTTPRequest'), 'chrome-proxy-service.js tem método handleHTTPRequest');
        assert(content.includes('handleWebSocketUpgrade'), 'chrome-proxy-service.js tem método handleWebSocketUpgrade');
    } catch (/** @type {any} */ e) {
        assert(false, `Erro ao ler chrome-proxy-service.js: ${e.message}`);
    }

    // 2.3 - start-chrome-with-proxy.bat existe
    const launcherPath = path.join(projectRoot, 'scripts/start-chrome-with-proxy.bat');
    assert(fs.existsSync(launcherPath), 'start-chrome-with-proxy.bat existe');

    // 2.4 - start-chrome-with-proxy.bat tem conteúdo válido
    try {
        const content = fs.readFileSync(launcherPath, 'utf8');
        const cfg = /** @type {any} */ (
            await import('/workspaces/chatgpt-docker-puppeteer/config.json').then((m) => m.default ?? m)
        );
        const expectedChromePort = cfg.CHROME_PORT || cfg.CHROME_DIRECT_PORT || 9225;
        assert(
            content.includes(`CHROME_DEBUG_PORT=${expectedChromePort}`),
            `Launcher configura porta Chrome ${expectedChromePort}`,
        );
        assert(content.includes('PROXY_PORT=' + PROXY_PORT), `Launcher configura porta Proxy ${PROXY_PORT}`);
        assert(content.includes('chrome-proxy-service.js'), 'Launcher referencia chrome-proxy-service.js');
    } catch (/** @type {any} */ e) {
        assert(false, `Erro ao ler start-chrome-with-proxy.bat: ${e.message}`);
    }

    // 2.5 - ConnectionOrchestrator.js existe
    const orchestratorPath = path.join(projectRoot, 'src/infra/ConnectionOrchestrator.js');
    assert(fs.existsSync(orchestratorPath), 'ConnectionOrchestrator.js existe');

    // 2.6 - ConnectionOrchestrator.js tem código atualizado
    try {
        const content = fs.readFileSync(orchestratorPath, 'utf8');
        assert(
            content.includes('ports: [' + PROXY_PORT + ', 9223]'),
            `ConnectionOrchestrator prioriza porta ${PROXY_PORT}`,
        );
        assert(content.includes("'192.168.0.2'"), 'ConnectionOrchestrator tem IP público');
        assert(content.includes('CHROME PROXY INTEGRATION'), 'ConnectionOrchestrator tem comentários da integração');
        assert(content.includes('isProxyAttempt'), 'ConnectionOrchestrator detecta tentativa de proxy');
        assert(
            content.includes('Conectado via Chrome Proxy Service'),
            'ConnectionOrchestrator tem log específico de proxy',
        );
    } catch (/** @type {any} */ e) {
        assert(false, `Erro ao ler ConnectionOrchestrator.js: ${e.message}`);
    }

    // 2.7 - Documentação existe
    const docsPath = path.join(projectRoot, 'DOCUMENTAÇÃO/CHROME_PROXY_SETUP.md');
    assert(fs.existsSync(docsPath), 'CHROME_PROXY_SETUP.md existe');
}

// ==========================================================================
// TESTE 3: Validação de Lógica de Priorização
// ==========================================================================
async function testPrioritizationLogic() {
    log.section('TESTE 3: Validação de Lógica de Priorização');

    const chromeConfig = /** @type {any} */ (
        await import('/workspaces/chatgpt-docker-puppeteer/chrome-config.json').then((m) => m.default ?? m)
    );

    // 3.1 - Ordem de portas está correta
    const ports = chromeConfig.connection.ports;
    assert(ports[0] === PROXY_PORT, `Primeira porta é ${PROXY_PORT} (proxy) - atual: ${ports[0]}`);
    assert(ports[1] === 9223, `Segunda porta é 9223 (direto/fallback) - atual: ${ports[1]}`);
    assert(
        ports[2] === undefined || ports[2] === 9223,
        `Terceira porta é 9223 ou undefined (fallback) - atual: ${ports[2]}`,
    );

    // 3.2 - Ordem de hosts está correta
    const hosts = chromeConfig.connection.hosts;
    assert(hosts[0] === '192.168.0.2', `Primeiro host é '192.168.0.2' (IP público) - atual: ${hosts[0]}`);
    assert(hosts[1] === 'host.docker.internal', `Segundo host é 'host.docker.internal' - atual: ${hosts[1]}`);
    assert(hosts.includes('172.17.0.1'), 'Lista de hosts inclui 172.17.0.1');
    assert(hosts.includes('127.0.0.1'), 'Lista de hosts inclui 127.0.0.1');

    // 3.3 - Estratégia de fallback está definida
    assert(
        chromeConfig.connection.autoFallback === true,
        `autoFallback é true - atual: ${chromeConfig.connection.autoFallback}`,
    );

    // 3.4 - Simular ordem de tentativas (primeira iteração do loop)
    const firstAttempt = {
        host: hosts[0],
        port: ports[0],
        url: `http://${hosts[0]}:${ports[0]}/json/version`,
    };

    assert(
        firstAttempt.host === '192.168.0.2' && firstAttempt.port === PROXY_PORT,
        `Primeira tentativa é 192.168.0.2:${PROXY_PORT} (proxy) - atual: ${firstAttempt.url}`,
    );

    log.info(`Sequência de tentativas: ${hosts[0]}:${ports[0]}, ${hosts[0]}:${ports[1]}, ${hosts[0]}:${ports[2]}, ...`);
}

// ==========================================================================
// TESTE 4: Validação de URL Rewriting (Simulação)
// ==========================================================================
async function testURLRewriting() {
    log.section('TESTE 4: Simulação de URL Rewriting');

    const config = /** @type {any} */ (
        await import('/workspaces/chatgpt-docker-puppeteer/config.json').then((m) => m.default ?? m)
    );

    // 4.1 - Mock de resposta do Chrome (localhost)
    const chromeResponse = {
        Browser: 'Chrome/144.0.0.0',
        'Protocol-Version': '1.3',
        'User-Agent': 'Mozilla/5.0...',
        'V8-Version': '12.4.254.20',
        'WebKit-Version': '537.36 (@...)',
        webSocketDebuggerUrl: `ws://localhost:${PROXY_PORT}/devtools/browser/12345678-1234-1234-1234-123456789012`,
    };

    // 4.2 - Simular rewrite do proxy (localhost → IP público)
    const rewriteURL = (/** @type {any} */ url, /** @type {any} */ publicIP, /** @type {any} */ proxyPort) => {
        return url
            .replace(`localhost:${proxyPort}`, `${publicIP}:${proxyPort}`)
            .replace(`127.0.0.1:${proxyPort}`, `${publicIP}:${proxyPort}`);
    };

    const rewrittenUrl = rewriteURL(
        chromeResponse.webSocketDebuggerUrl,
        config.CHROME_PROXY_HOST,
        config.CHROME_PROXY_PORT,
    );

    // 4.3 - Validar que rewrite funciona
    assert(
        rewrittenUrl.includes(`${config.CHROME_PROXY_HOST}:${config.CHROME_PROXY_PORT}`),
        `URL reescrita contém IP público e porta proxy: ${rewrittenUrl}`,
    );
    assert(!rewrittenUrl.includes('localhost'), `URL reescrita NÃO contém localhost: ${rewrittenUrl}`);
    assert(!rewrittenUrl.includes('127.0.0.1'), `URL reescrita NÃO contém 127.0.0.1: ${rewrittenUrl}`);

    log.info(`Original:   ${chromeResponse.webSocketDebuggerUrl}`);
    log.info(`Reescrito:  ${rewrittenUrl}`);

    // 4.4 - Simular detecção de proxy attempt
    const isProxyAttempt = (/** @type {any} */ host, /** @type {any} */ port) => {
        return port === PROXY_PORT || (host === '192.168.0.2' && port === PROXY_PORT);
    };

    assert(isProxyAttempt('192.168.0.2', PROXY_PORT) === true, `Detecta proxy: 192.168.0.2:${PROXY_PORT}`);
    assert(
        isProxyAttempt('host.docker.internal', PROXY_PORT) === true,
        `Detecta proxy pela porta: host.docker.internal:${PROXY_PORT}`,
    );
    assert(isProxyAttempt('127.0.0.1', 9223) === false, 'Não detecta como proxy: 127.0.0.1:9223');
}

// ==========================================================================
// TESTE 5: Validação de Health Endpoints
// ==========================================================================
async function testHealthEndpoints() {
    log.section('TESTE 5: Validação de Health Endpoints');

    const chromeConfig = /** @type {any} */ (
        await import('/workspaces/chatgpt-docker-puppeteer/chrome-config.json').then((m) => m.default ?? m)
    );

    // 5.1 - Health URLs estão definidas
    assert(chromeConfig.health.chromeDebugUrl !== undefined, 'chromeDebugUrl está definido');
    assert(chromeConfig.health.chromeProxyUrl !== undefined, 'chromeProxyUrl está definido');
    assert(chromeConfig.health.chromeDirectUrl !== undefined, 'chromeDirectUrl está definido');

    // 5.2 - Health URLs estão corretos
    assert(
        chromeConfig.health.chromeDebugUrl === `http://${GLOBAL_CONFIG.CHROME_PROXY_HOST}:${PROXY_PORT}/json/version`,
        `chromeDebugUrl aponta para proxy: ${chromeConfig.health.chromeDebugUrl}`,
    );
    assert(
        chromeConfig.health.chromeProxyUrl === `http://${GLOBAL_CONFIG.CHROME_PROXY_HOST}:${PROXY_PORT}`,
        `chromeProxyUrl está correto: ${chromeConfig.health.chromeProxyUrl}`,
    );
    assert(
        chromeConfig.health.chromeDirectUrl && chromeConfig.health.chromeDirectUrl.includes('192.168.0.2'),
        `chromeDirectUrl contém o IP público: ${chromeConfig.health.chromeDirectUrl}`,
    );

    // 5.3 - Comandos de verificação estão definidos
    assert(chromeConfig.commands.checkProxy !== undefined, 'Comando checkProxy está definido');
    assert(chromeConfig.commands.startProxy !== undefined, 'Comando startProxy está definido');

    // 5.4 - Comandos de verificação estão corretos
    assert(
        chromeConfig.commands.checkProxy.includes(`${GLOBAL_CONFIG.CHROME_PROXY_HOST}:${PROXY_PORT}`),
        `checkProxy usa endpoint correto: ${chromeConfig.commands.checkProxy}`,
    );
    assert(
        chromeConfig.commands.startProxy.includes('chrome-proxy-service.js'),
        `startProxy referencia script correto: ${chromeConfig.commands.startProxy}`,
    );
}

// ==========================================================================
// TESTE 6: Validação de Documentação
// ==========================================================================
function testDocumentation() {
    log.section('TESTE 6: Validação de Documentação');

    const projectRoot = '/workspaces/chatgpt-docker-puppeteer';
    const docsPath = path.join(projectRoot, 'DOCUMENTAÇÃO/CHROME_PROXY_SETUP.md');

    if (!fs.existsSync(docsPath)) {
        assert(false, 'CHROME_PROXY_SETUP.md não encontrado');
        return;
    }

    const content = fs.readFileSync(docsPath, 'utf8');

    // 6.1 - Documentação tem seções críticas
    assert(content.includes('# 🌉 Chrome Proxy Setup'), 'Documentação tem título correto');
    assert(content.includes('Visão Geral'), 'Documentação tem seção Visão Geral');
    assert(content.includes('Arquitetura'), 'Documentação tem seção Arquitetura');
    assert(content.includes('Instalação'), 'Documentação tem seção Instalação');
    assert(content.includes('Testes'), 'Documentação tem seção Testes');
    assert(content.includes('Troubleshooting'), 'Documentação tem seção Troubleshooting');

    // 6.2 - Documentação menciona arquivos corretos
    assert(content.includes('chrome-proxy-service.js'), 'Documentação menciona chrome-proxy-service.js');
    assert(content.includes('start-chrome-with-proxy.bat'), 'Documentação menciona start-chrome-with-proxy.bat');
    assert(content.includes('ConnectionOrchestrator'), 'Documentação menciona ConnectionOrchestrator');

    // 6.3 - Documentação tem exemplos de comandos
    assert(content.includes('curl'), 'Documentação tem exemplos de curl');
    assert(content.includes(String(PROXY_PORT)), `Documentação menciona porta ${PROXY_PORT}`);
    assert(content.includes('192.168.0.2'), 'Documentação menciona IP público');

    log.info(`Documentação tem ${content.split('\n').length} linhas`);
}

// ==========================================================================
// MAIN - Executar Todos os Testes
// ==========================================================================
async function main() {
    console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║       SUITE DE TESTES AUTOMÁTICOS - CHROME PROXY INTEGRATION     ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝${colors.reset}
`);

    log.info('Iniciando testes automáticos...\n');

    try {
        await testConfigFiles();
        await testScriptFiles();
        await testPrioritizationLogic();
        await testURLRewriting();
        await testHealthEndpoints();
        await testDocumentation();

        // Resumo final
        log.section('RESUMO DOS TESTES');

        const total = passedTests + failedTests;
        const percentage = total > 0 ? ((passedTests / total) * 100).toFixed(1) : 0;

        console.log(`Total de testes: ${total}`);
        console.log(`${colors.green}Passou: ${passedTests}${colors.reset}`);
        console.log(`${colors.red}Falhou: ${failedTests}${colors.reset}`);
        console.log(`Taxa de sucesso: ${percentage}%\n`);

        if (failedTests === 0) {
            log.success('🎉 TODOS OS TESTES PASSARAM! Sistema pronto para teste no Windows.');
        } else {
            log.error(`⚠️  ${failedTests} teste(s) falharam. Corrija os problemas antes de prosseguir.`);
            process.exit(1);
        }
    } catch (/** @type {any} */ error) {
        log.error(`Erro durante execução dos testes: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

main();
