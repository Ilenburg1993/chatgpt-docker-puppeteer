# 🔍 Fase de Esclarecimento - Documentação Canônica

**Data**: 2026-01-21 **Status**: 🏃 EM ANDAMENTO **Metodologia**: Opção A (Cautelosa - resolver
dúvidas ANTES de escrever)

---

## 🎯 OBJETIVO

Resolver **TODAS as 14 dúvidas** identificadas na auditoria antes de iniciar a escrita da
documentação canônica.

**Princípio**: Não começar a escrever até ter **certeza absoluta** sobre cada aspecto do sistema.

---

## 📋 DÚVIDAS A RESOLVER

### ✅ DÚVIDA 1: NERV IPC 2.0 está 100% estável?

**Sub-questões**:

- [ ] Envelope schema definitivo?
- [ ] ActionCodes finalizados?
- [ ] Protocolo de ACK/NACK documentado?

**Método de Resolução**:

1. Ler `src/shared/nerv/` completo
2. Analisar `src/core/constants/nerv.js`
3. Verificar schemas em `src/core/schemas.js`

**Status**: ⏳ Pendente

---

### ✅ DÚVIDA 2: Os 7 subsistemas estão completos?

**Sub-questões**:

- [ ] Algum subsistema em refactoring?
- [ ] Mudanças arquiteturais planejadas?
- [ ] Subsistemas finalizados: NERV, KERNEL, DRIVER, INFRA, SERVER, CORE, LOGIC?

**Método de Resolução**:

1. Buscar TODOs no código: `grep -r "TODO\|FIXME\|HACK" src/`
2. Verificar commit messages recentes
3. Checar CHANGELOG.md para mudanças planejadas

**Status**: ⏳ Pendente

---

### ⭐ DÚVIDA 3: DASHBOARD - Como documentar o futuro?

**Sub-questões**:

- [ ] Documentar estado atual (public/ básico)?
- [ ] Documentar visão futura (telemetria completa)?
- [ ] Arquitetura proposta para DASHBOARD completo?
- [ ] APIs que o DASHBOARD futuro vai precisar?
- [ ] Incluir DASHBOARD como 8º subsistema ou separado?

**Análise Atual**:

**Estado Atual** (`public/`):

- Mission Control v3.2 (HTML/CSS/JS vanilla)
- Socket.io client básico
- Task CRUD simples (criar, listar, cancelar)
- Health indicators básicos (uptime, memory)
- Controles: start, stop, restart, kill switch
- Diagnóstico básico
- Terminal/logs simples

**Visão Futura** (DASHBOARD Completo):

- Sistema de Telemetria Completo
  - Real-time metrics (CPU, RAM, disk, network)
  - Histórico de métricas (gráficos temporais)
  - Alertas e thresholds
- Management Avançado de Tarefas
  - Filtros avançados (status, target, date range)
  - Batch operations (cancel all, retry failed)
  - Scheduling (cron-like task scheduling)
  - Task templates
- Indicadores de Performance
  - Dashboards customizáveis
  - Charts (success rate, avg time, throughput)
  - Trends e previsões
- Health Monitoring Completo
  - Subsystems status (NERV, KERNEL, DRIVER, etc.)
  - Dependencies health (Chrome, storage, locks)
  - Alert system com notificações
- DNA/Rules Editor Visual
  - Syntax highlighting
  - Validation real-time
  - Preview de seletores
- Log Viewer Avançado
  - Search e filter
  - Correlation por request_id
  - Export logs
- Forensics Viewer
  - Crash reports gallery
  - Screenshots viewer
  - Timeline de eventos

**Arquitetura Proposta**:

- **Frontend Framework**: React ou Vue (a decidir)
- **State Management**: Redux/Zustand (React) ou Pinia (Vue)
- **Charts**: Recharts ou Chart.js
- **UI Kit**: Tailwind CSS + shadcn/ui ou Vuetify
- **Real-time**: Socket.io client
- **API Client**: Axios ou Fetch API
- **Build**: Vite
- **TypeScript**: Obrigatório

**APIs Necessárias** (adicionais):

- `GET /api/metrics/history` - Histórico de métricas
- `GET /api/metrics/realtime` - Stream de métricas
- `POST /api/tasks/batch` - Operações em lote
- `GET /api/forensics` - Lista de crash reports
- `GET /api/logs/stream` - Stream de logs
- `POST /api/alerts/configure` - Configurar alertas

**Método de Resolução**:

1. Definir se DASHBOARD é subsistema ou separado
2. Definir framework (React vs Vue)
3. Listar APIs faltantes
4. Criar DASHBOARD.md com visão completa

