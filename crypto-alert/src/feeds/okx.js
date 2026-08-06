// Backup feed: OKX public trades channel. Symbols use Binance-style names
// externally (BTCUSDT) and are mapped to OKX instIds (BTC-USDT) on the wire.
const toInstId = (symbol) => symbol.replace(/(USDT|USDC|BTC|ETH)$/, '-$1');
const fromInstId = (instId) => instId.replaceAll('-', '');

export class OkxFeed {
  name = 'okx';

  constructor(symbols, onTick) {
    this.symbols = symbols;
    this.onTick = onTick;
    this.ws = null;
    this.stopped = false;
    this.backoffMs = 1000;
    this.lastTickAt = 0;
    this.pingTimer = null;
  }

  start() {
    this.stopped = false;
    this.#connect();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  reconnect() {
    this.ws?.close();
  }

  #connect() {
    if (this.stopped || this.symbols.length === 0) return;
    const ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.backoffMs = 1000;
      ws.send(
        JSON.stringify({
          op: 'subscribe',
          args: this.symbols.map((s) => ({ channel: 'trades', instId: toInstId(s) })),
        }),
      );
      // OKX closes connections idle for 30s; text "ping" keeps it alive.
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 20_000);
      console.log(`[okx] connected (${this.symbols.length} symbols)`);
    });

    ws.addEventListener('message', (event) => {
      if (event.data === 'pong') return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.arg?.channel !== 'trades' || !Array.isArray(msg.data)) return;
      const now = Date.now();
      this.lastTickAt = now;
      for (const t of msg.data) {
        this.onTick({
          source: this.name,
          symbol: fromInstId(msg.arg.instId),
          price: Number(t.px),
          eventTime: Number(t.ts),
          recvTime: now,
        });
      }
    });

    ws.addEventListener('close', () => {
      clearInterval(this.pingTimer);
      this.#scheduleReconnect();
    });
    ws.addEventListener('error', () => ws.close());
  }

  #scheduleReconnect() {
    if (this.stopped) return;
    console.warn(`[okx] disconnected, reconnecting in ${this.backoffMs}ms`);
    setTimeout(() => this.#connect(), this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
  }
}
