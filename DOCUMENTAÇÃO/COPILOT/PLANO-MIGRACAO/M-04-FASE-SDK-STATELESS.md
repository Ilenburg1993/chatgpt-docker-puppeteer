# M-04 — Fase 3: SDK Stateless

**Data**: 2026-03-21
**Versão**: 1.1
**Pré-requisito**: M-02 (Cleanup) concluído; M-03 (Agent Refactor) K1 concluído
**Estimativa**: ~14h
**Risco**: Moderado-Alto (toca no wrapper do copilot-sdk)
**Consolida**: Faixa L3 + Faixa J1

## 0. Status auditado — 2026-04-15

Esta fase segue **pendente estruturalmente**.

Confirmado na auditoria:

- `sdk/session/client.js` ainda mantém `_client` e `_sessions` internamente;
- `sdk/config.js` ainda existe (embora já marcado como deprecated);
- `sdk/agent/agents.js` ainda existe;
- `conversation-hub/session-registry.js` ainda não existe.

Pré-requisitos já cumpridos por trabalho anterior / M-02:

- `types/contracts/` já absorveu os contratos antes em `sdk/agent/`;
- `config/session-config.js` já parou de importar `approveAll` direto do SDK e usa `#copilot/sdk`.

---

## 1. Contexto e Motivação

O módulo `sdk/` (41 arquivos, 8.096L) deveria ser uma **camada fina e stateless** sobre
`@github/copilot-sdk`. Na prática, ele:

1. Mantém estado mutável: `session/client.js` guarda um registry de sessões + `_client` singleton
2. Contém `sdk/config.js` que duplica `config/session-config.js` (SessionConfigBuilder)
3. Abriga `sdk/agent/` com contratos que pertencem a `types/`
4. Tem import paths inconsistentes com o modelo de camadas

### Princípio-alvo

> **L1 SDK é stateless**: apenas converte chamadas internas em chamadas ao `@github/copilot-sdk`.
> O registry de sessões vive em L4 (Orchestration). Config vive em L2.

### Métricas antes → depois

| Métrica                   | Antes                              | Depois                  |
| ------------------------- | ---------------------------------- | ----------------------- |
| sdk/ linhas               | 8.096                              | ~7.200                  |
| sdk/ arquivos             | 41                                 | 36                      |
| Estado mutável em sdk/    | 3 (client, sessions, config-cache) | 0                       |
| Consumer de sdk/config.js | ~5                                 | 0 (deprecated/removido) |

### Problemas resolvidos

- **D3 (Duplicação)**: `sdk/config.js` × `config/session-config.js` → **ELIMINADO**
- **D4 (Delegação)**: `sdk/session/lifecycle → agent/session/initializer` chain simplificado
- **P4 (🟠, parcial)**: Overlay de tipagem — JSDoc de sdk/types.js alinhado

---

## 2. Inventário de Arquivos Afetados

### Grupo A: Extrair session registry de `sdk/session/client.js` (C5)

| Arquivo                     | Linhas | Ação                                             |
| --------------------------- | ------ | ------------------------------------------------ |
| `sdk/session/client.js`     | 386    | REFATORAR: remover `_sessions` Map               |
| `conversation-hub/store.js` | 563    | ATUALIZAR: receber ownership do session registry |
| `sdk/session/lifecycle.js`  | 335    | ATUALIZAR: parar de acessar registry interno     |

**Conceito**: Hoje `client.js` mantém `_sessions = new Map()` com sessões ativas.
Essa responsabilidade passa para `conversation-hub/` (L4) ou um novo
`sdk/session/session-registry.js` em L4.

### Grupo B: Eliminar `sdk/config.js` (1 arquivo, -150L)

| Arquivo         | Linhas | Ação                               |
| --------------- | ------ | ---------------------------------- |
| `sdk/config.js` | 150    | DELETAR (após M-02 P09 deprecated) |

**Consumers a migrar** (usar `SessionConfigBuilder` de `#copilot/config`):

```bash
grep -rn "from.*sdk/config\|from.*#copilot/sdk.*config\|buildSessionConfig" src/ --include="*.js"
```

