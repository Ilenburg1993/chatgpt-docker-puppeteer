# 18 — `observability/`, `audit/` e `logs/`

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**:
`src/copilot/observability/`, `src/copilot/audit/` e os artefatos `logs/` no contexto da observação,
rastreamento e governança do runtime Copilot.

---

## 1. Objetivo deste documento

Este documento audita um dos eixos mais fáceis de se sobrepor em sistemas complexos:

- observabilidade;
- telemetria;
- audit trail;
- logs;
- timelines;
- snapshots.

A pergunta central aqui é:

> **como separar corretamente o que é observar o sistema, o que é auditar o sistema e o que é apenas
> artefato persistido de execução?**

---

## 2. Base factual utilizada nesta etapa

A análise se apoia em:

- `src/copilot/observability/README.md`
- `src/copilot/observability/bootstrap.js`
- `src/copilot/audit/README.md`
- inventário estrutural anterior desta auditoria

---

## 3. Tese arquitetural atual do eixo observável

## 3.1 `observability/`

A tese declarada de `observability/` é clara:

- logging;
- métricas;
- tracing;
- timelines;
- snapshots observáveis.

Mais importante:

> `observability/` deve consumir sinais já estabilizados e **não reinterpretar o SDK em paralelo**.

## 3.2 `audit/`

O README de `audit/` define o módulo como:

- pipeline de auditoria de tools, permissões e eventos;
- coleta;
- ring buffer;
- processamento de eventos de auditoria para compliance e observabilidade.

### Diagnóstico inicial

Essa descrição já mostra uma zona cinzenta importante:

- o módulo serve a compliance/governança,
- mas também menciona observabilidade.

É aqui que a auditoria precisa ser especialmente cuidadosa.

## 3.3 `logs/`

Pelo inventário e pela pré-auditoria, `logs/` não é módulo de domínio; é artefato de execução dentro
da árvore `src/copilot`.

### Diagnóstico inicial

Arquiteturalmente, isso o coloca em posição suspeita: não deveria competir com módulos de código por
semântica de ownership.

---

## 4. O que `observability/` parece fazer corretamente hoje

## 4.1 `bootstrap.js` como crossing intencional e controlado

`observability/bootstrap.js` é um arquivo particularmente importante.

Ele faz algo arquiteturalmente sofisticado:

- em vez de `core/` importar `observability/` diretamente,
- o bootstrap injeta as dependências observáveis nas camadas inferiores.

Isso é uma decisão correta de layering.

### Diagnóstico

Esse arquivo não é apenas um utilitário. Ele é um **ponto de crossing intencional e controlado**
entre camadas.

## 4.2 Event bus runtime observável

O bootstrap conecta:

- `EVENT_BUS`;
- `defaultMetrics`;
- `defaultErrorTracker`;
- `defaultEventCollector`;
- logging para SDK, hooks, tools, audit, db e shutdown.

### Diagnóstico

Essa centralização é boa porque reduz a chance de cada subsistema materializar sua própria
observação paralela.

## 4.3 Acoplamento com o emitter de métricas de L1

O bootstrap também conecta `setSdkMetricEmitter(emitSdkMetric)`.

### Diagnóstico

Isso é especialmente relevante porque mostra uma evolução arquitetural correta:

- `sdk/` emite sinais próprios de L1;
- `observability/` materializa esses sinais em `defaultMetrics`;
- a dependência segue o sentido correto.

---

## 5. O que `audit/` parece fazer corretamente hoje

## 5.1 Pipeline próprio e ring buffer

O módulo `audit/` parece organizar um domínio próprio de:

- pipeline;
- ring buffer;
- writer JSONL;
- logging de auditoria;
- buffers/pipelines específicos.

### Diagnóstico

Isso faz sentido se o objetivo for:

- preservar evidências;
- reter decisões recentes;
- produzir trilha auditável de tools, permissões e eventos relevantes.

## 5.2 Independência relativa de `agent/` e `sdk/`

O README afirma que `audit/` não deve importar:

- `agent/`
- `sdk/`
- `terminal/`

### Diagnóstico

Esse é um guardrail conceitualmente muito bom: impede que o módulo de auditoria vire owner da lógica
que ele observa.

---

## 6. Onde está a tensão arquitetural real

## 6.1 `observability/` vs `audit/`

### Situação atual

Os dois módulos tocam material semelhante:

- eventos;
- logging;
- timeline;
- persistência de sinais;
- metrics/traces ou evidência.

### Diagnóstico

