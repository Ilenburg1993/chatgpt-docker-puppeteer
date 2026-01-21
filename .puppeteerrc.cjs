/* ==========================================================================
   .puppeteerrc.cjs
   Puppeteer Configuration v2.0 (21/01/2026)

   Configura comportamento do Puppeteer:
   - Cache directory (onde Chromium é baixado/armazenado)
   - Download behavior (skip para usar Chrome do sistema)
   - Executable path (Chrome customizado)
   - Temporary directory (profiles temporários)

   Referências:
   - https://pptr.dev/guides/configuration
   - ConnectionOrchestrator usa estas configurações como base
   - .env.example define variáveis de ambiente que sobrescrevem config
========================================================================== */

const path = require('path');
const os = require('os');

/**
 * Detecta se está rodando em Docker
 * Docker: /proc/1/cgroup contém "docker" OU /proc/self/cgroup
 */
function isDocker() {
    try {
        const fs = require('fs');
        const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
        return cgroup.includes('docker') || cgroup.includes('kubepods');
    } catch {
        return false;
    }
}

/**
 * Determina diretório base para cache
 * - Docker: /home/node/.cache (user node)
 * - Host: ~/.cache (user atual)
 */
function getCacheDirectory() {
    const baseDir = isDocker() ? path.join('/home/node', '.cache') : path.join(os.homedir(), '.cache');

    return path.join(baseDir, 'puppeteer');
}

/**
 * Detecta Chrome/Chromium instalado no sistema
 * Ordem de busca: ambiente → paths comuns por plataforma
 */
function findChromeExecutable() {
    // Environment variable override
    if (process.env.CHROME_EXECUTABLE_PATH) {
        return process.env.CHROME_EXECUTABLE_PATH;
    }

    const fs = require('fs');
    const platform = os.platform();

    let candidates = [];

    if (platform === 'linux') {
        candidates = [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium'
        ];
    } else if (platform === 'darwin') {
        candidates = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium'
        ];
    } else if (platform === 'win32') {
        candidates = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
        ];
    }

    // Retorna primeiro executável encontrado
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null; // Usa Chromium bundled do Puppeteer
}

