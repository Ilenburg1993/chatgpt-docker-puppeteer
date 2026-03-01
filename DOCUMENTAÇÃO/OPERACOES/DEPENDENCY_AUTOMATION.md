# Automação de Dependências

**Propósito**: documentar o contrato vivo de atualização, triagem e auditoria de dependências no
repositório.  
**Status documental**: Canônico.  
**Público**: engenharia, manutenção, revisão de PR e agentes de IA.  
**Última atualização**: 1 de março de 2026.

## Escopo

Este documento cobre:

- configuração do Dependabot;
- workflows GitHub Actions que validam PRs de dependência;
- política de `npm audit` com tratamento de advisories sem versão publicada;
- rotina operacional para triagem de risco residual.

Ele não substitui a documentação geral de segurança do runtime em [SECURITY.md](./SECURITY.md).

## Arquivos canônicos

- Dependabot: [../../.github/dependabot.yml](../../.github/dependabot.yml)
- Review de dependências: [../../.github/workflows/dependency-review.yml](../../.github/workflows/dependency-review.yml)
- Higiene periódica: [../../.github/workflows/dependency-hygiene.yml](../../.github/workflows/dependency-hygiene.yml)
- Segurança: [../../.github/workflows/security.yml](../../.github/workflows/security.yml)
- Gate de auditoria npm: [../../scripts/security/npm-audit-gate.mjs](../../scripts/security/npm-audit-gate.mjs)
- Auditor de superfície declarada/usada: [../../scripts/analysis/audit-dependencies.js](../../scripts/analysis/audit-dependencies.js)
- Hub de automação GitHub: [GITHUB_AUTOMATION.md](./GITHUB_AUTOMATION.md)

## Stack de automação atual

### 1. Dependabot

O Dependabot cobre três ecossistemas:

- `npm`
- `github-actions`
- `docker`

Regras operacionais atuais:

- `target-branch: main`
- `rebase-strategy: auto`
- `versioning-strategy: increase-if-necessary` para `npm`
- `cooldown` ativo para reduzir churn
- horários agendados deslocados para fora do `:00`
- `pull-request-branch-name.separator: "-"` para evitar nomes de branch com `/`
- labels explícitas por ecossistema, incluindo `dependabot`
- agrupamento por domínio (`runtime-core`, `security-foundation`, `toolchain-and-watchers`, etc.)

Objetivo prático:

- reduzir PRs fragmentadas;
- priorizar updates de runtime e segurança;
- manter PRs de tooling mais previsíveis e fáceis de revisar.

### 2. Dependency Review (PR)

O workflow [dependency-review.yml](../../.github/workflows/dependency-review.yml):

- roda `actions/dependency-review-action`;
- valida `npm ci --ignore-scripts` para PRs do `dependabot[bot]`;
- aplica triagem automática em PRs do Dependabot.

Na triagem automática, o workflow:

- adiciona labels estruturais (`dependabot`, `deps:patch|minor|major`, `deps:runtime|dev`);
- publica ou atualiza um comentário de triagem na PR;
- explicita que patches/minors seguem fast-path após checks verdes e majors ficam em revisão manual.

Observação importante:

- o GitHub Actions também pode exibir um item chamado `Dependabot Updates` com `on: dynamic`;
- esse item é da plataforma GitHub/Dependabot, não um YAML versionado em `.github/workflows/`.

### 3. Security (prod)

O workflow [security.yml](../../.github/workflows/security.yml):

- executa `npm` audit para dependências de produção via gate local;
- publica resumo em `GITHUB_STEP_SUMMARY`;
- faz upload dos artefatos do scan;
- roda CodeQL no mesmo fluxo.

Esse workflow aceita `workflow_dispatch`, além de `push`, `pull_request` e agenda semanal.

### 4. Dependency Hygiene (full graph)

O workflow [dependency-hygiene.yml](../../.github/workflows/dependency-hygiene.yml):

- roda auditoria completa (`prod + dev`) com severidade mínima `moderate`;
- executa o auditor de dependências declaradas vs. usadas;
- gera artefatos para revisão periódica da saúde da árvore de dependências, mesmo quando o gate
  de `npm audit` encontra issues acionáveis.

