// @ts-check
import assert from 'node:assert/strict';

import { RBAC_PERMISSIONS } from '#infra/db/rbac_repo';
import { hasPermission } from '#server/domain/rbac_policy';

test('wave18: matriz RBAC respeita owner/admin/operator/viewer', () => {
    const owner = { role: 'owner', permissions: [] };
    const admin = { role: 'admin', permissions: [] };
    const operator = {
        role: 'operator',
        permissions: [
            RBAC_PERMISSIONS.MISSION_EXECUTE,
            RBAC_PERMISSIONS.TASK_CANCEL,
            RBAC_PERMISSIONS.DASHBOARD_COMMAND,
        ],
    };
    const viewer = { role: 'viewer', permissions: [RBAC_PERMISSIONS.TASK_READ] };

    assert.equal(hasPermission(owner, RBAC_PERMISSIONS.RBAC_MANAGE), true);
    assert.equal(hasPermission(admin, RBAC_PERMISSIONS.MISSION_EXECUTE), true);
    assert.equal(hasPermission(admin, RBAC_PERMISSIONS.RBAC_MANAGE), false);
    assert.equal(hasPermission(operator, RBAC_PERMISSIONS.TASK_CANCEL), true);
    assert.equal(hasPermission(operator, RBAC_PERMISSIONS.RBAC_MANAGE), false);
    assert.equal(hasPermission(viewer, RBAC_PERMISSIONS.TASK_READ), true);
    assert.equal(hasPermission(viewer, RBAC_PERMISSIONS.TASK_CANCEL), false);
});
