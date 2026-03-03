# 🌐 Topologia de Portas - Arquitetura Completa

**Versão**: 1.0 **Data**: 02 de Fevereiro de 2026 **Status**: ✅ Documentação Canônica

---

## 📋 Visão Geral

Este documento é a **fonte única de verdade** sobre a topologia de portas do sistema. Descreve onde
cada serviço roda, quais portas usa e como os componentes se comunicam.

---

## 🏗️ Arquitetura Física

```
┌─────────────────────────────────────────────────────────────┐
│                    WINDOWS HOST                              │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │ Chrome (Google)                                     │     │
│  │ • Porta: 9225                                       │     │
│  │ • Bind: 0.0.0.0 (todas as interfaces)              │     │
│  │ • Flag: --remote-debugging-port=9225                │     │
│  │ • Acessível via: host.docker.internal:9225          │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
└──────────────────────────┬───────────────────────────────────┘
                           │ host.docker.internal
┌──────────────────────────┼───────────────────────────────────┐
│     DEVCONTAINER         │                                   │
│     (Docker Desktop)     │                                   │
│                          │                                   │
│  ┌───────────────────────▼─────────────────────────────┐    │
│  │ Chrome Proxy Service (PM2)                          │    │
│  │ • Porta: 9224                                       │    │
│  │ • Bind: 0.0.0.0 (todas as interfaces)              │    │
│  │ • Script: scripts/chrome-proxy-service.js           │    │
│  │ • Função:                                           │    │
│  │   - Reescreve Host: headers                         │    │
│  │   - Reescreve WebSocket URLs                        │    │
│  │   - Encaminha CDP: localhost → host.docker.internal │    │
│  └───────────────────────┬─────────────────────────────┘    │
│                          │ localhost                        │
│  ┌───────────────────────▼─────────────────────────────┐    │
│  │ Puppeteer / Node.js                                 │    │
│  │ • Conecta: localhost:9224                           │    │
│  │ • NÃO conhece porta 9225                            │    │
│  │ • NÃO conhece Windows Host                          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 🎯 Fluxo de Dados (Puppeteer → Chrome)

```
1. Puppeteer (container)
   ↓ Conecta em localhost:9224

2. Chrome Proxy Service (container, PM2)
   ↓ Encaminha para host.docker.internal:9225

3. Chrome (Windows Host)
   ✓ Responde via CDP (Chrome DevTools Protocol)
