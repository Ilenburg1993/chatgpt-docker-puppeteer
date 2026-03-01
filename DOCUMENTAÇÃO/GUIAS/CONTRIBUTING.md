# Guia de Contribuição

**Propósito**: documentar o fluxo canônico de contribuição para código, documentação e automação, usando os templates, scripts e restrições reais do repositório atual.  
**Status documental**: Canônico.  
**Público**: contribuidores internos, colaboradores externos e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Escopo

Este guia cobre:

- como propor mudanças;
- como preparar branch e commits;
- quais validações mínimas rodar;
- como alinhar PRs com o padrão atual do repositório.

Arquitetura e contexto estrutural:

- [../ARQUITETURA/README.md](../ARQUITETURA/README.md)
- [../ARQUITETURA/ARCHITECTURE.md](../ARQUITETURA/ARCHITECTURE.md)

## Antes de contribuir

Confira primeiro:

- se já existe issue ou PR cobrindo o mesmo tema;
- se a mudança é local e incremental, ou se mexe em arquitetura, contratos ou runtime;
- se o impacto exige atualização documental.

Quando a mudança for estrutural, prefira alinhar o racional antes de expandir o escopo em código.

## Canais reais de abertura

O repositório já possui templates em `.github`:

- bug: [bug_report.yml](/workspaces/chatgpt-docker-puppeteer/.github/ISSUE_TEMPLATE/bug_report.yml)
- feature: [feature_request.yml](/workspaces/chatgpt-docker-puppeteer/.github/ISSUE_TEMPLATE/feature_request.yml)
- melhorias de missão/configuração adicionais também vivem em `.github/ISSUE_TEMPLATE/`

Para PRs, o template ativo é:

- [PULL_REQUEST_TEMPLATE.md](/workspaces/chatgpt-docker-puppeteer/.github/PULL_REQUEST_TEMPLATE.md)

## Fluxo recomendado de contribuição

### 1. Preparar ambiente

Instale e valide:

```bash
npm install
npm run check:env
```

Guardrail importante:

- o `preinstall` bloqueia Yarn; o fluxo canônico é com `npm`.

### 2. Criar uma branch de trabalho

Convenções aceitas:

- `feat/descricao`
- `fix/descricao`
- `docs/descricao`
- `refactor/descricao`
- `perf/descricao`
- `test/descricao`
- `chore/descricao`

Exemplos:

```bash
git checkout -b docs/atualiza-guia-operacoes
git checkout -b fix/corrige-health-endpoint
git checkout -b feat/novo-fluxo-dashboard
```

Evite nomes vagos como `fix`, `test` ou `update`.

### 3. Fazer mudanças pequenas e verificáveis

Prefira lotes pequenos:

- uma correção por PR, ou um conjunto coeso;
- sem misturar refactor estrutural, feature e documentação sem necessidade;
- sem alterar contratos públicos por acidente.

### 4. Validar localmente

Validação mínima comum:

```bash
npm run lint
npm run format:check
npm run test:unit
```

Quando a mudança tocar integração, backend ou runtime:

```bash
npm run test:integration
```

Quando a mudança tocar tipagem, contratos amplos ou tooling:

```bash
npm run typecheck
```

Checagens complementares úteis:

```bash
npm run check:pre-flight
npm run check:env
```

Se você não rodou algum passo relevante, deixe isso explícito na descrição do PR.

## Commits

O padrão recomendado continua sendo Conventional Commits:

```text
type(scope): subject
```

Tipos mais úteis aqui:

- `feat`
- `fix`
- `docs`
- `refactor`
- `perf`
- `test`
- `chore`
- `ci`

Escopos comuns:

- `driver`
- `kernel`
- `orchestrator`
- `nerv`
- `infra`
- `server`
- `dashboard`
- `docs`
- `tests`

Exemplos:

```bash
git commit -m "docs(guias): reescreve guia de contribuicao"
git commit -m "fix(server): corrige resposta do health disk"
git commit -m "test(audit): cobre fallback do quality collector"
```

## Pull request

Ao abrir o PR:

1. use o template padrão do repositório;
2. preencha `Summary`, `Scope`, `Validation`, `Compatibility checklist` e `Risks and rollback`;
3. liste exatamente os comandos que você executou;
4. descreva riscos reais, não genéricos.

O checklist atual do template já assume:

- `npm run lint`
- `npm run format:check`
- `npm run test:unit`
- `npm run test:integration` quando aplicável
- compatibilidade com Node 24+

## O que uma boa contribuição deve preservar

- compatibilidade com Node 24+;
- ESM/imports sem regressão óbvia;
- comportamento consistente em Linux e Windows quando aplicável;
- documentação atualizada quando a mudança altera uso, contrato ou arquitetura.

## Quando a documentação deve ser atualizada

Atualize a documentação quando a mudança:

- altera comandos;
- muda porta, host, variável de ambiente ou fluxo de boot;
- adiciona ou remove endpoint;
- muda a topologia de diretórios;
- muda o comportamento esperado de testes, PM2 ou devcontainer.

Pontos canônicos mais comuns:

- [../ARQUITETURA/README.md](../ARQUITETURA/README.md)
- [../REFERENCIA/README.md](../REFERENCIA/README.md)
- [../OPERACOES/README.md](../OPERACOES/README.md)
- [./TESTES.md](./TESTES.md)

## O que evitar

- PRs enormes com temas desconexos;
- commits genéricos como `WIP`, `update`, `fix bug`;
- documentar suposições sem conferir `package.json`, `.env.example`, `Makefile` e o código;
- introduzir instruções destrutivas ou sem rollback claro;
- deixar wrappers de compatibilidade crescerem como se fossem baseline.

## Segurança e reporte responsável

Se a mudança tocar segurança:

- não exponha segredos em logs, exemplos ou issue pública;
- descreva risco, impacto e mitigação no PR;
- consulte [../OPERACOES/SECURITY.md](../OPERACOES/SECURITY.md) antes de afirmar política ou
  processo que não esteja documentado.

## Checklist rápido antes do PR

- [ ] A branch tem escopo claro.
- [ ] O diff não mistura temas sem necessidade.
- [ ] `npm run lint` foi executado.
- [ ] `npm run format:check` foi executado.
- [ ] `npm run test:unit` foi executado.
- [ ] `npm run test:integration` foi executado quando aplicável.
- [ ] A documentação canônica foi atualizada quando necessário.
- [ ] Os riscos e o rollback estão descritos.

## Leituras relacionadas

- [./DEVELOPMENT.md](./DEVELOPMENT.md)
- [./TESTES.md](./TESTES.md)
- [../OPERACOES/PM2_QUICK_REFERENCE.md](../OPERACOES/PM2_QUICK_REFERENCE.md)
- [../RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md](../RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md)
