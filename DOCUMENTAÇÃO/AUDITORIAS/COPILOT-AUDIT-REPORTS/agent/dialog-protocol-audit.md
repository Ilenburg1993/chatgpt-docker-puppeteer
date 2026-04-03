# Auditoria Individual — `agent/dialog-protocol.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit. Plano:
> `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md` v2.0

---

## 1. Identificação

| Campo               | Valor                                  |
| ------------------- | -------------------------------------- |
| **Arquivo**         | `src/copilot/agent/dialog-protocol.js` |
| **Módulo**          | `agent/`                               |
| **LOC**             | 115                                    |
| **Fase**            | F05-05                                 |
| **Data de leitura** | 2026-07-05                             |

---

## 2. Propósito e Responsabilidade

Centraliza constantes de protocolo do Dialog Loop (`READY:`, `REPLY:`, `DONE:`, `STOPPED`),
classificação de mensagens `ask_user`, extração de conteúdo de resposta e construção do metaPrompt
de boot. Namespace testável via classe estática `DialogProtocol`.

---

## 3. API Pública (Exports)

| Export                 | Tipo     | Descrição curta                                             |
| ---------------------- | -------- | ----------------------------------------------------------- |
| `DIALOG_PROTO_READY`   | const    | Prefixo `"READY:"`                                          |
| `DIALOG_PROTO_REPLY`   | const    | Prefixo `"REPLY:"`                                          |
| `DIALOG_PROTO_DONE`    | const    | Prefixo `"DONE:"`                                           |
| `DIALOG_PROTO_STOPPED` | const    | String `"STOPPED"`                                          |
| `DialogProtocol`       | class    | Namespace estático: classify, extractReply, buildBootPrompt |
| `DialogMessageKind`    | @typedef | Union type das classificações                               |

**Total de exports**: 6 (4 const + 1 class + 1 typedef) **Exports consumidos**: DLM (`classify`,
`extractReply`, `buildBootPrompt`), testes **Exports possivelmente dead**: Individuais (constantes)
podem ser consumidas apenas via `DialogProtocol`

---

## 4. Dependências (Imports)

Nenhum import — módulo totalmente auto-contido.

---

## 5. Estado Interno

Nenhum — apenas funções estáticas puras e constantes imutáveis.

---

## 6. Análise de Contratos

### 6.1 Contratos de entrada

| Método            | Param      | Tipo esperado | Validação? | Default seguro? |
| ----------------- | ---------- | ------------- | ---------- | --------------- |
| `classify`        | `question` | string        | ❌         | N/A             |
| `extractReply`    | `question` | string        | ❌         | N/A             |
| `buildBootPrompt` | `opts`     | object        | ❌         | ✅ defaults     |

### 6.2 JSDoc completeness

✅ Completo — todos os métodos e constantes documentados com tipos, @returns, @see.

---

## 7. Error Handling

Nenhum — funções puras sem throw. `classify()` retorna `'question'` como fallback seguro.

---

## 8. Segurança

| Vetor            | Aplicável? | Detalhes                                                                                                                                                               |
| ---------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection | Parcial    | `buildBootPrompt(firstMessage)` concatena input do usuário diretamente no metaprompt. Se `firstMessage` contiver instruções adversárias, serão incluídas literalmente. |

---

## 9. Concorrência

Nenhum risco — funções puras stateless.

---

## 10. Achados (Questões Formais)

### SEC-AGENT-002 — `buildBootPrompt()` concatena `firstMessage` sem sanitização

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/dialog-protocol.js`#L106-L108
- **Descrição**: `opts.firstMessage` é concatenado diretamente no metaprompt enviado ao modelo.
  Embora o controle de quem chama `buildBootPrompt()` seja interno, um futuro consumidor pode expor
  esse parâmetro a input externo (e.g., API endpoint), permitindo injeção de instruções no prompt do
  dialog loop.
- **Proposta de correção**: Documentar explicitamente que `firstMessage` é trusted input;
  opcionalmente truncar a 500 chars.
- **Impacto se não corrigido**: Risco latente de prompt injection se o call-site mudar.

### STYLE-AGENT-001 — `classify()` usa string literal `'READY'` sem constante `DIALOG_PROTO_READY`

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/dialog-protocol.js`#L72
- **Descrição**: `trimmed === 'READY'` usa string literal, enquanto
  `trimmed.startsWith(DIALOG_PROTO_READY)` usa a constante exportada. Inconsistência: se o token
  mudar, a comparação exata ficará desatualizada.
- **Proposta de correção**: Usar `trimmed === DIALOG_PROTO_READY.replace(':', '')` ou definir
  `DIALOG_PROTO_READY_EXACT = 'READY'`.
- **Impacto se não corrigido**: Nulo se tokens nunca mudarem; inconsistência de manutenção.

---

## 11. Upgrades Propostos

Nenhum relevante — módulo limpo e focado.

---

## 12. Cobertura de Testes

| Critério              | Status                                          |
| --------------------- | ----------------------------------------------- |
| Existe spec dedicado? | ✅ Sim (coberto em testes do dialog loop)       |
| Cenários cobertos     | classify READY/REPLY/DONE/STOPPED, extractReply |
| Cenários NÃO cobertos | buildBootPrompt com firstMessage (edge case)    |

---

## 13. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                          |
| ------------------- | ------------ | -------------------------------------- |
| Contratos (tipos)   | 9            | JSDoc completo, typedef                |
| Error handling      | N/A          | Sem lógica de erro (puras)             |
| Segurança           | 7            | firstMessage sem sanitização (latente) |
| Performance         | 10           | Operações O(1) de string               |
| Testabilidade       | 9            | Funções puras, fácil de testar         |
| Manutenibilidade    | 9            | 115 LOC, namespace claro               |
| **Média ponderada** | **8.9**      | **(9×2 + 7×2 + 10+9+9) / 8 ≈ 8.9**     |

---

## 14. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (protocolo do agente)
- **Padrão**: Namespace estático com funções puras — design adequado
- **Conformidade AS-IS→TO-BE**: ✅ Auto-contido, sem dependências externas. Bom candidato a unit
  test puro.
