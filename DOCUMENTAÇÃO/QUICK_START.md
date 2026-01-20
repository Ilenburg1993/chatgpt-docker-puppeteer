# 🚀 Quick Start Guide

## Prerequisites

- **Node.js**: ≥20.0.0
- **npm**: ≥10.0.0
- **Google Chrome**: Installed on host system
- **Docker** (optional): For containerized deployment

---

## Installation

### 1. Clone Repository
```bash
git clone https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git
cd chatgpt-docker-puppeteer
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
```bash
cp .env.example .env
# Edit .env with your settings
```

### 4. Start Chrome with Remote Debugging
```powershell
# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-automation-profile"

# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="~/chrome-automation-profile"

# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir="~/chrome-automation-profile"
```

Verify Chrome is ready: http://localhost:9222/json/version

---

## Running the Agent

### Development Mode
```bash
npm run dev
# Server starts on http://localhost:3008
# Auto-reload enabled
```

### Production Mode
```bash
npm start
# or with PM2
npm run daemon:start
```

### Docker Mode
```bash
# See DOCKER_SETUP.md for detailed instructions
make build
make start
```

---

## First Task

### 1. Access Dashboard
Open http://localhost:3008 in your browser

### 2. Create a Task
```json
{
  "id": "task-001",
  "target": "chatgpt",
  "prompt": "Hello, how are you?",
  "validation": {
    "minLength": 10
  }
}
```

### 3. Add Task to Queue
```bash
# Via CLI
npm run queue:add

# Via API
curl -X POST http://localhost:3008/api/tasks \
  -H "Content-Type: application/json" \
  -d @task.json
```

### 4. Monitor Progress
- **Dashboard**: Real-time updates via Socket.io
- **Logs**: `npm run daemon:logs`
- **Queue Status**: `npm run queue:status`

### 5. Get Results
Results are saved in `respostas/task-001.txt`

---

## Project Structure

```
chatgpt-docker-puppeteer/
├── src/                    # Source code
│   ├── core/              # Core engine & schemas
│   ├── driver/            # LLM-specific drivers
│   ├── infra/             # Infrastructure (queue, locks, IPC)
│   ├── kernel/            # Task execution kernel
│   ├── nerv/              # Inter-process communication
│   └── server/            # Web dashboard
├── scripts/               # Utility scripts
├── tests/                 # Test suites
├── public/                # Dashboard static files
├── fila/                  # Task queue (JSON files)
├── respostas/             # Task responses
├── logs/                  # Application logs
├── profile/               # Browser profiles
├── DOCUMENTAÇÃO/          # Documentation
└── config.json            # Main configuration
```

---

## Key Commands

### Lifecycle
```bash
npm start              # Start agent
npm run dev            # Development mode with hot reload
npm run daemon:start   # Start with PM2
npm run daemon:stop    # Stop PM2 processes
npm run daemon:logs    # View PM2 logs
```

### Queue Management
```bash
npm run queue:status   # View queue status
npm run queue:add      # Add new task
npm run queue:flow     # Task flow manager
```

### Maintenance
```bash
npm run clean          # Clean logs and temp files
npm run clean:queue    # Clear task queue
npm run reset:hard     # Full reset
npm run diagnose       # Analyze crashes
```

### Testing
```bash
npm test               # Run all tests
npm run test:linux     # Linux test suite
npm run test:lock      # Test lock mechanisms
```

### Docker
```bash
make build             # Build image
make start             # Start container
make stop              # Stop container
make logs              # View logs
make shell             # Container shell access
```

---

## Configuration

### Main Config (`config.json`)
```json
{
  "target": "chatgpt",
  "maxRetries": 3,
  "timeout": 30000,
  "logLevel": "info"
}
```

### Dynamic Rules (`dynamic_rules.json`)
Runtime-adjustable validation and processing rules.

### Environment Variables (`.env`)
```bash
NODE_ENV=production
CHROME_WS_ENDPOINT=ws://host.docker.internal:9222
LOG_LEVEL=info
PORT=3008
```

---

## Troubleshooting

### Chrome Connection Failed
```bash
# Check Chrome is running with remote debugging
curl http://localhost:9222/json/version

# Restart Chrome
taskkill /F /IM chrome.exe  # Windows
chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\profile"
```

### Port Already in Use
```bash
# Find process using port 3008
netstat -ano | findstr :3008  # Windows
lsof -i :3008                 # Linux/macOS

# Kill process
taskkill /PID <pid> /F        # Windows
kill -9 <pid>                 # Linux/macOS
```

### Tasks Stuck in Queue
```bash
# Check lock files
npm run queue:status

# Clear locks
npm run clean

# Restart agent
npm run daemon:restart
```

---

## Next Steps

1. ✅ Read [API Documentation](DOCUMENTAÇÃO/API.md)
2. ✅ Review [Architecture Guide](DOCUMENTAÇÃO/ARCHITECTURE.md)
3. ✅ Check [Configuration Guide](DOCUMENTAÇÃO/CONFIGURATION.md)
4. ✅ See [Docker Setup](DOCKER_SETUP.md) for containerization
5. ✅ Join discussions on [GitHub](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/discussions)

---

## Support

- **Issues**: https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/issues
- **Discussions**: https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/discussions
- **Contributing**: See [CONTRIBUTING.md](CONTRIBUTING.md)

---

## License

MIT License - see [LICENSE](LICENSE) for details.
