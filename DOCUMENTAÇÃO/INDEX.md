# Índice Técnico

Resumo da taxonomia atual de `DOCUMENTAÇÃO/`.

## Categorias

- `GUIAS/`: onboarding, desenvolvimento, testes, troubleshooting e operação diária. Índice em `GUIAS/README.md`.
- `ARQUITETURA/`: hub oficial da arquitetura, com baseline na raiz, deep-dives em `SUBSISTEMAS/`, recortes não-baseline em `ESPECIALIZADOS/`, além de diagramas e notas estruturais.
- `REFERENCIA/`: APIs, configuração, variáveis, aliases e guias de integração. Índice em `REFERENCIA/README.md`.
- `OPERACOES/`: deploy, PM2, segurança operacional e documentação de ambiente. Índice em `OPERACOES/README.md`.
- `PLANOS/`: planos ativos, roadmaps e material de coordenação. Índice em `PLANOS/README.md`.
- `AUDITORIAS/`: auditorias formais e trilhas canônicas de bug audit.
- `RELATORIOS/`: relatórios, análises, sumários e consolidações, incluindo material reclassificado
  em `RELATORIOS/RECLASSIFICADOS/`. Índice em `RELATORIOS/README.md`.
- `DECISOES/`: reservado para ADRs e registros de decisão. Índice em `DECISOES/README.md`.
- `ARQUIVO_MORTO/`: histórico, snapshots, superseded e importações legadas. Índice em `ARQUIVO_MORTO/README.md`.

## Entradas Principais

- Hub humano: [README.md](./README.md)
- Status geral da documentação: [RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md](./RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md)
- Auditoria qualitativa: [RELATORIOS/AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md](./RELATORIOS/AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md)
- Guias: [GUIAS/README.md](./GUIAS/README.md)
- Guia de testes: [GUIAS/TESTES.md](./GUIAS/TESTES.md)
- Arquitetura base: [ARQUITETURA/README.md](./ARQUITETURA/README.md)
- Referência técnica: [REFERENCIA/README.md](./REFERENCIA/README.md)
- Referência de ambiente: [REFERENCIA/ENV_VARIABLES_GUIDE.md](./REFERENCIA/ENV_VARIABLES_GUIDE.md)
- Operações: [OPERACOES/README.md](./OPERACOES/README.md)
- Planos e roadmap: [PLANOS/README.md](./PLANOS/README.md)
- Trilha de bugs: [AUDITORIAS/BUGS/BUG_AUDIT_MASTER.md](./AUDITORIAS/BUGS/BUG_AUDIT_MASTER.md)
- Auditoria estrutural de ENV: [AUDITORIAS/ENV_STRUCTURE_AUDIT_2026-03-01.md](./AUDITORIAS/ENV_STRUCTURE_AUDIT_2026-03-01.md)
- Relatórios: [RELATORIOS/README.md](./RELATORIOS/README.md)
- Decisões: [DECISOES/README.md](./DECISOES/README.md)
- Arquivo histórico: [ARQUIVO_MORTO/README.md](./ARQUIVO_MORTO/README.md)

## Exceções Deliberadas Fora Deste Hub

Estes Markdown continuam fora de `DOCUMENTAÇÃO/` por função operacional:

- `README.md`, `CHANGELOG.md` e `SECURITY.md` na raiz.
- documentação local em `.github/`, `.devcontainer/`, `.codex/`, `.gemini/`, `.opencode/`, `.vscode/` e `.kilocode/`.
- `README.md` colocalizados em `src/`, `tests/`, `agents/` e `tools/`.

## Status da Reorganização

- `DOCUMENTOS/` foi absorvida por `ARQUIVO_MORTO/IMPORTADO_DOCUMENTOS/`.
- `BUGS/` e `bugs/` foram consolidadas em `AUDITORIAS/BUGS/`.
- `RESUMOS_TECNICOS/` e `resumos_tecnicos_subpastas/` foram consolidadas em `RELATORIOS/RESUMOS_TECNICOS/`.
- `LEGADO_ARQUIVO/` foi achatada em `ARQUIVO_MORTO/ANALISE_LEGADA/`, `RAIZ_HISTORICA/`, `DOCS_HISTORICOS/` e `CHECKLISTS_HISTORICOS/`.
- `DEPRECATIONS/` e snapshots antigos foram isolados em `ARQUIVO_MORTO/`.
- `tests/` passou a usar `support/`, `scripts/` e `legacy/` na raiz local.
- O status transversal e o backlog documental agora vivem em
  [RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md](./RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md).
- A consolidação qualitativa das categorias vivas foi auditada em
  [RELATORIOS/AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md](./RELATORIOS/AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md).
- A reclassificação dos relatórios removidos de categorias vivas agora vive em
  [RELATORIOS/RECLASSIFICADOS/README.md](./RELATORIOS/RECLASSIFICADOS/README.md).
- O rollout estrutural de `README.md` por pasta foi formalizado em
  [PLANOS/PLANO_READMES_PADRONIZADOS.md](./PLANOS/PLANO_READMES_PADRONIZADOS.md).
- A próxima fase de limpeza semântica foi formalizada em
  [PLANOS/PLANO_CONSOLIDACAO_CATEGORIAS_VIVAS.md](./PLANOS/PLANO_CONSOLIDACAO_CATEGORIAS_VIVAS.md).
