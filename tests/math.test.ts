import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mathTrace } from './mathTrace';

/** sha256 of Kinoko's C++ egg/math output for the sequence in mathTrace.ts. */
const KINOKO_TRACE_SHA256 = '97b0e48882fc361f01b2a14c63144a1f720be9e044e0b1a3b13bb6fd87d44fee';

describe('math core', () => {
    it('is bit-exact with Kinoko', () => {
        const trace = mathTrace().join('\n') + '\n';
        expect(createHash('sha256').update(trace).digest('hex')).toBe(KINOKO_TRACE_SHA256);
    });
});
