# 🔧 Guia de Integração: ConnectionOrchestrator + Chrome Proxy

**Data**: 2026-01-30 **Versão**: 1.0 **Status**: ✅ Implementação Completa

---

## 📋 Resumo Executivo

O **ConnectionOrchestrator** agora está totalmente integrado com o **Chrome Proxy Service**. O
sistema prioriza automaticamente conexão via proxy, com fallback robusto para conexão direta.

### Mudanças Implementadas:

1. ✅ **config.json**: Configurações do Chrome Proxy adicionadas (seção [A.1])
2. ✅ **ConnectionOrchestrator.js**: Priorização de porta 9224 e IP público 192.168.0.2
3. ✅ **Logs e Telemetria**: Indicadores claros quando conecta via proxy vs direto
4. ✅ **Documentação**: Comentários inline explicando estratégia de fallback

---

## 🎯 Como o ConnectionOrchestrator Funciona Agora

### Fluxo de Conexão (Modo `wsEndpoint`):

```
┌──────────────────────────────────────────────────────────────┐
│ ConnectionOrchestrator.ensureBrowser()                       │
│   mode: "wsEndpoint"  (default)                              │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ ConnectionOrchestrator.tryConnectWSEndpoint()                │
│   Loop: hosts × ports                                        │
└──────────────────────────────────────────────────────────────┘
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
       ▼                 ▼                 ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  Tentativa 1│   │  Tentativa 2│   │  Tentativa 3│
│             │   │             │   │             │
│ 192.168.0.2 │   │host.docker  │   │host.docker  │
│    :9224    │   │ internal    │   │ internal    │
│             │   │    :9224    │   │    :9224    │
│   [PROXY]   │   │   [PROXY]   │   │  [DIRECT]   │
└─────────────┘   └─────────────┘   └─────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│ fetch("http://192.168.0.2:9224/json/version")                │
│   → Chrome Proxy Service                                     │
│   → Reescreve webSocketDebuggerUrl                          │
│   → Retorna: "ws://192.168.0.2:9224/devtools/browser/..."   │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│ puppeteerCore.connect({                                      │
│   browserWSEndpoint: "ws://192.168.0.2:9224/devtools/..."  │
│ })                                                           │
│   → Conecta via WebSocket                                   │
│   → Proxy encaminha transparentemente para Chrome           │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│ ✅ Browser Connected                                         │
│    Log: "✅ Conectado via Chrome Proxy Service"             │
└──────────────────────────────────────────────────────────────┘
```

---

## 📝 Arquivo 1: config.json (ATUALIZADO)

**⚠️ AÇÃO NECESSÁRIA**: Criar/atualizar `config.json` na raiz do projeto.

**Localização**: `/workspaces/chatgpt-docker-puppeteer/config.json` **Arquivo temporário**:
`/tmp/config_proxy_updated.json` (devido a problema de filesystem)

### Mudanças Críticas:

**ANTES**:

```json
{
  "BROWSER_MODE": "remote",
  "DEBUG_PORT": "http://host.docker.internal:9224"
}
```

**DEPOIS**:

```json
{
  "// [A] MODO DE OPERAÇÃO DO BROWSER": "",
  "BROWSER_MODE": "wsEndpoint", // ✅ MUDANÇA CRÍTICA
  "DEBUG_PORT": "http://192.168.0.2:9224", // ✅ MUDANÇA CRÍTICA

  "// [A.1] CHROME PROXY CONFIGURATION": "",
  "CHROME_PROXY_ENABLED": true,
  "CHROME_PROXY_HOST": "192.168.0.2",
  "CHROME_PROXY_PORT": 9224,
  "CHROME_DIRECT_PORT": 9224,
  "ALLOW_BROWSER_FALLBACK": true
}
```

### Como Aplicar:

**Opção A - Copiar do /tmp** (no container):

```bash
cp /tmp/config_proxy_updated.json config.json
```

**Opção B - Criar manualmente no Windows** (se container tiver problema de filesystem):

1. Abrir editor de texto (VSCode, Notepad++)
2. Copiar conteúdo de `/tmp/config_proxy_updated.json`
3. Salvar como `config.json` na raiz do projeto

---

## 📝 Arquivo 2: ConnectionOrchestrator.js (ATUALIZADO)

