**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da arquitetura de conexão e contratos com browser externo.  
**Quando consultar**: quando a tarefa tocar Chrome externo, DevTools, conexão ou fallback.  
**Documento-mestre relacionado**: [../ARCHITECTURE.md](../ARCHITECTURE.md).

# Guia Prático: Arquitetura de Conexão

**Complemento ao**: [README.md](./README.md) **Foco**: Exemplos práticos, comandos, debugging

---

## 📋 Checklist de Setup

### Windows Host

- [ ] **Chrome instalado** (v144+)

  ```powershell
  # Verificar versão
  chrome.exe --version
  ```

- [ ] **START-CHROME-SIMPLE.bat configurado**

  ```powershell
  # Verificar conteúdo
  type START-CHROME-SIMPLE.bat | findstr "remote-debugging-address"
  # Deve conter: --remote-debugging-address=0.0.0.0
  ```

- [ ] **Chrome rodando em 0.0.0.0:9225**
  ```powershell
  # Verificar bind
  netstat -an | findstr :9225
  # Deve mostrar: 0.0.0.0:9225 ou [::]:9225
  ```

### Docker Container

- [ ] **config.json correto**

  ```bash
  cat config.json | grep -A4 "CHROME_PROXY"
  # Deve ter:
  # "CHROME_PROXY_ENABLED": true,
  # "CHROME_PROXY_HOST": "host.docker.internal",
  # "CHROME_PROXY_PORT": 9224,
  # "CHROME_PORT": 9225
  ```

- [ ] **Proxy rodando em localhost:9224**

  ```bash
  curl http://localhost:9224/health
  # Deve retornar: {"status":"ok",...}
  ```

- [ ] **Chrome acessível do container**
  ```bash
  curl -H "Host: localhost" http://host.docker.internal:9225/json/version
  # Deve retornar JSON com "Browser": "Chrome/..."
  ```

---

## 🚀 Startup Completo (Passo a Passo)

### 1. Iniciar Chrome no Windows

```powershell
# Terminal 1: Windows PowerShell/CMD
cd \caminho\do\projeto
START-CHROME-SIMPLE.bat
```

**Saída Esperada**:

```
Starting Chrome for Docker Desktop access (Port 9225)...

IMPORTANT: Chrome will bind to 0.0.0.0 (all interfaces)
This allows Docker containers to access it.

Chrome started on 0.0.0.0:9225

Validate from container:
  curl http://host.docker.internal:9225/json/version

Validate from Windows:
  curl http://localhost:9225/json/version

Press any key to close Chrome...
```

**Validação Windows**:

```powershell
# Testar localmente
curl http://localhost:9225/json/version

# Ou com Invoke-RestMethod (PowerShell)
Invoke-RestMethod -Uri http://localhost:9225/json/version | ConvertTo-Json
```

### 2. Validar Conectividade do Container

```bash
# Terminal 2: Container bash
bash wsl-chrome-integration.sh validate
```

**Saída Esperada**:

```
═══════════════════════════════════════════════════════════
  VALIDATING CHROME ON WINDOWS HOST
═══════════════════════════════════════════════════════════

[INFO] Checking Chrome accessibility from WSL...
[INFO] Endpoint: http://host.docker.internal:9225/json/version
[INFO] Attempt 1/5...
[OK] Chrome is accessible from Docker!

[INFO] Chrome Details:
{
  "Browser": "Chrome/144.0.7559.110",
  "Protocol-Version": "1.3",
  ...
}
```

### 3. Iniciar Proxy no Container

**Opção A: Direto (desenvolvimento)**:

```bash
# Container
unset NODE_OPTIONS # Evitar flags duplicadas
CHROME_HOST=host.docker.internal node scripts/chrome-proxy-service.js > /tmp/proxy.log 2>&1 &

# Ver logs
tail -f /tmp/proxy.log
```

**Opção B: Via PM2 (produção)**:

```bash
# Container
npm run daemon:start
# Ou
npx pm2 start ecosystem.config.cjs

# Ver logs
pm2 logs
```

**Validação**:

```bash
# Container
curl http://localhost:9224/health
# Espera: {"status":"ok","uptime":123,...}

curl http://localhost:9224/json/version
# Espera: JSON do Chrome (com URLs reescritas)
```

### 4. Teste Completo de Integração

```bash
# Container
unset NODE_OPTIONS
node test-proxy-simple.js
```

**Saída Esperada**:

