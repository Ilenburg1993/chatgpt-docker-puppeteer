# logs/

**Propósito**: Logs de runtime do sistema de agentes — registros de atividade do agente, métricas, estado adaptativo e relatórios de crash gerados durante a operação.  
**Status**: Artefato de runtime.  
**Público**: Desenvolvedores e operadores que monitoram e depuram o sistema.  
**Última atualização**: 2 de março de 2026.

## ⚠️ Não comitar o conteúdo desta pasta

Os logs são gerados automaticamente e **não devem ser commitados**. Estão incluídos no `.gitignore`.

## O que esta pasta contém

| Arquivo/Pasta | Descrição |
|---|---|
| `agente_current.log` | Log principal de atividade do agente atual |
| `audit.log` | Log do sistema de auditoria |
| `metrics.log` | Métricas de performance e telemetria |
| `adaptive_state.json` | Estado adaptativo persistido entre sessões |
| `crash_reports/` | Relatórios de crash para análise post-mortem |

## Regras de manutenção

- Logs são rotacionados automaticamente pelo sistema
- Use `npm run clean` para limpar logs antigos
- Relatórios de crash devem ser analisados e então removidos

## Links relacionados

- Crash reports: [`logs/crash_reports/`](./crash_reports/README.md)
- Monitoramento: [`monitoring/`](../monitoring/)
- Core logger: [`src/core/`](../src/core/)
