# tests/unit/kernel

**Propósito**: Testes unitários do kernel — execution engine, policy engine, task runtime e orquestração.  
**Status**: Canônico.  
**Público**: Desenvolvedores do módulo `src/kernel/`.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `test_execution_engine.spec.js` | Motor de execução de tarefas |
| `test_policy_engine.spec.js` | Motor de políticas |
| `test_task_runtime.spec.js` | Runtime de ciclo de vida de tarefa |
| `test_task_execution_orchestrator.spec.js` | Orquestrador de execução |
| `test_kernel_orchestration_integration.spec.js` | Integração de orquestração no kernel |
| `test_kernel_reexec_post_terminal.spec.js` | Re-execução após estado terminal |

## Links relacionados

- Hub unitário: `tests/unit/README.md`
- Módulo: `src/kernel/`
- Testes manuais: `tests/manual/kernel/`
