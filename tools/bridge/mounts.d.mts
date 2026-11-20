// Types for tests that import the dependency-free mount links of the bridge.
export const SERIAL_READ: Record<'lx200' | 'nexstar', string[]>;
export const SERIAL_CONTROL: Record<'lx200' | 'nexstar', string[]>;
export const INDI_CONTROL: string[];
export function serialAllowed(p: 'lx200' | 'nexstar', cmd: string, control: boolean): boolean;
export function indiNumber(s: string): number | null;
export interface IndiUpdate {
  device: string | null;
  name: string | null;
  kind: 'Number' | 'Switch' | 'Text' | 'Light';
  state: string | null;
  values: Record<string, number | string | null>;
}
export function parseIndi(buffer: string): { updates: IndiUpdate[]; rest: string };
export function indiNew(
  device: string,
  name: string,
  kind: 'Number' | 'Switch',
  values: Record<string, string | number>,
): string;
export class TcpLink {
  constructor(host: string, port: number);
  send(
    cmd: string,
    reply?: { chars?: number; none?: boolean },
    timeoutMs?: number,
  ): Promise<string>;
}
export class IndiClient {
  constructor(host: string, port: number);
  snapshot(): { connected: boolean; error: string | null; devices: Record<string, unknown> };
  send(
    device: string,
    name: string,
    kind: 'Number' | 'Switch',
    values: Record<string, string>,
  ): void;
}
