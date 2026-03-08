# Arquivo Morto

Este diretório concentra documentação histórica, superseded e material legado que não compete com a
documentação canônica em `DOCUMENTAÇÃO/`.

## Regras

- O conteúdo aqui é histórico, não canônico.
- Arquivos só são removidos quando houver duplicata exata, placeholder vazio ou wrapper sem valor
  próprio.
- Em caso de dúvida entre apagar e manter, o padrão é manter e reclassificar.

## Taxonomia Histórica

- [ANALISE_LEGADA/README.md](./ANALISE_LEGADA/README.md): análises antigas reorganizadas por tipo.
- [RAIZ_HISTORICA/README.md](./RAIZ_HISTORICA/README.md): documentação que antes estava solta na
  raiz.
- [DOCS_HISTORICOS/README.md](./DOCS_HISTORICOS/README.md): documentação herdada de estruturas
  auxiliares antigas.
- [CHECKLISTS_HISTORICOS/README.md](./CHECKLISTS_HISTORICOS/README.md): checklists antigos
  preservados por rastreabilidade.
- [IMPORTADO_DOCUMENTOS/README.md](./IMPORTADO_DOCUMENTOS/README.md): material legado importado da
  antiga árvore `DOCUMENTOS/`.
- [BUGS_RODADAS/README.md](./BUGS_RODADAS/README.md): snapshots históricos de rodadas de auditoria.
- [SUPERSEDED/README.md](./SUPERSEDED/README.md): variantes substituídas mantidas por
  rastreabilidade.
- [DEPRECADO/README.md](./DEPRECADO/README.md): material explicitamente deprecated.
- [ANALISE/README.md](./ANALISE/README.md): artefatos históricos isolados fora da taxonomia
  canônica.

## Uso

Use este diretório apenas para consulta histórica, auditoria e rastreabilidade. O ponto de entrada
canônico continua em `../README.md`.

Para tipagem e JSDoc, o ponto de entrada normativo e:

- [../REFERENCIA/TYPING_INDEX.md](../REFERENCIA/TYPING_INDEX.md)

Material daqui nao deve ser usado como fonte de regra ativa para tipagem, JSDoc, schemas, skills ou
CI.
