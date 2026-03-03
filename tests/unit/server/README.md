# tests/unit/server

**Propósito**: Testes unitários do servidor web — roteamento, middleware, adapters NERV, controle de
comandos e métricas.  
**Status**: Canônico.  
**Público**: Desenvolvedores do módulo `src/server/`.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo                                  | Descrição                               |
| ---------------------------------------- | --------------------------------------- |
| `test_api_router.spec.js`                | Roteador da API REST                    |
| `test_middleware.spec.js`                | Middlewares de autenticação e validação |
| `test_server_nerv_adapter.spec.js`       | Adapter NERV do servidor                |
| `test_metrics_controller.spec.js`        | Controller de métricas de hardware      |
| `test_control_command_service_*.spec.js` | Serviços de comandos de controle        |
| `test_task_sync_bridge.spec.js`          | Bridge de sincronização de tarefas      |

## Links relacionados

- Hub unitário: `tests/unit/README.md`
- Módulo: `src/server/`
- Integração: `tests/integration/server/`
