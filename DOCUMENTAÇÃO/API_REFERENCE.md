# 🌐 Referência de API

**Versão**: 1.0
**Última Atualização**: 21/01/2026
**Público-Alvo**: Desenvolvedores, integradores
**Tempo de Leitura**: ~35 min

---

## 📖 Visão Geral

Este documento detalha **todos os endpoints REST e eventos WebSocket** do sistema `chatgpt-docker-puppeteer`, incluindo schemas, autenticação, rate limiting, e exemplos de uso.

**Base URL**: `http://localhost:3008`
**Protocol**: HTTP/1.1 + WebSocket
**Content-Type**: `application/json`

---

## 🔐 Autenticação

### Configuração

```json
{
  "dashboardPassword": "your-secret-password",
  "enableAuth": true
}
```

### Header de Autenticação

```http
Authorization: Bearer YOUR_PASSWORD
```

### Exemplo

```bash
curl -H "Authorization: Bearer my-secret" http://localhost:3008/api/health
```

**Nota**: Se `dashboardPassword` for `null`, autenticação é desabilitada.

---

## 🚦 Rate Limiting

**Default**: 100 requests / 60 segundos (por IP)

**Headers de Resposta**:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1737469350
```

**Response 429 (Too Many Requests)**:
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 45
}
```

---

## 📡 REST Endpoints

### 1. GET /api/health

**Descrição**: Health check básico do sistema

**Auth**: Opcional

**Request**:
```bash
curl http://localhost:3008/api/health
```

**Response 200**:
```json
{
  "status": "ok",
  "timestamp": 1737469250123,
  "uptime": 123456789,
  "components": {
    "nerv": "ok",
    "kernel": "ok",
    "browserPool": "ok",
    "server": "ok"
  },
  "version": "2.4.0"
}
```

**Response Schema (Zod)**:
```typescript
{
  status: 'ok' | 'degraded' | 'offline',
  timestamp: number,
  uptime: number,
  components: {
    nerv: string,
    kernel: string,
    browserPool: string,
    server: string
  },
  version: string
}
```

**Status Codes**:
- `200`: Sistema saudável
- `503`: Sistema degradado/offline

---

### 2. GET /api/health-metrics

**Descrição**: Métricas detalhadas de performance (P9.1)

**Auth**: Obrigatória

**Request**:
```bash
curl -H "Authorization: Bearer secret" \
  http://localhost:3008/api/health-metrics
```

**Response 200**:
```json
{
  "heap": {
    "used": 156789012,
    "total": 268435456,
    "limit": 536870912,
    "percentage": 29.2
  },
  "gc": {
    "lastRun": 1737469240000,
    "count": 15,
    "totalDuration": 450
  },
  "process": {
    "pid": 12345,
    "uptime": 123456,
    "cpu": 12.5,
    "memory": {
      "rss": 234567890,
      "heapUsed": 156789012,
      "external": 1234567
    }
  },
  "eventLoop": {
    "delay": 2.3,
    "utilization": 15.7
  }
}
```

**Schema**:
```typescript
{
  heap: {
    used: number,      // Bytes
    total: number,     // Bytes
    limit: number,     // Bytes
    percentage: number // 0-100
  },
  gc: {
    lastRun: number,      // Timestamp
    count: number,        // Total GC runs
    totalDuration: number // ms
  },
  process: {
    pid: number,
    uptime: number,       // seconds
    cpu: number,          // percentage
    memory: {
      rss: number,        // Resident Set Size
      heapUsed: number,
      external: number
    }
  },
  eventLoop: {
    delay: number,        // ms
    utilization: number   // percentage
  }
}
```

---

### 3. GET /api/metrics

**Descrição**: Métricas de cache e performance (P9.6)

**Auth**: Obrigatória

**Request**:
```bash
curl -H "Authorization: Bearer secret" \
  http://localhost:3008/api/metrics
```

