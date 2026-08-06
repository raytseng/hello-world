import { config } from './config.js';
import { Store } from './store/store.js';
import { createNotifier } from './notify/index.js';
import { Evaluator } from './engine/evaluator.js';
import { FeedManager } from './feeds/manager.js';
import { createPaymentServer } from './payments/server.js';

const notifier = createNotifier(config);

const store = new Store({
  rulesFile: config.rulesFile,
  dataDir: config.dataDir,
  billingEnabled: config.billingEnabled,
  onRulesChange: (symbolsChanged) => {
    if (symbolsChanged) feedManager.setSymbols(store.symbols());
  },
});

const evaluator = new Evaluator(
  () => store.getSubscribers(),
  (sub, text) => notifier.notify(sub, text),
);

const feedManager = new FeedManager(store.symbols(), (tick) => evaluator.onTick(tick), {
  staleAfterMs: config.staleAfterMs,
  failoverAfterMs: config.failoverAfterMs,
  onStatusChange: (msg) => notifier.notifyAdmin(msg),
});

if (store.symbols().length === 0) {
  console.error('rules.json has no rules — copy rules.example.json to rules.json first');
  process.exit(1);
}

feedManager.start();
console.log(`[engine] watching ${store.symbols().join(', ')} | billing ${config.billingEnabled ? 'ON' : 'off'}`);

if (config.billingEnabled) {
  setInterval(() => {
    for (const { subscriber, paidUntil } of store.dueForExpiryReminder()) {
      notifier.notify(
        subscriber,
        `⏰ 你的訂閱將於 ${paidUntil.slice(0, 10)} 到期,續費後警報不中斷。`,
      );
    }
  }, 3_600_000);
}

if (config.port) {
  const server = createPaymentServer({
    config,
    store,
    feedManager,
    onCredit: (subscriberId, days, paidUntil, method) =>
      notifier.notifyAdmin(`💰 ${subscriberId} 付款成功(${method},+${days} 天,至 ${paidUntil.slice(0, 10)})`),
  });
  server.listen(config.port, () => console.log(`[payments] listening on :${config.port}`));
}

process.on('SIGINT', () => {
  feedManager.stop();
  process.exit(0);
});
