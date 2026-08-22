# `src/copilot/infra/public`

`public/` é a **membrana exclusiva de API** de `src/copilot/infra`.

Ela não é owner de implementação. Um `index.js` existe aqui somente quando há um entrypoint deliberadamente declarado em `package.json#imports`; diretórios de namespace podem existir sem barrel. Isso separa três perguntas que não devem voltar a ser confundidas:

- **onde a capability é implementada?** → árvore interna de `infra`;
- **o que consumidores externos podem enxergar?** → `infra/public/**/index.js` aprovado;
- **qual alias resolve esse entrypoint?** → `package.json#imports`.

## Regras

1. Consumidores de produção fora de `infra` usam somente `#copilot/infra/public/...`.
2. Código interno de `infra` nunca importa de `public`.
3. `public` não possui lógica, estado, timers, workers, watchers ou lifecycle próprio; é projection-only.
4. `public/**/index.js` existe **somente** para entrypoint declarado; marker/namespace barrels sem alias são proibidos.
5. Aliases `#copilot/infra/public/...` e projection barrels formam uma bijeção verificada pelo governance.
6. Não existe `public/index.js` root; um mega-barrel global permanece proibido.
7. Um projection barrel exporta nomes nominais e aponta somente para owner/barrel interno ou child entrypoint aprovado.
8. Exposição pública é deliberada: adicionar um alias implica contrato arquitetural, metadata semântica e budget de custo.
9. Runtime test-control não vaza; resets ficam no entrypoint deliberado `#copilot/infra/public/testing`.
10. Surfaces diagnósticas são explicitamente nomeadas em `public/diagnostic/**` e não constituem rotas runtime alternativas.

## Fontes de verdade

A API pública não mantém inventário manual paralelo:

- `package.json#imports` define os aliases resolvíveis;
- `src/copilot/infra/governance/public-api-manifest.js` define audience, privilege, lifecycle, stability, cost tier e exports aprovados;
- [`API_REFERENCE.md`](./API_REFERENCE.md) é a projeção humana determinística desses metadados mais a closure estática corrente.

Regeneração e verificação:

```bash
npm run copilot:infra:public-api-docs
npm run copilot:infra:public-api-docs:check
npm run copilot:architecture:check
```

`copilot:architecture:check` falha se a referência gerada estiver stale.

## Direção

```text
outside infra
    │
    ▼
#copilot/infra/public/<entrypoint>
    │
    ▼
public/<entrypoint>/index.js
    │  named exports only
    ▼
internal capability owner/barrel
    │
    ▼
implementation owners
```

A direção inversa é proibida.

## Audiences

As categorias operacionais são derivadas do manifest, não de uma árvore manual:

- **composition** — cria/binda authority e lifecycle deliberados (`ProcessInfra`, `InfraRuntime`, workspace facets, configured filesystem e SQLite configured-bound composition);
- **runtime** — primitives/capabilities estáveis consumíveis por runtime sem atravessar internals;
- **diagnostic** — análise, governance e inspeção explícitas, fora do hot path normal; raw-path resources, quando existirem, são `diagnostic-only`;
- **test** — controles deliberadamente restritos a testes; raw-path resources de fixture são `test-only` e não reutilizam a classificação diagnostic.

O inventário exato e os custos atuais estão em [`API_REFERENCE.md`](./API_REFERENCE.md).

## Exemplo

Correto, fora de `infra`:

```js
import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import { readIoRuntimeHealthSnapshot } from '#copilot/infra/public/observability';
```

Incorreto em código de produção fora de `infra`:

```js
import { createWorkspaceIo } from '#copilot/infra/internal/filesystem/workspace';
import { createWorkspaceIo } from '../../infra/filesystem/workspace/index.js';
```

O primeiro atravessa a fronteira privada; o segundo contorna o resolver/package map.