```
🧪 CHROME PROXY INTEGRATION TEST (Docker Desktop Edition)

[TEST 1] Checking proxy health...
✅ Proxy health: ok

[TEST 2] Getting Chrome version via proxy...
✅ Chrome version: Chrome/144.0.7559.110

[TEST 3] Getting browser WebSocket endpoint...
✅ WS Endpoint: ws://172.17.0.2:9224/devtools/browser/...

[TEST 4] Connecting Puppeteer via proxy...
✅ Puppeteer connected

[TEST 5] Creating page and navigating...
✅ Page loaded: Example Domain

[TEST 6] Disconnecting...
✅ Disconnected

🎉 ALL TESTS PASSED!
```

---

## 🐛 Troubleshooting: Cenários Comuns

### Cenário 1: "Connection refused" ao acessar Chrome

**Erro**:

```bash
$ curl http://host.docker.internal:9225/json/version
curl: (7) Failed to connect to host.docker.internal port 9225
```

**Diagnóstico**:

```powershell
# Windows: Verificar se Chrome está rodando
tasklist | findstr chrome

# Windows: Verificar porta
netstat -an | findstr :9225
```

**Possíveis Causas**:

1. **Chrome não está rodando**

   ```powershell
   # Solução: Iniciar Chrome
   START-CHROME-SIMPLE.bat
   ```

2. **Chrome fez bind em 127.0.0.1 (não 0.0.0.0)**

   ```powershell
   # Problema: netstat mostra
   TCP    127.0.0.1:9225    ...  ❌ ERRADO

   # Solução: Matar Chrome e reiniciar
   taskkill /F /IM chrome.exe
   START-CHROME-SIMPLE.bat

   # Verificar novamente: netstat deve mostrar
   TCP    0.0.0.0:9225      ...  ✅ CORRETO
   ```

3. **Porta 9225 em uso por outro processo**

   ```powershell
   # Identificar processo
   netstat -ano | findstr :9225
   # Última coluna = PID

   # Matar processo
   taskkill /F /PID <numero_do_pid>
   ```

### Cenário 2: "Host header" error

**Erro**:

```
Error: Unexpected server response: 400
Host header is specified and is not an IP address or localhost.
```

**Causa**: Tentativa de conectar **direto** ao Chrome, sem proxy

**Diagnóstico**:

```javascript
// ❌ CÓDIGO ERRADO
const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://host.docker.internal:9225/devtools/...',
  //                       ^^^^^^^^^^^^^^^^^^^^^^^^ Direto ao Chrome
});
```

**Solução**:

```javascript
// ✅ CÓDIGO CORRETO
const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://localhost:9224/devtools/...',
  //                       ^^^^^^^^^^^^^^^^ Via Proxy
});
```

**Ou verificar config.json**:

```json
{
  "CHROME_PROXY_ENABLED": true, // ← Deve ser true
  "CHROME_PROXY_HOST": "host.docker.internal",
  "CHROME_PROXY_PORT": 9224
}
```

### Cenário 3: Proxy não inicia

**Erro**:

```bash
$ curl http://localhost:9224/health
curl: (7) Failed to connect to localhost port 9224
```

**Diagnóstico**:

```bash
# Container: Verificar se proxy está rodando
ps aux | grep chrome-proxy-service
# ou
pm2 list | grep proxy
```

**Possíveis Causas**:

1. **NODE_OPTIONS com flags duplicadas**

   ```bash
   # Erro típico
   Error: illegal value for flag --max-old-space-size=6144--max-old-space-size=6144
   
   # Solução: Limpar NODE_OPTIONS
   unset NODE_OPTIONS
   node scripts/chrome-proxy-service.js &
   ```

2. **Porta 9224 em uso**

   ```bash
   # Verificar
   lsof -i :9224
   # ou
   netstat -tuln | grep :9224

   # Matar processo
   kill <PID>
   ```

3. **Módulo axios faltando** (se teste direto)

   ```bash
   # Erro
   Error: Cannot find module 'axios'
   
   # Solução
   npm install axios
   ```

### Cenário 4: WebSocket fecha inesperadamente

**Sintoma**:

```
WebSocket connection closed unexpectedly
Target closed.
```

**Causas Comuns**:

1. **Chrome crashou**

   ```powershell
   # Windows: Verificar se Chrome ainda está rodando
   tasklist | findstr chrome

   # Se não, reiniciar
   START-CHROME-SIMPLE.bat
   ```

2. **Timeout de idle**

   ```javascript
   // ChromeProxyService tem timeout de 60s por padrão
   // Ver em src/infra/proxy/chromeProxyService.js:
   this._idleTimeoutMs = parseInt(process.env.WS_IDLE_TIMEOUT_MS || '60000', 10);

   // Aumentar se necessário
   WS_IDLE_TIMEOUT_MS=300000 node scripts/chrome-proxy-service.js
   ```

