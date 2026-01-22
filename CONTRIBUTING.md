# Contributing to chatgpt-docker-puppeteer

Thank you for your interest in contributing! 🎉

## Code of Conduct

Be respectful, inclusive, and professional in all interactions.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/issues)
2. Use the Bug Report template
3. Include detailed steps to reproduce
4. Add relevant logs and environment information

### Suggesting Features

1. Check if the feature has already been requested
2. Use the Feature Request template
3. Explain the use case and benefits
4. Consider implementation complexity

### Pull Requests

1. **Fork** the repository
2. **Create a branch** from `main`: `git checkout -b feature/your-feature-name`
3. **Make your changes** following the code style
4. **Test thoroughly** - run `npm test`
5. **Commit** with clear, descriptive messages
6. **Push** to your fork
7. **Open a Pull Request** using the template

## Development Setup

```bash
# Clone the repository
git clone https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git
cd chatgpt-docker-puppeteer

# Install dependencies
npm install

# Run tests
npm test

# Start in development mode
npm run dev
```

## Code Style

### Import Conventions (IMPORTANTE)

Este projeto usa **module-alias** para imports limpos. SEMPRE use aliases ao invés de caminhos relativos:

```javascript
// ❌ NUNCA fazer (caminhos relativos)
const logger = require('../../../core/logger');
const io = require('../../infra/io');
const { ActorRole } = require('../../../shared/nerv/constants');

// ✅ SEMPRE fazer (aliases)
const logger = require('@core/logger');
const io = require('@infra/io');
const { ActorRole } = require('@shared/nerv/constants');
```

**Aliases disponíveis:**
- `@` → `src/` (raiz do projeto)
- `@core` → `src/core/` (config, logger, constants, schemas)
- `@shared` → `src/shared/` (NERV constants, utilities)
- `@nerv` → `src/nerv/` (event bus, pub/sub)
- `@kernel` → `src/kernel/` (task execution engine)
- `@driver` → `src/driver/` (ChatGPT, Gemini drivers)
- `@infra` → `src/infra/` (browser pool, locks, queue, storage)
- `@server` → `src/server/` (dashboard, API, Socket.io)
- `@logic` → `src/logic/` (business rules)

**IntelliSense:** Configure seu editor lendo `jsconfig.json` para autocomplete automático dos aliases.

### Convenções Gerais

- Use ES6+ features
- Follow existing code patterns
- Add JSDoc comments for functions
- Keep functions small and focused
- Use meaningful variable names
- **Import com aliases** (nunca caminhos relativos profundos)

## Testing

- Write tests for new features
- Ensure all tests pass before submitting PR
- Test edge cases and error scenarios

## Commit Messages

Use clear, descriptive commit messages:

- `feat: add new validation rule for responses`
- `fix: resolve memory leak in driver lifecycle`
- `docs: update API documentation`
- `test: add integration test for queue system`

## Questions?

Open an issue with the `question` label or reach out to the maintainers.

Thank you for contributing! 🚀
