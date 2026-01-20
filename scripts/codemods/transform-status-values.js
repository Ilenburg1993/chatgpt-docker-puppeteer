/**
 * Codemod: Replace status value magic strings with constants
 *
 * Transforms:
 *   'PENDING' → STATUS_VALUES.PENDING
 *   'RUNNING' → STATUS_VALUES.RUNNING
 *   etc.
 *
 * Usage:
 *   npx jscodeshift -t scripts/codemods/transform-status-values.js src/path/to/file.js
 */

const path = require('path');

function getImportPath(filePath, targetPath) {
    const relativePath = path.relative(path.dirname(filePath), targetPath);
    const normalizedPath = relativePath.replace(/\\/g, '/');
    return normalizedPath.startsWith('.') ? normalizedPath : `./${normalizedPath}`;
}

module.exports = function (fileInfo, api) {
    const j = api.jscodeshift;
    const root = j(fileInfo.source);
    const constantsPath = path.join(process.cwd(), 'src/core/constants/tasks.js');
    const importPath = getImportPath(fileInfo.path, constantsPath);

    // Status values to replace
    const STATUS_VALUES = [
        'PENDING',
        'RUNNING',
        'HEALTHY',
        'FAILED',
        'IDLE',
        'SUCCESS',
        'ACCEPTED',
        'REJECTED',
        'UNHEALTHY',
        'CRASHED',
        'SKIPPED',
        'DONE',
        'PAUSED',
        'STALLED'
    ];

    let hasChanges = false;
    let needsImport = false;

    // Replace string literals with constant references
    STATUS_VALUES.forEach(value => {
        root.find(j.Literal, { value: value }).forEach(path => {
            // Skip if already using constant (e.g., in constant definitions)
            const parent = path.parent;
            if (parent.value.type === 'Property' && parent.value.key === path.value) {
                return; // Skip object keys
            }

            // Replace with member expression
            j(path).replaceWith(j.memberExpression(j.identifier('STATUS_VALUES'), j.identifier(value)));
            hasChanges = true;
            needsImport = true;
        });
    });

    if (!hasChanges) {
        return null; // No changes needed
    }

    // Check if import already exists
    const hasImport =
        root
            .find(j.VariableDeclarator, {
                id: { type: 'ObjectPattern' },
                init: {
                    callee: { name: 'require' },
                    arguments: [{ value: importPath }]
                }
            })
            .size() > 0;

    // Add import if needed and doesn't exist
    if (needsImport && !hasImport) {
        const importStatement = j.variableDeclaration('const', [
            j.variableDeclarator(
                j.objectPattern([j.property('init', j.identifier('STATUS_VALUES'), j.identifier('STATUS_VALUES'))]),
                j.callExpression(j.identifier('require'), [j.literal(importPath)])
            )
        ]);

        // Insert at the top after existing requires
        const firstRequire = root
            .find(j.VariableDeclaration, {
                declarations: [
                    {
                        init: { callee: { name: 'require' } }
                    }
                ]
            })
            .at(0);

        if (firstRequire.size() > 0) {
            firstRequire.get().insertAfter(importStatement);
        } else {
            // No requires found, insert at top of file
            root.get().node.program.body.unshift(importStatement);
        }
    }

    return root.toSource({ quote: 'single', trailingComma: false });
};
