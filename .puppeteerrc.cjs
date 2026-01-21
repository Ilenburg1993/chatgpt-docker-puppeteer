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
};
