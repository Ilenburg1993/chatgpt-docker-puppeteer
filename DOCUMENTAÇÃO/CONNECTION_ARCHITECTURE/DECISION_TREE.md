# Diagrama de Decisão: Arquitetura de Conexão

**Versão**: 3.0
**Propósito**: Árvore de decisões arquiteturais

---

## 🎯 Árvore de Decisão: Como Conectar ao Chrome?

```
┌─────────────────────────────────────────────────────────────────────┐
│  OBJETIVO: Executar código Puppeteer em Container Docker           │
│            + Controlar Chrome no Windows Host                       │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │ Onde o Chrome vai rodar?     │
              └───┬──────────────────────┬───┘
                  │                      │
         ┌────────▼─────────┐   ┌───────▼────────┐
         │ Dentro Container │   │  Windows Host  │
         └────────┬─────────┘   └───────┬────────┘
                  │                     │
                  ▼                     ▼
         ┌─────────────────┐   ┌─────────────────────┐
         │ Chrome Headless │   │  Chrome Full (GUI)  │
         └────────┬────────┘   └──────────┬──────────┘
                  │                       │
                  ▼                       ▼
         ┌─────────────────┐   ┌─────────────────────┐
         │ ❌ REJEITADO    │   │ ✅ ESCOLHIDO        │
         │                 │   │                     │
         │ Problemas:      │   │ Benefícios:         │
         │ • Anti-bot      │   │ • Não detectado     │
         │ • Sem GPU       │   │ • GPU acelerado     │
         │ • Fonts         │   │ • Extensões         │
         └─────────────────┘   └──────────┬──────────┘
                                          │
                                          ▼
                               ┌──────────────────────┐
                               │ Como conectar?       │
                               └───┬──────────────┬───┘
                                   │              │
                         ┌─────────▼────┐  ┌──────▼─────────┐
                         │ Direto       │  │ Via Proxy      │
                         │ (sem proxy)  │  │ (intermediário)│
                         └─────────┬────┘  └──────┬─────────┘
                                   │              │
                                   ▼              ▼
                         ┌──────────────┐  ┌──────────────┐
                         │ ❌ FALHA     │  │ ✅ FUNCIONA  │
                         │              │  │              │
                         │ Erro:        │  │ Resolve:     │
                         │ Host header  │  │ • Headers    │
                         │ não válido   │  │ • URLs       │
                         │              │  │ • Timeout    │
                         └──────────────┘  └──────┬───────┘
                                                  │
                                                  ▼
                                         ┌─────────────────┐
                                         │ Onde rodar      │
                                         │ o proxy?        │
                                         └────┬────────┬───┘
                                              │        │
                                    ┌─────────▼──┐  ┌─▼──────────┐
                                    │ Windows    │  │ Container  │
                                    └─────────┬──┘  └─┬──────────┘
                                              │       │
                                              ▼       ▼
                                    ┌──────────────┐ ┌──────────────┐
                                    │ ❌ COMPLEXO │ │ ✅ SIMPLES   │
                                    │            │ │              │
                                    │ • 2x PM2   │ │ • 1x PM2     │
                                    │ • 2x logs  │ │ • Logs unif. │
                                    │ • Deploy ++ │ │ • Deploy -   │
                                    └────────────┘ └──────┬───────┘
                                                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │ ARQUITETURA     │
                                                 │ FINAL           │
                                                 │                 │
                                                 │ Container:      │
                                                 │ • Puppeteer     │
                                                 │ • ChromeProxy   │
                                                 │                 │
                                                 │ Windows:        │
                                                 │ • Chrome GUI    │
                                                 │ • 0.0.0.0:9225  │
                                                 │                 │
                                                 │ Network:        │
                                                 │ • host.docker   │
                                                 │   .internal     │
                                                 └─────────────────┘
```

---

## 🔀 Matriz de Decisões

