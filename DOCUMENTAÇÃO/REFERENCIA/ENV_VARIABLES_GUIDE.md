# Guia de Variáveis de Ambiente

**Status**: Canônico  
**Data**: 1 de março de 2026  
**Escopo**: bootstrap de `.env*`, precedência real, integração com DevContainer e validação.

## Visão Geral

O projeto usa duas camadas complementares de configuração:

1. composição de `process.env` a partir do container, shell e arquivos `.env*`;
2. resolução de configuração em runtime via [`src/core/config.js`](../../src/core/config.js), com
   `config.json` como override explícito para as chaves cobertas pelo `ConfigSchema`.

Os contratos atuais estão implementados em:

- [`src/core/env_bootstrap.js`](../../src/core/env_bootstrap.js)
- [`src/core/config.js`](../../src/core/config.js)
- [`.env.schema.json`](../../.env.schema.json)
- [`.devcontainer/devcontainer.json`](../../.devcontainer/devcontainer.json)
- [`.devcontainer/scripts/sync-local-auth.sh`](../../.devcontainer/scripts/sync-local-auth.sh)
- [`.devcontainer/scripts/validate-env.sh`](../../.devcontainer/scripts/validate-env.sh)

## Arquivos de Ambiente

| Arquivo | Papel | Versionado | Observação |
| --- | --- | --- | --- |
| [`.env.example`](../../.env.example) | template de baseline local | sim | documenta defaults e estrutura do env |
| [`.env.local.example`](../../.env.local.example) | template de segredos e overrides pessoais | sim | base recomendada para credenciais |
| [`.env.expert.example`](../../.env.expert.example) | catálogo de knobs especializados | sim | copiar chaves pontuais para `.env.local`/runtime |
| `.env` | baseline local ativo | não | carregado sem sobrescrever env já existente |
| [`.env.development`](../../.env.development) | perfil de desenvolvimento | sim | pode ser usado como referência/base |
| [`.env.production`](../../.env.production) | perfil de produção | sim | template hardened para deploy |
| [`.env.test`](../../.env.test) | perfil de testes | sim | baseline para testes automatizados |
| `.env.local` | override local e segredos | não | sobrescreve chaves repetidas |
| `.env.<NODE_ENV>.local` | override mais específico por ambiente | não | maior prioridade entre arquivos `.env*` |

O baseline atual também inclui duas camadas de cobertura:

- [`.env.schema.json`](../../.env.schema.json) cobre o baseline validado (`.env.development`,
  `.env.production`, `.env.test` e os contratos promovidos ao fluxo principal);
- [`.env.example`](../../.env.example) inclui não só o baseline principal, mas também knobs de
  orquestração, storage e sidecars opcionais;
- [`.env.expert.example`](../../.env.expert.example) concentra os knobs especializados que
  permanecem fora do baseline principal;
- [`scripts/env/audit-env-surface.mjs`](../../scripts/env/audit-env-surface.mjs) é o guardrail que
  verifica a cobertura total da superfície de `process.env.*` pelos templates commitados.

## Precedência Real

### Etapa 1: composição de `process.env`

O bootstrap é idempotente e segue a ordem implementada em
[`src/core/env_bootstrap.js`](../../src/core/env_bootstrap.js):

1. O processo nasce com o ambiente do container/shell.
   Fontes típicas: Dockerfile `ENV`, `containerEnv`, `--env-file`, `remoteEnv`, exports manuais e
   CI.
2. `.env` é carregado sem `override`.
   Ele só preenche chaves ainda ausentes.
3. `.env.<NODE_ENV>` é carregado com `override=true`.
4. `.env.local` é carregado com `override=true`.
5. `.env.<NODE_ENV>.local` é carregado com `override=true`.

Consequência prática:

- variáveis definidas em `.env*.local` sobrescrevem valores vindos do host/`remoteEnv` quando a
  mesma chave aparece nas duas fontes;
- `remoteEnv` continua sendo a melhor forma de expor segredos para extensões, LSPs e agentes do VS
  Code, mas não tem prioridade absoluta sobre `.env*.local`.