```

---

## 📊 Catálogo de Portas

### **Aplicação (UI Humana)**

| Porta | Serviço             | Onde Roda | Protocolo | Auto-Forward |
| ----- | ------------------- | --------- | --------- | ------------ |
| 3000  | Dashboard Principal | Container | HTTP      | ✅ Notify    |
| 3001  | Dashboard DEV       | Container | HTTP      | ✅ Notify    |
| 3002  | Dashboard Ops       | Container | HTTP      | ✅ Notify    |
| 3008  | API / Socket.io     | Container | HTTP/WS   | ✅ Notify    |

### **Observabilidade**

| Porta | Serviço           | Onde Roda | Protocolo | Auto-Forward |
| ----- | ----------------- | --------- | --------- | ------------ |
| 9100  | Métricas / Health | Container | HTTP      | ✅ Notify    |

### **Debug (Opt-in)**

| Porta | Serviço                      | Onde Roda | Protocolo | Auto-Forward |
| ----- | ---------------------------- | --------- | --------- | ------------ |
| 9229  | Node.js Inspector (Primary)  | Container | WS        | 🔇 Silent    |
| 9230  | Node.js Inspector (Fallback) | Container | WS        | 🔇 Silent    |

### **Controle / Infraestrutura (RESTRITO)**

| Porta | Serviço          | Onde Roda     | Protocolo | Auto-Forward | Acesso                      |
| ----- | ---------------- | ------------- | --------- | ------------ | --------------------------- |
| 9224  | **Chrome Proxy** | **Container** | HTTP/WS   | ❌ Ignore    | `localhost:9224`            |
| 9225  | **Chrome Real**  | **Windows**   | CDP/WS    | ❌ Ignore    | `host.docker.internal:9225` |

---

## 🔒 Contratos Invioláveis

### **1. Porta 9224 (Chrome Proxy Service)**

**Localização**: DevContainer (PM2) **Bind**: `0.0.0.0:9224` **Acesso Puppeteer**: `localhost:9224`

**Responsabilidades**:

- ✅ Reescrever `Host:` headers para Chrome aceitar
- ✅ Reescrever `webSocketDebuggerUrl` (localhost → IP container)
- ✅ Encaminhar tráfego CDP para `host.docker.internal:9225`
- ✅ Logs centralizados (NERV)
- ✅ Gerenciamento via PM2

**Proibições**:

- ❌ NUNCA deve ser acessado via `host.docker.internal` (é serviço local)
- ❌ NUNCA deve ser exposto publicamente
- ❌ NUNCA deve ter forward port automático

---

### **2. Porta 9225 (Chrome Real)**

**Localização**: Windows Host **Bind**: `0.0.0.0:9225` **Acesso Proxy**: `host.docker.internal:9225`

**Responsabilidades**:

- ✅ Expor Chrome DevTools Protocol (CDP)
- ✅ Aceitar conexões do proxy no container

**Proibições**:

- ❌ NUNCA deve ser acessado diretamente pelo Puppeteer
- ❌ NUNCA deve ser acessado diretamente pelo container
- ❌ NUNCA deve ter forward port automático
- ❌ NUNCA deve fazer bind em `127.0.0.1` (deve ser `0.0.0.0`)

---

## ❓ Perguntas Frequentes

### **Por que o proxy roda no container e não no Windows?**

**Razões arquiteturais**:

1. ✅ **Gerenciamento unificado**: PM2 no container controla tudo (agent + proxy)
2. ✅ **Logs centralizados**: Proxy emite eventos NERV, integrado ao sistema
3. ✅ **Deploy simplificado**: Um único `docker-compose up`
4. ✅ **Manutenibilidade**: Não requer Node.js no Windows
5. ✅ **Isolamento**: Proxy vive e morre com o container

**Trade-off**: Latência adicional mínima (~1-5ms) vs ganho massivo em simplicidade operacional.

---

### **Por que Puppeteer conecta em `localhost:9224` e não `host.docker.internal:9224`?**

Porque o proxy **roda no mesmo container** que o Puppeteer:

- ✅ `localhost:9224` = mesma máquina, mesma rede (rápido)
- ❌ `host.docker.internal:9224` = implicaria proxy no Windows (errado)

**Regra de Ouro**:

- Container → Container: `localhost`
- Container → Windows: `host.docker.internal`

---

### **Como o proxy acessa o Chrome no Windows?**

O proxy usa `host.docker.internal:9225`:

```javascript
// Em chrome-proxy-service.js
const chromeHost = process.env.CHROME_HOST || 'host.docker.internal';
const chromePort = process.env.CHROME_PORT || 9225;
const target = `http://${chromeHost}:${chromePort}`;
```

Docker Desktop (WSL2 backend) fornece o DNS especial `host.docker.internal` que resolve para o IP do
Windows visível ao container.

---

### **Por que não usar apenas porta 9225 diretamente?**

**Problemas técnicos do acesso direto**:

1. **Host Header Validation**: Chrome rejeita headers `Host: host.docker.internal`

   ```http
   GET /json/version HTTP/1.1
   Host: host.docker.internal:9225

   HTTP/1.1 400 Bad Request
   Host header is specified and is not an IP address or localhost.
   ```

2. **WebSocket URL Rewriting**: Chrome retorna URLs com `ws://localhost/...`

   ```json
   {
     "webSocketDebuggerUrl": "ws://localhost/devtools/browser/abc123"
   }
   ```

   Se Puppeteer usar esse URL, conectará ao próprio container (erro).

