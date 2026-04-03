# Auditoria Individual — `agent/permission-controller.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit (F05-12).

---

## 1. Identificação

| Campo       | Valor                                        |
| ----------- | -------------------------------------------- |
| **Arquivo** | `src/copilot/agent/permission-controller.js` |
| **Módulo**  | `agent/`                                     |
| **LOC**     | 152                                          |
| **Fase**    | F05-12                                       |

---

## 2. Propósito e Responsabilidade

Controlador de modo de permissão SDK em runtime. Encapsula a troca de `PermissionHandler` entre
`approve_all`, `audit_only` e `selective` sem reiniciar o agente. Usa DI callback `onModeChanged`
para notificação.

---

## 3. API Pública (Exports)

| Export                 | Tipo     | Descrição curta                                |
| ---------------------- | -------- | ---------------------------------------------- |
| `PermissionController` | class    | Gerenciador de modos de permissão              |
| `PermissionMode`       | @typedef | `'approve_all' \| 'audit_only' \| 'selective'` |
| `SelectiveModeOpts`    | @typedef | Opções para modo selective                     |

---

## 4. Dependências (Imports)

| Import                          | Via barrel? | Módulo origem  |
| ------------------------------- | ----------- | -------------- |
| `#copilot/lib/permissions`      | ❌ bypass   | lib/           |
| `#copilot/observability/logger` | ❌ bypass   | observability/ |
| `@github/copilot-sdk`           | ❌ SDK dir  | SDK externo    |

- **Barrel bypasses**: 2 (lib/permissions, logger)
- **SDK direto**: ✅ `approveAll` from SDK — necessário para o handler padrão
- **Violação de camada**: Não — Layer 5 pode importar lib/ (Layer 2)

---

## 5. Estado Interno

| Variável         | Tipo              | Mutable? | Risco                |
| ---------------- | ----------------- | -------- | -------------------- |
| `#handler`       | PermissionHandler | Sim      | ok (set via setMode) |
| `#mode`          | PermissionMode    | Sim      | ok                   |
| `#onModeChanged` | Function?         | Não      | ok                   |

---

## 6. Achados (Questões Formais)

### SEC-AGENT-003 — `AGENT_DENY_SHELL_TOOLS` env var split sem sanitização **[FIXED]**

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/permission-controller.js`#L127-L130
- **Descrição**:
  `process.env['AGENT_DENY_SHELL_TOOLS'].split(',').map(t => t.trim()).filter(Boolean)` — a string
  vem de variável de ambiente que poderia conter tool names inesperados (e.g., com espaços ou
  caracteres especiais). O `.trim().filter(Boolean)` é defensivo, mas não valida se os nomes são
  tool names válidos.
- **Proposta**: Validar contra uma allowlist de tool names conhecidos ou contra regex `^[a-z_]+$`.
- **Impacto se não corrigido**: Baixo — tool names inválidos simplesmente não matcham nenhuma tool.

### GAP-AGENT-007 — `setMode()` default case retorna sem log de erro completo

- **Severidade**: P5
- **Arquivo**: `src/copilot/agent/permission-controller.js`#L141
- **Descrição**: O default case do switch emite WARN e retorna — sem `#onModeChanged` callback e sem
  propagar erro. Comportamento correto, mas poderia lançar ou retornar `false` para indicar falha ao
  caller.
- **Proposta**: Retornar booleano ou lançar `TypeError` para modo inválido.

---

## 7. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                        |
| ------------------- | ------------ | ------------------------------------ |
| Contratos (tipos)   | 9            | JSDoc completo, typedefs claros      |
| Error handling      | 7            | Default case silencioso              |
| Segurança           | 7            | Env var sem validação rigorosa       |
| Performance         | 10           | Trivial                              |
| Testabilidade       | 8            | DI via callback; sem spec dedicado   |
| Manutenibilidade    | 9            | 152 LOC, limpo, single-purpose       |
| **Média ponderada** | **8.3**      | **(9×2 + 7×2 + 7+10+8+9) / 8 ≈ 8.3** |

---

## 8. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (controle de permissão do agente)
- **Padrão**: Strategy Pattern — PermissionHandler trocável em runtime
- **Conformidade AS-IS→TO-BE**: ✅ Boa separação; importa SDK diretamente para `approveAll`
  (necessário)
