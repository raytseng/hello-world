import { sendTelegram } from './telegram.js';
import { sendDiscord } from './discord.js';
import { sendLine } from './line.js';

const MAX_RETRIES = 2;

// Fire-and-forget fan-out: dispatch must never block the tick hot path.
export function createNotifier(config) {
  async function sendOne(channel, text) {
    switch (channel.type) {
      case 'telegram':
        return sendTelegram(config.telegramBotToken, channel.chatId, text);
      case 'discord':
        return sendDiscord(channel.webhookUrl, text);
      case 'line':
        return sendLine(config.lineChannelToken, channel.userId, text);
      default:
        throw new Error(`unknown channel type: ${channel.type}`);
    }
  }

  async function withRetry(channel, text) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await sendOne(channel, text);
      } catch (err) {
        if (attempt >= MAX_RETRIES) {
          console.error(`[notify] giving up on ${channel.type}:`, err.message);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  return {
    notify(subscriber, text) {
      for (const channel of subscriber.channels ?? []) {
        withRetry(channel, text);
      }
    },
    notifyAdmin(text) {
      if (config.telegramBotToken && config.adminTelegramChatId) {
        withRetry({ type: 'telegram', chatId: config.adminTelegramChatId }, text);
      } else {
        console.log(`[admin] ${text}`);
      }
    },
  };
}
