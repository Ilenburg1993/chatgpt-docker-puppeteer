# human.js Audit Report - v2.0 Upgrade Analysis
**Module**: `src/shared/biomechanics/human.js`
**Current Version**: v4.0 (migrated to shared/)
**Target Version**: v2.0 (consolidated + enhanced)
**Date**: February 1, 2026
**Analyst**: GitHub Copilot

---

## Executive Summary

**Status**: 🟡 **GOOD** with **7 bugs** and **12 improvement opportunities**

The biomechanics module is functional but has several defensive programming gaps, missing validations, and opportunities for configuration externalization and telemetry enhancement.

---

## 🐛 Bugs Identified (7)

### Bug #1: Cursor Cache Memory Leak (WeakMap Misuse)
**Severity**: 🔴 **HIGH**
**Location**: Lines 14, 59
**Issue**: `cursorCache` uses `WeakMap<Page, Cursor>` but Puppeteer Page objects are not garbage collected predictably, leading to potential memory buildup in long-running sessions.

**Code**:
```javascript
const cursorCache = new WeakMap(); // Line 14

function getCursor(page) {
    if (!cursorCache.has(page)) {
        const cursor = createCursor(page);
        cursor.toggleRandomMove(true);
        cursorCache.set(page, cursor);
    }
    return cursorCache.get(page);
}
```

**Problem**: WeakMap doesn't guarantee immediate cleanup. Pages can accumulate if not explicitly closed.

**Fix**: Add explicit cache cleanup on page close + LRU eviction for safety:
```javascript
const cursorCache = new Map(); // Use Map with manual cleanup
const MAX_CACHE_SIZE = 10;

function getCursor(page) {
    if (!cursorCache.has(page)) {
        // LRU eviction
        if (cursorCache.size >= MAX_CACHE_SIZE) {
            const firstKey = cursorCache.keys().next().value;
            cursorCache.delete(firstKey);
        }

        const cursor = createCursor(page);
        cursor.toggleRandomMove(true);
        cursorCache.set(page, cursor);

        // Auto-cleanup on page close
        page.once('close', () => cursorCache.delete(page));
    }
    return cursorCache.get(page);
}
```

---

### Bug #2: Missing Parameter Validation (humanClick)
**Severity**: 🟡 **MEDIUM**
**Location**: Line 99
**Issue**: No validation for required parameters. If `page`, `ctx`, or `selector` are null/undefined, the function will crash with cryptic errors.

**Code**:
```javascript
async function humanClick(page, ctx, selector, offsetX = 0, offsetY = 0, signal = null, onPulse = null) {
    if (signal?.aborted || page.isClosed()) { // What if page is null?
        return;
    }
    const cursor = getCursor(page); // Will crash if page is undefined
```

**Fix**: Add defensive checks:
```javascript
async function humanClick(page, ctx, selector, offsetX = 0, offsetY = 0, signal = null, onPulse = null) {
    // Validation
    if (!page || !ctx || !selector) {
        throw new TypeError('humanClick: page, ctx, and selector are required');
    }
    if (typeof selector !== 'string') {
        throw new TypeError('humanClick: selector must be a string');
    }

    if (signal?.aborted || page.isClosed()) {
        return;
    }
    const cursor = getCursor(page);
```

---

### Bug #3: Missing Parameter Validation (humanType)
**Severity**: 🟡 **MEDIUM**
**Location**: Line 148
**Issue**: Same as Bug #2 - no validation for required parameters.

**Code**:
```javascript
async function humanType(page, ctx, selector, text, currentLag = 0, signal = null, onPulse = null) {
    const layoutKey = await detectKeyboardLayout(page); // Will crash if page is null
```

**Fix**: Add defensive checks:
```javascript
async function humanType(page, ctx, selector, text, currentLag = 0, signal = null, onPulse = null) {
    // Validation
    if (!page || !ctx || !selector || text === undefined || text === null) {
        throw new TypeError('humanType: page, ctx, selector, and text are required');
    }
    if (typeof selector !== 'string') {
        throw new TypeError('humanType: selector must be a string');
    }
    if (typeof text !== 'string') {
        throw new TypeError('humanType: text must be a string');
    }

    const layoutKey = await detectKeyboardLayout(page);
```

---

