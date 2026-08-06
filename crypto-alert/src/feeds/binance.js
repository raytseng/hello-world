// Primary feed: Binance combined @trade streams.
// @trade is the lowest-latency public price event Binance offers (per-trade,
// no server-side aggregation interval), which is why it is used instead of
// @ticker/@miniTicker (1s snapshots).
export class BinanceFeed {
  name = 'binance';

  constructor(symbols, onTick) {
    this.symbols = symbols;
    this.onTick = onTick;
    this.ws = null;
    this.stopped = false;
    this.backoffMs = 1000;
    this.lastTickAt = 0;
  }

  start() {
    this.stopped = false;
    this.#connect();
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }

  reconnect() {
    this.ws?.close();
  }

  #connect() {
    if (this.stopped || this.symbols.length === 0) return;
    const streams = this.symbols.map((s) => `${s.toLowerCase()}@trade`).join('/');
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.backoffMs = 1000;
      console.log(`[binance] connected (${this.symbols.length} symbols)`);
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      const d = msg.data;
      if (d?.e !== 'trade') return;
      const now = Date.now();
      this.lastTickAt = now;
      this.onTick({
        source: this.name,
        symbol: d.s,
        price: Number(d.p),
        eventTime: d.E,
        recvTime: now,
      });
    });

    ws.addEventListener('close', () => this.#scheduleReconnect());
    ws.addEventListener('error', () => ws.close());
  }

  #scheduleReconnect() {
    if (this.stopped) return;
    console.warn(`[binance] disconnected, reconnecting in ${this.backoffMs}ms`);
    setTimeout(() => this.#connect(), this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
  }
}
