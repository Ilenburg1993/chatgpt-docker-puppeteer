# Auditoria Estrutural de ENV

**Status**: Canônico  
**Data da auditoria**: 1 de março de 2026  
**Escopo**: arquivos `.env*`, bootstrap de runtime, DevContainer, validação e referência documental.

## Resumo Executivo

A estrutura de ambiente do projeto estava funcional, mas com drift entre runtime, schema,
validadores e documentação. Os principais problemas eram:

- comentários e guias descrevendo uma ordem de bootstrap diferente da implementada;
- enums divergentes entre [`src/core/config.js`](../../src/core/config.js) e
  [`.env.schema.json`](../../.env.schema.json);
- validador do DevContainer sem suporte completo aos modos atuais de `BROWSER_MODE`;
- utilitários de auditoria em `scripts/env/` resolvendo a raiz do projeto para `scripts/`, o que
  quebrava a própria validação;
- templates `.env*` com duplicação e exemplos desalinhados;
- documentação de referência tratando `.env` como fonte única e ignorando `remoteEnv` e
  `.env.local`.

Nesta rodada, o baseline foi alinhado sem alterar o modelo estrutural do projeto.

Uma segunda consolidação completou a cobertura dos `envs`:

- o schema passou a cobrir o baseline validado de driver, rede avançada, stack de conhecimento e
  runtime interno;
- o template [`.env.example`](../../.env.example) ganhou seções explícitas para orquestração,
  storage e sidecars opcionais que antes existiam apenas no código.
- as lacunas restantes foram reduzidas a knobs de especialista e variáveis automáticas/auxiliares,
  mantidas fora do template por decisão consciente.
- essas chaves especializadas agora foram consolidadas em
  [`.env.expert.example`](../../.env.expert.example), em vez de ficarem apenas no código.

Uma terceira passagem endureceu a camada `.devcontainer`:

- `FORCE_COLOR` foi removido do `containerEnv`, porque era um global de UX inadequado;
- defaults já pertencentes ao Dockerfile deixaram de ser duplicados no `containerEnv`;
- a fronteira entre Dockerfile, `containerEnv`, `runArgs --env-file` e `remoteEnv` foi
  explicitamente reclassificada na documentação canônica e na skill de governança.

## Evidências Auditadas

- Runtime:
  - [`src/core/env_bootstrap.js`](../../src/core/env_bootstrap.js)
  - [`src/core/config.js`](../../src/core/config.js)
- Schema e validação:
  - [`.env.schema.json`](../../.env.schema.json)
  - [`.devcontainer/scripts/validate-env.sh`](../../.devcontainer/scripts/validate-env.sh)
  - [`scripts/env/validate-env.js`](../../scripts/env/validate-env.js)
  - [`scripts/env/check-env-local.mjs`](../../scripts/env/check-env-local.mjs)
  - [`scripts/env/audit-env-surface.mjs`](../../scripts/env/audit-env-surface.mjs)
- Templates e perfis:
  - [`.env.example`](../../.env.example)
  - [`.env.expert.example`](../../.env.expert.example)
  - [`.env.local.example`](../../.env.local.example)
  - [`.env.development`](../../.env.development)
  - [`.env.production`](../../.env.production)
  - [`.env.test`](../../.env.test)
- DevContainer:
  - [`.devcontainer/devcontainer.json`](../../.devcontainer/devcontainer.json)
  - [`.devcontainer/scripts/sync-local-auth.sh`](../../.devcontainer/scripts/sync-local-auth.sh)
- Documentação:
  - [../REFERENCIA/ENV_VARIABLES_GUIDE.md](../REFERENCIA/ENV_VARIABLES_GUIDE.md)
  - [../REFERENCIA/CONFIGURATION.md](../REFERENCIA/CONFIGURATION.md)
  - [../INDEX.md](../INDEX.md)

## Correções Aplicadas

### 1. Bootstrap e mensagens de runtime

