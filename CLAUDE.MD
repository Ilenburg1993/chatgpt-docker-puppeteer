# CLAUDE.MD - AI Assistant Guide

> **Quick Reference for AI Assistants working on chatgpt-docker-puppeteer**

## Project Overview

**chatgpt-docker-puppeteer** is a production-grade, autonomous AI agent system that automates browser-based interactions with Large Language Models (ChatGPT, Gemini, Claude) using Puppeteer. It features an event-driven architecture, web dashboard, and 24/7 autonomous operation capabilities.

### Key Statistics
- **~21,732 lines** of JavaScript code
- **135 JavaScript files** across 9+ core modules
- **32 test spec files** with comprehensive coverage
- **13+ architecture layers** with clear separation of concerns

---

## Quick Start for AI Assistants

### Essential Files to Read First
1. `src/main.js` - Application entry point and boot sequence
2. `config.json` - Global runtime configuration
3. `package.json` - Dependencies and npm scripts
4. `DOCUMENTAÇÃO/ARCHITECTURE.md` - System design overview

### Key Directories
```
src/
├── core/          # Config, logger, constants, identity, health
├── nerv/          # Central event bus (IPC/telemetry)
├── kernel/        # Task execution engine & orchestration
├── driver/        # Browser automation (Puppeteer adapters)
├── infra/         # Browser pool, queue, storage, locks
├── server/        # Express API + Socket.io dashboard
├── logic/         # Business logic & validation
└── state/         # State management
```

---

## Architecture Overview

### 6-Phase Boot Sequence
```
1. Config & Identity    → Load config.json, establish robot_id
2. NERV Initialization  → Event bus (local + Socket.io hybrid)
3. Browser Pool Setup   → Connect to 3x Chrome instances (port 9222)
4. Kernel Startup       → 20Hz execution loop, policy engine
5. Adapter Init         → Driver↔NERV & Server↔NERV bridges
6. Web Server Startup   → Express + Socket.io on port 3008
```

### Core Execution Flow
```
Task Queue (fila/*.json)
    ↓
Kernel Loop (20Hz) → Observation Store → Policy Engine
    ↓
Driver Execution (Puppeteer) → Browser Automation
    ↓
Results Storage (respostas/*.txt, controle.json)
```

### Communication Architecture
All components communicate via **NERV** (event bus):
- **SERVER** ↔ NERV ↔ **KERNEL** ↔ NERV ↔ **DRIVER** ↔ NERV ↔ **INFRA**

---

## Technology Stack

### Core Technologies
- **Runtime**: Node.js 20.19.2+ (CommonJS modules)
- **Browser Automation**: Puppeteer 24.35+, puppeteer-extra with stealth
- **Process Manager**: PM2 6.0+
- **Web Framework**: Express 4.22+
- **Real-time**: Socket.io 4.8+
- **Validation**: Zod 4.3.5

### Development Tools
- **Testing**: Node.js native test runner, c8 (coverage), sinon (mocking)
- **Linting**: ESLint 9.39+ with complexity plugins
- **Formatting**: Prettier 3.8.0 (120-char lines, 4-space indent)
- **Analysis**: madge (circular deps), jscodeshift (codemods)

### Infrastructure
- **Docker**: Multi-stage Dockerfile, docker-compose.yml
- **CI/CD**: GitHub Actions
- **DevContainer**: VS Code remote development

---

## Common Development Tasks

### Running the Application
```bash
npm start              # Start agent (development)
npm run daemon:start   # Start with PM2 (production)
npm run dev           # Development with nodemon
```

### Testing & Quality
```bash
npm test              # Run all tests
npm run test:coverage # Run tests with coverage report
npm run lint          # Check code quality
npm run format        # Auto-format with Prettier
```

### Queue Management
```bash
npm run queue:status  # Monitor task queue
npm run queue:add     # Create new task interactively
npm run queue:clear   # Clear task queue
```

### Analysis & Diagnostics
```bash
npm run diagnose      # System diagnostics
npm run analyze:deps  # Check circular dependencies
npm run clean         # Clear logs and temp files
```

### Docker Operations
```bash
make build            # Build Docker image
make up              # Start containers
make down            # Stop containers
make logs            # View logs
```

---

## Code Style & Patterns

### Design Patterns Used
1. **Event-Driven Architecture** - NERV event bus for zero-coupling
2. **Factory Pattern** - DriverFactory, KernelFactory for object creation
3. **Observer Pattern** - File watchers, health checks, telemetry
4. **Domain-Driven Design** - Distinct domains with bounded contexts

### File Organization
- **Module Pattern**: Each directory has an `index.js` as public interface
- **Private Modules**: Internal files prefixed with underscore (e.g., `_internal.js`)
- **Constants**: Centralized in `src/core/constants/` (recently refactored)
- **Tests**: Mirror source structure in `tests/` directory

