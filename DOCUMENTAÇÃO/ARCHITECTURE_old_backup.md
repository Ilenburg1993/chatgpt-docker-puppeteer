# Architecture Guide

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   CHATGPT-DOCKER-PUPPETEER                  │
│           Autonomous LLM Control Agent System               │
└─────────────────────────────────────────────────────────────┘

┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   Clients   │─────▶│   Dashboard  │◀─────│  Socket.io  │
│  (HTTP/WS)  │      │   (Express)  │      │  (Real-time)│
└─────────────┘      └──────┬───────┘      └─────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Execution   │
                     │    Engine    │
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
       ┌───────────┐ ┌───────────┐ ┌───────────┐
       │  Queue    │ │  Drivers  │ │   NERV    │
       │  Manager  │ │  Factory  │ │   (IPC)   │
       └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
             │             │             │
             ▼             ▼             ▼
       ┌─────────────────────────────────────┐
       │         Infrastructure Layer        │
       │  (Locks, Cache, File I/O, State)    │
       └─────────────────────────────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │   Puppeteer  │
                     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ Chrome (Host)│
                     │   Port 9222  │
                     └──────┬───────┘
                            │
                            ▼
                   ┌────────────────────┐
                   │   LLM Websites     │
                   │ ChatGPT / Gemini   │
                   └────────────────────┘
```

---

## Core Components

### 1. Execution Engine (`src/core/execution_engine.js`)

**Responsibility:** Main task processing loop

**Key Features:**

- Adaptive backoff strategy
- Incremental response collection
- Quality validation
- Failure classification
- Memory management (GC triggers)

**Flow:**

```javascript
while (true) {
    task = queue.getNext();
    driver = factory.getDriver(task.target);
    result = await driver.execute(task);
    validator.validate(result);
    queue.markComplete(task);
}
```

---

### 2. Driver System (`src/driver/`)

**Responsibility:** Target-specific automation

**Architecture:**

```
BaseDriver (abstract)
   ├── TargetDriver (template)
   └── ChatGPTDriver (concrete)
       ├── Analyzer
       ├── InputResolver
       ├── SubmissionController
       ├── BiomechanicsEngine
       └── RecoverySystem
```

**Key Modules:**

- **Analyzer**: DOM element detection
- **InputResolver**: Text input handling
- **SubmissionController**: Form submission logic
- **BiomechanicsEngine**: Human-like interactions
- **RecoverySystem**: Error recovery and retries
- **Stabilizer**: Wait for page stability
- **FrameNavigator**: iframe handling

---

### 3. NERV System (`src/nerv/`)

**Responsibility:** Inter-Process Communication

**Components:**

```
Transport Layer
   ├── Connection (WebSocket)
   ├── Framing (Protocol)
   └── Reconnect (Resilience)

Message Layer
   ├── Emission (Send)
   ├── Reception (Receive)
   └── Normalizer (Validation)

Buffering Layer
   ├── Inbound Queue
   ├── Outbound Queue
   └── Backpressure Control

Correlation Layer
   ├── Context Management
   └── Request/Response Matching
```

**Protocol:**

- WebSocket-based
- Envelope format with schemas
- Acknowledgment system
- Telemetry integration

---

### 4. Queue System (`src/infra/queue/`)

**Responsibility:** Task persistence and scheduling

**Components:**

- **TaskStore**: JSON file-based persistence
- **Cache**: Reactive in-memory cache
- **Scheduler**: Priority-based scheduling
- **QueryEngine**: Task queries and filters

**File Structure:**

```
fila/
├── task-001.json        # Pending task
├── task-002.json.tmp.PID.timestamp  # Locked
└── corrupted/           # Failed validation
```

**Locking:**

- PID-based locks
- Orphan detection (process liveness check)
- Atomic operations

---

### 5. Kernel System (`src/kernel/`)

**Responsibility:** Task lifecycle management

**Components:**

- **KernelLoop**: Main execution loop
- **TaskExecutor**: Task execution wrapper
- **ObservationStore**: State tracking
- **PolicyEngine**: Rule enforcement
- **StatePersistence**: State snapshots

**States:**

```
PENDING → RUNNING → DONE
             ↓
          FAILED → RETRY → RUNNING
             ↓
          DEAD (max retries)
