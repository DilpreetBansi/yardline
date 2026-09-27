export interface QuoteEvent {
  quoteId: string;
  kind: 'created' | 'lines_updated' | 'approved' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'ordered';
  version: number;
  actor: string;
  at: string;
  detail?: Record<string, unknown>;
}

/** In-process pub/sub. The server bridges it to SSE; the browser demo bridges it to open tabs. */
export class EventBus {
  #subs = new Set<(e: QuoteEvent) => void>();

  publish(e: QuoteEvent): void {
    for (const fn of this.#subs) {
      try {
        fn(e);
      } catch {
        // A broken subscriber must not break the request that published the event.
      }
    }
  }

  subscribe(fn: (e: QuoteEvent) => void): () => void {
    this.#subs.add(fn);
    return () => this.#subs.delete(fn);
  }
}