3. **Rede Docker instável**

   ```bash
   # Container: Testar latência
   ping -c 5 host.docker.internal
   
   # Se alta latência (>50ms), reiniciar Docker Desktop
   ```

### Cenário 5: URLs não reescritas

**Sintoma**:

```javascript
// Puppeteer recebe
{
  "webSocketDebuggerUrl": "ws://localhost/devtools/browser/..."
}
// Em vez de
{
  "webSocketDebuggerUrl": "ws://172.17.0.2:9224/devtools/browser/..."
}
```

**Causa**: Proxy não está fazendo reescrita correta

**Diagnóstico**:

```bash
# Container: Testar endpoint /json/version
curl -s http://localhost:9224/json/version | jq .webSocketDebuggerUrl

# Deve retornar: "ws://172.17.0.2:9224/devtools/..."
# Se retornar: "ws://localhost/devtools/..." → Proxy com problema
```

**Solução**:

```bash
# 1. Verificar IP público do proxy
docker exec -it -I < container_id > hostname
# Anote primeiro IP (ex: 172.17.0.2)

# 2. Reiniciar proxy com IP explícito
PUBLIC_IP=172.17.0.2 node scripts/chrome-proxy-service.js &
```

---

## 📊 Monitoramento e Logs

### Logs do Proxy

**Localização**: `/tmp/proxy.log` (se iniciado manualmente) ou PM2 logs

**Ver logs em tempo real**:

```bash
# Manual
tail -f /tmp/proxy.log

# PM2
pm2 logs chrome-proxy-service --lines 100
```

**Formato de log** (JSON estruturado):

```json
{
  "level": 30,
  "time": 1769948254981,
  "pid": 10440,
  "hostname": "20ca7ab7a2e7",
  "msg": "✅ Chrome Proxy Service started"
}
```

**Filtrar erros**:

```bash
# PM2
pm2 logs chrome-proxy-service --err

# Manual
tail -f /tmp/proxy.log | grep '"level":50' # Level 50 = ERROR
```

### Health Checks Automatizados

**Script de monitoramento**:

```bash
#!/bin/bash
# monitor-chrome-stack.sh

while true; do
  echo "=== $(date) ==="

  # 1. Chrome no Windows
  echo -n "Chrome (Windows): "
  curl -sf -H "Host: localhost" http://host.docker.internal:9225/json/version > /dev/null 2>&1 \
    && echo "✅ OK" || echo "❌ DOWN"

  # 2. Proxy no Container
  echo -n "Proxy (Container): "
  curl -sf http://localhost:9224/health > /dev/null 2>&1 \
    && echo "✅ OK" || echo "❌ DOWN"

  echo ""
  sleep 30
done
```

**Executar**:

```bash
chmod +x monitor-chrome-stack.sh
./monitor-chrome-stack.sh
```

### Métricas do Proxy

**Endpoint**: `GET /health`

**Resposta**:

```json
{
  "status": "ok",
  "uptime": 12345.678,
  "stats": {
    "requests": 42,
    "errors": 0,
    "activeWebSockets": 1
  },
  "config": {
    "chromeHost": "host.docker.internal",
    "chromePort": 9225,
    "proxyPort": 9224
  }
}
```

**Alertas via curl**:

```bash
# Script de alerta
STATUS=$(curl -sf http://localhost:9224/health | jq -r .status)

if [ "$STATUS" != "ok" ]; then
  echo "⚠️ ALERTA: Proxy não está saudável!"
  # Enviar email, Slack, etc.
fi
```

---

## 🔬 Debug Avançado

### Inspecionar Tráfego WebSocket

**Ferramenta**: `wscat` (WebSocket CLI)

```bash
# Instalar
npm install -g wscat

# Conectar diretamente ao Chrome (para teste)
wscat -H "Host: localhost" -c ws://host.docker.internal:9225/devtools/browser/<ID>

# Conectar via proxy
wscat -c ws://localhost:9224/devtools/browser/<ID>
```

**Enviar comando CDP**:

```json
{ "id": 1, "method": "Browser.getVersion" }
```

**Resposta esperada**:

```json
{
  "id": 1,
  "result": {
    "protocolVersion": "1.3",
    "product": "Chrome/144.0.7559.110",
    ...
  }
}
```

### Capturar Pacotes de Rede

**Ferramenta**: `tcpdump`

```bash
# Container: Capturar tráfego na porta 9224
sudo tcpdump -i any -s 0 -w /tmp/proxy-traffic.pcap port 9224

# Analisar com Wireshark (no host)
# Filtro: tcp.port == 9224
```

