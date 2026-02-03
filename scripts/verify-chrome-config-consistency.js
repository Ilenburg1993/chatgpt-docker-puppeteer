const config = require('../config.json');

console.log('🔍 VERIFICAÇÃO DE CONFIGURAÇÃO');
console.log('=' .repeat(70));
console.log('');

console.log('📄 config.json (Configuração Runtime - Única Fonte de Verdade)');
console.log('   BROWSER_MODE:', config.BROWSER_MODE);
console.log('   DEBUG_PORT:', config.DEBUG_PORT);
console.log('   CHROME_PROXY_ENABLED:', config.CHROME_PROXY_ENABLED);
console.log('   CHROME_PROXY_HOST:', config.CHROME_PROXY_HOST);
console.log('   CHROME_PROXY_PORT:', config.CHROME_PROXY_PORT);
console.log('');

console.log('✅ CONFIGURAÇÃO VALIDADA:');
const hasMode = !!config.BROWSER_MODE;
const hasPort = !!config.CHROME_PROXY_PORT;
const hasHost = !!config.CHROME_PROXY_HOST;
const hasProxyEnabled = config.CHROME_PROXY_ENABLED !== undefined;

console.log('   ✓ Modo:', hasMode ? '✅ CONFIGURADO' : '❌ NÃO CONFIGURADO');
console.log('   ✓ Porta Proxy:', hasPort ? '✅ CONFIGURADO' : '❌ NÃO CONFIGURADO');
console.log('   ✓ Host Proxy:', hasHost ? '✅ CONFIGURADO' : '❌ NÃO CONFIGURADO');
console.log('   ✓ Proxy Enabled:', hasProxyEnabled ? '✅ CONFIGURADO' : '❌ NÃO CONFIGURADO');
console.log('');

if (hasMode && hasPort && hasHost && hasProxyEnabled) {
    console.log('🎉 TUDO CONFIGURADO! Sistema pronto para uso.');
} else {
    console.log('⚠️  ATENÇÃO: Configurações faltando!');
}
