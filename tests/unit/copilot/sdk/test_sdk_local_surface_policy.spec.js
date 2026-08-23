import { describe, expect, it } from 'vitest';

import {
    SDK_LOCAL_FS_TOOL_NAMES,
    buildCanonicalLocalSurfaceExcludedTools,
    hasCanonicalLocalFsTools,
} from '#copilot/sdk/tools';
import { decideSdkFsRouting } from '../../../../src/copilot/presentation/files/routing.js';

describe('sdk/tools local surface policy', () => {
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

    it('oculta built-ins SDK concorrentes apenas quando o FS canônico está completo', () => {
        expect(buildCanonicalLocalSurfaceExcludedTools(canonicalFsTools, ['web_fetch'])).toEqual(
            [...SDK_LOCAL_FS_TOOL_NAMES, 'web_fetch'].sort(),
        );
        expect(buildCanonicalLocalSurfaceExcludedTools(['read_file_content'], ['web_fetch'])).toEqual(['web_fetch']);
    });

    it('presentation prioriza FS local canônico quando a capability está pronta', () => {
        expect(decideSdkFsRouting({ canonicalFsReady: true, sdkWorkspaceAvailable: true }).mode).toBe(
            'local-fs-primary',
        );
    });
});
