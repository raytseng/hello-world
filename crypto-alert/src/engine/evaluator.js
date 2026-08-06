// Rule engine. Fully in-memory on the tick hot path — no I/O between a tick
// arriving and an alert being dispatched.
//
// Rule types:
//   { symbol, type: "cross_above", price, cooldownSec? }
//   { symbol, type: "cross_below", price, cooldownSec? }
//   { symbol, type: "pct_change", windowMin, pct, cooldownSec? }  // fires on |move| >= pct within window
const DEFAULT_COOLDOWN_SEC = 900;

const fmtPrice = (p) =>
  p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(p);

export class Evaluator {
  /**
   * @param getSubscribers () => [{ id, active, channels, rules }]
   * @param notify (subscriber, text) => void
   */
  constructor(getSubscribers, notify) {
    this.getSubscribers = getSubscribers;
    this.notify = notify;
    this.ruleState = new Map(); // `${subId}:${ruleIdx}` -> { lastPrice, lastFiredAt, window: [{t, price}] }
  }

  onTick(tick) {
    for (const sub of this.getSubscribers()) {
      if (!sub.active) continue;
      for (let i = 0; i < sub.rules.length; i++) {
        const rule = sub.rules[i];
        if (rule.symbol !== tick.symbol) continue;
        const key = `${sub.id}:${i}`;
        let state = this.ruleState.get(key);
        if (!state) {
          state = { lastPrice: null, lastFiredAt: 0, window: [] };
          this.ruleState.set(key, state);
        }
        const text = this.#evaluate(rule, state, tick);
        state.lastPrice = tick.price;
        if (!text) continue;

        const cooldownMs = (rule.cooldownSec ?? DEFAULT_COOLDOWN_SEC) * 1000;
        if (tick.recvTime - state.lastFiredAt < cooldownMs) continue;
        state.lastFiredAt = tick.recvTime;

        const latencyMs = tick.recvTime - tick.eventTime;
        this.notify(sub, `${text}\n來源 ${tick.source}・行情延遲 ${latencyMs}ms`);
      }
    }
  }

  #evaluate(rule, state, tick) {
    const { price } = tick;
    switch (rule.type) {
      case 'cross_above':
        if (state.lastPrice !== null && state.lastPrice < rule.price && price >= rule.price) {
          return `🚀 ${rule.symbol} 向上突破 ${fmtPrice(rule.price)}\n現價 ${fmtPrice(price)}`;
        }
        return null;

      case 'cross_below':
        if (state.lastPrice !== null && state.lastPrice > rule.price && price <= rule.price) {
          return `📉 ${rule.symbol} 向下跌破 ${fmtPrice(rule.price)}\n現價 ${fmtPrice(price)}`;
        }
        return null;

      case 'pct_change': {
        const windowMs = rule.windowMin * 60_000;
        const w = state.window;
        w.push({ t: tick.recvTime, price });
        while (w.length && w[0].t < tick.recvTime - windowMs) w.shift();
        const oldest = w[0];
        const changePct = ((price - oldest.price) / oldest.price) * 100;
        if (Math.abs(changePct) >= rule.pct) {
          const dir = changePct > 0 ? '📈 急漲' : '📉 急跌';
          // Reset the window so the next alert measures a fresh move instead
          // of re-firing on the same one after cooldown.
          state.window = [{ t: tick.recvTime, price }];
          return `${dir} ${rule.symbol} ${rule.windowMin} 分鐘內 ${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%\n現價 ${fmtPrice(price)}`;
        }
        return null;
      }

      default:
        return null;
    }
  }
}