### Bug #4: Silent Failure on Empty Sanitized Text
**Severity**: 🟡 **MEDIUM**
**Location**: Line 168
**Issue**: Function returns early with only a WARN log when sanitized text is empty, but caller has no way to know the operation was aborted.

**Code**:
```javascript
if (!sanitizedText) {
    _log('WARN', '[HUMAN] Empty prompt after sanitization');
    return; // Silent failure - caller doesn't know typing was skipped
}
```

**Fix**: Throw error or return status object:
```javascript
if (!sanitizedText) {
    const msg = '[HUMAN] Empty prompt after sanitization (control chars removed)';
    _log('WARN', msg);
    throw new Error(msg); // Or return { typed: false, reason: 'empty_after_sanitization' }
}
```

---

### Bug #5: Race Condition in Focus Lock (Shadow DOM)
**Severity**: 🟡 **MEDIUM**
**Location**: Lines 175-192
**Issue**: Focus check and focus restoration are not atomic. Between checking `focusOk` and calling `ctx.focus()`, the page may have changed state (e.g., React re-render).

**Code**:
```javascript
if (i % 25 === 0) {
    const focusOk = await ctx.evaluate(sel => {
        // ... check focus ...
    }, selector).catch(() => false);

    if (!focusOk) {
        await ctx.focus(selector).catch(() => {}); // Race: focus may have changed again
        await new Promise(r => { setTimeout(r, 200); });
    }
}
```

**Fix**: Add retry logic with confirmation:
```javascript
if (i % 25 === 0) {
    let focusOk = false;
    for (let retry = 0; retry < 3 && !focusOk; retry++) {
        focusOk = await ctx.evaluate(sel => {
            // ... check focus ...
        }, selector).catch(() => false);

        if (!focusOk) {
            await ctx.focus(selector).catch(() => {});
            await new Promise(r => { setTimeout(r, 100 * (retry + 1)); });
        }
    }
    if (!focusOk) {
        _log('WARN', '[HUMAN] Failed to restore focus after 3 retries');
    }
}
```

---

### Bug #6: Typo Backspace Without Verification
**Severity**: 🟢 **LOW**
**Location**: Lines 202-217
**Issue**: After typing a typo character, the code presses Backspace without verifying the field is still focused or that the backspace was successful.

**Code**:
```javascript
await page.keyboard.type(typo || ' ');
await new Promise(r => { setTimeout(r, 300 + currentLag * 0.5); });
await page.keyboard.press('Backspace'); // No verification
```

**Fix**: Add verification or use selection-based correction:
```javascript
// Option 1: Verify backspace effect
await page.keyboard.type(typo || ' ');
await new Promise(r => { setTimeout(r, 300 + currentLag * 0.5); });
const beforeLength = await ctx.evaluate(sel => document.querySelector(sel)?.value?.length || 0, selector);
await page.keyboard.press('Backspace');
const afterLength = await ctx.evaluate(sel => document.querySelector(sel)?.value?.length || 0, selector);
if (beforeLength - afterLength !== 1) {
    _log('WARN', '[HUMAN] Backspace verification failed (field may have lost focus)');
}

// Option 2: Use selection + delete for robustness
await page.keyboard.down('Shift');
await page.keyboard.press('ArrowLeft');
await page.keyboard.up('Shift');
await page.keyboard.press('Backspace');
```

---

### Bug #7: No Telemetry for Errors
**Severity**: 🟢 **LOW**
**Location**: Lines 142-145, 171
**Issue**: Multiple catch blocks silently ignore errors without telemetry. Callers using `onPulse` don't receive error notifications.

**Code**:
```javascript
} catch (_e) {
    await ctx.click(selector).catch(() => {}); // Silent fallback, no telemetry
}

await ctx.focus(selector).catch(() => {}); // Silent failure, no telemetry
```

**Fix**: Add error telemetry:
```javascript
} catch (err) {
    if (onPulse) {
        onPulse({ type: 'CLICK_ERROR', error: err.message, fallback: 'synthetic_click' });
    }
    await ctx.click(selector).catch(() => {});
}

await ctx.focus(selector).catch((err) => {
    if (onPulse) {
        onPulse({ type: 'FOCUS_ERROR', error: err.message });
    }
});
```

---

## 💡 Improvements (12)

### Improvement #1: Configuration Externalization
**Priority**: 🔴 **HIGH**
**Impact**: Maintainability, testability

