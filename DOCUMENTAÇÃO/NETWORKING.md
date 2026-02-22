# 🌐 Networking & Port Management

**Versão**: 1.0 **Data**: 2026-01-21 **Status**: ✅ Documentação Oficial **Relacionado**:
[CROSS_CUTTING_PORTS_AUDIT.md](AUDITORIAS/CROSS_CUTTING_PORTS_AUDIT.md)

---

## 📋 Visão Geral

Este documento descreve a estratégia de gerenciamento de portas e networking do
chatgpt-docker-puppeteer, incluindo:

- Portas utilizadas pelo sistema
- Algoritmo de port hunting

# Resposta esperada:

# {

# "Browser": "Chrome/120.0.6099.109",

# "Protocol-Version": "1.3",

# "webSocketDebuggerUrl": "ws://localhost:9224/devtools/..."

# }

### Porta 3008 - Dashboard Web (HTTP/WebSocket)

CHROME_FALLBACK_PORTS=9224,9223,9224

**Configuração**:

```bash
# Variável de ambiente
PORT=3008

    environment:
      - CHROME_WS_ENDPOINT=ws://host.docker.internal:9224
```

### Problema: Chrome não conecta (porta 9224)

**Componentes que usam**:

- **Express Server**: HTTP endpoints
- **Socket.io**: Real-time communication [ERROR] Tentativas em portas: [9224, 9223, 9224] - todas
  falharam
- **API REST**: `/api/health`, `/api/tasks`, `/api/queue`, etc.

# Verificar se CDP está acessível via proxy (container-facing)

curl http://localhost:9224/json/version

# Dashboard

http://localhost:3008

# 2. Iniciar Chrome com remote debugging

# Windows (usar porta container-facing canônica)

"C:\Program Files\Google\Chrome\Application\chrome.exe" \
 --remote-debugging-port=9224 \
 --user-data-dir="C:\chrome-automation-profile"

# Linux/Mac

google-chrome \
 --remote-debugging-port=9224 \
 --user-data-dir="~/chrome-automation-profile"

# 3. Verificar novamente (container-facing)

curl http://localhost:9224/json/version

-- `config.json` - DEBUG_PORT: http://localhost:9224

**Configuração**:

# Chrome multi-instance

# exemplos (evitar usar 9224 como padrão; 9224 é o canal container-facing canônico)

chrome --remote-debugging-port=9223 --user-data-dir="~/profile1" chrome --remote-debugging-port=9224
--user-data-dir="~/profile2"

# Windows

"C:\Program Files\Google\Chrome\Application\chrome.exe" \
 --remote-debugging-port=9224 \
 --user-data-dir="C:\chrome-automation-profile"

# Linux/Mac

google-chrome \
 --remote-debugging-port=9224 \
 --user-data-dir="~/chrome-automation-profile"

````

**Variáveis de ambiente**:
```bash
CHROME_REMOTE_DEBUGGING_PORT=9224  # Porta canônica container-facing (proxy)
CHROME_WS_ENDPOINT=ws://localhost:9224  # Endpoint container-facing (proxy)
DEBUG_PORT=http://localhost:9224  # Em config.json (container-facing)
````

**Estratégia Multi-Port** (Browser Pool):

```javascript
// ConnectionOrchestrator tenta múltiplas portas (proxy-first)
const DEFAULT_PORTS = [9224, 9223, 9224];

// Suporta múltiplas instâncias Chrome
chrome1: --remote-debugging-port=9224
chrome2: --remote-debugging-port=9223
chrome3: --remote-debugging-port=9224
```

**Como verificar**:

```bash
# Verificar se CDP está acessível via proxy (container-facing)
curl http://localhost:9224/json/version

# Resposta esperada:
# {
#   "Browser": "Chrome/120.0.6099.109",
#   "Protocol-Version": "1.3",
#   "webSocketDebuggerUrl": "ws://localhost:9224/devtools/..."
# }
```

---

### Porta 9229 - Node.js Inspector (Desenvolvimento)

**Propósito**: Debugging com Chrome DevTools

**Configuração**:

```yaml
# docker-compose.dev.yml
environment:
  - NODE_OPTIONS=--inspect=0.0.0.0:9229
