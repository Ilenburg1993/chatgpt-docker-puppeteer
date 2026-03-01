# Arquitetura do Sistema

**Propósito**: índice canônico da arquitetura oficial do repositório.  
**Status documental**: Canônico.  
**Público**: engenharia, manutenção, automação e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## O que é canônico

- O documento-mestre oficial é [ARCHITECTURE.md](./ARCHITECTURE.md).
- O baseline atual cobre explicitamente `src/main.js`, `src/core/`, `src/nerv/`, `src/kernel/`,
  `src/orchestrator/`, `src/agent/`, `src/driver/`, `src/infra/`, `src/missions/`,
  `src/server/`, `src/dashboard-ui/` e os serviços auxiliares.
- A raiz de `ARQUITETURA/` mantém os entrypoints e os documentos estruturais; os deep-dives
  canônicos foram agrupados em [SUBSISTEMAS/README.md](./SUBSISTEMAS/README.md) e os recortes
  não-baseline em [ESPECIALIZADOS/README.md](./ESPECIALIZADOS/README.md).
- Materiais superseded e análises concluídas vivem em
  [../ARQUIVO_MORTO/ARQUITETURA_HISTORICA/README.md](../ARQUIVO_MORTO/ARQUITETURA_HISTORICA/README.md).

## Leitura rápida

1. Leia [ARCHITECTURE.md](./ARCHITECTURE.md) para a visão oficial completa.
2. Consulte [SUBSYSTEMS.md](./SUBSYSTEMS.md) para o inventário operacional dos diretórios.
3. Use [ARCHITECTURE_DIAGRAMS.md](./ARCHITECTURE_DIAGRAMS.md) para a leitura visual da topologia.
4. Se o foco for fluxo, complemente com [DATA_FLOW.md](./DATA_FLOW.md).

## Mapa da arquitetura

- Bootstrap e governança: `src/main.js`, `src/core/`
- Barramento de eventos: `src/nerv/`
- Decisão: `src/kernel/`, `src/orchestrator/`
- Workers operacionais: `src/agent/`
- Execução browser: `src/driver/`
- Infra e persistência: `src/infra/`
- Missões e workflow: `src/missions/`
- API e supervisão: `src/server/`
- Frontend: `src/dashboard-ui/`
- Contratos compartilhados: `src/shared/`, `src/types/`
- Serviços auxiliares: `src/integration/`, `src/inference_gateway/`, `src/audit_agent/`

## Organização física

- Raiz de `ARQUITETURA/`: baseline, índice, diagramas, fluxos e documentos estruturais.
- [SUBSISTEMAS/README.md](./SUBSISTEMAS/README.md): aprofundamentos canônicos por subsistema.
- [ESPECIALIZADOS/README.md](./ESPECIALIZADOS/README.md): recortes úteis, mas não-baseline.
- `SUBSISTEMAS/` permanece em nível único por enquanto; subpastas internas só devem surgir quando um
  cluster justificar uma árvore própria estável.
- `CONNECTION_ARCHITECTURE/`: trilha especializada de conexão que permanece como árvore própria.
- `DIAGRAMS/`: fontes de diagrama e artefatos visuais.
- `TECHNICAL/`: notas técnicas de trabalho e materiais de migração ainda não promovidos.

## Documentos por categoria

### Baseline oficial

- [ARCHITECTURE.md](./ARCHITECTURE.md): arquitetura oficial completa e atualizada.

### Canônicos de apoio

