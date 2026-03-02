# artifacts/

**Propósito**: Artefatos gerados pelo sistema de auditoria e pelo pipeline de prompts — caches de qualidade, prompts renderizados e templates. Gerados automaticamente durante a execução do audit runner.  
**Status**: Artefato de runtime.  
**Público**: Sistema de auditoria e desenvolvedores que inspecionam outputs de auditoria.  
**Última atualização**: 2 de março de 2026.

## ⚠️ Não comitar o conteúdo desta pasta (exceto templates)

Os arquivos em `audit/cache/` e `prompts/rendered/` são gerados automaticamente e **não devem ser commitados**. Templates em `prompts/templates/` podem ser versionados se forem parte do workflow de auditoria.

## O que esta pasta contém

| Pasta | Descrição |
|---|---|
| `audit/` | Artefatos do audit runner (caches de qualidade) |
| `prompts/` | Prompts renderizados e templates do sistema de auditoria |

## Links relacionados

- Sistema de auditoria: [`src/audit_agent/`](../src/audit_agent/)
- Scripts de auditoria: [`scripts/audit/`](../scripts/audit/)