3. **Transparência**: Puppeteer espera um único endpoint confiável.

**Solução**: Proxy traduz tudo automaticamente.

---

### **O que acontece se o Chrome no Windows não estiver rodando?**

**Comportamento esperado**:

1. ✅ Proxy continua ativo (aguardando conexões)
2. ✅ Puppeteer recebe timeout ao tentar conectar
3. ✅ Sistema pode usar Chromium local (fallback)
4. ✅ Nenhum crash ou erro fatal

**Validação**:

```bash
# No container
curl http://localhost:9224/json/version

# Se Chrome estiver ativo → JSON response
# Se Chrome estiver offline → timeout ou erro 502
```

---

### **Como iniciar o Chrome corretamente no Windows?**

**Comando recomendado** (PowerShell):

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-address=0.0.0.0 `
  --remote-debugging-port=9225 `
  --user-data-dir="$env:USERPROFILE\.chrome-debug" `
  --no-first-run `
  --no-default-browser-check
```

**Flags críticas**:

- `--remote-debugging-address=0.0.0.0`: Escuta em todas as interfaces (não apenas localhost)
- `--remote-debugging-port=9225`: Porta canônica do sistema
- `--user-data-dir`: Perfil isolado (não interfere com Chrome pessoal)

**Scripts auxiliares**:

- `START-CHROME-SIMPLE.bat`: Launcher básico
- `wsl-chrome-integration.sh`: Validação completa

---

### **Como validar a topologia completa?**

**1. Validar Chrome no Windows**:

```powershell
# Do Windows
curl http://localhost:9225/json/version
```

**2. Validar Proxy no Container**:

```bash
# Do container
curl http://localhost:9224/json/version
```

**3. Validar Comunicação End-to-End**:

```bash
# Do container (via proxy → Chrome)
curl http://localhost:9224/json/version | jq .
```

**4. Script de Validação Completo**:

```bash
# No container
bash wsl-chrome-integration.sh all
```

---

## 🛡️ Segurança

### **Não Exponha Porta 9225 Publicamente**

❌ **NUNCA FAÇA ISSO**:

```bash
# ERRADO - expõe Chrome para a internet
chrome.exe --remote-debugging-address=0.0.0.0 --remote-debugging-port=9225
# E depois configurar firewall permitindo tráfego externo
```

✅ **Configuração Segura**:

- Chrome escuta em `0.0.0.0:9225` **apenas na rede Docker**
- Firewall Windows bloqueia tráfego externo para porta 9225
- Acesso restrito a: localhost (Windows) + Docker bridge

### **Não Exponha Porta 9224 Publicamente**

A porta 9224 também não deve ser exposta via VS Code Port Forwarding ou outras ferramentas. Ela é
uma fronteira arquitetural interna.

---

## 📚 Referências

- **Código Fonte**:
  - [pool_manager.js](../src/infra/browser_pool/pool_manager.js) - Validação de proxy
  - [chromeProxyService.js](../src/infra/proxy/chromeProxyService.js) - Implementação do proxy

- **Configuração**:
  - [devcontainer.json](devcontainer.json) - Topologia de portas
  - [ecosystem.config.js](../ecosystem.config.js) - PM2 config (proxy)

- **Documentação**:
  - [CONNECTION_ARCHITECTURE/](../DOCUMENTAÇÃO/ARQUITETURA/CONNECTION_ARCHITECTURE/) - Arquitetura
    profunda
  - [CHROME_PROXY_SETUP.md](../DOCUMENTAÇÃO/CHROME_PROXY_SETUP.md) - Setup detalhado

---

## 🔄 Changelog

- **v1.0** (2026-02-02): Documentação inicial completa
  - Topologia física
  - Catálogo de portas
  - Contratos invioláveis
  - FAQ completo

---

**Última Atualização**: 02 de Fevereiro de 2026 **Mantido por**: Sistema de Automação GPT
**Status**: ✅ Validado e Funcionando
