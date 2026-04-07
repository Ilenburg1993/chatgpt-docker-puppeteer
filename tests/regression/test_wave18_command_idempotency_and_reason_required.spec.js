// @ts-check
import assert from 'node:assert/strict';

import { validateCommand } from '#server/domain/control_command_service';

test('wave18: control commands exigem reason e idempotency_key por padrão', () => {
    const actor = { id: 'owner-1', username: 'owner', role: 'owner', permissions: [] };

    const missingBoth = validateCommand({
        command: 'MISSION_EXECUTE',
        payload: { mission_id: 'mission-1' },
        actor,
    });
    assert.equal(missingBoth.ok, false);
    assert.match(String(missingBoth.code), /CONTROL_REASON_REQUIRED|CONTROL_IDEMPOTENCY_REQUIRED/);

    const valid = validateCommand({
        command: 'MISSION_EXECUTE',
        payload: {
            mission_id: 'mission-1',
            reason: 'Teste',
            idempotency_key: 'idem-wave18-1',
        },
        actor,
    });
    assert.equal(valid.ok, true);
});
