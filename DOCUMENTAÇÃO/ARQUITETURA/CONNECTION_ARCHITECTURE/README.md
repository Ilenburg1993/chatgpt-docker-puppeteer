**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da arquitetura de conexão e contratos com browser externo.  
**Quando consultar**: quando a tarefa tocar Chrome externo, DevTools, conexão ou fallback.  
**Documento-mestre relacionado**: [../ARCHITECTURE.md](../ARCHITECTURE.md).

# Arquitetura de Conexão Browser - Sistema Agente GPT

**Versão**: 3.0 Docker Desktop Edition **Data**: 01 de Fevereiro de 2026 **Autor**: Sistema de
Automação com Puppeteer + Chrome Proxy **Status**: ✅ Validado e Funcionando

---

## 📖 Índice

1. [Visão Geral](#visão-geral)
2. [Para Iniciantes: Entendendo o Problema](#para-iniciantes-entendendo-o-problema)
3. [Para Profissionais: Decisões Arquiteturais](#para-profissionais-decisões-arquiteturais)
4. [Arquitetura Completa](#arquitetura-completa)
5. [Componentes e Responsabilidades](#componentes-e-responsabilidades)
6. [Fluxo de Dados](#fluxo-de-dados)
7. [Evolução Histórica](#evolução-histórica)
8. [Por Que Não Podemos Simplificar?](#por-que-não-podemos-simplificar)
9. [Trade-offs e Limitações](#trade-offs-e-limitações)
10. [Troubleshooting](#troubleshooting)
11. [Referências Técnicas](#referências-técnicas)

---

## 🎯 Visão Geral

Este sistema permite que código JavaScript executando dentro de um **container Docker** (ambiente
Linux isolado) controle um navegador **Google Chrome** rodando no **sistema operacional host
Windows**.

### Por Que Isso É Necessário?

**Problema Real**: Queremos automatizar interações com sites (ChatGPT, Gemini) usando Puppeteer,
mas:

- O código JavaScript roda em um container Linux (leve, portável)
- O Chrome precisa rodar no Windows (interface gráfica, recursos completos)
- Containers Linux **não conseguem** executar aplicações gráficas Windows diretamente

**Solução**: Separar os componentes e conectá-los via rede usando o protocolo Chrome DevTools
Protocol (CDP).

---

## 👶 Para Iniciantes: Entendendo o Problema

### Analogia: Controle Remoto de TV

Imagine que você tem:

- Um **controle remoto** (código JavaScript no container)
- Uma **TV** (Chrome no Windows)
- Eles estão em **cômodos diferentes** (container vs Windows)

Para o controle funcionar, você precisa:

1. **Sinal sem fio** que atravesse as paredes (rede TCP/IP)
2. **Receptor na TV** que entenda os comandos (Chrome Remote Debugging)
3. **Repetidor de sinal** se o alcance não for suficiente (Chrome Proxy)

### O Que Cada Componente Faz?

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONTAINER DOCKER (LINUX)                      │
│                                                                   │
│  ┌─────────────────┐        ┌──────────────────┐                │
│  │ Código Puppeteer│───────▶│  Chrome Proxy    │                │
│  │  (controle)     │        │  (repetidor)     │                │
│  └─────────────────┘        └──────────────────┘                │
│                                      │                            │
└──────────────────────────────────────┼────────────────────────────┘
                                       │
                              Rede Docker Desktop
                          (host.docker.internal)
                                       │
┌──────────────────────────────────────┼────────────────────────────┐
│                 WINDOWS HOST         │                             │
│                                      ▼                             │
│                            ┌──────────────────┐                   │
│                            │  Google Chrome   │                   │
│                            │  (receptor)      │                   │
│                            └──────────────────┘                   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Por Que Tantos Passos?

**Pergunta comum**: "Por que não executar o Chrome dentro do container?"

**Resposta curta**: Containers Linux não têm interface gráfica completa. Chrome sem GUI (headless) é
limitado e detectado por sites anti-bot.

**Resposta longa**:

1. **Interface Gráfica**: Chrome precisa de bibliotecas visuais do Windows (DirectX, GDI+)
2. **Detecção Anti-Bot**: Sites como ChatGPT detectam Chrome headless e bloqueiam
3. **Recursos do Windows**: Aceleração de GPU, codecs de vídeo, fontes nativas
4. **Perfis de Usuário**: Chrome no Windows pode usar dados reais do usuário (cookies, extensões)

---

## 🏗️ Para Profissionais: Decisões Arquiteturais

### Contexto Técnico

**Ambiente**:

- **Runtime**: Docker Desktop para Windows (WSL2 backend)
- **Container**: Debian 12 (bookworm) com Node.js 24.13.0
- **Host**: Windows 10/11 com Chrome 144.0.7559.110
- **Rede**: Bridge Docker Desktop com DNS especial `host.docker.internal`

**Protocolo**: Chrome DevTools Protocol (CDP)

- **Transporte**: WebSocket (bidirectional, full-duplex)
- **Porta Chrome**: 9225 (remote debugging)
- **Porta Proxy**: 9224 (HTTP + WebSocket proxy)

### Restrições da Rede Docker Desktop

Docker Desktop no Windows usa **WSL2** como backend, criando uma camada de rede virtualizada:

```
Container IP: 172.17.0.x (rede bridge interna)
Windows Host: Acessível via DNS especial "host.docker.internal"
              (resolve para IP da interface Windows visível ao WSL)
```

**Problema Crítico**: Chrome no Windows, por padrão, faz bind em `127.0.0.1` (localhost):

```
Windows: 127.0.0.1:9225 ← Chrome escutando APENAS aqui
                  ↑
                  │ WSL/Container NÃO pode acessar 127.0.0.1 do Windows!
                  │ (127.0.0.1 é sempre a própria máquina)
                  ▼
Container: Precisa de um IP roteável → host.docker.internal
```

**Solução**:

```powershell
# Chrome DEVE fazer bind em todas as interfaces (0.0.0.0)
chrome.exe --remote-debugging-address=0.0.0.0 --remote-debugging-port=9225
```

Isso permite:

```
Windows: 0.0.0.0:9225 → Escuta em TODAS as interfaces
                        ├─ 127.0.0.1 (localhost Windows)
                        ├─ 192.168.x.x (interface física)
                        └─ 172.x.x.x (interface Docker bridge)
                                ↑
                                │ Container consegue acessar!
                                ▼
Container: curl http://host.docker.internal:9225
```

### Por Que Usar Proxy? (ChromeProxyService)

**Problema 1: Host Header Validation**

Chrome valida o header HTTP `Host:` para segurança:

```http
GET /json/version HTTP/1.1
Host: host.docker.internal:9225  ← Chrome REJEITA (não é IP ou localhost)

HTTP/1.1 400 Bad Request
Host header is specified and is not an IP address or localhost.
```

**Solução**: Proxy reescreve o header:

```javascript
// ChromeProxyService intercepta e corrige
const proxyRequest = {
  ...originalRequest,
  headers: { Host: 'localhost' }, // Chrome aceita!
};
```

**Problema 2: WebSocket URL Rewriting**

Chrome retorna WebSocket URLs usando `localhost`:

```json
{
  "webSocketDebuggerUrl": "ws://localhost/devtools/browser/abc123"
}
```

Se o container usar esse URL diretamente:

```javascript
await puppeteer.connect({
  browserWSEndpoint: 'ws://localhost/devtools/browser/abc123',
  // ❌ ERRO: localhost no container ≠ localhost no Windows
});
```

**Solução**: Proxy reescreve URLs dinamicamente:

```javascript
// ChromeProxyService.rewriteWebSocketURL()
"ws://localhost/devtools/browser/abc123"
    ↓
"ws://172.17.0.2:9224/devtools/browser/abc123"
    ↓ (IP público do proxy visível ao container)
```

**Problema 3: Transparência para Puppeteer**

Puppeteer espera conectar a **um único endpoint**. Sem proxy:

```javascript
// ❌ Não funciona: Puppeteer não sabe lidar com host.docker.internal
const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://host.docker.internal:9225/devtools/...',
});
```

Com proxy:

```javascript
// ✅ Funciona: Proxy lida com toda a complexidade
const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://localhost:9224/devtools/...',
  // Proxy traduz tudo automaticamente
});
```

### Decisão: Onde Executar o Proxy?

**Opções Consideradas**:

1. **Proxy no Windows Host** (descartada)
   - ❌ Requer Node.js instalado no Windows
   - ❌ Gerenciamento de processos duplicado (PM2 no container + Windows)
   - ❌ Logs separados, troubleshooting complexo

2. **Proxy no Container** (escolhida) ✅
   - ✅ Tudo gerenciado pelo PM2 único
   - ✅ Logs centralizados
   - ✅ Deploy simplificado (docker-compose)
   - ✅ Proxy pode usar NERV (event bus do sistema)

**Trade-off**: Latência adicional mínima (~1-5ms) vs ganho massivo em manutenibilidade.

---

## 🏛️ Arquitetura Completa

### Diagrama de Camadas

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CAMADA DE APLICAÇÃO                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Kernel (Executor de Tarefas)                                 │   │
│  │    ├─ Task Runtime                                            │   │
│  │    ├─ Policy Engine                                           │   │
│  │    └─ Observation Store                                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Driver Layer (ChatGPT/Gemini)                                │   │
│  │    ├─ ChatGPTDriver (Puppeteer commands)                      │   │
│  │    ├─ GeminiDriver                                            │   │
│  │    └─ DriverNERVAdapter (event translation)                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   CAMADA DE INFRAESTRUTURA (CONTAINER)               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Browser Pool Manager                                         │   │
│  │    ├─ ensureBrowser() → delega ao ConnectionOrchestrator      │   │
│  │    ├─ Pool de instâncias Puppeteer                           │   │
│  │    └─ Health checks (crash/degradation detection)            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Connection Orchestrator v3.0 (739 linhas)                    │   │
│  │    ├─ Modo: LAUNCHER (padrão)                                │   │
│  │    ├─ Puppeteer.connect() → localhost:9224 (PROXY)           │   │
│  │    └─ Helpers: .puppeteerrc.cjs (isDocker, findChrome)       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Chrome Proxy Service v3.0 (643 linhas)                       │   │
│  │  Port: 0.0.0.0:9224 (escuta todas as interfaces container)   │   │
│  │                                                                │   │
│  │  Responsabilidades:                                            │   │
│  │    1. HTTP Proxy: /json/*, /devtools/* → Chrome               │   │
│  │    2. Header Rewriting: Host: localhost (fix validation)      │   │
│  │    3. WebSocket Proxy: Upgrade → ws:// tunnel                 │   │
│  │    4. URL Rewriting: localhost → 172.17.0.2:9224              │   │
│  │    5. NERV Integration: Eventos INFRA_READY/SHUTDOWN          │   │
│  │    6. Health Endpoint: /health (status: ok)                   │   │
│  │                                                                │   │
│  │  Configuração (via env vars):                                 │   │
│  │    CHROME_HOST=host.docker.internal                           │   │
│  │    CHROME_PORT=9225                                           │   │
│  │    CHROME_PROXY_PORT=9224                                     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                    HTTP/WebSocket                                    │
│                    host.docker.internal:9225                         │
│                              │                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                  ┌────────────┴─────────────┐
                  │  Docker Desktop Network  │
                  │  DNS: host.docker.internal│
                  │  → Windows IP Dinâmico   │
                  └────────────┬─────────────┘
                               │
┌──────────────────────────────┼───────────────────────────────────────┐
│                     WINDOWS HOST             │                       │
│                                              ▼                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Google Chrome (144.0.7559.110)                               │   │
│  │  Launcher: START-CHROME-SIMPLE.bat                            │   │
│  │                                                                │   │
│  │  Startup Command:                                             │   │
│  │    chrome.exe                                                 │   │
│  │      --remote-debugging-address=0.0.0.0  ← CRÍTICO!          │   │
│  │      --remote-debugging-port=9225                             │   │
│  │      --user-data-dir=%TEMP%\chrome-docker                     │   │
│  │      --no-first-run                                           │   │
│  │      --no-default-browser-check                               │   │
│  │                                                                │   │
│  │  Expõe:                                                        │   │
│  │    • HTTP JSON API: http://0.0.0.0:9225/json/version          │   │
│  │    • WebSocket CDP: ws://0.0.0.0:9225/devtools/browser/...    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Diagrama de Sequência: Conexão Puppeteer

```
Puppeteer          Proxy              Docker Net         Chrome
(Container)     (Container)           (DNS/Route)       (Windows)
    │                │                     │                │
    │ 1. connect()   │                     │                │
    ├───────────────▶│                     │                │
    │  ws://localhost:9224                 │                │
    │                │                     │                │
    │                │ 2. GET /json/version│                │
    │                ├────────────────────▶│                │
    │                │ Host: localhost     │                │
    │                │                     │                │
    │                │                     │ 3. Route via   │
    │                │                     │ host.docker... │
    │                │                     ├───────────────▶│
    │                │                     │ HTTP GET :9225 │
    │                │                     │                │
    │                │                     │ 4. JSON Response│
    │                │                     │◀───────────────┤
    │                │                     │ {Browser,wsURL}│
    │                │ 5. Rewrite wsURL    │                │
    │                │◀────────────────────┤                │
    │                │ localhost→172.17.0.2│                │
    │                │                     │                │
    │ 6. Response    │                     │                │
    │◀───────────────┤                     │                │
    │ ws://172.17.0.2:9224/devtools/...    │                │
    │                │                     │                │
    │ 7. WS Upgrade  │                     │                │
    ├───────────────▶│                     │                │
    │                │                     │                │
    │                │ 8. WS Upgrade       │                │
    │                ├────────────────────▶│                │
    │                │ Host: localhost     │                │
    │                │                     │                │
    │                │                     │ 9. Route       │
    │                │                     ├───────────────▶│
    │                │                     │                │
    │                │                     │ 10. Switching  │
    │                │                     │    Protocols   │
    │                │ 11. 101 Switching   │◀───────────────┤
    │                │◀────────────────────┤                │
    │                │                     │                │
    │ 12. Connected  │                     │                │
    │◀───────────────┤                     │                │
    │                │                     │                │
    │══════════════════ WebSocket Tunnel ══════════════════▶│
    │                Transparent bidirectional               │
    │                  CDP Protocol Messages                 │
    │◀═════════════════════════════════════════════════════▶│
```

---

## 🔧 Componentes e Responsabilidades

### 1. ConnectionOrchestrator (`src/infra/browser_pool/ConnectionOrchestrator.js`)

**Versão**: 3.0 (739 linhas) **Responsabilidade**: Estratégia de conexão ao Chrome

**Modos de Operação**:

```javascript
const DEFAULTS = {
  mode: 'launcher', // launcher | external | hybrid | auto
  // ...
};
```

- **launcher**: Puppeteer gerencia o Chrome (usado em testes)
- **external**: Conecta a Chrome já rodando (MODO PRODUÇÃO)
- **hybrid**: Tenta external, fallback para launcher
- **auto**: Detecção inteligente

**No Nosso Caso (Docker Desktop)**:

```javascript
// ConnectionOrchestrator usa EXTERNAL mode
// pois Chrome roda no Windows (fora do container)
const orchestrator = new ConnectionOrchestrator({
  mode: 'external',
  externalEndpoint: 'http://localhost:9224', // Proxy, não Chrome direto!
});
```

**Helpers Compartilhados** (.puppeteerrc.cjs):

```javascript
const puppeteerConfig = require('../../.puppeteerrc.cjs');

// Usa helpers DRY para detecção de ambiente
const isDocker = puppeteerConfig.isDocker();
const chromePath = puppeteerConfig.findChromeExecutable();
const cacheDir = puppeteerConfig.getCacheDirectory();
```

### 2. ChromeProxyService (`src/infra/proxy/chromeProxyService.js`)

**Versão**: 3.0 (643 linhas) **Responsabilidade**: Proxy HTTP + WebSocket com reescrita de URLs

**API Pública**:

```javascript
class ChromeProxyService {
  constructor({
    PUBLIC_IP,      // IP público do proxy (auto-detect ou manual)
    CHROME_PORT,    // 9225 (Chrome no Windows)
    PROXY_PORT,     // 9224 (Proxy no container)
    CHROME_HOST     // 'host.docker.internal'
  });

  async start();    // Inicia servidor HTTP + proxy WS
  async stop();     // Graceful shutdown
  setNERV(nerv);   // Injeta event bus NERV

  // Internos (usados por middleware Express)
  rewriteWebSocketURL(url, publicIP);
  handleHTTPRequest(req, res);
  handleWebSocketUpgrade(req, socket, head);
}
```

**Endpoints Expostos**:

```
GET  /health                    → { status: 'ok', uptime, stats }
GET  /json/*                    → Proxy para Chrome (URL rewriting)
GET  /devtools/*                → Proxy para Chrome
WS   /devtools/browser/*        → WebSocket tunnel
WS   /devtools/page/*           → WebSocket tunnel
*    (qualquer outro path)      → Proxy transparente
```

**Exemplo de Reescrita**:

```javascript
// Input do Chrome
{
  "webSocketDebuggerUrl": "ws://localhost/devtools/browser/abc123"
}

// Output do Proxy (após reescrita)
{
  "webSocketDebuggerUrl": "ws://172.17.0.2:9224/devtools/browser/abc123"
}
```

### 3. Browser Pool Manager (`src/infra/browser_pool/pool_manager.js`)

**Responsabilidade**: Pool de instâncias Puppeteer com health checks

**Método Crítico (BUG #2 corrigido)**:

```javascript
// ❌ ANTES (ERRADO)
async getBrowserInstance() {
  if (!this._browserInstance) {
    this._browserInstance = await this._connectionOrchestrator.connect();
    //                                                         ^^^^^^^ método inexistente!
  }
  return this._browserInstance;
}

// ✅ DEPOIS (CORRETO)
async getBrowserInstance() {
  if (!this._browserInstance) {
    this._browserInstance = await this._connectionOrchestrator.ensureBrowser();
    //                                                         ^^^^^^^^^^^^^ método correto!
  }
  return this._browserInstance;
}
```

**Validação de Proxy (BUG #3 corrigido)**:

```javascript
async _validateProxyAvailability() {
  const PROXY_HOST = CONFIG.CHROME_PROXY_HOST || 'localhost';
  const PROXY_PORT = CONFIG.CHROME_PROXY_PORT || 9224;
  const endpoint = `http://${PROXY_HOST}:${PROXY_PORT}/health`;

  try {
    const response = await axios.get(endpoint, { timeout: 3000 });
    if (response.status !== 200) {
      throw new Error(`Proxy unhealthy: status ${response.status}`);
    }
    return true;
  } catch (error) {
    this.log('ERROR', `Proxy validation failed: ${error.message}`);
    throw new Error(
      `Chrome Proxy não está acessível em ${endpoint}. ` +
      `Certifique-se de que o proxy está rodando (scripts/chrome-proxy-service.js).`
    );
  }
}
```

### 4. Main Boot Sequence (`src/main.js`)

**Phase 2.5: ChromeProxy Startup (BUG #1 & #4 corrigidos)**:

```javascript
// Linha 207-265 (59 linhas adicionadas)
log('INFO', '[BOOT] ─────────────────────────────────────────────────────');
log('INFO', '[BOOT] Phase 2.5: Chrome Proxy Service (se habilitado)');
log('INFO', '[BOOT] ─────────────────────────────────────────────────────');

if (CONFIG.CHROME_PROXY_ENABLED) {
  log('INFO', '[BOOT] Chrome Proxy habilitado, inicializando serviço...');

  const ChromeProxyService = require('./infra/proxy/chromeProxyService');

  const chromeProxy = new ChromeProxyService({
    PUBLIC_IP: process.env.PUBLIC_IP || null,
    CHROME_PORT: CONFIG.CHROME_PORT,
    PROXY_PORT: CONFIG.CHROME_PROXY_PORT,
    CHROME_HOST: CONFIG.CHROME_PROXY_HOST,
  });

  // Injeta NERV para eventos
  chromeProxy.setNERV(nerv);

  await chromeProxy.start();
  global.chromeProxy = chromeProxy;

  // Emite evento NERV
  const adapter = require('./infra/nerv/high_level_adapter');
  adapter.sendEvent(nerv, 'INFRA_READY', {
    component: 'ChromeProxyService',
    port: CONFIG.CHROME_PROXY_PORT,
    chromeHost: CONFIG.CHROME_PROXY_HOST,
    chromePort: CONFIG.CHROME_PORT,
  });

  log('INFO', '[BOOT] ✅ Chrome Proxy Service iniciado com sucesso');
} else {
  log('INFO', '[BOOT] Chrome Proxy desabilitado (CHROME_PROXY_ENABLED=false)');
}
```

**Shutdown (BUG #6 corrigido)**:

```javascript
// Linha 710-745 (28 linhas adicionadas)
log('INFO', '[SHUTDOWN] Stopping ChromeProxyService...');
if (global.chromeProxy && typeof global.chromeProxy.stop === 'function') {
  await global.chromeProxy.stop();

  const adapter = require('./infra/nerv/high_level_adapter');
  adapter.sendEvent(nerv, 'INFRA_SHUTDOWN', {
    component: 'ChromeProxyService',
    reason: 'Graceful shutdown',
  });

  log('INFO', '[SHUTDOWN] ✅ ChromeProxyService stopped');
}
```

---

## 🌊 Fluxo de Dados

### Request: Puppeteer → Chrome

```
1. Application Layer (Driver)
   │
   ├─ chatgpt_driver.js: await page.goto('https://chatgpt.com')
   │
   └─ Puppeteer API: page.goto() → CDP Command: Page.navigate
        │
        ▼
2. Infrastructure Layer (Pool Manager)
   │
   ├─ pool_manager.js: getBrowserInstance()
   │   └─ Valida proxy: GET http://localhost:9224/health ✓
   │
   └─ ConnectionOrchestrator: ensureBrowser()
        │
        └─ Puppeteer.connect({ browserWSEndpoint: 'ws://localhost:9224/...' })
             │
             ▼
3. Network Layer (Proxy)
   │
   ├─ ChromeProxyService: handleHTTPRequest()
   │   │
   │   ├─ Header rewrite: Host: host.docker.internal → Host: localhost
   │   │
   │   └─ Forward: http://host.docker.internal:9225/...
   │        │
   │        ▼
   └─ Docker Desktop DNS
        │
        └─ Resolve: host.docker.internal → 172.x.x.x (Windows bridge IP)
             │
             ▼
4. Chrome (Windows)
   │
   └─ chrome.exe listening on 0.0.0.0:9225
        │
        ├─ Accept HTTP GET /json/version
        ├─ Accept WS Upgrade /devtools/browser/...
        │
        └─ Return: CDP Response
             │
             ▼
5. Response Path (reverse)
   │
   Chrome → Docker Net → Proxy (URL rewrite) → Puppeteer
```

### WebSocket Tunnel: Bidirectional

```
Puppeteer                      Proxy                       Chrome
   │                             │                            │
   │ Page.navigate               │                            │
   ├────────────────────────────▶│                            │
   │ {"method":"Page.navigate"}  │                            │
   │                             │                            │
   │                             │ Forward (transparent)      │
   │                             ├───────────────────────────▶│
   │                             │                            │
   │                             │                ◀───────────┤
   │                             │  {"id":1,"result":{...}}   │
   │                             │                            │
   │   ◀────────────────────────┤                            │
   │  {"id":1,"result":{...}}    │                            │
   │                             │                            │
   │                             │ Event: Page.frameNavigated │
   │                             │ ◀──────────────────────────┤
   │   ◀────────────────────────┤                            │
   │  {"method":"Page.frame...}  │                            │
```

---

## 📜 Evolução Histórica

### Versão 1.0: Dev Container Direto (Descartada)

```
┌─────────────────────────────────┐
│   Dev Container (Docker)        │
│   ┌─────────┐    ┌──────────┐   │
│   │Puppeteer│───▶│  Chrome  │   │
│   │         │    │ Headless │   │
│   └─────────┘    └──────────┘   │
│                                  │
│   IP: 192.168.0.2 (bridge)      │
└──────────────────────────────────┘
```

**Problemas**:

- ❌ Chrome headless detectado por anti-bot
- ❌ Sem aceleração GPU
- ❌ Fonts limitadas
- ❌ Sem extensões Chrome

### Versão 2.0: WSL2 Nativo (Tentativa Fracassada)

```
┌─────────────────────────────────┐
│   WSL2 (Ubuntu)                 │
│   ┌─────────┐                   │
│   │Puppeteer│─┐                 │
│   └─────────┘ │                 │
│               │                 │
│        localhost:9225           │
└───────────────┼─────────────────┘
                │ (tentativa de conectar)
                ▼
┌───────────────────────────────────┐
│   Windows Host                    │
│   ┌──────────┐                    │
│   │  Chrome  │ 127.0.0.1:9225    │
│   └──────────┘ (NÃO ACESSÍVEL!)  │
└───────────────────────────────────┘
```

**Problema**: WSL2 `localhost` ≠ Windows `localhost`

### Versão 3.0: Docker Desktop + Proxy (ATUAL) ✅

```
┌─────────────────────────────────────┐
│   Docker Container                  │
│   ┌─────────┐    ┌──────────────┐   │
│   │Puppeteer│───▶│ ChromeProxy  │   │
│   │         │    │  :9224       │   │
│   └─────────┘    └──────┬───────┘   │
│                          │           │
└──────────────────────────┼───────────┘
                           │
              host.docker.internal
                           │
┌──────────────────────────┼───────────┐
│   Windows Host           ▼           │
│                  ┌──────────────┐    │
│                  │   Chrome     │    │
│                  │ 0.0.0.0:9225 │    │
│                  └──────────────┘    │
└─────────────────────────────────────┘
```

**Solução Definitiva**:

- ✅ Chrome full no Windows (GUI, GPU, extensões)
- ✅ Proxy no container (gerenciamento unificado)
- ✅ DNS Docker Desktop (`host.docker.internal`)
- ✅ Chrome bind `0.0.0.0` (todas as interfaces)

---

## ❓ Por Que Não Podemos Simplificar?

### Tentativa 1: "Por que não rodar Chrome no container?"

```javascript
// ❌ NÃO FUNCIONA
const browser = await puppeteer.launch({
  headless: true, // Chrome headless
  executablePath: '/usr/bin/chromium',
});
```

**Problemas**:

1. **Anti-Bot Detection**: ChatGPT detecta headless via `navigator.webdriver`
2. **Canvas Fingerprinting**: Headless retorna hash diferente de Chrome normal
3. **WebGL**: Headless não tem aceleração GPU → sites detectam
4. **Fonts**: Fonts do container ≠ fonts do Windows

**Evidência**:

```javascript
// Em headless
await page.evaluate(() => navigator.webdriver); // true ❌

// Em Chrome GUI
await page.evaluate(() => navigator.webdriver); // undefined ✅
```

### Tentativa 2: "Por que não conectar direto ao Chrome (sem proxy)?"

```javascript
// ❌ NÃO FUNCIONA (Host header error)
const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://host.docker.internal:9225/devtools/...',
});
```

**Erro**:

```
Error: Unexpected server response: 400
Host header is specified and is not an IP address or localhost.
```

**Explicação**: Chrome valida o header `Host:` por segurança. `host.docker.internal` não é
reconhecido.

### Tentativa 3: "Por que não rodar proxy no Windows?"

**Desvantagens**:

1. **Duplicação de Stack**:
   - Container: Node.js + PM2 + logs
   - Windows: Node.js + PM2 + logs (separado!)

2. **Gerenciamento Complexo**:

   ```
   ┌─ Container ─┐   ┌─ Windows ──┐
   │ PM2 (agent) │   │ PM2 (proxy)│
   │ Logs A      │   │ Logs B     │
   └─────────────┘   └────────────┘

   # Como ver logs unificados? ❌
   # Como garantir ordem de startup? ❌
   ```

3. **Deploy Complicado**:

   ```bash
   # Container
   docker-compose up -d

   # Windows (manual!)
   cd C:\proxy
   npm install  # Precisa Node.js no Windows
   pm2 start proxy.js
   ```

### Tentativa 4: "Por que não usar `localhost` em vez de `host.docker.internal`?"

```javascript
// ❌ NÃO FUNCIONA
CHROME_PROXY_HOST: 'localhost';
```

**Problema**: `localhost` no container aponta para **o próprio container**, não para Windows!

```
Container: localhost → 127.0.0.1 (container IP) ❌
Windows:   localhost → 127.0.0.1 (Windows IP)   ❌

São máquinas diferentes!
```

**Solução Docker Desktop**: DNS especial `host.docker.internal`

```
Container: host.docker.internal → IP da interface Windows ✅
```

---

## ⚖️ Trade-offs e Limitações

### Performance

**Latência Adicional**: ~1-5ms por request devido ao proxy

```
Sem Proxy (impossível):
  Puppeteer ──────────────▶ Chrome
             ~1ms

Com Proxy (necessário):
  Puppeteer ──▶ Proxy ──▶ Chrome
       ~1ms      ~1ms      ~1ms
  Total: ~3ms
```

**Impacto Real**: Desprezível para automação (tasks levam segundos/minutos)

### Complexidade

**Antes (tentativa ingênua)**:

```javascript
// 5 linhas
const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto('https://chatgpt.com');
```

**Depois (arquitetura real)**:

```javascript
// 800+ linhas distribuídas:
// - ConnectionOrchestrator: 739 linhas
// - ChromeProxyService: 643 linhas
// - START-CHROME-SIMPLE.bat: 60 linhas
// - config.json: 15 linhas de configuração
```

**Justificativa**: Complexidade **essencial** vs complexidade **acidental**

- Essencial: Necessária para funcionar em produção
- Acidental: Poderia ser evitada (não é o nosso caso!)

### Manutenibilidade

**Vantagens**:

- ✅ **Single Source of Truth**: Tudo gerenciado pelo PM2 no container
- ✅ **Logs Unificados**: `pm2 logs` mostra tudo
- ✅ **Deploy Atômico**: `docker-compose up -d` sobe tudo

**Desvantagens**:

- ⚠️ **Curva de Aprendizado**: Novos devs precisam entender networking Docker
- ⚠️ **Debugging**: Requer conhecimento de CDP + WebSocket + Docker

### Portabilidade

**Multiplataforma**:

```
✅ Windows + Docker Desktop
✅ macOS + Docker Desktop
✅ Linux + Docker Engine (com Chrome no host)
❌ Ambientes sem Docker (requer adaptação)
```

**Cloud**:

```
✅ AWS ECS + Chrome no EC2
✅ Google Cloud Run + Chrome sidecar
⚠️ Kubernetes (requer pods com Chrome)
❌ Serverless (Chrome precisa ser persistente)
```

---

## 🔧 Troubleshooting

### Erro: "Connection refused" ao acessar Chrome

**Sintomas**:

```bash
$ curl http://host.docker.internal:9225/json/version
curl: (7) Failed to connect
```

**Diagnóstico**:

1. **Chrome está rodando?**

   ```powershell
   # Windows
   tasklist | findstr chrome
   ```

2. **Chrome fez bind em 0.0.0.0?**

   ```powershell
   # Windows
   netstat -an | findstr :9225
   # Deve mostrar: 0.0.0.0:9225  (não 127.0.0.1:9225)
   ```

3. **Docker Desktop está configurado?**
   ```bash
   # Container
   ping host.docker.internal
   # Deve resolver para IP Windows
   ```

**Solução**:

```powershell
# Windows: Feche Chrome atual
taskkill /F /IM chrome.exe

# Reinicie com bind correto
START-CHROME-SIMPLE.bat
```

### Erro: "Host header is specified and is not an IP address or localhost"

**Causa**: Tentativa de conectar direto ao Chrome sem proxy

**Solução**:

```javascript
// ❌ ERRADO
browserWSEndpoint: 'ws://host.docker.internal:9225/devtools/...';

// ✅ CORRETO
browserWSEndpoint: 'ws://localhost:9224/devtools/...';
//                         proxy ────┘
```

### Erro: "Proxy validation failed"

**Sintomas**:

```
[ERROR] Chrome Proxy não está acessível em http://localhost:9224/health
```

**Diagnóstico**:

```bash
# Container
curl http://localhost:9224/health

# Se falhar, proxy não está rodando
ps aux | grep chrome-proxy
```

**Solução**:

```bash
# Container
CHROME_HOST=host.docker.internal node scripts/chrome-proxy-service.js &

# Ou via PM2
npx pm2 start ecosystem.config.cjs
```

### Debug: Verificar Fluxo Completo

```bash
# 1. Chrome no Windows
curl -H "Host: localhost" http://host.docker.internal:9225/json/version
# Espera: JSON com "Browser": "Chrome/144..."

# 2. Proxy no Container
curl http://localhost:9224/health
# Espera: {"status":"ok",...}

curl http://localhost:9224/json/version
# Espera: JSON do Chrome (URLs reescritas)

# 3. Puppeteer
node test-proxy-simple.js
# Espera: 6 testes passando
```

---

## 📚 Referências Técnicas

### Documentação Oficial

1. **Chrome DevTools Protocol**
   - https://chromedevtools.github.io/devtools-protocol/
   - Versão: 1.3 (Chrome 144)

2. **Puppeteer API**
   - https://pptr.dev/
   - Versão: 24.36.1 (em uso)

3. **Docker Desktop Networking**
   - https://docs.docker.com/desktop/networking/
   - DNS: `host.docker.internal` (Windows/macOS)

### Arquivos de Configuração

```
config.json                      # Configuração principal
├─ CHROME_PROXY_ENABLED: true
├─ CHROME_PROXY_HOST: "host.docker.internal"
├─ CHROME_PROXY_PORT: 9224
└─ CHROME_PORT: 9225

.puppeteerrc.cjs                 # Configuração Puppeteer + Helpers
├─ cacheDirectory: getCacheDirectory()
├─ executablePath: findChromeExecutable()
└─ Helpers: isDocker(), findChrome(), getCacheDirectory()

chrome-config.json               # Snapshot de configuração (exportado)
├─ version: "3.0"
├─ isDocker: false
├─ detectedChromePath: "/usr/bin/chromium"
├─ connection: { mode, ports, hosts }
└─ commands: { startChrome, checkChrome, killChrome }

START-CHROME-SIMPLE.bat          # Launcher Windows
├─ --remote-debugging-address=0.0.0.0
├─ --remote-debugging-port=9225
└─ --user-data-dir=%TEMP%\chrome-docker
```

### Código-Fonte Relevante

```
src/infra/browser_pool/
├─ ConnectionOrchestrator.js     # Estratégia de conexão (739 linhas)
├─ pool_manager.js               # Pool de instâncias
└─ .puppeteerrc.cjs              # Configuração + Helpers (238 linhas)

src/infra/proxy/
└─ chromeProxyService.js         # Proxy HTTP + WebSocket (643 linhas)

scripts/
├─ chrome-proxy-service.js       # CLI wrapper para proxy (61 linhas)
└─ wsl-chrome-integration.sh     # Validação e testes (367 linhas)

src/main.js                      # Boot sequence
├─ Phase 2.5: ChromeProxy (linhas 207-265)
└─ Shutdown: ChromeProxy (linhas 710-745)
```

### Testes

```
test-proxy-simple.js             # Teste de integração (103 linhas)
├─ Test 1: Proxy health
├─ Test 2: Chrome version
├─ Test 3: WebSocket endpoint
├─ Test 4: Puppeteer connection
├─ Test 5: Page navigation
└─ Test 6: Disconnect

wsl-chrome-integration.sh        # Suite completa
├─ validate: Chrome + config
├─ proxy: Inicia proxy
├─ test: Teste integrado
└─ all: Validação completa
```

---

## 🎯 Conclusão

Esta arquitetura é **necessária** e **não pode ser significativamente simplificada** sem perder
funcionalidade crítica:

1. **Chrome no Windows**: Obrigatório para evitar detecção anti-bot
2. **Proxy no Container**: Necessário para reescrever headers e URLs
3. **Docker Desktop DNS**: `host.docker.internal` é o único caminho seguro
4. **Chrome bind 0.0.0.0**: Única forma de aceitar conexões do container

**Trade-off Fundamental**:

```
Complexidade Arquitetural ↔ Funcionalidade Completa
       (necessária)              (não negociável)
```

**Próximos Passos de Desenvolvimento**:

- ✅ Arquitetura validada e documentada
- ⏳ Integração com sistema principal (boot completo)
- ⏳ Testes de stress (múltiplas conexões simultâneas)
- ⏳ Monitoramento de saúde (health checks automatizados)

---

**Última Atualização**: 01 de Fevereiro de 2026 **Versão da Arquitetura**: 3.0 Docker Desktop
Edition **Status**: ✅ Produção (validado com 6 testes)
