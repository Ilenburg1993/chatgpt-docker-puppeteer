# Plano Fase AE — Refatoração Arquitetural + Infraestrutura

**Data de criação**: 2026-03-25
**Status**: 🟡 PLANEJADA — pronto para execução
**Origem**: itens adiados da Fase AD (seção 3 de `PLANO_FASE_AD_AUDITORIA.md`)
**Auditoria base**: `DOCUMENTAÇÃO/AUDITORIAS/AUDITORIA_INDEPENDENTE_SRC_COPILOT.md`

---

## 1. Contexto

Durante a Fase AD (commits `27140f20` e subsequente), os 7 itens abaixo foram adiados por requererem
análise de impacto maior ou dependências de infraestrutura não disponíveis no ciclo AD.

Todos os Sprints AD-1/2/3/4 foram concluídos com sucesso (26 itens, `0 typecheck errors`, `1466 testes`).
Esta fase retoma os pendentes com planejamento detalhado.

---

## 2. Itens da Fase AE

### Sprint AE-1 — Melhorias isoladas (baixo risco)

#### ARCH-04 — Hub health no endpoint `/health`

**Descrição**: O endpoint `GET /health` em `bridge-control.js` não verifica conectividade do
`ConversationHub` (store SQLite). Um hub offline não é detectado.

**Arquivo afetado**: `src/copilot/api/bridge-control.js`

**Implementação**:
1. Importar `ConversationHub` ou seu store (via `getHubStore?.()` no agent ou singleton exportado).
2. No handler `/health`, executar `store.db.prepare('SELECT 1').get()` dentro de try/catch.
3. Adicionar campo `hubStore: { ok: boolean, error?: string }` na resposta JSON.

**Risco**: Baixo — campo adicional, não quebra clientes existentes.

---

#### PERF-03 — FTS5 tokenizer porter + unicode61

**Descrição**: A tabela FTS5 `conversation_fts` em `store.js` usa tokenizer padrão (`unicode61`),
sem porter stemmer. Buscas em inglês/português não encontram variantes morfológicas
(ex.: "running" não encontra "runs").

**Arquivo afetado**: `src/copilot/conversation-hub/store.js`

**Implementação**:
```sql
-- ANTES
CREATE VIRTUAL TABLE conversation_fts USING fts5(content, tokenize='unicode61')

-- DEPOIS
CREATE VIRTUAL TABLE conversation_fts USING fts5(
  content,
  tokenize='porter unicode61 remove_diacritics 1'
)
```

**Notas**:
- `porter` é built-in do SQLite FTS5 (>= 3.7.4 — disponível em todas as versões do Node.js 20+).
- A migração precisa `DROP TABLE IF EXISTS conversation_fts` + `CREATE` na inicialização se a tabela
  já existir com tokenizer diferente. Usar verificação via `PRAGMA table_info`.
- Ou: criar nova tabela `conversation_fts_v2` e atualizar todas as queries que referenciam a antiga.

**Risco**: Médio (requer migração do schema SQLite). Recomendado: criar `conversation_fts_v2`,
migrar queries, descartar `v1` em passo posterior.

---

### Sprint AE-2 — Refatoração arquitetural (médio risco)

#### ARCH-01 — Remover 13 re-exports de compatibilidade

**Descrição**: Existem 13 "shims" de compatibilidade na raiz de `src/copilot/` que re-exportam
módulos que foram movidos para sub-diretórios. Ex.:
- `src/copilot/always-alive.js` → re-exporta `./agent/always-alive.js`
- `src/copilot/agent.js` → re-exporta `./agent/entry.js`
- `src/copilot/llm-bridge-client.js` → re-exporta `./channel/client.js`

Esses shims geram confusão e podem mascarar imports incorretos.

**Etapas necessárias**:
1. Listar todos os 13 shims com `find src/copilot -maxdepth 1 -name "*.js" -not -name "index.js"`.
2. Para cada shim, `grep -r "from '.*copilot/<nome>'" src/ tests/` para encontrar todos os importers.
3. Atualizar cada importer para usar o caminho canônico.
4. Deletar o shim.
5. Rodar `typecheck:node` + `test:unit` após cada batch.

**Ordem sugerida** (do menos para o mais usado):
- `src/copilot/agent.js` (provavelmente só ecosystem.config.cjs)
- `src/copilot/nerv-bridge.js`, `src/copilot/mcp-tool-bridge.js`
- `src/copilot/llm-bridge-client.js` (mais usado — cuidado especial)
- `src/copilot/always-alive.js`

**Risco**: Médio — requer pesquisa exaustiva de importers. Deve ser feito em batches com testes após cada um.

---

#### ARCH-03 — LlmBridgeClient: convergência do histórico entre instâncias

**Descrição**: `channel/client.js` mantém histórico de conversa em memória (`#history`). Se múltiplas
instâncias de `LlmBridgeClient` forem criadas (ex.: `getOrCreate()` usado em dois contextos), cada
uma tem histórico separado e as mensagens não são compartilhadas.

**Análise necessária** (pré-implementação):
1. Verificar quantas instâncias existem em runtime: `getOrCreate()` usa Map por sessionId?
2. Verificar se `ConversationStore` (SQLite) já persiste turnos — se sim, inicializar `#history`
   a partir do store na criação de instância nova.
