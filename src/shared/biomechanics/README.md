# Biomechanics Module - Human Interaction Simulation

**Location**: `src/shared/biomechanics/human.js`
**Version**: v4.0 (Migrated from driver/modules)
**Status**: ✅ Production Ready
**Category**: Universal Tool (Shared Layer)

---

## Overview

The **Biomechanics Module** provides human-like simulation for mouse and keyboard interactions. It implements gaussian variance, typo generation, rhythm adaptation, and fatigue simulation to create realistic user behavior patterns that are indistinguishable from real human input.

### Why Shared Layer?

- ✅ **Stateless**: Pure functions with no driver context dependency
- ✅ **Reusable**: Used by driver, health checks, tests, CLI tools
- ✅ **Universal**: Not LLM-specific, applicable to any browser automation
- ✅ **Testable**: Can be tested without driver mocks

---

## API Reference

### `humanClick(page, ctx, selector, offsetX, offsetY, signal, onPulse)`

Performs a human-like click with gaussian variance.

**Parameters**:
- `page` {Object} - Puppeteer Page instance
- `ctx` {Object} - Execution context (Page or Frame)
- `selector` {string} - CSS selector of target element
- `offsetX` {number} - X offset for frame navigation (default: 0)
- `offsetY` {number} - Y offset for frame navigation (default: 0)
- `signal` {AbortSignal} - Optional abort signal
- `onPulse` {Function} - Callback for telemetry `({ type: 'MOUSE_MOVE', coords: {x, y} })`

**Features**:
- Gaussian randomization (stddev = 12% of element size)
- Ghost-cursor smooth movement
- Random delays (100-200ms before click, 40-80ms hold)
- Fallback to synthetic click on error

**Example**:
```javascript
const human = require('@shared/biomechanics/human');

await human.humanClick(page, page, 'button#submit', 0, 0, null, (pulse) => {
    console.log('Mouse moved to:', pulse.coords);
});
```

---

### `humanType(page, ctx, selector, text, currentLag, signal, onPulse)`

Performs human-like typing with errors, corrections, and adaptive rhythm.

**Parameters**:
- `page` {Object} - Puppeteer Page instance
- `ctx` {Object} - Execution context (Page or Frame)
- `selector` {string} - CSS selector of input field
- `text` {string} - Text to type
- `currentLag` {number} - Current event loop lag (adjusts typing speed)
- `signal` {AbortSignal} - Optional abort signal
- `onPulse` {Function} - Callback for telemetry `({ type: 'KEY_PRESS', char, index, total })`

**Features**:
- **Typo simulation**: 1.2% chance per character
  - Transposes adjacent characters (30% of typos)
  - Types neighboring keys from QWERTY layout (70% of typos)
  - Automatically corrects with backspace
- **Rhythm adaptation**:
  - Base flight time: 45-85ms per character
  - Punctuation pause: +180ms
  - Lag compensation: +30% of lag
- **Fatigue simulation**:
  - Pause probability increases after 30 chars
  - 400-1400ms pauses with occasional mouse movement
- **Focus lock**: Re-focuses every 25 characters
- **Security**: Sanitizes control characters (prevents protocol injection)

**Example**:
```javascript
const human = require('@shared/biomechanics/human');

await human.humanType(page, page, '#prompt-textarea', 'Hello, world!', 0, null, (pulse) => {
    console.log(`Typed: ${pulse.char} (${pulse.index + 1}/${pulse.total})`);
});
```

---

### `wakeUpMove(page)`

Performs a random cursor movement to "wake up" the browser window.

**Parameters**:
- `page` {Object} - Puppeteer Page instance

**Features**:
- Moves to random position within viewport (10% padding)
- Uses ghost-cursor for smooth movement
- Silent failure (no throw on error)

**Example**:
```javascript
const human = require('@shared/biomechanics/human');

await human.wakeUpMove(page); // Random cursor movement
```

---

## Keyboard Layouts

Currently supports **QWERTY** layout with neighbor key mapping for typo simulation.

**Layout**:
```javascript
{
    a: 'qsxz',  // Keys adjacent to 'a'
    b: 'vghn',
    c: 'xdfv',
    // ... full QWERTY mapping
}
```

