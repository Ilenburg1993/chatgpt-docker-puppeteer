# tests/unit/core

**Propósito**: Testes unitários do núcleo do sistema — configuração, logger, schemas e cliente
Ollama.  
**Status**: Canônico.  
**Público**: Desenvolvedores do módulo `src/core/`.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo                                | Descrição                                |
| -------------------------------------- | ---------------------------------------- |
| `test_config.spec.js`                  | Carregamento e validação de configuração |
| `test_logger.spec.js`                  | Logger central e seus eventos            |
| `test_schemas.spec.js`                 | Schemas Zod do sistema                   |
| `test_schema_v5.spec.js`               | Schema versão 5 (legado compatível)      |
| `test_ollama_client_runtime.spec.js`   | Cliente Ollama em runtime                |
| `test_doctor_hardware_metrics.spec.js` | Métricas de hardware do doctor           |

## Links relacionados

- Hub unitário: `tests/unit/README.md`
- Módulo: `src/core/`