### Habilitar Logs Detalhados do Puppeteer

```bash
# Container
DEBUG=puppeteer:* node test-proxy-simple.js
```

**Saída** (verbose):

```
puppeteer:protocol:SEND ► {"method":"Target.getBrowserContexts","id":1}
puppeteer:protocol:RECV ◀ {"id":1,"result":{"browserContextIds":[]}}
puppeteer:protocol:SEND ► {"method":"Page.navigate","params":{...}}
...
```

### Testar Componentes Isoladamente

**1. Apenas Chrome (Windows)**:

```powershell
# Windows PowerShell
$response = Invoke-RestMethod -Uri http://localhost:9225/json/version
$response | ConvertTo-Json
```

**2. Apenas Proxy (Container)**:

```bash
# Container
curl http://localhost:9224/health
curl http://localhost:9224/json/version
```

**3. Apenas Puppeteer (Container)**:

```javascript
// test-puppeteer-direct.js
const puppeteer = require('puppeteer');

(async () => {
  // Conectar via proxy
  const version = await fetch('http://localhost:9224/json/version').then((r) => r.json());
  const browser = await puppeteer.connect({
    browserWSEndpoint: version.webSocketDebuggerUrl,
  });

  console.log('✅ Conectado');
  await browser.disconnect();
})();
```

---

## 📚 Referências Rápidas

### Comandos Úteis

**Windows**:

```powershell
# Listar processos Chrome
tasklist | findstr chrome

# Matar todos os Chrome
taskkill /F /IM chrome.exe

# Verificar portas
netstat -an | findstr :9225

# Testar endpoint
curl http://localhost:9225/json/version
# ou
Invoke-RestMethod -Uri http://localhost:9225/json/version
```

**Container**:

```bash
# Validação completa
bash wsl-chrome-integration.sh all

# Teste rápido
curl -H "Host: localhost" http://host.docker.internal:9225/json/version

# Ver logs proxy
pm2 logs chrome-proxy-service

# Reiniciar proxy
pm2 restart chrome-proxy-service

# Status geral
pm2 status
```

### Variáveis de Ambiente

**Proxy** (`scripts/chrome-proxy-service.js`):

```bash
CHROME_HOST=host.docker.internal # Host do Chrome
CHROME_PORT=9225                 # Porta do Chrome
CHROME_PROXY_PORT=9224           # Porta do proxy
PUBLIC_IP=172.17.0.2             # IP público do proxy (auto-detect)
LOG_LEVEL=info                   # info | debug | warn | error
WS_IDLE_TIMEOUT_MS=60000         # Timeout WebSocket idle (ms)
```

**Puppeteer** (debug):

```bash
DEBUG=puppeteer:*            # Logs detalhados
PUPPETEER_PRODUCT=chrome     # chrome | firefox
PUPPETEER_SKIP_DOWNLOAD=true # Não baixar Chromium bundled
```

### Arquivos de Configuração

**Localizações**:

```
/workspaces/chatgpt-docker-puppeteer/
├── config.json                              # Config principal
├── .puppeteerrc.cjs                         # Config Puppeteer + Helpers
├── chrome-config.json                       # Snapshot (exportado)
├── START-CHROME-SIMPLE.bat                  # Launcher Windows
├── scripts/chrome-proxy-service.js          # CLI proxy
├── src/infra/proxy/chromeProxyService.js    # Implementação proxy
├── src/infra/browser_pool/ConnectionOrchestrator.js
└── wsl-chrome-integration.sh                # Validação/testes
```

**Editar configuração**:

```bash
# Container
nano config.json

# Validar JSON
cat config.json | jq .

# Aplicar mudanças (reiniciar proxy)
pm2 restart chrome-proxy-service
```

---

## ✅ Conclusão

Este guia cobre os **cenários práticos mais comuns** de uso, debug e troubleshooting da arquitetura
de conexão.

**Para aprofundamento teórico**: Veja [README.md](./README.md)

**Próximos Passos**:

1. Executar checklist de setup completo
2. Validar com teste de integração
3. Configurar monitoramento contínuo
4. Documentar casos específicos do seu projeto

**Suporte**:

- Logs detalhados: `pm2 logs --lines 200`
- Debug interativo: `DEBUG=puppeteer:* node <script>`
- Community: Veja issues do Puppeteer (https://github.com/puppeteer/puppeteer/issues)

---

**Última Atualização**: 01 de Fevereiro de 2026 **Versão**: 3.0 Docker Desktop Edition
