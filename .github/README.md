# GitHub Automation Hub

**Propósito**: consolidar o contrato vivo do diretório `.github/` neste repositório.  
**Status documental**: Canônico.  
**Público**: mantenedores, revisores de CI/CD e agentes de IA.  
**Última atualização**: 1 de março de 2026.

## Escopo

Este hub cobre:

- workflows versionados em `.github/workflows/`;
- configuração do Dependabot;
- instruções permanentes para agentes (`AGENTS.md`, `copilot-instructions.md`, `instructions/`);
- skills, prompts e agentes locais do workspace.

## O que é versionado neste repositório

- `workflows/`: automações CI/CD e checks operacionais do projeto;
- `dependabot.yml`: política de updates automáticos;
- `AGENTS.md`, `copilot-instructions.md`, `COPILOT_CONFIG.md`: baseline de contexto para agentes;
- `skills/`, `agents/`, `prompts/`, `instructions/`: contrato local do ecossistema de IA.

## O que pode aparecer no GitHub Actions e não morar aqui

A página de Actions do GitHub pode exibir execuções que **não** correspondem a arquivos
versionados em `.github/workflows/`.

Casos observados:

- `Dependabot Updates`: workflow dinâmico do ecossistema GitHub/Dependabot;
- `Claude`: workflow ou integração externa gerenciada por app/plataforma.

Esses itens podem aparecer no histórico de Actions, mas não devem ser “recriados” como arquivos
locais sem uma decisão explícita de produto.

## Entradas principais

- [dependabot.yml](./dependabot.yml)
- [workflows/](./workflows/)
- [AGENTS.md](./AGENTS.md)
- [COPILOT_CONFIG.md](./COPILOT_CONFIG.md)
- [copilot-instructions.md](./copilot-instructions.md)
- [skills/README.md](./skills/README.md)

## Notas operacionais

- `workflows/audit-nightly.yml` agora tem dois modos:
  - `standard`: agendado, usa `audit_mode=exploratory_bug` com `profile=deep`, sem `refresh-context`
    e sem `chaos`, para varredura útil e previsível;
  - `full`: manual, usa `profile=nightly` para investigação mais pesada sob demanda, em faixa de
    concorrência separada do cron.
- `workflows/ci.yml` mantém `audit-lite` como trilha não bloqueante, mas agora preserva summary e
  artifacts mesmo quando a etapa de auditoria falha e atualiza um único comentário por PR.
- `workflows/dependency-hygiene.yml` é uma trilha semanal/manual, com timeout e cancelamento da
  execução anterior para não acumular runs redundantes.
- Os workflows versionados adotam como baseline:
  - `permissions` explícitas e mínimas por workflow/job;
  - `timeout-minutes` em todos os jobs;
  - `concurrency` nos fluxos relevantes para evitar runs redundantes;
  - `retention-days` explícito nos artifacts relevantes.
- A validação de workflows agora é em camadas:
  - `node scripts/ci/validate-workflows.mjs`: contrato estrutural local e governança;
  - `raven-actions/actionlint@v2.1.1` dentro do workflow de `CI`: lint semântico de Actions;
  - `reviewdog/action-shellcheck@v1.9.0` dentro do workflow de `CI`: lint de shell scripts com
    anotações em `github-check`;
  - `node scripts/ci/verify-github-workflows.mjs`: verificação opcional via `gh api` para
    confirmar o que o GitHub está reconhecendo remotamente.
- `dependabot.yml` usa `pull-request-branch-name.separator: "-"` e labels explícitas por
  ecossistema, incluindo `dependabot`, para reduzir branch names com `/` e estabilizar a triagem.

## Regras de manutenção

- Antes de criar um workflow novo, verificar se a necessidade já é atendida por workflow dinâmico
  da plataforma ou por integração externa.
- Toda mudança estrutural em `.github/workflows/` deve atualizar a documentação canônica em
  `DOCUMENTAÇÃO/OPERACOES/`.
- `AGENTS.md` deve permanecer curto, estável e voltado a baseline; detalhes extensos vivem em docs
  e skills.
- `dependabot.yml` e workflows de segurança/dependência devem permanecer coerentes entre si.