- Corrigido o comentário de [`src/core/env_bootstrap.js`](../../src/core/env_bootstrap.js) para
  refletir a ordem real: `.env` -> `.env.<NODE_ENV>` -> `.env.local` -> `.env.<NODE_ENV>.local`.
- Atualizada a validação inicial em [`src/core/config.js`](../../src/core/config.js):
  - removidas referências legadas a `DASHBOARD_PORT` e `CHROME_REMOTE_DEBUGGING_ADDRESS`;
  - o conjunto recomendado agora acompanha o baseline atual (`SERVER_PORT`, `BROWSER_MODE`,
    `CHROME_PROXY_PORT`);
  - a mensagem de erro agora aponta para `.env`, `.env.local` e `remoteEnv`, em vez de presumir
    apenas `cp .env.example .env`.

### 2. Alinhamento entre schema e runtime

- Atualizado [`.env.schema.json`](../../.env.schema.json) para bater com o runtime:
  - `BROWSER_MODE` agora aceita `executablePath` e `external`;
  - `ALLOCATION_STRATEGY` agora usa `round-robin`, `least-loaded` e `target-affinity`.
- Isso elimina divergência entre o schema usado por `scripts/env/validate-env.js` e o
  `ConfigSchema` real.

### 3. Validação do DevContainer

- [`validate-env.sh`](../../.devcontainer/scripts/validate-env.sh) passou a aceitar o enum atual de
  `BROWSER_MODE`.
- O bloco de hints de arquivos agora reconhece:
  - `.env.<NODE_ENV>.local`
  - `.env.local`
  - `.env.local.example`
- O script também foi ajustado para documentar corretamente que `remoteEnv` e `containerEnv`
  podem ser a fonte do ambiente.
- Os utilitários [`scripts/env/validate-env.js`](../../scripts/env/validate-env.js) e
  [`scripts/env/check-env-local.mjs`](../../scripts/env/check-env-local.mjs) tiveram a resolução da
  raiz corrigida de `scripts/` para a raiz real do projeto.

### 4. Templates `.env*`

- [`.env.example`](../../.env.example) agora documenta a resolução real em duas etapas:
  composição de `process.env` e override posterior por `config.json` para chaves do
  `ConfigurationManager`.
- [`.env.example`](../../.env.example) e [`.env.local.example`](../../.env.local.example) foram
  atualizados para refletir:
  - uso preferencial de `.env.local` para segredos;
  - precedência de `.env*.local` sobre valores do host quando a mesma chave é repetida;
  - enums atuais de `BROWSER_MODE` e `ALLOCATION_STRATEGY`.
- [`.env.development`](../../.env.development) teve duplicação de cabeçalho removida.
- [`.env.production`](../../.env.production) foi corrigido em dois pontos:
  - `ALLOCATION_STRATEGY=least-loaded` (antes: `least-busy`, fora do runtime atual);
  - remoção de duplicações redundantes de chaves `BIOMECH_*`.

### 5. Bootstrap de autenticação local

- O comentário contratual de
  [`sync-local-auth.sh`](../../.devcontainer/scripts/sync-local-auth.sh) foi corrigido para deixar
  explícito que `remoteEnv` não tem precedência absoluta: `.env*.local` sobrescreve chaves
  duplicadas quando presente.

### 6. Documentação canônica

- [../REFERENCIA/ENV_VARIABLES_GUIDE.md](../REFERENCIA/ENV_VARIABLES_GUIDE.md) foi reescrito como
  referência enxuta e correta do baseline atual.
- [../REFERENCIA/CONFIGURATION.md](../REFERENCIA/CONFIGURATION.md) recebeu uma nota de baseline para
  redirecionar o leitor ao guia canônico e a esta auditoria antes de seguir exemplos legados.
- Hubs atualizados:
  - [../REFERENCIA/README.md](../REFERENCIA/README.md)
  - [../AUDITORIAS/README.md](../AUDITORIAS/README.md)
  - [../INDEX.md](../INDEX.md)