**✅ JÁ MODIFICADO**: As mudanças já foram aplicadas ao código.

### Mudanças Implementadas:

#### 1. **Defaults - Priorização de Proxy** (linhas 73-85)

**ANTES**:

```javascript
const DEFAULTS = {
  mode: process.env.BROWSER_MODE || 'launcher',
  ports: [9224, 9223, 9224], // Porta direta primeiro
  hosts: ['127.0.0.1', 'localhost', 'host.docker.internal', '172.17.0.1'],
};
```

**DEPOIS**:

```javascript
const DEFAULTS = {
  mode: process.env.BROWSER_MODE || 'wsEndpoint', // ✅ wsEndpoint como padrão
  ports: [9224, 9224, 9223], // ✅ Porta proxy (9224) PRIMEIRO
  hosts: [
    '192.168.0.2', // ✅ IP público Windows (proxy) PRIMEIRO
    'host.docker.internal',
    '172.17.0.1',
    '127.0.0.1',
  ],
};
```

**Por quê isso importa**:

- Container tenta `192.168.0.2:9224` PRIMEIRO (proxy)
- Se proxy falhar, tenta `host.docker.internal:9224` (proxy via Docker DNS)
- Se proxy não estiver disponível, tenta conexão direta em `9224`

#### 2. **Logs e Telemetria** (linhas 278-334)

**ADICIONADO**:

```javascript
async tryConnectWSEndpoint() {
    for (const host of this.config.hosts) {
        for (const port of this.config.ports) {
            // ✅ Detecta tentativa via proxy
            const isProxyAttempt = port === 9224 ||
                                  (host === '192.168.0.2' && [9224, 9224].includes(port));
            const attemptType = isProxyAttempt ? '[PROXY]' : '[DIRECT]';

            log('DEBUG', `[ORCH] ${attemptType} Tentando WS endpoint: ${url}`);

            // ... conexão ...

            // ✅ Log de sucesso específico
            if (isProxyAttempt && port === 9224) {
                log('INFO', `[ORCH] ✅ Conectado via Chrome Proxy Service (${host}:${port})`);
                log('INFO', `[ORCH]    WebSocket URL: ${json.webSocketDebuggerUrl}`);
            } else {
                log('INFO', `[ORCH] ✅ Conectado diretamente ao Chrome (${host}:${port})`);
            }
        }
    }
}
```

**Benefício**:

- Logs mostram claramente se conectou via proxy ou direto
- Facilita debugging e monitoramento

#### 3. **Documentação Inline** (linhas 332-356)

**ADICIONADO**: Bloco de comentários explicando estratégia de fallback no método `ensureBrowser()`.

---

## 🧪 Como Testar a Integração

### Pré-requisitos:

1. ✅ Chrome rodando no Windows com remote debugging (porta 9224)
2. ✅ Chrome Proxy Service rodando no Windows (porta 9224)
3. ✅ config.json atualizado (conforme seção acima)
4. ✅ ConnectionOrchestrator.js modificado (já feito)

### Teste 1: Iniciar Proxy no Windows

**PowerShell (Windows)**:

```powershell
# Navegar para pasta do projeto
cd C:\path\to\chatgpt-docker-puppeteer

# Opção A: Launcher automatizado (RECOMENDADO)
scripts\start-chrome-with-proxy.bat

# Opção B: Manual
node scripts/chrome-proxy-service.js 192.168.0.2 info
```

**Output esperado**:

```
✅ Chrome Proxy Service started
   Listening: 0.0.0.0:9224
   Forwarding: 127.0.0.1:9224
   Public URL: http://192.168.0.2:9224
```

### Teste 2: Verificar Proxy Acessível do Container

**Do container Docker**:

```bash
curl http://192.168.0.2:9224/json/version
```

**Output esperado** (JSON com IP público):

```json
{
  "Browser": "Chrome/144.0.0.0",
  "webSocketDebuggerUrl": "ws://192.168.0.2:9224/devtools/browser/..."
}
```

⚠️ **Se retornar `localhost`**, proxy não está reescrevendo URLs corretamente.

### Teste 3: Iniciar Sistema e Verificar Logs

**Do container Docker**:

```bash
npm start
```

