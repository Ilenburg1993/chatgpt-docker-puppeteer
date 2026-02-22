# Page Stability Module - Orchestrated Stabilization

**Location**: `src/shared/page_stability/stabilizer.js` **Version**: v4.0 (Migrated from
driver/modules) **Status**: ✅ Production Ready **Category**: Universal Tool (Shared Layer)

---

## Overview

The **Page Stability Module** provides orchestrated page readiness validation through 6 progressive
phases. It ensures the page is truly interactive before attempting any user actions, preventing
false negatives from premature interaction attempts.

### Why Shared Layer?

- ✅ **Universal**: Applicable to any browser automation (not LLM-specific)
- ✅ **Reusable**: Used by drivers, health checks, recovery systems
- ✅ **Testable**: Can be tested without driver context
- ✅ **Stateless**: Pure async functions with configurable timeouts

---

## API Reference

### `waitForStability(driver, timeoutMs = 30000)`

Orchestrates 6-phase stabilization to ensure page is fully loaded and interactive.

**Parameters**:

- `driver` {Object} - Driver instance with `page`, `emit()`, `logEvent()`, `config`
- `timeoutMs` {number} - Maximum wait time (default: 30000ms)

**Returns**: `Promise<string>` - Stability status:

- `'ok'` - Page stable and ready
- `'partial'` - Some phases failed but page usable
- `'timeout'` - Exceeded timeout (force continue)
- `'abort'` - Aborted by signal

**Features**:

- **Phase 1: Network Idle** (500ms)
  - Waits for `networkidle0` or `networkidle2`
  - Non-blocking (failure OK)
- **Phase 2: Spinner Detection** (2000ms)
  - Deep scans for loading spinners (25+ CSS selectors)
  - Shadow DOM support
  - Waits for spinners to disappear
- **Phase 3: DOM Entropy** (1000ms)
  - Monitors DOM mutations
  - Declares stable when mutations < 2/sec
  - Leak prevention (MutationObserver cleanup)
- **Phase 4: Hydration Guard** (100ms)
  - Waits for client-side hydration to complete
  - Prevents stale DOM interactions
- **Phase 5: Visual Frame Sync**
  - Uses `requestAnimationFrame` to sync with paint cycle
  - Ensures visual stability
- **Phase 6: CPU Lag Check**
  - Measures event loop lag via MessageChannel
  - Threshold: < 150ms (healthy)

**Example**:

```javascript
const stabilizer = require('@shared/page_stability/stabilizer');

const driver = {
  page: puppeteerPage,
  emit: event => console.log(event),
  logEvent: msg => console.log(msg),
  config: { timeouts: { pageLoad: 30000 } },
};

const status = await stabilizer.waitForStability(driver, 30000);
if (status === 'ok') {
  console.log('Page fully stable, ready for interaction');
} else {
  console.warn(`Partial stability: ${status}`);
}
```

---

### `measureEventLoopLag(page)`

Measures event loop lag using MessageChannel (precise timing).

**Parameters**:

- `page` {Object} - Puppeteer Page instance

**Returns**: `Promise<number>` - Lag in milliseconds

**Features**:

- Uses `MessageChannel` for accurate measurement
- Injected script for browser context execution
- Timeout: 1500ms (returns `Infinity` on timeout)

**Example**:

```javascript
const stabilizer = require('@shared/page_stability/stabilizer');

const lag = await stabilizer.measureEventLoopLag(page);
if (lag < 150) {
  console.log('Event loop healthy:', lag + 'ms');
} else if (lag < 500) {
  console.warn('Event loop stressed:', lag + 'ms');
} else {
  console.error('Event loop blocked:', lag + 'ms');
}
```

---

### `getPageLoadStatus(page)`

Checks page load status (spinners, busy state).

**Parameters**:

- `page` {Object} - Puppeteer Page instance

**Returns**: `Promise<Object>` - Status object:

```javascript
{
    hasSpinner: false,      // True if loading spinner detected
    hasBusyState: false,    // True if aria-busy="true" detected
    status: 'ready'         // 'ready' | 'loading' | 'busy'
}
```

**Features**:

- Scans 25+ spinner CSS selectors
- Shadow DOM support (deep scan)
- ARIA busy state detection
- Visibility filtering (ignores hidden spinners)

**Example**:

```javascript
const stabilizer = require('@shared/page_stability/stabilizer');

const status = await stabilizer.getPageLoadStatus(page);
if (status.status === 'ready') {
  console.log('No spinners or busy states detected');
} else if (status.hasSpinner) {
  console.warn('Loading spinner visible');
} else if (status.hasBusyState) {
  console.warn('ARIA busy state detected');
}
```

---

## 6-Phase Stabilization Algorithm

```
┌────────────────────────────────────────────────────┐
│ Phase 1: Network Idle (500ms)                      │
│  - Waits for networkidle0 or networkidle2          │
│  - Non-blocking (failure OK)                       │
└──────────────────┬─────────────────────────────────┘
                   ▼
┌────────────────────────────────────────────────────┐
│ Phase 2: Spinner Detection (2000ms)                │
│  - Scans 25+ CSS selectors                         │
│  - Shadow DOM support                              │
│  - Waits for disappearance                         │
└──────────────────┬─────────────────────────────────┘
                   ▼
┌────────────────────────────────────────────────────┐
│ Phase 3: DOM Entropy (1000ms)                      │
│  - MutationObserver monitors changes               │
│  - Stable when mutations < 2/sec                   │
│  - Auto-cleanup (leak prevention)                  │
└──────────────────┬─────────────────────────────────┘
                   ▼
┌────────────────────────────────────────────────────┐
│ Phase 4: Hydration Guard (100ms)                   │
│  - Waits for client-side hydration                 │
│  - Prevents stale DOM interactions                 │
└──────────────────┬─────────────────────────────────┘
                   ▼
┌────────────────────────────────────────────────────┐
│ Phase 5: Visual Frame Sync                         │
│  - requestAnimationFrame ensures paint sync        │
│  - Guarantees visual stability                     │
└──────────────────┬─────────────────────────────────┘
                   ▼
┌────────────────────────────────────────────────────┐
│ Phase 6: CPU Lag Check                             │
│  - Measures event loop lag (MessageChannel)        │
│  - Threshold: < 150ms = healthy                    │
│  - > 500ms = warn, continue anyway                 │
└────────────────────────────────────────────────────┘
```

---

## Spinner Detection (Deep Scan)

**25+ CSS Selectors**:

```javascript
const SPINNER_SELECTORS = [
  '[class*="spinner"]',
  '[class*="loading"]',
  '[class*="loader"]',
  '[aria-label*="loading" i]',
  '[aria-label*="carregando" i]',
  '.fa-spinner',
  'svg.spinner',
  '[data-loading="true"]',
  '[data-testid*="spinner"]',
  // ... 17 more selectors
];
```

**Shadow DOM Support**:

- Recursively scans all `shadowRoot` trees
- Extracts flattened list of shadow elements
- Visibility filtering (ignores `display: none`, `visibility: hidden`)

**Example**:

```javascript
// Detected spinner types:
// ✅ Bootstrap spinners (<div class="spinner-border">)
// ✅ Font Awesome (<i class="fa fa-spinner fa-spin">)
// ✅ SVG spinners (<svg class="spinner"><circle /></svg>)
// ✅ Custom spinners (data-loading, aria-label)
// ✅ Shadow DOM spinners (<my-component><shadowRoot><div class="loader"></shadowRoot></my-component>)
```

---

## Usage Patterns

### Pattern 1: Driver Execution (Default)

```javascript
// src/driver/modules/biomechanics_engine.js
const stabilizer = require('@shared/page_stability/stabilizer');

async function click(selector) {
  const status = await stabilizer.waitForStability(this.driver, 30000);
  if (status !== 'ok') {
    this.driver.logEvent(`WARNING: Partial stability (${status}), continuing anyway`);
  }
  await this.humanClick(selector);
}
```

### Pattern 2: Triage System (Diagnostic)

```javascript
// src/driver/modules/triage.js
const stabilizer = require('@shared/page_stability/stabilizer');

async function diagnose() {
  const lag = await stabilizer.measureEventLoopLag(this.driver.page);
  const status = await stabilizer.getPageLoadStatus(this.driver.page);

  if (lag > 500 || status.status !== 'ready') {
    return { issue: 'PAGE_NOT_READY', lag, status };
  }
}
```

