# 🔍 ANÁLISE ARQUITETURAL: NERV Envelope & Constants

**Data**: 2026-01-20 **Status**: INCONSISTÊNCIAS CRÍTICAS DETECTADAS **Impacto**: Sistema em
produção vs Protocolo Canônico

---

## 📊 SITUAÇÃO ATUAL

### 1. INCONSISTÊNCIAS DE CONSTANTS

#### ActorRole - DIVERGÊNCIA CÓDIGO vs DEFINIÇÃO

**Definido em `constants.js`** (Canônico):

```javascript
const ActorRole = Object.freeze({
  KERNEL: 'KERNEL',
  SERVER: 'SERVER',
  INFRA: 'INFRA',
  OBSERVER: 'OBSERVER',
  // Explicitamente ausentes: DRIVER, DASHBOARD
});
```

**Usado no código real**:

- `ActorRole.MAESTRO` (policy_engine.js:120, 134) ❌ NÃO EXISTE
- `ActorRole.DRIVER` (driver_nerv_adapter.js:321) ❌ NÃO EXISTE

#### ActionCode - DIVERGÊNCIA CÓDIGO vs DEFINIÇÃO

**Definidos em `constants.js`**:

```javascript
(TASK_START,
  TASK_CANCEL,
  TASK_OBSERVED,
  TASK_FAILED_OBSERVED,
  DRIVER_ANOMALY,
  DRIVER_STATE_OBSERVED,
  TRANSPORT_TIMEOUT,
  TRANSPORT_RETRYING,
  CHANNEL_DEGRADED,
  ACK_RECEIVED);
```

**Usados no código real que NÃO EXISTEM**:

- `ActionCode.TASK_REJECTED` (policy_engine.js:123) ❌
- `ActionCode.TASK_FAILED` (policy_engine.js:137) ❌

#### MessageType - SEM PROBLEMAS

```javascript
COMMAND, EVENT, ACK ✅ (Correto, nenhum uso de QUERY encontrado)
```

---

### 2. VALIDAÇÃO correlationId - RESTRITIVA DEMAIS

**Código atual (`envelope.js:67-69`)**:

```javascript
if (correlationId !== null) {
  assertUUID(correlationId, 'correlationId');
}
```

**Problema**: Exige UUID mas código real usa strings arbitrárias:

```javascript
// policy_engine.js:124
correlationId: originalObs.correlation_id; // Pode ser qualquer string

// policy_engine.js:138
correlationId: task?.meta?.correlation_id; // Pode ser qualquer string

// driver/BaseDriver.js:71
correlationId: this.correlationId; // Pode ser qualquer string
```

**Propósito do correlationId**:

- "Fio de Ariadne" para rastrear conversas relacionadas
- Preservar contexto causal entre mensagens
- NÃO é ID primário (para isso existe `msg_id`)

---

## 🎯 DECISÕES NECESSÁRIAS

### Opção A: COMPLETAR O PROTOCOLO (Recomendado)

Adicionar constantes faltantes usadas pelo código:

```javascript
// Em constants.js - ActorRole
const ActorRole = Object.freeze({
  KERNEL: 'KERNEL',
  SERVER: 'SERVER',
  INFRA: 'INFRA',
  OBSERVER: 'OBSERVER',
  MAESTRO: 'MAESTRO', // ← ADICIONAR (usado por policy_engine)
  DRIVER: 'DRIVER', // ← ADICIONAR (usado por driver_nerv_adapter)
});

// Em constants.js - ActionCode
const ActionCode = Object.freeze({
  // ... existentes ...
  TASK_REJECTED: 'TASK_REJECTED', // ← ADICIONAR
  TASK_FAILED: 'TASK_FAILED', // ← ADICIONAR
  TASK_FAILED_OBSERVED: 'TASK_FAILED_OBSERVED', // ← Já existe, mas renomear?
});
```

### Opção B: REFATORAR O CÓDIGO

Adaptar policy_engine.js e driver_nerv_adapter.js para usar apenas constantes existentes.

**Problema**: Pode quebrar semântica do sistema.

---

## 🔧 CORREÇÃO correlationId

### Proposta 1: RELAXAR VALIDAÇÃO (Recomendado)

```javascript
// envelope.js - Permitir qualquer string
if (correlationId !== null) {
  assert(typeof correlationId === 'string', 'correlationId must be a string');
  assert(correlationId.length > 0, 'correlationId cannot be empty');
}
```

### Proposta 2: FORÇAR UUID EM TODO SISTEMA

```javascript
// Garantir que task.meta.correlation_id seja sempre UUID
// Atualizar todos os pontos que criam correlationId
```

**Problema**: Mudança massiva, alto risco.

---

## 📋 PLANO DE AÇÃO RECOMENDADO

### FASE 1: COMPLETAR PROTOCOLO (Baixo Risco)

1. ✅ Adicionar `MAESTRO` e `DRIVER` em `ActorRole`
2. ✅ Adicionar `TASK_REJECTED` e `TASK_FAILED` em `ActionCode`
3. ✅ Relaxar validação `correlationId` para aceitar strings

### FASE 2: ATUALIZAR TESTES

1. ✅ Corrigir `test_envelope.spec.js` para usar constantes reais
2. ✅ Manter testes de validação de constantes inválidas

### FASE 3: VALIDAR SISTEMA

1. ✅ Executar testes completos
2. ✅ Verificar que código real funciona

---

## 🚨 RISCOS IDENTIFICADOS

1. **ALTA SEVERIDADE**: Código usa constantes inexistentes
   - Sistema pode estar falhando silenciosamente
   - Mensagens podem não estar sendo validadas

2. **MÉDIA SEVERIDADE**: correlationId muito restritivo
   - Pode estar quebrando fluxos de correlação
   - Perda de rastreabilidade causal

3. **BAIXA SEVERIDADE**: Testes desatualizados
   - Testam protocolo que não corresponde ao código real

---

## 📝 NOTAS ARQUITETURAIS

### Por que correlationId deve ser opcional?

- Eventos novos (sem contexto prévio) não têm correlação
- Sistema usa `msg_id` como fallback automático
- Permite rastreamento sem acoplamento rígido

### Por que correlationId NÃO deve ser UUID?

- É um **identificador de contexto**, não de mensagem
- Pode ser reutilizado entre mensagens relacionadas
- Exemplo: `task-123-conversation` (mais legível que UUID)

---

## ✅ RECOMENDAÇÃO FINAL

**COMPLETAR O PROTOCOLO** (Opção A) é a solução correta:

- Menor risco (adiciona sem quebrar)
- Mantém semântica do código real
- Protocolo reflete realidade do sistema
- Testes passam a validar código real
