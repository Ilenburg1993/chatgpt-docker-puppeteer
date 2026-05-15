# Análise Profunda da Situação Atual — 2026-05-15

**Status**: Checkpoint de análise pré-transformações amplas.
**Commit de referência**: `53936143` (refactor: complete facade consolidation).
**Executado**: 2026-05-15 às 12:45 UTC.

---

## 1. Situação Estrutural — IO Modularization

### 1.1 Consolidação de Boundaries (Barrel-First Pattern)

✅ **CONCLUÍDO**:
- `#copilot/infra/public/io` — 19 exports (18 operações + `readIoRuntimeHealthSnapshot`)
- `#copilot/infra/public/session` — 8 exports (escopo de sessão + índice simbólico)
- Todas as importações diretas de consumidores externos → consolidadas em façades

✅ **GATES VALIDADOS**:
- `typecheck:strict:src.copilot` — 0 errors
- `lint:src -- src/copilot` — 0 errors
- `test:copilot:unit` — 2737/2737 passing | 933 suites | 62.6s

### 1.2 Módulos de Infra — Ainda Sem Fachada Pública

**20 módulos internos** ainda importáveis diretamente (não consolidados em façade):

```
• di-tokens.js — DI (dependency injection) tokens
• io-cache.js — L1 cache em-memória
• io-cache-l2-registry.js — L2 registry SQLite
• io-cache-l2-sqlite.js — Implementação L2 SQLite
• io-cache-tiering.js — Política multi-tier
• io-locks.js — Gerenciador de locks de path/resource
• io-observability.js — Observabilidade/latência
• io-parser.js — Parser JS/TS com @babel
• io-prefetch.js — Pré-aquecimento de cache
• io-index-registry.js — Índice FTS
• io-index-sqlite.js — SQLite FTS
• lockfile.js — Semantica de lockfile
• module-map.js — Mapeamento de módulos
• queue.js — Fila de operações
• storage.js — Persistência genérica
• webhooks.js — Webhooks/notificações
```

**Risco observado**: Estes módulos ainda podem ser importados diretamente por consumidores internos, quebrando o padrão barrel-first. Candidates para consolidação futura.

### 1.3 Padrão de Consumo Atual

**Consumidores de `#copilot/infra/*`**:

| Camada                     | Contagem   | Exemplos                                                |
| -------------------------- | ---------- | ------------------------------------------------------- |
| **tools**                  | 15 módulos | file-tools, git-tools, shell-tools, session-tools, etc. |
| **terminal**               | 3 módulos  | commands/scope, frontend/projections, handlers          |
| **server**                 | 3 módulos  | routes/sdk/observability, middleware                    |
| **sdk**                    | 2 módulos  | session, tools                                          |
| **audit**                  | 2 módulos  | internos                                                |
| **presentation**           | 1          | files/context                                           |
| **config, channel, agent** | 1 cada     | —                                                       |

**Observação**: Tools é o maior consumidor (15 módulos). Merece análise especial para consolidação.

---

## 2. Estado de Testes — Unit vs Integration vs Full

### 2.1 Cobertura Atual

| Tipo            | Arquivos | Script                      | Escopo                                   |
| --------------- | -------- | --------------------------- | ---------------------------------------- |
| **Unit**        | 418      | `npm run test:copilot:unit` | `tests/unit/copilot/**/*.spec.js`        |
| **Integration** | 3        | (não isolado)               | `tests/integration/copilot/**/*.spec.js` |
| **Regression**  | 1        | (não isolado)               | `tests/regression/copilot/**/*.spec.js`  |
| **Full (ALL)**  | 422      | `npm run test:copilot`      | unit + integration + regression          |

### 2.2 Script Atual — `npm run test:copilot:unit`

```json
"test:copilot:unit": "node scripts/ci/run-vitest-copilot.mjs tests/unit/copilot/**/*.spec.js"
```

**Características**:
- Roda APENAS tests/unit (418 arquivos)
- Usa log profile **compacto** (WARN/ERROR/FAIL apenas)
- Duração: ~62s
- Output: Resumido com summary.md

### 2.3 Script Atual — `npm run test:copilot`

```json
"test:copilot": "node scripts/ci/run-vitest-copilot.mjs"
```

**Características**:
- Roda TODOS os testes (unit + integration + regression = 422 arquivos)
- Usa log profile **compacto** (WARN/ERROR/FAIL apenas)
- Duração: ~120s+ (some integration/regression suites podem ser lentas)
- Output: Resumido com summary.md

### 2.4 Consolidação Recomendada

**PROPOSIÇÃO**:
```
MANTER: npm run test:copilot:unit (para fast-path desenvolvimento)
PADRONIZAR: npm run test:copilot (para CI/validation — mas com logging consistente)
REMOVER: "test:copilot:raw" ou renomear para "test:copilot:verbose"
```

**Justificativa**:
1. `test:copilot` já roda com o mesmo log profile compacto que `test:copilot:unit`
2. A integração e regressão são poucas (4 arquivos), impacto mínimo na duração
3. CI deve rodar TODOS os testes, não só unit
4. O método `run-vitest-copilot.mjs` já suporta múltiplos padrões de arquivo

---

## 3. Oportunidades de Transformação Profunda

### 3.1 **TRANSFORMAÇÃO 1**: Consolidar Pattern Match Gerador de Script

**Escopo**: `scripts/ci/run-vitest-copilot.mjs`

