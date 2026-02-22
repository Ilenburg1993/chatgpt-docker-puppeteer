# 🚀 GUIA RÁPIDO - Iniciar Chrome para Testes

**Data**: 2026-02-01 **Objetivo**: Iniciar Chrome no Windows Host para integração com Chrome Proxy
Service

---

## 📋 Pré-Requisitos

✅ Chrome instalado no Windows ✅ Terminal com permissões adequadas ✅ Porta 9225 livre (Chrome) ✅
Porta 9224 livre (Proxy - iniciado depois)

---

## 🎯 Opção 1: Batch Script (RECOMENDADO)

### Arquivo: `START-CHROME-FOR-PROXY.BAT`

**Vantagens**:

- ✅ Interface interativa com feedback visual
- ✅ Validações automáticas (porta, processo, DevTools)
- ✅ Kill automático se porta ocupada (com confirmação)
- ✅ Instruções de próximos passos integradas
- ✅ Validação JSON do endpoint

**Como usar**:

```bat
REM No Windows Host (Git Bash, CMD, ou PowerShell)
START-CHROME-FOR-PROXY.BAT
```

**Output esperado**:

```
═══════════════════════════════════════════════════════════
  CHROME LAUNCHER - Proxy Integration Ready
═══════════════════════════════════════════════════════════

Configuração:
  Porta Chrome:      9225
  Profile Dir:       C:\Users\...\AppData\Local\Temp\chrome-debug-9225
  Porta Proxy:       9224 (inicie separadamente)

[1/5] Localizando Chrome...
      [OK] C:\Program Files\Google\Chrome\Application\chrome.exe

[2/5] Verificando porta 9225...
      [OK] Porta livre

[3/5] Preparando profile isolado...
      [OK] Criado: C:\Users\...\AppData\Local\Temp\chrome-debug-9225

[4/5] Iniciando Chrome com DevTools...
      [OK] Processo iniciado

[5/5] Validando DevTools endpoint...
      [OK] DevTools endpoint online!

═══════════════════════════════════════════════════════════
  ✅ CHROME INICIADO COM SUCESSO
═══════════════════════════════════════════════════════════

Validação (JSON):
{"Browser":"Chrome/xxx.x.xxxx.xxx","Protocol-Version":"1.3","User-Agent":"..."}

═══════════════════════════════════════════════════════════
  PRÓXIMOS PASSOS
═══════════════════════════════════════════════════════════

1. Validar Chrome manualmente:
   curl http://localhost:9225/json/version

2. Iniciar Chrome Proxy Service (Terminal 2):
   node scripts\chrome-proxy-service.js

3. Validar Proxy (após iniciar):
   curl http://192.168.0.2:9224/health

4. Iniciar sistema (após proxy online):
   npm run daemon:start

5. Validar sistema completo:
   make health
```

---

## 🎯 Opção 2: PowerShell Script

### Arquivo: `start-chrome-windows.ps1`

**Vantagens**:

- ✅ Output estruturado (JSON)
- ✅ Melhor para automação
- ✅ Suporta modo headless
- ✅ Logging detalhado

**Como usar**:

```powershell
# PowerShell (Windows Host)
.\start-chrome-windows.ps1

# Ou com opções:
.\start-chrome-windows.ps1 -Port 9225 -ForceKill
.\start-chrome-windows.ps1 -Headless  # Sem interface gráfica
```

**Parâmetros**:

- `-Port 9225` - Porta do DevTools (padrão: 9225)
- `-ForceKill` - Mata processos Chrome existentes antes
- `-Headless` - Modo sem interface gráfica
- `-ChromePath "C:\caminho\chrome.exe"` - Chrome customizado
- `-RemoteAddress "127.0.0.1"` - Bind address (padrão: localhost)

---

## 🔍 Validação Manual

### 1. Chrome Online?

```bash
curl http://localhost:9225/json/version
```

**Esperado**:

```json
{
  "Browser": "Chrome/131.0.6778.86",
  "Protocol-Version": "1.3",
  "User-Agent": "Mozilla/5.0...",
  "V8-Version": "13.1.201.13",
  "WebKit-Version": "537.36",
  "webSocketDebuggerUrl": "ws://localhost:9225/devtools/browser/..."
}
```

### 2. Verificar Porta

```cmd
netstat -ano | findstr ":9225"
```

**Esperado**:

```
TCP    127.0.0.1:9225    0.0.0.0:0    LISTENING    12345
```

### 3. Verificar Processo

```cmd
tasklist | findstr "chrome.exe"
```

**Esperado**:

```
chrome.exe    12345    Console    1    123,456 K
```

---

## 🚨 Troubleshooting

### Problema: "Porta 9225 ocupada"

**Solução 1** (Script faz automaticamente):

```cmd
REM Identificar processo
netstat -ano | findstr ":9225"

REM Matar processo (use PID da linha acima)
taskkill /PID 12345 /F
```

**Solução 2** (Porta alternativa):

```cmd
set CHROME_PORT=9226
START-CHROME-FOR-PROXY.BAT
```

---

### Problema: "Chrome não encontrado"

**Solução**:

```cmd
REM Verificar instalação
dir "C:\Program Files\Google\Chrome\Application\chrome.exe"
dir "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
dir "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

REM Ou definir manualmente
set CHROME_PATH="C:\caminho\customizado\chrome.exe"
START-CHROME-FOR-PROXY.BAT
```

---

### Problema: "DevTools não responde"

**Verificações**:

1. **Firewall bloqueando?**

```cmd
REM Windows Defender Firewall
netsh advfirewall firewall show rule name=all | findstr "9225"
```

2. **Antivírus interferindo?**

- Desabilite temporariamente ou adicione exceção para Chrome

3. **Porta realmente aberta?**

```cmd
Test-NetConnection -ComputerName localhost -Port 9225
```

4. **Logs do Chrome**:

```
C:\Users\<USER>\AppData\Local\Temp\chrome-debug-9225\chrome_debug.log
```

---

## 📊 Workflow Completo (3 Terminais)

### Terminal 1: Chrome (Windows Host)

```bat
START-CHROME-FOR-PROXY.BAT
REM Aguarde: ✅ CHROME INICIADO COM SUCESSO
REM Deixe rodando (não feche)
```

### Terminal 2: Proxy (Container ou Host)

```bash
node scripts/chrome-proxy-service.js
# Aguarde: ✅ Chrome Proxy Service online (porta 9224)
# Deixe rodando
```

### Terminal 3: Sistema (Container)

```bash
npm run daemon:start
# Aguarde: ✅ Browser Pool online (3/3 instâncias saudáveis)
```

### Validação Final

```bash
make health
```

**Output esperado**:

```
[HEALTH] Core endpoint: ✅ OK
[HEALTH] Server endpoint: ✅ OK
[HEALTH] Queue endpoint: ✅ OK
[HEALTH] Control endpoint: ✅ OK
[HEALTH] PM2 processes: ✅ 2/2 online
```

---

## 🎯 Resumo: O Que Você Deve Fazer Agora

1. **Abra `START-CHROME-FOR-PROXY.BAT`** no Windows Host
2. **Execute** e aguarde "✅ CHROME INICIADO COM SUCESSO"
3. **Valide**: `curl http://localhost:9225/json/version`
4. **Mantenha a janela aberta** (Chrome precisa rodar em foreground)
5. **Prossiga** com os próximos passos (Proxy + Sistema)

---

## 📞 Próximo Passo

Após Chrome iniciado e validado, volte aqui e informe:

```
✅ Chrome rodando - pronto para iniciar proxy
```

Então prosseguiremos com:

1. Iniciar Chrome Proxy Service
2. Executar teste de integração
3. Validar sistema completo

---

**Status**: Aguardando Chrome iniciar no Windows Host **Ação**: Execute `START-CHROME-FOR-PROXY.BAT`
e reporte resultado
