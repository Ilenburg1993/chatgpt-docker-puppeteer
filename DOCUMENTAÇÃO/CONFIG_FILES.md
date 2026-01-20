# Configuration Files Documentation

## Overview

This project uses two main configuration files:

- `config.json` - Main application parameters (validated with Zod schema)
- `dynamic_rules.json` - Target-specific selectors and behavior overrides (hot-reloadable)

---

## config.json

### Structure

```json
{
    "DEBUG_PORT": "http://localhost:9222",
    "IDLE_SLEEP": 3000,
    "CYCLE_DELAY": 2000,
    "TASK_TIMEOUT_MS": 1800000,
    "allowedDomains": ["chatgpt.com", "gemini.google.com"]
}
```

### Validation

All parameters are validated using Zod schema in [src/core/config.js](../src/core/config.js):

```javascript
const ConfigSchema = z.object({
    DEBUG_PORT: z.string().url().default('http://localhost:9222'),
    IDLE_SLEEP: z.number().min(500).default(3000),
    CYCLE_DELAY: z.number().min(0).default(2000)
    // ... more fields
});
```

### Key Parameters

#### Infrastructure

- **DEBUG_PORT**: Chrome remote debugging URL
    - Type: `string (URL)`
    - Default: `http://localhost:9222`
    - Example: `http://host.docker.internal:9222`

#### Engine Rhythm

- **CYCLE_DELAY**: Delay between task processing cycles (ms)
    - Type: `number`
    - Default: `2000`
    - Range: `≥0`

- **IDLE_SLEEP**: Sleep time when queue is empty (ms)
    - Type: `number`
    - Default: `3000`
    - Range: `≥500`

- **PAUSED_SLEEP**: Sleep time when engine is paused (ms)
    - Type: `number`
    - Default: `2000`
    - Range: `≥1000`

#### Timeouts

- **TASK_TIMEOUT_MS**: Maximum execution time per task
    - Type: `number`
    - Default: `1800000` (30 minutes)

- **PROGRESS_TIMEOUT_MS**: Timeout for response progress detection
    - Type: `number`
    - Default: `90000` (90 seconds)

- **HEARTBEAT_TIMEOUT_MS**: IPC heartbeat timeout
    - Type: `number`
    - Default: `15000` (15 seconds)

#### Execution Limits

- **MAX_CONTINUATIONS**: Maximum response continuation iterations
    - Type: `number`
    - Default: `25`

- **MAX_OUT_BYTES**: Maximum response size in bytes
    - Type: `number`
    - Default: `10485760` (10MB)

#### Security

- **allowedDomains**: Whitelist of allowed target domains
    - Type: `string[]`
    - Default: `["chatgpt.com", "claude.ai", "gemini.google.com", "openai.com"]`

### Hot Reload

Configuration is reloaded automatically when file changes:

```javascript
// Trigger reload
await CONFIG.reload('manual-update');

// Listen for updates
CONFIG.on('updated', ({ new, old }) => {
  console.log('Config updated:', new);
});
```

### Validation Errors

If validation fails, the system maintains the previous valid configuration:

```
[ERROR] [CONFIG] Falha na validação do config.json: Invalid type: expected number, received string
```

---

## dynamic_rules.json

### Structure

```json
{
    "_meta": {
        "version": 5,
        "last_updated": "2026-01-18T12:06:03.846Z",
        "updated_by": "SADI_SYSTEM",
        "evolution_count": 2
    },
    "targets": {
        "chatgpt.com": {
            "selectors": {
                "input_box": ["#prompt-textarea", "div[contenteditable='true']"],
                "send_button": ["button[type='submit']"]
            },
            "behavior_overrides": {}
        }
    },
    "global_selectors": {
        "input_box": ["textarea", "[role='textbox']"],
        "send_button": ["button[type='submit']"]
    }
}
```

### Purpose

Target-specific automation rules that can be updated without restarting the agent:

- **CSS selectors** for input boxes, buttons, etc.
- **Behavior overrides** for special handling
- **Evolution tracking** via metadata

### Metadata Fields

- **version**: Incremental version number
- **last_updated**: ISO timestamp of last update
- **updated_by**: System or user who made the update
- **evolution_count**: Number of automatic evolutions (SADI)

