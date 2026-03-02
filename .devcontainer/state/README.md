# .devcontainer/state/

**Propósito**: Estado persistente do DevContainer — rastreia contagens de attach, timestamps de primeiro e último acesso para gerenciamento do ciclo de vida do container.  
**Status**: Artefato de runtime.  
**Público**: Ferramentas de gerenciamento do DevContainer (uso interno).  
**Última atualização**: 2 de março de 2026.

## ⚠️ Não comitar o conteúdo desta pasta

Os arquivos aqui são artefatos de estado gerados automaticamente e **não devem ser commitados** ao repositório.

## O que esta pasta contém

- `attach-count` — Contador de anexos ao container
- `first-attach` — Timestamp do primeiro attach
- `last-attach` — Timestamp do último attach
- `last-attach-at` — Timestamp detalhado do último attach

## Links relacionados

- DevContainer: [`.devcontainer/`](../)