**Response 200**:
```json
{
  "cache": {
    "hits": 1250,
    "misses": 45,
    "hitRate": 96.5,
    "size": 15,
    "lastScan": 1737469200000,
    "isDirty": false
  },
  "queue": {
    "pending": 8,
    "running": 3,
    "done": 142,
    "failed": 5,
    "total": 158
  },
  "nerv": {
    "totalEvents": 5234,
    "eventCounts": {
      "TASK_ALLOCATED": 158,
      "DRIVER_RESULT": 147,
      "TASK_STATE_CHANGE": 158,
      "QUEUE_CHANGE": 245
    },
    "avgLatencies": {
      "TASK_ALLOCATED": 3.2,
      "DRIVER_RESULT": 4.1
    },
    "bufferSizes": {
      "outbound": 0,
      "inbound": 0
    }
  },
  "browserPool": {
    "instances": 3,
    "healthy": 3,
    "degraded": 0,
    "crashed": 0,
    "activeTasks": 3,
    "totalAllocations": 158
  }
}
```

---

### 4. GET /api/queue

**Descrição**: Status atual da fila de tasks

**Auth**: Opcional

**Request**:
```bash
curl http://localhost:3008/api/queue
```

**Response 200**:
```json
{
  "queue": [
    {
      "id": "task-abc123",
      "target": "chatgpt",
      "state": "PENDING",
      "priority": 5,
      "createdAt": 1737469100000,
      "queuePosition": 1
    },
    {
      "id": "task-def456",
      "target": "gemini",
      "state": "RUNNING",
      "priority": 7,
      "createdAt": 1737469050000,
      "allocatedAt": 1737469200000
    }
  ],
  "summary": {
    "total": 15,
    "pending": 8,
    "running": 3,
    "done": 4,
    "failed": 0
  },
  "timestamp": 1737469250123
}
```

**Query Parameters**:
- `?state=PENDING` - Filtrar por estado
- `?target=chatgpt` - Filtrar por target
- `?limit=10` - Limitar resultados

---

### 5. POST /api/queue/add

**Descrição**: Adicionar nova task à fila

**Auth**: Obrigatória

**Request**:
```bash
curl -X POST \
  -H "Authorization: Bearer secret" \
  -H "Content-Type: application/json" \
  -d '{
    "target": "chatgpt",
    "prompt": "Explique event loop em Node.js",
    "priority": 5,
    "spec": {
      "validation": {
        "minLength": 100,
        "forbiddenTerms": ["error"]
      }
    }
  }' \
  http://localhost:3008/api/queue/add
```

**Request Body Schema**:
```typescript
{
  target: 'chatgpt' | 'gemini',  // Required
  prompt: string,                // Required, min 1 char
  priority?: number,             // Optional, 0-10, default 5
  spec?: {
    validation?: {
      minLength?: number,
      forbiddenTerms?: string[]
    }
  }
}
```

**Response 201**:
```json
{
  "taskId": "task-a3f9c2b1",
  "status": "PENDING",
  "queuePosition": 9,
  "estimatedWaitTime": 45000,
  "message": "Task added successfully"
}
```

**Response 400 (Validation Error)**:
```json
{
  "error": "Validation failed",
  "details": {
    "prompt": "Required field missing"
  }
}
```

**Response 429 (Rate Limit)**:
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 45
}
```

---

### 6. GET /api/task/:id

**Descrição**: Obter detalhes de uma task específica

**Auth**: Opcional

**Request**:
```bash
curl http://localhost:3008/api/task/task-abc123
```

**Response 200**:
```json
{
  "id": "task-abc123",
  "target": "chatgpt",
  "prompt": "Explique event loop...",
  "state": "DONE",
  "priority": 5,
  "createdAt": 1737469100000,
  "allocatedAt": 1737469200000,
  "completedAt": 1737469250000,
  "duration": 50000,
  "responseLength": 1234,
  "responsePreview": "Event loop é um mecanismo..."
}
```

**Response 404**:
```json
{
  "error": "Task not found",
  "taskId": "task-xyz"
}
```

---

### 7. POST /api/task/:id/cancel

**Descrição**: Cancelar task em execução

**Auth**: Obrigatória

**Request**:
```bash
curl -X POST \
  -H "Authorization: Bearer secret" \
  http://localhost:3008/api/task/task-abc123/cancel