**Logs esperados** (stdout do sistema):

```
[INFO] [ORCH] State: DETECTING_ENV
[INFO] [ORCH] State: WAITING_FOR_BROWSER
[INFO] [ORCH] Tentando conexão em modo: wsEndpoint
[DEBUG] [ORCH] [PROXY] Tentando WS endpoint: http://192.168.0.2:9224/json/version
[INFO] [ORCH] ✅ Conectado via Chrome Proxy Service (192.168.0.2:9224)
[INFO] [ORCH]    WebSocket URL: ws://192.168.0.2:9224/devtools/browser/XXXXX
[INFO] [ORCH] State: BROWSER_READY
[INFO] [ORCH] Browser conectado com sucesso em modo: wsEndpoint
```

✅ **Se ver "Conectado via Chrome Proxy Service"**: Integração funcionando perfeitamente!

❌ **Se ver "Conectado diretamente ao Chrome"**: Sistema está usando fallback, proxy pode não estar
funcionando.

### Teste 4: Verificar Conexão WebSocket Ativa

**PowerShell (Windows) - no terminal do Proxy**:

```
Quando container conectar, proxy deve mostrar:

[INFO] HTTP GET /json/version { from: '172.17.0.x' }
[DEBUG] URL rewritten { original: 'ws://127.0.0.1:9224/...', rewritten: 'ws://192.168.0.2:9224/...' }
[INFO] WebSocket upgrade: /devtools/browser/XXXXX { from: '172.17.0.x' }
[DEBUG] Chrome WebSocket connected
```

---

## 🔧 Troubleshooting

### Problema 1: Container Não Conecta ao Proxy

**Sintoma**:

```
[ORCH] WS endpoint unreachable: 192.168.0.2:9224 - connect ETIMEDOUT
```

**Causas Possíveis**:

1. Proxy não está rodando no Windows
2. Firewall bloqueando porta 9224
3. IP público mudou (DHCP)

**Solução**:

```powershell
# Windows - Verificar se proxy está rodando
netstat -ano | findstr :9224

# Se não estiver, iniciar
scripts\start-chrome-with-proxy.bat

# Verificar firewall
Get-NetFirewallRule -DisplayName "Chrome Proxy 9224"

# Se não existir, criar
New-NetFirewallRule -DisplayName "Chrome Proxy 9224" -Direction Inbound -LocalPort 9224 -Protocol TCP -Action Allow
```

### Problema 2: Logs Mostram "[DIRECT]" em vez de "[PROXY]"

**Sintoma**:

```
[INFO] [ORCH] ✅ Conectado diretamente ao Chrome (host.docker.internal:9224)
```

**Causa**: Proxy não respondeu, sistema usou fallback.

**Diagnóstico**:

```bash
# Do container
curl http://192.168.0.2:9224/json/version

# Se falhar, proxy não está acessível
```

**Solução**: Ver Problema 1.

### Problema 3: webSocketDebuggerUrl Ainda com Localhost

**Sintoma**: Container recebe `ws://localhost:9224/...`

**Causa**: Proxy não está reescrevendo URLs ou container não está usando proxy.

**Diagnóstico**:

```bash
# Verificar response do proxy
curl -s http://192.168.0.2:9224/json/version | grep webSocketDebuggerUrl

# Deve mostrar:
# "webSocketDebuggerUrl": "ws://192.168.0.2:9224/devtools/..."
```

**Solução**:

1. Verificar logs do proxy (deve mostrar "URL rewritten")
2. Confirmar que container está usando porta 9224 (não 9224)
3. Verificar config.json: `DEBUG_PORT` deve ser `http://192.168.0.2:9224`

---

## 📊 Próximos Passos

### Ações Pendentes:

1. ✅ **FAZER AGORA**: Atualizar `config.json` conforme seção "Arquivo 1"

   ```bash
   # No container
   cp /tmp/config_proxy_updated.json config.json
   ```

2. ✅ **FAZER AGORA**: Iniciar Chrome + Proxy no Windows

   ```powershell
   # PowerShell
   scripts\start-chrome-with-proxy.bat
   ```

3. ✅ **FAZER AGORA**: Testar conexão do container

   ```bash
   # No container
   curl http://192.168.0.2:9224/json/version
   ```

