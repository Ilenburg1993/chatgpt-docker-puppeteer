# `src/copilot/infra/public`

`public/` é a **API membrane exclusiva** de `src/copilot/infra`.

Ela não é owner de implementação. Cada `index.js` desta árvore projeta um barrel interno já existente. O objetivo é separar duas perguntas diferentes:

- **onde a capability é implementada?** → árvore interna de `infra`;
- **o que consumidores externos podem enxergar?** → `infra/public`.

## Regras

1. Consumidores externos usam somente `#copilot/infra/public/...`.
2. Código interno de infra nunca importa de `public`.
3. `public` não possui lógica, estado, timers, workers, watchers ou factories próprias.
4. Cada diretório abaixo de `public/` possui `index.js`.
5. Não existe `public/index.js` root; isso evita um mega-barrel global.
6. Um projection barrel aponta somente a barrels internos ou a child public barrels.
7. Exposição pública é deliberada: criar um diretório aqui significa assumir compatibilidade arquitetural para aquela capability.
8. Runtime test-control não vaza; resets ficam em `public/testing`.
9. Uma surface diagnóstica deve ser nomeada pela intenção. Exemplo: `indexing/storage` existe para benchmark/auditoria do store persistente; não é convite para runtime comum contornar `indexing/registry`.

## Direção

```text
outside infra
    │
    ▼
#copilot/infra/public/<capability>
    │
    ▼
public/<capability>/index.js
    │  export only
    ▼
internal capability barrel
    │
    ▼
implementation owners
```

A direção inversa é proibida.

## Categorias

- `platform/`: primitives estáveis de plataforma;
- `concurrency/`: bulk/locks;
- `filesystem/`: read/write/mutation/invalidation/workspace/trusted/skills;
- `persistence/`: JSON/JSONL;
- `database/`: composition port SQLite;
- `cache/`: cache tiers;
- `code-analysis/`: análise estrutural pura;
- `indexing/`: index/context/parser/scanner/storage/workspace;
- `operations/`: operações/transações/rollback;
- `telemetry/`: producer-side telemetry;
- `observability/`: health/read projections;
- `policy/`: policy transversal;
- `testing/`: controles deliberadamente test-only.

A lista resolvível efetiva está em `package.json#imports`.

## Exemplo

Correto, fora de infra:

```js
import { createWorkspaceIo } from '#copilot/infra/public/filesystem/workspace';
import { getIoIndexStats } from '#copilot/infra/public/indexing';
```

Incorreto:

```js
import { createWorkspaceIo } from '#copilot/infra/internal/filesystem/workspace';
import { createWorkspaceIo } from '../../infra/filesystem/workspace/index.js';
```

O primeiro atravessa a fronteira privada; o segundo contorna o resolver/package map.
