# 87 — W86.7.3: Checkpoint — turn-result-persistence Seam Extraction

**Data:** 2026-04-30 **Status:** concluído e consolidado **Escopo:**
`src/copilot/agent/dialog/turn-executor.js`

## Síntese

A terceira subfaixa da W86.7 foi consolidada com a extração do seam
`src/copilot/agent/dialog/seams/turn-result-persistence.js`.

O `turn-executor.js` permanece como fachada/orquestrador público do turno, preservando a API
existente, enquanto a lógica de resolução por eventos (`reply`, `ready`, `stopped`), timeouts
internos, shortcuts de protocolo e despacho para `ask_user`/pending question passa a viver em seam
dedicada.

## Situação consolidada

- `turn-input-validation.js`: normalização de eventos, protocolo e finalização de reply.
- `turn-execution-context.js`: lifecycle de timeout, abort listener, trace label e fallback
  semântico.
- `turn-result-persistence.js`: construção dos listeners de resolução e despacho do turno ao host.
- `turn-executor.js`: mantém assinatura pública e injeta dependências auxiliares nos seams.

## Correções adicionais desta consolidação

- O timeout de inatividade agora remove listeners também das fontes externas de progresso (`host`),
  não apenas do emitter principal.
- O caminho interno após `question.pending` também pode acionar `finalizeTurnReply`, preservando
  evento de fim de turno e métricas quando o reply chega pelo listener interno.
- Os testes estruturais foram atualizados para reconhecer a arquitetura de aggregate fino em
  `boot-steps.js` e seams reais em `boot-session-prep.js`, `boot-dialog-recovery.js`,
  `boot-runtime-bind.js`, `runtime-teardown.js` e `dialog/seams/turn-result-persistence.js`.

## Critérios objetivos atendidos

- API pública de `turn-executor.js` preservada.
- `typecheck:strict:src.copilot` verde.
- `typecheck:strict:tests.unit` verde.
- Testes focados de diálogo, boot wiring, lifecycle, initializer e contratos arquiteturais verdes.
- Contrato W86.7.3 adicionado em `test_arch_contracts.spec.js`.

## Próximas faixas recomendadas

1. W86.8: decompor `loop-manager.js` seguindo o mesmo padrão de seams pequenos e testáveis.
2. W87: reduzir imports diretos de SDK dentro das façades remanescentes, com matriz explícita de
   ownership por operação.
3. W88: completar inventário de registries runtime-aware e adicionar testes com múltiplos runtimes
   reais no mesmo processo.
