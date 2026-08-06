const env = process.env;

export const config = {
  rulesFile: env.RULES_FILE ?? './rules.json',
  dataDir: env.DATA_DIR ?? './data',

  // Feed health thresholds (ms). Primary is force-reconnected when stale,
  // and the backup feed takes over if staleness persists.
  staleAfterMs: Number(env.STALE_AFTER_MS ?? 10_000),
  failoverAfterMs: Number(env.FAILOVER_AFTER_MS ?? 30_000),

  telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? '',
  lineChannelToken: env.LINE_CHANNEL_TOKEN ?? '',

  // Admin channel receives operational alerts (feed degraded/recovered).
  adminTelegramChatId: env.ADMIN_TELEGRAM_CHAT_ID ?? '',

  // Payment webhook server. Unset PORT = engine-only mode (all rules active).
  port: env.PORT ? Number(env.PORT) : null,
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
  nowpaymentsIpnSecret: env.NOWPAYMENTS_IPN_SECRET ?? '',

  // With billing disabled, every subscriber in rules.json is treated as paid.
  billingEnabled: env.BILLING_ENABLED === '1',
};