### Coding Conventions
- **Indentation**: 4 spaces
- **Line Length**: 120 characters
- **Quotes**: Single quotes for strings
- **Semicolons**: Required
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Comments**: JSDoc style for public APIs

### Error Handling
- Domain-specific error classes
- Always log errors with context
- Graceful degradation preferred over crashes
- Use NERV for error event propagation

---

## Important Configuration Files

| File | Purpose | Location |
|------|---------|----------|
| `config.json` | Global runtime config (timeouts, concurrency, domains) | Root |
| `dynamic_rules.json` | Runtime policy rules (priorities, limits) | Root |
| `controle.json` | Application state/control metadata | Root |
| `chrome-config.json` | Chrome launch configuration | Root |
| `ecosystem.config.js` | PM2 process management | Root |
| `.env` | Environment variables (optional) | Root |

### Key Config Settings
- **Browser Mode**: headless/headful (config.json → puppeteer.headless)
- **Pool Size**: Chrome instance count (config.json → browser.poolSize, default: 3)
- **Server Port**: API/dashboard port (config.json → server.port, default: 3008)
- **Chrome Port**: Remote debugging port (default: 9222)
- **Kernel Loop**: Execution frequency (20Hz = 50ms interval)

---

## Testing Strategy

### Test Structure
```
tests/
├── unit/           # 60% - Fast, isolated component tests
├── integration/    # 30% - Cross-component interactions
└── e2e/           # 10% - Full workflow testing
```

### Coverage Goals
- **Lines**: 80%+
- **Branches/Functions**: 75%+
- **Statements**: 80%+

### Running Tests
```bash
npm test                    # All tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only
npm run test:coverage      # With coverage report
```

---

## Key Modules Deep Dive

### NERV (src/nerv/)
**Central event bus for inter-process communication**
- `nerv.js` - Factory and composition
- `buffers/` - Event buffering and ring buffers
- `transport/` - Socket.io and hybrid transport adapters
- `emission/` - Event publishing
- `reception/` - Event subscription and handling
- `correlation/` - Event correlation and tracing
- `telemetry/` - IPC performance metrics

**Usage Pattern**:
```javascript
const nerv = require('./nerv');
nerv.emit('task:started', { taskId: '123' });
nerv.on('task:completed', (data) => { /* handle */ });
```

### Kernel (src/kernel/)
**Decision engine and task orchestration**
- `kernel.js` - Main orchestrator
- `execution_engine/` - Task execution logic
- `kernel_loop/` - 20Hz control loop
- `observation_store/` - Fact registry from events
- `policy_engine/` - Policy enforcement
- `task_runtime/` - Task lifecycle management

**Execution Flow**: Queue → Policy Check → Execute → Emit Result

### Driver (src/driver/)
**Browser automation adapters**
- `ChatGPTDriver.js` - ChatGPT target automation
- `factory.js` - Driver factory pattern
- `modules/` - Shared modules (analyzer, stabilizer, human simulation)
- `targets/` - Target-specific implementations
- `nerv_adapter/` - Bridge to NERV

**Creating a New Driver**:
1. Extend base driver class
2. Implement required methods (connect, execute, disconnect)
3. Register in factory.js

### Infrastructure (src/infra/)
**Resource management layer**
- `browser_pool/` - Multi-instance Chrome management
- `ConnectionOrchestrator.js` - Connection management
- `queue/` - Task queue operations
- `fs/` - File system utilities
- `storage/` - Persistent storage
- `ipc/` - IPC client and envelope handling
- `locks/` - File-based locking

### Server (src/server/)
**Web API and real-time dashboard**
- `main.js` - Server bootstrap
- `api/` - REST API routes and controllers
- `engine/` - Core server components
- `realtime/` - Real-time features (PM2 bridge, log tailing, hardware telemetry)
- `supervisor/` - Reconciler and supervision logic
- `watchers/` - File system and log watchers

**API Endpoints**: See `DOCUMENTAÇÃO/API.md` for full reference

---

## Recent Changes & Active Development

### Current Branch
**`claude/update-claude-md-wvKC8`** - Creating/updating CLAUDE.MD

### Recent Refactoring (v1.0.0 → v1.1.0)
- ✅ Magic strings elimination via centralized constants
- ✅ Automated code transformation (codemods)
- ✅ Constants infrastructure (`src/core/constants/`)
- ✅ Code formatting (697 files with Prettier)
- ✅ Test cleanup (11 obsolete tests removed)

**Statistics**:
- 144 files modified
- 73 magic strings replaced
- 27 auto-injected imports

### Known Issues
- Some backup files in `backups/` have encoding issues (UTF-8 BOM)
- Legacy scripts in `scripts/legacy/` need documentation

---

## Git Workflow

### Branch Strategy
- **Main Branch**: Stable production code
- **Feature Branches**: `claude/*`, `feature/*`, `fix/*`
- **Current Branch**: `claude/update-claude-md-wvKC8`

