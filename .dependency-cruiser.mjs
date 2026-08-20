/** @type {import('dependency-cruiser').IConfiguration} */
export default {
    forbidden: [
        {
            name: 'no-circular',
            severity: 'error',
            from: {},
            to: { circular: true },
        },
        {
            name: 'no-orphans',
            severity: 'info',
            from: { orphan: true, pathNot: '^tests/' },
            to: {},
        },
    ],
    options: {
        tsConfig: {
            fileName: 'tsconfig.json',
        },
        doNotFollow: {
            path: ['node_modules'],
        },
        exclude: {
            path: ['node_modules', 'logs', 'tmp', 'artifacts'],
        },
        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['import', 'module', 'default'],
        },
        reporterOptions: {
            dot: {
                collapsePattern: 'node_modules/[^/]+',
            },
        },
    },
};
