const config = require('./config.json');
const chromeConfig = require('./chrome-config.json');

console.log('🔍 VERIFICAÇÃO DE CONSISTÊNCIA COMPLETA');
console.log('=' .repeat(70));
console.log('');

console.log('📄 1. config.json (Configuração Runtime)');
console.log('   BROWSER_MODE:', config.BROWSER_MODE);
console.log('   DEBUG_PORT:', config.DEBUG_PORT);
console.log('   CHROME_PROXY_ENABLED:', config.CHROME_PROXY_ENABLED);
console.log('   CHROME_PROXY_HOST:', config.CHROME_PROXY_HOST);
console.log('   CHROME_PROXY_PORT:', config.CHROME_PROXY_PORT);
console.log('');

console.log('📄 2. chrome-config.json (Snapshot Exportado)');
console.log('   connection.mode:', chromeConfig.connection.mode);
console.log('   connection.ports:', JSON.stringify(chromeConfig.connection.ports));
console.log('   connection.hosts:', JSON.stringify(chromeConfig.connection.hosts.slice(0, 2)) + ' ...');
console.log('   health.chromeDebugUrl:', chromeConfig.health.chromeDebugUrl);
console.log('   chromeProxy.enabled:', chromeConfig.chromeProxy.enabled);
console.log('   chromeProxy.proxyPort:', chromeConfig.chromeProxy.proxyPort);
console.log('');

console.log('✅ CONSISTÊNCIA VERIFICADA:');
const modeMatch = config.BROWSER_MODE === chromeConfig.connection.mode;
const portMatch = config.CHROME_PROXY_PORT === chromeConfig.chromeProxy.proxyPort;
const hostMatch = config.CHROME_PROXY_HOST === chromeConfig.chromeProxy.proxyHost;
const proxyMatch = config.CHROME_PROXY_ENABLED === chromeConfig.chromeProxy.enabled;

console.log('   ✓ Modo:', modeMatch ? '✅ MATCH' : '❌ MISMATCH');
console.log('   ✓ Porta Proxy:', portMatch ? '✅ MATCH' : '❌ MISMATCH');
console.log('   ✓ Host Proxy:', hostMatch ? '✅ MATCH' : '❌ MISMATCH');
console.log('   ✓ Proxy Enabled:', proxyMatch ? '✅ MATCH' : '❌ MISMATCH');
console.log('');

if (modeMatch && portMatch && hostMatch && proxyMatch) {
    console.log('🎉 TUDO CONSISTENTE! Configurações sincronizadas.');
} else {
    console.log('⚠️  ATENÇÃO: Inconsistências detectadas!');
}
