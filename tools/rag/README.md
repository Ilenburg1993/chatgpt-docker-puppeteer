# RAG Local (Memória do Workspace) — `tools/rag`

Este diretório implementa um **RAG local, offline-first, incremental e determinístico** para o
workspace do projeto.

O RAG **não é um agente** e **não “responde”**: ele apenas **indexa**, **recupera** e **formata**
chunks reais do repositório para você colar como contexto em um LLM (local via Ollama, ou remoto).

## Importante: “isso é do container”

Sim: o banco e o índice vivem **no filesystem do DevContainer** em caminhos fixos:

- DB (LanceDB): `/home/node/.local/share/rag-db`
- Index/manifest/lock: `/home/node/.local/share/rag-index`

No seu DevContainer esses caminhos são **volume-mounted** (veja `.devcontainer/devcontainer.json`),
então o conteúdo **persiste entre rebuilds** do container.

> Os **scripts** do RAG (`tools/rag/*.mjs`) fazem parte do **repositório** (versionados).  
> O **estado** do RAG (DB/manifest) fica no **volume do container** (não versionado).

## Comandos (CLI)

Os comandos já estão expostos no `package.json`:

- `npm run rag:health` — sanity check (paths, manifesto, Ollama, LanceDB)
- `npm run rag:index` — indexação incremental do workspace
- `npm run rag:ask -- "sua query"` — busca semântica e construção de contexto (Markdown)
- `npm run rag:reset -- --yes` — apaga **somente** o estado do RAG (DB + index)

Flags úteis:

- `rag:health`: `--json`, `--ollama-base-url`, `--model`
- `rag:index`: `--root`, `--max-file-bytes`, `--json`, `--ollama-base-url`, `--model`
- `rag:ask`: `--topk`, `--ext`, `--path-prefix`, `--tag` (repetível), `--json`, `--ollama-base-url`, `--model`

## Arquitetura (camadas)

### Camada A — Contrato

`tools/rag/lib/contract.mjs`

- Define constantes e helpers determinísticos (`chunk_id`, `file_id`, `sha256`).
- Defaults:
  - modelo embeddings: `qwen3-embedding:4b`
  - baseURL Ollama: `http://host.docker.internal:11434/v1`
  - `SCHEMA_VERSION=1`, `CHUNKER_VERSION="v1"`

### Camada B — Paths, manifesto e lock

- `tools/rag/lib/paths.mjs`
  - Paths canônicos (`rag-db`, `rag-index`, `manifest.v1.json`, `index.lock`)
  - Escrita atômica JSON (`.tmp` + `rename`)
  - Lock via `fs.open(..., 'wx')` e recuperação de lock stale (> 6h)
- `tools/rag/lib/manifest.mjs`
  - Cria/carrega manifesto `manifest.v1.json` e valida `schema_version`

O manifesto guarda:

- versões do schema/chunker
- embedding model + embedding dim (persistida após o primeiro embed)
- map de arquivos indexados: `path → { size, mtime_ms, xxhash64, sha256, indexed_at }`

### Camada C — Embeddings (Ollama)

`tools/rag/lib/embeddings/ollama.mjs`

- Usa a API OpenAI-compatible do Ollama:
  - `GET /v1/models`
  - `POST /v1/embeddings` com `{ model, input }`
- Normaliza vetor para `number[]` e valida `dim` contra o manifesto.

### Camada D — Chunking determinístico

`tools/rag/lib/chunking/*`

Princípios:

- Sem “chunk cego por tamanho” como único critério (tentamos âncoras/estrutura)
- Determinístico: mesma entrada → mesmos ranges
- Sem overlap (evita duplicação)
- Sempre guarda offsets (bytes) e linhas (1-based)

Estratégias:

- Markdown: quebra por headings e preserva cercas ``` quando possível (`chunk_md.mjs`)
- Code: quebra por âncoras heurísticas (export/class/function/etc) (`chunk_code.mjs`)
- Plain/JSON/YAML: quebra por blocos de linhas (`chunk_plain.mjs`)
- `merge_ranges.mjs`: junta chunks muito pequenos com o vizinho quando couber no limite

### Camada E — Storage (LanceDB)

`tools/rag/lib/storage/lancedb.mjs`

- DB: abre via `connect(dbDir)`
- Tabela: `chunks_v1`
- Schema Arrow (colunas relevantes):
  - `chunk_id`, `file_id`, `path`, `ext`, `language`
  - `start_line/end_line`, `start_byte/end_byte`
  - `tags` (list<string>)
  - `text` (chunk bruto)
  - `content_sha256`, `embedding_model`
  - `vector` (FixedSizeList<Float32>, dimensão fixa)
  - `indexed_at` (Int64)

Operações:

- `deleteByPath(path)` antes de reinserir chunks de um arquivo alterado
- `addChunks(rows)` em batches
- `search(vector, filters)` com `pathPrefix/ext` no `where` e `tags` filtrado no cliente
- Ordenação determinística após query (distância, path, start_line, chunk_id)

> Observação: o LanceDB retorna `_distance` (menor = mais próximo). A ordenação final considera isso
> primeiro e aplica tie-breakers estáveis para reprodutibilidade.

### Camada F — Facade (API única)

`tools/rag/lib/facade.mjs`

- `ragHealth()`: valida diretórios, manifesto, Ollama e LanceDB
- `ragIndex()`: scan → fingerprint → chunk → embed → delete+insert → update manifesto
- `ragQuery()`: embed(query) → search → retorno estruturado
- `ragAsk()`: `ragQuery()` + formatação Markdown (`tools/rag/lib/format.mjs`)
- `ragReset(--yes)`: remove somente o conteúdo dentro de `rag-db` e `rag-index`

## Fluxo: indexação incremental (por que é idempotente)

Para cada arquivo elegível:

1) **Fingerprint** do conteúdo (dual):
   - `xxhash64` (rápido) + `sha256` (forte)
2) Se `sha256/xxhash64/size` não mudaram vs manifesto ⇒ **skip**
3) Se mudou:
   - `deleteByPath(path)` (remove chunks antigos daquele arquivo)
   - chunking determinístico
   - embedding de cada chunk (serial, default)
   - insert no LanceDB
   - atualizar manifesto para aquele `path`

Resultado: rodar `rag:index` duas vezes sem mudanças faz **0 embeddings** e **0 reinserções**.

## Segurança (não indexar segredos)

O scan tem denylist explícita:

- `.env` e `.env.*` (mas **permite** `*.env.example`)
- `node_modules/`, `.git/`, `fila/`, `respostas/`, `logs/`, etc.
- lockfiles grandes (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`)

Além disso:

- ignora symlinks
- ignora binários (detecção por NUL/alta taxa de bytes não-texto)
- limita tamanho por arquivo (default `2_000_000` bytes; configurável no `rag:index`)

## Troubleshooting rápido

- `rag:health` falha em `ollama_ok=false`:
  - Verifique se o Ollama está acessível do DevContainer:
    - `curl http://host.docker.internal:11434/api/version`
    - `curl http://host.docker.internal:11434/v1/models`
- `has_model=false`:
  - Baixe o modelo no host: `ollama pull qwen3-embedding:4b`
- `EMBEDDING_DIM_MISMATCH`:
  - Mudou o modelo/dimensão. Faça reset explícito:
    - `npm run rag:reset -- --yes`
    - `npm run rag:index`

## Melhorias Recentes (v1.1)

### Robustez
- ✅ **Retry Logic**: Embeddings agora retentam 3x com backoff exponencial (1s, 2s, 4s)
- ✅ **Validação Early**: Dimensão do embedding validada antes da indexação (fail-fast)
- ✅ **Error Messages**: Mensagens detalhadas com instruções de recovery

### Performance
- ✅ **Query Caching**: Cache LRU de 100 queries reduz latência em ~100-300ms por hit
- ✅ **Progress Reporting**: Feedback a cada 25 arquivos durante indexação

### UX
- ✅ **Health Check Visual**: Output com checkmarks ✅/❌ e troubleshooting automático
- ✅ **Indexing Summary**: Estatísticas visuais ao final (arquivos, chunks, taxa de skip)
- ✅ **Script Rebuild**: `npm run rag:full-rebuild` para reset + index em um comando

## Extensibilidade

O sistema RAG foi projetado para ser extensível. Aqui estão os principais pontos de extensão:

### Adicionar Suporte para Novo Tipo de Arquivo

Para adicionar chunking customizado para um novo tipo de arquivo (ex: Python, SQL, etc.):

1. **Criar novo chunker** em `tools/rag/lib/chunking/chunk_<tipo>.mjs`:

```javascript
/**
 * Chunker customizado para arquivos <tipo>
 * @param {string[]} lines - Linhas do arquivo
 * @param {Object} options - Opções de chunking
 * @returns {Array<{start_line, end_line, start_byte, end_byte, text}>}
 */
export function chunk<Tipo>(lines, options = {}) {
  const { maxChunkChars = 4000 } = options;
  const ranges = [];

  // Implementar lógica de chunking baseada em estrutura do arquivo
  // Exemplo: detectar âncoras específicas da linguagem

  return ranges;
}
```

2. **Registrar no dispatcher** em `tools/rag/lib/chunking/chunk_dispatcher.mjs`:

```javascript
const CHUNKERS_BY_LANG = {
  javascript: chunkCode,
  python: chunkPython,  // Adicionar aqui
  // ...
};
```

### Trocar o Backend de Embeddings

Para usar outro provedor de embeddings além do Ollama:

1. **Criar novo provider** em `tools/rag/lib/embeddings/<nome>.mjs`:

```javascript
export class CustomEmbeddingsProvider {
  constructor(options = {}) {
    this.model = options.model || 'default-model';
    // Configuração específica
  }

  async health() {
    // Verificar disponibilidade do serviço
    return { ok: true, hasModel: true, models: [this.model] };
  }

  async embed(text) {
    // Gerar embedding do texto
    // Deve retornar number[] (vetor de floats)
    return vectorArray;
  }
}
```

2. **Usar no facade** passando `embeddingsProvider`:

```javascript
import { CustomEmbeddingsProvider } from './embeddings/custom.mjs';

await ragIndex({
  root: '/path/to/workspace',
  embeddingsProvider: new CustomEmbeddingsProvider({ model: 'my-model' })
});
```

### Trocar o Backend de Vector Database

Para usar outro vector DB além do LanceDB:

1. **Implementar interface** em `tools/rag/lib/storage/<nome>.mjs`:

```javascript
// Funções obrigatórias:
export async function openDb(dbDir) { /* ... */ }
export async function ensureTable(db, dim) { /* ... */ }
export async function deleteByPath(table, path) { /* ... */ }
export async function addChunks(table, rows) { /* ... */ }
export async function search(table, vector, options) { /* ... */ }
```

2. **Atualizar imports** em `tools/rag/lib/facade.mjs`:

```javascript
import * as storage from './storage/milvus.mjs';  // Novo backend
```

### Migrar Schema Entre Versões

Quando o schema do manifesto precisa evoluir (v1 → v2 → v3...):

1. **Definir migração** em `tools/rag/lib/migrations/schema_v2.mjs`:

```javascript
export const MIGRATIONS = {
  '1->2': async (manifest, paths, db) => {
    // Adicionar novos campos
    manifest.new_field = 'default_value';

    // Modificar estrutura existente
    if (manifest.old_field) {
      manifest.renamed_field = manifest.old_field;
      delete manifest.old_field;
    }

    // Atualizar versão
    manifest.schema_version = 2;

    return manifest;
  }
};
```

2. **Atualizar SCHEMA_VERSION** em `tools/rag/lib/contract.mjs`:

```javascript
export const SCHEMA_VERSION = 2;  // Era 1
```

3. A migração será **aplicada automaticamente** no próximo `rag:index`.

### Customizar Scan e Filtering

Para alterar quais arquivos são indexados:

- **Denylist**: Editar `DENY_PATTERNS` em `tools/rag/lib/scan.mjs`
- **Extensões permitidas**: Modificar `ALLOWED_EXTS`
- **Detecção de binários**: Ajustar `isBinaryBuffer()` se necessário

### Adicionar Novos CLI Commands

Para criar um novo comando RAG (ex: `rag:stats`):

1. **Criar script** em `tools/rag/stats.mjs`:

```javascript
import { ragStats } from './lib/facade.mjs';

const stats = await ragStats();
console.log(JSON.stringify(stats, null, 2));
```

2. **Adicionar ao package.json**:

```json
{
  "scripts": {
    "rag:stats": "node tools/rag/stats.mjs"
  }
}
```

## Referência de arquivos

- CLI: `tools/rag/health.mjs`, `tools/rag/index.mjs`, `tools/rag/ask.mjs`, `tools/rag/reset.mjs`
- Facade: `tools/rag/lib/facade.mjs`
- Storage: `tools/rag/lib/storage/lancedb.mjs`
- Scan: `tools/rag/lib/scan.mjs`
- Chunking: `tools/rag/lib/chunking/*`
- Embeddings: `tools/rag/lib/embeddings/ollama.mjs`, `tools/rag/lib/embeddings/embed_cache.mjs`
- Migrations: `tools/rag/lib/migrations/schema_v2.mjs`