| Critério            | Chrome Container | Chrome Windows   | Decisão     |
| ------------------- | ---------------- | ---------------- | ----------- |
| **Anti-Bot**        | ❌ Detectado      | ✅ Não detectado  | Windows     |
| **Performance GPU** | ❌ Limitado       | ✅ Full           | Windows     |
| **Deploy**          | ✅ Simples        | ⚠️ Requer Windows | Windows     |
| **Manutenção**      | ✅ Fácil          | ⚠️ 2 ambientes    | Windows     |
| **Custo**           | ✅ Baixo (CPU)    | ⚠️ Alto (Windows) | Windows     |
| **Portabilidade**   | ✅ Alta           | ❌ Baixa          | Windows     |
| **Decisão Final**   | -                | ✅                | **Windows** |

| Critério           | Conexão Direta | Via Proxy    | Decisão   |
| ------------------ | -------------- | ------------ | --------- |
| **Host Header**    | ❌ Rejeitado    | ✅ Corrigido  | Proxy     |
| **URL Rewriting**  | ❌ Manual       | ✅ Automático | Proxy     |
| **Latência**       | ✅ ~1ms         | ⚠️ ~3ms       | Proxy     |
| **Complexidade**   | ✅ Baixa        | ⚠️ Média      | Proxy     |
| **Funcionalidade** | ❌ Quebrado     | ✅ Completo   | Proxy     |
| **Decisão Final**  | -              | ✅            | **Proxy** |

| Critério          | Proxy Windows | Proxy Container | Decisão       |
| ----------------- | ------------- | --------------- | ------------- |
| **Gerenciamento** | ❌ 2x PM2      | ✅ 1x PM2        | Container     |
| **Logs**          | ❌ Separados   | ✅ Unificados    | Container     |
| **Deploy**        | ❌ Complexo    | ✅ Simples       | Container     |
| **Latência**      | ✅ ~1ms        | ⚠️ ~2ms          | Container     |
| **Manutenção**    | ❌ 2 ambientes | ✅ 1 ambiente    | Container     |
| **Decisão Final** | -             | ✅               | **Container** |

---

## 🧭 Fluxograma: Debugging de Conexão

```
┌─────────────────────────┐
│ Puppeteer não conecta?  │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Chrome está rodando (Windows)?  │
└────┬──────────────────────┬─────┘
     │ NÃO                  │ SIM
     ▼                      ▼
┌─────────────────┐  ┌──────────────────────────┐
│ START-CHROME-   │  │ Chrome fez bind 0.0.0.0? │
│ SIMPLE.bat      │  └────┬───────────────┬─────┘
└─────────────────┘       │ NÃO           │ SIM
                          ▼               ▼
                  ┌─────────────────┐  ┌─────────────────────┐
                  │ Matar + restart │  │ Proxy rodando?      │
                  │ com flag certa  │  └────┬──────────┬─────┘
                  └─────────────────┘       │ NÃO      │ SIM
                                            ▼          ▼
                                  ┌─────────────────┐  ┌──────────────────┐
                                  │ Iniciar proxy   │  │ Testar endpoint  │
                                  │ (PM2 ou manual) │  │ /health          │
                                  └─────────────────┘  └────┬───────┬─────┘
                                                            │ FALHA │ OK
                                                            ▼       ▼
                                                  ┌─────────────┐  ┌────────────┐
                                                  │ Ver logs    │  │ Conectar   │
                                                  │ pm2 logs    │  │ Puppeteer  │
                                                  └─────────────┘  └────────────┘
                                                                         │
                                                                         ▼
                                                                   ┌──────────┐
                                                                   │ SUCESSO! │
                                                                   └──────────┘
```

---

## 🎬 Sequência de Startup Ideal

