# ❓ FAQ (Perguntas Frequentes)

**Versão**: 1.0
**Última Atualização**: 21/01/2026
**Público-Alvo**: Todos
**Tempo de Leitura**: ~20 min

---

## 📖 Visão Geral

Respostas rápidas para **30 perguntas frequentes** sobre o sistema `chatgpt-docker-puppeteer`.

---

## 🗂️ Categorias

1. [Geral](#-geral)
2. [Setup & Instalação](#-setup--instalação)
3. [Uso & Operação](#-uso--operação)
4. [Troubleshooting](#-troubleshooting)
5. [Performance](#-performance)
6. [Segurança](#-segurança)
7. [Desenvolvimento](#-desenvolvimento)
8. [Deploy](#-deploy)

---

## 🌍 Geral

### Q1: O que é chatgpt-docker-puppeteer?

**A**: Sistema autônomo para automação de LLMs (ChatGPT, Gemini) via browser, usando Puppeteer. Processa tasks em fila, coleta respostas, gerencia concorrência com event-driven architecture (NERV).

**Principais features**:
- ✅ Multi-target (ChatGPT, Gemini, extensível)
- ✅ Queue-based (file system)
- ✅ Event-driven (NERV bus)
- ✅ Browser pool (circuit breaker P9.2)
- ✅ Dashboard (HTML + Socket.io)

**Ver**: [PHILOSOPHY.md](PHILOSOPHY.md), [ARCHITECTURE_v2.md](ARCHITECTURE_v2.md)

---

### Q2: Quais LLMs são suportados?

**A**:
- ✅ **ChatGPT** (OpenAI) - Estável
- ✅ **Gemini** (Google) - Estável
- ⏳ **Claude** (Anthropic) - Roadmap Q1 2026

**Como adicionar novos**:
Ver [DEVELOPMENT.md](DEVELOPMENT.md) seção "Adicionar Novo LLM Target".

---

### Q3: É necessário API key dos LLMs?

**A**: **NÃO**. O sistema usa automação de browser (Puppeteer), não APIs oficiais. Funciona com:
- Contas gratuitas (ChatGPT free tier)
- Login manual no browser
- Sem rate limits de API

**Trade-off**: Mais lento que APIs (~45-60s/task vs ~5s/task), mas sem custos.

---

### Q4: Qual a diferença entre launcher vs external vs hybrid mode?

**A**:

| Mode         | Browser                                   | Quando usar                  |
| ------------ | ----------------------------------------- | ---------------------------- |
| **launcher** | Agent inicia browser automaticamente      | Production, Docker, PM2      |
| **external** | Conecta a browser já rodando (porta 9222) | Development (debug DevTools) |
| **hybrid**   | Tenta external, fallback launcher         | Versatilidade (dev/prod)     |

**Config**:
```json
{
  "browserMode": "launcher"  // launcher | external | hybrid
}
```

**Ver**: [CONFIGURATION.md](CONFIGURATION.md)

---

### Q5: Preciso de Docker?

**A**: **Opcional**. 3 opções de deploy:

1. **Native** (Node.js direto):
   - ✅ Simples, rápido setup
   - ✅ Melhor para desenvolvimento
   - ❌ Precisa Node 20+ instalado

2. **PM2** (process manager):
   - ✅ Auto-restart, logs, monitoring
   - ✅ Produção (bare metal)

3. **Docker** (containerizado):
   - ✅ Isolamento, portabilidade
   - ✅ CI/CD, Kubernetes
   - ❌ Overhead de container

**Ver**: [DEPLOYMENT.md](DEPLOYMENT.md)

---

## 🛠️ Setup & Instalação

### Q6: Como instalar o sistema?

**A**: Setup completo em 8 passos:

```bash
# 1. Clone
git clone https://github.com/ORG/chatgpt-docker-puppeteer.git
cd chatgpt-docker-puppeteer

# 2. Install dependencies
npm install

# 3. Create directories
mkdir -p fila respostas logs tmp profile backups

# 4. Configure .env
cp .env.example .env
nano .env  # Editar parâmetros

# 5. Start external browser (se mode: external)
google-chrome --remote-debugging-port=9222 &

# 6. Start system
make start  # ou npm run daemon:start

# 7. Verify health
make health

# 8. Test task
make queue-add
```

**Ver**: [DEVELOPMENT.md](DEVELOPMENT.md) seção "Setup Local"

---

### Q7: Quais são os requisitos mínimos?

**A**:

**Hardware**:
- CPU: 2 cores (4+ recomendado)
- RAM: 1GB (2GB+ recomendado)
- Disk: 500MB + espaço para fila/respostas

**Software**:
- Node.js: ≥20.0.0 LTS
- npm: ≥10.0.0
- Chrome/Edge: Latest stable
- OS: Windows 10+, Ubuntu 20.04+, macOS 10.15+

**Ver**: [CONFIGURATION.md](CONFIGURATION.md) seção "Low-Resource"

---

### Q8: Funciona no Windows?

**A**: **SIM**. Cross-platform completo:
- ✅ Windows 10/11 (cmd, PowerShell, Git Bash)
- ✅ Linux (Ubuntu, Debian, outros)
- ✅ macOS (Intel + Apple Silicon)

**Scripts disponíveis**:
- Windows: `.bat`, `.ps1`
- Linux/macOS: `.sh`

**Ver**: [CROSS_PLATFORM_SUPPORT.md](../CROSS_PLATFORM_SUPPORT.md)

---

### Q9: Como atualizar para nova versão?

**A**:

```bash
# 1. Backup
make backup

# 2. Stop system
make stop

# 3. Pull updates
git pull origin main

# 4. Update dependencies
npm ci --only=production

# 5. Run migrations (se houver)
# (check CHANGELOG.md)

# 6. Restart
make start

# 7. Verify
make health
```

**Breaking changes**: Ver [CHANGELOG.md](../CHANGELOG.md) e migration guides.

---

## 📋 Uso & Operação

### Q10: Como adicionar uma task?

**A**: 3 métodos:

**1. Via Makefile** (interativo):
```bash
make queue-add
# Prompt: Target? chatgpt
# Prompt: Prompt? Explique inteligência artificial
```

**2. Via API**:
```bash
curl -X POST http://localhost:3008/api/queue/add \
  -H "Content-Type: application/json" \
  -d '{
    "target": "chatgpt",
    "prompt": "Explique inteligência artificial",
    "priority": 5
  }'
```

**3. Via arquivo** (manual):
```bash
# Create file: fila/task-abc123.json
{
  "id": "task-abc123",
  "target": "chatgpt",
  "prompt": "Explique inteligência artificial",
  "state": "PENDING",
  "priority": 5,
  "createdAt": 1737450000000
}
```

**Ver**: [API_REFERENCE.md](API_REFERENCE.md) POST `/api/queue/add`

---

### Q11: Como ver o status das tasks?

**A**: 4 opções:

**1. Dashboard HTML**:
```bash
make dashboard
# Abre http://localhost:3008
```

**2. Via API**:
```bash
# Queue summary
curl http://localhost:3008/api/queue | jq '.summary'

# Specific task
curl http://localhost:3008/api/task/task-abc123 | jq
```

**3. Via Makefile**:
```bash
make queue-status
```

**4. Via arquivos**:
```bash
# List PENDING
ls fila/*-PENDING-*.json

# Count by state
ls fila/ | grep -oP '(?<=-)[A-Z]+(?=-)' | sort | uniq -c
```

---

### Q12: Onde ficam as respostas?

**A**: Diretório `respostas/`, um arquivo TXT por task:

```bash
# List responses
ls -lh respostas/

# Read response
cat respostas/task-abc123.txt

# Via API
curl http://localhost:3008/api/response/task-abc123
```

**Formato**: Plain text, UTF-8, sem metadata (apenas conteúdo da resposta LLM).

---

### Q13: Como cancelar uma task?

**A**:

**Via API**:
```bash
curl -X POST http://localhost:3008/api/task/task-abc123/cancel \
  -H "Authorization: Bearer YOUR_PASSWORD"
```

**Manual**:
```bash
# Remove from queue
rm fila/task-abc123.json

# If running, wait for completion or restart agent
```

**Limitação**: Não cancela task já em execução (browser). Aguarda completion ou force restart.

---

### Q14: Como ver os logs?

**A**:

```bash
# PM2 logs (last 100 lines)
make logs

# Follow logs (real-time)
make logs-follow

# Filtered logs (watch-logs script)
make watch-logs

# Direct file access
tail -f logs/agente-gpt-out.log
grep "ERROR" logs/agente-gpt-err.log
```

**Níveis de log**:
- DEBUG: Tudo (desenvolvimento)
- INFO: Eventos importantes (padrão)
- WARN: Avisos (produção)
- ERROR: Apenas erros (crítico)

**Config**: `LOG_LEVEL=INFO` em `.env`

---

## 🐛 Troubleshooting

### Q15: Task ficou stuck em RUNNING, o que fazer?

**A**: Ver [TROUBLESHOOTING.md](TROUBLESHOOTING.md) seção "Task stuck em RUNNING".

**Quick fix**:
```bash
# Cancel via API
curl -X POST http://localhost:3008/api/task/TASK_ID/cancel

# Or restart agent
make restart
```

---

### Q16: Browser não conecta (ECONNREFUSED 9222)

**A**: Ver [TROUBLESHOOTING.md](TROUBLESHOOTING.md) seção "Browser connection failed".

**Quick fix**:
```bash
# Option 1: Start external browser
google-chrome --remote-debugging-port=9222 &

# Option 2: Switch to launcher mode
# config.json: "browserMode": "launcher"
make restart
```

---

### Q17: Memória alta (>800MB)

**A**: Ver [TROUBLESHOOTING.md](TROUBLESHOOTING.md) seção "High memory usage".

**Quick fix**:
```bash
# Restart PM2
make restart

# Reduce workers
# config.json: "maxWorkers": 1
```

---

### Q18: API retorna 401 Unauthorized

**A**: Ver [TROUBLESHOOTING.md](TROUBLESHOOTING.md) seção "Dashboard 401".

**Quick fix**:
```bash
# Include password
curl -u :YOUR_PASSWORD http://localhost:3008/api/queue

# Or disable auth (dev)
# config.json: "dashboardPassword": null
```

---

## ⚡ Performance

### Q19: Quantas tasks/hora o sistema processa?

**A**: Depende da configuração:

| Config          | Workers | Throughput      | CPU | Memory |
| --------------- | ------- | --------------- | --- | ------ |
| Low-resource    | 1       | 10-15 tasks/h   | 8%  | 120MB  |
| Standard        | 3       | 40-50 tasks/h   | 25% | 400MB  |
| High-throughput | 10      | 130-150 tasks/h | 70% | 1.2GB  |

**Ver**: [CONFIGURATION.md](CONFIGURATION.md) seção "Cenários Avançados"

---

### Q20: Como aumentar o throughput?

**A**: Tuning para performance:

```json
// config.json
{
  "maxWorkers": 10,           // De 3 para 10
  "kernelCycleMs": 20,        // De 50 para 20 (50Hz)
  "browserPoolSize": 10,      // Match workers
  "queueConcurrency": 20,     // De 10 para 20
  "adaptiveDelayMin": 30,     // Delays menores
  "adaptiveDelayMax": 100
}
```

**Trade-offs**:
- ➕ +400% throughput
- ➖ +300% CPU usage
- ➖ +700% memory usage
- ⚠️ Risco de rate limiting (LLMs)

---

### Q21: Como reduzir uso de memória/CPU?

**A**: Tuning para low-resource:

```json
// config.json
{
  "maxWorkers": 1,
  "kernelCycleMs": 100,
  "browserPoolSize": 1,
  "nervBufferMaxSize": 5000,
  "queueConcurrency": 5
}
```

**Resultado**:
- ➕ -80% memory
- ➕ -70% CPU
- ➖ -70% throughput (30-40 tasks/h)

---

### Q22: Queue scan está lento (>1s)

**A**: Causas:
- Muitos arquivos na fila (>100)
- Cache invalidado (P9.4)

**Soluções**:
```bash
# Archive completed tasks
mv fila/*-DONE-*.json fila/archive/

# Verify cache
grep "Queue scan took" logs/agente-gpt-out.log
# Se >500ms consistente → problema

# Increase cache TTL
# config.json: "cacheInvalidationDebounce": 200
```

**Ver**: [TROUBLESHOOTING.md](TROUBLESHOOTING.md) seção "Queue scan lento"

---

## 🔒 Segurança

### Q23: Como proteger o dashboard com senha?

**A**:

```json
// config.json
{
  "dashboardPassword": "secure-password-min-8-chars"
}
```

```bash
# .env
DASHBOARD_PASSWORD=secure-password-min-8-chars

# Restart
make restart

# Test
curl -u :secure-password-min-8-chars http://localhost:3008/api/queue
```

**Ver**: [SECURITY.md](SECURITY.md) seção "Authentication"

---

### Q24: Como usar HTTPS?

**A**: Nginx reverse proxy:

```bash
# Install Nginx + Certbot
sudo apt install nginx certbot python3-certbot-nginx

# Obtain SSL cert
sudo certbot --nginx -d agente.example.com

# Configure Nginx
sudo nano /etc/nginx/sites-available/agente-gpt
# (Ver config completo em DEPLOYMENT.md)

# Restart
sudo systemctl restart nginx
```

**Ver**: [DEPLOYMENT.md](DEPLOYMENT.md) seção "HTTPS/TLS Setup"

---

### Q25: Como rotacionar credenciais?

**A**: Ver [SECURITY.md](SECURITY.md) seção "Credential Rotation".

**Quick steps**:
```bash
# 1. Generate new password
NEW_PASS=$(openssl rand -base64 32)

# 2. Update .env
echo "DASHBOARD_PASSWORD=$NEW_PASS" >> .env

# 3. Restart
make restart

# 4. Update clients
# (API keys, dashboard bookmarks)

# 5. Delete old password
# (após confirmar que tudo funciona)
```

---

## 💻 Desenvolvimento

### Q26: Como rodar testes?

**A**:

```bash
# Fast tests (pre-commit, 5min)
make test-fast

# All tests (15min)
make test-all

# Specific test
node tests/test_config_validation.js

# With coverage
npm test -- --coverage
```

**Ver**: [TESTING.md](TESTING.md)

---

### Q27: Como debugar o código?

**A**: 3 métodos:

**1. VS Code debugger**:
```bash
# Start with inspect
node --inspect index.js

# VS Code: Run → Attach to Node Process
# Set breakpoints (F9)
```

**2. Chrome DevTools**:
```bash
node --inspect-brk index.js
# Chrome: chrome://inspect
```

**3. Logs DEBUG**:
```bash
# .env
LOG_LEVEL=DEBUG

make restart
make watch-logs
```

**Ver**: [DEVELOPMENT.md](DEVELOPMENT.md) seção "Debugging"

---

### Q28: Como adicionar novo LLM target (ex: Claude)?

**A**: 3 passos:

**1. Create driver**:
```javascript
// src/driver/targets/claude.js
class ClaudeDriver extends BaseDriver {
    async execute(page, prompt) {
        await page.goto('https://claude.ai/chats');
        await page.type('div[contenteditable]', prompt);
        // ... (collection logic)
    }
}
```

**2. Register factory**:
```javascript
// src/driver/driver_factory.js
case 'claude': return new ClaudeDriver(opts);
```

**3. Add rules**:
```json
// dynamic_rules.json
{
  "targets": {
    "claude": {
      "url": "https://claude.ai/chats",
      "selectors": { ... }
    }
  }
}
```

**Ver**: [DEVELOPMENT.md](DEVELOPMENT.md) seção "Adicionar Novo LLM Target"

---

### Q29: Como contribuir com código?

**A**: Workflow completo:

```bash
# 1. Fork repo (GitHub UI)

# 2. Clone fork
git clone https://github.com/YOUR_USER/chatgpt-docker-puppeteer.git

# 3. Create branch
git checkout -b feature/my-feature

# 4. Develop + test
make test-fast

# 5. Commit (conventional)
git commit -m "feat(driver): add Claude support"

# 6. Push
git push origin feature/my-feature

# 7. Open PR (GitHub UI)
```

**Ver**: [CONTRIBUTING.md](CONTRIBUTING.md)

---

## 🚀 Deploy

### Q30: Como fazer deploy em produção?

**A**: 3 opções:

**1. PM2 (bare metal)**:
```bash
# Install PM2
npm install -g pm2

# Start
pm2 start ecosystem.config.js --env production

# Auto-start on boot
pm2 startup
pm2 save
```

**2. Docker**:
```bash
# Build
docker-compose -f docker-compose.yml build

# Start
docker-compose -f docker-compose.yml up -d
```

**3. Nginx + PM2 + HTTPS**:
```bash
# 1. Deploy with PM2
pm2 start ecosystem.config.js

# 2. Configure Nginx
sudo nano /etc/nginx/sites-available/agente-gpt

# 3. SSL with Certbot
sudo certbot --nginx -d agente.example.com
```

**Ver**: [DEPLOYMENT.md](DEPLOYMENT.md)

---

## 📚 Mais Informações

### Documentação Completa (16 docs canônicos)

**FASE 1 - Fundação**:
- [PHILOSOPHY.md](PHILOSOPHY.md) - Princípios de design
- [ARCHITECTURE_v2.md](ARCHITECTURE_v2.md) - Arquitetura NERV
- [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) - Design patterns

**FASE 2 - Estrutural**:
- [DATA_FLOW.md](DATA_FLOW.md) - Fluxos de dados
- [SUBSYSTEMS.md](SUBSYSTEMS.md) - Componentes (CORE, NERV, KERNEL, etc)
- [PATTERNS.md](PATTERNS.md) - 15 patterns catalogados
- [GLOSSARY.md](GLOSSARY.md) - 42 termos técnicos

**FASE 3 - Operacional**:
- [CONFIGURATION.md](CONFIGURATION.md) - Configuração (22 params, 50+ env vars)
- [API_REFERENCE.md](API_REFERENCE.md) - REST + WebSocket (10 endpoints, 7 eventos)
- [DEPLOYMENT.md](DEPLOYMENT.md) - Docker, PM2, HTTPS, scaling
- [DEVELOPMENT.md](DEVELOPMENT.md) - Setup, debug, profiling
- [TESTING.md](TESTING.md) - Strategy, 14 tests, coverage
- [CONTRIBUTING.md](CONTRIBUTING.md) - Git workflow, standards

**FASE 4 - Referência**:
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Problemas comuns
- **FAQ.md** (este documento)
- [SECURITY.md](SECURITY.md) - Políticas de segurança

### Suporte

- **GitHub Issues**: https://github.com/ORG/chatgpt-docker-puppeteer/issues
- **Discussions**: https://github.com/ORG/chatgpt-docker-puppeteer/discussions
- **Email**: support@project.com

---

*Última revisão: 21/01/2026 | Contribuidores: AI Architect, Community Team*
