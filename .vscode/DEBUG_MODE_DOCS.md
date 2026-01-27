# 🔍 Debug Mode - Complete Documentation

**Version:** 2.0 (Comprehensive Suite)
**Created:** 2026-01-22
**Tasks:** 9 validation modes

---

## 📋 Available Tasks

### Core Debug Tasks

#### 1. 🔍 Debug Mode: Full Workspace Scan
**Purpose:** Validate ALL JavaScript files in workspace
**Excludes:** backups/, node_modules/, tmp/, analysis/
**Output:** Dedicated panel with problems
**Use When:** Full codebase review

```bash
# Via CLI (equivalent)
npx eslint . --ignore-pattern 'backups/**' --format=stylish --max-warnings=999999
```

#### 2. 🔍 Debug Mode: Full Workspace + Stats
**Purpose:** Same as #1 + statistics summary
**Output:** Scan results + file count + total issues
**Use When:** You need metrics

**Example Output:**
```
=== 🔍 WORKSPACE SCAN ===
[ESLint results...]

=== 📊 STATS ===
Files: 89
Total Issues: 127
```

#### 3. 🔍 Debug Mode: Source Code Only (src/)
**Purpose:** Validate only production code
**Scope:** src/ directory
**Use When:** Pre-deployment checks

#### 4. 🔍 Debug Mode: Tests Only (tests/)
**Purpose:** Validate only test files
**Scope:** tests/ directory
**Use When:** Test quality review

#### 5. 🔍 Debug Mode: Scripts Only (scripts/)
**Purpose:** Validate automation scripts
**Scope:** scripts/ directory
**Use When:** Build/CI script maintenance

#### 6. 🔍 Debug Mode: Errors Only (No Warnings)
**Purpose:** Show ONLY errors (severity 2)
**Excludes:** All warnings
**Use When:** Critical issues before commit

#### 7. 📊 Debug Mode: Export JSON Report
**Purpose:** Generate machine-readable report
**Output File:** `eslint-report.json`
**Use When:** CI/CD integration, metrics tracking

#### 8. 📊 Debug Mode: Export HTML Report
**Purpose:** Generate visual HTML report
**Output File:** `eslint-report.html`
**Use When:** Shareable reports for team

#### 9. 🎯 Debug Mode: Master Scan (All Validations)
**Purpose:** Run ALL validation tasks sequentially
**Includes:**
- ESLint full workspace
- JSON files validation
- Shell scripts (ShellCheck)
- Git status (whitespace/conflicts)
- Node syntax check

**Use When:** Pre-release audit

---

## 🚀 How to Use

### Via Command Palette
```
1. Ctrl+Shift+P
2. Type: "Tasks: Run Task"
3. Select: "🔍 Debug Mode: [desired mode]"
```

### Via Keyboard Shortcuts (Optional)
Add to your User `keybindings.json`:

```jsonc
{
  "key": "ctrl+shift+alt+d",
  "command": "workbench.action.tasks.runTask",
  "args": "🔍 Debug Mode: Full Workspace Scan"
}
```

See `.vscode/debug-mode-keybindings.jsonc` for full list.

---

## 📊 Comparison Table

| Task                   | Scope        | Warnings | Stats | Export |
| ---------------------- | ------------ | -------- | ----- | ------ |
| Full Workspace Scan    | All files    | ✅        | ❌     | ❌      |
| Full Workspace + Stats | All files    | ✅        | ✅     | ❌      |
| Source Code Only       | src/         | ✅        | ❌     | ❌      |
| Tests Only             | tests/       | ✅        | ❌     | ❌      |
| Scripts Only           | scripts/     | ✅        | ❌     | ❌      |
| Errors Only            | All files    | ❌        | ❌     | ❌      |
| Export JSON            | All files    | ✅        | ❌     | JSON   |
| Export HTML            | All files    | ✅        | ❌     | HTML   |
| Master Scan            | All + extras | ✅        | ✅     | ❌      |

---

## 🎯 Workflow Examples