4. ✅ **FAZER AGORA**: Iniciar sistema e verificar logs

   ```bash
   # No container
   npm start
   # Verificar se mostra "✅ Conectado via Chrome Proxy Service"
   ```

5. ⏳ **DEPOIS**: Criar task de teste e executar
   ```bash
   npm run queue:add
   tail -f logs/kernel.log
   ```

### Validação de Sucesso:

- [ ] Proxy rodando no Windows (porta 9224)
- [ ] Container acessa `http://192.168.0.2:9224/json/version`
- [ ] Sistema mostra log "✅ Conectado via Chrome Proxy Service"
- [ ] Task executa com sucesso (browser automation funciona)
- [ ] Zero memory leaks após 10 minutos de execução

---

## 📚 Arquivos de Referência

| Arquivo                         | Localização                                        | Status                  |
| ------------------------------- | -------------------------------------------------- | ----------------------- |
| **config.json**                 | `/workspaces/chatgpt-docker-puppeteer/config.json` | ⚠️ Precisa atualizar    |
| **config.json (backup)**        | `/tmp/config_proxy_updated.json`                   | ✅ Pronto para copiar   |
| **ConnectionOrchestrator.js**   | `src/infra/ConnectionOrchestrator.js`              | ✅ Atualizado           |
| **chrome-proxy-service.js**     | `scripts/chrome-proxy-service.js`                  | ✅ Criado anteriormente |
| **start-chrome-with-proxy.bat** | `scripts/start-chrome-with-proxy.bat`              | ✅ Criado anteriormente |
| **CHROME_PROXY_SETUP.md**       | `DOCUMENTAÇÃO/CHROME_PROXY_SETUP.md`               | ✅ Criado anteriormente |

---

## 🎯 Resumo da Arquitetura Final

```
┌─────────────────────────────────────────────────────────────────┐
│                      WINDOWS HOST                                │
│                                                                   │
│  ┌──────────────┐                 ┌─────────────────────┐       │
│  │   Chrome     │◄────────────────│  Chrome Proxy       │       │
│  │              │  127.0.0.1:9224 │  Service (Node.js)  │       │
│  │ --remote-    │                 │                     │       │
│  │ debugging-   │                 │  • HTTP: Rewrite    │       │
│  │ port=9224    │                 │    URLs             │       │
│  └──────────────┘                 │  • WS: Transparent  │       │
│                                    │    proxy            │       │
│                                    │  0.0.0.0:9224       │       │
│                                    └─────────────────────┘       │
│                                             ▲                    │
└─────────────────────────────────────────────┼────────────────────┘
                                              │
                                              │ 192.168.0.2:9224
                                              │
┌─────────────────────────────────────────────┼────────────────────┐
│                    DOCKER CONTAINER                              │
│                                             │                    │
│  ┌──────────────────────────────────────────┴──────────────┐   │
│  │           ConnectionOrchestrator                         │   │
│  │                                                           │   │
│  │  1. tryConnectWSEndpoint()                               │   │
│  │     → Tenta 192.168.0.2:9224 PRIMEIRO (proxy)            │   │
│  │     → fetch("http://192.168.0.2:9224/json/version")      │   │
│  │  2. Recebe: webSocketDebuggerUrl: "ws://192.168.0.2:9224"│   │
│  │     → Proxy já reescreveu localhost → IP público         │   │
│  │  3. puppeteerCore.connect({ browserWSEndpoint })         │   │
│  │     → Conecta via WebSocket                              │   │
│  │  4. Proxy encaminha transparentemente para Chrome        │   │
│  │                                                           │   │
│  │  Logs:                                                   │   │
│  │  [DEBUG] [PROXY] Tentando WS endpoint: http://...        │   │
│  │  [INFO] ✅ Conectado via Chrome Proxy Service            │   │
│  │  [INFO]    WebSocket URL: ws://192.168.0.2:9224/...      │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                    Puppeteer                              │   │
│  │  • Browser automation                                     │   │
│  │  • Page manipulation                                      │   │
│  │  • CDP commands via WebSocket                            │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

---

**Última atualização**: 2026-01-30 **Autor**: Claude Sonnet 4.5 (AI Assistant) **Versão**: 1.0 -
Integração Completa
