// Types for tests that import the dependency-free bridge script.
export const NINA_READ: string[];
export const NINA_CONTROL: string[];
export const ALPACA_READ: string[];
export const ALPACA_CONTROL: string[];
export { INDI_CONTROL, SERIAL_CONTROL, SERIAL_READ } from './mounts.mjs';
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
  indi?: string | null;
  tcp?: string | null;
  tcpProtocol?: 'lx200' | 'nexstar';
  allowControl: boolean;
}): import('node:http').Server;
export function corsOrigin(origin: string | undefined): string | null;
export const ORIGINS: RegExp[];
