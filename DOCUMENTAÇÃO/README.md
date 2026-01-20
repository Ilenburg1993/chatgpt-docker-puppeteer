# 📚 Documentação do Projeto

> **chatgpt-docker-puppeteer** - Sistema Autônomo de Controle de LLMs

---

## 🗺️ Navegação Rápida

### 🚀 Para Começar
- **[Quick Start Guide](QUICK_START.md)** - Setup em 10 minutos
- **[Configuration Guide](CONFIGURATION.md)** - Todas as configurações
- **[Docker Setup](../DOCKER_SETUP.md)** - Containerização

### 🏗️ Arquitetura
- **[Architecture Guide](ARCHITECTURE.md)** ⭐ - Visão técnica detalhada
- **[Architecture Diagrams](ARCHITECTURE_DIAGRAMS.md)** ✨ **NOVO** - 11 diagramas visuais
- **[Roadmap](ROADMAP.md)** ✨ **NOVO** - Planejamento até v1.0
- **[Gap Analysis](GAP_ANALYSIS.md)** ✨ **NOVO** - Análise crítica e plano de ação

### 📖 Referências
- **[API Documentation](API.md)** - REST API & WebSocket
- **[Configuration Files](CONFIG_FILES.md)** - config.json, dynamic_rules.json
- **[Health Endpoint](HEALTH_ENDPOINT.md)** - Monitoramento

### 🔒 Segurança & Deploy
- **[Security Guide](SECURITY.md)** - Boas práticas
- **[Deployment Guide](DEPLOYMENT.md)** - Produção

### 📋 Outros
- **[Summary](SUMMARY.md)** ✨ **NOVO** - Resumo executivo da Fase 1
- **[Contributing](../CONTRIBUTING.md)** - Como contribuir
- **[Changelog](../CHANGELOG.md)** - Histórico de versões

---

## 🎯 Documentos por Persona

### 👨‍💻 Desenvolvedor (Primeiro Uso)
1. [Quick Start](QUICK_START.md) - Setup inicial
2. [Architecture Diagrams](ARCHITECTURE_DIAGRAMS.md) - Entender o sistema
3. [API Documentation](API.md) - Integração

### 🏗️ Arquiteto / Tech Lead
1. [Architecture Guide](ARCHITECTURE.md) - Visão técnica
2. [Architecture Diagrams](ARCHITECTURE_DIAGRAMS.md) - Diagramas C4, fluxos
3. [Roadmap](ROADMAP.md) - Planejamento estratégico
4. [Gap Analysis](GAP_ANALYSIS.md) - Issues e próximos passos

### 🚀 DevOps / SRE
1. [Deployment Guide](DEPLOYMENT.md) - Deploy em produção
2. [Docker Setup](../DOCKER_SETUP.md) - Containerização
3. [Health Endpoint](HEALTH_ENDPOINT.md) - Monitoramento
4. [Security Guide](SECURITY.md) - Hardening

### 🤝 Contribuidor
1. [Contributing](../CONTRIBUTING.md) - Workflow de contribuição
2. [Architecture Guide](ARCHITECTURE.md) - Entender codebase
3. [Gap Analysis](GAP_ANALYSIS.md) - Onde ajudar
4. [Roadmap](ROADMAP.md) - Prioridades

---

## 📊 Estado da Documentação

| Documento | Status | Última Atualização | Cobertura |
|-----------|--------|-------------------|-----------|
| Quick Start | ✅ Completo | Jan 2026 | 100% |
| Architecture | ✅ Completo | Jan 2026 | 95% |
| Architecture Diagrams | ✨ Novo | 19 Jan 2026 | 100% |
| Roadmap | ✨ Novo | 19 Jan 2026 | 100% |
| Gap Analysis | ✨ Novo | 19 Jan 2026 | 100% |
| Summary | ✨ Novo | 19 Jan 2026 | 100% |
| API | ✅ Completo | Jan 2026 | 90% |
| Configuration | ✅ Completo | Jan 2026 | 100% |
| Deployment | ✅ Completo | Jan 2026 | 85% |
| Security | ✅ Completo | Jan 2026 | 80% |

---

## 🛠️ Ferramentas e Utilidades

### Scripts NPM
```bash
# Setup e Diagnóstico
npm run setup           # Setup automatizado completo
npm run doctor          # Diagnóstico do sistema

# Análise
npm run analyze:deps         # Dependências circulares
npm run analyze:deps:graph   # Grafo visual (requer graphviz)

# Desenvolvimento
npm run dev             # Modo desenvolvimento
npm run test            # Rodar testes
npm run lint            # Linter

# Queue
npm run queue:status    # Status da fila
npm run queue:add       # Adicionar tarefa
npm run queue:flow      # Flow manager

# Daemon (PM2)
npm run daemon:start    # Iniciar daemon
npm run daemon:stop     # Parar daemon
npm run daemon:logs     # Ver logs
npm run daemon:status   # Status

# Limpeza
npm run clean           # Limpar logs/tmp
npm run clean:queue     # Limpar fila
npm run reset:hard      # Reset completo
```

### Visualização de Diagramas
- **VS Code**: Instale extensão `bierner.markdown-mermaid`
- **GitHub**: Renderização automática
- **Online**: [mermaid.live](https://mermaid.live/)

---

## 📚 Glossário

- **Task**: Unidade de trabalho (prompt + target)
- **Target**: Destino (ChatGPT, Gemini, etc)
- **Driver**: Implementação específica para um target
- **Queue**: Fila de tarefas (file-based)
- **Lock**: Trava de processamento (PID-based)
- **DNA**: Identidade do agente
- **NERV**: Sistema de IPC (Inter-Process Communication)
- **Backoff**: Estratégia de retry adaptativo
- **Forensics**: Dump de debug em falhas

---

## 🔗 Links Externos

### Tecnologias Utilizadas
- [Puppeteer](https://pptr.dev/) - Browser automation
- [Express](https://expressjs.com/) - Web framework
- [Socket.io](https://socket.io/) - Real-time communication
- [PM2](https://pm2.keymetrics.io/) - Process manager
- [Mermaid](https://mermaid.js.org/) - Diagramas
- [Zod](https://zod.dev/) - Schema validation

### Metodologias
- [C4 Model](https://c4model.com/) - Architecture diagrams
- [Domain-Driven Design](https://martinfowler.com/tags/domain%20driven%20design.html)
- [Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)

---

## 🆘 Ajuda

### FAQ
**Q: Por onde começar?**  
A: Execute `npm run setup` e depois `npm run doctor` para validar.

**Q: Como visualizar os diagramas?**  
A: No GitHub basta abrir o arquivo. No VS Code instale a extensão Mermaid.

**Q: Encontrei um bug, o que fazer?**  
A: Abra uma issue no GitHub com label `bug` e detalhes.

**Q: Como contribuir?**  
A: Leia [CONTRIBUTING.md](../CONTRIBUTING.md) e escolha uma issue para trabalhar.

---

**Última atualização**: 19 de Janeiro de 2026  
**Mantido por**: Equipe de Desenvolvimento  
**Licença**: MIT