```

**Response 200**:
```json
{
  "taskId": "task-abc123",
  "previousState": "RUNNING",
  "newState": "CANCELED",
  "message": "Task canceled successfully"
}
```

**Response 400 (Already Completed)**:
```json
{
  "error": "Cannot cancel task",
  "reason": "Task already completed",
  "state": "DONE"
}
```

---

### 8. GET /api/response/:id

**Descrição**: Obter resposta completa de uma task

**Auth**: Opcional

**Request**:
```bash
curl http://localhost:3008/api/response/task-abc123
```

**Response 200**:
```json
{
  "taskId": "task-abc123",
  "response": "Event loop é um mecanismo fundamental do Node.js que...\n\nConclusão: O event loop permite que Node.js seja altamente eficiente em operações I/O bound.",
  "length": 1234,
  "createdAt": 1737469250000
}
```

**Response 404**:
```json
{
  "error": "Response not found",
  "taskId": "task-abc123"
}
```

---

### 9. GET /api/stats

**Descrição**: Estatísticas agregadas do sistema

**Auth**: Opcional

**Request**:
```bash
curl http://localhost:3008/api/stats
```

**Response 200**:
```json
{
  "period": {
    "start": 1737382850123,
    "end": 1737469250123,
    "durationHours": 24
  },
  "tasks": {
    "total": 158,
    "done": 142,
    "failed": 5,
    "canceled": 1,
    "pending": 8,
    "running": 2,
    "successRate": 89.9
  },
  "performance": {
    "avgDuration": 48500,
    "minDuration": 32100,
    "maxDuration": 125000,
    "throughput": 6.58
  },
  "targets": {
    "chatgpt": {
      "total": 95,
      "done": 89,
      "failed": 2
    },
    "gemini": {
      "total": 63,
      "done": 53,
      "failed": 3
    }
  }
}
```

---

### 10. POST /api/system/restart

**Descrição**: Reiniciar sistema (graceful)

**Auth**: Obrigatória

**Request**:
```bash
curl -X POST \
  -H "Authorization: Bearer secret" \
  http://localhost:3008/api/system/restart
```

**Response 200**:
```json
{
  "message": "System restart initiated",
  "waitingTasks": 2,
  "estimatedDowntime": 10
}
```

---

## 🔌 WebSocket Events

**Connection URL**: `ws://localhost:3008`

### Client → Server

#### 1. authenticate

**Descrição**: Autenticar conexão WebSocket

**Payload**:
```json
{
  "type": "authenticate",
  "token": "your-secret-password"
}
```

**Response**:
```json
{
  "type": "auth:success",
  "sessionId": "550e8400-..."
}
```

---

#### 2. subscribe

**Descrição**: Inscrever-se em eventos específicos

**Payload**:
```json
{
  "type": "subscribe",
  "events": ["task:update", "system:status"]
}
```

**Response**:
```json
{
  "type": "subscribe:success",
  "events": ["task:update", "system:status"]
}
```

---

### Server → Client

#### 1. task:update

**Descrição**: Atualização de estado de task

**Payload**:
```json
{
  "type": "task:update",
  "taskId": "task-abc123",
  "state": "RUNNING",
  "timestamp": 1737469250123,
  "progress": {
    "phase": "collecting",
    "percentage": 75
  }
}
```

---

#### 2. task:completed

**Descrição**: Task concluída

**Payload**:
```json
{
  "type": "task:completed",
  "taskId": "task-abc123",
  "state": "DONE",
  "duration": 48500,
  "responseLength": 1234,
  "timestamp": 1737469250123
}
```

---

#### 3. system:status

**Descrição**: Status geral do sistema

**Payload**:
```json
{
  "type": "system:status",
  "status": "ok",
  "queue": {
    "pending": 8,
    "running": 3
  },
  "browserPool": {
    "healthy": 3,
    "degraded": 0
  },
  "timestamp": 1737469250123
}
```

---

#### 4. tasks:batch_update (P9.8 Debounced)

