/**
 * Codemod: Replace log category magic strings with constants
 *
 * Transforms:
 *   '[BOOT]' → LOG_CATEGORIES.BOOT (in strings)
 *   'BOOT' → LOG_CATEGORIES.BOOT (standalone)
 *
 * Usage:
 *   npx jscodeshift -t scripts/codemods/transform-log-categories.js src/path/to/file.js
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
    const constantsPath = path.join(process.cwd(), 'src/core/constants/logging.js');
    const importPath = getImportPath(fileInfo.path, constantsPath);

    // Log categories to replace (top 20 most used)
    const LOG_CATEGORIES = [
        'BOOT',
        'LIFECYCLE',
        'V500',
        'ORCH',
        'FACTORY',
        'SHUTDOWN',
        'API_TASKS',
        'POLICY',
        'V700',
        'V800',
        'RECOVERY',
        'PM2_BRIDGE',
        'RECONCILER',
        'API_SYSTEM',
        'LOG_TAIL',
        'FS_WATCHER',
        'LOADER',
        'DNA_STORE',
        'SIGNAL',
        'LOG_WATCHER'
    ];

    let hasChanges = false;
    let needsImport = false;

    // Replace standalone literal strings
    LOG_CATEGORIES.forEach(category => {
        root.find(j.Literal, { value: category }).forEach(path => {
            // Skip if in object key position
            const parent = path.parent;
            if (parent.value.type === 'Property' && parent.value.key === path.value) {
                return;
            }

            // Replace with member expression
            j(path).replaceWith(j.memberExpression(j.identifier('LOG_CATEGORIES'), j.identifier(category)));
            hasChanges = true;
            needsImport = true;
        });
    });

    if (!hasChanges) {
        return null;
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

    // Add import if needed
    if (needsImport && !hasImport) {
        const importStatement = j.variableDeclaration('const', [
            j.variableDeclarator(
                j.objectPattern([j.property('init', j.identifier('LOG_CATEGORIES'), j.identifier('LOG_CATEGORIES'))]),
                j.callExpression(j.identifier('require'), [j.literal(importPath)])
            )
        ]);

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
            root.get().node.program.body.unshift(importStatement);
        }
    }

    return root.toSource({ quote: 'single', trailingComma: false });
};