### Target-Specific Selectors

Each target domain can have custom selectors:

```json
{
    "targets": {
        "chatgpt.com": {
            "selectors": {
                "input_box": [
                    "#prompt-textarea", // Try first
                    "div[contenteditable='true']", // Fallback
                    "textarea" // Last resort
                ]
            }
        }
    }
}
```

**Selector Priority**: First match wins (top-to-bottom)

### Global Selectors (Fallback)

Used when no target-specific selector is found:

```json
{
    "global_selectors": {
        "input_box": ["textarea", "div[contenteditable='true']", "[role='textbox']", "input[type='text']"]
    }
}
```

### Behavior Overrides

Custom behavior for specific targets:

```json
{
    "targets": {
        "chatgpt.com": {
            "behavior_overrides": {
                "typing_speed": "slow",
                "wait_after_submit": 3000,
                "disable_ghost_cursor": false
            }
        }
    }
}
```

### Hot Reload

Changes to `dynamic_rules.json` are detected automatically via file watcher. No restart required.

---

## Security Considerations

### 1. Sensitive Data

**Never commit:**

- `.env` files (credentials)
- `fila/` directory (tasks may contain sensitive prompts)
- `respostas/` directory (AI responses may contain sensitive data)
- `profile/` directory (browser sessions)
- `logs/` directory (may contain personal information)

See [.gitignore](../.gitignore) for complete exclusion list.

### 2. Domain Whitelist

Only domains in `allowedDomains` are permitted:

```json
{
    "allowedDomains": ["chatgpt.com", "gemini.google.com"]
}
```

**Attempting to use unlisted domains will fail validation.**

### 3. Timeout Limits

Enforce reasonable timeouts to prevent resource exhaustion:

- Task timeout: 30 minutes default
- Progress timeout: 90 seconds
- Heartbeat timeout: 15 seconds

### 4. Size Limits

Prevent memory issues:

- Max response size: 10MB (`MAX_OUT_BYTES`)
- Max continuations: 25 iterations

---

## Validation Testing

### Test config.json validation

```bash
node -e "
const CONFIG = require('./src/core/config');
CONFIG.reload('test').then(() => {
  console.log('✓ Config valid:', CONFIG.all);
}).catch(err => {
  console.error('✗ Config invalid:', err.message);
});
"
```

### Test schema validation

```bash
npm run test:schema
```

---

## Environment Variable Override

Some settings can be overridden via environment variables:

```bash
# .env
CHROME_WS_ENDPOINT=ws://host.docker.internal:9222
MAX_WORKERS=5
TASK_TIMEOUT=60000
```

**Priority**: Environment variables > config.json > Schema defaults

---

## Troubleshooting

### Config Not Loading

**Symptom**: Config values not applied

**Solutions**:

1. Check JSON syntax: `node -e "require('./config.json')"`
2. Review logs for validation errors
3. Verify file permissions: `ls -la config.json`
4. Test reload: `CONFIG.reload('manual')`

### Dynamic Rules Not Updating

**Symptom**: Selector changes not reflected

**Solutions**:

1. Check file watcher is running
2. Verify JSON syntax in `dynamic_rules.json`
3. Check logs for parsing errors
4. Restart agent if file watcher failed

### Domain Not Allowed

**Symptom**: Task fails with domain error

**Solution**: Add domain to `allowedDomains` in config.json:

```json
{
    "allowedDomains": ["chatgpt.com", "new-domain.com"]
}
```

Then reload: `CONFIG.reload('domain-update')`

---

## Best Practices

1. **Version Control**: Track changes to config files
2. **Documentation**: Comment changes in commit messages
3. **Validation**: Always test config changes before deploy
4. **Backups**: Keep backups of working configurations
5. **Environment-Specific**: Use `.env` for environment differences
6. **Security**: Never commit secrets or sensitive data
7. **Evolution Tracking**: Monitor `dynamic_rules.json` version increments

---

## Related Documentation

- [Configuration Guide](CONFIGURATION.md) - Complete environment variable reference
- [src/core/config.js](../src/core/config.js) - Zod schema implementation
- [.env.example](../.env.example) - Environment variable template
