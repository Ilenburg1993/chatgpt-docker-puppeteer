**DOCUMENTAÇÃO — Subsistema DRIVER**

Propósito: Descrever a arquitetura, contratos, comportamento e runbook do subsistema de Drivers que
executa ações em páginas via Puppeteer. Foco em `TargetDriver` (contrato abstrato) e `BaseDriver`
(implementação concreta usada pela fábrica).

---

**Visão Geral**

- **Responsabilidade**: Encapsular execução em uma página (input simulada, submissão, telemetria),
  gerenciar máquina de estados e expor sinais de saúde e telemetria.
- **Contexto de execução**: Cada Driver é associado a uma instância `page` do Puppeteer.
- **Gerenciamento de ciclo de vida**: Instâncias são criadas pela `factory` e gerenciadas pelo
  `DriverLifecycleManager` (adquire/libera). Abortos controlados via `AbortSignal`.

---

**Arquivos principais analisados**

- [src/driver/core/TargetDriver.js](src/driver/core/TargetDriver.js)
- [src/driver/core/BaseDriver.js](src/driver/core/BaseDriver.js)
- `src/driver/*` (DriverLifecycleManager, driver_nerv_adapter, factory)

---

**TargetDriver — Contrato (resumo)**

- Classe abstrata que define API pública mínima que implementações concretas devem seguir.
- Estados padronizados e eventos emitidos:
  - Eventos: `state_change`, `caps_change`, `destroyed`, `driver:vital`, `warning`, `debug`.
  - Estados (`TargetDriver.STATES`): `IDLE`, `PREPARING`, `TYPING`, `WAITING`, `STALLED`.
- Métodos obrigatórios a implementar por subclasses:
  - `validatePage()`
  - `prepareContext(taskSpec)`
  - `sendPrompt(text, taskId, signal)`
  - `waitForCompletion(startSnapshot, signal)`
  - `captureState()`
  - `stopGeneration()`
  - `commitLearning()` (opcional)
- Segurança: `emit()` é sobrescrito para bloquear emissões após `destroy()`.

Exemplo de uso (observador de estado):

```
driver.on('state_change', evt => {
  // evt: { from, to, ts, duration_ms }
});

await driver.sendPrompt('texto', taskId, abortSignal);
```

---

**BaseDriver — Implementação (resumo)**

- Extende `TargetDriver` e implementa execução orientada por módulos: RecoverySystem, HandleManager,
  InputResolver, FrameNavigator, BiomechanicsEngine, SubmissionController.
- Principais responsabilidades:
  - `setCorrelationId(id)`: propaga ID de correlação para submódulos.
  - `sendPrompt(text, taskId, signal)`: fluxo de execução completo com tentativas, recuperação
    escalonada e emissão de telemetria (`TRIAGE_ALERT`, `driver:vital`).
  - `destroy()`: limpeza profunda de subsistemas e emissão de sinais para factory.
  - `_emitVital(type, payload)`: evento sensorial desacoplado para TelemetryBridge.

Fluxo interno de `sendPrompt` (alto nível):

1. Verifica aborto via `signal`.
2. Aguarda ociosidade / sincronização via `biomechanics.waitIfBusy()`.
3. Resolve interface com `inputResolver.resolve()` (seletores/protocolo).
4. Obtém contexto de execução com `frameNavigator.getExecutionContext()`.
5. Prepara elemento com `biomechanics.prepareElement()`.
6. Digita com jitter humano via `biomechanics.typeText()`.
7. Submete de forma atômica com `submission.submit()`.
8. Em caso de erro: emite `TRIAGE_ALERT`, aplica `recovery.applyTier(err, attempts, taskId)` e tenta
   novamente.

Erros comuns documentados no código:

- `OPERATION_ABORTED` — repassa imediatamente (sinal de aborto soberano).
- `TARGET_CLOSED` — página não está mais disponível (recriar driver/page).
- `EXECUTION_FAIL` — falha após tentativas; inclui `history` para triagem.

Telemetria emitida:

- Canal: `driver:vital` com payload { type, payload, correlationId, ts }.
- Exemplos de `type`: `TRIAGE_ALERT`, `SADI_PERCEPTION`, `HUMAN_PULSE`, `EXECUTION_RETRY`.

---

**Integração com NERV / Kernel**

- O `DriverNERVAdapter` (na pasta `driver/nerv_adapter`) recebe envelopes do NERV e traduz para
  chamadas ao Driver (`sendPrompt`, `stopGeneration`, `captureState`).
- Padrão de mensagens (exemplos conceituais):
  - `DRIVER_EXECUTE_TASK` → adapter chama `prepareContext` + `sendPrompt`.
  - `DRIVER_TASK_STARTED`, `DRIVER_TASK_COMPLETED`, `DRIVER_TASK_FAILED` → eventos enviados ao NERV.
  - `DRIVER_ABORT` → `AbortController.abort()` repassado ao driver.

Obs.: conferir o mapa real de ActionCodes no repositório para nomes exatos.

---

**Runbook — Passos de triagem rápida**

1. Inspecionar health do driver:
   - `await driver.getHealth()` → checar `status`, `state`, `isPageAttached`, `stateAge`.
2. Erro `TARGET_CLOSED`:
   - Se `page.isClosed()` → destruir driver (`await driver.destroy()`), invalidar cache na factory
     (`factory.invalidatePageCache(page)`), e adquirir nova instância via `factory.getDriver(...)`.
3. Erro `OPERATION_ABORTED`:
   - Verificar quem chamou `abort()` no `AbortController` (DriverLifecycleManager / Kernel).
4. Falhas persistentes (`EXECUTION_FAIL`):
   - Consultar `err.history` (retorna tentativa/erro/timestamp), aumentar logs de telemetria,
     revisar selectors retornados por `inputResolver` e tempo de espera do `biomechanics`.

---

**Sugestões de testes**

- Mockar `page` (isClosed, bringToFront, selectors) e validar comportamento de retry de
  `sendPrompt`.
- Verificar que `destroy()` emite `destroyed` e que `factory` remove instância do cache.
- Testar emissão de `driver:vital` em casos de falha para garantir que TelemetryBridge recebe
  eventos.

---

**Anotações e recomendações**

- Evitar mudanças diretas no ciclo de vida sem passar pelo `DriverLifecycleManager`.
- Manter `AbortSignal` como canal primário para cancelamento — não matar páginas diretamente.
- Centralizar mapeamento de ActionCodes em `src/core/constants` e referenciar nos adapters.

---

Se desejar, eu gero exemplos concretos de envelopes NERV → Driver (JSON) e um playbook de
recuperação automático que o Kernel pode executar ao detectar `TARGET_CLOSED`.
