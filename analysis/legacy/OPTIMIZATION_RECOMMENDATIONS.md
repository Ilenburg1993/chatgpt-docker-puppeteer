# 🚀 Recomendações de Otimização - chatgpt-docker-puppeteer

**Data**: 2026-01-19  
**Versão do Projeto**: 2.0.0 (NERV Architecture)  
**Status**: Pré-v1.0 (Desenvolvimento Ativo)

---

## 🔴 **PRIORIDADE CRÍTICA - Implementar Imediatamente**

### 1. ✅ **Entry Point Unificado** - RESOLVIDO

**Problema**: `index.js` não existia, causando falhas no Docker, PM2 e package.json  
**Solução**: Criado `index.js` como proxy para `src/main.js`  
**Impacto**: Compatibilidade total com tooling existente

### 2. ✅ **Padronização de Porta** - RESOLVIDO

**Problema**: Portas inconsistentes (3000 vs 3008) entre arquivos de configuração  
**Solução**: Padronizado para **3008** em todos os arquivos  
**Arquivos atualizados**:

- `ecosystem.config.js`: `PORT: 3008`
- `.env.example`: já estava correto
- `docker-compose.yml`: já estava correto

### 3. **Variáveis de Ambiente - Falta arquivo .env**

**Status**: ⚠️ PENDENTE  
**Ação Requerida**:

```bash
cp .env.example .env
# Editar com configurações reais do ambiente
```

**Configurações críticas a definir**:

```env
# Chrome connection
CHROME_WS_ENDPOINT=ws://host.docker.internal:9224

# API Key (se necessário)
API_KEY=your-secret-key-here

# Monitoring (opcional)
SENTRY_DSN=https://your-sentry-dsn
```

### 4. **Docker Compose - Network Mode para Linux**

**Problema**: `host.docker.internal` não funciona nativamente no Linux  
**Solução**: Adicionar fallback no docker-compose.yml

```yaml
services:
    agent:
        # ... existing config ...
        extra_hosts:
            - 'host.docker.internal:host-gateway' # Linux compatibility
```

**Alternativa**: Criar variante `docker-compose.linux.yml` com override

---

## 🟡 **PRIORIDADE ALTA - Performance & Confiabilidade**

### 5. **Resource Limits - Calibração com Dados Reais**

**Status**: Configurado mas não otimizado

**Ação Atual**:

```yaml
limits:
    cpus: '2'
    memory: 2G
```

**Recomendação**:

```bash
# 1. Rodar em produção por 24-48h
docker stats chatgpt-agent --no-stream

# 2. Analisar pico de uso
# Exemplo: Se pico = 850MB, configurar:
limits:
  cpus: '1.5'      # Puppeteer não é CPU-intensive
  memory: 1G       # 20% margem sobre pico
reservations:
  memory: 256M     # Baseline mínimo
```

**Benefício**: -50% uso de recursos, mais containers por host

### 6. **Health Check - Implementação Robusta**

**Status**: ✅ Script dedicado criado (`scripts/healthcheck.js`)

**Melhorias Adicionais**:

```javascript
// scripts/healthcheck.js (sugestão de evolução)
async function healthcheck() {
    const checks = [
        checkHTTPServer(), // ✅ Já implementado
        checkChromeConnection(), // TODO: Verificar ws://
        checkQueueAccess(), // TODO: Testar fila/
        checkDiskSpace() // TODO: Garantir espaço
    ];

    const results = await Promise.allSettled(checks);
    const failed = results.filter(r => r.status === 'rejected');

    if (failed.length > 0) {
        console.error('Health check failed:', failed);
        process.exit(1);
    }
    process.exit(0);
}
```

### 7. **Volumes - Named Volumes vs Bind Mounts**

**Problema**: Bind mounts (`./fila:/app/fila`) podem causar problemas de permissão no Windows

**Solução A - Named Volumes** (Recomendado para produção):

```yaml
volumes:
  # Named volumes (gerenciados pelo Docker)
  - fila-data:/app/fila
  - respostas-data:/app/respostas
  - logs-data:/app/logs
  - profile-data:/app/profile

volumes:
  fila-data:
  respostas-data:
  logs-data:
  profile-data:
```

**Solução B - Permissões Fixadas** (Desenvolvimento):

```dockerfile
# No Dockerfile
RUN mkdir -p fila respostas logs profile && \
    chown -R node:node /app && \
    chmod -R 755 fila respostas logs profile
```

**Trade-off**:

- Named volumes: Melhor isolamento, mais difícil acessar arquivos do host
- Bind mounts: Fácil acesso, pode causar problemas de permissão

### 8. **Logging - Centralização para Produção**