### Etapa 2: resolução do `ConfigurationManager`

Para as chaves cobertas pelo `ConfigSchema` em [`src/core/config.js`](../../src/core/config.js):

1. os defaults do schema podem nascer de `process.env`;
2. o [`config.json`](../../config.json) é carregado depois;
3. quando uma chave existe no `config.json`, ela sobrescreve o default derivado do env;
4. na ausência de valor explícito, prevalece o default do schema/código.

Isso significa que a precedência final depende da superfície:

- módulos que leem `process.env` diretamente seguem a Etapa 1;
- módulos que usam `CONFIG`/`ConfigurationManager` seguem a Etapa 2.

## DevContainer e Ferramentas

### Camadas do DevContainer

No baseline atual, a fronteira correta é:

- `Dockerfile ENV`: defaults estáveis da imagem e do container, independentes do host.
- `containerEnv`: complementos específicos do DevContainer que ainda fazem sentido como baseline do
  container de desenvolvimento.
- `runArgs --env-file`: baseline versionado de desenvolvimento (`.env.development`) injetado no
  runtime do container.
- `remoteEnv`: ponte do host para processos geridos pelo VS Code no container.

Regra prática:

- se a variável é um default estrutural e não depende do host, prefira Dockerfile;
- se a variável só precisa existir no DevContainer, mas não é segredo, `containerEnv` é aceitável;
- se a variável vem do host e precisa alcançar extensões, terminais e agentes, use `remoteEnv`;
- se a variável é UX/tuning pontual, prefira env por processo e não uma exportação global.

### `remoteEnv` e segredos do host

O DevContainer espelha variáveis do host em `remoteEnv` em
[`.devcontainer/devcontainer.json`](../../.devcontainer/devcontainer.json).
Esse é o caminho recomendado para credenciais que precisam chegar a:

- terminais do VS Code;
- extensões;
- LSPs;
- agentes/LLMs rodando no lado remoto do editor.

### `FORCE_COLOR` e `NO_COLOR`

`FORCE_COLOR` não deve ser definido globalmente no `containerEnv` nem no Dockerfile.

Motivo:

- muitos shells e integrações do operador já exportam `NO_COLOR`;
- quando `FORCE_COLOR` e `NO_COLOR` chegam juntos ao processo, o Node emite warning no startup;
- limpar `NO_COLOR` dentro do JavaScript não evita esse warning, porque ele ocorre antes do código
  do processo rodar.

No baseline atual, `FORCE_COLOR` deve ficar apenas em contextos por processo que realmente precisam
forçar cor (por exemplo PM2, testes e helpers específicos).

### Bootstrap local de shell e `gh`

[`sync-local-auth.sh`](../../.devcontainer/scripts/sync-local-auth.sh):

- injeta `.env.local` em novos shells via `~/.profile` e `~/.bashrc`;
- usa `GITHUB_PERSONAL_ACCESS_TOKEN` para persistir autenticação do `gh` em `~/.config/gh`;
- respeita `GH_TOKEN`/`GITHUB_TOKEN` como auth somente por ambiente, sem persistência.

### Validadores

- [`validate-env.sh`](../../.devcontainer/scripts/validate-env.sh): valida variáveis estruturais e
  dá hints de arquivos locais antes do bootstrap do DevContainer.
- [`scripts/env/validate-env.js`](../../scripts/env/validate-env.js): valida perfis `.env.*`
  versionados contra [`.env.schema.json`](../../.env.schema.json).
- [`scripts/env/check-env-local.mjs`](../../scripts/env/check-env-local.mjs): garante que
  `.env.local` continua ignorado e que os templates [`.env.local.example`](../../.env.local.example)
  e [`.env.expert.example`](../../.env.expert.example) existem.
- [`scripts/env/audit-env-surface.mjs`](../../scripts/env/audit-env-surface.mjs): mapeia
  `process.env.*` no código e lista o que ainda não está coberto pelos templates commitados.

## Regras Operacionais

### Desenvolvimento local

1. Crie o override local com `cp .env.local.example .env.local`.
2. Preencha chaves pessoais e segredos apenas em `.env.local`.
3. Use `.env` apenas quando precisar de um baseline local fora dos templates versionados.

