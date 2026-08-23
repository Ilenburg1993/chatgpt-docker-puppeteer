// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';
const log = vi.fn();
const trackError = vi.fn();
vi.mock('../../../../src/copilot/observability/logger.js', () => ({ log }));
vi.mock('../../../../src/copilot/observability/error-tracker.js', () => ({ defaultErrorTracker: { trackError } }));
const { logSwallowed, wrapAsync } = await import('../../../../src/copilot/observability/swallowed.js');
describe('observability/swallowed', () => {
    beforeEach(() => {
        log.mockClear();
        trackError.mockClear();
    });
    it('reports swallowed errors without rethrowing', () => {
        const error = new Error('boom');
        expect(() => logSwallowed(error, 'test.ctx')).not.toThrow();
        expect(log).toHaveBeenCalledWith('DEBUG', '[swallowed:test.ctx] boom');
        expect(trackError).toHaveBeenCalledWith(error, { source: 'swallowed:test.ctx' });
    });
    it('wrapAsync preserves success and returns undefined on intentional containment', async () => {
        await expect(wrapAsync(async () => 42, 'ok')).resolves.toBe(42);
        await expect(
            wrapAsync(async () => {
                throw new Error('nope');
            }, 'fail'),
        ).resolves.toBeUndefined();
    });
    it('reporter failures cannot change caller control flow', () => {
        log.mockImplementationOnce(() => {
            throw new Error('logger down');
        });
        trackError.mockImplementationOnce(() => {
            throw new Error('tracker down');
        });
        expect(() => logSwallowed('original', 'resilience')).not.toThrow();
    });
});