```

---

### 6. Infrastructure (`src/infra/`)

**Responsibility:** Core services

**Modules:**

- **LockManager**: Process synchronization
- **ProcessGuard**: PID validation
- **AtomicWrite**: Safe file writes
- **SafeRead**: Resilient file reads
- **DNAStore**: Agent identity
- **ResponseStore**: Result persistence
- **ControlStore**: Runtime controls

---

## Data Flow

### Task Creation

```
1. User/API → POST /api/tasks
2. Schema Validation (Zod)
3. Write to fila/task-{id}.json
4. Emit task:created event
5. Queue cache invalidated
```

### Task Processing

```
1. Engine polls queue
2. Acquire lock (PID-based)
3. Load driver for target
4. Connect to Chrome (Puppeteer)
5. Execute automation
6. Collect response incrementally
7. Validate response
8. Save to respostas/
9. Release lock
10. Emit task:completed
```

### Error Handling

```
1. Exception caught
2. Classify failure (task vs infra)
3. Increment retry counter
4. Apply backoff strategy
5. Generate forensics dump
6. Update task status
7. Emit task:failed
```

---

## Design Patterns

### 1. Factory Pattern

```javascript
// src/driver/factory.js
const driver = DriverFactory.create(targetName);
```

### 2. Observer Pattern

```javascript
// WebSocket events
socket.on('task:progress', handler);
```

### 3. Strategy Pattern

```javascript
// Validation rules
const validator = new Validator(task.validation);
```

### 4. Template Method

```javascript
// BaseDriver defines flow
class TargetDriver extends BaseDriver {
    async execute() {
        /* implementation */
    }
}
```

### 5. Circuit Breaker

```javascript
// Infra failure handling
if (consecutiveFailures > threshold) {
    cooldown(exponentialBackoff);
}
```

---

## Scalability

### Horizontal Scaling

```
┌─────────┐   ┌─────────┐   ┌─────────┐
│ Agent 1 │   │ Agent 2 │   │ Agent 3 │
└────┬────┘   └────┬────┘   └────┬────┘
     │             │             │
     └─────────────┼─────────────┘
                   │
            ┌──────▼──────┐
            │ Shared Queue│
            │  (Network)  │
            └─────────────┘
```

**Implementation:**

- Replace file-based queue with Redis/RabbitMQ
- Shared lock manager (Redis locks)
- Distributed state (database)

### Vertical Scaling

- Increase PM2 instances
- Adjust resource limits
- Optimize memory (GC tuning)

---

## Security

### 1. Browser Isolation

- Separate Chrome profile per agent
- No personal data in automation profile
- Remote debugging on localhost only

### 2. File System

- Locked file operations
- PID validation
- Atomic writes

### 3. Network

- Dashboard on localhost (production: reverse proxy)
- No external API exposure
- Rate limiting on endpoints

### 4. Secrets

- Environment variables only
- No hardcoded credentials
- .env in .gitignore

---

## Performance

### Bottlenecks

1. **Chrome startup**: ~2-3s (reuse connections)
2. **Page load**: Variable (wait strategies)
3. **File I/O**: Minimize with caching
4. **JSON parsing**: Use streams for large files

### Optimizations

- Connection pooling (Puppeteer)
- Reactive cache (invalidate on change)
- Incremental response collection
- Lazy loading of drivers
- WeakMap for browser instances

---

## Monitoring

### Metrics

- Task throughput (tasks/hour)
- Success rate (%)
- Average execution time (ms)
- Queue size
- Failure reasons

### Logging

```
[2026-01-19T12:00:00.000Z] INFO [task-001] >>> Processando tarefa
[2026-01-19T12:00:02.500Z] DEBUG [task-001] [LIFECYCLE] Adquirindo driver
[2026-01-19T12:00:15.000Z] INFO [task-001] Resposta coletada: 1234 chars
[2026-01-19T12:00:15.100Z] INFO [task-001] ✓ Tarefa concluída em 15.1s
```

### Health Checks

- Chrome connection status
- Queue size thresholds
- Memory usage
- Uptime

---

## Deployment

### Development

```bash
npm run dev
# nodemon with hot reload
```

### Production (PM2)

```bash
npm run daemon:start
# ecosystem.config.js
# - Agent process
# - Dashboard process (if separate)
# - Auto-restart on crash
# - Memory limits
```

### Docker

```bash
docker-compose up
# See DOCKER_SETUP.md
```

---

## Extension Points

### Adding New LLM Targets

1. Create driver: `src/driver/targets/NewLLMDriver.js`
2. Extend TargetDriver
3. Implement automation logic
4. Register in factory
5. Add tests

### Custom Validation

1. Define rules in `dynamic_rules.json`
2. Extend `src/logic/validator.js`
3. Hot-reload supported

### Custom Protocols

1. Implement in `src/nerv/`
2. Define schema
3. Add emission/reception handlers

---

## Future Enhancements

- [ ] Redis-based queue (distributed)
- [ ] GraphQL API
- [ ] Multi-tenancy
- [ ] Advanced analytics dashboard
- [ ] Machine learning for response quality
- [ ] Plugin system for drivers
- [ ] gRPC for inter-agent communication
- [ ] Kubernetes deployment manifests

---

## References

- **Puppeteer**: https://pptr.dev/
- **Socket.io**: https://socket.io/docs/
- **PM2**: https://pm2.keymetrics.io/docs/
- **Zod**: https://zod.dev/