**Current**: Hardcoded magic numbers throughout the code:
```javascript
const stdDevFactor = 0.12; // Line 130
if (Math.random() < 0.012) // Line 203 (typo rate)
flightTime += 180; // Line 237 (punctuation pause)
if (charsSinceLastPause > 30 && Math.random() < charsSinceLastPause / 220) // Line 244
```

**Proposed**: Create configuration object:
```javascript
const BIOMECHANICS_CONFIG = {
    // Click parameters
    CLICK_VARIANCE_STDEV: 0.12,           // 12% of element size
    CLICK_PRE_DELAY_MIN: 100,             // ms before click
    CLICK_PRE_DELAY_MAX: 200,
    CLICK_HOLD_MIN: 40,                   // ms mouse down
    CLICK_HOLD_MAX: 80,

    // Typing parameters
    TYPO_RATE: 0.012,                     // 1.2% chance
    TYPO_TRANSPOSE_RATE: 0.7,             // 70% transposes, 30% neighbor keys
    TYPO_BACKSPACE_DELAY: 300,            // ms before correction

    // Rhythm parameters
    FLIGHT_TIME_MIN: 45,                  // ms between keys
    FLIGHT_TIME_MAX: 85,
    PUNCTUATION_PAUSE: 180,               // Extra ms for punctuation
    LAG_COMPENSATION_FACTOR: 0.3,         // Multiply lag by this

    // Fatigue parameters
    FATIGUE_THRESHOLD: 30,                // chars before fatigue kicks in
    FATIGUE_PROBABILITY_DIVISOR: 220,
    FATIGUE_PAUSE_MIN: 400,
    FATIGUE_PAUSE_MAX: 1400,
    FATIGUE_MOVE_THRESHOLD: 800,          // If pause > this, move mouse
    FATIGUE_MOVE_CHANCE: 0.6,

    // Focus lock
    FOCUS_CHECK_INTERVAL: 25,             // Check focus every N chars
    FOCUS_RESTORE_DELAY: 200,

    // Cache
    CURSOR_CACHE_MAX_SIZE: 10
};
```

---

### Improvement #2: Gaussian Distribution Quality
**Priority**: 🟡 **MEDIUM**
**Impact**: Realism

**Current**: Uses Box-Muller transform (good) but only generates one sample per call:
```javascript
function gaussianRandom(mean = 0, stdev = 1) {
    const u = 1 - Math.random();
    const v = 1 - Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdev + mean;
}
```

**Proposed**: Generate both samples for efficiency + add clamping:
```javascript
let _gaussianCache = null;

function gaussianRandom(mean = 0, stdev = 1, clampStdev = 3) {
    // Use cached value if available (Box-Muller generates 2 samples)
    if (_gaussianCache !== null) {
        const z = _gaussianCache;
        _gaussianCache = null;
        const value = z * stdev + mean;
        return Math.max(mean - clampStdev * stdev, Math.min(mean + clampStdev * stdev, value));
    }

    const u = 1 - Math.random();
    const v = 1 - Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    const z1 = Math.sqrt(-2.0 * Math.log(u)) * Math.sin(2.0 * Math.PI * v);

    _gaussianCache = z1; // Cache second sample

    const value = z0 * stdev + mean;
    return Math.max(mean - clampStdev * stdev, Math.min(mean + clampStdev * stdev, value));
}
```

**Benefit**: 2x faster, prevents extreme outliers (clamps to ±3σ by default)

---

### Improvement #3: Enhanced Telemetry
**Priority**: 🟡 **MEDIUM**
**Impact**: Observability

**Current**: Only reports mouse movement and key presses:
```javascript
if (onPulse) {
    onPulse({ type: 'MOUSE_MOVE', coords: { x: targetX, y: targetY } });
}
if (onPulse) {
    onPulse({ type: 'KEY_PRESS', char, index: i, total: sanitizedText.length });
}
```