### 7. Hardening do DevContainer

- [`.devcontainer/devcontainer.json`](../../.devcontainer/devcontainer.json) deixou de exportar
  `FORCE_COLOR` globalmente.
- O `containerEnv` foi reduzido para o que realmente complementa a imagem; defaults estáveis como
  `NODE_ENV`, `LOG_LEVEL`, `LANG`, `PUPPETEER_LOCAL_LAUNCH_DISABLED` e parte do bloco `NPM_CONFIG_*`
  permanecem no Dockerfile como baseline primário.
- O fallback de `LOG_LEVEL` no `remoteEnv` foi alinhado com o baseline de desenvolvimento
  (`debug`), reduzindo drift entre processos do VS Code e o `.env.development`.
- O comentário contratual do Dockerfile foi corrigido para refletir a precedência real,
  incluindo `containerEnv`, bootstrap `.env*` e `config.json`.

## Estado Final da Precedência

### Composição de `process.env`

1. ambiente do processo/container (`containerEnv`, `--env-file`, `remoteEnv`, shell, CI);
2. `.env` sem override;
3. `.env.<NODE_ENV>` com override;
4. `.env.local` com override;
5. `.env.<NODE_ENV>.local` com override.

### Resolução para chaves de `ConfigSchema`

1. defaults podem nascer do `process.env`;
2. `config.json` sobrescreve defaults quando a chave existe;
3. na ausência de override, prevalece o default do schema/código.

## Riscos Residuais

- O projeto ainda possui documentos históricos e relatórios antigos que citam hierarquias legadas
  de `.env`; eles devem ser tratados como material histórico, não como baseline operacional.
- A precedência atual de `config.json` sobre defaults derivados de env é intencional no desenho
  vigente, mas pode surpreender quem espera “env sempre vence”. Isso foi documentado, não
  alterado.
- O schema agora cobre o baseline versionado (`.env.development`, `.env.production` e `.env.test`)
  sem avisos de `Extras not in schema`, mas ainda existem knobs de especialista fora do template
  principal por decisão consciente (por exemplo `ADAPTER_*`, `HANDLE_*`, `RESOLVER_*` e
  `SPLIT_CONNECT_*`).
- `.env` local fora do versionamento pode continuar divergindo do template; esse arquivo é, por
  definição, específico do ambiente de cada operador.
- Shells ou wrappers externos ainda podem reintroduzir `FORCE_COLOR`; quando isso acontecer, o
  warning de `NO_COLOR` volta a aparecer mesmo com o baseline do DevContainer corrigido.

## Recomendações Operacionais

1. Usar [`.env.local.example`](../../.env.local.example) como ponto de partida para segredos locais.
2. Manter `remoteEnv` como canal primário para credenciais exigidas por extensões e agentes do VS
   Code.
3. Manter `FORCE_COLOR` restrito a processos que realmente precisam forçar cor; não reintroduzi-lo
   como export global de container.
4. Executar periodicamente:
   - [`node scripts/env/validate-env.js`](../../scripts/env/validate-env.js)
   - [`node scripts/env/check-env-local.mjs`](../../scripts/env/check-env-local.mjs)
5. Ao alterar `ConfigSchema`, revisar no mesmo change set:
   - [`.env.schema.json`](../../.env.schema.json)
   - [`.env.example`](../../.env.example)
   - [../REFERENCIA/ENV_VARIABLES_GUIDE.md](../REFERENCIA/ENV_VARIABLES_GUIDE.md)

## Artefatos Relacionados

- Referência canônica: [../REFERENCIA/ENV_VARIABLES_GUIDE.md](../REFERENCIA/ENV_VARIABLES_GUIDE.md)
- Hub de auditorias: [./README.md](./README.md)
- Hub de referência: [../REFERENCIA/README.md](../REFERENCIA/README.md)
