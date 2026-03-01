# Chrome Proxy Launcher - Guia de Uso

> **Scripts para inicializar Chrome + Proxy corretamente para ConnectionOrchestrator**

---

## 📁 Scripts Disponíveis

### 🚀 `start-chrome-proxy.bat` (PRINCIPAL)

**Localização**: `/start-chrome-proxy.bat` (pasta root)

**Propósito**: Inicializa Chrome + Proxy de forma consolidada e production-ready

**O que faz**:

1. ✅ Valida ambiente (Node.js, Chrome)
2. ✅ Auto-detecta IP público do Windows
3. ✅ Valida configuração (`config.json`)
4. ✅ Inicia Chrome com remote debugging (porta 9224)
5. ✅ Inicia Chrome Proxy Service (porta 9224)
6. ✅ Executa health checks completos
7. ✅ Valida URL rewriting
8. ✅ Fornece instruções de teste

**Quando usar**: **SEMPRE** antes de executar `npm start` ou `node src/main.js`

**Exemplo de uso**:

```batch
REM No Windows (fora do container):
cd C:\caminho\para\chatgpt-docker-puppeteer
start-chrome-proxy.bat
```

**Saída esperada**:

```
════════════════════════════════════════════════════════════════════════════
  ✅ SISTEMA INICIALIZADO COM SUCESSO!
════════════════════════════════════════════════════════════════════════════

[CONFIGURAÇÃO]
  • IP Público:              192.168.0.2
  • Chrome Debug Port:       9224
  • Proxy Port:              9224
  • Browser Mode:            wsEndpoint

[SERVIÇOS ATIVOS]
  • Chrome Remote Debugging: http://localhost:9224
  • Chrome Proxy Service:    http://192.168.0.2:9224
  • WebSocket Endpoint:      ws://192.168.0.2:9224/devtools/...
```

---

### 🔍 `verify-chrome-setup.bat` (DIAGNÓSTICO)

**Localização**: `/verify-chrome-setup.bat` (pasta root)

**Propósito**: Diagnostica e valida configuração sem iniciar serviços

**O que faz**:

1. ✅ Verifica se arquivos necessários existem
2. ✅ Valida `config.json` (BROWSER_MODE, DEBUG_PORT, etc.)
3. ✅ Valida `chrome-config.json` (se existir)
4. ✅ Verifica portas 9224 e 9224
5. ✅ Testa conectividade (se serviços estiverem rodando)
6. ✅ Valida URL rewriting

**Quando usar**:

- Antes de executar `start-chrome-proxy.bat` pela primeira vez
- Quando houver problemas de conexão
- Após modificar `config.json`

**Exemplo de uso**:

```batch
REM Diagnosticar configuração:
verify-chrome-setup.bat
```

**Saída esperada**:

```
════════════════════════════════════════════════════════════════════════════
  RESULTADO DA VERIFICAÇÃO
════════════════════════════════════════════════════════════════════════════

[✅] CONFIGURAÇÃO VÁLIDA!

Próximos passos:
  1. Inicie os serviços:  start-chrome-proxy.bat
  2. Teste do container:  curl http://192.168.0.2:9224/json/version
  3. Inicie o sistema:    npm start
```

---

### 📜 Scripts Legados (em `scripts/`)

#### `scripts/start-chrome-with-proxy.bat`

- **Status**: Substituído por `start-chrome-proxy.bat`
- **Diferença**: Versão anterior sem validação completa
- **Recomendação**: Use `start-chrome-proxy.bat` (root)

#### `scripts/start-chrome.bat`

- **Status**: Legado (não inicia proxy)
- **Limitação**: Apenas inicia Chrome sem proxy
- **Recomendação**: **NÃO USE** - ConnectionOrchestrator espera proxy

---

## 🔄 Workflow Completo

### 1️⃣ Primeira Execução (Setup Inicial)

