// Tiny concurrency-limited queue. Critical for the "drag 200 PDFs in" case —
// we don't want 200 simultaneous calls to a local Ollama instance or 200
// simultaneous billable API calls.

type Job<T> = () => Promise<T>;

export class Queue {
  private active = 0;
  private waiting: Array<() => void> = [];

  constructor(private concurrency: number) {}

  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, n);
    this.drain();
  }

  async run<T>(job: Job<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    try {
      return await job();
    } finally {
      this.active--;
      this.drain();
    }
  }

  private drain(): void {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const next = this.waiting.shift();
      if (next) next();
    }
  }
}