### Commit Conventions
```
feat: Add new feature
fix: Bug fix
refactor: Code refactoring
chore: Maintenance tasks
docs: Documentation updates
test: Test updates
```

### Git Operations
```bash
# Always work on feature branches
git checkout -b claude/feature-name

# Commit with clear messages
git commit -m "feat: add new driver for Gemini"

# Push to remote
git push -u origin claude/feature-name
```

---

## Documentation Resources

### Primary Documentation (DOCUMENTAÇÃO/)
- `QUICK_START.md` - Setup in 10 minutes
- `ARCHITECTURE.md` - Detailed system design (150+ lines)
- `ARCHITECTURE_DIAGRAMS.md` - 11 C4 model diagrams
- `API.md` - REST API & WebSocket reference
- `CONFIGURATION.md` - All config options
- `DEPLOYMENT.md` - Production setup
- `SECURITY.md` - Security best practices
- `ROADMAP.md` - v1.0 planning

### Other Resources
- `README.md` - Project overview (if exists)
- Inline JSDoc comments in source code
- Test files as usage examples

---

## Troubleshooting Common Issues

### Browser Connection Issues
- Check Chrome is running on port 9222: `curl http://localhost:9222/json/version`
- Verify `chrome-config.json` settings
- Check logs in `logs/` directory

### Task Queue Not Processing
- Check kernel loop status: `npm run diagnose`
- Verify `fila/` directory permissions
- Review `controle.json` for state issues

### Server Won't Start
- Check port 3008 is available: `lsof -i :3008`
- Verify `config.json` syntax
- Check PM2 logs: `pm2 logs`

### Tests Failing
- Clear cache: `npm run clean`
- Reinstall dependencies: `rm -rf node_modules && npm install`
- Check Node.js version: `node --version` (should be 20.19.2+)

---

## Best Practices for AI Assistants

### Before Making Changes
1. ✅ Read relevant source files first
2. ✅ Check existing tests for usage patterns
3. ✅ Review DOCUMENTAÇÃO/ for context
4. ✅ Understand the event-driven architecture (NERV)
5. ✅ Check for similar implementations in the codebase

### When Writing Code
1. ✅ Follow existing code style (4 spaces, 120 char lines)
2. ✅ Use centralized constants from `src/core/constants/`
3. ✅ Add JSDoc comments for public APIs
4. ✅ Emit appropriate NERV events for observability
5. ✅ Handle errors gracefully with logging
6. ✅ Write tests for new functionality

### When Modifying Architecture
1. ✅ Update DOCUMENTAÇÃO/ARCHITECTURE.md
2. ✅ Consider impact on NERV event flow
3. ✅ Update tests accordingly
4. ✅ Check for circular dependencies: `npm run analyze:deps`
5. ✅ Run full test suite: `npm test`

### When Adding Dependencies
1. ✅ Check if functionality exists in codebase
2. ✅ Justify the addition (bundle size, maintenance)
3. ✅ Use exact versions in package.json
4. ✅ Update documentation

---

## Project Goals & Philosophy

### Design Principles
- **Zero-coupling via events** - Components communicate only through NERV
- **Fail gracefully** - Prefer degradation over crashes
- **Observable by default** - Emit events for all significant actions
- **Configuration over code** - Use config.json for behavior changes
- **Test-driven** - 80%+ coverage target

### Non-Goals
- ❌ Not a web scraping framework (focused on LLM automation)
- ❌ Not a general-purpose RPA tool (specialized for AI agents)
- ❌ Not browser-agnostic (optimized for Chromium via Puppeteer)

---

## Version Information

- **Current Version**: 1.1.0 (In Development)
- **Latest Stable**: 1.0.0 (2026-01-19)
- **Node.js**: 20.19.2+ LTS
- **npm**: 10.8.2+
- **PM2**: 6.0+

---

## Contact & Support

- **Repository**: https://github.com/Ilenburg1993/chatgpt-docker-puppeteer
- **Issues**: Report bugs and feature requests via GitHub Issues
- **Documentation**: See DOCUMENTAÇÃO/ directory

---

## Quick Command Reference

```bash
# Development
npm start                  # Start agent
npm run dev               # Development mode with auto-reload
npm test                  # Run tests

# Queue Operations
npm run queue:status      # View queue
npm run queue:add         # Add task

# Production
npm run daemon:start      # Start with PM2
npm run daemon:stop       # Stop PM2 process
npm run daemon:restart    # Restart PM2 process

# Maintenance
npm run clean             # Clear logs/temp
npm run diagnose          # Run diagnostics
npm run lint              # Check code quality
npm run format            # Format code

# Docker
make build               # Build image
make up                  # Start containers
make down                # Stop containers
make logs                # View logs
```

---

**Last Updated**: 2026-01-27
**Generated for**: Claude AI Assistant
**Project**: chatgpt-docker-puppeteer v1.1.0
