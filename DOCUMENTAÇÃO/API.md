# API Documentation

## REST API Endpoints

Base URL: `http://localhost:3008`

---

## Health & Status

### GET /api/health

Health check endpoint for monitoring.

**Response:**

```json
{
    "status": "ok",
    "timestamp": "2026-01-19T12:00:00.000Z",
    "uptime": 3600,
    "chrome": {
        "connected": true,
        "endpoint": "ws://host.docker.internal:9222"
    },
    "queue": {
        "pending": 5,
        "running": 1,
        "completed": 42
    }
}
```

**Status Codes:**

- `200` - System healthy
- `503` - System degraded

---

## Tasks

### POST /api/tasks

Create a new task.

**Request Body:**

```json
{
    "id": "task-001",
    "target": "chatgpt",
    "prompt": "Explain quantum computing in simple terms",
    "validation": {
        "minLength": 100,
        "maxLength": 5000,
        "forbiddenTerms": []
    },
    "metadata": {
        "priority": "normal",
        "tags": ["science", "education"]
    }
}
```

**Response:**

```json
{
    "success": true,
    "taskId": "task-001",
    "queuePosition": 3,
    "estimatedStart": "2026-01-19T12:05:00.000Z"
}
```

**Status Codes:**

- `201` - Task created
- `400` - Invalid task schema
- `409` - Task ID already exists

---

### GET /api/tasks

List all tasks.

**Query Parameters:**

- `status` - Filter by status (pending|running|done|failed)
- `limit` - Max results (default: 50)
- `offset` - Pagination offset (default: 0)

**Response:**

```json
{
    "tasks": [
        {
            "id": "task-001",
            "target": "chatgpt",
            "status": "running",
            "createdAt": "2026-01-19T12:00:00.000Z",
            "startedAt": "2026-01-19T12:01:30.000Z"
        }
    ],
    "total": 48,
    "limit": 50,
    "offset": 0
}
```

---

### GET /api/tasks/:taskId

Get specific task details.

**Response:**

```json
{
    "id": "task-001",
    "target": "chatgpt",
    "prompt": "Explain quantum computing...",
    "status": "done",
    "result": "Quantum computing is...",
    "createdAt": "2026-01-19T12:00:00.000Z",
    "startedAt": "2026-01-19T12:01:30.000Z",
    "completedAt": "2026-01-19T12:03:45.000Z",
    "duration": 135000,
    "retries": 0,
    "validation": {
        "passed": true,
        "length": 1234
    }
}
```

**Status Codes:**

- `200` - Task found
- `404` - Task not found

---

### DELETE /api/tasks/:taskId

Cancel/delete a task.

**Response:**

```json
{
    "success": true,
    "message": "Task task-001 cancelled"
}
```

**Status Codes:**

- `200` - Task cancelled
- `404` - Task not found
- `409` - Task already completed

---

## Queue Management

### GET /api/queue/status

Get queue statistics.

**Response:**

```json
{
    "stats": {
        "pending": 5,
        "running": 2,
        "done": 42,
        "failed": 3,
        "total": 52
    },
    "queue": {
        "size": 7,
        "oldestTask": "2026-01-19T10:00:00.000Z",
        "newestTask": "2026-01-19T12:00:00.000Z"
    },
    "workers": {
        "active": 2,
        "idle": 0,
        "maxConcurrency": 3
    }
}
```

---

### POST /api/queue/clear

Clear all pending tasks.

**Request Body:**

```json
{
    "confirm": true,
    "preserveRunning": true
}
```

**Response:**

```json
{
    "success": true,
    "removed": 5,
    "preserved": 2
}
```

---

## Configuration

### GET /api/config

Get current configuration.

**Response:**

```json
{
    "target": "chatgpt",
    "maxRetries": 3,
    "timeout": 30000,
    "logLevel": "info",
    "chrome": {
        "endpoint": "ws://host.docker.internal:9222"
    }
}
```

---

### PUT /api/config

Update configuration (hot reload).

**Request Body:**

```json
{
    "maxRetries": 5,
    "timeout": 45000
}
```

**Response:**

```json
{
    "success": true,
    "updated": ["maxRetries", "timeout"],
    "reloadRequired": false
}
```

---

## WebSocket Events

Connect to: `ws://localhost:3008`

### Client → Server

