# chatgpt-docker-puppeteer

[![CI](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/actions/workflows/ci.yml/badge.svg)](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/actions/workflows/ci.yml)
![Node.js Version](https://img.shields.io/badge/node-%E2%89%A520.0.0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)
![Development Status](https://img.shields.io/badge/status-pre--v1.0-yellow)

**Autonomous agent system for controlling Large Language Models (ChatGPT, Gemini) via browser automation using Puppeteer and Chrome remote debugging.**

> ⚠️ **Development Status**: This project is actively under construction and has not reached v1.0 yet. Features and APIs may change.

---

## 🚀 Quick Start

```bash
# 1. Clone repository
git clone https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git
cd chatgpt-docker-puppeteer

# 2. Install dependencies
npm install

# 3. Start Chrome with remote debugging
# Windows:
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-automation-profile"

# Linux/macOS:
google-chrome --remote-debugging-port=9222 --user-data-dir="~/chrome-automation-profile"

# 4. Configure environment
cp .env.example .env

# 5. Run agent
npm run dev

# 6. Access dashboard
# Open http://localhost:3008
```

**Complete setup guide**: [DOCUMENTAÇÃO/QUICK_START.md](DOCUMENTAÇÃO/QUICK_START.md)

---

## 📋 What is This?

This project provides an **autonomous agent** that:
- Controls LLM chatbots (ChatGPT, Gemini) through browser automation
- Processes tasks from a file-based queue (`fila/`)
- Saves AI responses to `respostas/`
- Provides real-time monitoring via web dashboard
- Uses Chrome remote debugging (not bundled Chromium)

### Architecture

```
┌──────────┐      ┌──────────────┐      ┌────────────┐
│  Client  │─────▶│  Dashboard   │◀────▶│ Socket.io  │
│          │      │  (Port 3008) │      │ Real-time  │
└──────────┘      └──────┬───────┘      └────────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │  Task Engine │
                  │  (Processor) │
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │  Puppeteer   │
                  └──────┬───────┘
                         │
                    WebSocket
                         │
                  ┌──────▼───────┐
                  │ Chrome :9222 │
                  │ (Host System)│
                  └──────┬───────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   LLM Websites       │
              │ ChatGPT / Gemini     │
              └──────────────────────┘
```

---

## 📚 Documentation

- **[Quick Start Guide](DOCUMENTAÇÃO/QUICK_START.md)** - Get running in 10 minutes
- **[API Documentation](DOCUMENTAÇÃO/API.md)** - REST API & WebSocket reference
- **[Architecture Guide](DOCUMENTAÇÃO/ARCHITECTURE.md)** - System design & components
- **[Configuration Guide](DOCUMENTAÇÃO/CONFIGURATION.md)** - All settings explained
- **[Docker Setup](DOCKER_SETUP.md)** - Windows containerization guide
- **[Deployment Guide](DOCUMENTAÇÃO/DEPLOYMENT.md)** - Production deployment
- **[Contributing](CONTRIBUTING.md)** - Development workflow

---

## ✨ Features

- **Browser Automation**: Puppeteer-based control of LLM web interfaces
- **Chrome Remote Debugging**: Connect to existing Chrome (no bundled browser)
- **Queue System**: File-based task queue with PID-based locking
- **Real-time Dashboard**: Monitor tasks via Socket.io
- **Incremental Collection**: Stream responses as they're generated
- **Quality Validation**: Configurable response validation rules
- **Retry Logic**: Adaptive backoff with failure classification
- **Hot Reload**: Dynamic configuration updates without restart
- **Docker Ready**: Multi-stage builds, ~150MB image
- **Process Management**: PM2 for production deployments

---

## 🛠 Tech Stack

- **Node.js**: ≥20.0.0
- **Puppeteer**: 21.11.0 (browser automation)
- **Express**: 4.22.1 (web server)
- **Socket.io**: 4.8.3 (real-time communication)
- **PM2**: 5.4.3 (process management)
- **Zod**: 3.25.76 (schema validation)
- **Docker**: Multi-stage builds

---

## 📦 Project Structure

```
chatgpt-docker-puppeteer/
├── src/
│   ├── core/              # Execution engine & schemas
│   ├── driver/            # LLM-specific automation drivers
│   ├── infra/             # Queue, locks, IPC
│   ├── kernel/            # Task lifecycle management
│   ├── nerv/              # Inter-process communication
│   └── server/            # Web dashboard
├── scripts/               # Utility scripts
├── tests/                 # Test suites
├── fila/                  # Task queue (JSON files)
├── respostas/             # AI responses
├── logs/                  # Application logs
├── profile/               # Browser profiles
├── DOCUMENTAÇÃO/          # Complete documentation
└── public/                # Dashboard static files
```

---

## 🚢 Deployment

### Docker (Recommended)

```bash
# Build and start
make build
make start

# Check health
make health

# View logs
make logs
```

See [DOCKER_SETUP.md](DOCKER_SETUP.md) for detailed instructions.

### Native (PM2)

```bash
# Install PM2 globally
npm install -g pm2

# Start agent
npm run daemon:start

# Monitor
pm2 status
pm2 logs chatgpt-agent
```

See [DOCUMENTAÇÃO/DEPLOYMENT.md](DOCUMENTAÇÃO/DEPLOYMENT.md) for production setup.

---

## 🔧 Configuration

### Environment Variables

Key settings in `.env`:

```bash
NODE_ENV=production
PORT=3008
CHROME_WS_ENDPOINT=ws://host.docker.internal:9222
MAX_WORKERS=3
LOG_LEVEL=info
```

See [.env.example](.env.example) for all variables.

### Main Configuration

`config.json`:
```json
{
  "target": "chatgpt",
  "maxRetries": 3,
  "timeout": 30000,
  "logLevel": "info"
}
```

See [DOCUMENTAÇÃO/CONFIGURATION.md](DOCUMENTAÇÃO/CONFIGURATION.md) for complete reference.

---

## 📊 Usage Examples

### Create a Task

**Via CLI:**
```bash
npm run queue:add
```

**Via API:**
```bash
curl -X POST http://localhost:3008/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "id": "task-001",
    "target": "chatgpt",
    "prompt": "Explain quantum computing"
  }'
```

### Monitor Progress

**Dashboard**: http://localhost:3008

**WebSocket**:
```javascript
const socket = io('http://localhost:3008');
socket.on('task:completed', (data) => {
  console.log('Result:', data.result);
});
```

### Get Results

Results saved to `respostas/task-001.txt`

---

## 🧪 Development

### Prerequisites

- Node.js ≥20.0.0
- Chrome browser
- npm ≥10.0.0

### Setup

```bash
# Install dependencies
npm install

# Run tests
npm test

# Development mode (hot reload)
npm run dev

# Lint code
npm run lint
```

### Testing

> **Note**: Tests are under active development (pre-v1.0). Some tests may be incomplete or failing.

```bash
# All tests
npm test

# Specific test suite
npm run test:lock
npm run test:linux

# Chrome connection test
node test-puppeteer.js
```

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development setup
- Coding conventions
- Commit message format
- Pull request process

---

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🔗 Links

- **Repository**: https://github.com/Ilenburg1993/chatgpt-docker-puppeteer
- **Issues**: https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/issues
- **Discussions**: https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/discussions
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)

---

## 🆘 Support

**Issues**: Found a bug? [Open an issue](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/issues)

**Questions**: Have a question? [Start a discussion](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/discussions)

**Diagnostics**: Run `npm run diagnose` for automated troubleshooting

---

## ⚠️ Disclaimer

This tool is for educational and automation purposes. Ensure compliance with the Terms of Service of any platforms you interact with. Use responsibly.