3. Avaliar se `#history` deve ser apenas um cache do store (write-through) ou autoridade primária.

**Implementação sugerida**:
- Ao criar nova instância com `sessionId` existente, carregar últimos N turnos do `ConversationStore`.
- Em `sendMessage()`, além de armazenar no store (já feito), manter `#history` sincronizado.

**Risco**: Médio-Alto — toca no core do protocolo de sessão. Requer testes de integração.

---

#### GAP-02 — MCP schema: suporte a enum e aninhamento

**Descrição**: O conversor de schema em `mcp-tool-bridge.js` não suporta:
- `type: 'string', enum: ['a', 'b']` → não gera `zod.enum(['a', 'b'])`
- Objetos aninhados com `properties` → não gera `z.object({...})` recursivo

**Arquivo afetado**: `src/copilot/bridges/mcp-tool-bridge.js`

**Implementação**:
```javascript
// Em convertMcpParamToZod(param), adicionar antes do switch:
if (param.enum && Array.isArray(param.enum)) {
    return z.enum(param.enum);
}

// No case 'object':
if (param.type === 'object' && param.properties) {
    const shape = Object.fromEntries(
        Object.entries(param.properties).map(([k, v]) => [k, convertMcpParamToZod(v)])
    );
    return param.required?.includes(key) ? z.object(shape) : z.object(shape).optional();
}
```

**Risco**: Baixo-Médio. Afeta apenas MCP tools com schemas complexos. Não regride comportamento
existente (schemas simples continuam funcionando igual).

---

### Sprint AE-3 — Infraestrutura (alto risco/esforço)

> ⚠️ Estes itens requerem análise mais aprofundada e podem ser promovidos para fase própria (AF).

#### MELHORIA-05 — SDK session history por hub_session

**Descrição**: Atualmente o SDK Copilot mantém histórico apenas em memória (`#history`). Ao reiniciar
o processo, o contexto se perde. A proposta é persistir turnos por `hub_session_id` no SQLite
(`ConversationStore`) e restaurar na criação de nova sessão SDK.

**Dependências**:
- `ConversationStore` já tem tabela `conversations` com `session_id` — base disponível.
- Necessário: query `getRecentTurns(sessionId, limit)` e integração no start() do `AlwaysAliveAgent`.

**Complexidade**: Migração de schema + integração com SDK conversation thread — risco de regressão.

**Pré-requisito**: ARCH-03 precisa estar concluída antes (ou ser parte da mesma implementação).

---

#### MELHORIA-02 — OpenTelemetry no AlwaysAliveAgent

**Descrição**: Adicionar traces/métricas ao `AlwaysAliveAgent` usando `@opentelemetry/api`.

**Dependências de pacotes**:
```bash
npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
```

**Pontos de instrumentação**:
- `#processQueue()` → span `agent.process_turn`
- `sendMessage()` → span `agent.send_message` com atributos `model`, `sessionId`, `queueSize`
- `/health` e `/status` → métricas de gauge

**Risco**: Alto — requer mudança de infraestrutura. Recomendado fase própria (AF).
**Alternativa de baixo risco**: Expor apenas métricas via `prom-client` no endpoint `/metrics`
(sem OTel completo) como etapa intermediária.

---

## 3. Ordem de Execução Recomendada

```
AE-1: ARCH-04 (30 min) → PERF-03 (1h) → commit
AE-2: GAP-02 (1h) → ARCH-01 batch-1 (2h) → typecheck → commit
      ARCH-01 batch-2 (1h) → ARCH-03 análise + implementação (3h) → typecheck → testes integração → commit
AE-3: MELHORIA-05 (análise 2h + implementação 3h) → commit
      MELHORIA-02 (fase separada AF se escopo crescer)
```

**Critério de saída por Sprint**:
- `npm run typecheck:node` → 0 errors
- `npm run lint` → 0 warnings
- `npm run test:unit` → ≥ 1466 passing, 0 failing
- Para AE-2/3: `npm run test:integration` também

---

## 4. Riscos e Mitigações

| Risco                                               | Item        | Mitigação                                                         |
| --------------------------------------------------- | ----------- | ----------------------------------------------------------------- |
| Shim removido mas importer existente não encontrado | ARCH-01     | `grep -r` exaustivo antes de deletar; CI detecta import quebrado  |
| Migração FTS5 apaga dados                           | PERF-03     | Criar nova tabela `_v2`; manter `_v1` como fallback por N versões |
| Histórico incoerente após ARCH-03                   | ARCH-03     | Feature flag `HISTORY_PERSISTENCE=true` desligada por padrão      |
| OTel aumenta latência                               | MELHORIA-02 | Sampler probabilístico (1%); async-safe spans                     |

---

## 5. Itens Fora do Escopo AE

Os seguintes itens são arquiteturalmente ortogonais e pertencem a fases posteriores:

- **Fase AA**: Context Window Intelligence (planejada)
- **Fase AB**: `conversation-hub` hardening (planejada)
- **Fase AC**: `terminal-server.js` split (planejada)
