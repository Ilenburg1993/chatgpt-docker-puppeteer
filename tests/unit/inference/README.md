# tests/unit/inference

**Propósito**: Testes unitários do gateway de inferência — policies, tags de cliente, supervisor Ollama e persistência.  
**Status**: Canônico.  
**Público**: Desenvolvedores do módulo `src/inference_gateway/`.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `test_gateway.spec.js` | Gateway de inferência central |
| `test_gateway_server.spec.js` | Servidor do gateway |
| `test_client_tags.spec.js` | Tags de identificação de cliente |
| `test_ollama_host_supervisor.spec.js` | Supervisor de hosts Ollama |
| `test_persistence_loader.spec.js` | Carregador de persistência de políticas |
| `test_policy_config.spec.js` | Configuração de políticas de inferência |

## Links relacionados

- Hub unitário: `tests/unit/README.md`
- Módulo: `src/inference_gateway/`