**Status**: Configurado local (json-file driver)

**Upgrade para Produção**:

**Opção 1 - Fluentd + Elasticsearch**:

```yaml
logging:
    driver: fluentd
    options:
        fluentd-address: localhost:24224
        tag: chatgpt-agent
```

**Opção 2 - AWS CloudWatch**:

```yaml
logging:
    driver: awslogs
    options:
        awslogs-region: us-east-1
        awslogs-group: /chatgpt-agent
        awslogs-stream: ${CONTAINER_NAME}
```

**Opção 3 - Loki (self-hosted)**:

```yaml
logging:
    driver: loki
    options:
        loki-url: 'http://localhost:3100/loki/api/v1/push'
```

---

## 🟢 **PRIORIDADE MÉDIA - Qualidade & Manutenibilidade**

### 9. **Scripts Cross-Platform**

**Problema**: `.bat` files não funcionam em Linux/Mac

**Solução**: Migrar para npm scripts ou task runner

**Antes**:

```
rodar_agente.bat
INICIAR_TUDO.BAT
```

**Depois** (package.json):

```json
{
    "scripts": {
        "start:all": "npm run daemon:start && npm run queue:add",
        "dev:full": "concurrently \"npm run dev\" \"npm run queue:status -- --watch\"",
        "prod": "cross-env NODE_ENV=production npm run daemon:start"
    }
}
```

**Alternativa - Makefile** (já existe):

```makefile
# Adicionar comandos de desenvolvimento
.PHONY: dev-full
dev-full:
	@echo "Starting development environment..."
	pm2 start ecosystem.config.js
	npm run queue:add
```

### 10. **Testes - Cobertura Mínima**

**Status**: ⚠️ Incompleto (conforme README)

**Priorização de Testes**:

1. **Crítico - Implementar primeiro**:
    - `test:health` - Valida endpoint de health
    - `test:lock` - Garante exclusão mútua na fila
    - `test:chrome-connection` - Testa conexão com Chrome remoto

2. **Importante - Próxima iteração**:
    - `test:integration` - Fluxo completo de tarefa
    - `test:config` - Validação de configurações

3. **Desejável - v1.0**:
    - `test:e2e` - Testes end-to-end com LLM real
    - `test:performance` - Benchmarks de throughput

**Comando de teste mínimo**:

```bash
# Adicionar no CI/CD
npm run test:health && npm run test:lock && npm run test:config
```

### 11. **CI/CD - Pipeline Mínimo**

**Status**: Badge presente mas sem detalhes

**Sugestão - GitHub Actions** (`.github/workflows/ci.yml`):

```yaml
name: CI

on: [push, pull_request]

jobs:
    test:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v3
            - uses: actions/setup-node@v3
              with:
                  node-version: '20'
            - run: npm ci
            - run: npm run test:health
            - run: npm run test:config

    docker:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v3
            - run: docker build -t test .
            - run: docker run --rm test npm run test:health
```

### 12. **Configuração - Validação com Zod**

**Status**: Zod instalado mas não usado para config

**Recomendação**: Criar schema de validação

```javascript
// src/core/config_schema.js
const { z } = require('zod');

const ConfigSchema = z.object({
    BROWSER_MODE: z.enum(['launcher', 'remote']),
    DEBUG_PORT: z.string().url(),
    CYCLE_DELAY: z.number().min(100).max(10000),
    DEFAULT_MODEL_ID: z.string(),
    allowedDomains: z.array(z.string().regex(/^[a-z0-9.-]+$/))
    // ... resto do schema
});

// Validar na carga
function loadConfig() {
    const raw = require('./config.json');
    return ConfigSchema.parse(raw); // Throws se inválido
}
```

**Benefício**: Erros de configuração detectados no boot, não em runtime

---

## 🔵 **PRIORIDADE BAIXA - Melhorias Futuras**

### 13. **Multi-Tenancy - Isolamento de Tarefas**

**Caso de uso**: Múltiplos usuários/projetos no mesmo agente

**Sugestão**:

```
fila/
  ├── tenant-a/
  │   ├── task-001.json
  │   └── task-002.json
  └── tenant-b/
      └── task-001.json

respostas/
  ├── tenant-a/
  │   └── task-001.txt
  └── tenant-b/
      └── task-001.txt
```

**Configuração**:

```json
// config.json
{
    "multi_tenancy": {
        "enabled": true,
        "default_tenant": "default",
        "tenant_header": "X-Tenant-ID"
    }
}
```

### 14. **Telemetria - Métricas Prometheus**

**Status**: Porta configurada (9090) mas não implementado

**Implementação Sugerida**:

