**Status**: Canônico de apoio.  
**Escopo**: índice local dos deep-dives canônicos de subsistemas.  
**Quando consultar**: ao procurar documentação detalhada de um subsistema específico do runtime.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# Subsistemas

**Propósito**: concentrar os aprofundamentos canônicos dos subsistemas reais do projeto.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Como usar esta pasta

- A raiz de `ARQUITETURA/` mantém os entrypoints e os documentos estruturais.
- Esta subpasta concentra os deep-dives por subsistema.
- Se o diretório existe em `src/` e já é estrutural, o aprofundamento deve viver aqui.
- Mantemos esta pasta em um único nível para preservar navegabilidade; só crie subpastas internas
  quando um cluster exigir uma árvore própria estável.

## Runtime principal

- [AGENT_RUNTIME.md](./AGENT_RUNTIME.md)
- [ORCHESTRATOR.md](./ORCHESTRATOR.md)
- [KERNEL.md](./KERNEL.md)
- [KERNEL_TASK_RUNTIME.md](./KERNEL_TASK_RUNTIME.md)
- [NERV.md](./NERV.md)
- [NERV_TRANSPORT.md](./NERV_TRANSPORT.md)
- [DRIVER.md](./DRIVER.md)
- [DRIVER_MODULES.md](./DRIVER_MODULES.md)
- [INFRA.md](./INFRA.md)
- [BROWSER_POOL.md](./BROWSER_POOL.md)
- [INFRA_DB.md](./INFRA_DB.md)
- [STORAGE.md](./STORAGE.md)
- [LOCKS.md](./LOCKS.md)
- [SERVER.md](./SERVER.md)
- [SERVER_DOMAIN.md](./SERVER_DOMAIN.md)
- [SERVER_REALTIME.md](./SERVER_REALTIME.md)
- [SERVER_MIDDLEWARE.md](./SERVER_MIDDLEWARE.md)
- [SERVER_HANDLERS.md](./SERVER_HANDLERS.md)
- [SERVER_WATCHERS.md](./SERVER_WATCHERS.md)
- [MISSIONS.md](./MISSIONS.md)

## Camadas transversais e auxiliares

- [SHARED.md](./SHARED.md)
- [TYPES.md](./TYPES.md)
- [LOGIC.md](./LOGIC.md)
- [VALIDATION.md](./VALIDATION.md)
- [STATE_RUNTIME.md](./STATE_RUNTIME.md)

## Serviços auxiliares e superfícies

- [INTEGRATION.md](./INTEGRATION.md)
- [INFERENCE_GATEWAY.md](./INFERENCE_GATEWAY.md)
- [AUDIT_AGENT.md](./AUDIT_AGENT.md)
- [DASHBOARD_UI.md](./DASHBOARD_UI.md)
- [ARQUITETURA_ASSISTENTES_E_LLM_SERVICES.md](./ARQUITETURA_ASSISTENTES_E_LLM_SERVICES.md)
