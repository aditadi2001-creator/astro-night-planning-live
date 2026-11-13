/**
 * The shipped engine glue code must reuse WebGL object ids (engine/patch-js.mjs):
 * the engine creates and deletes buffers every frame, and without reuse the id
 * tables grow until V8 throws "Invalid array length" after hours open.
 * This runs the actual getNewId from public/engine/stellarium-web-engine.js.
 */
import { describe, expect, it } from 'vitest';
// The shipped file, as text (Vite ?raw import).
import engineJs from '../public/engine/stellarium-web-engine.js?raw';

type Table = (object | null)[] & { __h?: number };
interface Gl {
  counter: number;
  buffers: Table;
  textures: Table;
  framebuffers: Table;
  renderbuffers: Table;
  uniforms: Table;
  getNewId: (t: Table) => number;
}

function loadGl(): Gl {
  const m = /getNewId:(function\(table\)\{.*?return ret\})/.exec(engineJs);
  if (!m?.[1]) throw new Error('getNewId not found');
  const GL = {
    counter: 1,
    buffers: [],
    textures: [],
    framebuffers: [],
    renderbuffers: [],
    uniforms: [],
  } as unknown as Gl;
  // The function refers to the global GL object; bind it explicitly.
  GL.getNewId = new Function('GL', `return ${m[1]}`)(GL) as Gl['getNewId'];
  return GL;
}

describe('engine WebGL id allocation', () => {
  it('reuses freed buffer ids, so the table stays small over many frames', () => {
    const GL = loadGl();
    for (let frame = 0; frame < 20_000; frame++) {
      const ids: number[] = [];
      for (let k = 0; k < 50; k++) {
        const id = GL.getNewId(GL.buffers);
        expect(GL.buffers[id]).toBeFalsy();
        GL.buffers[id] = {};
        ids.push(id);
      }
      for (const id of ids) GL.buffers[id] = null; // glDeleteBuffers
    }
    // 1,000,000 buffers created; never more than 50 alive at once.
    expect(GL.buffers.length).toBeLessThanOrEqual(52);
  }, 20_000); // a million allocations: allow for a busy machine

  it('never hands out id 0 or a live id', () => {
    const GL = loadGl();
    const live = new Set<number>();
    for (let k = 0; k < 500; k++) {
      const id = GL.getNewId(GL.textures);
      expect(id).toBeGreaterThan(0);
      expect(live.has(id)).toBe(false);
      GL.textures[id] = {};
      live.add(id);
      if (k % 3 === 0) {
        const victim = [...live][Math.floor(live.size / 2)] ?? 0;
        GL.textures[victim] = null;
        live.delete(victim);
      }
    }
  });

  it('keeps consecutive ids for uniform arrays', () => {
    const GL = loadGl();
    const base = GL.getNewId(GL.uniforms);
    GL.uniforms[base] = {};
    const next = [1, 2, 3].map(() => {
      const id = GL.getNewId(GL.uniforms);
      GL.uniforms[id] = null; // array element locations can be null
      return id;
    });
    expect(next).toEqual([base + 1, base + 2, base + 3]);
  });
});
