# Super Launcher v2.0 - Documentação Completa

> **Estratégia PM2-First**: Launcher interativo + Scripts CLI + Dashboard HTML + Health Endpoints

---

## 📑 Índice

1. [Visão Geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Instalação e Setup](#instalação-e-setup)
4. [Menu Principal](#menu-principal)
5. [Scripts Utilitários](#scripts-utilitários)
6. [Dashboard HTML](#dashboard-html)
7. [Health Endpoints](#health-endpoints)
8. [Troubleshooting](#troubleshooting)
9. [Comparação de Ferramentas](#comparação-de-ferramentas)
10. [Exemplos Práticos](#exemplos-práticos)

---

## 🎯 Visão Geral

O **Super Launcher v2.0** é um sistema completo de gerenciamento e monitoramento para o projeto ChatGPT Docker Puppeteer, implementando a estratégia **PM2-First** com foco em:

- ✅ **Simplicidade**: Interface interativa sem dependências pesadas
- ✅ **Robustez**: PM2 com NASA-Grade (9.5/10) após correções P3
- ✅ **Monitoramento**: Health endpoints + Dashboard HTML + pm2-gui
- ✅ **Automação**: Validações pré-boot, backups, detecção de crashes
- ✅ **Cross-platform**: Windows (.bat) + Linux/Mac (.sh)

### Componentes Principais

| Componente | Descrição | Arquivos |
|------------|-----------|----------|
| **Super Launcher** | Menu interativo 10 opções | `LAUNCHER.bat`, `launcher.sh` |
| **Scripts CLI** | Operações rápidas CLI | `scripts/quick-ops.*`, `watch-logs.*` |
| **Dashboard HTML** | Interface web standalone | `scripts/launcher-dashboard.html` |
| **Health Endpoints** | APIs de monitoramento | `/api/health/*` |
| **Chrome Config** | Exportador de configuração | `chrome-config.json` |
| **PM2 Helpers** | Instaladores GUI/Plus | `scripts/install-pm2-gui.*`, `setup-pm2-plus.*` |

---

## 🏗️ Arquitetura

### Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────┐
│                    SUPER LAUNCHER v2.0                      │
│                   (Menu Interativo + CLI)                   │
└────────────┬────────────────────────────────────────────────┘
             │
             ├──► [1] START SYSTEM
             │     ├─ Validação Node.js
             │     ├─ Validação PM2
             │     ├─ Validação dependências
             │     ├─ Validação Chrome config
             │     ├─ Detecção crashes
             │     ├─ Backup automático
             │     └─ npm run daemon:start
             │
             ├──► [2-3] STOP/RESTART ──► PM2 Commands
             │
             ├──► [4] STATUS CHECK
             │     ├─ PM2 jlist (processos)
             │     ├─ Health Endpoints (HTTP)
             │     └─ Queue Status
             │
             ├──► [5] VIEW LOGS ──► PM2 Logs + Files
             │
             ├──► [6-7] PM2 GUI/MONIT ──► External Tools
             │
             ├──► [8] CLEAN ──► npm run clean
             │
             ├──► [9] DIAGNOSE ──► npm run diagnose
             │
             └──► [10] BACKUP ──► Config Snapshot
                   ├─ config.json
                   ├─ controle.json
                   ├─ dynamic_rules.json
                   ├─ ecosystem.config.js
                   └─ fila/*.json

┌─────────────────────────────────────────────────────────────┐
│              HEALTH ENDPOINTS (Server API)                  │
├─────────────────────────────────────────────────────────────┤
│  GET /api/health          - Agregador geral                │
│  GET /api/health/chrome   - Chrome debug port validation   │
│  GET /api/health/pm2      - PM2 processes list             │
│  GET /api/health/kernel   - Kernel NERV state              │
│  GET /api/health/disk     - Disk usage monitoring          │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│           DASHBOARD HTML (Auto-refresh 5s)                  │
├─────────────────────────────────────────────────────────────┤
│  🖥️ Server Card    │  🌐 Chrome Card   │  ⚙️ PM2 Card       │
│  🧠 Kernel Card    │  💾 Disk Card     │  (Status Badges) │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    PM2 ECOSYSTEM                            │
├─────────────────────────────────────────────────────────────┤
│  Process: agente-gpt       (Main Agent)                     │
│  Process: dashboard-web    (Server + API)                   │
│  ├─ Auto-recovery: 30s interval                            │
│  ├─ Graceful shutdown: 5s timeout                          │
│  ├─ Memory limits: 1GB (agent) / 2GB (dashboard)           │
│  └─ Health checks: 30s PM2 + HTTP endpoints                │
└─────────────────────────────────────────────────────────────┘
```

### Fluxo de Inicialização

```
LAUNCHER.bat/sh
    │
    ├─► [Validação 1] Node.js instalado?
    │        ├─ SIM: Continua
    │        └─ NÃO: Erro + instrução instalação
    │
    ├─► [Validação 2] PM2 instalado?
    │        ├─ SIM: Continua
    │        └─ NÃO: Erro + npm install -g pm2
    │
    ├─► [Validação 3] node_modules existe?
    │        ├─ SIM: Continua
    │        └─ NÃO: npm install
    │
    ├─► [Validação 4] chrome-config.json existe?
    │        ├─ SIM: Continua
    │        └─ NÃO: Gera via ConnectionOrchestrator
    │
    ├─► [Validação 5] Crashes anteriores?
    │        └─ Detecta logs/crash_reports/*.txt
    │
    ├─► [Backup] Cria snapshot automático
    │        └─ backups/pre-start-YYYYMMDD-HHMMSS/
    │
    ├─► [Inicialização] npm run daemon:start
    │        └─ PM2 inicia agente-gpt + dashboard-web
    │
    ├─► [Aguarda] 10s para boot completo
    │
    └─► [Health Check] curl http://localhost:2998/api/health
             ├─ 200 OK: Sistema operacional ✅
             └─ ERRO: Aviso (sistema ainda iniciando)
```

---

## 🚀 Instalação e Setup

### Pré-requisitos

```bash
# Node.js v20+ (recomendado)
node --version  # v20.x.x

# PM2 (gerenciador de processos)
npm install -g pm2

# Git (para clonar repositório)
git --version
```

### Setup Inicial

```bash
# 1. Clonar repositório
git clone https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git
cd chatgpt-docker-puppeteer

# 2. Instalar dependências
npm install

# 3. Configurar Chrome (opcional - launcher gera automaticamente)
node -e "require('./src/infra/ConnectionOrchestrator').exportConfigForLauncher()"

# 4. Tornar launchers executáveis (Linux/Mac)
chmod +x launcher.sh
chmod +x scripts/*.sh
```

### Primeiro Boot

**Windows:**
```cmd
LAUNCHER.bat
```

**Linux/Mac:**
```bash
./launcher.sh
```

O launcher executará todas as validações automaticamente e iniciará o sistema.

---

## 📋 Menu Principal

### Opções Disponíveis

#### [1] Start System

**Funcionalidade:**
- 5 validações pré-boot (Node, PM2, deps, Chrome config, crashes)
- Backup automático de configs críticos
- Inicialização PM2 via `npm run daemon:start`
- Health check automático após 10s

**Uso:**
```
Escolha uma opção: 1
```

**Output esperado:**
```
[1/5] Verificando Node.js...
        ✓ Node.js v20.x.x detectado

[2/5] Verificando PM2...
        ✓ PM2 instalado

[3/5] Verificando dependências...
        ✓ Dependências OK

[4/5] Verificando Chrome config...
        ✓ Chrome config disponível

[5/5] Verificando crashes anteriores...
        ✓ Sem crashes recentes

[AUTO] Backup de segurança...
        ✓ Backup: backups/pre-start-20260121-063000

INICIANDO PM2 DAEMON
...
✓ Sistema operacional!

Dashboard: http://localhost:2998
PM2 Status: npm run queue:status
Logs: Opção [5] no menu
```

#### [2] Stop System

**Funcionalidade:**
- Shutdown gracioso PM2 (timeout: 5s configurável)
- Salva estado de todos os processos
- Não remove logs

**Uso:**
```
Escolha uma opção: 2
```

**Comandos executados:**
```bash
npm run daemon:stop
# Equivale a: pm2 stop agente-gpt dashboard-web
```

#### [3] Restart System

**Funcionalidade:**
- Reload sem downtime (zero-downtime restart)
- Mantém conexões ativas durante restart
- Usa PM2 cluster mode

**Uso:**
```
Escolha uma opção: 3
```

**Comandos executados:**
```bash
npm run daemon:reload
# Equivale a: pm2 reload agente-gpt dashboard-web
```

#### [4] Status Check

**Funcionalidade:**
- Lista processos PM2 com PID, status, memória, CPU
- Verifica health endpoints (Chrome, PM2, Kernel, Disk)
- Mostra status da fila

**Uso:**
```
Escolha uma opção: 4
```

**Output esperado:**
```
[PM2 Processes]
  agente-gpt: online (PID: 12345, Memory: 450MB)
  dashboard-web: online (PID: 12346, Memory: 180MB)

[Health Checks]
  Chrome: healthy
  PM2: healthy
  Kernel: healthy
  Disk: healthy (120MB)

[Queue Status]
  PENDING: 3 tarefas
  RUNNING: 1 tarefa
  DONE: 45 tarefas
  FAILED: 0 tarefas
```

#### [5] View Logs

**Funcionalidade:**
- 4 modos de visualização:
  1. PM2 Logs (agente + dashboard)
  2. Error Logs
  3. Application Logs
  4. Todos os logs

**Uso:**
```
Escolha uma opção: 5
Opção: 1  # PM2 logs em tempo real
```

**Comandos executados:**
```bash
# Opção 1: pm2 logs
# Opção 2: tail -f logs/error.log
# Opção 3: tail -f logs/application.log
# Opção 4: pm2 logs --raw --lines 100
```

#### [6] Open PM2 GUI

**Funcionalidade:**
- Abre pm2-gui (interface Electron)
- Instala automaticamente se não encontrado
- Dashboard: http://localhost:8088

**Uso:**
```
Escolha uma opção: 6
```

**Primeira vez:**
```
pm2-gui não está instalado.
Deseja instalar agora? (S/N): S

Instalando pm2-gui...
✓ Instalação concluída!
Abrindo pm2-gui...
```

**Recursos pm2-gui:**
- Dashboard visual de processos
- Monitoramento CPU/RAM em tempo real
- Logs integrados
- Controles start/stop/restart
- Gratuito e open-source

#### [7] PM2 Monit

**Funcionalidade:**
- Dashboard CLI oficial do PM2
- Monitoramento interativo no terminal

**Uso:**
```
Escolha uma opção: 7
```

**Interface:**
```
┌─ PM2 Monit ─────────────────────────────────────┐
│                                                  │
│  agente-gpt         ▓▓▓▓░░░░░░  CPU: 45%       │
│                     ████████░░  RAM: 450MB      │
│                                                  │
│  dashboard-web      ▓░░░░░░░░░  CPU: 12%       │
│                     ██░░░░░░░░  RAM: 180MB      │
│                                                  │
│  [Logs]                                         │
│  2026-01-21 06:30:15 [INFO] Task completed      │
│  2026-01-21 06:30:20 [INFO] Health check OK     │
└──────────────────────────────────────────────────┘
```

#### [8] Clean System

**Funcionalidade:**
- Remove logs antigos (mantém 7 dias)
- Limpa arquivos temporários (.tmp)
- Limpa cache PM2
- Limpa crash reports processados

**Uso:**
```
Escolha uma opção: 8
Confirma limpeza? (S/N): S
```

**Comandos executados:**
```bash
npm run clean
```

**O que é removido:**
- `logs/*.log` (>7 dias)
- `**/*.tmp.*`
- `logs/crash_reports/*.processed`
- Cache interno PM2

#### [9] Diagnose Crashes

**Funcionalidade:**
- Lista crash reports recentes
- Exibe stack traces
- Executa análise forense completa

**Uso:**
```
Escolha uma opção: 9
```

**Output esperado:**
```
Analisando crash reports...

Crash: crash-20260121-060000-12345.txt
  ERROR: Unhandled promise rejection
  at taskRunner.js:145:22
  Error: Target closed

Executando diagnóstico completo...
[DIAGNÓSTICO] 1 crash(es) identificado(s)
[CAUSA] Chrome connection lost
[SOLUÇÃO] Verificar logs/crash_reports/ para detalhes
```

#### [10] Backup Configuration

**Funcionalidade:**
- Snapshot de configs críticos
- Copia fila de tarefas
- Timestamp automático

**Uso:**
```
Escolha uma opção: 10
```

**Arquivos incluídos:**
```
backups/manual-20260121-063000-12345/
├── config.json
├── controle.json
├── dynamic_rules.json
├── ecosystem.config.js
├── chrome-config.json
├── package.json
└── fila/
    ├── task-001.json
    ├── task-002.json
    └── ...
```

---

## 🛠️ Scripts Utilitários

### quick-ops - Operações Rápidas

**Localização:** `scripts/quick-ops.bat` (Windows) | `scripts/quick-ops.sh` (Linux/Mac)

**Comandos disponíveis:**

```bash
# Iniciar sistema
./scripts/quick-ops.sh start

# Parar sistema
./scripts/quick-ops.sh stop

# Reiniciar (zero downtime)
./scripts/quick-ops.sh restart

# Status PM2
./scripts/quick-ops.sh status

# Health check
./scripts/quick-ops.sh health
# Output:
#   Status: healthy
#   Components: chrome, pm2, kernel, disk

# Logs (todos)
./scripts/quick-ops.sh logs

# Logs (app específico)
./scripts/quick-ops.sh logs agente-gpt

# Backup rápido
./scripts/quick-ops.sh backup
# Output: Backup: backups/quickops-20260121-063000-12345

# Ajuda
./scripts/quick-ops.sh help
```

**Casos de uso:**
- Automação via cron/systemd
- CI/CD pipelines
- Scripts de manutenção
- Operações rápidas sem abrir launcher

### watch-logs - Monitoramento em Tempo Real

**Localização:** `scripts/watch-logs.bat` | `scripts/watch-logs.sh`

**Uso básico:**
```bash
# Todos os logs
./scripts/watch-logs.sh

# Filtrar por nível
./scripts/watch-logs.sh error
./scripts/watch-logs.sh warn
./scripts/watch-logs.sh info
./scripts/watch-logs.sh debug
```

**Saída esperada:**
```
============================================================
  WATCH-LOGS - Monitoramento em Tempo Real
============================================================

Modo: Filtro 'error'
Pressione Ctrl+C para sair

2026-01-21 06:30:15 | agente-gpt | [ERROR] Task execution failed
2026-01-21 06:30:20 | agente-gpt | [ERROR] Timeout waiting for selector
...
```

**Casos de uso:**
- Debug em produção
- Monitoramento de erros
- Análise de performance
- Troubleshooting em tempo real

### install-pm2-gui - Instalador PM2 GUI

**Localização:** `scripts/install-pm2-gui.bat` | `scripts/install-pm2-gui.sh`

**Funcionalidade:**
- Detecta se pm2-gui já está instalado
- Instala via npm global
- Abre automaticamente após instalação

**Uso:**
```bash
./scripts/install-pm2-gui.sh

# Saída:
# pm2-gui não encontrado no sistema.
# Deseja instalar pm2-gui globalmente? (s/n): s
#
# Instalando pm2-gui via npm...
# Isso pode levar alguns minutos...
#
# [SUCCESS] pm2-gui instalado com sucesso!
#
# Para usar:
#   1. Execute: pm2-gui
#   2. Acesse: http://localhost:8088
```

**Repositório:** https://github.com/Tjatse/pm2-gui

### setup-pm2-plus - Guia PM2 Plus

**Localização:** `scripts/setup-pm2-plus.bat` | `scripts/setup-pm2-plus.sh`

**Funcionalidade:**
- Guia interativo para configuração PM2 Plus
- Abre site oficial
- **OPCIONAL** - Sistema funciona 100% standalone

**Uso:**
```bash
./scripts/setup-pm2-plus.sh

# Saída:
# PM2 PLUS - Monitoramento Cloud Profissional
#
# O PM2 Plus é um serviço cloud OPCIONAL da Keymetrics
# para monitoramento avançado de aplicações PM2.
#
# Recursos (plano FREE até 4 servidores):
#   - Dashboard web centralizado
#   - Métricas em tempo real (CPU, RAM, eventos)
#   - Alertas e notificações
#   - Logs centralizados
#
# INSTRUÇÕES DE SETUP:
# 1. Acesse: https://app.pm2.io/
# 2. Crie uma conta gratuita
# 3. Crie um novo "Bucket" para este projeto
# 4. Copie a chave pública e privada fornecidas
# 5. Execute: pm2 link [chave-secreta] [chave-publica]
```

**Nota:** Este projeto NÃO requer PM2 Plus para funcionar.

---

## 📊 Dashboard HTML

### Visão Geral

**Localização:** `scripts/launcher-dashboard.html`

**Características:**
- ✅ Standalone (funciona sem servidor Node.js rodando - apenas precisa do server para dados)
- ✅ Auto-refresh a cada 5 segundos
- ✅ Dark theme (VS Code style)
- ✅ 5 cards de monitoramento
- ✅ Status badges coloridos
- ✅ Responsivo (grid adaptativo)

### Como Usar

**Método 1: Abrir diretamente**
```bash
# Windows
start scripts/launcher-dashboard.html

# Linux/Mac
open scripts/launcher-dashboard.html
# ou
xdg-open scripts/launcher-dashboard.html
```

**Método 2: Via servidor HTTP local**
```bash
# Servidor Python (porta 8000)
python3 -m http.server 8000
# Acesse: http://localhost:8000/scripts/launcher-dashboard.html

# Servidor Node (live-server)
npx live-server --port=8000
```

### Cards Disponíveis

#### 🖥️ Server Card

**Dados exibidos:**
- Status geral (healthy/unhealthy)
- Timestamp da última verificação

**Endpoint:** `GET /api/health`

**Exemplo:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-21T06:30:00.000Z"
}
```

#### 🌐 Chrome Debug Card

**Dados exibidos:**
- Conectado (Sim/Não)
- Endpoint debug
- Versão Chrome
- Latência (ms)

**Endpoint:** `GET /api/health/chrome`

**Exemplo:**
```json
{
  "status": "healthy",
  "connected": true,
  "endpoint": "http://localhost:9222",
  "version": "Chrome/120.0.0.0",
  "latency_ms": 12
}
```

#### ⚙️ PM2 Processes Card

**Dados exibidos:**
- Total de processos
- Processos online
- Lista de processos com status

**Endpoint:** `GET /api/health/pm2`

**Exemplo:**
```json
{
  "status": "healthy",
  "processes": [
    {
      "name": "agente-gpt",
      "status": "online",
      "pid": 12345,
      "uptime": "2h 30m",
      "restarts": 0,
      "memory": "450MB",
      "cpu": "45%"
    }
  ]
}
```

#### 🧠 Kernel Card

**Dados exibidos:**
- State (running/idle/error)
- Active (Sim/Não)
- NERV Bus status

**Endpoint:** `GET /api/health/kernel`

**Exemplo:**
```json
{
  "status": "healthy",
  "state": "running",
  "active": true,
  "nervBus": "available"
}
```

#### 💾 Disk Usage Card

**Dados exibidos:**
- Uso total (MB)
- Logs, Queue, Responses (MB)
- Barra de progresso visual
- Alertas (warning/critical)

**Endpoint:** `GET /api/health/disk`

**Exemplo:**
```json
{
  "status": "healthy",
  "usage": {
    "logs": { "bytes": 104857600, "mb": 100, "files": 50 },
    "queue": { "bytes": 10485760, "mb": 10, "files": 5 },
    "responses": { "bytes": 5242880, "mb": 5, "files": 3 },
    "total": { "bytes": 120586240, "mb": 115 }
  },
  "alerts": [],
  "thresholds": {
    "warning_mb": 500,
    "critical_mb": 1024
  }
}
```

### Status Badges

**Cores:**
- 🟢 **Healthy** - Verde (#4ec9b0)
- 🔴 **Unhealthy** - Vermelho (#f44747)
- 🟡 **Warning** - Amarelo (#ce9178)
- 🔵 **Loading** - Azul (#569cd6)

---

## 🔍 Health Endpoints

### Arquitetura

Todos os endpoints estão em `src/server/api/router.js` e seguem o padrão:

```javascript
app.get('/api/health/:component?', async (req, res) => {
    // Validação
    // Fetch de dados
    // Status code: 200 (healthy) ou 503 (unhealthy)
    res.status(statusCode).json({ ... });
});
```

### Endpoint: GET /api/health

**Descrição:** Agregador geral de saúde do sistema

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-21T06:30:00.000Z",
  "components": {
    "chrome": "healthy",
    "pm2": "healthy",
    "kernel": "healthy",
    "disk": "healthy"
  }
}
```

### Endpoint: GET /api/health/chrome

**Descrição:** Valida conexão Chrome debug port

**Implementação:**
```javascript
const chrome = await doctor.probeChromeConnection();
res.status(chrome.connected ? 200 : 503).json({
    status: chrome.connected ? 'healthy' : 'unhealthy',
    connected: chrome.connected,
    endpoint: chrome.endpoint,
    version: chrome.version,
    latency_ms: chrome.latency_ms
});
```

**Casos de uso:**
- Verificar se Chrome está disponível para automação
- Detectar problemas de conexão debug port
- Monitorar latência de comunicação

### Endpoint: GET /api/health/pm2

**Descrição:** Lista processos PM2 com métricas

**Implementação:**
```javascript
const agentStatus = await system.getAgentStatus();
const pm2List = await pm2.list();
const processes = pm2List.map(proc => ({
    name: proc.name,
    status: proc.pm2_env.status,
    pid: proc.pid,
    uptime: formatUptime(proc.pm2_env.pm_uptime),
    restarts: proc.pm2_env.restart_time,
    memory: formatMemory(proc.monit.memory),
    cpu: proc.monit.cpu + '%'
}));
```

**Casos de uso:**
- Monitorar saúde de processos PM2
- Detectar processos offline
- Acompanhar uso de memória/CPU

### Endpoint: GET /api/health/kernel

**Descrição:** Verifica estado Kernel via NERV bus

**Implementação:**
```javascript
// Tenta ping NERV
const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Kernel timeout')), 2000);
    nerv.emit({
        messageType: 'REQUEST',
        actionCode: 'KERNEL_STATUS',
        sender: { componentId: 'health-check', instanceId: 'api' },
        payload: {}
    });
    // Observer aguarda resposta...
});

// Fallback: verifica tarefas ativas
const io = require('../../infra/io');
const tasks = await io.loadAllTasks();
const runningTasks = tasks.filter(t => t.status === STATUS_VALUES.RUNNING).length;
isActive = runningTasks > 0;
```

**Casos de uso:**
- Verificar se Kernel está processando tarefas
- Detectar travamentos no loop principal
- Monitorar NERV bus

### Endpoint: GET /api/health/disk

**Descrição:** Monitora uso de disco com alertas

**Implementação:**
```javascript
const getDirSize = dirPath => {
    const output = execSync(`du -sb "${dirPath}"`, { encoding: 'utf-8' });
    return parseInt(output.split('\t')[0]);
};

const logsSize = getDirSize(path.join(ROOT, 'logs'));
const queueSize = getDirSize(path.join(ROOT, 'fila'));
const responsesSize = getDirSize(path.join(ROOT, 'respostas'));
const totalSize = logsSize + queueSize + responsesSize;

// Alertas
const alerts = [];
if (totalSize > 1024 * 1024 * 1024) {
    alerts.push('CRITICAL: Disk usage exceeds 1GB!');
} else if (totalSize > 500 * 1024 * 1024) {
    alerts.push('WARNING: Disk usage exceeds 500MB');
}
```

**Casos de uso:**
- Prevenir estouro de disco
- Alertar sobre crescimento de logs
- Monitorar fila de tarefas

---

## 🔧 Troubleshooting

### Problemas Comuns

#### 1. Launcher não inicia

**Sintoma:**
```
'node' is not recognized as an internal or external command
```

**Solução:**
```bash
# Instalar Node.js
# Windows: https://nodejs.org/
# Linux: sudo apt install nodejs npm
# Mac: brew install node

# Verificar instalação
node --version
npm --version
```

#### 2. PM2 não encontrado

**Sintoma:**
```
'pm2' is not recognized as an internal or external command
```

**Solução:**
```bash
# Instalar PM2 globalmente
npm install -g pm2

# Verificar instalação
pm2 --version

# Se ainda não funcionar, adicionar ao PATH
# Windows: C:\Users\<user>\AppData\Roaming\npm
# Linux/Mac: já deve estar no PATH
```

#### 3. Health endpoints não respondem

**Sintoma:**
```
[ERROR] Health endpoint not responding
```

**Causas possíveis:**
- Servidor não está rodando
- Porta 2998 ocupada
- Firewall bloqueando

**Solução:**
```bash
# 1. Verificar se servidor está rodando
pm2 list
# Deve mostrar 'dashboard-web' como 'online'

# 2. Verificar porta
netstat -an | grep 2998  # Linux/Mac
netstat -an | findstr 2998  # Windows

# 3. Testar manualmente
curl http://localhost:2998/api/health
# Deve retornar JSON com status

# 4. Verificar logs
pm2 logs dashboard-web --lines 50
```

#### 4. Chrome connection failed

**Sintoma:**
```json
{
  "status": "unhealthy",
  "connected": false,
  "error": "Connection refused"
}
```

**Causas possíveis:**
- Chrome não está rodando em modo debug
- Porta 9222 ocupada
- Configuração incorreta

**Solução:**
```bash
# 1. Verificar chrome-config.json
cat chrome-config.json
# Deve conter: "ports": [9222, 9223, 9224]

# 2. Iniciar Chrome em modo debug manualmente
# Windows:
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

# Linux:
google-chrome --remote-debugging-port=9222

# 3. Testar conexão
curl http://localhost:9222/json/version
```

#### 5. Crash loop detected

**Sintoma:**
```
⚠ 5 crash(es) detectado(s)!
Execute opção [9] para diagnóstico
```

**Solução:**
```bash
# 1. Analisar crashes
./launcher.sh
# Escolher opção [9] Diagnose Crashes

# 2. Ver detalhes
ls -l logs/crash_reports/
cat logs/crash_reports/crash-latest.txt

# 3. Causas comuns:
# - Chrome connection lost → Verificar Chrome debug
# - Memory limit exceeded → Aumentar em ecosystem.config.js
# - Unhandled rejection → Bug no código, verificar logs

# 4. Limpar crash reports processados
rm logs/crash_reports/*.processed
```

#### 6. Disk space warning

**Sintoma:**
```json
{
  "status": "warning",
  "alerts": ["WARNING: Logs acumulados: 450 arquivos"]
}
```

**Solução:**
```bash
# 1. Verificar uso atual
du -sh logs/ fila/ respostas/

# 2. Limpar via launcher
./launcher.sh
# Escolher opção [8] Clean System

# 3. Limpar manualmente
# Logs >7 dias
find logs/ -name "*.log" -mtime +7 -delete

# Crash reports processados
rm logs/crash_reports/*.processed

# Arquivos temporários
find . -name "*.tmp.*" -delete
```

### Logs de Debug

**Localizações importantes:**
```
logs/
├── application.log          # Log principal da aplicação
├── error.log               # Apenas erros
├── launcher.log            # Log do launcher (criado automaticamente)
├── pm2/                    # Logs PM2
│   ├── agente-gpt-out.log
│   ├── agente-gpt-error.log
│   ├── dashboard-web-out.log
│   └── dashboard-web-error.log
└── crash_reports/          # Dumps de crashes
    ├── crash-20260121-*.txt
    └── forensics-*.json
```

**Ver logs em tempo real:**
```bash
# PM2 logs agregados
pm2 logs

# Log específico
pm2 logs agente-gpt

# Seguir arquivo
tail -f logs/application.log
tail -f logs/error.log
```

---

## 📊 Comparação de Ferramentas

### Super Launcher vs PM2 GUI vs Tauri vs Dashboard Web

| Critério | Super Launcher | PM2 GUI | Tauri | Dashboard Web |
|----------|----------------|---------|-------|---------------|
| **Instalação** | ✅ Imediata (scripts) | ⚠️ npm install -g | ❌ Build complexo (10h) | ⏳ Futuro (50-70h) |
| **Dependências** | ✅ Node + PM2 apenas | ⚠️ Electron (~200MB) | ❌ Rust + Node + Webview | ⚠️ Next.js stack |
| **Tempo Setup** | ✅ <5min | ⚠️ ~15min | ❌ ~2h | ⏳ N/A (não criado) |
| **Cross-platform** | ✅ Windows + Linux + Mac | ✅ Windows + Linux + Mac | ✅ Windows + Linux + Mac | ✅ Browser-based |
| **Interface** | ✅ Menu interativo CLI | ✅ Electron GUI | ✅ Native GUI | ✅ Web dashboard |
| **Health Checks** | ✅✅ 5 endpoints integrados | ❌ Apenas PM2 | ❌ Requer implementação | ✅✅ Customizável |
| **Automação** | ✅✅ Scripts + CLI | ⚠️ Via PM2 API | ⚠️ Via API REST | ✅ Via API |
| **Monitoramento** | ✅ Real-time (5s refresh) | ✅ Real-time | ✅ Real-time | ✅ Real-time |
| **Backup** | ✅ Automático + manual | ❌ Não tem | ❌ Requer implementação | ⏳ Planejado |
| **Crash Detection** | ✅✅ Análise forense | ⚠️ Básico | ❌ Requer implementação | ⏳ Planejado |
| **Logs** | ✅ 4 modos visualização | ✅ Integrado | ⚠️ Requer implementação | ✅ Planejado |
| **Validações** | ✅✅ 5 pré-boot | ❌ Não tem | ❌ Requer implementação | ⏳ Planejado |
| **Manutenção** | ✅ Baixa | ⚠️ Média (updates Electron) | ❌ Alta (Rust + deps) | ⚠️ Média (Next.js) |
| **Footprint** | ✅ ~50KB scripts | ⚠️ ~200MB instalado | ❌ ~500MB build | ⚠️ ~100MB node_modules |
| **Pronto para uso** | ✅✅ Sim (implementado) | ✅ Sim (existente) | ❌ Não (10h dev) | ❌ Não (50-70h dev) |

### Recomendações de Uso

**Use Super Launcher quando:**
- ✅ Quer algo imediato e funcional
- ✅ Prefere CLI/terminal
- ✅ Precisa automação via scripts
- ✅ Quer health checks integrados
- ✅ Precisa validações pré-boot
- ✅ Quer backups automáticos

**Use PM2 GUI quando:**
- ✅ Prefere interface gráfica Electron
- ✅ Quer dashboard visual bonito
- ⚠️ Não se importa com ~200MB instalado
- ⚠️ Não precisa health checks customizados

**Use Tauri quando:**
- ❌ **NÃO RECOMENDADO no momento**
- Motivo: 10h de desenvolvimento para features que Super Launcher já tem
- Considerar apenas se precisar: distribuição standalone, menor footprint que Electron

**Use Dashboard Web (futuro) quando:**
- ⏳ For implementado (estimativa: 50-70h)
- ✅ Precisar acesso remoto via browser
- ✅ Precisar interface customizada avançada
- ✅ Precisar integrações com outros sistemas

### Estratégia Atual: PM2-First

**Decisão arquitetural:**
1. **Fase 1 (Concluída)**: Super Launcher + Scripts CLI + Dashboard HTML
2. **Fase 2 (Futuro)**: Dashboard Web customizado (Next.js)
3. **Fase 3 (Opcional)**: Tauri se necessário

**Justificativa:**
- Super Launcher entrega 80% das features necessárias em 3-5h
- Tauri levaria 10h para entregar 90% das features
- Dashboard Web levará 50-70h mas será mais completo e extensível
- PM2 é battle-tested e suficiente para gerenciamento de processos

---

## 💡 Exemplos Práticos

### Caso 1: Deploy em Produção

```bash
# 1. Clonar projeto no servidor
ssh usuario@servidor
git clone https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git
cd chatgpt-docker-puppeteer

# 2. Setup inicial
npm install
chmod +x launcher.sh scripts/*.sh

# 3. Iniciar via launcher
./launcher.sh
# Escolher: [1] Start System

# 4. Verificar status
./scripts/quick-ops.sh health
# Output: Status: healthy

# 5. Configurar systemd para boot automático
sudo nano /etc/systemd/system/chatgpt-agent.service

# Conteúdo:
[Unit]
Description=ChatGPT Agent via PM2
After=network.target

[Service]
Type=forking
User=usuario
WorkingDirectory=/home/usuario/chatgpt-docker-puppeteer
ExecStart=/usr/bin/npm run daemon:start
ExecStop=/usr/bin/npm run daemon:stop
Restart=on-failure

[Install]
WantedBy=multi-user.target

# 6. Habilitar e iniciar
sudo systemctl enable chatgpt-agent
sudo systemctl start chatgpt-agent

# 7. Monitorar
./scripts/quick-ops.sh status
```

### Caso 2: Debug de Problema

```bash
# 1. Sistema apresenta erro
# Sintoma: Tasks não processam

# 2. Verificar status geral
./scripts/quick-ops.sh status

# Output:
# [PM2 Processes]
#   agente-gpt: online (PID: 12345, Memory: 450MB)
#   dashboard-web: online (PID: 12346, Memory: 180MB)
#
# [Health Checks]
#   Chrome: unhealthy  ← PROBLEMA!
#   PM2: healthy
#   Kernel: healthy
#   Disk: healthy

# 3. Investigar Chrome
curl http://localhost:2998/api/health/chrome
# Output: {"status":"unhealthy","connected":false,"error":"ECONNREFUSED"}

# 4. Verificar Chrome debug port
netstat -an | grep 9222
# Saída vazia = Chrome não está rodando

# 5. Iniciar Chrome manualmente
google-chrome --remote-debugging-port=9222 &

# 6. Verificar novamente
./scripts/quick-ops.sh health
# Output: Chrome: healthy ✅

# 7. Reiniciar agente para reconectar
./scripts/quick-ops.sh restart

# 8. Confirmar funcionamento
./scripts/watch-logs.sh info | grep "Task"
# Output:
# 2026-01-21 06:45:30 | [INFO] Task started: task-001
# 2026-01-21 06:45:35 | [INFO] Task completed: task-001
```

### Caso 3: Manutenção Programada

```bash
# 1. Criar backup antes da manutenção
./launcher.sh
# Escolher: [10] Backup Configuration
# Output: Backup: backups/manual-20260121-070000-12345

# 2. Parar sistema
./scripts/quick-ops.sh stop

# 3. Realizar manutenção
# (atualizar código, configs, dependências, etc)
git pull origin main
npm install

# 4. Limpar arquivos antigos
./launcher.sh
# Escolher: [8] Clean System

# 5. Iniciar com validações completas
./launcher.sh
# Escolher: [1] Start System
# Validações automáticas irão verificar tudo

# 6. Monitorar inicialização
./scripts/watch-logs.sh info

# 7. Verificar health
./scripts/quick-ops.sh health
# Garantir que todos componentes estão healthy

# 8. Se algo der errado, restaurar backup
# cp -r backups/manual-20260121-070000-12345/* .
# ./scripts/quick-ops.sh restart
```

### Caso 4: Automação via Cron

```bash
# Exemplo: Health check automático a cada 5 minutos

# 1. Criar script de verificação
nano /home/usuario/check-health.sh

#!/bin/bash
cd /home/usuario/chatgpt-docker-puppeteer
OUTPUT=$(/home/usuario/chatgpt-docker-puppeteer/scripts/quick-ops.sh health)

if echo "$OUTPUT" | grep -q "unhealthy"; then
    # Enviar alerta (email, Slack, etc)
    echo "ALERT: System unhealthy!" | mail -s "ChatGPT Agent Alert" admin@example.com

    # Log
    echo "[$(date)] Health check failed: $OUTPUT" >> /var/log/chatgpt-health.log

    # Tentar restart automático
    /home/usuario/chatgpt-docker-puppeteer/scripts/quick-ops.sh restart
fi

# 2. Tornar executável
chmod +x /home/usuario/check-health.sh

# 3. Adicionar ao crontab
crontab -e

# Adicionar linha:
*/5 * * * * /home/usuario/check-health.sh

# 4. Verificar cron está rodando
sudo systemctl status cron
```

### Caso 5: Integração CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Deploy to server
        run: |
          ssh ${{ secrets.SSH_USER }}@${{ secrets.SSH_HOST }} << 'EOF'
            cd /var/www/chatgpt-agent
            git pull origin main
            npm install

            # Backup antes deploy
            ./scripts/quick-ops.sh backup

            # Restart com zero downtime
            ./scripts/quick-ops.sh restart

            # Health check
            sleep 10
            HEALTH=$(./scripts/quick-ops.sh health)
            if echo "$HEALTH" | grep -q "unhealthy"; then
              echo "Deployment failed health check!"
              exit 1
            fi

            echo "Deployment successful!"
          EOF
```

---

## 📚 Referências

### Documentação Oficial

- **PM2**: https://pm2.keymetrics.io/docs/
- **Node.js**: https://nodejs.org/docs/
- **Puppeteer**: https://pptr.dev/
- **pm2-gui**: https://github.com/Tjatse/pm2-gui
- **PM2 Plus**: https://app.pm2.io/

### Arquivos do Projeto

- `ecosystem.config.js` - Configuração PM2
- `config.json` - Configuração global
- `src/infra/ConnectionOrchestrator.js` - Gerenciador Chrome
- `src/server/api/router.js` - Health endpoints
- `PLANO_EXECUCAO_LAUNCHER.md` - Plano de implementação
- `ROADMAP_LAUNCHER_DASHBOARD.md` - Roadmap geral

### Auditorias e Correções

- `DOCUMENTAÇÃO/AUDITORIAS/CROSS_CUTTING_PM2_DAEMON_AUDIT.md` - Auditoria PM2 (P3.1-P3.5)
- Commit 7478a01 - Implementação correções P3

---

## 🆘 Suporte

**Problemas não resolvidos?**

1. Verificar logs: `logs/error.log`, `logs/application.log`
2. Executar diagnóstico: Opção [9] no launcher
3. Verificar issues: https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/issues
4. Criar issue detalhando:
   - Sistema operacional
   - Versão Node.js/PM2
   - Logs relevantes
   - Passos para reproduzir

---

**Documentação atualizada:** 2026-01-21
**Versão Launcher:** 2.0
**Estratégia:** PM2-First (Opção A)
