> **Status**: Especializado **Não é baseline principal**: use [ARCHITECTURE.md](../ARCHITECTURE.md)
> como fonte oficial. **Quando consultar**: apenas para aprofundamento deste recorte.

# Port Architecture Analysis & Mapping

**Data**: 2 de Fevereiro de 2026 **Status**: ANÁLISE COMPLETA + CORREÇÕES APLICADAS **Contexto**:
Auditoria de portas configuradas no `.devcontainer/devcontainer.json` vs uso real

> **📝 Update (2026-02-07)**: Sistema de port-manager mencionado em outras docs foi removido (código
> morto). Sistema atual usa **port hunting nativo** em `src/main.js`.

---

## 📊 QUICK REFERENCE (Portas Ativas)

```
┌─────────────────────────────────────────────────────────────┐
│ PORTA 3008 (dashboard-web)                                  │
│ • Processo: dashboard-web (PM2)                             │
│ • Função: Dashboard + REST API + Socket.io                  │
│ • Endpoints: 50+ REST endpoints + Socket.io events          │
│ • Browser: ANY (Chrome, Firefox, Edge, Safari)              │
│ • Acesso: http://localhost:3008                             │
├─────────────────────────────────────────────────────────────┤
│ PORTA 9224 (chrome-proxy)                                   │
│ • Processo: chrome-proxy (PM2)                              │
│ • Função: Proxy transparente Container → Windows            │
│ • Fluxo: Puppeteer → 9224 (proxy) → 9225 (Chrome)          │
│ • Acesso: localhost:9224 (container only)                   │
├─────────────────────────────────────────────────────────────┤
│ PORTA 9225 (chrome.exe)                                     │
│ • Processo: chrome.exe (Windows)                            │
│ • Função: Chrome DevTools Protocol (CDP)                    │
│ • Inicia: START-CHROME-SIMPLE.bat                           │
│ • Acesso: Via proxy 9224 (NUNCA direto)                     │
├─────────────────────────────────────────────────────────────┤
│ PORTA 9229 (debug agente-gpt)                               │
│ • Processo: agente-gpt (PM2, opt-in)                        │
│ • Função: Node.js --inspect                                 │
│ • Acesso: chrome://inspect ou VSCode debugger               │
├─────────────────────────────────────────────────────────────┤
│ PORTA 9230 (debug dashboard-web)                            │
│ • Processo: dashboard-web (PM2, opt-in)                     │
│ • Função: Node.js --inspect                                 │
│ • Acesso: chrome://inspect ou VSCode debugger               │
└─────────────────────────────────────────────────────────────┘
```

## 1. TOPOLOGIA FÍSICA (3 Camadas)