**Descrição**: Atualização em batch (50ms debounce)

**Payload**:
```json
{
  "type": "tasks:batch_update",
  "updates": [
    {
      "taskId": "task-abc",
      "state": "DONE"
    },
    {
      "taskId": "task-def",
      "state": "RUNNING"
    },
    {
      "taskId": "task-ghi",
      "state": "PENDING"
    }
  ],
  "count": 3,
  "timestamp": 1737469250123
}
```

---

## 📝 Exemplos de Uso

### JavaScript (fetch)

```javascript
// GET health
const response = await fetch('http://localhost:3008/api/health');
const data = await response.json();
console.log(data.status);

// POST add task
const response = await fetch('http://localhost:3008/api/queue/add', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer my-secret'
    },
    body: JSON.stringify({
        target: 'chatgpt',
        prompt: 'Hello GPT',
        priority: 5
    })
});
const { taskId } = await response.json();

// WebSocket
const ws = new WebSocket('ws://localhost:3008');

ws.onopen = () => {
    ws.send(JSON.stringify({
        type: 'authenticate',
        token: 'my-secret'
    }));

    ws.send(JSON.stringify({
        type: 'subscribe',
        events: ['task:update']
    }));
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log(data.type, data);
};
```

---

### Python (requests)

```python
import requests
import json

BASE_URL = 'http://localhost:3008'
AUTH_HEADER = {'Authorization': 'Bearer my-secret'}

# GET health
response = requests.get(f'{BASE_URL}/api/health')
print(response.json())

# POST add task
payload = {
    'target': 'chatgpt',
    'prompt': 'Explain async/await',
    'priority': 7
}
response = requests.post(
    f'{BASE_URL}/api/queue/add',
    headers={**AUTH_HEADER, 'Content-Type': 'application/json'},
    data=json.dumps(payload)
)
task_id = response.json()['taskId']

# GET task status
response = requests.get(f'{BASE_URL}/api/task/{task_id}')
print(response.json())
```

---

### curl (bash)

```bash
#!/bin/bash

BASE_URL="http://localhost:3008"
AUTH="Authorization: Bearer my-secret"

# Health check
curl -s "$BASE_URL/api/health" | jq .

# Add task
TASK_ID=$(curl -s -X POST \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"target":"chatgpt","prompt":"Hello","priority":5}' \
  "$BASE_URL/api/queue/add" | jq -r .taskId)

echo "Task ID: $TASK_ID"

# Poll status
while true; do
  STATE=$(curl -s "$BASE_URL/api/task/$TASK_ID" | jq -r .state)
  echo "State: $STATE"

  if [ "$STATE" = "DONE" ] || [ "$STATE" = "FAILED" ]; then
    break
  fi

  sleep 2
done

# Get response
curl -s "$BASE_URL/api/response/$TASK_ID" | jq -r .response
```

---

## 🛡️ Schemas de Validação

### TaskCreateSchema

```typescript
{
  target: z.enum(['chatgpt', 'gemini']),
  prompt: z.string().min(1).max(10000),
  priority: z.number().int().min(0).max(10).default(5),
  spec: z.object({
    validation: z.object({
      minLength: z.number().int().min(0).optional(),
      forbiddenTerms: z.array(z.string()).optional()
    }).optional()
  }).optional()
}
```

---

### TaskResponseSchema

```typescript
{
  id: z.string(),
  target: z.enum(['chatgpt', 'gemini']),
  prompt: z.string(),
  state: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELED']),
  priority: z.number(),
  createdAt: z.number(),
  allocatedAt: z.number().optional(),
  completedAt: z.number().optional(),
  duration: z.number().optional(),
  responseLength: z.number().optional()
}
```

---

## 📚 Referências

- [CONFIGURATION.md](CONFIGURATION.md) - Configuração de autenticação
- [DEPLOYMENT.md](DEPLOYMENT.md) - Deploy com HTTPS
- [SECURITY.md](SECURITY.md) - Políticas de segurança

---

*Última revisão: 21/01/2026 | Contribuidores: AI Architect, Backend Team*
