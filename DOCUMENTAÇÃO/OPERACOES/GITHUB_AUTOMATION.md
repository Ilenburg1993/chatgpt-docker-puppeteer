# GitHub Automation

**Propósito**: documentar a superfície viva de automação versionada em `.github/` e sua relação
com integrações externas vistas no GitHub Actions.  
**Status documental**: Canônico.  
**Público**: engenharia, manutenção, revisão de CI/CD e agentes de IA.  
**Última atualização**: 1 de março de 2026.

## Escopo

Este documento cobre:

- workflows versionados em `.github/workflows/`;
- política de updates em `.github/dependabot.yml`;
- baseline local para agentes em `.github/`;
- distinção entre workflows do repositório e execuções dinâmicas/externas mostradas na UI do
  GitHub Actions.

## Arquivos canônicos

- Hub local de `.github`: [../../.github/README.md](../../.github/README.md)
- Dependabot: [../../.github/dependabot.yml](../../.github/dependabot.yml)
- Workflows: [../../.github/workflows](../../.github/workflows)
- Validador de automação: [../../scripts/ci/validate-workflows.mjs](../../scripts/ci/validate-workflows.mjs)

## Workflows versionados atuais

### CI

- arquivo: [../../.github/workflows/ci.yml](../../.github/workflows/ci.yml)
- função: lint, formatação, testes, audit lite e artifacts de auditoria

### Security

- arquivo: [../../.github/workflows/security.yml](../../.github/workflows/security.yml)
- função: `npm audit` de produção via gate local + CodeQL

### Dependency Review

- arquivo: [../../.github/workflows/dependency-review.yml](../../.github/workflows/dependency-review.yml)
- função: review de PR de dependências, installability e triagem automática de PR do Dependabot

### Dependency Hygiene

- arquivo: [../../.github/workflows/dependency-hygiene.yml](../../.github/workflows/dependency-hygiene.yml)
- função: auditoria periódica do grafo completo e da superfície declarada vs. usada

Contrato atual:

- execução semanal agendada e também manual (`workflow_dispatch`);
- `concurrency` com cancelamento de execução anterior;
- `timeout-minutes: 25` para evitar drift silencioso em rotina periódica;
- artifacts de auditoria para rastreio do grafo completo.

### Audit Nightly

- arquivo: [../../.github/workflows/audit-nightly.yml](../../.github/workflows/audit-nightly.yml)
- função: execução noturna não bloqueante da trilha de auditoria interna

Contrato atual:

- agenda diária em modo `standard`;
- `workflow_dispatch` com escolha entre `standard` e `full`;
- `concurrency` separada por modo, para o cron não cancelar um `full` manual;
- `timeout-minutes: 60` no job e `timeout` explícito nos steps de execução;
- modo `standard` usa `audit_mode=exploratory_bug` com `profile=deep`;
- modo `full` usa `profile=nightly` para exploração mais pesada, mas o workflow mantém
  `publish-master=false` e `publish-snapshot=false`.

### Docker Rebuild

- arquivo: [../../.github/workflows/docker-rebuild.yml](../../.github/workflows/docker-rebuild.yml)
- função: build do DevContainer, lint e smoke test do toolchain da imagem

## Execuções que podem aparecer no GitHub Actions sem arquivo local

A interface do GitHub Actions pode mostrar runs que não correspondem a YAMLs presentes em
`.github/workflows/`.

Em 1 de março de 2026, a página pública de Actions do repositório mostrava:

- `Dependabot Updates` com `on: dynamic`
- `Claude` como integração externa

Leitura correta:

- esses itens são gerenciados pela plataforma GitHub ou por apps externos;
- eles não devem ser tratados como “arquivo faltando” na árvore local;
- a documentação e a validação locais devem distinguir isso explicitamente.

## Validação local

O script [../../scripts/ci/validate-workflows.mjs](../../scripts/ci/validate-workflows.mjs) agora
valida:

- todos os workflows em `.github/workflows/`;
- a presença e a estrutura básica de `.github/dependabot.yml`;
- `permissions` explícitas em todos os workflows;
- `concurrency` nos workflows governados;
- `timeout-minutes` em todos os jobs;
- `retention-days` nos steps que usam `actions/upload-artifact`;
- a presença dos documentos-base:
  - `.github/AGENTS.md`
  - `.github/COPILOT_CONFIG.md`
  - `.github/README.md`
