# Configuração Chrome Externo (Docker → Windows Host)

**Data**: 2026-01-19 **Status**: ✅ Configurado e testado

---

## 📋 VISÃO GERAL

Este projeto usa **Chrome EXTERNO** rodando no **Windows Host**, não no container Docker. O
Puppeteer dentro do container conecta-se remotamente ao Chrome via um **Chrome Proxy** exposto pelo
host. O padrão do sistema é conectar-se ao endpoint container-facing na porta `9224`, que
normalmente é reencaminhada para o `--remote-debugging-port=9224` no host.

**Arquitetura**:

```
┌─────────────────────────────────────┐
│  Windows Host                       │
│                                     │
│  chrome.exe --remote-debugging-port │
│             --user-data-dir         │
│                                     │
│  Porta: 9224 (exposta)              │
└──────────────┬──────────────────────┘
               │
               │ TCP connection
               │
┌──────────────▼──────────────────────┐
│  Docker Container (Linux)           │
│                                     │
│  Node.js + Puppeteer-core           │
│  Conecta: host.docker.internal:9224 │
│                                     │
└─────────────────────────────────────┘
```

---

## 🚀 INICIALIZAÇÃO DO CHROME (WINDOWS)

### **⚠️ IMPORTANTE: Dois Chromes Simultâneos**

É **recomendado** manter:

1. **Chrome pessoal** (navegação normal, sem automação)
2. **Chrome automação** (porta 9224 no host; container conecta via proxy 9224, perfil separado)

Isso evita conflitos e mantém suas sessões pessoais isoladas.

### **Comando Windows (PowerShell/CMD)**:

```powershell
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9224 ^
  --user-data-dir="C:\chrome-automation-profile" ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-background-networking ^
  --disable-background-timer-throttling ^
  --disable-backgrounding-occluded-windows ^
  --disable-breakpad ^
  --disable-client-side-phishing-detection ^
  --disable-default-apps ^
  --disable-dev-shm-usage ^
  --disable-renderer-backgrounding ^
  --disable-sync ^
  --metrics-recording-only ^
  --mute-audio ^
  --no-sandbox
```

### **Validação**:

```powershell
# Testar se Chrome está rodando
curl http://localhost:9224/json/version

# Resposta esperada (JSON):
# {
#   "Browser": "Chrome/120.x.x.x",
#   "Protocol-Version": "1.3",
#   "User-Agent": "...",
#   "WebKit-Version": "...",
#   "webSocketDebuggerUrl": "ws://localhost:9224/devtools/browser/..."
# }
```

---

## 🐳 CONFIGURAÇÃO DO DOCKER

### **docker-compose.yml**:

```yaml
services:
  app:
    build: .
    ports:
      - '3000:3000'
    environment:
      # Conexão Chrome externo (Windows host) - endpoint container-facing (proxy)
      CHROME_REMOTE_URL: 'http://host.docker.internal:9224'

      # Alternativa (Linux host):
      # CHROME_REMOTE_URL: "http://172.17.0.1:9224"
    extra_hosts:
      - 'host.docker.internal:host-gateway'
```

**Nota**: `host.docker.internal` resolve automaticamente para o IP do host no Docker Desktop
(Windows/Mac). No Linux, use `172.17.0.1` ou configure `--add-host`.

---

## 📦 CONFIGURAÇÃO DO PUPPETEER

### **src/infra/browser_pool/pool_manager.js**:

```javascript
const puppeteer = require('puppeteer-core');

// Conecta ao Chrome externo (não lança processo)
const browser = await puppeteer.connect({
  // Conectar ao endpoint exposto pelo proxy (container-facing)
  browserURL: process.env.CHROME_REMOTE_URL || 'http://host.docker.internal:9224',
  defaultViewport: {
    width: 1920,
    height: 1080,
  },
  ignoreHTTPSErrors: true,
});
```

### **Teste de Conexão**:

```javascript
// tests/test_chrome_connection.js
const puppeteer = require('puppeteer-core');

(async () => {
  try {
    console.log('Conectando ao Chrome externo...');
    const browser = await puppeteer.connect({
      browserURL: 'http://host.docker.internal:9224',
    });

    console.log('✅ Conectado!');

    const page = await browser.newPage();
    await page.goto('https://example.com');
    const title = await page.title();

    console.log('Página:', title);

    await page.close();
    await browser.disconnect();

    console.log('✅ Teste bem-sucedido!');
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
})();
```

**Executar**:

```bash
node tests/test_chrome_connection.js
```

---

## 🔧 CONFIGURAÇÃO UNIVERSAL

### **config.json**:

```json
{
  "browserEndpoint": {
    "url": "http://host.docker.internal:9224",
    "defaultViewport": {
      "width": 1920,
      "height": 1080
    },
    "ignoreHTTPSErrors": true,
    "slowMo": 0
  }
}
```

### **Detecção Automática (src/core/config.js)**:

