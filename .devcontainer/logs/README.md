# .devcontainer/logs/

**Propósito**: Logs gerados durante o ciclo de vida do DevContainer — pós-criação, snapshots de erro de ambiente e outros registros do provisionamento.  
**Status**: Artefato de runtime.  
**Público**: Desenvolvedores depurando problemas no DevContainer.  
**Última atualização**: 2 de março de 2026.

## ⚠️ Não comitar o conteúdo desta pasta

Os arquivos aqui são artefatos de runtime gerados automaticamente e **não devem ser commitados** ao repositório. Adicione ao `.gitignore` se necessário.

## O que esta pasta contém

- `post-create.log` — Log do script de pós-criação do DevContainer
- `env_error_snapshot_*.txt` — Snapshots de erros de variáveis de ambiente

## Links relacionados

- DevContainer: [`.devcontainer/`](../)