### Grupo C: Mover `sdk/agent/agents.js` → `config/custom-agents.js` (C6)

| Origem                | Destino                   | Linhas | Ação                                                   |
| --------------------- | ------------------------- | ------ | ------------------------------------------------------ |
| `sdk/agent/agents.js` | `config/custom-agents.js` | 268    | MOVER (se `config/custom-agents.js` já existe → MERGE) |

**Nota**: `config/custom-agents.js` (326L) já existe. O conteúdo de `sdk/agent/agents.js` (268L)
pode ser duplicado ou complementar. Avaliar e consolidar.

### Grupo D: Alinhar import map de `sdk/` (J1)

| Arquivo        | Ação                                                |
| -------------- | --------------------------------------------------- |
| `sdk/index.js` | ATUALIZAR: remover re-exports de config.js e agent/ |
| `package.json` | ATUALIZAR: verificar `#copilot/sdk` import map      |

---

## 3. Passos de Execução

### P01 — Mapear estado mutável em `sdk/session/client.js` (1h)

**O que fazer**: Ler `client.js` (386L) e identificar:
1. Onde `_sessions` é definido e populado
2. Quem acessa `_sessions` (getSession, listSessions, etc.)
3. Onde `_client` singleton é criado e mantido

```bash
grep -n "_sessions\|_client\|getSession\|listSessions" src/copilot/sdk/session/client.js
grep -rn "getSession\|listSessions\|getClient" src/copilot/ --include="*.js" | grep -v "node_modules" | wc -l
```

**Validação**: Lista documentada de todos os acessos a estado mutável.

### P02 — Extrair session registry (3h)

**Opção A** (preferida): Registry separado em `conversation-hub/session-registry.js`

```javascript
// conversation-hub/session-registry.js
export class SessionRegistry {
    #sessions = new Map();
    get(id) { return this.#sessions.get(id); }
    set(id, session) { this.#sessions.set(id, session); }
    delete(id) { return this.#sessions.delete(id); }
    list() { return [...this.#sessions.values()]; }
    clear() { this.#sessions.clear(); }
    get size() { return this.#sessions.size; }
}
```

**Opção B**: Registry como sub-módulo de `sdk/session/` mas acessado via DI token (stateless pattern).

**O que fazer**:
1. Criar `conversation-hub/session-registry.js`
2. Adicionar DI token `SessionRegistryToken` em `conversation-hub/di-tokens.js`
3. Refatorar `sdk/session/client.js`:
   - Remover `_sessions` Map
   - Receber `SessionRegistry` via DI ou parameter injection
   - `getSession(id)` → `registry.get(id)`
   - `listSessions()` → `registry.list()`
4. Atualizar bootstrap para registrar SessionRegistry no DI

**Validação**:
```bash
npm run lint
npm run test:unit
```

**Rollback**: `git checkout -- src/copilot/sdk/session/ src/copilot/conversation-hub/`

### P03 — Eliminar `sdk/config.js` (2h)

**Pré-requisito**: M-02 P09 (deprecation) já executado.

**O que fazer**:
1. Encontrar todos os consumers:
```bash
grep -rn "buildSessionConfig\|from.*sdk/config" src/ --include="*.js" | grep -v node_modules
```

2. Para cada consumer, substituir:
   - `import { buildSessionConfig } from '#copilot/sdk'` (ou caminho relativo)
   - → `import { SessionConfigBuilder } from '#copilot/config'`
   - Adaptar chamada: `buildSessionConfig(opts)` → `new SessionConfigBuilder(opts).build()`

3. Remover `sdk/config.js`
4. Remover re-export de `sdk/index.js`

**Validação**:
```bash
grep -rn "buildSessionConfig\|sdk/config" src/ --include="*.js" | grep -v node_modules
# Deve retornar 0 resultados
npm run lint && npm run test:unit
```

### P04 — Consolidar `sdk/agent/agents.js` com `config/custom-agents.js` (2h)

