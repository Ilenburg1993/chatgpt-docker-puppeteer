# scripts/setup

**Propósito**: Scripts de configuração inicial do ambiente de desenvolvimento — extensões, ferramentas, PM2 e DevContainer.  
**Status**: Canônico.  
**Público**: Novos desenvolvedores e automação de provisionamento.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `setup.sh` | Script principal de setup do ambiente |
| `setup-devcontainer.sh` | Setup específico do DevContainer |
| `setup-dev-tools.sh` | Instala ferramentas de desenvolvimento (rg, fd, bat, etc.) |
| `setup-pm2-plus.sh` | Configura PM2 Plus para monitoramento |
| `setup-terminal-env.mjs` | Configura variáveis de terminal |
| `install-extensions.sh` | Instala extensões VS Code recomendadas |
| `pm2-startup.sh` | Configura PM2 para iniciar no boot |

## Regras de manutenção

- Scripts devem ser idempotentes — re-executáveis sem efeitos colaterais.
- Documentar dependências externas necessárias.

## Links relacionados

- Scripts pai: `scripts/README.md`
- DevContainer: `.devcontainer/`
