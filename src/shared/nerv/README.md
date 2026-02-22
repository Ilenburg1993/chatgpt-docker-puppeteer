# NERV Protocol — Linguagem Universal

**Versão**: 2.0.0  
**Status**: CONSTITUTIONAL (Singularity Edition)  
**Audit Level**: 500-520

---

## 📋 VISÃO GERAL

Este diretório contém a **linguagem universal** para comunicação entre todos os subsistemas da
aplicação. É o **protocolo canônico** que substitui completamente o antigo IPC legado.

**Princípio arquitetural**:

> "O NERV deve sempre, necessariamente, ser o 'veículo de transporte' de todo o sistema."

**Todos os subsistemas** (KERNEL, DRIVER, SERVER, INFRA) comunicam-se **exclusivamente** através de
envelopes NERV, sem acoplamento direto.

---

## 📦 COMPONENTES

### [`constants.js`](constants.js) (127 LOC)

**Audit Level 500** — Vocabulário canônico

Define a gramática formal do protocolo:

#### **MessageType** (Ontologia)

- `COMMAND` — Intenção declarada de ação futura
- `EVENT` — Observação registrada de algo ocorrido
- `ACK` — Confirmação técnica de transporte

#### **ActionCode** (Semântica extensível)

Exemplos:

- `TASK_START`, `TASK_CANCEL`, `TASK_OBSERVED`
- `DRIVER_ANOMALY`, `DRIVER_STATE_OBSERVED`
- `TRANSPORT_TIMEOUT`, `CHANNEL_DEGRADED`

**Extensibilidade**: Novos ActionCodes podem ser adicionados sem quebrar o protocolo.

#### **ActorRole** (Identidade)

- `KERNEL` — Núcleo decisório
- `SERVER` — Dashboard/API HTTP/WebSocket
- `INFRA` — Browser pool, filesystem, network
- `OBSERVER` — Telemetria passiva

#### **PROTOCOL_VERSION**

Versão explícita: `'2.0.0'`

---

### [`envelope.js`](envelope.js) (166 LOC)

**Audit Level 510** — Factory canônico

#### **createEnvelope(params)**

Constrói um envelope **imutável** (deepFreeze) com 5 blocos estruturais:

```javascript
const envelope = createEnvelope({
  actor: ActorRole.KERNEL,         // Quem emite
  target: ActorRole.DRIVER,        // Para quem (null = broadcast)
  messageType: MessageType.COMMAND,
  actionCode: ActionCode.TASK_START,
  payload: { taskId, prompt },     // Dados semânticos
  correlationId: '...'             // Opcional: rastreamento causal
});

// Estrutura resultante:
{
  protocol: { version: '2.0.0', timestamp: 1737329146000 },
  identity: { actor: 'KERNEL', target: 'DRIVER' },
  causality: { msg_id: 'uuid-v4', correlation_id: 'uuid-v4' },
  type: { message_type: 'COMMAND', action_code: 'TASK_START' },
  payload: { taskId: 'task-001', prompt: 'Hello' }
}
```

**Garantias**:

- ✅ **Imutabilidade total** (Object.freeze recursivo)
- ✅ **Validação constitucional** (assertions rígidas)
- ✅ **Zero inferência** (todos os campos explícitos)
- ✅ **Rastreamento causal** (msg_id + correlation_id automáticos)

---

### [`schemas.js`](schemas.js) (162 LOC)

**Audit Level 520** — Validação constitucional

#### **Funções de validação**:

- `validateStructure(envelope)` — Verifica blocos obrigatórios
- `validateOntology(envelope)` — Valida MessageType/ActionCode/ActorRole
- `validateEnvelope(envelope)` — Validação completa (estrutura + ontologia)
- `isEnvelopeValid(envelope)` — Retorna boolean sem lançar exceção

**Guardas rígidas**:

- Protocol version obrigatório (`'2.0.0'`)
- UUIDs válidos (regex v4)
- ActorRole/ActionCode existentes no vocabulário
- Payload sempre objeto simples (não array, não null)
- ACK sem payload semântico

---

## 🎯 USO NO CÓDIGO

### **Import do protocolo**:

```javascript
const { MessageType, ActionCode, ActorRole } = require('../shared/nerv/constants');
const { createEnvelope } = require('../shared/nerv/envelope');
const { validateEnvelope } = require('../shared/nerv/schemas');
```