```
TEMPO    WINDOWS                CONTAINER              RESULTADO
────────────────────────────────────────────────────────────────────
T+0s     START-CHROME-          -                      Chrome inicia
         SIMPLE.bat

T+5s     Chrome GUI aberto      -                      Bind 0.0.0.0:9225
         (verificar taskbar)

T+10s    -                      Validar conectividade  curl OK
                                bash wsl-chrome-
                                integration.sh validate

T+15s    -                      Iniciar proxy          Proxy escuta :9224
                                npm run daemon:start

T+20s    -                      Testar proxy           curl /health OK
                                curl localhost:9224/
                                health

T+25s    -                      Teste integração       6 testes ✅
                                node test-proxy-
                                simple.js

T+30s    -                      Sistema principal      Agente rodando
                                npm run daemon:start

PRONTO   Chrome GUI + Agente    Puppeteer conectado    PRODUÇÃO ✅
```

---

## 🚦 Estados e Transições

```
┌─────────────────────────────────────────────────────────────────┐
│                    ESTADOS DO SISTEMA                            │
└─────────────────────────────────────────────────────────────────┘

[INICIAL]
  ↓ START-CHROME-SIMPLE.bat
[CHROME_READY] ← Chrome rodando em 0.0.0.0:9225
  ↓ Validar conectividade
[CHROME_VALIDATED] ← Container consegue acessar via host.docker.internal
  ↓ Iniciar proxy
[PROXY_STARTING]
  ↓ Bind socket + Health OK
[PROXY_READY] ← Proxy escutando em 0.0.0.0:9224
  ↓ ConnectionOrchestrator.ensureBrowser()
[PUPPETEER_CONNECTING]
  ↓ WebSocket handshake
[PUPPETEER_CONNECTED] ← Browser instance ativa
  ↓ Driver executa comandos
[OPERATIONAL] ← Sistema funcionando
  ↓ Erro/Timeout/Shutdown
[DEGRADED] ← Recuperação automática ou manual
  ↓ Graceful shutdown
[STOPPED]
```

**Transições de Erro**:
```
[CHROME_READY] ─┬─ Chrome crash ───────────▶ [DEGRADED]
                └─ Bind errado ────────────▶ [FAILED]

[PROXY_READY] ──┬─ Port já em uso ─────────▶ [FAILED]
                ├─ Chrome inacessível ────▶ [DEGRADED]
                └─ NODE_OPTIONS erro ─────▶ [FAILED]

[PUPPETEER_CONNECTED] ─┬─ Target closed ───▶ [DEGRADED]
                       ├─ Network timeout ─▶ [DEGRADED]
                       └─ Chrome crash ────▶ [FAILED]
```

---

## 📊 Mapa de Componentes e Dependências

```
┌──────────────────────────────────────────────────────────────────┐
│                      DEPENDENCY GRAPH                             │
└──────────────────────────────────────────────────────────────────┘

                    ┌─────────────────┐
                    │   Application   │
                    │   (Kernel)      │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    Drivers      │
                    │ (ChatGPT/Gemini)│
                    └────────┬────────┘
                             │
                             ▼
            ┌────────────────────────────────┐
            │     Browser Pool Manager       │
            │                                │
            │ Depende de:                    │
            │ • ConnectionOrchestrator       │
            │ • config.json                  │
            └────────┬───────────────────────┘
                     │
                     ▼
    ┌────────────────────────────────────────┐
    │    Connection Orchestrator             │
    │                                        │
    │ Depende de:                            │
    │ • .puppeteerrc.cjs (helpers)          │
    │ • ChromeProxyService (indiretamente)  │
    └────────┬───────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────┐
│         Chrome Proxy Service               │
│                                            │
│ Depende de:                                │
│ • Chrome (Windows, externo)                │
│ • Docker DNS (host.docker.internal)       │
│ • config.json (CHROME_HOST, PORTS)        │
└────────┬───────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────┐
│           Docker Network                   │
│                                            │
│ Provê:                                     │
│ • DNS: host.docker.internal                │
│ • Routing: Container ↔ Windows             │
└────────┬───────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────┐
│          Chrome (Windows)                  │
│                                            │
│ Requer:                                    │
│ • --remote-debugging-address=0.0.0.0      │
│ • --remote-debugging-port=9225            │
│ • START-CHROME-SIMPLE.bat                 │
└────────────────────────────────────────────┘
```

