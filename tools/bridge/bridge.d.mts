// Types for tests that import the dependency-free bridge script.
export const NINA_READ: string[];
export const NINA_CONTROL: string[];
export const ALPACA_READ: string[];
export const ALPACA_CONTROL: string[];
export function route(
  method: string,
  url: string,
  allowControl: boolean,
): { target: 'nina' | 'alpaca'; path: string } | null;
export function start(opts: {
  port: number;
  host: string;
  dist: string;
  nina: string;
  alpaca: string;
  allowControl: boolean;
}): import('node:http').Server;