```batch
REM 1. Verificar configuração
verify-chrome-setup.bat

REM 2. Se tudo OK, iniciar serviços
start-chrome-proxy.bat

REM 3. Do container Docker, testar:
curl http://192.168.0.2:9224/json/version

REM 4. Iniciar sistema
npm start
```

### 2️⃣ Execuções Subsequentes (Dia-a-Dia)

```batch
REM 1. Iniciar Chrome + Proxy (se não estiverem rodando)
start-chrome-proxy.bat

REM 2. Iniciar sistema
npm start
```

### 3️⃣ Troubleshooting

```batch
REM 1. Parar tudo
taskkill /IM chrome.exe /F
taskkill /F /FI "WINDOWTITLE eq Chrome Proxy Service"

REM 2. Verificar configuração
verify-chrome-setup.bat

REM 3. Reiniciar
start-chrome-proxy.bat
```

---

## ⚙️ Configuração Esperada

### `config.json` (root)

**Campos críticos**:

```json
{
  "BROWSER_MODE": "wsEndpoint", // ✅ OBRIGATÓRIO
  "DEBUG_PORT": "http://192.168.0.2:9224", // ✅ Usar IP público + porta proxy

  "CHROME_PROXY_ENABLED": true, // ✅ OBRIGATÓRIO
  "CHROME_PROXY_HOST": "192.168.0.2", // ✅ IP público do Windows
  "CHROME_PROXY_PORT": 9224, // ✅ Porta do proxy
  "CHROME_DIRECT_PORT": 9224, // ✅ Porta do Chrome

  "ALLOW_BROWSER_FALLBACK": true // ✅ Recomendado
}
```

### `chrome-config.json` (root, opcional)

**Gerado automaticamente**, deve conter:

```json
{
  "connection": {
    "mode": "wsEndpoint",
    "ports": [9224, 9224, 9223],
    "hosts": ["192.168.0.2", "host.docker.internal", "172.17.0.1", "127.0.0.1"]
  },
  "chromeProxy": {
    "enabled": true,
    "proxyHost": "192.168.0.2",
    "proxyPort": 9224
  }
}
```

### `src/infra/ConnectionOrchestrator.js`

**DEFAULTS devem ter** (linhas 73-85):

```javascript
const DEFAULTS = {
  mode: 'wsEndpoint', // ✅ wsEndpoint como padrão
  ports: [9224, 9224, 9223], // ✅ Proxy PRIMEIRO
  hosts: [
    '192.168.0.2', // ✅ IP público PRIMEIRO
    'host.docker.internal',
    '172.17.0.1',
    '127.0.0.1',
  ],
  // ...
};
```

---

## 🎯 Como o ConnectionOrchestrator Conecta

### Ordem de Tentativas (Fallback Automático)

1. **192.168.0.2:9224** (PROXY via IP público) ← **PREFERENCIAL**
2. **host.docker.internal:9224** (PROXY via Docker DNS)
3. **192.168.0.2:9224** (DIRETO via IP público)
4. **host.docker.internal:9224** (DIRETO via Docker DNS)
5. **172.17.0.1:9224** (PROXY via Docker bridge)
6. **172.17.0.1:9224** (DIRETO via Docker bridge)
7. ... (outras combinações)

### Logs Esperados

**Quando conecta via proxy** (✅ IDEAL):

```
[INFO] [ORCH] [PROXY] Tentando WS endpoint: http://192.168.0.2:9224/json/version
[INFO] [ORCH] ✅ Conectado via Chrome Proxy Service (192.168.0.2:9224)
[INFO] [ORCH]    WebSocket URL: ws://192.168.0.2:9224/devtools/browser/...
```

**Quando conecta direto** (⚠️ FALLBACK):

```
[INFO] [ORCH] [DIRECT] Tentando WS endpoint: http://host.docker.internal:9224/json/version
[INFO] [ORCH] ✅ Conectado diretamente ao Chrome (host.docker.internal:9224)
```

---

## 🐛 Troubleshooting Comum

### Problema 1: "Chrome não encontrado"

**Erro**:

```
[ERRO] Google Chrome não encontrado!
```