ports:
  - '9229:9229'
```

**Como usar**:

```bash
# 1. Iniciar em modo dev
npm run dev
# ou
docker-compose -f docker-compose.dev.yml up

# 2. Abrir Chrome DevTools
chrome://inspect

# 3. Clicar em "inspect" no target remoto
```

⚠️ **Atenção**: Porta 9229 **NÃO** deve ser exposta em produção (risco de segurança).

---

## 🔄 Port Hunting Algorithm

### Como Funciona

Quando o servidor tenta iniciar na porta configurada (default: 3008) e ela está ocupada, o sistema
**automaticamente** tenta a próxima porta disponível.

**Algoritmo** (`src/server/engine/server.js`):

```javascript
function start(port) {
  return new Promise(resolve => {
    httpServer.listen(port, () => {
      log('INFO', `Servidor HTTP em: http://localhost:${port}`);
      resolve({ server: httpServer, port });
    });

    httpServer.on('error', e => {
      if (e.code === 'EADDRINUSE') {
        log('WARN', `Porta ${port} ocupada. Tentando ${port + 1}...`);
        httpServer.close();
        resolve(start(port + 1)); // Recursivo
      } else {
        log('FATAL', `Falha crítica: ${e.message}`);
        process.exit(1);
      }
    });
  });
}
```

**Comportamento**:

```
Tentativa 1: 3008 → ❌ Ocupada
Tentativa 2: 3009 → ❌ Ocupada
Tentativa 3: 3010 → ✅ Disponível
Servidor iniciado em: http://localhost:3010
```

### Vantagens

✅ **Zero downtime**: Nunca falha por conflito de porta ✅ **Desenvolvimento**: Múltiplos devs podem
rodar simultaneamente ✅ **Automático**: Sem intervenção manual

### Desvantagens

⚠️ **Sem limite**: Pode escalar até porta 65535 (arriscado) ⚠️ **Docker port mapping**: Quebra se
container mapeia `3008:3008` mas app sobe em `3009` ⚠️ **Logs inconsistentes**: "Porta 3008 ocupada,
usando 3012" pode confundir operadores

### Configuração

**Habilitar/desabilitar port hunting**:

```bash
# .env
ENABLE_PORT_HUNTING=true  # Habilita (padrão)
ENABLE_PORT_HUNTING=false # Desabilita (recomendado em produção Docker)
```

**Limitar tentativas**:

```bash
# .env
MAX_PORT_ATTEMPTS=5  # Tenta no máximo 5 portas (3008-3012)
```

**Implementação futura** (recomendado):

```javascript
function start(port, maxAttempts = 5) {
  if (maxAttempts <= 0) {
    throw new Error('PORT_EXHAUSTED: Todas as portas ocupadas');
  }

  // ... lógica de bind ...

  if (error.code === 'EADDRINUSE') {
    if (process.env.ENABLE_PORT_HUNTING !== 'false') {
      return start(port + 1, maxAttempts - 1);
    } else {
      throw new Error(`Porta ${port} ocupada e port hunting desabilitado`);
    }
  }
}
```

---

## ⚙️ Configuração de Ambiente

### Variáveis de Networking

```bash
# =============================================================================
# NETWORKING & PORTS
# =============================================================================

# Server URL (base URL for API/Dashboard)
SERVER_URL=http://localhost:3008

# Health check endpoint
HEALTH_CHECK_URL=http://localhost:3008/api/health

# Port hunting configuration
ENABLE_PORT_HUNTING=true
MAX_PORT_ATTEMPTS=5

# Chrome connection configuration
CHROME_CONNECTION_TIMEOUT=5000
CHROME_CONNECTION_RETRIES=3
CHROME_FALLBACK_PORTS=9224,9223,9224
```

### Validação de Porta

```bash
# Executar validação
npm run test:config