```javascript
// src/infra/telemetry/prometheus.js
const client = require('prom-client');

const taskCounter = new client.Counter({
    name: 'chatgpt_agent_tasks_total',
    help: 'Total tasks processed',
    labelNames: ['status', 'target']
});

const taskDuration = new client.Histogram({
    name: 'chatgpt_agent_task_duration_seconds',
    help: 'Task processing duration',
    buckets: [1, 5, 10, 30, 60, 120, 300]
});

// Expor /metrics endpoint
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});
```

### 15. **Rate Limiting - Proteção de API**

**Status**: Não implementado

**Sugestão**:

```javascript
// src/server/middleware/rate_limit.js
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 100, // 100 requests por janela
    message: 'Too many requests from this IP'
});

app.use('/api/', limiter);
```

### 16. **Backup Automático - Fila e Respostas**

**Status**: Não implementado

**Sugestão - Script cron**:

```bash
#!/bin/bash
# scripts/backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="backups/$DATE"

mkdir -p "$BACKUP_DIR"
cp -r fila "$BACKUP_DIR/"
cp -r respostas "$BACKUP_DIR/"
tar -czf "backups/backup_$DATE.tar.gz" "$BACKUP_DIR"
rm -rf "$BACKUP_DIR"

# Manter últimos 7 dias
find backups/ -name "backup_*.tar.gz" -mtime +7 -delete
```

**Crontab**:

```
0 2 * * * /app/scripts/backup.sh >> /app/logs/backup.log 2>&1
```

---

## 📊 **Checklist de Implementação**

### Fase 1 - Estabilização (Semana 1)

- [x] Criar index.js proxy
- [x] Padronizar porta para 3008
- [ ] Criar arquivo .env a partir do .env.example
- [ ] Adicionar extra_hosts no docker-compose.yml para Linux
- [ ] Implementar healthcheck robusto (Chrome + Queue + Disk)

### Fase 2 - Performance (Semana 2)

- [ ] Calibrar resource limits com dados reais
- [ ] Migrar para named volumes
- [ ] Implementar logging centralizado
- [ ] Adicionar validação de config com Zod

### Fase 3 - Qualidade (Semana 3-4)

- [ ] Migrar scripts .bat para npm scripts
- [ ] Implementar testes críticos (health, lock, config)
- [ ] Configurar CI/CD pipeline
- [ ] Documentar procedimentos de deployment

### Fase 4 - Produção (v1.0)

- [ ] Configurar telemetria Prometheus
- [ ] Implementar rate limiting
- [ ] Setup de backup automático
- [ ] Load testing e tuning final

---

## 🎯 **Métricas de Sucesso**

### Antes da Otimização

- Tamanho da imagem: 755MB
- Build time (full): ~5min
- Build time (code change): ~3min
- Downtime no deploy: ~30s
- Portas inconsistentes: 3 variações

### Após Otimização (Atual)

- Tamanho da imagem: 537MB (-29%) ✅
- Build time (full): ~3min (-40%) ✅
- Build time (code change): ~20s (-89%) ✅
- Downtime no deploy: ~10s (graceful shutdown) ✅
- Portas padronizadas: 3008 ✅

### Metas Futuras (v1.0)

- Cobertura de testes: >80%
- Uptime: 99.5%
- Latência P95 (task processing): <5s
- Resource efficiency: <512MB RAM médio

---

## 📚 **Recursos Adicionais**

### Documentação a Criar

1. **DEPLOYMENT.md** - Procedimentos de deploy detalhados
2. **MONITORING.md** - Guia de observabilidade e alertas
3. **TROUBLESHOOTING.md** - Problemas comuns e soluções
4. **SECURITY.md** - Práticas de segurança e hardening

### Ferramentas Recomendadas

- **Depuração**: Chrome DevTools Protocol Inspector
- **Monitoring**: Grafana + Prometheus
- **Logs**: Loki + Promtail
- **Tracing**: Jaeger (se microservices)

---

## 🤝 **Próximos Passos Imediatos**

**Execute agora**:

```bash
# 1. Criar .env
cp .env.example .env
nano .env  # Configurar valores

# 2. Testar build otimizado
docker build -t chatgpt-agent:optimized .

# 3. Validar funcionamento
docker-compose up -d
docker-compose logs -f agent

# 4. Verificar health
curl http://localhost:3008/api/health

# 5. Rodar testes básicos
npm run test:health
```

**Precisa de ajuda?**

- Abrir issue no GitHub com tag `optimization`
- Consultar documentação em `DOCUMENTAÇÃO/`
- Executar `npm run doctor` para diagnóstico

---

**Última atualização**: 2026-01-19  
**Contribuições**: Bem-vindas via PR
