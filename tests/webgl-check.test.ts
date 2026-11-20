import { describe, expect, it } from 'vitest';
import { webglAvailable } from '../src/lib/engine/stel';

const docWith = (ctx: unknown) =>
  ({ createElement: () => ({ getContext: () => ctx }) }) as unknown as Document;

describe('WebGL check before starting the sky engine', () => {
  it('reports no WebGL (the sky then shows a message instead of throwing on every frame)', () => {
    expect(webglAvailable(docWith(null))).toBe(false);
    const throwing = {
      createElement: () => ({
        getContext: () => {
          throw new Error('blocked');
        },
      }),
    } as unknown as Document;
    expect(webglAvailable(throwing)).toBe(false);
  });

  it('accepts a working context and releases the scratch one', () => {
    let lost = false;
    const gl = { getExtension: () => ({ loseContext: () => (lost = true) }) };
    expect(webglAvailable(docWith(gl))).toBe(true);
    expect(lost).toBe(true);
  });
});
