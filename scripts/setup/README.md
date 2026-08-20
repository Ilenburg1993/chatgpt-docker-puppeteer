# scripts/setup

**Propósito**: Scripts de configuração inicial do ambiente de desenvolvimento — extensões,
ferramentas, PM2 e DevContainer.  
**Status**: Canônico.  
**Público**: Novos desenvolvedores e automação de provisionamento.  
**Última atualização**: 20 de agosto de 2026.

## Entradas principais

| Arquivo                         | Descrição                                                  |
| ------------------------------- | ---------------------------------------------------------- |
| `setup.sh`                      | Script principal de setup do ambiente                      |
| `setup-devcontainer.sh`         | Setup específico do DevContainer                           |
| `setup-dev-tools.sh`            | Instala ferramentas de desenvolvimento (rg, fd, bat, etc.) |
| `setup-pm2-plus.sh`             | Configura PM2 Plus para monitoramento                      |
| `setup-terminal-env.mjs`        | Configura variáveis de terminal                            |
| `install-extensions.sh`         | Wrapper do instalador de extensões VS Code                 |
| `install-vscode-extensions.mjs` | Instala perfis e reconcilia resíduos com `--prune`         |
| `vscode-extension-runtime.mjs`  | Descobre extensões de usuário e builtins do servidor       |
| `pm2-startup.sh`                | Configura PM2 para iniciar no boot                         |

## Regras de manutenção

- Scripts devem ser idempotentes — re-executáveis sem efeitos colaterais.
- Documentar dependências externas necessárias.
- Após rebuild ou troca do VS Code Server, execute `npm run vscode:extensions:reconcile`: o comando
  instala o perfil core e remove do Extension Host remoto somente os IDs canônicos `unwanted` e
  `hostOnly`. Extensões opcionais e pessoais são preservadas.
- `GitHub.copilot-chat` é builtin unificado nas versões atuais do VS Code e também fornece
  completions; a descoberta de builtins impede reinstalação falsa do ID legado `GitHub.copilot`.

## Links relacionados

- Scripts pai: `scripts/README.md`
- DevContainer: `.devcontainer/`