module.exports = {
    // ==========================================================================
    // CACHE DIRECTORY: Onde Chromium é baixado/armazenado
    // ==========================================================================
    cacheDirectory: getCacheDirectory(),

    // ==========================================================================
    // SKIP DOWNLOAD: Evita download de Chromium (usa Chrome do sistema)
    // ==========================================================================
    // skipDownload: true (somente se Chrome estiver instalado no sistema)
    // skipDownload: false (padrão - baixa Chromium automaticamente)
    // Environment: PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
    //
    // Descomente próxima linha para NUNCA baixar Chromium:
    // skipDownload: true,

    // ==========================================================================
    // EXECUTABLE PATH: Chrome/Chromium customizado (opcional)
    // ==========================================================================
    // Define qual executável usar (sobrescreve bundled Chromium)
    // null = usa Chromium do Puppeteer (bundled)
    // string = path para Chrome instalado no sistema
    //
    // Detecção automática:
    executablePath: findChromeExecutable()

    // Ou hardcode por plataforma:
    // executablePath: process.platform === 'linux'
    //     ? '/usr/bin/google-chrome'
    //     : process.platform === 'darwin'
    //     ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    //     : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',

    // ==========================================================================
    // TEMPORARY DIRECTORY: Profiles temporários do Chrome
    // ==========================================================================
    // Por padrão, Puppeteer cria profiles em os.tmpdir() (/tmp ou %TEMP%)
    // ConnectionOrchestrator controla isso dinamicamente, mas pode definir base:
    //
    // temporaryDirectory: path.join(os.tmpdir(), 'puppeteer-profiles'),

    // ==========================================================================
    // BROWSER REVISION: Versão específica do Chromium (opcional)
    // ==========================================================================
    // browserRevision: '1108766', // Chrome 114 (exemplo)
    // Ver revisões: https://googlechromelabs.github.io/chrome-for-testing/

    // ==========================================================================
    // DOWNLOAD HOST: Mirror customizado para Chromium (opcional)
    // ==========================================================================
    // Útil em ambientes corporativos com proxy/mirror interno
    // downloadHost: 'https://npm.taobao.org/mirrors/chromium-browser-snapshots',

    // ==========================================================================
    // PRODUCT: Chrome vs Firefox (experimental)
    // ==========================================================================
    // product: 'chrome', // default
    // product: 'firefox', // experimental support

    // ==========================================================================
    // EXPERIMENTS: Features experimentais (opcional)
    // ==========================================================================
    // experiments: {
    //     macArmChromiumEnabled: true, // Apple Silicon (M1/M2)
    // },

    // ==========================================================================
    // NOTAS:
    // ==========================================================================
    // 1. ConnectionOrchestrator usa estas configs como base e sobrescreve com:
    //    - config.json (browserMode, executablePath, userDataDir)
    //    - .env (CHROME_EXECUTABLE_PATH, PUPPETEER_SKIP_CHROMIUM_DOWNLOAD)
    //
    // 2. Profiles temporários são limpos por ConnectionOrchestrator.cleanupTempProfiles()
    //
    // 3. Docker: skipDownload=true recomendado (instala Chrome via Dockerfile)
    //
    // 4. Desenvolvimento local: executablePath=null usa Chromium bundled (mais fácil)
    //
    // 5. Produção: executablePath do sistema (mais rápido, menos espaço)
    //
    // ==========================================================================
    // FERRAMENTAS PUPPETEER AVANÇADAS (não configuradas aqui, usar via API)
    // ==========================================================================
    //
    // Este projeto JÁ USA:
    // ✅ puppeteer-extra-plugin-stealth (anti-detection)
    // ✅ User-Agent rotation (6 UAs diferentes)
    // ✅ Profile rotation (automático via scripts/rotate-profiles.js)
    // ✅ Browser pool (múltiplas instâncias)
    // ✅ CDP (Chrome DevTools Protocol) - indiretamente via Puppeteer
    //
    // FERRAMENTAS DISPONÍVEIS (não implementadas - OPORTUNIDADES):
    //
    // 1. PUPPETEER RECORDER (https://github.com/puppeteer/recorder)
    //    - Chrome extension para gravar ações do usuário
    //    - Gera código Puppeteer automaticamente
    //    - Útil para: criar novos drivers, debug de fluxos
    //    - Instalação: Chrome Web Store > Puppeteer Recorder
    //    - Uso: Record → Export → Copiar código para driver
    //
    // 2. PUPPETEER REPLAY (https://github.com/puppeteer/replay)
    //    - Executa gravações do Chrome DevTools Recorder
    //    - Formato: JSON com steps (click, type, navigate)
    //    - Útil para: testes automatizados, scenarios complexos
    //    - Exemplo: npm install @puppeteer/replay
    //
    // 3. ANGULAR DETECTION (puppeteer-extra-plugin-angular)
    //    - Espera Angular carregar completamente
    //    - waitForAngular() automático
    //    - Útil para: SPAs com Angular (se houver)
    //
    // 4. ADBLOCKER (puppeteer-extra-plugin-adblocker)
    //    - Bloqueia ads, trackers, analytics
    //    - Reduz consumo de banda/memória
    //    - Útil para: performance, evitar distrações
    //    - Exemplo: use(AdblockerPlugin({ blockTrackers: true }))
    //
    // 5. BLOCK RESOURCES (puppeteer-extra-plugin-block-resources)
    //    - Bloqueia imagens, fontes, CSS
    //    - Acelera navegação (modo texto-only)
    //    - Útil para: scraping rápido, economia de banda
    //    - Exemplo: use(BlockResourcesPlugin({ blockedTypes: ['image', 'font'] }))
    //
    // 6. USER PREFERENCES (puppeteer-extra-plugin-user-preferences)
    //    - Define preferências do Chrome (download dir, notificações)
    //    - Útil para: downloads automáticos, permissões
    //    - Exemplo: userPrefs({ 'download.default_directory': './downloads' })
    //
    // 7. RECAPTCHA SOLVER (puppeteer-extra-plugin-recaptcha)
    //    - Resolve reCAPTCHA automaticamente (pago - 2captcha, anti-captcha)
    //    - Útil para: sites com proteção CAPTCHA
    //    - Exemplo: use(RecaptchaPlugin({ provider: { id: '2captcha', token: 'KEY' } }))
    //
    // 8. DEVTOOLS (puppeteer.connect({ browserURL, defaultViewport: null }))
    //    - Conecta a Chrome com DevTools aberto
    //    - Útil para: debug visual, inspecionar elementos
    //    - Já suportado no projeto via: BROWSER_MODE=connect + devtools: true
    //
    // 9. TRACING (page.tracing.start/stop)
    //    - Grava timeline do Chrome (performance profiling)
    //    - Formato: JSON compatível com chrome://tracing
    //    - Útil para: debug de performance, bottlenecks
    //    - Exemplo:
    //      await page.tracing.start({ path: 'trace.json', screenshots: true });
    //      await page.goto('https://example.com');
    //      await page.tracing.stop();
    //
    // 10. COVERAGE (page.coverage.start/stop)
    //     - Mede cobertura de CSS/JS usados pela página
    //     - Útil para: otimização de bundle, code splitting
    //     - Exemplo:
    //       await page.coverage.startJSCoverage();
    //       await page.goto('https://example.com');
    //       const coverage = await page.coverage.stopJSCoverage();
    //
    // 11. PDF GENERATION (page.pdf)
    //     - Gera PDF da página (modo headless)
    //     - Útil para: relatórios, arquivamento
    //     - Exemplo: await page.pdf({ path: 'page.pdf', format: 'A4' });
    //
    // 12. SCREENSHOTS (page.screenshot)
    //     - JÁ USADO no projeto (forensics em crashes)
    //     - Modos: fullPage, clip (region), omitBackground
    //     - Exemplo: await page.screenshot({ path: 'shot.png', fullPage: true });
    //
    // 13. NETWORK INTERCEPTION (page.setRequestInterception)
    //     - Intercepta/modifica/bloqueia requests
    //     - Útil para: mocking APIs, testes, performance
    //     - Exemplo:
    //       await page.setRequestInterception(true);
    //       page.on('request', req => req.resourceType() === 'image' ? req.abort() : req.continue());
    //
    // 14. GEOLOCATION OVERRIDE (page.setGeolocation)
    //     - Simula localização GPS
    //     - Útil para: testes regionais
    //     - Exemplo: await page.setGeolocation({ latitude: 59.95, longitude: 30.31667 });
    //
    // 15. TIMEZONE OVERRIDE (page.emulateTimezone)
    //     - Simula timezone diferente
    //     - Útil para: testes de fuso horário
    //     - Exemplo: await page.emulateTimezone('America/New_York');
    //
    // 16. PERMISSIONS (browserContext.overridePermissions)
    //     - Concede permissões automaticamente (notificações, geolocalização)
    //     - Útil para: automação sem popups
    //     - Exemplo: await context.overridePermissions('https://example.com', ['geolocation']);
    //
    // 17. OFFLINE MODE (page.setOfflineMode)
    //     - Simula navegação offline
    //     - Útil para: testes de offline-first apps
    //     - Exemplo: await page.setOfflineMode(true);
    //
    // 18. NETWORK CONDITIONS (page.emulateNetworkConditions)
    //     - Simula latência, throughput (3G, 4G, slow)
    //     - Útil para: testes de performance
    //     - Exemplo: await page.emulateNetworkConditions(puppeteer.networkConditions['Slow 3G']);
    //
    // 19. CPU THROTTLING (page.emulateCPUThrottling)
    //     - Simula CPU lenta (fator de desaceleração)
    //     - Útil para: testes em dispositivos lentos
    //     - Exemplo: await page.emulateCPUThrottling(4); // 4x slower
    //
    // 20. MEDIA FEATURES (page.emulateMediaFeatures)
    //     - Simula prefers-color-scheme, prefers-reduced-motion
    //     - Útil para: testes de dark mode, acessibilidade
    //     - Exemplo: await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    //
    // 21. VISION DEFICIENCY (page.emulateVisionDeficiency)
    //     - Simula daltonismo, visão embaçada
    //     - Útil para: testes de acessibilidade
    //     - Exemplo: await page.emulateVisionDeficiency('deuteranopia'); // green-blind
    //
    // 22. ACCESSIBILITY TREE (page.accessibility.snapshot)
    //     - Captura árvore de acessibilidade (screen readers)
    //     - Útil para: auditoria de acessibilidade
    //     - Exemplo: const snapshot = await page.accessibility.snapshot();
    //
    // 23. METRICS (page.metrics)
    //     - Coleta métricas de performance (JSHeapUsedSize, Nodes, etc)
    //     - Útil para: profiling de memória
    //     - Exemplo: const metrics = await page.metrics();
    //
    // 24. BROWSER CONTEXTS (browser.createBrowserContext)
    //     - Cria contextos isolados (cookies, storage, cache separados)
    //     - Útil para: multi-usuário, testes paralelos
    //     - Exemplo: const context = await browser.createBrowserContext();
    //
    // 25. PUPPETEER FIREFOX (product: 'firefox')
    //     - Experimental: suporte a Firefox
    //     - Útil para: testes cross-browser
    //     - Status: Experimental (Chrome é mais estável)
    //
    // ==========================================================================
    // RECOMENDAÇÕES PARA ESTE PROJETO:
    // ==========================================================================
    //
    // PRIORIDADE ALTA (implementar próximo):
    // 1. ✅ Tracing (page.tracing) - debug de performance, já temos forensics
    // 2. ✅ Network interception - bloquear analytics, ads (economia de banda)
    // 3. ✅ Browser contexts - isolamento de sessões (multi-target paralelo)
    //
    // PRIORIDADE MÉDIA (considerar):
    // 4. ✅ Puppeteer Recorder - facilitar criação de novos drivers
    // 5. ✅ Adblocker plugin - reduzir ruído, melhorar performance
    // 6. ✅ Coverage - otimizar página se scraping customizado
    //
    // PRIORIDADE BAIXA (nice to have):
    // 7. PDF generation - se precisar arquivar respostas
    // 8. Accessibility - se auditoria de acessibilidade for necessária
    // 9. reCAPTCHA solver - só se encontrar CAPTCHAs (pago)
    //
    // NÃO IMPLEMENTAR (não aplicável):
    // - Angular detection (ChatGPT/Gemini não usam Angular)
    // - Firefox support (Chromium é suficiente)
    // - Vision deficiency (não aplicável a automação)
    //
    // ==========================================================================
    // LINKS ÚTEIS:
    // ==========================================================================
    // - Puppeteer API: https://pptr.dev/api
    // - Puppeteer Extra: https://github.com/berstend/puppeteer-extra
    // - Plugins: https://github.com/berstend/puppeteer-extra/tree/master/packages
    // - Chrome DevTools Protocol: https://chromedevtools.github.io/devtools-protocol/
    // - Recorder Extension: https://chrome.google.com/webstore (search: Puppeteer Recorder)
};

// ==========================================================================
// EXPORTS DE HELPERS: Para uso por ConnectionOrchestrator e outros módulos
// ==========================================================================
// Estes helpers são compartilhados (DRY) mas cada módulo mantém sua própria config
module.exports.getCacheDirectory = getCacheDirectory;
module.exports.findChromeExecutable = findChromeExecutable;
module.exports.isDocker = isDocker;