### Pre-Commit Workflow
```
1. Run: "🔍 Debug Mode: Errors Only"
2. Fix all errors
3. Run: "🔍 Debug Mode: Full Workspace Scan"
4. Review warnings
5. Commit
```

### Code Review Workflow
```
1. Run: "🔍 Debug Mode: Full Workspace + Stats"
2. Note total issues count
3. Review critical areas (src/)
4. Run: "📊 Debug Mode: Export HTML Report"
5. Share report with team
```

### CI/CD Integration
```
1. Run: "📊 Debug Mode: Export JSON Report"
2. Parse eslint-report.json in CI
3. Fail build if errors > threshold
4. Archive report as artifact
```

### Release Audit
```
1. Run: "🎯 Debug Mode: Master Scan (All Validations)"
2. Wait for all validations
3. Review aggregated results
4. Fix critical issues
5. Tag release
```

---

## 🔧 Configuration

### Excluded Directories
All tasks exclude:
- `backups/` - Backup archives
- `node_modules/` - Dependencies
- `tmp/` - Temporary files
- `analysis/` - Analysis outputs

### Problem Matchers
Tasks use `$eslint-stylish` matcher to populate VS Code Problems panel.

### Panel Behavior
- **Reveal:** Always (opens automatically)
- **Panel:** Dedicated (separate from other tasks)
- **Clear:** True (clears previous output)
- **Focus:** True (brings to front)

---

## 📁 Output Files

### JSON Report Structure
```json
{
  "filePath": "/path/to/file.js",
  "messages": [
    {
      "ruleId": "no-unused-vars",
      "severity": 1,
      "message": "'x' is defined but never used",
      "line": 10,
      "column": 5
    }
  ],
  "errorCount": 0,
  "warningCount": 1
}
```

### HTML Report Features
- Syntax-highlighted code
- Filterable by severity/rule
- Clickable file paths (if opened in browser from workspace)
- Summary statistics

---

## ⚡ Performance Notes

### Fast (< 5s)
- Source Code Only
- Tests Only
- Scripts Only

### Medium (5-15s)
- Full Workspace Scan
- Errors Only

### Slow (15-30s)
- Full Workspace + Stats
- Export JSON/HTML
- Master Scan

*Times vary based on workspace size*

---

## 🐛 Troubleshooting

### Tasks Don't Appear
1. Reload VS Code: `Ctrl+Shift+P` → "Developer: Reload Window"
2. Check tasks.json syntax: `npx jsonlint .vscode/tasks.json`

### No Output
1. Check terminal for errors
2. Verify ESLint installed: `npx eslint --version`
3. Test manually: `npx eslint . --format=stylish`

### Wrong Files Scanned
1. Check `.eslintignore` file
2. Verify `--ignore-pattern` flags in task command
3. Review `.vscode/settings.json` → `eslint.workingDirectories`

---

## 📚 Integration with Problems Panel

### Normal Mode (Default)
- Shows problems from **open files only**
- Updates on type (`eslint.run: "onType"`)
- Fast, real-time feedback

### Debug Mode (Tasks)
- Shows problems from **ALL files** (when task runs)
- Manual execution
- Complete workspace view

**They are complementary!**

---

## 🔗 Related Files

- `.vscode/tasks.json` - Task definitions
- `.vscode/settings.json` - ESLint config (normal mode)
- `.vscode/debug-mode-keybindings.jsonc` - Suggested shortcuts
- `eslint.config.mjs` - ESLint rules
- `.eslintignore` - Ignored patterns

---

## 📈 Version History

### v2.0 (2026-01-22) - Comprehensive Suite
- ✅ Added 7 new debug modes
- ✅ Scoped tasks (src/, tests/, scripts/)
- ✅ Export reports (JSON/HTML)
- ✅ Master scan task
- ✅ Emojis restored in labels
- ✅ Keybindings suggestions

### v1.0 (2026-01-22) - Initial Release
- Basic full workspace scan
- Stats variant

---

**Status:** ✅ Ready for Production Use