### Produção

1. Parta de [`.env.production`](../../.env.production) ou de variáveis injetadas pelo runtime.
2. Evite segredos em arquivos versionados.
3. Prefira segredos por orquestrador, `remoteEnv`, secrets manager ou env do processo.

### Higiene de segredos

- nunca commit `.env.local` ou `.env.<NODE_ENV>.local`;
- mantenha apenas templates (`*.example`) no repositório;
- se a mesma chave existir no host e em `.env.local`, o valor local vence.

## Limite Deliberado do Template

O template [`.env.example`](../../.env.example) foi consolidado para cobrir o baseline operacional
e os sidecars opcionais relevantes. Algumas chaves continuam fora dele por design:

- variáveis automáticas do runtime/orquestrador (`NODE_APP_INSTANCE`, `PM2_*`, `CHATGPT_ENV_*`);
- aliases e compatibilidades de baixo valor operacional (`CHROME_WSE`, `CHROME_URL`, etc.);
- knobs internos de especialista ainda não promovidos ao baseline geral (`ADAPTER_*`, `HANDLE_*`,
  `RESOLVER_*`, `SPLIT_CONNECT_*`, `NERV_SOCKET_URL`, `MCP_DIAG_URL`).

Essas chaves existem no código, mas não foram elevadas ao template principal para evitar poluir o
baseline com tuning de baixo uso. O catálogo vivo dessas chaves fica em
[`.env.expert.example`](../../.env.expert.example). Se alguma delas virar contrato recorrente de
operação, o caminho correto é promovê-la ao `.env.example` e ao schema no mesmo change set.

## Variáveis Estruturais Críticas

As chaves abaixo devem permanecer coerentes entre templates, schema e runtime:

- `NODE_ENV`
- `SERVER_MODE`
- `SERVER_AUTHORITY`
- `BROWSER_MODE`
- `SERVER_PORT`
- `CHROME_HOST`
- `CHROME_PORT`
- `CHROME_PROXY_PORT`

Enums relevantes no baseline atual:

- `BROWSER_MODE`: `launcher`, `connect`, `wsEndpoint`, `executablePath`, `auto`, `external`
- `ALLOCATION_STRATEGY`: `round-robin`, `least-loaded`, `target-affinity`

## Troubleshooting Rápido

### O valor do host não apareceu na aplicação

Verifique se a mesma chave está definida em `.env.local` ou `.env.<NODE_ENV>.local`.
Esses arquivos sobrescrevem o valor vindo de `remoteEnv`.

### A extensão/LLM não enxerga a variável, mas o app enxerga

Isso normalmente indica que a chave foi carregada apenas via `.env.local`.
Nesse caso, replique a variável no host para que o `remoteEnv` a propague ao ambiente remoto do VS
Code.

### O `gh` funciona no shell, mas não em outro processo

Revise se o token está em `GH_TOKEN`/`GITHUB_TOKEN` (somente runtime) ou em
`GITHUB_PERSONAL_ACCESS_TOKEN` (persistência em `~/.config/gh`).

### Aparece warning de `NO_COLOR` no startup do Node

Revise se algum shell, wrapper ou processo ainda está exportando `FORCE_COLOR` globalmente.
O baseline do DevContainer não faz mais isso; quando o warning aparece, a origem costuma ser um
export local/transitório fora do contrato canônico.

## Auditoria Relacionada

O diagnóstico estrutural mais recente está em
[../AUDITORIAS/ENV_STRUCTURE_AUDIT_2026-03-01.md](../AUDITORIAS/ENV_STRUCTURE_AUDIT_2026-03-01.md).

## Documentos Relacionados

- [CONFIGURATION.md](./CONFIGURATION.md)
- [README.md](./README.md)
- [../OPERACOES/DEVCONTAINER.md](../OPERACOES/DEVCONTAINER.md)
- [../../.devcontainer/ENV_VARIABLE_REFERENCE.md](../../.devcontainer/ENV_VARIABLE_REFERENCE.md)
