# PM2 Sovereign - Quick Reference

> **Referência rápida para PM2 como Gerenciador Soberano**

---

## TL;DR

```bash
# Startup seguro
bash scripts/pm2-startup.sh

# Health check (6 validações)
bash scripts/pm2-check.sh

# Auto-fix problemas
bash scripts/pm2-check.sh --fix

# Validar configuração
make pm2-validate
```

---

## Comandos Essenciais

### Lifecycle

```bash
# Iniciar sistema
pm2 start ecosystem.config.js
make start

# Parar
pm2 stop all
make stop

# Restart (com downtime)
pm2 restart all

# Reload (zero-downtime - produção)
pm2 reload all
```

### Monitoring

```bash
# Status
pm2 status
pm2 list

# Logs
pm2 logs                    # Todos os processos
pm2 logs agente-gpt         # Processo específico
pm2 logs --lines 50         # Últimas 50 linhas
pm2 logs --err              # Apenas erros

# Monitor real-time
pm2 monit
```

### Health

```bash
# Health check completo
make pm2-check

# Auto-fix
make pm2-check-fix

# Validar configuração
make pm2-validate
```

---

## 3 Processos Gerenciados

| Processo          | Script                            | Porta | Memory | Papel                     |
| ----------------- | --------------------------------- | ----- | ------ | ------------------------- |
| **agente-gpt**    | `index.js`                        | -     | 3GB    | Maestro (orquestrador)    |
| **dashboard-web** | `src/server/main.js`              | 3008  | 3GB    | HTTP + API + Dashboard    |
| **chrome-proxy**  | `scripts/chrome-proxy-service.js` | 9224  | 500MB  | Windows ↔ Container proxy |

---

## Environment Variables (Enforced)

### agente-gpt

```bash
SERVER_MODE=split              # PM2 SOBERANO
SERVER_AUTHORITY=standalone    # Signals independentes
CHROME_PROXY_ENABLED=false     # Sem proxy interno
```

### dashboard-web

```bash
PORT=3008
DAEMON_MODE=true               # Standalone
SERVER_AUTHORITY=standalone    # Signals independentes
ENABLE_STATE_FILE=false        # NERV-first
```

---

## Validações (pm2-check.sh)

✅ **6 Checks Automáticos**:

1. PM2 daemon online?
2. Todos os processos rodando?
3. Restarts < 3?
4. Memória dentro dos limites?
5. Env vars corretas?
6. Logs sem erros críticos?

---

## Health Endpoints

```bash
# Core health
curl http://localhost:3008/api/health

# PM2-specific
curl http://localhost:3008/api/health/pm2
```

**Response** (`/api/health/pm2`):

```json
{
  "status": "ok",
  "processes": [
    {
      "name": "agente-gpt",
      "status": "online",
      "pid": 12345,
      "restarts": 0,
      "uptime": 3600000,
      "memory": 256000000,
      "cpu": 2.5
    }
  ]
}
```

---

## Troubleshooting Quick Guide

### Processo não inicia

```bash
pm2 logs <process-name> --lines 50
pm2 restart <process-name>
```

### Restarts excessivos

```bash
pm2 logs <process-name> --err --lines 100
pm2 monit  # Verificar memória
```

### PM2 daemon travado

```bash
pm2 kill
pm2 start ecosystem.config.js
```

### EADDRINUSE (porta ocupada)

```bash
lsof -i :3008
kill -9 <PID>
```

---

## Best Practices

1. ✅ **Sempre use PM2** (nunca `node` direto)
2. ✅ **`SERVER_MODE=split`** obrigatório em PM2
3. ✅ **`pm2 reload`** em produção (zero-downtime)
4. ✅ **Startup script** para boot do sistema
5. ✅ **Log rotation** para evitar logs gigantes

---

## Makefile Shortcuts

```bash
make start          # Iniciar PM2
make stop           # Parar PM2
make restart        # Reiniciar
make health         # Health check
make pm2-check      # 6 validações
make pm2-startup    # Startup seguro
make pm2-validate   # Validar config
```

---

## Socket.io Events (Dashboard)

```javascript
// Process events
socket.on('pm2:process:event', data => { ... });

// Critical events only
socket.on('pm2:process:critical', data => { ... });

// Initial snapshot
socket.on('pm2:snapshot', snapshot => { ... });

// Periodic metrics (30s)
socket.on('pm2:metrics', data => { ... });
```

---

## Documentação Completa

📖 [PM2_SOVEREIGN_ARCHITECTURE.md](./PM2_SOVEREIGN_ARCHITECTURE.md) (14,000+ palavras)

**Seções**:

1. Por Que PM2 Soberano?
2. Arquitetura de Enforcement
3. Processos Gerenciados
4. Configuração (ecosystem.config.js)
5. Monitoramento (pm2_bridge.js)
6. Health Checks
7. Scripts de Gestão
8. Best Practices
9. Troubleshooting
10. Evolução Futura

---

**Versão**: 3.0 (Fev 2026) **Status**: ✅ Implementado