- a presença dos scripts-base de governança:
  - `scripts/ci/validate-workflows.mjs`
  - `scripts/ci/verify-github-workflows.mjs`

Comando:

- `node scripts/ci/validate-workflows.mjs`

Camadas adicionais:

- `rhysd/actionlint@v1` roda no job `validate` de [../../.github/workflows/ci.yml](../../.github/workflows/ci.yml)
  para lint semântico de workflows;
- [../../scripts/ci/verify-github-workflows.mjs](../../scripts/ci/verify-github-workflows.mjs)
  usa `gh api repos/<owner>/<repo>/actions/workflows` para comparar os workflows versionados locais
  com o que o GitHub reconhece remotamente.

Comandos:

- `npm run check:workflows`
- `npm run check:workflows:lint`
- `npm run check:workflows:remote`
- `npm run check:workflows:remote:strict`

## Upgrades aplicados nesta rodada

- major tags atualizadas nas Actions versionadas:
  - `actions/checkout@v6`
  - `actions/setup-node@v6`
  - `actions/upload-artifact@v6`
  - `github/codeql-action@v4`
- os workflows passaram a adotar baseline explícito de governança:
  - permissões mínimas por workflow/job;
  - `timeout-minutes` em todos os jobs;
  - `retention-days` para artifacts efêmeros;
  - `concurrency` para evitar sobreposição desnecessária.
- os steps de `actions/checkout` passaram a usar `persist-credentials: false` por padrão, já que
  os workflows não fazem `git push` e não precisam reter credenciais no checkout.
- `docker-rebuild.yml` deixou de fazer um “healthcheck” inválido em um container com
  `sleep infinity` e passou a executar smoke test real de tooling com o workspace montado.
- `docker-rebuild.yml` também passou a:
  - usar `docker/setup-buildx-action@v3`
  - usar `reviewdog` com `github-check` e `nofilter`
  - reagir a mudanças do próprio workflow e scripts associados
  - rodar fora do início exato da hora para reduzir risco de atraso do scheduler
- `audit-nightly.yml` deixou de depender de um perfil pesado por padrão e agora:
  - usa `profile=deep` no scheduler e deixa `profile=nightly` apenas no `full` manual;
  - evita `refresh-context` e `chaos` no scheduler;
  - separa `standard` de `full`;
  - usa faixas de `concurrency` distintas para cron e `full` manual;
  - aplica `timeout` com `SIGINT` (`40m` no `standard`, `55m` no `full`);
  - não quebra o step de resumo quando o artifact JSON não é gerado;
  - impede que uma execução longa fique acumulando sobre a próxima.
- `ci.yml` passou a:
  - preservar summary e artifact do `audit-lite` mesmo quando a etapa de auditoria falha;
  - atualizar um comentário único por PR, em vez de acumular comentários redundantes;
  - rodar `actionlint` no job `validate`.
- `dependency-hygiene.yml` passou a:
  - limitar a janela de execução com `timeout-minutes`;
  - cancelar a execução anterior quando uma nova for disparada;
  - rodar fora do `:00` para evitar a janela mais congestionada do scheduler.
- `security.yml` passou a:
  - isolar `security-events: write` apenas no job de `CodeQL`;
  - usar `concurrency` própria para não sobrepor push/PR/schedule desnecessariamente;
  - rodar fora do `:00` no cron semanal.
- `dependency-review.yml` passou a:
  - ter `concurrency` por evento/PR;
  - reduzir permissões do job de triagem para `issues: write` e `pull-requests: read`.
- `dependabot.yml` passou a:
  - evitar o início exato da hora nos horários agendados;
  - padronizar branches com `pull-request-branch-name.separator: "-"`.

## Regras de manutenção

- Não assumir que tudo o que aparece em `https://github.com/<owner>/<repo>/actions` é arquivo
  versionado localmente.
- Toda mudança de `.github/workflows/` ou `.github/dependabot.yml` deve passar por
  `node scripts/ci/validate-workflows.mjs`.
- Evitar permissões de escrita no nível do workflow quando elas só são necessárias em um job.
- Quando o GitHub exibir workflow dinâmico/externo novo, registrar a distinção neste documento se
  isso puder confundir a manutenção local.

## Links relacionados

- Dependências e supply chain: [DEPENDENCY_AUTOMATION.md](./DEPENDENCY_AUTOMATION.md)
- Segurança operacional: [SECURITY.md](./SECURITY.md)
- Hub de operações: [README.md](./README.md)