```
┌─────────────────────────────────────────────────────────────────┐
│ WINDOWS HOST (Máquina Física)                                   │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────┐    │
│ │ Chrome REAL (Processo Nativo Windows)                   │    │
│ │ • Inicia: START-CHROME-SIMPLE.bat                       │    │
│ │ • Bind: 0.0.0.0:9225 --remote-debugging-port=9225       │    │
│ │ • Protocolo: Chrome DevTools Protocol (CDP)             │    │
│ │ • Propósito: LLM Automation (ChatGPT, Gemini)          │    │
│ │ • Gerenciado por: Windows Host (ONTOLOGIA)              │    │
│ └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────┐    │
│ │ WSL2 Virtual Machine (Linux Kernel)                     │    │
│ │                                                         │    │
│ │ ┌─────────────────────────────────────────────────────┐ │    │
│ │ │ DOCKER DESKTOP (Container Engine)                   │ │    │
│ │ │                                                     │ │    │
│ │ │ ┌─────────────────────────────────────────────────┐ │ │    │
│ │ │ │ DEVCONTAINER (Node.js Runtime)                 │ │ │    │
│ │ │ │                                                │ │ │    │
│ │ │ │ PM2 (Process Manager - 3 processos):          │ │ │    │
│ │ │ │                                                │ │ │    │
│ │ │ │ ┌────────────────────────────────────────┐    │ │ │    │
│ │ │ │ │ 1. agente-gpt (Main Process)          │    │ │ │    │
│ │ │ │ │    • Script: index.js                 │    │ │ │    │
│ │ │ │ │    • Função: Kernel + Drivers + NERV  │    │ │ │    │
│ │ │ │ │    • Porta: NENHUMA (IPC via NERV)    │    │ │ │    │
│ │ │ │ │    • Depende de: Chrome Proxy (9224)  │    │ │ │    │
│ │ │ │ └────────────────────────────────────────┘    │ │ │    │
│ │ │ │                                                │ │ │    │
│ │ │ │ ┌────────────────────────────────────────┐    │ │ │    │
│ │ │ │ │ 2. dashboard-web (Server Process)     │    │ │ │    │
│ │ │ │ │    • Script: src/server/main.js       │    │ │ │    │
│ │ │ │ │    • Função: HTTP + Socket.io + API   │    │ │ │    │
│ │ │ │ │    • Porta: 3008 (HTTP + WS)          │    │ │ │    │
│ │ │ │ │    • Depende de: NADA (autônomo)      │    │ │ │    │
│ │ │ │ │    • Acessível: ANY BROWSER           │    │ │ │    │
│ │ │ │ └────────────────────────────────────────┘    │ │ │    │
│ │ │ │                                                │ │ │    │
│ │ │ │ ┌────────────────────────────────────────┐    │ │ │    │
│ │ │ │ │ 3. chrome-proxy (Proxy Service)       │    │ │ │    │
│ │ │ │ │    • Script: chrome-proxy-service.js  │    │ │ │    │
│ │ │ │ │    • Função: HTTP + WebSocket Proxy   │    │ │ │    │
│ │ │ │ │    • Porta IN: 9224 (container)       │    │ │ │    │
│ │ │ │ │    • Porta OUT: 9225 (host Windows)   │    │ │ │    │
│ │ │ │ │    • Bridge: localhost → host.docker  │    │ │ │    │
│ │ │ │ └────────────────────────────────────────┘    │ │ │    │
│ │ │ │                                                │ │ │    │
│ │ │ └─────────────────────────────────────────────────┘ │ │    │
│ │ └─────────────────────────────────────────────────────┘ │    │
│ └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. ANÁLISE DE PORTAS (Estado Atual vs Real)

### ❌ Portas Configuradas no `.devcontainer/devcontainer.json`

```json
"forwardPorts": [
    3000,  // "Dashboard Principal — Mission Control"
    3001,  // "Dashboard DEV / Playground"
    3002,  // "Dashboard Secundário — Operações"
    3008,  // "API / Socket.io / Execução"
    9100,  // "Métricas / Healthcheck"
    9229,  // "Node.js Debug — Primary"
    9230   // "Node.js Debug — Fallback"
]
```

### ✅ Portas Realmente Usadas

| Porta | Processo           | Tipo      | Função Real                               | Status      |
| ----- | ------------------ | --------- | ----------------------------------------- | ----------- |
| 3008  | dashboard-web      | HTTP + WS | Dashboard Principal (Mission Control)     | ✅ CORRETO  |
| 9224  | chrome-proxy       | HTTP + WS | Proxy Container → Chrome Windows          | ❌ AUSENTE  |
| 9225  | Chrome (Windows)   | CDP (WS)  | Chrome DevTools Protocol (LLM Automation) | ✅ IGNORADO |
| 9229  | agente-gpt (opt)   | Debugger  | Node.js --inspect (desenvolvimento)       | ✅ CORRETO  |
| 9230  | dashboard-web(opt) | Debugger  | Node.js --inspect (fallback)              | ✅ CORRETO  |

### ❌ Portas Fantasmas (Configuradas mas NÃO usadas)

| Porta | Descrição Declarada                     | Problema                        |
| ----- | --------------------------------------- | ------------------------------- |
| 3000  | "Dashboard Principal — Mission Control" | NÃO existe, o real é **3008**   |
| 3001  | "Dashboard DEV / Playground"            | NÃO existe, nenhum processo usa |
| 3002  | "Dashboard Secundário — Operações"      | NÃO existe, nenhum processo usa |
| 9100  | "Métricas / Healthcheck"                | NÃO existe, nenhum processo usa |

---

## 3. PM2 ARCHITECTURE (3 Processos)

### Processo 1: `agente-gpt` (Main Process)

- **Script**: `index.js` → `src/main.js`
- **Função**: Kernel + Drivers + Orchestration + NERV
- **Porta**: **NENHUMA** (comunicação 100% via NERV IPC)
- **Dependências**:
  - Chrome Proxy (`localhost:9224`)
  - NERV Event Bus (memória)
- **Browser**: Chrome Windows (via Puppeteer)

### Processo 2: `dashboard-web` (Server Process)

- **Script**: `src/server/main.js`
- **Função**: HTTP Server + Socket.io + API REST + Telemetry
- **Porta**: `3008` (HTTP + WebSocket)
- **Configuração**:
  ```javascript
  // ecosystem.config.cjs
  env: {
      PORT: 3008,
      SERVER_AUTHORITY: 'standalone'
  }
  ```
- **Código Real**:
  ```javascript
  // src/server/main.js:179
  const basePort = process.env.SERVER_PORT || process.env.PORT || CONFIG.SERVER_PORT || 3008;
  ```
- **Dependências**: ZERO (processo autônomo)
- **Browser**: ANY (Chrome, Firefox, Edge, Safari)

#### Endpoints REST API (porta 3008)

**Health & Monitoring**:

- `GET /health` - Health check rápido
- `GET /api/health` - Health check completo
- `GET /api/health/chrome` - Status do Chrome/Puppeteer
- `GET /api/health/pm2` - Status dos processos PM2
- `GET /api/health/kernel` - Status do Kernel
- `GET /api/health/disk` - Status de disco
- `GET /api/metrics` - Métricas do sistema

**Tasks**:

- `GET /api/tasks` - Listar tasks
- `GET /api/tasks/:id` - Detalhes de task
- `POST /api/tasks` - Criar task
- `PATCH /api/tasks/:id` - Atualizar task
- `DELETE /api/tasks/:id` - Deletar task

**Missions**:

- `POST /api/missions` - Criar missão
- `GET /api/missions` - Listar missões
- `GET /api/missions/:id` - Detalhes de missão
- `GET /api/missions/:id/progress` - Progresso de missão
- `POST /api/missions/:id/execute` - Executar missão
- `POST /api/missions/:id/pause` - Pausar missão
- `POST /api/missions/:id/resume` - Retomar missão
- `POST /api/missions/:id/feedback` - Feedback de missão
- `DELETE /api/missions/:id` - Deletar missão

**System**:

- `GET /api/system/status` - Status do sistema
- `GET /api/system/logs` - Logs do sistema
- `POST /api/system/restart` - Reiniciar sistema

**Dashboard**:

- `GET /dashboard` - Dashboard HTML
- `GET /dashboard/system/health` - Health do sistema
- `GET /dashboard/bridge/metrics` - Métricas da bridge

**DNA (Configuration)**:

- `GET /api/dna` - Configuração do sistema
- `PATCH /api/dna` - Atualizar configuração

### Processo 3: `chrome-proxy` (Proxy Service)

- **Script**: `scripts/chrome-proxy-service.js`
- **Função**: Transparent Proxy (HTTP + WebSocket)
- **Portas**:
  - **IN (container)**: `9224` (bind `0.0.0.0`)
  - **OUT (host)**: `9225` (via `host.docker.internal`)
- **Configuração**:
  ```javascript
  // ecosystem.config.cjs
  env: {
      CHROME_HOST: 'host.docker.internal',  // Windows Host
      CHROME_PORT: '9225',                  // Chrome real
      CHROME_PROXY_PORT: '9224'             // Proxy local
  }
  ```
- **Funcionamento**:
  ```
  Puppeteer → localhost:9224 → Proxy → host.docker.internal:9225 → Chrome
  ```

---

## 4. FLUXO DE DADOS (Arquitetura de Comunicação)

### 4.1 Dashboard (Human Interface)

```
Usuário (Browser ANY) → http://localhost:3008 → DevContainer (dashboard-web)
                                                      ↓
                                                 Socket.io
                                                      ↓
                                                   NERV IPC
                                                      ↓
                                            agente-gpt (kernel)
