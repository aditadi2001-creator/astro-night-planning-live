// Post-link fixes to the Emscripten-generated stellarium-web-engine.js.
//
// 1. GL object ids are never reused (emsdk 1.39's GL.getNewId hands out ids
//    from one ever-growing counter and deleting an object only nulls its
//    slot). The engine creates and deletes buffers every frame, so the id
//    tables grow without bound; after a few hours open (a whole observing
//    night) V8 throws "RangeError: Invalid array length" inside glGenBuffers
//    and the sky stops rendering. For the per-frame object kinds (buffers,
//    textures, framebuffers, renderbuffers) freed slots are reused, scanning
//    from just after the last id handed out. Reusing a deleted name is allowed
//    by GL. Uniform locations keep the original allocator: arrays rely on
//    consecutive ids there.

const ORIGINAL =
  'getNewId:function(table){var ret=GL.counter++;for(var i=table.length;i<ret;i++){table[i]=null}return ret}';

const PATCHED =
  'getNewId:function(table){' +
  'if(table===GL.buffers||table===GL.textures||table===GL.framebuffers||table===GL.renderbuffers){' +
  'var n=table.length;if(n>1){var h=table.__h||1;for(var c=0;c<n-1;c++){var k=1+(h-1+c)%(n-1);' +
  'if(!table[k]){table.__h=k+1;return k}}}' +
  'var r=n||1;for(var j=n;j<r;j++){table[j]=null}table.__h=r+1;return r}' +
  'var ret=GL.counter++;for(var i=table.length;i<ret;i++){table[i]=null}return ret}';

/** Apply the fixes; throws if the generated code no longer looks as expected. */
export function patchEngineJs(code) {
  if (code.includes(PATCHED)) return code;
  if (!code.includes(ORIGINAL)) {
    throw new Error('patch-js: GL.getNewId not found in the expected form (emsdk changed?)');
  }
  return code.replace(ORIGINAL, PATCHED);
}

export const GETNEWID_PATCHED = PATCHED;