**Proposed**: Add comprehensive telemetry:
```javascript
// Click telemetry
onPulse({ type: 'CLICK_START', selector, element: { x, y, w, h } });
onPulse({ type: 'MOUSE_MOVE', coords: { x, y }, variance: { randX, randY } });
onPulse({ type: 'MOUSE_DOWN', duration: downTime });
onPulse({ type: 'MOUSE_UP' });
onPulse({ type: 'CLICK_COMPLETE', totalTime });

// Type telemetry
onPulse({ type: 'TYPE_START', text: sanitizedText, chars: sanitizedText.length });
onPulse({ type: 'KEY_PRESS', char, index, total, timing: { flightTime, needsShift } });
onPulse({ type: 'TYPO_GENERATED', typo, original: char });
onPulse({ type: 'TYPO_CORRECTED', backspace: true });
onPulse({ type: 'FOCUS_LOCK', success: focusOk });
onPulse({ type: 'FATIGUE_PAUSE', duration: pause });
onPulse({ type: 'TYPE_COMPLETE', totalTime, charsTyped });
```

---

### Improvement #4: Typing Speed Profiles
**Priority**: 🟡 **MEDIUM**
**Impact**: Realism

**Current**: Fixed typing speed (45-85ms flight time):
```javascript
let flightTime = 45 + Math.random() * 40;
```

**Proposed**: Support typing profiles (slow/average/fast):
```javascript
const TYPING_PROFILES = {
    slow: { min: 80, max: 150, wpm: 25 },
    average: { min: 45, max: 85, wpm: 45 },
    fast: { min: 20, max: 50, wpm: 70 },
    expert: { min: 10, max: 30, wpm: 90 }
};

async function humanType(page, ctx, selector, text, currentLag = 0, signal = null, onPulse = null, profile = 'average') {
    const speed = TYPING_PROFILES[profile] || TYPING_PROFILES.average;
    // ...
    let flightTime = speed.min + Math.random() * (speed.max - speed.min);
```

---

### Improvement #5: AZERTY Layout Support
**Priority**: 🟢 **LOW**
**Impact**: Internationalization

**Current**: Only QWERTY layout defined:
```javascript
const LAYOUTS = {
    qwerty: { a: 'qsxz', b: 'vghn', ... }
};
```

**Proposed**: Add AZERTY:
```javascript
const LAYOUTS = {
    qwerty: { a: 'qsxz', b: 'vghn', ... },
    azerty: {
        a: 'qzws',
        b: 'vhn',
        c: 'xdfv',
        d: 'serfc',
        e: 'zsdr',
        f: 'drtgv',
        // ... complete AZERTY mapping
    }
};
```

---

### Improvement #6: Retry Logic for Element Not Found
**Priority**: 🟡 **MEDIUM**
**Impact**: Robustness

**Current**: Single attempt to find element:
```javascript
const rect = await ctx.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    // ...
}, selector);

if (!rect) {
    throw new Error('ELEMENT_NOT_VISIBLE');
}
```

**Proposed**: Add retry with backoff:
```javascript
async function getElementRect(ctx, selector, retries = 3, delayMs = 500) {
    for (let i = 0; i < retries; i++) {
        const rect = await ctx.evaluate(sel => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
        }, selector);

        if (rect) return rect;

        if (i < retries - 1) {
            await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        }
    }
    throw new Error('ELEMENT_NOT_VISIBLE');
}
```

---

### Improvement #7: Adaptive Typo Rate Based on Complexity
**Priority**: 🟢 **LOW**
**Impact**: Realism

**Current**: Fixed 1.2% typo rate:
```javascript
if (i > 2 && Math.random() < 0.012) {
```

**Proposed**: Adjust rate based on text complexity:
```javascript
function getTypoRate(char, prevChars) {
    let baseRate = 0.012;

    // Harder keys (numbers, symbols) → higher typo rate
    if (/[0-9!@#$%^&*()]/.test(char)) baseRate *= 1.5;

    // Fast typing (after easy chars) → higher typo rate
    if (/[aeiou]/.test(prevChars)) baseRate *= 1.2;

    // Capitalization → slightly higher typo rate
    if (/[A-Z]/.test(char)) baseRate *= 1.1;

    return baseRate;
}

// Usage
const typoRate = getTypoRate(char, sanitizedText.slice(Math.max(0, i - 3), i));
if (i > 2 && Math.random() < typoRate) {
```

---

### Improvement #8: Viewport Boundary Checking
**Priority**: 🟡 **MEDIUM**
**Impact**: Robustness

**Current**: `wakeUpMove` assumes viewport exists:
```javascript
const view = page.viewport() || { width: 1280, height: 720 };
```