**Future**: AZERTY support (detected via `navigator.language`)

---

## Telemetry Integration

Both `humanClick` and `humanType` support optional `onPulse` callbacks for real-time telemetry:

```javascript
await human.humanType(page, page, '#input', text, 0, null, (pulse) => {
    if (pulse.type === 'KEY_PRESS') {
        telemetry.emit('BIOMECHANICS', {
            action: 'TYPING',
            char: pulse.char,
            progress: `${pulse.index}/${pulse.total}`
        });
    }
});

await human.humanClick(page, page, '#button', 0, 0, null, (pulse) => {
    if (pulse.type === 'MOUSE_MOVE') {
        telemetry.emit('BIOMECHANICS', {
            action: 'CLICKING',
            coords: pulse.coords
        });
    }
});
```

---

## Usage Patterns

### Pattern 1: Driver Execution
```javascript
// src/driver/modules/biomechanics_engine.js
const human = require('@shared/biomechanics/human');

async function click(selector) {
    await human.humanClick(this.driver.page, ctx, selector, offsetX, offsetY);
}
```

### Pattern 2: Health Checks
```javascript
// src/infra/browser_pool/pool_manager.js
const human = require('@shared/biomechanics/human');

async function testInteractivity(page) {
    // Simulate user activity to test browser responsiveness
    await human.wakeUpMove(page);
    await human.humanClick(page, page, 'body', 0, 0);
}
```

### Pattern 3: E2E Testing
```javascript
// tests/e2e/interaction_test.js
const human = require('@shared/biomechanics/human');

test('User can submit form', async () => {
    await human.humanType(page, page, '#name', 'John Doe');
    await human.humanClick(page, page, 'button[type="submit"]');
});
```

### Pattern 4: Standalone CLI Tool
```javascript
// tools/browser-test.js
const human = require('@shared/biomechanics/human');

await page.goto('https://example.com');
await human.humanType(page, page, '#search', 'test query');
await human.humanClick(page, page, 'button.search');
```

---

## Performance

| Operation            | Avg Time  | Variance                  |
| -------------------- | --------- | ------------------------- |
| humanClick           | 200-400ms | Gaussian (σ=50ms)         |
| humanType (10 chars) | 450-850ms | Adaptive (depends on lag) |
| wakeUpMove           | 100-200ms | Random                    |

**Note**: Times include human-like delays. For synthetic (instant) operations, use `page.click()` and `page.type()` directly.

---

## Dependencies

- **ghost-cursor** (external): Smooth cursor movement with randomization
- **@core/logger** (core): Logging for warnings (e.g., empty prompt)

**Zero driver dependencies** - Can be used standalone.

---

## Migration History

- **v3.0** (Jan 2026): Located in `src/driver/modules/human.js`
- **v4.0** (Feb 2026): Migrated to `src/shared/biomechanics/human.js`
  - Reason: Identified as universal tool (not driver-specific)
  - Breaking changes: None (only imports updated)
  - Benefits: Reusable in health checks, tests, CLI tools

---

## Testing

```bash
# Unit tests (no driver mock required)
node tests/shared/test_human_biomechanics.js

# Integration tests
make test-fast
```

---

## Troubleshooting

### Issue: Typos not happening
**Cause**: RNG seed
**Solution**: Typos are probabilistic (1.2% chance). Over 100 characters, expect ~1 typo.

### Issue: Empty prompt warning
**Cause**: Text sanitization removed all characters
**Solution**: Avoid control characters (\x00-\x1F) in input text

### Issue: Focus lost during typing
**Cause**: Page mutations or JS interference
**Solution**: Focus lock re-focuses every 25 characters automatically

---

## Future Enhancements (v5.0)

- [ ] AZERTY keyboard layout support
- [ ] Mobile touch simulation (tap, swipe)
- [ ] Mouse movement heatmaps (analyze human patterns)
- [ ] Machine learning typing rhythm (train on real user data)
- [ ] Multi-language keyboard layouts

---

**Author**: GitHub Copilot
**Last Updated**: Feb 2026
**License**: Internal Use Only
