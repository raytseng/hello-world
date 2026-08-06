import http from 'node:http';
import crypto from 'node:crypto';

// Billing model: prepaid days. Cards auto-renew through Stripe subscriptions;
// crypto cannot auto-charge, so crypto checkouts sell fixed blocks of days
// (30/90/365) and the alert engine itself reminds people before expiry.
//
// Stripe:      set metadata {subscriber_id, days} on the Checkout Session /
//              subscription; webhook events credit days on payment.
// NOWPayments: set order_id to "subscriberId:days" when creating the invoice;
//              the IPN webhook credits days once the payment is finished.

function timingSafeEq(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function verifyStripeSignature(rawBody, sigHeader, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(
    sigHeader.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i), kv.slice(i + 1)];
    }),
  );
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSec) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parts.t}.${rawBody}`)
    .digest('hex');
  return timingSafeEq(expected, parts.v1);
}

export function verifyNowpaymentsSignature(body, sigHeader, secret) {
  // NOWPayments signs the JSON re-serialized with keys sorted alphabetically.
  const sorted = JSON.stringify(body, Object.keys(body).sort());
  const expected = crypto.createHmac('sha512', secret).update(sorted).digest('hex');
  return timingSafeEq(expected, sigHeader ?? '');
}

export function createPaymentServer({ config, store, feedManager, onCredit }) {
  return http.createServer(async (req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && req.url === '/health') {
      return send(200, { ok: true, feed: feedManager.status() });
    }

    if (req.method !== 'POST') return send(404, { error: 'not found' });

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');

    try {
      if (req.url === '/webhook/stripe') {
        if (!verifyStripeSignature(rawBody, req.headers['stripe-signature'] ?? '', config.stripeWebhookSecret)) {
          return send(400, { error: 'bad signature' });
        }
        const event = JSON.parse(rawBody);
        if (event.type === 'checkout.session.completed' || event.type === 'invoice.paid') {
          const obj = event.data.object;
          const meta = obj.metadata ?? obj.subscription_details?.metadata ?? {};
          const subscriberId = meta.subscriber_id;
          const days = Number(meta.days ?? 30);
          if (subscriberId) {
            const paidUntil = store.addEntitlementDays(subscriberId, days);
            onCredit?.(subscriberId, days, paidUntil, 'stripe');
          }
        }
        return send(200, { received: true });
      }

      if (req.url === '/webhook/nowpayments') {
        const body = JSON.parse(rawBody);
        if (!verifyNowpaymentsSignature(body, req.headers['x-nowpayments-sig'], config.nowpaymentsIpnSecret)) {
          return send(400, { error: 'bad signature' });
        }
        if (body.payment_status === 'finished') {
          const [subscriberId, daysStr] = String(body.order_id ?? '').split(':');
          const days = Number(daysStr ?? 30);
          if (subscriberId) {
            const paidUntil = store.addEntitlementDays(subscriberId, days);
            onCredit?.(subscriberId, days, paidUntil, 'crypto');
          }
        }
        return send(200, { received: true });
      }

      return send(404, { error: 'not found' });
    } catch (err) {
      console.error('[payments]', err);
      return send(500, { error: 'internal' });
    }
  });
}
