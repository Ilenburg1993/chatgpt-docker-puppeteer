# .devcontainer

**Propósito**: Configuração do ambiente de desenvolvimento em container — Dockerfile, scripts de
lifecycle, configurações e análises de ambiente.  
**Status**: Canônico.  
**Público**: Desenvolvedores usando VS Code Remote Containers ou GitHub Codespaces.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Configuração completa do DevContainer para desenvolvimento local e Codespaces.
- Scripts de lifecycle (post-create, post-start, post-attach).
- Documentação extensa de análise do ambiente (ENV, NSS, SSH, ports).

## O que não deve ficar aqui

- Logs de runtime → `.devcontainer/logs/` (excluído do controle de versão).
- Estado de sessão → `.devcontainer/state/` (excluído do controle de versão).

## Entradas principais

| Arquivo/Pasta               | Descrição                                         |
| --------------------------- | ------------------------------------------------- |
| `devcontainer.json`         | Configuração principal do DevContainer            |
| `Dockerfile`                | Imagem de desenvolvimento                         |
| `scripts/`                  | Scripts de lifecycle do container                 |
| `config/`                   | Configurações adicionais do container             |
| `nss-gatekeeper.sh`         | Script NSS para resolução de usuário em container |
| `ENV_VARIABLE_REFERENCE.md` | Referência de variáveis de ambiente do container  |
| `PORTS_TOPOLOGY.md`         | Topologia de portas do ambiente                   |
| `TROUBLESHOOTING_SSH.md`    | Guia de troubleshooting SSH                       |

## Regras de manutenção

- Usar `hadolint` para lint do Dockerfile: `hadolint .devcontainer/Dockerfile`.
- Testar scripts com `shellcheck`.
- Testes unitários dos scripts em `tests/unit/devcontainer/`.

## Links relacionados

- Testes dos scripts: `tests/unit/devcontainer/`
- Setup inicial: `scripts/setup/`
