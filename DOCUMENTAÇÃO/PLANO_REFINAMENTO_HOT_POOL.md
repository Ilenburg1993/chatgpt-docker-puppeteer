# Refinamento de Implementação - Hot Pool com Semântica ATTACHED/UNATTACHED

**Data:** 16 de fevereiro de 2026 **Autor:** GitHub Copilot **Status:** Planejamento
(Aprofundamento)

## 1. Alinhamento Semântico e Estados

Para manter a consistência com o restante do código (NERV, Telemetria) e a lógica de
`ATTACHED/UNATTACHED`, ajustaremos a semântica do Hot Pool conforme solicitado:

- **`UNATTACHED`:** Estado inicial ou pós-falha. Driver instanciado, mas sem página (`page=null`).
  - _Significado:_ Recurso indisponível ou driver "frio".
- **`ATTACHED` (Novo Conceito):** Driver com página válida (`page!=null`).
  - **Sub-estado `COLD` (IDLE):** Driver `ATTACHED` a uma página (ex: `about:blank`), aguardando
    tarefa.
  - **Sub-estado `HOT` (BUSY/EXECUTING):** Driver `ATTACHED` e executando uma tarefa ativa.

**Fluxo Ideal (Hot Pool):**

1.  Factory cria driver.
2.  Factory aloca página e chama `attachContext()`.
3.  Driver entra em **`ATTACHED (COLD)`**. Fica no Pool.
4.  `acquireFromPool()` retorna driver **`ATTACHED (COLD)`**.
5.  Adapter inicia execução -> Driver vira **`ATTACHED (HOT)`**.
6.  Fim da tarefa -> Adapter chama `releaseToPool()`.
7.  Factory executa `resetSession()`.
8.  Driver volta para **`ATTACHED (COLD)`**.

---

## 2. Integração Profunda com NERV e Telemetria

### A. Backpressure e NERV

O mecanismo de _Backpressure_ atual (`_waitForDriverRelease`) é local (Promise/EventEmitter no
Factory). Precisamos elevá-lo para o NERV para que o Kernel saiba quando desacelerar.

- **Novo Evento NERV:** `DRIVER_POOL_PRESSURE`
  - Emitido pelo Factory quando Pool usage > 80% ou quando `POOL_EXHAUSTED`.
  - **Payload:** `{ target: 'chatgpt', utilization: 0.9, available: 0, queueSize: 5 }`
- **Reação do Kernel:**
  - Ao receber `DRIVER_POOL_PRESSURE` (High), o Kernel deve pausar temporariamente o despacho de
    novas tarefas para aquele target (throttle).

### B. Telemetria de Pool (Vital para Observabilidade)

A telemetria atual foca muito na _criação_ de drivers. Precisamos de métricas de _utilização_ e
_saúde do pool_.

- **Novas Métricas (via `factory:telemetry`):**
  - `pool_size`: Total de drivers instanciados.
  - `drivers_attached_cold`: Prontos para uso.
  - `drivers_attached_hot`: Em execução.
  - `drivers_unattached`: Em transição ou erro.
  - `allocation_wait_time`: Tempo médio esperando driver.

### C. Health Checks e "Ghost Drivers"

Drivers `ATTACHED (COLD)` podem ter suas páginas fechadas externamente (crash do Chrome, user
action). O Factory precisa detectar isso proativamente.

- **Monitoramento Ativo:** O `_startHealthChecks` do Factory deve verificar `driver.page.isClosed()`
  para todos os drivers `COLD` e removê-los/recriá-los silenciosamente.

---

## 3. Plano de Implementação (Refinado)

1.  **Refatorar `TargetDriver.js`:**
    - Explicitar sub-estados HOT/COLD na propriedade `state` ou `_busy`.
    - Garantir que eventos de telemetria (`DRIVER_STATE_CHANGE`) reflitam essas transições para o
      dashboard.

2.  **Atualizar `DriverFactory.js`:**
    - Implementar a lógica de emissão de `DRIVER_POOL_PRESSURE` via NERV.
    - Refinar `releaseToPool` para garantir a transição `HOT -> COLD` correta com limpeza
      (`resetSession`).
    - Melhorar o Health Check para validar integridade da página de drivers `COLD`.

3.  **Atualizar Adapter (`driver_nerv_adapter.js`):**
    - Remover lógica de fallback de alocação de página (se possível) ou mantê-la apenas como
      "disaster recovery".
    - Garantir que o Adapter reporte corretamente o início/fim da fase `HOT`.

---

_Aprovado para execução: Foco em manter nomenclatura ATTACHED/UNATTACHED com semântica de Hot/Cold
via estado IDLE/BUSY._
