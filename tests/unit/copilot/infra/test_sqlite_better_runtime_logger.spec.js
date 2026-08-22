// @ts-check

import { createBetterSqliteApplicationRuntime } from '#copilot/infra/internal/database/sqlite/better-sqlite3';
import { describe, expect, it } from 'vitest';

describe('Infra better-sqlite3 resource logging', () => {
    it('keeps logger ownership resource-local and never needs a process-global setter', () => {
        /** @type {Array<{level:string;message:string}>} */
        const firstEvents = [];
        /** @type {Array<{level:string;message:string}>} */
        const secondEvents = [];
        const first = createBetterSqliteApplicationRuntime({
            dbPath: ':memory:',
            log: (level, message) => firstEvents.push({ level, message }),
        });
        const second = createBetterSqliteApplicationRuntime({
            dbPath: ':memory:',
            log: (level, message) => secondEvents.push({ level, message }),
        });
        try {
            first.getDatabase();
            expect(
                firstEvents.some((event) => event.level === 'INFO' && event.message.includes('SQLite copilot ready')),
            ).toBe(true);
            expect(secondEvents).toEqual([]);

            second.getDatabase();
            expect(
                secondEvents.some((event) => event.level === 'INFO' && event.message.includes('SQLite copilot ready')),
            ).toBe(true);
        } finally {
            first.close();
            second.close();
        }
    });
});
