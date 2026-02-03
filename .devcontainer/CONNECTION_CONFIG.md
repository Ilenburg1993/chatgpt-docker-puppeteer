# 📐 Configuração Centralizada de Conexão

**Versão**: 1.0
**Data**: 02 de Fevereiro de 2026
**Status**: ✅ Configuração Canônica Centralizada

---

## 📋 Visão Geral

Este documento descreve a **configuração centralizada de conexão** entre Puppeteer, Chrome Proxy Service e Chrome Real, gerenciada pelo arquivo `src/core/config.js`.

---

## 🎯 Objetivo

Centralizar todas as configurações de rede e conexão em um único local (`config.js`), eliminando:
- ❌ Valores hardcoded espalhados pelo código
- ❌ Fallbacks inconsistentes entre módulos
- ❌ Múltiplas fontes de verdade

---

## 📊 Configurações Disponíveis

### **Chrome Real (Windows Host)**

| Configuração  | Descrição                                   | Valor Padrão           | Origem                           |
| ------------- | ------------------------------------------- | ---------------------- | -------------------------------- |
| `CHROME_PORT` | Porta onde Chrome escuta (remote debugging) | `9225`                 | config.json                      |
| `CHROME_HOST` | Host onde Chrome está rodando               | `host.docker.internal` | config.json ou `CHROME_HOST` env |

**Onde é usado**:
- `chromeProxyService.js`: Para encaminhar conexões
- `ConnectionOrchestrator.js`: Para descoberta de endpoints

---

### **Chrome Proxy Service (DevContainer)**

| Configuração           | Descrição                             | Valor Padrão | Origem                                 |
| ---------------------- | ------------------------------------- | ------------ | -------------------------------------- |
| `CHROME_PROXY_PORT`    | Porta onde Proxy escuta               | `9224`       | config.json                            |
| `CHROME_PROXY_HOST`    | Host onde Puppeteer acessa Proxy      | `localhost`  | config.json                            |
| `CHROME_PROXY_BIND`    | Interface que Proxy escuta            | `0.0.0.0`    | config.json ou `CHROME_PROXY_BIND` env |
| `CHROME_PROXY_ENABLED` | Flag para habilitar/desabilitar proxy | `true`       | config.json                            |

**Onde é usado**:
- `pool_manager.js`: Para validar disponibilidade do proxy
- `chromeProxyService.js`: Para configurar servidor
- `main.js`: Para iniciar proxy inline
- `boot_resilience_manager.js`: Para instruções de troubleshooting

---

## 🔧 Como Usar

### **1. No Código (via require)**

```javascript
const CONFIG = require('@core/config');

// Acessar configurações
const chromeHost = CONFIG.CHROME_HOST;               // 'host.docker.internal'
const chromePort = CONFIG.CHROME_PORT;               // 9225
const proxyHost = CONFIG.CHROME_PROXY_HOST;          // 'localhost'
const proxyPort = CONFIG.CHROME_PROXY_PORT;          // 9224
const proxyBind = CONFIG.CHROME_PROXY_BIND;          // '0.0.0.0'
const proxyEnabled = CONFIG.CHROME_PROXY_ENABLED;    // true
```

### **2. No config.json**

```json
{
  "CHROME_PORT": 9225,
  "CHROME_HOST": "host.docker.internal",
  "CHROME_PROXY_PORT": 9224,
  "CHROME_PROXY_HOST": "localhost",
  "CHROME_PROXY_BIND": "0.0.0.0",
  "CHROME_PROXY_ENABLED": true
}
```

### **3. Via Variáveis de Ambiente**

```bash
# Sobrescrever Chrome Host (ex: para testes locais)
export CHROME_HOST=192.168.1.100

# Sobrescrever Proxy Bind (ex: para restringir interface)
export CHROME_PROXY_BIND=127.0.0.1

# O config.js detecta automaticamente e usa os valores de env
```

---

## 📐 Hierarquia de Configuração

**Ordem de Precedência** (do mais alto para o mais baixo):

1. **Parâmetros diretos** (passados ao construtor)
   ```javascript
   new ChromeProxyService({ CHROME_HOST: '192.168.1.100' })
   ```

2. **Variáveis de Ambiente**
   ```bash
   export CHROME_HOST=192.168.1.100
   ```

3. **config.json** (via `src/core/config.js`)
   ```json
   { "CHROME_HOST": "host.docker.internal" }
   ```

4. **Valores Padrão** (no schema Zod)
   ```javascript
   CHROME_HOST: z.string().default('host.docker.internal')
   ```

---

## 🗺️ Mapa de Dependências

```
config.js (Fonte Única de Verdade)
    │
    ├─> pool_manager.js
    │   └─> Valida proxy em CONFIG.CHROME_PROXY_HOST:CONFIG.CHROME_PROXY_PORT
    │
    ├─> chromeProxyService.js
    │   ├─> Usa CONFIG.CHROME_HOST para encaminhar para Chrome
    │   └─> Usa CONFIG.CHROME_PROXY_* para configurar servidor
    │
    ├─> main.js
    │   └─> Usa CONFIG ao iniciar ChromeProxyService inline
    │
    ├─> boot_resilience_manager.js
    │   └─> Usa CONFIG para gerar instruções de troubleshooting
    │
    └─> ConnectionOrchestrator.js
        └─> Usa CONFIG.CHROME_PROXY_PORT para descoberta de endpoints
```