A distinção ideal entre eles é:

- `observability/` = medir, correlacionar, diagnosticar operação;
- `audit/` = registrar, reter e governar evidência relevante.

### Risco real

Se essa distinção não for reafirmada continuamente, os dois módulos tendem a virar “quase a mesma
coisa” com nomes diferentes.

## 6.2 `observability/` vs `logs/`

### Situação atual

`logs/` existe como artefato dentro de `src/copilot`.

### Diagnóstico

A existência de uma pasta de artefatos dentro da árvore de código pode induzir confusão de estatuto:

- o módulo observável define como se observa;
- `logs/` apenas armazena ou representa subproduto dessa observação.

### Situação ideal

`logs/` deve ser tratado como localização/artefato, não como domínio arquitetural com autonomia.

## 6.3 `audit/` vs `logs/`

### Situação atual

`audit/` tem JSONL writer e buffers; `logs/` contém artefatos de execução.

### Diagnóstico

É necessário manter claro que:

- `audit/` é código com missão de governança/evidência;
- `logs/` é material de saída/artefato e não deve ser tratado como owner da trilha.

---

## 7. Situação ideal TO-BE para o eixo observável

## 7.1 Missão ideal de `observability/`

Responder:

> **como o sistema mede, correlaciona, rastreia e diagnostica o runtime sem redefinir sua
> semântica?**

### Responsabilidades legítimas

- logger central;
- metric stores;
- event collector;
- tracing/OTel;
- correlation e bootstrap observável;
- listeners e observers de sinais estabilizados.

### Responsabilidades ilegítimas

- tradução do SDK;
- ownership de eventos de domínio;
- policy de runtime;
- audit trail de governança como missão central.

## 7.2 Missão ideal de `audit/`

Responder:

> **como decisões e eventos relevantes para governança/compliance/evidência são retidos e
> auditados?**

### Responsabilidades legítimas

- pipeline de auditoria;
- buffers e retenção de eventos auditáveis;
- writer estruturado;
- trilha de permissão/tool/compliance.

### Responsabilidades ilegítimas

- substituir a observabilidade operacional;
- ser logger genérico do sistema;
- reinterpretar o runtime em paralelo;
- virar owner do pipeline de eventos global.

## 7.3 Papel ideal de `logs/`

`logs/` não é um domínio. É um artefato.

### Consequência arquitetural

A médio prazo, deve ser tratado como:

- localização de output;
- concern operacional de filesystem;
- e talvez até candidato à relocação para fora de `src/copilot`.

---

## 8. Riscos estruturais específicos

## 8.1 `observability/` virar semântica paralela do sistema

Isso já é explicitamente proibido pela própria documentação e deve continuar assim.

### Sinal de regressão

- parse adicional de `SessionEvent` cru dentro de `observability/`;
- reinterpretação de status/runtime fora de `event-handlers/` e `agent/`.

## 8.2 `audit/` virar logger genérico

### Sinal de regressão

Toda preocupação de log, retenção e trilha passa a ser jogada em `audit/` sem distinção entre:

- operação;
- depuração;
- governança;
- compliance.

## 8.3 `logs/` permanecer semanticamente “dentro” do sistema

Arquiteturalmente, logs persistidos não deveriam ter o mesmo estatuto de um módulo de código.

---

## 9. Decisões preliminares desta etapa

1. **`observability/` parece hoje um módulo relativamente saudável e consciente de seu papel**.
2. **`audit/` parece legítimo, mas é o ponto que mais precisa de formulação explícita contra overlap
   com observabilidade**.
3. **`logs/` deve ser tratado como artefato/runtime residue e não como módulo arquitetural de mesmo
   nível**.
4. **A ligação entre `sdk/telemetry/operation-metrics.js` e `observability/bootstrap.js` é um
   exemplo muito bom de crossing entre camadas feito na direção certa**.
5. **O eixo observável precisa de uma matriz futura específica separando: medir, registrar, auditar,
   persistir, correlacionar e expor**.

---

## 10. Conclusão desta etapa

A conclusão principal é esta:

> o sistema já parece distinguir razoavelmente bem entre observar e executar, mas ainda precisa
> distinguir melhor entre **observar** e **auditar**, e precisa rebaixar `logs/` ao seu estatuto
> correto de artefato.

Em resumo:

- `observability/` deve continuar sendo consumer/correlator operacional;
- `audit/` deve continuar sendo trilha/governança/evidência;
- `logs/` devem deixar de competir semanticamente com código-dominio.
