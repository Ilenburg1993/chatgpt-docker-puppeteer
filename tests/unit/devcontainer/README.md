# tests/unit/devcontainer

**Propósito**: Testes unitários dos scripts de lifecycle do DevContainer — post-create, post-start, post-attach, mounts e NSS.  
**Status**: Canônico.  
**Público**: Mantenedores do DevContainer (`.devcontainer/`).  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `entrypoint-wrapper.spec.js` | Wrapper do entrypoint do container |
| `mounts.spec.js` | Configuração de mounts do DevContainer |
| `nss_wrapper.spec.js` | Wrapper NSS para resolução de usuário |
| `post-attach.spec.js` | Script de post-attach |
| `post-create.spec.js` | Script de post-create |
| `post-start.spec.js` | Script de post-start |

## Links relacionados

- Hub unitário: `tests/unit/README.md`
- Scripts do DevContainer: `.devcontainer/scripts/`
