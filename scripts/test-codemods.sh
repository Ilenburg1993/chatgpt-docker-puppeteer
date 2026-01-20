#!/bin/bash
# Test file for codemod validation
# Creates a temporary test file and runs transformations

TEST_FILE="test-codemod-sample.js"

cat > "$TEST_FILE" << 'EOF'
const logger = require('./logger');

function processTask(task) {
    if (task.status === 'PENDING') {
        logger.log('INFO', 'BOOT', 'Task is pending');
        task.status = 'RUNNING';
    }

    const mode = 'hybrid';

    if (task.status === 'FAILED') {
        return { success: false };
    }

    return { success: true, status: 'DONE' };
}

module.exports = { processTask };
EOF

echo "📝 Original file:"
cat "$TEST_FILE"
echo ""
echo "🔄 Running STATUS_VALUES transform..."
npx jscodeshift -t scripts/codemods/transform-status-values.js "$TEST_FILE" --dry --print

echo ""
echo "🔄 Running LOG_CATEGORIES transform..."
npx jscodeshift -t scripts/codemods/transform-log-categories.js "$TEST_FILE" --dry --print

echo ""
echo "🔄 Running CONNECTION_MODES transform..."
npx jscodeshift -t scripts/codemods/transform-connection-modes.js "$TEST_FILE" --dry --print

# Cleanup
rm -f "$TEST_FILE"