```javascript
function detectChromeURL() {
  // 1. Variável de ambiente (prioridade máxima)
  if (process.env.CHROME_REMOTE_URL) {
    return process.env.CHROME_REMOTE_URL;
  }

  // 2. Docker Desktop (Windows/Mac) - conecta ao proxy (9224)
  if (process.platform !== 'linux') {
    return 'http://host.docker.internal:9224';
  }

  // 3. Linux host (bridge network) - proxy padrão para container-facing
  return 'http://172.17.0.1:9224';
}

module.exports = {
  browserEndpoint: {
    url: detectChromeURL(),
    // ...
  },
};
```

---

## ✅ VALIDAÇÃO DE FUNCIONAMENTO

### **1. Chrome no Host**:

```powershell
# Windows PowerShell
netstat -ano | findstr :9224

# Saída esperada:
# TCP    0.0.0.0:9224    0.0.0.0:0    LISTENING    12345
```

### **2. Teste do Container**:

```bash
# Dentro do container Docker (via proxy container-facing)
curl http://host.docker.internal:9224/json/version

# Saída esperada (JSON com versão do Chrome, via proxy)
```

### **3. Teste Puppeteer**:

```bash
npm run test:chrome
```

---

## 🚨 TROUBLESHOOTING

### **Erro: ECONNREFUSED (Connection refused)**

**Causa**: Chrome não está rodando ou porta bloqueada.

**Solução**:

1. No host, verificar se Chrome está rodando na porta 9224: `netstat -ano | findstr :9224`
2. Verificar se o proxy está ativo e acessível na porta 9224: `netstat -ano | findstr :9224`
3. Verificar firewall Windows (liberar portas 9224 no host e 9224 para o proxy)
4. Reiniciar Chrome com `--remote-debugging-port=9224` e iniciar o proxy que expõe 9224

---

### **Erro: Failed to fetch browser webSocket URL**

**Causa**: Container não consegue resolver `host.docker.internal`.

**Solução (Linux)**:

```yaml
# docker-compose.yml
extra_hosts:
  - 'host.docker.internal:172.17.0.1'
```

Ou usar IP do host diretamente:

```bash
# Descobrir IP do host (Linux)
ip route show default | awk '/default/ {print $3}'

# Exemplo: 172.17.0.1
export CHROME_REMOTE_URL="http://172.17.0.1:9224"
```

---

### **Erro: Target closed (página fecha inesperadamente)**

**Causa**: Chrome fechou a aba durante automação.

**Solução**:

```javascript
// Usar setDefaultTimeout maior
page.setDefaultTimeout(60000);

// Retentar em caso de falha
try {
  await page.goto(url);
} catch (error) {
  if (error.message.includes('Target closed')) {
    // Reabrir página
    page = await browser.newPage();
    await page.goto(url);
  }
}
```

---

## 📊 COMPATIBILIDADE

| Plataforma             | Host IP                        | Docker DNS    | Status          |
| ---------------------- | ------------------------------ | ------------- | --------------- |
| Windows Docker Desktop | `host.docker.internal`         | ✅ Automático | ✅ Testado      |
| macOS Docker Desktop   | `host.docker.internal`         | ✅ Automático | ✅ Testado      |
| Linux Docker           | `172.17.0.1` (ou IP do bridge) | ⚠️ Manual     | ✅ Configurável |

---

## 🔒 SEGURANÇA

### **⚠️ Aviso de Segurança**:

`--remote-debugging-port=9224` expõe **controle total** do navegador sem autenticação.

**Recomendações**:

1. **Nunca exponha porta 9224 (host) ou 9224 (proxy) para internet** (`0.0.0.0`)
2. Use `--remote-debugging-address=127.0.0.1` (apenas localhost) e proteja o proxy com
   firewall/autenticação
3. Em produção, use proxy reverso com autenticação
4. Rotacione `--user-data-dir` periodicamente
5. Monitore conexões abertas: `netstat -ano | findstr :9224` e `netstat -ano | findstr :9224`

### **Configuração Segura**:

```powershell
# Chrome apenas em localhost (não acessível externamente)
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9224 ^
  --remote-debugging-address=127.0.0.1 ^
  --user-data-dir="C:\chrome-automation-profile"
```

---

## 📚 REFERÊNCIAS

- [Puppeteer API: puppeteer.connect()](https://pptr.dev/api/puppeteer.puppeteernode.connect)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Docker networking: host.docker.internal](https://docs.docker.com/desktop/networking/#i-want-to-connect-from-a-container-to-a-service-on-the-host)

---

## ✅ CHECKLIST DE INICIALIZAÇÃO

Antes de rodar o sistema:

- [ ] Chrome iniciado no Windows com `--remote-debugging-port=9224`
- [ ] Proxy acessível na porta 9224 (container-facing): `curl http://localhost:9224/json/version`
- [ ] Chrome no host escutando em 9224 (verificar com `netstat -ano | findstr :9224`)
- [ ] Docker container rodando
- [ ] Variável `CHROME_REMOTE_URL` configurada (se necessário)
- [ ] Teste de conexão Puppeteer executado com sucesso

---

**Status**: ✅ Configuração validada e documentada **Última atualização**: 2026-01-19
**Responsável**: Sistema NERV Singularity Edition