- [SUBSISTEMAS/README.md](./SUBSISTEMAS/README.md)
- [SUBSISTEMAS/AGENT_RUNTIME.md](./SUBSISTEMAS/AGENT_RUNTIME.md)
- [SUBSISTEMAS/AUDIT_AGENT.md](./SUBSISTEMAS/AUDIT_AGENT.md)
- [SUBSISTEMAS/BROWSER_POOL.md](./SUBSISTEMAS/BROWSER_POOL.md)
- [SUBSISTEMAS/DASHBOARD_UI.md](./SUBSISTEMAS/DASHBOARD_UI.md)
- [SUBSISTEMAS/DRIVER_MODULES.md](./SUBSISTEMAS/DRIVER_MODULES.md)
- [SUBSISTEMAS/INFRA_DB.md](./SUBSISTEMAS/INFRA_DB.md)
- [SUBSISTEMAS/STORAGE.md](./SUBSISTEMAS/STORAGE.md)
- [SUBSISTEMAS/LOCKS.md](./SUBSISTEMAS/LOCKS.md)
- [SUBSISTEMAS/INFERENCE_GATEWAY.md](./SUBSISTEMAS/INFERENCE_GATEWAY.md)
- [SUBSISTEMAS/INTEGRATION.md](./SUBSISTEMAS/INTEGRATION.md)
- [SUBSISTEMAS/KERNEL_TASK_RUNTIME.md](./SUBSISTEMAS/KERNEL_TASK_RUNTIME.md)
- [SUBSISTEMAS/LOGIC.md](./SUBSISTEMAS/LOGIC.md)
- [SUBSISTEMAS/MISSIONS.md](./SUBSISTEMAS/MISSIONS.md)
- [SUBSISTEMAS/NERV_TRANSPORT.md](./SUBSISTEMAS/NERV_TRANSPORT.md)
- [SUBSISTEMAS/ORCHESTRATOR.md](./SUBSISTEMAS/ORCHESTRATOR.md)
- [SUBSISTEMAS/SERVER_DOMAIN.md](./SUBSISTEMAS/SERVER_DOMAIN.md)
- [SUBSISTEMAS/SERVER_REALTIME.md](./SUBSISTEMAS/SERVER_REALTIME.md)
- [SUBSISTEMAS/SERVER_MIDDLEWARE.md](./SUBSISTEMAS/SERVER_MIDDLEWARE.md)
- [SUBSISTEMAS/SERVER_HANDLERS.md](./SUBSISTEMAS/SERVER_HANDLERS.md)
- [SUBSISTEMAS/SERVER_WATCHERS.md](./SUBSISTEMAS/SERVER_WATCHERS.md)
- [SUBSISTEMAS/SHARED.md](./SUBSISTEMAS/SHARED.md)
- [SUBSISTEMAS/STATE_RUNTIME.md](./SUBSISTEMAS/STATE_RUNTIME.md)
- [SUBSYSTEMS.md](./SUBSYSTEMS.md)
- [SUBSISTEMAS/TYPES.md](./SUBSISTEMAS/TYPES.md)
- [SUBSISTEMAS/VALIDATION.md](./SUBSISTEMAS/VALIDATION.md)
- [ARCHITECTURE_DIAGRAMS.md](./ARCHITECTURE_DIAGRAMS.md)
- [CONCEPTUAL_ARCHITECTURE.md](./CONCEPTUAL_ARCHITECTURE.md)
- [DATA_FLOW.md](./DATA_FLOW.md)
- [BOOT_PROCESS_DEEP_DIVE.md](./BOOT_PROCESS_DEEP_DIVE.md)
- [SUBSISTEMAS/DRIVER.md](./SUBSISTEMAS/DRIVER.md)
- [SUBSISTEMAS/INFRA.md](./SUBSISTEMAS/INFRA.md)
- [SUBSISTEMAS/KERNEL.md](./SUBSISTEMAS/KERNEL.md)
- [SUBSISTEMAS/NERV.md](./SUBSISTEMAS/NERV.md)
- [SUBSISTEMAS/SERVER.md](./SUBSISTEMAS/SERVER.md)
- [SUBSISTEMAS/ARQUITETURA_ASSISTENTES_E_LLM_SERVICES.md](./SUBSISTEMAS/ARQUITETURA_ASSISTENTES_E_LLM_SERVICES.md)
- [CONNECTION_ARCHITECTURE/README.md](./CONNECTION_ARCHITECTURE/README.md)

### Aprofundamentos especializados

- [ESPECIALIZADOS/README.md](./ESPECIALIZADOS/README.md)
- [ESPECIALIZADOS/ARQUITETURA_SISTEMA_COMPLETO.md](./ESPECIALIZADOS/ARQUITETURA_SISTEMA_COMPLETO.md)
- [ESPECIALIZADOS/CONNECTION_ORCHESTRATOR.md](./ESPECIALIZADOS/CONNECTION_ORCHESTRATOR.md)
- [ESPECIALIZADOS/RESPONSE_CAPTURE_FLOW.md](./ESPECIALIZADOS/RESPONSE_CAPTURE_FLOW.md)
- [ESPECIALIZADOS/PM2_SOVEREIGN_ARCHITECTURE.md](./ESPECIALIZADOS/PM2_SOVEREIGN_ARCHITECTURE.md)
- [ESPECIALIZADOS/PORT_ARCHITECTURE_ANALYSIS.md](./ESPECIALIZADOS/PORT_ARCHITECTURE_ANALYSIS.md)
- [ESPECIALIZADOS/DNA_SYSTEM.md](./ESPECIALIZADOS/DNA_SYSTEM.md)
- [ESPECIALIZADOS/NERV_REFLECTIONS.MD](./ESPECIALIZADOS/NERV_REFLECTIONS.MD)
- [ESPECIALIZADOS/PATTERNS.md](./ESPECIALIZADOS/PATTERNS.md)
- [ESPECIALIZADOS/PHILOSOPHY.md](./ESPECIALIZADOS/PHILOSOPHY.md)
- [ESPECIALIZADOS/DIAGRAMA_ECOSISTEMA_ASSISTENTES.md](./ESPECIALIZADOS/DIAGRAMA_ECOSISTEMA_ASSISTENTES.md)
- [ESPECIALIZADOS/SYSTEM_DESIGN.md](./ESPECIALIZADOS/SYSTEM_DESIGN.md)

## Documentos históricos / superseded

- Histórico arquivado: [../ARQUIVO_MORTO/ARQUITETURA_HISTORICA/README.md](../ARQUIVO_MORTO/ARQUITETURA_HISTORICA/README.md)
- Versões antigas não são baseline e não devem guiar novas decisões estruturais.

## Como manter esta seção

- Se um diretório estrutural aparecer em `src/`, ele deve entrar no baseline.
- Se a função de um diretório mudar, revise este índice e `ARCHITECTURE.md`.
- `src/agent/` e `src/missions/` devem continuar explicitamente diferenciados na documentação.

## Lacunas prioritárias ainda abertas

- A cobertura oficial agora já inclui `src/infra/storage/`, `src/infra/locks/`,
  `src/server/middleware/`, `src/server/handlers/` e `src/server/watchers/`.
- As lacunas mais relevantes migraram para subtrilhas ainda sem deep-dive próprio, em especial
  `src/infra/fs/`, `src/server/api/controllers/`, `src/server/engine/`, `src/missions/templates/`
  e `src/dashboard-ui/src/stores/`.
- `src/agent/` permanece uma trilha plana no baseline atual; não existe `src/agent/workers/`
  como subárvore real nesta revisão.
- A trilha `TECHNICAL/` e parte dos docs especializados ainda não foram normalizados no mesmo nível
  de profundidade destes documentos de apoio.
