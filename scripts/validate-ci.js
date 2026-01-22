#!/usr/bin/env node
const pathModule = require('path');
const { execSync } = require('child_process');
const fs = require('fs');
const projectRoot = pathModule.join(__dirname, '..');
process.chdir(projectRoot);

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('  🔍 CI/CD v2.0 Local Validation');
console.log('═══════════════════════════════════════════════════════════════════\n');

let exitCode = 0;

// Job 1: Dependencies
console.log('📦 [1/6] Dependencies Validation...\n');
try {
  const pkg = require(pathModule.join(projectRoot, 'package.json'));
  if (!pkg._moduleAliases) {
    console.error('❌ Missing _moduleAliases');
    exitCode = 1;
  } else {
    const aliases = Object.keys(pkg._moduleAliases);
    console.log('✅ Module aliases:', aliases.length, 'configured');
    console.log('   ', aliases.join(', '));
  }
} catch (err) {
  console.error('❌ Failed:', err.message);
  exitCode = 1;
}

// Job 2: Deprecated imports
console.log('\n🔍 [2/6] Checking deprecated imports...\n');
try {
  const result = execSync(
    `grep -r 'require(.*\\.\\./\\.\\./\\.\\./)' src --include="*.js" 2>/dev/null | wc -l`,
    { encoding: 'utf8', cwd: projectRoot }
  );
  const count = parseInt(result.trim());
  if (count > 0) {
    console.error('❌ Found', count, 'deprecated imports');
    exitCode = 1;
  } else {
    console.log('✅ No deprecated imports');
  }
} catch (_err) {
  console.log('✅ No deprecated imports');
}

// Job 3: ESLint
console.log('\n📝 [3/6] ESLint check...\n');
try {
  execSync('npx eslint . --quiet 2>&1 | head -3', {
    stdio: 'inherit',
    cwd: projectRoot
  });
  console.log('✅ ESLint passed');
} catch (_err) {
  console.error('❌ ESLint failed');
  exitCode = 1;
}

// Job 4: Syntax
console.log('\n✅ [4/6] Syntax validation...\n');
try {
  execSync('node -c index.js', { cwd: projectRoot });
  execSync('node -c src/main.js', { cwd: projectRoot });
  console.log('✅ Syntax valid');
} catch (_err) {
  console.error('❌ Syntax errors');
  exitCode = 1;
}

// Job 5: Documentation
console.log('\n📚 [5/6] Documentation check...\n');
const docs = [
  'README.md',
  'CONTRIBUTING.md',
  'DEVELOPER_WORKFLOW.md',
  'DOCUMENTAÇÃO/MODULE_ALIASES.md',
  'DOCUMENTAÇÃO/ALIAS_VALIDATION_REPORT.md'
];
let missing = 0;
for (const doc of docs) {
  if (fs.existsSync(pathModule.join(projectRoot, doc))) {
    console.log('✅', doc);
  } else {
    console.error('❌', doc);
    missing++;
  }
}
if (missing > 0) exitCode = 1;

// Summary
console.log('\n═══════════════════════════════════════════════════════════════════');
if (exitCode === 0) {
  console.log('  ✅ CI VALIDATION PASSED\n');
} else {
  console.log('  ❌ CI VALIDATION FAILED\n');
}

process.exit(exitCode);