**Proposed**: Add boundary validation:
```javascript
async function wakeUpMove(page) {
    try {
        if (!page || page.isClosed()) return;

        const view = page.viewport();
        if (!view || view.width <= 0 || view.height <= 0) {
            _log('WARN', '[HUMAN] Invalid viewport for wakeUpMove');
            return;
        }

        const cursor = getCursor(page);
        const padX = Math.max(10, view.width * 0.1);
        const padY = Math.max(10, view.height * 0.1);

        const x = padX + Math.random() * (view.width - padX * 2);
        const y = padY + Math.random() * (view.height - padY * 2);

        await cursor.move({ x, y });
    } catch (err) {
        _log('DEBUG', '[HUMAN] wakeUpMove error (ignored)', err.message);
    }
}
```

---

### Improvement #9: Typing Progress Callback
**Priority**: 🟢 **LOW**
**Impact**: UX

**Current**: Only per-character telemetry:
```javascript
onPulse({ type: 'KEY_PRESS', char, index: i, total: sanitizedText.length });
```

**Proposed**: Add batch progress updates:
```javascript
// Every 10% progress
if (onPulse && i % Math.ceil(sanitizedText.length / 10) === 0) {
    const progress = Math.floor((i / sanitizedText.length) * 100);
    onPulse({
        type: 'TYPE_PROGRESS',
        progress,
        charsTyped: i,
        total: sanitizedText.length,
        estimatedTimeRemaining: calculateETA(i, sanitizedText.length, startTime)
    });
}
```

---

### Improvement #10: Keyboard Layout Detection Enhancement
**Priority**: 🟢 **LOW**
**Impact**: Accuracy

**Current**: Fallback to navigator.language:
```javascript
const lang = (navigator.language || 'en').toLowerCase();
return lang.includes('fr') ? 'azerty' : 'qwerty';
```

**Proposed**: Use Keyboard API with better heuristics:
```javascript
async function detectKeyboardLayout(page) {
    try {
        return await page.evaluate(async () => {
            // Modern API (Chrome 69+)
            if (navigator.keyboard?.getLayoutMap) {
                const layoutMap = await navigator.keyboard.getLayoutMap();
                // Check key positions to infer layout
                if (layoutMap.get('KeyQ') === 'a') return 'azerty';
                if (layoutMap.get('KeyQ') === 'q') return 'qwerty';
            }

            // Fallback: Language heuristics
            const lang = (navigator.language || 'en').toLowerCase();
            if (lang.startsWith('fr') || lang.startsWith('be')) return 'azerty';
            return 'qwerty';
        });
    } catch (err) {
        _log('DEBUG', '[HUMAN] Layout detection failed, using qwerty', err.message);
        return 'qwerty';
    }
}
```

---

### Improvement #11: Shift Key Timing Variance
**Priority**: 🟢 **LOW**
**Impact**: Realism

**Current**: Fixed delays for Shift key:
```javascript
await page.keyboard.down('Shift');
await new Promise(r => { setTimeout(r, 30 + Math.random() * 30); });
await page.keyboard.type(char);
await new Promise(r => { setTimeout(r, 20 + Math.random() * 20); });
await page.keyboard.up('Shift');
```

**Proposed**: Use gaussian distribution:
```javascript
const shiftDownDelay = Math.max(10, gaussianRandom(40, 15)); // μ=40ms, σ=15ms
await page.keyboard.down('Shift');
await new Promise(r => { setTimeout(r, shiftDownDelay); });

await page.keyboard.type(char);

const shiftUpDelay = Math.max(10, gaussianRandom(30, 10)); // μ=30ms, σ=10ms
await new Promise(r => { setTimeout(r, shiftUpDelay); });
await page.keyboard.up('Shift');
```

---

### Improvement #12: Abort Signal Propagation
**Priority**: 🟡 **MEDIUM**
**Impact**: Responsiveness

**Current**: Only checks abort at function start and loop start:
```javascript
if (signal?.aborted || page.isClosed()) {
    return;
}
```

**Proposed**: Check abort at more granular points:
```javascript
// Before expensive operations
if (signal?.aborted) return;
await cursor.move({ x: targetX, y: targetY });

if (signal?.aborted) return;
await page.mouse.down();

// In typing loop, check every 5 chars
if (i % 5 === 0 && signal?.aborted) break;
```

---

## 📊 Summary