# Valida:
# - PORT é número entre 1024-65535
# - Não conflita com portas reservadas (80, 443, 5432, 3306)
# - CHROME_REMOTE_DEBUGGING_PORT é válido
```

---

## 🐳 Docker Port Mapping

### Produção (docker-compose.yml)

```yaml
services:
  agent:
    ports:
      - '3008:3008' # Dashboard/API
    environment:
      - PORT=3008
      - ENABLE_PORT_HUNTING=false # Desabilitar em container
```

**Por quê desabilitar port hunting em Docker?**

- Container mapeia `3008:3008` (host:container)
- Se app escalar para 3009, host continua redirecionando 3008 → 3008
- Conexões falham (porta 3009 não está mapeada)

### Desenvolvimento (docker-compose.dev.yml)

```yaml
services:
  agent-dev:
    ports:
      - '3008:3008' # Dashboard
      - '9229:9229' # Node Inspector
    environment:
      - NODE_OPTIONS=--inspect=0.0.0.0:9229
      - ENABLE_PORT_HUNTING=true # OK em dev
```

### Chrome Connection via host.docker.internal

```yaml
services:
  agent:
    environment:
      - CHROME_WS_ENDPOINT=ws://host.docker.internal:9224
    extra_hosts:
      - 'host.docker.internal:host-gateway' # Linux only
```

**Docker Desktop (Windows/Mac)**: `host.docker.internal` funciona automaticamente **Linux**:
Adicionar `extra_hosts` ou usar IP do host (`192.168.x.x`)

---

## 🔍 Troubleshooting

### Problema: Porta 3008 ocupada

**Sintomas**:

```
[WARN] Porta 3008 ocupada. Tentando 3009...
[WARN] Porta 3009 ocupada. Tentando 3010...
[INFO] Servidor HTTP em: http://localhost:3010
```

**Solução A - Liberar porta 3008**:

```bash
# Linux/Mac
lsof -ti:3008 | xargs kill -9

# Windows
netstat -ano | findstr :3008
taskkill /PID <PID> /F
```

**Solução B - Aceitar porta alternativa**:

```bash
# Port hunting vai encontrar próxima disponível
# Servidor sobe em 3010, por exemplo
curl http://localhost:3010/api/health
```

**Solução C - Configurar porta diferente**:

```bash
PORT=4000 npm start
# Servidor sobe em 4000
```

---

### Problema: Chrome não conecta (porta 9224)

**Sintomas**:

```
[ERROR] CHROME_UNAVAILABLE: Não foi possível conectar ao Chrome
[ERROR] Tentativas em portas: [9224, 9223, 9224] - todas falharam
```

**Diagnóstico**:

```bash
# Verificar se Chrome está rodando com CDP
curl http://localhost:9224/json/version

# Se falhar, Chrome não está com --remote-debugging-port
```

**Solução**:

```bash
# 1. FECHAR todos os Chromes abertos
pkill chrome  # Linux/Mac
taskkill /IM chrome.exe /F  # Windows

# 2. Iniciar Chrome com remote debugging
# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" \
  --remote-debugging-port=9224 \
  --user-data-dir="C:\chrome-automation-profile"

# Linux/Mac
google-chrome \
  --remote-debugging-port=9224 \
  --user-data-dir="~/chrome-automation-profile"

# 3. Verificar novamente
curl http://localhost:9224/json/version
```

---

### Problema: Docker não acessa Dashboard

**Sintomas**:

```bash
curl http://localhost:3008
# curl: (7) Failed to connect to localhost port 3008: Connection refused
```

**Diagnóstico**:

```bash
# Verificar se container está rodando
docker ps | grep chatgpt-agent

# Verificar logs
docker logs chatgpt-agent

# Verificar port mapping
docker port chatgpt-agent
# Deve mostrar: 3008/tcp -> 0.0.0.0:3008
```

**Solução A - Port mapping incorreto**:

```yaml
# docker-compose.yml
ports:
  - '3008:3008' # ✅ Correto (host:container)
  # - "3008:3000"  # ❌ Errado
