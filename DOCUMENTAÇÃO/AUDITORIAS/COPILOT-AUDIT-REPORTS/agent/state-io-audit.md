# Auditoria Individual — `agent/state-io.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit (F05-17).

---

## 1. Identificação

| Campo       | Valor                           |
| ----------- | ------------------------------- |
| **Arquivo** | `src/copilot/agent/state-io.js` |
| **Módulo**  | `agent/`                        |
| **LOC**     | 204                             |
| **Fase**    | F05-17                          |

---

## 2. Propósito e Responsabilidade

I/O de estado persistido (`sdk-always-alive.json`). Centraliza leitura (sync + cache), escrita (sync
e async com mutex serial), e remoção do snapshot de estado. Separado do session-initializer para
isolar responsabilidade de I/O.

---

## 3. API Pública (Exports)

| Export            | Tipo     | Descrição curta                            |
| ----------------- | -------- | ------------------------------------------ |
| `readState`       | function | Lê estado + cache in-process               |
| `writeState`      | function | Escrita síncrona (merge com estado atual)  |
| `writeStateAsync` | function | Escrita async com mutex serial (G1-BUG-05) |
| `clearState`      | function | Remove arquivo e invalida cache            |
| `AliveAgentState` | @typedef | Shape do JSON persistido                   |

---

## 4. Dependências (Imports)

| Import                          | Via barrel? |
| ------------------------------- | ----------- |
| `#copilot/observability/logger` | ❌ bypass   |
| `node:fs`                       | — stdlib    |
| `node:fs/promises`              | — stdlib    |
| `node:path`                     | — stdlib    |

- **Barrel bypasses**: 1 (logger)
- **SDK direto**: Não

---

## 5. Estado Interno

| Variável         | Tipo                     | Mutable? | TTL/Cleanup?             |
| ---------------- | ------------------------ | -------- | ------------------------ |
| `_stateCache`    | AliveAgentState \| null  | Sim      | ✅ clearState() invalida |
| `_stateDirReady` | boolean                  | Sim      | ✅ clearState() reseta   |
| `_writeQueue`    | Promise<AliveAgentState> | Sim      | ✅ clearState() reseta   |

---

## 6. Achados (Questões Formais)

### BUG-AGENT-008 — `readState` com sync I/O no hot path

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/state-io.js`#L88-L101
- **Descrição**: `readState()` usa `readFileSync` + `existsSync` quando o cache está vazio. Chamado
  por `writeStateAsync` dentro do mutex, o que serializa acessos, mas a leitura síncrona pode
  bloquear o event loop em filesystems lentos (Docker volumes NFS). O cache mitiga chamadas
  repetidas, mas a primeira chamada (cold path) e chamadas após `clearState()` são síncronas.
- **Proposta**: Criar `readStateAsync()` para uso dentro de `_doWriteState`, mantendo `readState`
  sync para callers que precisam de retorno imediato.
- **Impacto se não corrigido**: Latência em cold paths com filesystems lentos.

### RACE-AGENT-003 — `writeState` sync não participa do mutex de `writeStateAsync`

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/state-io.js`#L112-L121
- **Descrição**: `writeState()` (sync) e `writeStateAsync()` podem ser chamados concorrentemente. Se
  um caller usa `writeState()` enquanto `_writeQueue` tem escritas pendentes, o estado pode ser
  sobrescrito antes que a escrita async anterior complete, perdendo as atualizações async. O
  `_stateCache` é atualizado por ambos, mas o arquivo em disco pode divergir.
- **Cenário de manifestação**: Se `writeState({a: 1})` é chamado enquanto `writeStateAsync({b: 2})`
  está pendente, o resultado final pode não conter `b`.
- **Proposta**: Deprecar `writeState()` e forçar `writeStateAsync()` para todos os callers, ou fazer
  `writeState()` participar do mutex flushing a queue primeiro.
- **Impacto se não corrigido**: Perda de dados em cenários de race (state-io → session state, PR
  billing info).

### GAP-AGENT-011 — `writeStateAsync` `.catch(() => _doWriteState(updates))` retry infinito potencial

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/state-io.js`#L146
- **Descrição**: Se `_doWriteState` falha (ex.: disco cheio), o `.catch` tenta novamente uma vez. Se
  falhar de novo, a Promise rejeita e `_writeQueue` fica em estado rejeitado. O próximo
  `writeStateAsync` vai encadear no `.then()` da Promise rejeitada, o que efetivamente funciona (a
  chain continua), mas o erro anterior é silenciado. Não é retry infinito — é retry 1x com
  silenciamento de erro.
- **Proposta**: Logging explícito no `.catch` para registrar a falha no segundo try.

---

## 7. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                               |
| ------------------- | ------------ | ------------------------------------------- |
| Contratos (tipos)   | 9            | JSDoc completo, AliveAgentState typedef     |
| Error handling      | 6            | Race write/writeAsync; retry silencia error |
| Segurança           | 8            | Path via env var; JSON.parse try/caught     |
| Performance         | 7            | Sync I/O no cold path; cache ✅             |
| Testabilidade       | 7            | Module-level state; needs reset helpers     |
| Manutenibilidade    | 8            | 204 LOC, single-purpose, bem documentado    |
| **Média ponderada** | **7.5**      | **(9×2 + 8×2 + 6+7+7+8) / 8 ≈ 7.5**         |

---

## 8. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (state persistence)
- **Padrão**: State Manager com cache + mutex serial
- **Conformidade AS-IS→TO-BE**:
  - ✅ Mutex serial para async writes (G1-BUG-05)
  - ✅ Cache in-process para hot path
  - ❌ Sync/async race (RACE-AGENT-003)
  - ❌ 1 barrel bypass (logger)

---

## 9. Status de Correção (2026-04-03)

### [FIXED] RACE-AGENT-003 (P3) — writeState() agora redefine \_writeQueue

writeState() síncrono agora reseta \_writeQueue = Promise.resolve(next) após escrever em disco.
Escritas async subsequentes partem do estado mais recente já commitado, eliminando a divergência.

### [FIXED] GAP-AGENT-011 (P4) — catch do retry agora loga o erro

.catch((err) => { log('WARN', ...); return \_doWriteState(updates); }) — erro silenciado agora fica
registrado no logger com contexto.

**Pontuação atualizada: 8.5/10**

---

## Status de Correção adicional (2026-04-03)

### [IMPROVED] — drainStateWrites() adicionada ao public API

Exportada drainStateWrites(timeoutMs?) que aguarda \_writeQueue com Promise.race + timeout. Suporte
estrutural para BUG-AGENT-006 em entry.js.