---

## 🔍 Exemplos de Uso Real

### **Cenário 1: Desenvolvimento Local (Container + Chrome Windows)**

```javascript
// config.json (padrão)
{
  "CHROME_HOST": "host.docker.internal",  // Chrome no Windows
  "CHROME_PORT": 9225,
  "CHROME_PROXY_HOST": "localhost",       // Proxy no container
  "CHROME_PROXY_PORT": 9224,
  "CHROME_PROXY_ENABLED": true
}

// Fluxo:
// Puppeteer → localhost:9224 (Proxy) → host.docker.internal:9225 (Chrome)
```

### **Cenário 2: Chrome em Máquina Remota**

```bash
# .env ou variáveis de ambiente
export CHROME_HOST=192.168.1.100
export CHROME_PORT=9225

# config.json (resto permanece igual)
{
  "CHROME_PROXY_HOST": "localhost",
  "CHROME_PROXY_PORT": 9224,
  "CHROME_PROXY_ENABLED": true
}

# Fluxo:
# Puppeteer → localhost:9224 (Proxy) → 192.168.1.100:9225 (Chrome)
```

### **Cenário 3: Proxy Desabilitado (Acesso Direto)**

```json
// config.json
{
  "CHROME_PROXY_ENABLED": false,
  "CHROME_HOST": "192.168.1.100",  // Acesso direto
  "CHROME_PORT": 9225
}

// pool_manager.js irá pular validação do proxy
// Puppeteer tentará conectar diretamente (pode falhar por Host: validation)
```

---

## ⚠️ Regras Importantes

### **1. NUNCA Hardcode Portas**

❌ **Errado**:
```javascript
const proxyUrl = 'http://localhost:9224';
const chromeHost = 'host.docker.internal';
```

✅ **Correto**:
```javascript
const CONFIG = require('@core/config');
const proxyUrl = `http://${CONFIG.CHROME_PROXY_HOST}:${CONFIG.CHROME_PROXY_PORT}`;
const chromeHost = CONFIG.CHROME_HOST;
```

### **2. Sempre Usar Getters**

❌ **Errado**:
```javascript
const port = CONFIG.currentConfig.CHROME_PROXY_PORT;
```

✅ **Correto**:
```javascript
const port = CONFIG.CHROME_PROXY_PORT;
```

### **3. Fallbacks Devem Estar no config.js**

❌ **Errado** (fallback duplicado):
```javascript
const host = CONFIG.CHROME_PROXY_HOST || 'localhost';
```

✅ **Correto** (confiar no padrão do config):
```javascript
const host = CONFIG.CHROME_PROXY_HOST;  // Já tem default 'localhost'
```

---

## 🧪 Validação

### **1. Verificar Configuração Atual**

```javascript
const CONFIG = require('@core/config');

console.log('Chrome Connection:');
console.log(`  Host: ${CONFIG.CHROME_HOST}`);
console.log(`  Port: ${CONFIG.CHROME_PORT}`);
console.log();
console.log('Proxy Connection:');
console.log(`  Host: ${CONFIG.CHROME_PROXY_HOST}`);
console.log(`  Port: ${CONFIG.CHROME_PROXY_PORT}`);
console.log(`  Bind: ${CONFIG.CHROME_PROXY_BIND}`);
console.log(`  Enabled: ${CONFIG.CHROME_PROXY_ENABLED}`);
```

### **2. Testar Conexão Proxy**

```bash
# No container
curl http://localhost:9224/health

# Resposta esperada:
# {"status":"ok","uptime":123,...}
```

### **3. Testar Conexão Chrome (via Proxy)**

```bash
# No container
curl http://localhost:9224/json/version

# Resposta esperada:
# {"Browser":"Chrome/144.0.7559.110",...}
```

---

## 📚 Referências

- **Código Fonte**: [config.js](../src/core/config.js)
- **Schema Zod**: Linhas 38-82 (Chrome & Proxy Connection)
- **Getters**: Linhas 244-266
- **Documentação de Portas**: [PORTS_TOPOLOGY.md](PORTS_TOPOLOGY.md)
- **Arquitetura de Conexão**: [CONNECTION_ARCHITECTURE/](../DOCUMENTAÇÃO/CONNECTION_ARCHITECTURE/)

---

## 🔄 Changelog

- **v1.0** (2026-02-02): Configuração inicial centralizada
  - Adicionadas constantes: `CHROME_HOST`, `CHROME_PROXY_HOST`, `CHROME_PROXY_BIND`, `CHROME_PROXY_ENABLED`
  - Migração de valores hardcoded para CONFIG
  - Atualização de `chromeProxyService.js`, `pool_manager.js`, `main.js`, `boot_resilience_manager.js`

---

**Última Atualização**: 02 de Fevereiro de 2026
**Mantido por**: Sistema de Automação GPT
**Status**: ✅ Produção - Configuração Canônica