Esse fluxo é deliberadamente separado do `security.yml`:

- `security.yml` protege o caminho de produção;
- `dependency-hygiene.yml` inspeciona o ecossistema completo e o drift de tooling.

## Política do npm audit

### Regra de decisão

O `npm audit` puro não é a fonte de verdade operacional final neste repositório.

O wrapper [npm-audit-gate.mjs](../../scripts/security/npm-audit-gate.mjs):

- roda `npm audit --json`;
- cruza os “fixes” com `npm view`, exigindo evidência consistente no packument do pacote e no
  manifesto da versão exata (lista de `versions`, `time` e `dist.tarball`);
- separa findings em:
  - `actionable`
  - `manual-review`
  - `unpublished-fix`
  - `no-fix`

### O que bloqueia pipeline

O pipeline só falha quando há finding `actionable`:

- existe correção publicada;
- a correção não exige revisão semver major.

### O que não bloqueia automaticamente

Os cenários abaixo geram risco residual documentado, mas não falha automática:

- advisory aponta “fix” para versão não publicada no registry (`unpublished-fix`);
- a correção existe, mas exige upgrade major (`manual-review`);
- o próprio `npm audit` informa que não há correção (`no-fix`).

Essa regra evita tratar advisory inconsistente do ecossistema como erro de CI do projeto.

Ela também reduz falsos positivos transitórios de cache/edge do registry: um único `npm view
<pacote>@<versão>` positivo não basta para tornar o finding bloqueante.

## Comandos operacionais

- Audit de produção: `npm run audit:npm:prod`
- Audit completo: `npm run audit:npm:full`
- Superfície declarada/usada: `node scripts/analysis/audit-dependencies.js --json`
- Workflows locais: `npm run check:workflows`

## Triagem manual obrigatória

Mesmo com automação, ainda exigem revisão humana:

- upgrades `semver-major`;
- casos em que o advisory sugere downgrade major para remediação;
- vulnerabilidades em pacotes sem correção publicada;
- mudanças de `docker` e de `github-actions` que afetem permissões, auth ou runtime de CI.

## Risco residual conhecido em 1 de março de 2026

Na revisão atual, ainda existem advisories relevantes cujo “fix” publicado pelo `npm audit` não
está disponível no registry público no momento da validação.

Exemplos observados:

- `basic-ftp`
- `systeminformation`
- `minimatch`
- faixas específicas de `ajv`

Estado de ancoragem aplicado no projeto nesta revisão:

- `basic-ftp` fixado em `5.1.0` via `overrides` (última versão estável efetivamente publicada hoje);
- `systeminformation` fixado em `5.30.7` via `overrides` (última versão estável efetivamente
  publicada hoje);
- `glob` moderno disponível no topo da árvore em `13.0.2` para uso explícito de tooling;
- `minimatch` moderno disponível no topo da árvore em `10.1.2` para uso explícito de tooling.

Importante:

- a presença de `glob`/`minimatch` modernos no topo não remove automaticamente subárvores legadas
  transitivas;
- consumers antigos, como `rimraf@3` dentro de dependências de terceiros, ainda podem carregar
  `glob@7`/`minimatch@3` até que os fornecedores publiquem uma cadeia compatível.

Esse estado deve ser tratado como dependência do ecossistema, não como correção local pendente.

## Regras de manutenção

- Não reintroduzir `npm audit` bruto como gate bloqueante sem validação de registry.
- Se um workflow de dependências mudar, atualizar este documento e os hubs em `DOCUMENTAÇÃO/`.
- PR do Dependabot não deve ser aprovada só pelo nome do pacote; a decisão passa pelos checks.
- Quando um advisory migrar de `unpublished-fix` para `actionable`, a correção deve voltar a ser
  tratada como backlog de update normal.

## Links relacionados

- Segurança operacional: [SECURITY.md](./SECURITY.md)
- Deploy: [DEPLOYMENT.md](./DEPLOYMENT.md)
- Hub de operações: [README.md](./README.md)
- Política de scan: [../AUDITORIAS/SECURITY_SCAN_POLICY.md](../AUDITORIAS/SECURITY_SCAN_POLICY.md)