**Achado**:
- O script já suporta múltiplos padrões de arquivo via passthrough args
- `test:copilot` sem args roda tudo
- `test:copilot:unit` com `tests/unit/copilot/**/*.spec.js` filtra

**Oportunidade**: Extrair configuração em arquivo `vitest-test-profiles.json`:
```json
{
  "profiles": {
    "unit": { "pattern": "tests/unit/copilot/**/*.spec.js", "timeout": 120000 },
    "integration": { "pattern": "tests/integration/copilot/**/*.spec.js", "timeout": 60000 },
    "regression": { "pattern": "tests/regression/copilot/**/*.spec.js", "timeout": 30000 },
    "all": { "pattern": null, "timeout": 180000 }
  }
}
```

**Benefício**: Facilita adição de novos perfis sem mudar package.json.

### 3.2 **TRANSFORMAÇÃO 2**: Expandir Fachadas Públicas de Infra

**Escopo**: `src/copilot/infra/public/*`

**Módulos candidatos para nova fachada `#copilot/infra/public/cache`**:
```javascript
export { getIoCacheStats } from '../io-cache.js';
export { aggregateIoCacheTierStats, buildIoCacheTierPlan } from '../io-cache-tiering.js';
export { getIoL2CacheStats } from '../io-cache-l2-registry.js';
export { invalidateIoCachePath, registerInvalidationHook } from '../io-cache.js';
```

**Módulos candidatos para nova fachada `#copilot/infra/public/locks`**:
```javascript
export { withIoResourceLock } from '../io-locks.js';
export { readLockfileSync, writeLockfileSync } from '../lockfile.js';
```

**Benefício**:
- Reduce direct imports de módulos internos
- Explícita a API de cache (importante para tools de file manipulation)
- Facilita future refactoring de cache internamente

### 3.3 **TRANSFORMAÇÃO 3**: Auditoria de Tools — Consolidar DI Pattern

**Escopo**: `src/copilot/tools/**/*.js` (15 módulos)

**Achado**: Todos os tools importam de `src/copilot/tools/infra/di-tokens.js` + `tool-factory.js`

**Oportunidade**: Criar fachada `#copilot/tools/public/index.js`:
```javascript
export { createFileTools, createGitTools, createSessionTools, ... } from '../infra/tool-factory.js';
export * from '../../sdk/tools/index.js';
```

**Benefício**:
- Tools torna-se "plug-and-play" via single import
- Reduz boilerplate de 15 módulos
- Facilita feature-flagging de tools

### 3.4 **TRANSFORMAÇÃO 4**: Reorganizar Observabilidade em Camada Pública

**Escopo**: `src/copilot/infra/public/observability.js` (NOVA)

**Exportaria**:
```javascript
export { readIoRuntimeHealthSnapshot } from '../io-health.js';
export { getIoLatencyStats } from '../io-observability.js';
export { buildIoMeta } from '../io-contracts.js'; // se houver
```

**Benefício**:
- Centraliza todas as APIs de observabilidade em um lugar
- Terminal/server não precisa importar de múltiplos lugares
- Facilita monitoração do runtime

---

## 4. Análise de Risco — Teste:copilot Full

### 4.1 **Status Atual**

`npm run test:copilot` foi executado com timeout 120s. Output mostra:
- Última linha visível: "Did you forget to return it from `vi.mock`?"
- Erro em mock de `#copilot/core` → `registerShutdownHandler` ausente

### 4.2 **Raiz Provável**

Teste de integration ou regression está mockando `#copilot/core` mas não exportando `registerShutdownHandler`. Cenários:
- O test foi criado antes da função ser adicionada
- O mock está desatualizado em relação ao atual
- A função é nova e o mock não foi atualizado

### 4.3 **Ação Recomendada**

Antes de consolidar `test:copilot` como padrão:
1. Rodar com `--full-output` para ver stack completo
2. Localizar o teste que está falhando
3. Atualizar o mock ou a função conforme necessário
4. Re-validar gate

---

## 5. Resumo Executivo — Checklist de Transformações Profundas

### Recomendadas (ALTO IMPACTO):

- [ ] **T1**: Corrigir mock de `#copilot/core` em testes de integration/regression
- [ ] **T2**: Consolidar `npm run test:copilot` como padrão de validação
- [ ] **T3**: Criar `#copilot/infra/public/cache` façade
- [ ] **T4**: Criar `#copilot/infra/public/locks` façade
- [ ] **T5**: Reorganizar `#copilot/tools` com padrão DI público
- [ ] **T6**: Criar `#copilot/infra/public/observability` façade consolidada

### Opcionais (REFACTORING FUTURO):

- [ ] Extrair test profiles em JSON configurável
- [ ] Adicionar feature flags para tools
- [ ] Consolidar di-tokens em camada pública

---

## 6. Próximos Passos

### Immediato (Próximo Turno):

1. **Validar `test:copilot` completo**
   ```bash
   npm run test:copilot:raw  # com --full-output para ver erro
   ```

2. **Identificar e corrigir mock quebrado**

3. **Implementar transformações T1-T4**

4. **Re-validar todos os 3 gates**

5. **Commit consolidado com documetnação**

### Médio Prazo (Sprint Atual):

- Implementar T5 (tools DI)
- Implementar T6 (observability façade)
- Rodar suite completa de testes de novo

---

**Relatório finalizado em**: 2026-05-15 12:50 UTC
**Autor**: Análise automatizada pré-transformação
**Status**: Pronto para execução
