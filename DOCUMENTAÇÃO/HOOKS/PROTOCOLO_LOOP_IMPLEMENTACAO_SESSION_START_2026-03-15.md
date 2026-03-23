# Protocolo LOOP — Implementação contínua do `session-start`

## Objetivo

Executar todas as propostas da auditoria em lotes pequenos, verificáveis e sem regressão semântica.

## LOOP canônico (repetir até 100%)

1. **Selecionar lote** (3–6 propostas) por prioridade (P0 → P1 → P2).
2. **Mapear impacto** (arquivos/funções/contratos afetados).
3. **Aplicar patch mínimo** (sem refatoração lateral).
4. **Validar diagnóstico** dos arquivos alterados.
5. **Registrar status**: proposta `implementada`, `parcial` ou `adiada` (com motivo).
6. **Sincronizar checklist** e avançar imediatamente para o próximo lote.

## Regras operacionais

- Priorizar primeiro: contrato de estado, recovery/reconnect e segurança de observabilidade.
- Não misturar mudanças críticas de fluxo com mudanças cosméticas no mesmo lote.
- Cada lote precisa deixar evidência de validação local (diagnóstico sem erro nos arquivos tocados).
- Só encerrar o ciclo quando todas as propostas estiverem marcadas como implementadas ou
  justificadamente adiadas.

## Ordem de execução recomendada

- **Lote A (P0)**: `P-01`, `P-02`, `P-05`, `P-06`, `P-13`, `P-14`.
- **Lote B (Recovery)**: `P-25`, `P-26`, `P-28`, `P-29`, `P-34`.
- **Lote C (Observabilidade/Segurança)**: `P-35`, `P-41`, `P-44`, `P-47`.
- **Lote D (Testabilidade/Governança)**: `P-49`, `P-50`, `P-51`, `P-52`.