**Status**: ⏳ Pendente

---

### ✅ DÚVIDA 4: ConnectionOrchestrator está final?

**Sub-questões**:

- [ ] Modos: launcher, external, hybrid - finalizados?
- [ ] Estados: WAITING, CONNECTING, READY, LOST - completos?
- [ ] Transições documentadas?

**Método de Resolução**:

1. Ler `src/infra/browser/connection_orchestrator.js`
2. Verificar STATES e MODES constants
3. Validar se há TODOs

**Status**: ⏳ Pendente

---

### ✅ DÚVIDA 5: APIs públicas vs internas

**Sub-questões**:

- [ ] NERV: nerv.emit(), nerv.send(), nerv.onReceive() - públicas?
- [ ] KERNEL: kernel.initialize(), kernel.shutdown() - públicas?
- [ ] BrowserPool: acquireConnection(), releaseConnection() - públicas?
- [ ] Driver: Qual API pública existe?
- [ ] SERVER: APIs REST + WebSocket events - são frontend-friendly?

**Método de Resolução**:

1. Analisar JSDoc de cada módulo
2. Identificar métodos com `@public` ou exportados
3. Criar lista de APIs públicas vs internas

**Status**: ⏳ Pendente

---

### ⭐ DÚVIDA 6: APIs estão prontas para DASHBOARD futuro?

**Sub-questões**:

- [ ] REST API está RESTful e completa?
- [ ] WebSocket events são suficientes para real-time?
- [ ] Faltam endpoints para telemetria/management avançado?
- [ ] Precisa de novas APIs antes de criar DASHBOARD?

**Análise Atual**:

**REST APIs Existentes**:

```
GET    /api/health
GET    /api/system/health
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/:id
DELETE /api/tasks/:id
GET    /api/agents
POST   /api/agents/restart
GET    /api/dna
POST   /api/dna
```

**WebSocket Events Existentes**:

```
Server → Client:
- status_update
- task_complete
- agent_health
- log_entry
- hardware_metrics

Client → Server:
- subscribe_task
- unsubscribe_task
```

**APIs Faltantes** (para DASHBOARD futuro):

```
# Métricas e Telemetria
GET    /api/metrics/history?range=1h
GET    /api/metrics/realtime (WebSocket stream)
GET    /api/metrics/summary

# Batch Operations
POST   /api/tasks/batch/cancel
POST   /api/tasks/batch/retry
POST   /api/tasks/batch/delete

# Alertas
GET    /api/alerts
POST   /api/alerts
PUT    /api/alerts/:id
DELETE /api/alerts/:id

# Forensics
GET    /api/forensics
GET    /api/forensics/:id
GET    /api/forensics/:id/screenshot

# Logs
GET    /api/logs?filter=...&from=...&to=...
GET    /api/logs/stream (WebSocket stream)

# DNA/Rules
PUT    /api/dna/:id
POST   /api/dna/validate

# Subsystems Status
GET    /api/subsystems
GET    /api/subsystems/:name/health
```

**Método de Resolução**:

1. Revisar APIs atuais
2. Listar gaps
3. Decidir se criar agora ou documentar para futuro

**Status**: ⏳ Pendente

---

### ✅ DÚVIDA 7: Schemas Zod estão finalizados?

**Sub-questões**:

- [ ] taskSchema completo?
- [ ] configSchema completo?
- [ ] dnaSchema completo?
- [ ] Todos schemas validados?

**Método de Resolução**:

1. Ler `src/core/schemas.js`
2. Verificar se há TODOs
3. Validar se schemas cobrem todos os casos

**Status**: ⏳ Pendente

---

### ✅ DÚVIDA 8: config.json documentado?

**Sub-questões**:

- [ ] Todos parâmetros documentados?
- [ ] Valores default definidos?
- [ ] Ranges válidos?
- [ ] Dependências entre parâmetros?

**Método de Resolução**:

1. Ler `config.json`
2. Comparar com `src/core/config.js`
3. Criar tabela de parâmetros

**Status**: ⏳ Pendente

---

### ✅ DÚVIDA 9: dynamic_rules.json (DNA) documentado?

**Sub-questões**:

- [ ] Estrutura de regras clara?
- [ ] Seletores documentados?
- [ ] Validação funcional?

**Método de Resolução**:

1. Ler `dynamic_rules.json`
2. Analisar `src/core/schemas.js` (dnaSchema)
3. Verificar como é usado no Driver

**Status**: ⏳ Pendente

---

### ✅ DÚVIDA 10: Docker setup validado?

**Sub-questões**:

- [ ] Dockerfile otimizado?
- [ ] docker-compose funcional?
- [ ] Volumes corretos?

