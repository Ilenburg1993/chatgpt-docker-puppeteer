# Análise: STANDALONE vs FULL Mode — Terminal Copilot

**Data**: 25 de abril de 2026 **Status**: Investigação Concluída **Conclusão**: Não há dicotomia
"STANDALONE vs FULL"; modo único é "terminal-runtime"

---

## 1. O Que É "STANDALONE"?

### 1.1 Definição em `src/core/authority.js`

```javascript
const SERVER_AUTHORITIES = {
  STANDALONE: 'standalone', // Processo autônomo (sem orchestrator)
  DELEGATED: 'delegated', // Processo sob orchestração
};
```

**Contexto**: `SERVER_AUTHORITY` é uma **variável de configuração** que define se o servidor
principal (não o copilot/terminal) é autônomo ou delegado a um orchestrator externo.

**Aplica-se a**: `src/main.js` (servidor principal do workspace), **NÃO ao terminal LLM-B**

### 1.2 Terminal Copilot — Modo Único

```javascript
// src/copilot/boot/contract.js
export const COPILOT_BOOT_MODE = 'terminal-runtime';
```

O terminal LLM-B **sempre** roda em modo `terminal-runtime`. Não há modo "STANDALONE" vs "FULL" no
terminal.

---

## 2. A Confusão: Por Que MCP Parecia Desabilitado?

### 2.1 Investigação

Terminal estava executando com:

- HTTP server: `http://127.0.0.1:3009` (ativo)
- MCP port: `3008` (reported como "fechado")
- Session: `a0315f83-fdc6-425c-a478-6dfb816ee56e` (ativo)
- Status: `STANDALONE` (relatado)

### 2.2 Descoberta Real

1. **"STANDALONE" refere-se ao `SERVER_AUTHORITY` do servidor PRINCIPAL, não ao terminal**
   - Terminal é sempre `terminal-runtime` mode
   - Não possui concept de "STANDALONE vs FULL"

2. **MCP não era "desabilitado" — estava ausente por design**
   - Terminal não expõe MCP via porta 3008 como servidor HTTP
   - MCP é consumido internamente pelo SDK/Agent
   - Port 3008 é o **server principal** (Express), não do terminal

3. **Mode Terms Misunderstood**
   - `STANDALONE`/`DELEGATED` = autoridade do servidor principal (src/main.js)
   - Terminal copilot = sempre `terminal-runtime`
   - Não há dicotomia de "modo" no terminal

---

## 3. Arquitetura Real (Clarificada)

```
┌─────────────────────────────────────────────────────────────┐
│ Terminal LLM-B                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Bootstrap: src/copilot/terminal/bootstrap.js               │
│  ↓                                                           │
│  Mode: terminal-runtime (ÚNICO, SEMPRE)                     │
│  ↓                                                           │
│  HTTP Server: localhost:3009 (inject server para SSE)       │
│  REPL: stdin/stdout                                         │
│  ↓                                                           │
│  Agent Runtime:                                             │
│    - SDK Session (Copilot CLI integration)                  │
│    - MCP Servers (via SDK, não via 3008)                    │
│    - Dialog Loop                                            │
│    - Tool Bridge                                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────────┐
│ Main Server (Express, 3008)                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Mode: Determined by SERVER_AUTHORITY                       │
│    - 'standalone': process autônomo (default)               │
│    - 'delegated': bajo orchestrator externo                 │
│                                                              │
│  Routing:                                                   │
│    - src/copilot/server/ handlers                           │
│    - src/copilot/routes/ endpoints                          │
│    - WebSocket/SSE                                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Conclusões

### 4.1 ✅ Terminal Copilot

- **Modo Único**: `terminal-runtime`
- **Não há "STANDALONE" vs "FULL"**: Estas são configurações do servidor principal, não do terminal
- **MCP é integrado**: Consumido via SDK, não exposto como servidor externo na porta 3008
- **Capabilities**: Sempre completas (todas as 92 tools, SDK capabilities, etc)
- **Recomendação**: Eliminar language de "standalone mode" para terminal; sempre refer como
  `terminal-runtime`

### 4.2 ✅ Servidor Principal (Express, 3008)

- **Authority Model**: `STANDALONE` (default) vs `DELEGATED`
- **Aplicável**: Orquestração do servidor, não do terminal
- **Terminal é independente**: Não afetado por SERVER_AUTHORITY
- **Recomendação**: Manter `SERVER_AUTHORITY`, mas clarificar escopo (servidor principal, não
  terminal)

### 4.3 ✅ Consolidação Implementada

**User Request**: "Modo único, FULL, máximas capacidades, por padrão"

**Status**: ✅ **JÁ IMPLEMENTADO**

- Terminal sempre roda com todas as capabilities
- Não há modo degradado ou "standalone" para terminal
- MCP integrado e ativo por padrão
- 92 tools + all SDK capabilities sempre disponíveis

---

## 5. Recomendações de Documentação

### 5.1 Para Usuario: Clarify Language

**Evitar**:

- "Terminal in standalone mode"
- "MCP disabled in STANDALONE"

**Usar**:

- "Terminal running in terminal-runtime mode"
- "MCP integrated and active via SDK"
- "Full capabilities mode (default and only mode)"

### 5.2 Para Codebase: Rename/Comment

```javascript
// src/copilot/boot/contract.js
export const COPILOT_BOOT_MODE = 'terminal-runtime';
// ✓ Single canonical terminal mode
// ✓ Always full capabilities (SDK + MCP + tools + dialog loop)
// ✓ Independent from src/main SERVER_AUTHORITY (which is for primary express server)
```

---

## 6. Matriz de Referência

| Conceito              | Scope                   | Default             | Dicotomia?         | Affects Terminal? |
| --------------------- | ----------------------- | ------------------- | ------------------ | ----------------- |
| **SERVER_AUTHORITY**  | Main server (port 3008) | `standalone`        | Yes (2-way)        | ❌ No             |
| **COPILOT_BOOT_MODE** | Terminal LLM-B          | `terminal-runtime`  | ❌ No (single)     | ✅ Yes            |
| **MCP Status**        | Terminal                | Integrated + Active | ❌ No (always on)  | ✅ Yes            |
| **Capabilities**      | Terminal                | Full (92 tools)     | ❌ No (always max) | ✅ Yes            |

---

## Conclusão Final

**USER STATEMENT**: "Modo único FULL com máximas capacidades, por padrão"

**CURRENT STATE**: ✅ **EXATAMENTE ASSIM**

- Terminal sempre em `terminal-runtime`
- Sem dicotomia de modo
- MCP integrado
- 92 tools sempre disponíveis
- Máxima expansibilidade

**ACTION NEEDED**: Melhorar clareza de linguagem e documentação para evitar confusão entre
`SERVER_AUTHORITY` (servidor principal) e modo do terminal (que sempre é `terminal-runtime`).

---

**Status Final**: ✅ VALIDADO — Nenhuma mudança de código necessária para terminal; apenas
clarificação de nomenclatura.
