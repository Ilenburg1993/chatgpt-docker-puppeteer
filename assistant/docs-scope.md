# Plano de Escopo e Prioridades — Documentação Técnica

## Objetivo

Criar documentação técnica abrangente para o repositório `chatgpt-docker-puppeteer`, cobrindo
arquitetura, subsistemas, runbooks e políticas de autonomia para permitir manutenção, operação e
onboarding.

## Entregáveis principais

- `assistant/docs-scope.md` (este arquivo)
- `assistant/inventory-src.md` — inventário do código e dependências
- Diagramas Mermaid em `DOCUMENTAÇÃO/diagrams/` (arquitetura, boot, fluxo de dados)
- Documentação por subsistema em `DOCUMENTAÇÃO/` (NERV, Kernel, Driver, Infra, Server, Core)
- `DOCUMENTAÇÃO/RUNBOOK.md` — procedimentos operacionais (start/stop/health/backup/restore)
- `assistant/auto-policy.md` — política de autonomia do assistente
- Branch/PR: mudanças consolidadas em `docs/autonomy` e propostas via PR

## Prioridades e ordem de trabalho

1. Runbooks e operações (prioridade alta) — garantir que a equipa consiga operar o sistema.
2. Documentação de subsistemas críticos (NERV, Kernel, Driver, Infra, Server, Core).
3. Inventário do código e diagramas de alto nível.
4. Política de autonomia e automações seguras.
5. Revisão, PRs e publicação final.

## Critérios de aceite (por entregável)

- Texto explicativo claro e conciso com exemplos de comandos operacionais.
- Lista de pré-requisitos e verificações (ex.: `make check-deps`, `make test-fast`).
- Diagramas renderizáveis (Mermaid) com arquivos fonte preservados.
- Checklists para PRs e procedimento de revisão documentados.

## Regras de segurança e autonomia (resumo)

- Permitido automaticamente pelo assistente (ações não-destrutivas):
  - Gerar e atualizar documentação (arquivos `DOCUMENTAÇÃO/` e `assistant/`).
  - Executar linter/format (ESLint/Prettier) e gerar relatórios.
  - Executar testes de leitura (unit/integration) e coletar resultados.
  - Gerar inventários, diagramas e runbooks.
  - Criar branches de trabalho (`docs/autonomy/*`) e abrir PRs rascunho.

- Proibido automaticamente (ações que exigem autorização humana):
  - Push direto em `main` ou merge automático para branches protegidas.
  - Deletar backups, dados de persistência ou arquivos fora de `assistant/` e `DOCUMENTAÇÃO/`.
  - Alterar credenciais, segredos ou arquivos de configuração sensíveis.
  - Executar comandos que possam apagar dados ou reiniciar infra sem aprovação.

## Frequência e agendamento sugeridos

- Inventário de código: semanal automático (configurável).
- Execução de lint/testes: sob demanda ou antes de gerar PRs.
- Geração de diagramas: sob demanda (ou sempre que estrutura mudar).

## Estrutura de documentos proposta

- `DOCUMENTAÇÃO/ANALISE_TECNICA.md` — análise técnica geral (atualizar)
- `DOCUMENTAÇÃO/diagrams/` — diagramas Mermaid fonte
- `DOCUMENTAÇÃO/NERV.md`, `DOCUMENTAÇÃO/KERNEL.md`, `DOCUMENTAÇÃO/DRIVER.md`,
  `DOCUMENTAÇÃO/INFRA.md`, `DOCUMENTAÇÃO/SERVER.md`, `DOCUMENTAÇÃO/CORE.md`
- `DOCUMENTAÇÃO/RUNBOOK.md` — operações e procedimentos
- `assistant/auto-policy.md` — política de autonomia e revogação
- `assistant/inventory-src.md` — inventário gerado do passo 2

## Próximos passos imediatos

1. Mapear o código e dependências (inventory) — passo 2.
2. Gerar diagramas de alto nível a partir do inventory — passo 3.
3. Documentar subsistemas críticos e criar runbook — passo 4.

## Responsabilidades

- Mudanças de documentação e PRs: branch `docs/autonomy`; revisão por mantenedor.

## Notas finais

Este documento define escopo inicial e regras para automações seguras. Podemos ajustar prioridades e
regras conforme preferir.
