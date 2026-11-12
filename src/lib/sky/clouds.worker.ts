/// <reference lib="webworker" />
// Builds the cloud texture off the main thread so dragging the sky stays smooth.
import { renderClouds, type CloudInput } from './clouds';

self.onmessage = (e: MessageEvent<{ id: number; input: CloudInput }>) => {
  const { id, input } = e.data;
  const img = renderClouds(input);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, img }, [img.buffer]);
};
