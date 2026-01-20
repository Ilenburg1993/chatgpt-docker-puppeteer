/**
 * Configuração do Puppeteer
 * Define onde o Chromium é baixado e armazenado
 *
 * Por padrão, Puppeteer baixa Chromium para ~/.cache/puppeteer
 * Esta config garante que o cache seja persistente e reutilizado
 */

const path = require('path');
const os = require('os');

module.exports = {
    // Cache permanente em ~/.cache/puppeteer (não em /tmp)
    cacheDirectory: path.join(os.homedir(), '.cache', 'puppeteer')

    // Não usar profile temporário (evita lixo em /tmp)
    // Isso é controlado por ConnectionOrchestrator
};
