# Test Suite Documentation

Comprehensive testing infrastructure for the autonomous AI agent project.

## 📊 Coverage Goals

- **Lines**: 80%
- **Branches**: 75%
- **Functions**: 75%
- **Statements**: 80%

## 🏗️ Structure

```
tests/
├── unit/               # Unit tests (60% of test suite)
│   ├── core/          # Core modules (config, logger, schemas)
│   ├── nerv/          # NERV event bus
│   ├── kernel/        # Kernel execution engine
│   ├── driver/        # Driver adapters
│   ├── infra/         # Infrastructure (IO, browser, locks)
│   ├── server/        # API & dashboard
│   ├── state/         # State management
│   └── logic/         # Business logic
├── integration/       # Integration tests (30%)
│   ├── kernel/        # Kernel workflows
│   ├── driver/        # Driver integration
│   ├── api/           # API endpoints
│   ├── queue/         # Queue operations
│   └── browser/       # Browser pool
├── e2e/               # End-to-end tests (10%)
├── regression/        # Regression tests
├── fixtures/          # Test data
│   ├── tasks/         # Task fixtures
│   ├── responses/     # Response fixtures
│   ├── config/        # Config fixtures
│   └── dna/           # DNA fixtures
├── mocks/             # Mock objects
├── helpers/           # Test helpers
├── manual/            # Manual test scripts
├── performance/       # Performance tests
├── setup.js           # Global setup
├── teardown.js        # Global cleanup
└── README.md          # This file
```

## 🧪 Test Types

### Unit Tests
Fast, isolated tests for individual functions/modules.
```bash
npm run test:unit
npm run test:coverage:unit
npm run test:watch:unit
```

### Integration Tests
Test cross-component interactions.
```bash
npm run test:integration
npm run test:coverage:integration
```

### E2E Tests
Full workflow tests simulating real usage.
```bash
npm run test:e2e
```

### Regression Tests
Validate bug fixes and prevent regressions.
```bash
npm run test:regression
```

## 🚀 Running Tests

### All Tests
```bash
npm test                # Run all tests
npm run test:coverage   # With coverage report
npm run test:ci         # CI mode (fails on low coverage)
```

### Watch Mode
```bash
npm run test:watch      # Watch all tests
npm run test:watch:unit # Watch unit tests only
```

### Debug Mode
```bash
npm run test:debug      # Run with debugger
```

### Clean Artifacts
```bash
npm run test:clean      # Remove coverage/ and tmp/
```

## 🛠️ Tools

- **Test Runner**: Node.js native test runner (`node:test`)
- **Coverage**: c8 (Istanbul wrapper for V8 coverage)
- **Mocking**: sinon
- **API Testing**: supertest
- **Test Data**: @faker-js/faker

## 📝 Writing Tests

### Naming Convention
- **Test files**: `test_[module].spec.js`
- **Mock files**: `mock_[component].js`
- **Fixture files**: `[name].fixture.json`

### Unit Test Template
```javascript
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

describe('[Module] Unit Tests', () => {
    let instance;

    before(() => {
        // Setup
    });

    after(() => {
        // Cleanup
    });

    it('should do something', () => {
        // Test
        assert.strictEqual(result, expected);
    });
});
```

### Integration Test Template
```javascript
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

describe('[Feature] Integration Tests', () => {
    before(async () => {
        // Setup components
    });

    after(async () => {
        // Cleanup resources
    });

    it('should integrate components', async () => {
        // Test cross-component behavior
    });
});
```

## 📦 Fixtures

Reusable test data in `fixtures/`:
```javascript
const taskFixture = require('../fixtures/tasks/valid-task.fixture.json');
```

## 🎭 Mocks

Reusable mock objects in `mocks/`:
```javascript
const mockLogger = require('../mocks/mock_logger');
const mockNERV = require('../mocks/mock_nerv');
```

## 🔍 Coverage Reports

After running tests with coverage:
```bash
npm run test:coverage
```

Reports are generated in:
- `coverage/index.html` - Interactive HTML report
- `coverage/lcov.info` - LCOV format for CI tools
- `coverage/coverage-summary.json` - JSON summary

Open HTML report:
```bash
$BROWSER coverage/index.html
```

## 📊 Test Pyramid

```
        /\
       /  \      10% E2E Tests (Slow, High Value)
      /____\
     /      \    30% Integration Tests (Medium Speed)
    /        \
   /__________\  60% Unit Tests (Fast, Low Value Per Test)
```

## ✅ Best Practices

1. **Isolation**: Each test should be independent
2. **Fast**: Unit tests should complete in milliseconds
3. **Reliable**: No flaky tests (consistent results)
4. **Readable**: Clear test names and assertions
5. **Coverage**: Aim for 80%+ but prioritize critical paths
6. **Mocking**: Mock external dependencies (browser, network)
7. **Cleanup**: Always clean up resources in `after()`

## 🐛 Debugging Failed Tests

1. Run single test file:
   ```bash
   node --test tests/unit/core/test_config.spec.js
   ```

2. Use debugger:
   ```bash
   npm run test:debug
   ```

3. Check coverage gaps:
   ```bash
   npm run test:coverage
   $BROWSER coverage/index.html
   ```

4. Review test logs in `tests/tmp/`

## 🔄 CI/CD Integration

GitHub Actions workflow uses:
```bash
npm run test:ci
```

This fails if coverage thresholds are not met:
- Lines < 80%
- Branches < 75%
- Functions < 75%
- Statements < 80%

## 📚 Additional Resources

- [Node.js Test Runner Docs](https://nodejs.org/api/test.html)
- [c8 Documentation](https://github.com/bcoe/c8)
- [Sinon.js Guide](https://sinonjs.org/releases/latest/)
- [SuperTest API](https://github.com/ladjs/supertest)

## 🤝 Contributing

When adding new features:
1. Write tests FIRST (TDD)
2. Ensure all tests pass
3. Meet coverage thresholds
4. Update this README if needed

## 📅 Testing Phases

- ✅ **FASE 0**: Audit Complete
- 🔵 **FASE 1**: Infrastructure Setup (IN PROGRESS)
- ⏸️ **FASE 2**: Test Migration
- ⏸️ **FASE 3**: Critical Tests (🔴 Priority)
- ⏸️ **FASE 4**: High Priority Tests (🟡)
- ⏸️ **FASE 5**: Medium Priority Tests (🟠)
- ⏸️ **FASE 6**: Low Priority Tests + CI/CD (🟢)

Target: **80%+ coverage**, **350+ tests**, **< 15 min execution time**

---

**Last Updated**: January 2026
**Maintained by**: Development Team
