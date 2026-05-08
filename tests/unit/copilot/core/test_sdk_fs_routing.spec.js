import { describe, expect, it } from 'vitest';

import {
    LEGACY_SDK_LOCAL_FS_TOOL_NAMES,
    buildCanonicalLocalFsExcludedTools,
    decideSdkFsRouting,
    hasCanonicalLocalFsTools,
} from '../../../../src/copilot/core/sdk-fs-routing.js';

describe('core/sdk-fs-routing', () => {
    const canonicalFsTools = [
        'list_directory',
        'read_file_content',
        'search_in_files',
        'create_file',
        'write_file_content',
        'patch_file',
    ];

    it('detecta superfície canônica local completa', () => {
        expect(hasCanonicalLocalFsTools(canonicalFsTools)).toBe(true);
        expect(hasCanonicalLocalFsTools(['read_file_content'])).toBe(false);
    });

    it('oculta built-ins legadas apenas quando FS canônico está completo', () => {
        expect(buildCanonicalLocalFsExcludedTools(canonicalFsTools, ['web_fetch'])).toEqual(
            [...LEGACY_SDK_LOCAL_FS_TOOL_NAMES, 'web_fetch'].sort(),
        );
        expect(buildCanonicalLocalFsExcludedTools(['read_file_content'], ['web_fetch'])).toEqual(['web_fetch']);
    });

    it('prioriza FS local canônico no roteamento', () => {
        expect(decideSdkFsRouting({ canonicalFsReady: true, sdkWorkspaceAvailable: true }).mode).toBe(
            'local-fs-primary',
        );
    });
});
