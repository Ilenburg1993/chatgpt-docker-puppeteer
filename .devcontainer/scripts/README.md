# .devcontainer/scripts

**Propósito**: Scripts de lifecycle do DevContainer — executados automaticamente pelo VS Code em
eventos de container.  
**Status**: Canônico.  
**Público**: Mantenedores do DevContainer.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo              | Evento              | Descrição                                                  |
| -------------------- | ------------------- | ---------------------------------------------------------- |
| `post-create.sh`     | `postCreateCommand` | Executado após criação do container — instala dependências |
| `post-start.sh`      | `postStartCommand`  | Executado após cada início do container                    |
| `post-attach.sh`     | `postAttachCommand` | Executado ao conectar ao container                         |
| `healthcheck.sh`     | Sob demanda         | Verifica saúde do ambiente do container                    |
| `validate-env.sh`    | `postCreateCommand` | Valida variáveis de ambiente obrigatórias                  |
| `sync-local-auth.sh` | Sob demanda         | Sincroniza credenciais locais para o container             |
| `jsonc-validate.cjs` | CI                  | Valida arquivos JSONC (devcontainer.json, etc.)            |

## Regras de manutenção

- Scripts devem ser idempotentes — re-executáveis sem efeitos colaterais.
- Validar com `shellcheck` antes de commitar.
- Testes unitários em `tests/unit/devcontainer/`.

## Links relacionados

- DevContainer pai: `.devcontainer/README.md`
- Testes: `tests/unit/devcontainer/`