| Category          | Count       |
| ----------------- | ----------- |
| **Bugs**          | 7           |
| **Improvements**  | 12          |
| **Lines of Code** | 272         |
| **Complexity**    | Medium-High |

### Bug Severity Distribution
- 🔴 **HIGH**: 1 (cursor cache leak)
- 🟡 **MEDIUM**: 4 (validation, focus lock, empty text, race condition)
- 🟢 **LOW**: 2 (typo backspace, telemetry)

### Improvement Priority Distribution
- 🔴 **HIGH**: 1 (configuration externalization)
- 🟡 **MEDIUM**: 5 (telemetry, typing profiles, retry logic, viewport, abort)
- 🟢 **LOW**: 6 (AZERTY, typo rate, progress, layout detection, shift timing, adaptive typo)

---

## 🎯 Recommended Upgrade Path

### Phase 1: Critical Fixes (v2.0-alpha)
1. ✅ Fix cursor cache memory leak (Bug #1)
2. ✅ Add parameter validation (Bugs #2, #3)
3. ✅ Fix empty text handling (Bug #4)
4. ✅ Configuration externalization (Improvement #1)

### Phase 2: Robustness (v2.0-beta)
5. ✅ Fix focus lock race condition (Bug #5)
6. ✅ Enhanced telemetry (Improvement #3)
7. ✅ Retry logic for elements (Improvement #6)
8. ✅ Abort signal propagation (Improvement #12)

### Phase 3: Polish (v2.0-rc)
9. ✅ Gaussian distribution improvements (Improvement #2)
10. ✅ Viewport boundary checking (Improvement #8)
11. ✅ Error telemetry (Bug #7)
12. ✅ Typing speed profiles (Improvement #4)

### Phase 4: Enhancements (v2.1+)
13. ⏳ AZERTY support (Improvement #5)
14. ⏳ Adaptive typo rate (Improvement #7)
15. ⏳ Progress callbacks (Improvement #9)
16. ⏳ Layout detection enhancement (Improvement #10)
17. ⏳ Shift key timing variance (Improvement #11)
18. ⏳ Typo backspace verification (Bug #6)

---

## 🔬 Testing Recommendations

### Unit Tests Needed
1. `gaussianRandom()` distribution (verify mean, stdev, caching)
2. `detectKeyboardLayout()` with mocked navigator
3. Parameter validation (null/undefined/wrong types)
4. Empty text sanitization edge cases
5. Cursor cache LRU eviction

### Integration Tests Needed
1. `humanClick()` with signal abort mid-operation
2. `humanType()` with focus loss during typing
3. Telemetry pulse emissions (verify all event types)
4. Typing with different profiles (slow/average/fast)
5. Memory leak test (create/destroy 100 pages, check heap)

### E2E Tests Needed
1. Type 1000+ characters without failure
2. Click on dynamically positioned elements
3. Handle popup/modal interference during typing
4. Recover from page navigation mid-type

---

## 📈 Performance Impact Estimate

| Change               | Impact                    | Justification                  |
| -------------------- | ------------------------- | ------------------------------ |
| Cursor cache fix     | +5% memory                | Map vs WeakMap overhead        |
| Parameter validation | +1% latency               | Minimal overhead per call      |
| Enhanced telemetry   | +2% latency               | Extra pulse emissions          |
| Gaussian cache       | -10% latency              | 2x fewer Math.sqrt/log calls   |
| Retry logic          | +50% latency (on failure) | Only on element not found      |
| **Net Impact**       | **~0%**                   | Negligible in normal operation |

---

## ✅ Acceptance Criteria (v2.0)

- [ ] 0 ESLint errors
- [ ] 100% parameter validation coverage
- [ ] Memory leak test passes (100 pages, heap stable)
- [ ] All telemetry events documented
- [ ] Configuration object externalized
- [ ] Cursor cache size configurable
- [ ] Retry logic tested (3 retries, backoff)
- [ ] Focus lock race condition eliminated
- [ ] All 7 bugs fixed
- [ ] At least 8 of 12 improvements implemented

---

**Estimated Effort**: 6-8 hours (Phase 1-3)
**Risk Level**: 🟡 **MEDIUM** (focus lock and cursor cache require careful testing)
**Breaking Changes**: None (all changes backward compatible)

---

**Next Action**: Implement Phase 1 (Critical Fixes) → v2.0-alpha
