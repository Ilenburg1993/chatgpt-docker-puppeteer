# tests/manual/kernel

**Propósito**: Specs manuais do kernel que requerem ambiente com lock de arquivo e controle de estado real.  
**Status**: Especializado.  
**Público**: Desenvolvedores de kernel realizando diagnóstico local.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `helpers.js` | Utilitários para os testes manuais de kernel |
| `test_control_pause.spec.js` | Teste manual de pausa/retomada do kernel |
| `test_lock.spec.js` | Teste manual do sistema de locks |
| `test_running_recovery.spec.js` | Teste manual de recuperação de estado running |
| `test_stall_mitigation.spec.js` | Teste manual de mitigação de stall |

## Regras de manutenção

- Requer que o kernel não esteja rodando em paralelo.
- Limpar locks e estado após execução.

## Links relacionados

- Pasta pai: `tests/manual/README.md`
- Testes unitários de kernel: `tests/unit/kernel/`
