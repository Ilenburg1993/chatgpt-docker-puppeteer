# scripts/ops

**Propósito**: Scripts de operações do dia a dia — monitoramento, PM2, visualização de fila, rotação
de perfis e logs. **Status**: Canônico. **Público**: Operações e desenvolvedores em ambiente de
produção. **Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo                       | Descrição                                             |
| ----------------------------- | ----------------------------------------------------- |
| `copilot-network-diagnose.sh` | Diagnóstico de conectividade do Copilot (timeout/408) |
| `dev-runtime-monitor.js`      | Monitor de runtime em desenvolvimento                 |
| `flow_manager.js`             | Gerenciador de fluxo de missões                       |
| `pm2-check.sh`                | Verifica status dos processos PM2                     |
| `puppeteer_maintenance.js`    | Manutenção do pool Puppeteer                          |
| `quick-ops.sh`                | Atalhos rápidos de operação                           |
| `rotate-profiles.js`          | Rotação de perfis de Chrome                           |
| `start-pm2-debug.sh`          | Inicia PM2 em modo debug                              |
| `status_fila.js`              | Status atual da fila de tarefas                       |
| `visualizar_fila.js`          | Visualizador da fila (formato tabular)                |
| `watch-logs.sh`               | Watch de logs em tempo real                           |

## Regras de manutenção

- Scripts shell devem passar no `shellcheck`.
- Operações destrutivas devem pedir confirmação.

## Links relacionados

- Scripts pai: `scripts/README.md`
- Queue CLI: `npm run queue:status`
