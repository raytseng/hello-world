import fs from 'node:fs';
import path from 'node:path';

// rules.json holds subscribers + their rules (human-edited, hot-reloaded).
// data/entitlements.json holds paid-until timestamps (machine-written by
// payment webhooks). Kept separate so a manual rules edit can never clobber
// billing state.
export class Store {
  constructor({ rulesFile, dataDir, billingEnabled, onRulesChange }) {
    this.rulesFile = rulesFile;
    this.entitlementsFile = path.join(dataDir, 'entitlements.json');
    this.billingEnabled = billingEnabled;
    this.onRulesChange = onRulesChange ?? (() => {});
    this.subscribers = [];
    this.entitlements = {}; // subscriberId -> { paidUntil: ISO, lastReminderAt?: ISO }

    fs.mkdirSync(dataDir, { recursive: true });
    this.#loadRules();
    this.#loadEntitlements();
    this.#watchRules();
  }

  getSubscribers() {
    return this.subscribers.map((sub) => ({
      ...sub,
      active: this.isActive(sub.id),
    }));
  }

  symbols() {
    const set = new Set();
    for (const sub of this.subscribers) {
      for (const rule of sub.rules ?? []) set.add(rule.symbol);
    }
    return [...set].sort();
  }

  isActive(subscriberId) {
    if (!this.billingEnabled) return true;
    const ent = this.entitlements[subscriberId];
    return Boolean(ent && new Date(ent.paidUntil).getTime() > Date.now());
  }

  addEntitlementDays(subscriberId, days) {
    const now = Date.now();
    const current = this.entitlements[subscriberId]?.paidUntil;
    // Renewals extend the remaining period; lapsed accounts restart from now.
    const base = current && new Date(current).getTime() > now ? new Date(current).getTime() : now;
    const paidUntil = new Date(base + days * 86_400_000).toISOString();
    this.entitlements[subscriberId] = { ...this.entitlements[subscriberId], paidUntil };
    this.#saveEntitlements();
    return paidUntil;
  }

  // Subscribers whose access lapses within `withinDays` and were not reminded
  // in the last 24h. Marks them reminded — caller is expected to notify.
  dueForExpiryReminder(withinDays = 3) {
    if (!this.billingEnabled) return [];
    const now = Date.now();
    const due = [];
    for (const sub of this.subscribers) {
      const ent = this.entitlements[sub.id];
      if (!ent) continue;
      const paidUntil = new Date(ent.paidUntil).getTime();
      if (paidUntil < now || paidUntil > now + withinDays * 86_400_000) continue;
      const lastReminder = ent.lastReminderAt ? new Date(ent.lastReminderAt).getTime() : 0;
      if (now - lastReminder < 86_400_000) continue;
      ent.lastReminderAt = new Date(now).toISOString();
      due.push({ subscriber: sub, paidUntil: ent.paidUntil });
    }
    if (due.length) this.#saveEntitlements();
    return due;
  }

  #loadRules() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.rulesFile, 'utf8'));
      this.subscribers = parsed.subscribers ?? [];
    } catch (err) {
      console.error(`[store] failed to load ${this.rulesFile}: ${err.message}`);
      if (!this.subscribers.length) this.subscribers = [];
    }
  }

  #watchRules() {
    let timer = null;
    try {
      fs.watch(this.rulesFile, () => {
        clearTimeout(timer);
        // Debounce: editors fire multiple events per save.
        timer = setTimeout(() => {
          const before = JSON.stringify(this.symbols());
          this.#loadRules();
          console.log('[store] rules reloaded');
          this.onRulesChange(JSON.stringify(this.symbols()) !== before);
        }, 300);
      });
    } catch {
      console.warn('[store] fs.watch unavailable; edit rules.json requires restart');
    }
  }

  #loadEntitlements() {
    try {
      this.entitlements = JSON.parse(fs.readFileSync(this.entitlementsFile, 'utf8'));
    } catch {
      this.entitlements = {};
    }
  }

  #saveEntitlements() {
    const tmp = `${this.entitlementsFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.entitlements, null, 2));
    fs.renameSync(tmp, this.entitlementsFile);
  }
}