```

**Características**:

- ✅ Browser-agnostic (Chrome, Firefox, Edge, Safari)
- ✅ ZERO dependência de Puppeteer
- ✅ ZERO dependência de Chrome Windows
- ✅ Pode funcionar mesmo sem Chrome externo

**REST API Endpoints (50+)**:

| Categoria     | Endpoints                              | Método                |
| ------------- | -------------------------------------- | --------------------- |
| **Health**    | `/health`, `/api/health/*`             | GET                   |
| **Tasks**     | `/api/tasks`, `/api/tasks/:id`         | GET/POST/PATCH/DELETE |
| **Missions**  | `/api/missions`, `/api/missions/:id/*` | GET/POST/PATCH/DELETE |
| **System**    | `/api/system/*`                        | GET/POST              |
| **Dashboard** | `/dashboard`, `/dashboard/*`           | GET                   |
| **Config**    | `/api/dna`                             | GET/PATCH             |

**Socket.io Events (Real-time)**:

| Event              | Direction       | Payload                       | Descrição             |
| ------------------ | --------------- | ----------------------------- | --------------------- |
| `task:created`     | Server → Client | `{id, status, ...}`           | Nova task criada      |
| `task:updated`     | Server → Client | `{id, changes}`               | Task atualizada       |
| `task:completed`   | Server → Client | `{id, result}`                | Task concluída        |
| `mission:progress` | Server → Client | `{id, progress, currentStep}` | Progresso de missão   |
| `system:status`    | Server → Client | `{cpu, memory, processes}`    | Status do sistema     |
| `nerv:event`       | Server → Client | `{type, payload}`             | Evento NERV propagado |

### 4.2 LLM Automation (Machine Control)

```
agente-gpt (Puppeteer) → localhost:9224 → chrome-proxy → host.docker.internal:9225 → Chrome (Windows)
```

**Características**:

- ✅ Depende de Chrome Windows (porta 9225)
- ✅ Usa Puppeteer (mode: connect)
- ✅ Atravessa proxy transparente (9224)
- ✅ Nunca acessa 9225 diretamente

---

## 5. PM2 WEB DASHBOARD (9615)

### Status Atual

PM2 possui um **Dashboard Web opcional** na porta padrão **9615**:

```bash
# Ativar PM2 Web Dashboard
pm2 web

# Resultado:
# Launching web interface on port 9615
# http://localhost:9615
```

### Questões

1. **Este dashboard está ativo?**
   - ❓ **NÃO está configurado em `ecosystem.config.cjs`**
   - ❓ **NÃO está em `forwardPorts` do devcontainer**

2. **É necessário?**
   - ❌ **NÃO** - Nosso dashboard-web (3008) já fornece interface
   - ✅ **OPCIONAL** - Útil apenas para debug PM2 interno

3. **Recomendação**:
   - **NÃO ativar por padrão** (overhead desnecessário)
   - **Documentar como opt-in** se necessário

---

## 6. CORREÇÕES NECESSÁRIAS

### 6.1 `.devcontainer/devcontainer.json`

#### Problema 1: Porta 3008 está correta, mas descrição confusa

```json
// ATUAL (CONFUSO):
"3000": {
    "label": "Dashboard Principal — Mission Control",
    "onAutoForward": "notify",
    "protocol": "http"
},
"3008": {
    "label": "API / Socket.io / Execução",
    "onAutoForward": "notify",
    "protocol": "http"
}
```

**CORREÇÃO**:

```json
// CORRETO:
"3008": {
    "label": "Dashboard Principal — Mission Control (HTTP + Socket.io + API)",
    "onAutoForward": "notify",
    "protocol": "http"
}
```

#### Problema 2: Portas fantasmas (3000, 3001, 3002, 9100)

```json
// REMOVER:
3000,  // NÃO existe
3001,  // NÃO existe
3002,  // NÃO existe
9100,  // NÃO existe
```

#### Problema 3: Porta 9224 (Chrome Proxy) ausente

```json
// ADICIONAR (com documentação clara):
"9224": {
    "label": "Chrome Proxy Service (Container → Windows)",
    "onAutoForward": "ignore",  // NÃO é interface humana
    "protocol": "http"
}
```

### 6.2 Documentação de Portas

#### Estrutura Proposta

```json
"forwardPorts": [
    // ================== UI HUMANA =============================
    3008,  // Dashboard Principal — Mission Control (HTTP + Socket.io + API)

    // ================== INFRAESTRUTURA ========================
    9224,  // Chrome Proxy Service (Container → Windows Host)

    // ================== DEBUG =================================
    9229,  // Node.js Debug — Primary (--inspect)
    9230   // Node.js Debug — Fallback (--inspect)
],

"portsAttributes": {
    "*": {
        "onAutoForward": "ignore"  // Deny by default
    },

    // ================== UI HUMANA =============================
    "3008": {
        "label": "Dashboard Principal — Mission Control (HTTP + Socket.io + API)",
        "onAutoForward": "notify",
        "protocol": "http",
        "// CLAREZA": [
            "Processo: dashboard-web (PM2)",
            "Script: src/server/main.js",
            "Browser: ANY (Chrome, Firefox, Edge, Safari)",
            "Dependências: ZERO (autônomo)",
            "Propósito: Interface humana de controle"
        ]
    },

    // ================== INFRAESTRUTURA ========================
    "9224": {
        "label": "Chrome Proxy Service (Container → Windows Host)",
        "onAutoForward": "ignore",
        "protocol": "http",
        "// CLAREZA": [
            "Processo: chrome-proxy (PM2)",
            "Script: scripts/chrome-proxy-service.js",
            "Função: Proxy transparente HTTP + WebSocket",
            "Fluxo: Puppeteer → localhost:9224 → host.docker.internal:9225 → Chrome Windows",
            "NÃO é UI humana - é fronteira arquitetural"
        ]
    },

    // Chrome Real (Windows Host) - NÃO forwarded por design
    "9225": {
        "label": "Chrome Real (Windows Host) — CDP",
        "onAutoForward": "ignore",
        "// CLAREZA": [
            "Processo: chrome.exe (Windows)",
            "Inicia: START-CHROME-SIMPLE.bat",
            "Função: Chrome DevTools Protocol (CDP)",
            "Bind: 0.0.0.0:9225 (Windows Host)",
            "Acesso: Via proxy 9224 (NUNCA direto)",
            "Ontologia: Windows gerencia, container conecta"
        ]
    },

    // ================== DEBUG =================================
    "9229": {
        "label": "Node.js Debug — Primary (agente-gpt)",
        "onAutoForward": "silent"
    },
    "9230": {
        "label": "Node.js Debug — Fallback (dashboard-web)",
        "onAutoForward": "silent"
    }
}
```

---

## 7. CLAREZA: WINDOWS vs WSL vs CONTAINER

### Conceitos

| Camada        | O Que É                               | Responsabilidade                        |
| ------------- | ------------------------------------- | --------------------------------------- |
| **WINDOWS**   | Máquina física, OS Windows 10/11      | Chrome real (9225), ferramentas nativas |
| **WSL2**      | VM Linux rodando no Hyper-V (Windows) | Docker Engine, kernel Linux             |
| **CONTAINER** | Namespace Linux (DevContainer)        | Node.js, PM2, Puppeteer, código         |

### Mapeamento de Processos

| Processo      | Roda Onde? | Porta   | Acessado De Onde?                       |
| ------------- | ---------- | ------- | --------------------------------------- |
| chrome.exe    | WINDOWS    | 9225    | Container (via host.docker.internal)    |
| chrome-proxy  | CONTAINER  | 9224    | Container (localhost)                   |
| agente-gpt    | CONTAINER  | NENHUMA | N/A (IPC)                               |
| dashboard-web | CONTAINER  | 3008    | Windows (localhost:3008 via forwarding) |

### Networking

```
┌───────────────────────────────────────────────────────────┐
│ WINDOWS HOST (192.168.0.x)                                │
│                                                           │
│ Usuário Browser → localhost:3008 ──┐                      │
│                                    │ (port forwarding)    │
│ Chrome 9225 ← host.docker.internal │                      │
│                                    │                      │
│ ┌──────────────────────────────────┼─────────────────┐   │
│ │ WSL2 (172.x.x.x)                 │                 │   │
│ │                                  │                 │   │
│ │ ┌────────────────────────────────▼───────────────┐ │   │
│ │ │ CONTAINER (172.17.0.x)                        │ │   │
│ │ │                                               │ │   │
│ │ │ dashboard-web:3008 (bind 0.0.0.0) ────────────┘ │   │
│ │ │                                                 │   │
│ │ │ chrome-proxy:9224 → host.docker.internal:9225  │   │
│ │ │                                                 │   │
│ │ │ Puppeteer → localhost:9224                      │   │
│ │ └─────────────────────────────────────────────────┘   │
│ └───────────────────────────────────────────────────────┘
└───────────────────────────────────────────────────────────┘
```

---

## 8. CHROME DUAL PURPOSE (Revisão)

### Uso 1: Dashboard (Porta 3008)

```
Humano → Chrome Windows (browser comum)
            ↓
    http://localhost:3008
            ↓
    dashboard-web (container)
```

**Características**:

- ANY browser funciona (Chrome, Firefox, Edge, Safari)
- ZERO dependência de Puppeteer
- ZERO dependência de Chrome Windows CDP (porta 9225)
- Processo autônomo (dashboard-web)

### Uso 2: LLM Automation (Porta 9225)

```
agente-gpt (container) → Puppeteer
            ↓
    localhost:9224 (chrome-proxy)
            ↓
    host.docker.internal:9225
            ↓
    Chrome Windows (CDP)
            ↓
    ChatGPT/Gemini pages
```

**Características**:

- Puppeteer required
- Chrome Windows (CDP) required
- Proxy transparente (9224)
- Processo autônomo (agente-gpt)

---

## 9. PM2 CLAREZA (Organizador Geral)

### O Que É PM2?

**PM2** é um **Process Manager** para Node.js que:

- ✅ Inicia/para/reinicia processos
- ✅ Gerencia logs
- ✅ Monitora recursos (CPU, memória)
- ✅ Mantém processos alive (auto-restart em crash)

### Onde Roda?

```
CONTAINER (DevContainer)
└── PM2 (daemon)
    ├── agente-gpt (processo 1)
    ├── dashboard-web (processo 2)
    └── chrome-proxy (processo 3)
```

### Como Gerenciar?

```bash
# Status de todos os processos
pm2 status

# Logs em tempo real
pm2 logs

# Parar todos
pm2 stop all

# Reiniciar todos
pm2 restart all

# Dashboard PM2 (opcional, porta 9615)
pm2 web # NÃO ativo por padrão
```

### PM2 Web Dashboard (9615)

**Status**: ❌ **NÃO configurado** (e NÃO necessário)

**Razão**: Nosso `dashboard-web` (3008) já fornece interface completa.

**Quando usar**: Apenas para debug PM2 interno.

---

## 10. RESUMO EXECUTIVO

### Portas Reais (Validado via Código)

| Porta | Processo      | Função                           | Endpoints/Conexões       | Interface            |
| ----- | ------------- | -------------------------------- | ------------------------ | -------------------- |
| 3008  | dashboard-web | Dashboard + REST API + Socket.io | 50+ endpoints REST       | Humano (ANY browser) |
| 9224  | chrome-proxy  | Proxy Container → Windows        | HTTP + WebSocket proxy   | Máquina (Puppeteer)  |
| 9225  | chrome.exe    | Chrome CDP (LLM Automation)      | Chrome DevTools Protocol | Máquina (Puppeteer)  |
| 9229  | agente-gpt    | Node.js Debug (opt-in)           | V8 Inspector Protocol    | Debugger             |
| 9230  | dashboard-web | Node.js Debug (opt-in)           | V8 Inspector Protocol    | Debugger             |

### Detalhamento da Porta 3008 (dashboard-web)

**50+ Endpoints REST API**:

| Categoria     | Endpoints | Função                                            |
| ------------- | --------- | ------------------------------------------------- |
| Health        | 7         | Health checks (server, chrome, pm2, kernel, disk) |
| Tasks         | 5         | CRUD de tasks + execução                          |
| Missions      | 9         | Orquestração de missões complexas                 |
| System        | 3         | Status, logs, restart                             |
| Dashboard     | 3         | UI HTML + health + métricas                       |
| Configuration | 2         | DNA (read/update config)                          |
| WebSocket     | N/A       | Socket.io real-time updates                       |

**Total**: ~50 endpoints + Socket.io events

### Ações Necessárias

1. ✅ **Remover** portas fantasmas (3000, 3001, 3002, 9100)
2. ✅ **Adicionar** porta 9224 (chrome-proxy) com documentação clara
3. ✅ **Corrigir** descrição da porta 3008 (Dashboard Principal)
4. ✅ **Documentar** PM2 (organizador de processos, NÃO tem porta própria)
5. ✅ **Clarificar** Windows vs WSL vs Container em comentários

---

## 11. CHECKLIST DE VALIDAÇÃO

- [x] `.devcontainer/devcontainer.json` atualizado
- [x] Portas fantasmas removidas
- [x] Porta 9224 documentada
- [x] Descrição 3008 expandida (50+ endpoints)
- [x] Comentários Windows/WSL/Container adicionados
- [x] PM2 clarificado (processo manager, NÃO porta)
- [x] Topologia física documentada
- [x] Fluxo de dados documentado
- [x] REST API endpoints mapeados
- [x] Socket.io events documentados

---

## 12. COMO ACESSAR CADA PORTA

### Porta 3008 (Dashboard + API)

**Do Windows Host (desenvolvimento)**:

```bash
# Dashboard HTML
http://localhost:3008/dashboard

# Health check
curl http://localhost:3008/health

# API completa
curl http://localhost:3008/api/health
curl http://localhost:3008/api/tasks
curl http://localhost:3008/api/missions
```

**Socket.io (JavaScript)**:

```javascript
// Conectar ao servidor Socket.io
const socket = io('http://localhost:3008');

// Escutar eventos
socket.on('task:created', (data) => {
  console.log('Nova task:', data);
});

socket.on('mission:progress', (data) => {
  console.log('Progresso:', data);
});
```

### Porta 9224 (Chrome Proxy)

**Do Container (Puppeteer)**:

```javascript
// Puppeteer conecta automaticamente
const browser = await puppeteer.connect({
  browserWSEndpoint: 'http://localhost:9224',
});
```

**Health check manual**:

```bash
# Do container
curl http://localhost:9224/json/version

# Deve retornar informações do Chrome Windows
```

### Porta 9225 (Chrome Windows)

**Do Windows (validação)**:

```bash
# Verificar se Chrome está rodando
curl http://localhost:9225/json/version

# Listar páginas abertas
curl http://localhost:9225/json/list
```

**❌ NÃO acessar do container** (sempre usar proxy 9224)

### Portas 9229/9230 (Debug)

**VSCode (launch.json)**:

```json
{
  "type": "node",
  "request": "attach",
  "name": "Attach to agente-gpt",
  "port": 9229,
  "restart": true
}
```

**Chrome DevTools**:

```
chrome://inspect
→ Configure: localhost:9229
→ Inspect
```

---

**Versão**: 2.0 (Expandido com REST API + Socket.io) **Próximos Passos**: Testes de integração E2E