```

**Solução B - Firewall bloqueando**:

```bash
# Linux
sudo ufw allow 3008

# Windows
# Firewall do Windows → Regras de entrada → Nova regra → Porta 3008
```

---

### Problema: Port hunting escalou demais

**Sintomas**:

```
[WARN] Porta 3008 ocupada. Tentando 3009...
[WARN] Porta 3009 ocupada. Tentando 3010...
...
[WARN] Porta 3025 ocupada. Tentando 3026...
[INFO] Servidor HTTP em: http://localhost:3026
```

**Solução - Configurar limite**:

```bash
# .env
MAX_PORT_ATTEMPTS=5  # Tenta apenas 3008-3012
```

**Resultado**:

```
[WARN] Porta 3008 ocupada. Tentando 3009... (4 tentativas restantes)
[WARN] Porta 3009 ocupada. Tentando 3010... (3 tentativas restantes)
...
[FATAL] PORT_EXHAUSTED: Todas as portas ocupadas após 5 tentativas
```

---

## 📚 Referências

### Documentos Relacionados

- [CROSS_CUTTING_PORTS_AUDIT.md](AUDITORIAS/CROSS_CUTTING_PORTS_AUDIT.md) - Auditoria completa de
  portas
- [DOCKER_SETUP.md](../DOCKER_SETUP.md) - Configuração Docker
- [CHROME_EXTERNAL_SETUP.md](../CHROME_EXTERNAL_SETUP.md) - Setup Chrome externo
- [QUICK_START.md](../QUICK_START.md) - Guia rápido

### Arquivos de Configuração

- `ecosystem.config.js` - PM2 config (PORT: 3008)
- `docker-compose.yml` - Port mapping (3008:3008)
- `.env.example` - Template de variáveis
- `config.json` - DEBUG_PORT: http://localhost:9224

### Código-fonte

- `src/server/engine/server.js` - Port hunting implementation
- `src/infra/ConnectionOrchestrator.js` - Chrome multi-port strategy
- `src/main.js` - Server initialization

---

## 🎯 Best Practices

### ✅ Desenvolvimento Local

```bash
# Use port hunting
ENABLE_PORT_HUNTING=true

# Múltiplas instâncias? Use portas diferentes
PORT=3008 npm run dev  # Dev 1
PORT=4008 npm run dev  # Dev 2

# Chrome multi-instance
chrome --remote-debugging-port=9224 --user-data-dir="~/profile1"
chrome --remote-debugging-port=9223 --user-data-dir="~/profile2"
```

### ✅ Docker Development

```bash
# Desabilitar port hunting em containers
ENABLE_PORT_HUNTING=false

# Sempre especificar PORT explicitamente
PORT=3008

# Chrome via host.docker.internal
CHROME_WS_ENDPOINT=ws://host.docker.internal:9224
```

### ✅ Produção

```bash
# Porta fixa, sem port hunting
PORT=3008
ENABLE_PORT_HUNTING=false

# Health check endpoint
HEALTH_CHECK_URL=http://localhost:3008/api/health

# Limite de tentativas (se habilitar port hunting)
MAX_PORT_ATTEMPTS=3

# Chrome connection resilience
CHROME_CONNECTION_TIMEOUT=5000
CHROME_CONNECTION_RETRIES=3
```

### ❌ Anti-patterns

```bash
# ❌ Porta 3000 (inconsistente com sistema)
PORT=3000

# ❌ Port hunting sem limite em produção
ENABLE_PORT_HUNTING=true
# MAX_PORT_ATTEMPTS=  # Sem limite!

# ❌ Hardcoded URLs em testes
const SERVER_URL = 'http://localhost:3000';  # Usar env var!

# ❌ Expor Node Inspector em produção
# docker-compose.yml (PRODUÇÃO)
ports:
  - "9229:9229"  # ❌ RISCO DE SEGURANÇA!
```

---

**Última atualização**: 2026-01-21 **Versão**: 1.0 **Manutenção**: Atualizar quando mudanças de
portas forem feitas