### **Criar envelope**:

```javascript
const envelope = createEnvelope({
  actor: ActorRole.KERNEL,
  target: ActorRole.DRIVER,
  messageType: MessageType.COMMAND,
  actionCode: ActionCode.TASK_START,
  payload: { taskId: 'task-001', prompt: 'Pesquise sobre IA' },
});
```

### **Validar envelope**:

```javascript
try {
  validateEnvelope(envelope);
  console.log('Envelope válido!');
} catch (error) {
  console.error('[PROTOCOL VIOLATION]', error.message);
}
```

---

## 🔒 PRINCÍPIOS CONSTITUCIONAIS

### **1. Imutabilidade**

Envelopes são **imutáveis** após criação. Modificações exigem novo envelope.

### **2. Explicitness**

Nenhum campo inferido. Tudo explícito:

- ❌ `target` padrão (`null`)
- ❌ `correlationId` padrão (gerado internamente)
- ✅ `actor`, `messageType`, `actionCode` obrigatórios

### **3. Validação Antecipada**

Erros detectados na **criação** (createEnvelope), não no transporte.

### **4. Rastreamento Causal**

- `msg_id`: UUID único do envelope
- `correlation_id`: UUID da conversa/workflow
  - Se omitido, `correlation_id = msg_id` (início de cadeia)

### **5. Extensibilidade Controlada**

- MessageType: **fechado** (3 tipos apenas)
- ActionCode: **extensível** (adicionar sem quebrar)
- ActorRole: **semi-aberto** (novos atores via revisão arquitetural)

---

## 📐 SEPARAÇÃO DE RESPONSABILIDADES

### **shared/nerv/** (ESTE DIRETÓRIO)

**O QUÊ comunicar** — Linguagem universal

- Vocabulário (constants.js)
- Estrutura (envelope.js)
- Validação (schemas.js)

### **src/nerv/** (TRANSPORTE)

**COMO comunicar** — Especificidades de transporte

- Hybrid transport (local + Socket.io)
- Buffering (inbound/outbound queues)
- Correlation tracking
- Telemetria técnica
- Health monitoring

**Analogia**:

```
HTTP (protocolo) ≠ TCP (transporte)
NERV Protocol   ≠ NERV Transport
```

---

## 🚀 HISTÓRICO DE MIGRAÇÃO

### **Fase 1: Rename (2026-01-19)**

```bash
mv src/shared/ipc src/shared/nerv
```

### **Fase 2: Delete redundante**

```bash
rm -rf src/nerv/envelopes  # Protocolo inferior deletado
```

### **Fase 3: Unificação de imports**

- ❌ `shared/ipc/*` (antigo)
- ❌ `shared/ipcNEWOLD/*` (inconsistente)
- ✅ `shared/nerv/*` (único protocolo)

**Resultado**: **18 arquivos** migrados, **0 imports antigos** restantes.

---

## ✅ VALIDAÇÃO

### **Sintaxe**:

```bash
node -c src/shared/nerv/constants.js
node -c src/shared/nerv/envelope.js
node -c src/shared/nerv/schemas.js
```

### **Runtime**:

```bash
node -e "
const {createEnvelope} = require('./src/shared/nerv/envelope');
const {MessageType, ActionCode, ActorRole} = require('./src/shared/nerv/constants');

const env = createEnvelope({
  actor: ActorRole.KERNEL,
  messageType: MessageType.COMMAND,
  actionCode: ActionCode.TASK_START,
  payload: { taskId: 'test-001' }
});

console.log('Protocol:', env.protocol.version);
console.log('Imutável:', Object.isFrozen(env));
"
```

---

## 📚 DOCUMENTAÇÃO RELACIONADA

- [`ARCHITECTURE.md`](../../DOCUMENTAÇÃO/ARCHITECTURE.md) — Visão geral do sistema
- [`src/nerv/README.md`](../../nerv/README.md) — Especificidades do transporte NERV
- [`src/main.js`](../../main.js) — Boot sequence usando NERV

---

## 🔍 AUDITORIA

**Audit Level**: 500-520 (CONSTITUTIONAL)  
**Autor**: Sistema consolidado (Singularity Edition)  
**Data**: 2026-01-19  
**Status**: ✅ Operacional e validado  
**Imports ativos**: 18 arquivos no codebase