**Método de Resolução**:

1. Ler Dockerfile
2. Ler docker-compose.yml
3. Verificar se builds corretamente

**Status**: ⏳ Pendente

---

### ✅ DÚVIDA 11: PM2 ecosystem correto?

**Sub-questões**:

- [ ] Quantos processos?
- [ ] Restart policies corretas?
- [ ] Memory limits adequados?

**Método de Resolução**:

1. Ler `ecosystem.config.js`
2. Validar configurações

**Status**: ⏳ Pendente

---

### ✅ DÚVIDA 12: Framework de testes definido?

**Sub-questões**:

- [ ] Node.js test runner nativo - decisão final?
- [ ] Estrutura de testes (unit, integration, e2e, regression) - clara?
- [ ] Como escrever novos testes - documentado?

**Método de Resolução**:

1. Ler `tests/README.md` (se existe)
2. Analisar testes existentes
3. Verificar convenções

**Status**: ⏳ Pendente

---

### ⭐ DÚVIDA 13: Qual framework para DASHBOARD futuro?

**Sub-questões**:

- [ ] React? Vue? Svelte? Next.js?
- [ ] TypeScript obrigatório?
- [ ] Chart library: Recharts? Chart.js? D3?
- [ ] State management: Redux? Zustand? Pinia?

**Análise de Opções**:

**React**:

- ✅ Ecossistema maduro
- ✅ Muitas libs de charts (Recharts, Victory)
- ✅ shadcn/ui (UI kit moderno)
- ⚠️ Mais verboso (hooks, context)

**Vue 3**:

- ✅ Mais simples que React
- ✅ Composition API moderna
- ✅ Vuetify (UI kit completo)
- ⚠️ Ecossistema menor

**Next.js**:

- ✅ SSR/SSG (desnecessário para dashboard local)
- ⚠️ Overhead para caso de uso local

**Svelte**:

- ✅ Performance excelente
- ⚠️ Ecossistema menor
- ⚠️ Menos devs familiarizados

**Recomendação Preliminar**: React + TypeScript + Recharts + Zustand + Tailwind + shadcn/ui

**Método de Resolução**:

1. Decidir com base em maturidade e ecossistema
2. Considerar familiaridade da equipe
3. Avaliar complexidade vs features

**Status**: ⏳ Pendente

---

### ⭐ DÚVIDA 14: Design system definido?

**Sub-questões**:

- [ ] Manter estilo atual (Mission Control dark theme)?
- [ ] UI kit: shadcn/ui? Vuetify? Material UI?
- [ ] Tailwind CSS?
- [ ] Responsivo? Mobile-first?

**Análise Atual**:

**Estilo Atual** (public/css/style.css):

- Dark theme (fundo escuro, texto claro)
- Aesthetic "Mission Control" (sci-fi, terminal-like)
- Cores: Verde para success, Vermelho para error, Azul para info
- Grid-based layout

**Proposta**:

- ✅ Manter dark theme (melhor para uso prolongado)
- ✅ Evoluir para design system moderno
- ✅ Tailwind CSS (utility-first, fácil manutenção)
- ✅ shadcn/ui (componentes customizáveis, Tailwind-based)
- ✅ Responsivo desktop-first (dashboard é primariamente desktop)
- ⚠️ Mobile: Visualização básica (não full-featured)

**Método de Resolução**:

1. Definir paleta de cores oficial
2. Escolher UI kit
3. Definir breakpoints
4. Documentar design tokens

**Status**: ⏳ Pendente

---

## 📊 PROGRESSO

**Total de Dúvidas**: 14 **Resolvidas**: 0 **Pendentes**: 14 **Progresso**: 0%

---

## 📝 NOTAS DE RESOLUÇÃO

### Sessão 1 (2026-01-21)

- Auditoria completa gerada
- DASHBOARD identificado como componente crítico futuro
- 14 dúvidas catalogadas
- Próximo passo: Começar resolução sistemática

---

## 🎯 CRITÉRIOS DE CONCLUSÃO

Esta fase estará **COMPLETA** quando:

1. ✅ Todas as 14 dúvidas estiverem marcadas como "Resolvidas"
2. ✅ Cada dúvida tiver resposta documentada neste arquivo
3. ✅ Decisões arquiteturais estiverem registradas
4. ✅ Não houver ambiguidade sobre nenhum aspecto do sistema

**Só então** poderemos passar para a **Fase de Planejamento** e depois para a **Fase de
Implementação** (escrita da documentação).

---

**Última Atualização**: 2026-01-21 **Próxima Ação**: Começar resolução das dúvidas (1-14)
