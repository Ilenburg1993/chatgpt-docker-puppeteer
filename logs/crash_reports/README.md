# logs/crash_reports/

**Propósito**: Relatórios de crash do sistema de agentes — capturam stack traces, estado do sistema e contexto de execução no momento de falhas não tratadas para análise post-mortem.  
**Status**: Artefato de runtime.  
**Público**: Desenvolvedores que investigam crashes e falhas de runtime.  
**Última atualização**: 2 de março de 2026.

## ⚠️ Não comitar o conteúdo desta pasta

Os relatórios de crash são gerados automaticamente e **não devem ser commitados**.

## O que fazer com os relatórios

1. Analisar o stack trace e contexto do crash
2. Criar issue no GitHub se for bug reproduzível
3. Registrar em `DOCUMENTAÇÃO/BUGS/` se for crítico
4. Remover o arquivo após análise

## Links relacionados

- Logs: [`logs/`](../README.md)
- Documentação de bugs: [`DOCUMENTAÇÃO/BUGS/`](../../DOCUMENTAÇÃO/BUGS/)
