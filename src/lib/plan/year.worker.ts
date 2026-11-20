/// <reference lib="webworker" />
/**
 * Year planner Web Worker: a whole year of nights (darkness, Moon, target hours) and its
 * events, computed off the main thread (about a second per year).
 */
import {
  yearEvents,
  yearNights,
  type NightRow,
  type Site,
  type YearEvent,
  type YearTarget,
} from './year';

export interface YearAsk {
  id: number;
  year: number;
  site: Site;
  target: YearTarget | null;
  minAlt: number;
}
export interface YearReply {
  id: number;
  nights: NightRow[];
  events: YearEvent[];
}

self.onmessage = (e: MessageEvent<YearAsk>) => {
  const m = e.data;
  const reply: YearReply = {
    id: m.id,
    nights: yearNights(m.year, m.site, m.target, m.minAlt),
    events: yearEvents(m.year, m.site),
  };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply);
};