**O que fazer**:
1. Comparar os dois arquivos:
   - `sdk/agent/agents.js` (268L) — factory de CustomAgentConfig
   - `config/custom-agents.js` (326L) — config de custom agents

2. Se há sobreposição: manter apenas `config/custom-agents.js` e mover o que é exclusivo
3. Se são complementares: mover definições de tipo/factory de `sdk/agent/agents.js` para
   `config/custom-agents.js`

4. Atualizar consumers:
```bash
grep -rn "from.*sdk/agent/agents\|from.*sdk/agent.*agents\|CustomAgentConfig" src/ --include="*.js"
```

5. Se `sdk/agent/` fica vazio (contratos já movidos em M-02 P07): deletar diretório

**Validação**: `npm run lint && npm run test:unit`

### P05 — Limpar `sdk/index.js` barrel (1h)

**O que fazer**:
1. Ler `sdk/index.js` (356L)
2. Remover re-exports de:
   - `config.js` (eliminado em P03)
   - `agent/` (eliminado em P04 + M-02 P07)
3. Verificar que nenhum consumer depende dos re-exports removidos

**Validação**: `npm run lint && npm run test:unit`

### P06 — Verificar aderência JSDoc ao SDK real (2h)

**O que fazer**:
1. Ler `sdk/types.js` (700L)
2. Comparar com API real do `@github/copilot-sdk` (>=0.2.0):
   - `CopilotClient`, `CopilotSession`, `SessionConfig`, etc.
3. Marcar tipos que não existem mais com `@deprecated`
4. Adicionar tipos que faltam

```bash
# Verificar quais tipos são usados
grep -rn "@type.*import.*#copilot/sdk" src/ --include="*.js" | head -30
```

**Validação**: `npm run lint`

### P07 — Atualizar import map no `package.json` (0.5h)

Verificar e atualizar `#copilot/sdk` para refletir arquivos removidos.

### P08 — Testes de regressão (2h)

```bash
npm run lint
npm run format:check
npm run test:unit
npm run test:integration
```

Testes específicos:
- Session creation via SDK → registry armazena
- Session listing → registry lista
- Config build → SessionConfigBuilder funciona
- Custom agents → config/custom-agents.js carrega

### P09 — Commit (0.5h)

```bash
git add -A
git commit --no-verify -m "refactor: fase 3 SDK stateless — session registry extraction + cleanup

- Extrai session registry para conversation-hub/ (C5)
- Elimina sdk/config.js — SessionConfigBuilder é canônico (C5/L3)
- Consolida sdk/agent/agents.js em config/custom-agents.js (C6)
- Limpa sdk/index.js barrel
- Alinha JSDoc sdk/types.js com copilot-sdk >=0.2.0"
git push origin main
```

---

## 4. Critérios de Conclusão

- [ ] `sdk/session/client.js` não mantém `_sessions` Map internamente
- [ ] `conversation-hub/session-registry.js` existe com API get/set/delete/list/clear
- [ ] `sdk/config.js` não existe
- [ ] `sdk/agent/` não existe (ou contém apenas `agents.js` se não consolidado)
- [ ] 0 imports de `buildSessionConfig` no codebase
- [ ] `sdk/index.js` não re-exporta config.js nem agent/
- [ ] `npm run lint` ✅
- [ ] `npm run test:unit` ✅

---

## 5. Riscos e Mitigações

| Risco                                                   | Probabilidade | Impacto | Mitigação                                           |
| ------------------------------------------------------- | ------------- | ------- | --------------------------------------------------- |
| Session registry extraction quebra lifecycle            | Alta          | Alto    | P02 opção B (DI) mantém compatibilidade; testes P08 |
| sdk/config.js tem consumers não detectados              | Baixa         | Médio   | grep exaustivo em P03                               |
| Race condition no registry compartilhado                | Média         | Alto    | SessionRegistry usa Map (síncrono no event loop)    |
| agents.js tem lógica que não existe em custom-agents.js | Média         | Médio   | Diff manual em P04                                  |
| Runtime errors por barrel changes                       | Baixa         | Alto    | P08 regressão completa                              |