### Pattern 3: Recovery System (Healing)

```javascript
// src/driver/modules/recovery_system.js
const stabilizer = require('@shared/page_stability/stabilizer');

async function recover() {
  // Wait for full stability before retry
  await stabilizer.waitForStability(this.driver, 60000);

  // Retry failed action
  await this.retryLastAction();
}
```

### Pattern 4: Health Checks (Browser Pool)

```javascript
// src/infra/browser_pool/pool_manager.js
const stabilizer = require('@shared/page_stability/stabilizer');

async function validateInstance(page) {
  const lag = await stabilizer.measureEventLoopLag(page);
  const status = await stabilizer.getPageLoadStatus(page);

  return {
    healthy: lag < 150 && status.status === 'ready',
    lag,
    status,
  };
}
```

---

## Performance

| Phase             | Avg Time   | Max Time | Blocking |
| ----------------- | ---------- | -------- | -------- |
| Network Idle      | 500ms      | 500ms    | No       |
| Spinner Detection | 200-2000ms | 2000ms   | Yes      |
| DOM Entropy       | 300-1000ms | 1000ms   | Yes      |
| Hydration Guard   | 100ms      | 100ms    | Yes      |
| Visual Frame Sync | < 20ms     | 50ms     | Yes      |
| CPU Lag Check     | 50-150ms   | 1500ms   | Yes      |
| **Total**         | **1.5-4s** | **5.2s** | -        |

**Note**: Times are worst-case. Most pages stabilize in 1-2 seconds.

---

## Dependencies

- **@core/logger** (core): Logging infrastructure
- **@core/constants** (core): Timeout constants
- **@logic/adaptive** (logic): Adaptive timeout calculation

**Minimal dependencies** - Can be used with minimal driver stub.

---

## Migration History

- **v3.0** (Jan 2026): Located in `src/driver/modules/stabilizer.js`
- **v4.0** (Feb 2026): Migrated to `src/shared/page_stability/stabilizer.js`
  - Reason: Identified as universal tool (reusable beyond drivers)
  - Breaking changes: None (only imports updated)
  - Benefits: Usable in health checks, recovery, standalone tools

---

## Configuration

Stabilization behavior can be configured via `driver.config`:

```javascript
{
    timeouts: {
        pageLoad: 30000,              // Max wait for stability
        networkIdle: 500,             // Network idle timeout
        spinnerWait: 2000,            // Max wait for spinners
        domEntropy: 1000,             // DOM mutation monitoring
        hydrationGuard: 100           // Hydration wait
    },
    stability: {
        cpuLagThreshold: 150,         // Healthy event loop (ms)
        cpuLagWarn: 500,              // Warn threshold (ms)
        domMutationThreshold: 2       // Mutations/sec for stability
    }
}
```

---

## Troubleshooting

### Issue: False positives (page declared stable too early)

**Cause**: Aggressive timeouts **Solution**: Increase `timeouts.spinnerWait` and
`timeouts.domEntropy`

### Issue: False negatives (page never declared stable)

**Cause**: Page has continuous animations or polling **Solution**: Lower
`stability.domMutationThreshold` to 5-10 mutations/sec

### Issue: Event loop lag always high

**Cause**: Page has heavy JS execution (React dev mode, hot reload) **Solution**: Disable dev tools,
use production builds for testing

### Issue: Spinners not detected

**Cause**: Custom spinner classes **Solution**: Add custom selectors to `SPINNER_SELECTORS` array

---

## Future Enhancements (v5.0)

- [ ] Remove `driver` dependency (make standalone with page-only API)
- [ ] Configurable spinner selectors (via config)
- [ ] Image loading detection (lazy-loaded images)
- [ ] WebSocket activity monitoring
- [ ] Service Worker activation detection
- [ ] Telemetry exporting (stability metrics to dashboard)

---

## Testing

```bash
# Unit tests (no driver required)
node tests/shared/test_page_stability.js

# Integration tests
make test-fast
```

---

**Author**: GitHub Copilot **Last Updated**: Feb 2026 **License**: Internal Use Only
