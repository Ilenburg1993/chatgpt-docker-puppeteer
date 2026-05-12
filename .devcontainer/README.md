# .devcontainer

**Propósito**: Configuração do ambiente de desenvolvimento em container — Dockerfile, scripts de
lifecycle, configurações e documentação canônica do ambiente. **Status**: Canônico. **Público**:
Desenvolvedores usando VS Code Remote Containers ou GitHub Codespaces. **Última atualização**: 11 de
maio de 2026.

## O que esta pasta contém

- Configuração completa do DevContainer para desenvolvimento local e Codespaces.
- Scripts de lifecycle (post-create, post-start, post-attach).
- Documentação canônica de arquitetura, ENV, ports, SSH e scripts.

## O que não deve ficar aqui

- Logs de runtime → `.devcontainer/logs/` (excluído do controle de versão).
- Estado de sessão → `.devcontainer/state/` (excluído do controle de versão).
- Análises históricas/pontuais já concluídas — devem ser removidas após execução.

## Entradas principais

| Arquivo/Pasta                  | Descrição                                         |
| ------------------------------ | ------------------------------------------------- |
| `devcontainer.json`            | Configuração principal do DevContainer            |
| `Dockerfile`                   | Imagem de desenvolvimento (BuildKit cache mounts) |
| `scripts/`                     | Scripts de lifecycle do container                 |
| `config/`                      | Configurações adicionais do container             |
| `nss-gatekeeper.sh`            | Script NSS para resolução de usuário em container |
| `DEVCONTAINER_ARCHITECTURE.md` | **Referência canônica completa da arquitetura** ⭐ |
| `ENV_VARIABLE_REFERENCE.md`    | Referência de variáveis de ambiente do container  |
| `PORTS_TOPOLOGY.md`            | Topologia de portas do ambiente                   |
| `CONNECTION_CONFIG.md`         | Configuração de conexão (Chrome proxy, DevTools)  |
| `SANDBOX_DEPENDENCIES.md`      | Dependências e requisitos do sandbox              |
| `SCRIPTS_REVIEW.md`            | Revisão e documentação dos scripts de lifecycle   |
| `TROUBLESHOOTING_SSH.md`       | Guia de troubleshooting SSH                       |

## Regras de manutenção

- Usar `hadolint` para lint do Dockerfile: `hadolint .devcontainer/Dockerfile`.
- Testar scripts com `shellcheck`.
- Testes unitários dos scripts em `tests/unit/devcontainer/`.
- Documentos históricos/pontuais devem ser removidos após concluídos (não acumular).

## Links relacionados

- Testes dos scripts: `tests/unit/devcontainer/`
- Setup inicial: `scripts/setup/`
