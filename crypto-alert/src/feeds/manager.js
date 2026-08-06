import { BinanceFeed } from './binance.js';
import { OkxFeed } from './okx.js';

// Runs the primary feed with a staleness watchdog. If the primary goes quiet
// past staleAfterMs it is force-reconnected; past failoverAfterMs the backup
// feed is started and its ticks are used until the primary recovers. Only the
// active feed's ticks reach the engine, so rule state never sees two sources
// interleaved (mixed sources cause false threshold-crossing oscillation).
export class FeedManager {
  constructor(symbols, onTick, { staleAfterMs, failoverAfterMs, onStatusChange }) {
    this.onTick = onTick;
    this.staleAfterMs = staleAfterMs;
    this.failoverAfterMs = failoverAfterMs;
    this.onStatusChange = onStatusChange ?? (() => {});
    this.active = 'binance';
    this.startedAt = Date.now();

    this.primary = new BinanceFeed(symbols, (tick) => {
      if (this.active === 'binance') this.onTick(tick);
    });
    this.backup = new OkxFeed(symbols, (tick) => {
      if (this.active === 'okx') this.onTick(tick);
    });
    this.backupRunning = false;
    this.watchdog = null;
  }

  start() {
    this.primary.lastTickAt = Date.now();
    this.primary.start();
    this.watchdog = setInterval(() => this.#check(), 2000);
  }

  stop() {
    clearInterval(this.watchdog);
    this.primary.stop();
    if (this.backupRunning) this.backup.stop();
  }

  setSymbols(symbols) {
    this.primary.stop();
    if (this.backupRunning) this.backup.stop();
    this.primary.symbols = symbols;
    this.backup.symbols = symbols;
    this.primary.lastTickAt = Date.now();
    this.primary.start();
    if (this.backupRunning) {
      this.backup.lastTickAt = Date.now();
      this.backup.start();
    }
  }

  status() {
    return {
      active: this.active,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      primaryLastTickAgoMs: this.primary.lastTickAt ? Date.now() - this.primary.lastTickAt : null,
      backupLastTickAgoMs: this.backup.lastTickAt ? Date.now() - this.backup.lastTickAt : null,
    };
  }

  #check() {
    const now = Date.now();
    const primaryAge = now - this.primary.lastTickAt;

    if (this.active === 'binance') {
      if (primaryAge > this.failoverAfterMs) {
        this.active = 'okx';
        if (!this.backupRunning) {
          this.backup.lastTickAt = now;
          this.backup.start();
          this.backupRunning = true;
        }
        this.onStatusChange(`⚠️ Binance feed 靜默 ${Math.round(primaryAge / 1000)}s,已切換到 OKX 備援`);
      } else if (primaryAge > this.staleAfterMs) {
        this.primary.reconnect();
      }
    } else {
      // Recover to primary only after it has produced a fresh tick.
      if (primaryAge < this.staleAfterMs) {
        this.active = 'binance';
        this.backup.stop();
        this.backupRunning = false;
        this.onStatusChange('✅ Binance feed 恢復,已切回主來源');
      } else {
        // A half-open socket stays "connected" but silent — keep kicking the
        // primary while degraded, or it would never produce the fresh tick
        // that triggers recovery.
        if (now - (this.lastPrimaryKickAt ?? 0) > this.staleAfterMs) {
          this.primary.reconnect();
          this.lastPrimaryKickAt = now;
        }
        const backupAge = now - this.backup.lastTickAt;
        if (backupAge > this.staleAfterMs) this.backup.reconnect();
      }
    }
  }
}