**Solução**:

- Instale Google Chrome: https://www.google.com/chrome/
- Ou edite `start-chrome-proxy.bat` linha 45-50 para adicionar caminho customizado

---

### Problema 2: "Proxy script não encontrado"

**Erro**:

```
[ERRO] Proxy script não encontrado: scripts\chrome-proxy-service.js
```

**Solução**:

- Verifique se `scripts/chrome-proxy-service.js` existe
- Se necessário, restaure de backup ou repositório

---

### Problema 3: "Porta 9224 já está em uso"

**Erro**:

```
[ERRO] Timeout: Proxy não iniciou em 15s
```

**Diagnóstico**:

```batch
netstat -ano | findstr :9224
```

**Solução**:

```batch
REM Encontre PID e mate processo:
taskkill /PID <PID> /F

REM Ou mude porta no config.json (não recomendado)
```

---

### Problema 4: "URL rewriting não funciona"

**Sintoma**:

```
[WARN] URL rewriting pode não estar funcionando corretamente
```

**Diagnóstico**:

```batch
REM Teste manualmente:
curl http://localhost:9224/json/version

REM Deve retornar:
{
  "webSocketDebuggerUrl": "ws://192.168.0.2:9224/devtools/browser/..."
}
```

**Solução**:

- Verifique se proxy está usando IP público correto
- Reinicie proxy: `node scripts/chrome-proxy-service.js 192.168.0.2 debug`

---

### Problema 5: "Container não consegue acessar proxy"

**Sintoma**: `curl http://192.168.0.2:9224` do container falha

**Diagnóstico**:

```batch
REM No Windows, verificar firewall:
netsh advfirewall show allprofiles

REM Testar localmente:
curl http://192.168.0.2:9224/json/version
```

**Solução**:

```batch
REM Adicionar regra de firewall:
netsh advfirewall firewall add rule name="Chrome Proxy 9224" dir=in action=allow protocol=TCP localport=9224
```

---

## 📚 Documentação Relacionada

- **Setup Completo**: `DOCUMENTAÇÃO/CHROME_PROXY_SETUP.md`
- **Guia de Integração**: `DOCUMENTAÇÃO/CHROME_PROXY_INTEGRATION_GUIDE.md`
- **Arquitetura**: `DOCUMENTAÇÃO/ARCHITECTURE.md`
- **Troubleshooting**: `DOCUMENTAÇÃO/TROUBLESHOOTING.md` (se existir)

---

## 🔧 Scripts de Manutenção

### Matar todos os processos

```batch
REM Matar Chrome:
taskkill /IM chrome.exe /F

REM Matar Proxy (buscar por título de janela):
taskkill /F /FI "WINDOWTITLE eq Chrome Proxy Service"

REM Ou matar por porta:
for /f "tokens=5" %a in ('netstat -ano ^| findstr ":9224" ^| findstr "LISTENING"') do taskkill /PID %a /F
```

### Verificar status

```batch
REM Chrome rodando?
curl http://localhost:9224/json/version

REM Proxy rodando?
curl http://localhost:9224/json/version

REM Portas em uso?
netstat -ano | findstr ":9224"
netstat -ano | findstr ":9224"
```

---

## ✅ Checklist de Validação

Antes de executar `npm start`, confirme:

- [ ] Chrome instalado no Windows
- [ ] Node.js instalado no Windows
- [ ] `config.json` com `BROWSER_MODE: "wsEndpoint"`
- [ ] `config.json` com `CHROME_PROXY_ENABLED: true`
- [ ] `scripts/chrome-proxy-service.js` existe
- [ ] `verify-chrome-setup.bat` retorna ✅ CONFIGURAÇÃO VÁLIDA
- [ ] `start-chrome-proxy.bat` retorna ✅ SISTEMA INICIALIZADO
- [ ] `curl http://192.168.0.2:9224/json/version` funciona do container

---

**Última atualização**: 2026-01-30 **Versão**: 3.0 **Autor**: Gerado via Claude Code Integration