#### subscribe

Subscribe to task updates.

```json
{
    "event": "subscribe",
    "taskId": "task-001"
}
```

#### unsubscribe

Unsubscribe from task updates.

```json
{
    "event": "unsubscribe",
    "taskId": "task-001"
}
```

---

### Server → Client

#### task:created

```json
{
    "event": "task:created",
    "data": {
        "taskId": "task-001",
        "queuePosition": 3
    }
}
```

#### task:started

```json
{
    "event": "task:started",
    "data": {
        "taskId": "task-001",
        "startedAt": "2026-01-19T12:01:30.000Z"
    }
}
```

#### task:progress

```json
{
    "event": "task:progress",
    "data": {
        "taskId": "task-001",
        "progress": 45,
        "message": "Processing response..."
    }
}
```

#### task:completed

```json
{
    "event": "task:completed",
    "data": {
        "taskId": "task-001",
        "status": "done",
        "result": "Quantum computing is...",
        "duration": 135000
    }
}
```

#### task:failed

```json
{
    "event": "task:failed",
    "data": {
        "taskId": "task-001",
        "error": "Timeout after 30s",
        "retries": 3,
        "willRetry": false
    }
}
```

#### queue:updated

```json
{
    "event": "queue:updated",
    "data": {
        "pending": 4,
        "running": 2
    }
}
```

---

## Task Schema

### Task Object

```typescript
interface Task {
    id: string; // Unique identifier
    target: 'chatgpt' | 'gemini'; // LLM target
    prompt: string; // Input prompt
    status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
    result?: string; // Output (when completed)

    // Validation rules
    validation?: {
        minLength?: number; // Min response length
        maxLength?: number; // Max response length
        forbiddenTerms?: string[]; // Terms that fail validation
    };

    // Metadata
    metadata?: {
        priority?: 'low' | 'normal' | 'high';
        tags?: string[];
        userId?: string;
    };

    // Timestamps
    createdAt: string;
    startedAt?: string;
    completedAt?: string;

    // Execution data
    duration?: number; // ms
    retries?: number;
    failureReason?: string;
}
```

---

## Error Responses

All error responses follow this format:

```json
{
    "error": true,
    "code": "INVALID_TASK",
    "message": "Task validation failed",
    "details": {
        "field": "prompt",
        "reason": "Prompt cannot be empty"
    }
}
```

### Error Codes

- `INVALID_TASK` - Task schema validation failed
- `TASK_NOT_FOUND` - Task ID doesn't exist
- `TASK_CONFLICT` - Task ID already exists
- `QUEUE_FULL` - Queue has reached max capacity
- `CHROME_DISCONNECTED` - Chrome connection lost
- `TIMEOUT` - Operation exceeded timeout
- `VALIDATION_FAILED` - Response validation failed
- `INTERNAL_ERROR` - Unexpected server error

---

## Rate Limits

- **Tasks Creation**: 100 requests/minute
- **Queue Operations**: 50 requests/minute
- **Config Updates**: 10 requests/minute

Rate limit headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642598400
```

---

## Authentication

Currently no authentication required. For production:

1. Implement API keys
2. Use JWT tokens
3. Configure in `.env`: `API_KEY=your-secret-key`

---

## Examples

### cURL Examples

**Create Task:**

```bash
curl -X POST http://localhost:3008/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "id": "task-001",
    "target": "chatgpt",
    "prompt": "What is AI?"
  }'
```

**Get Task Status:**

```bash
curl http://localhost:3008/api/tasks/task-001
```

**Queue Status:**

```bash
curl http://localhost:3008/api/queue/status
```

### JavaScript Example

```javascript
// Create task
const response = await fetch('http://localhost:3008/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        id: 'task-001',
        target: 'chatgpt',
        prompt: 'Explain AI'
    })
});

const result = await response.json();
console.log(result);
```

### WebSocket Example

```javascript
const socket = io('http://localhost:3008');

socket.on('connect', () => {
    socket.emit('subscribe', { taskId: 'task-001' });
});

socket.on('task:progress', data => {
    console.log(`Progress: ${data.progress}%`);
});

socket.on('task:completed', data => {
    console.log('Result:', data.result);
});
```

---

## SDK (Future)

Coming soon:

- Node.js SDK
- Python SDK
- REST client libraries