**Legenda**:
- **Dependência Forte**: Componente A não funciona sem B
- **Dependência Configurável**: Via environment vars ou config.json
- **Dependência Externa**: Fora do controle do código (Docker, Windows)

---

## 🎓 Glossário Visual

### Conceitos-Chave

```
┌─────────────────────────────────────────────────────────────────┐
│ CDP (Chrome DevTools Protocol)                                  │
│                                                                  │
│ Protocolo de comunicação Chrome ↔ Ferramentas                  │
│                                                                  │
│   Browser ◄────── WebSocket ──────► Puppeteer                  │
│            JSON messages                                         │
│            {"method":"Page.navigate", "params":{...}}           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ host.docker.internal                                             │
│                                                                  │
│ DNS especial do Docker Desktop                                  │
│ Resolve para IP do Windows Host visível ao container           │
│                                                                  │
│   Container: host.docker.internal → 192.168.65.7 (exemplo)     │
│   Windows:   não existe (só dentro do container)               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Bind Address (0.0.0.0 vs 127.0.0.1)                            │
│                                                                  │
│ 127.0.0.1 (localhost)   →  APENAS conexões locais              │
│                             Container NÃO consegue acessar      │
│                                                                  │
│ 0.0.0.0 (all interfaces) →  TODAS as conexões                  │
│                             Container consegue acessar ✅       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ WebSocket Upgrade                                                │
│                                                                  │
│ HTTP Request:                                                   │
│   GET /devtools/browser/abc HTTP/1.1                           │
│   Upgrade: websocket                                            │
│   Connection: Upgrade                                           │
│                                                                  │
│ HTTP Response:                                                  │
│   HTTP/1.1 101 Switching Protocols                             │
│   Upgrade: websocket                                            │
│                                                                  │
│ → Conexão vira WebSocket bidirecional persistente              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📋 Checklist de Validação Completa

### Pré-Deploy

- [ ] **Windows**: Chrome instalado (v144+)
- [ ] **Windows**: START-CHROME-SIMPLE.bat contém `--remote-debugging-address=0.0.0.0`
- [ ] **Container**: config.json tem `CHROME_PROXY_HOST: "host.docker.internal"`
- [ ] **Container**: .puppeteerrc.cjs existe e exporta helpers
- [ ] **Container**: ChromeProxyService.js atualizado (v3.0, 643 linhas)
- [ ] **Container**: ConnectionOrchestrator.js atualizado (v3.0, 739 linhas)

### Durante Startup

- [ ] **Windows**: Chrome iniciado (`START-CHROME-SIMPLE.bat`)
- [ ] **Windows**: Porta 9225 aberta (`netstat -an | findstr :9225`)
- [ ] **Windows**: Bind em 0.0.0.0 (não 127.0.0.1)
- [ ] **Container**: Ping `host.docker.internal` funciona
- [ ] **Container**: `curl -H "Host: localhost" http://host.docker.internal:9225/json/version` retorna JSON
- [ ] **Container**: Proxy iniciado (PM2 ou manual)
- [ ] **Container**: `curl http://localhost:9224/health` retorna `{"status":"ok"}`
- [ ] **Container**: `curl http://localhost:9224/json/version` retorna JSON com URLs reescritas

### Pós-Startup

- [ ] **Container**: `node test-proxy-simple.js` → 6 testes ✅
- [ ] **Container**: Logs sem erros (`pm2 logs`)
- [ ] **Container**: WebSocket persistente (teste navegação)
- [ ] **Application**: Driver consegue executar comandos
- [ ] **Application**: Task completa sem crashes

---

## 🎯 Conclusão

Este diagrama documenta **todas as decisões arquiteturais** que levaram à solução atual.

**Princípio Fundamental**: Cada decisão foi tomada para resolver um bloqueador técnico real, não por preferência.

**Resultado**: Arquitetura necessária e mínima para funcionar em produção.

---

**Última Atualização**: 01 de Fevereiro de 2026
**Versão**: 3.0 Docker Desktop Edition
