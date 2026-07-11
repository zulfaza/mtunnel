import type { Env } from "./env.js";

export const QRIS_MINIMUM_IDR = 10_000;
export const CARD_MONTHLY_IDR = 50_000;
export const PREMIUM_DOMAIN_LIMIT = 5;

export interface Entitlements {
  readonly plan: "free" | "domain_credit" | "premium";
  readonly customDomainLimit: number;
  readonly tunnelLimit: number | null;
  readonly tunnelLifetimeSeconds: number | null;
  readonly maximumIdleSeconds: number;
}

interface BillingAccount {
  readonly stripe_status: string | null;
  readonly stripe_current_period_end: number | null;
  readonly domain_credits: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function activeStripe(account: BillingAccount | null, now = Date.now()): boolean {
  return (
    account !== null &&
    (account.stripe_status === "active" || account.stripe_status === "trialing") &&
    (account.stripe_current_period_end === null || account.stripe_current_period_end > now)
  );
}

async function billingAccount(env: Env, organizationId: string): Promise<BillingAccount | null> {
  return env.DOMAINS.prepare(
    `SELECT stripe_status, stripe_current_period_end,
            (SELECT COUNT(*) FROM billing_domain_credits WHERE organization_id = ?) AS domain_credits
       FROM billing_accounts WHERE organization_id = ?
     UNION ALL
     SELECT NULL, NULL, COUNT(*) FROM billing_domain_credits
      WHERE organization_id = ? AND NOT EXISTS (
        SELECT 1 FROM billing_accounts WHERE organization_id = ?
      )`,
  )
    .bind(organizationId, organizationId, organizationId, organizationId)
    .first<BillingAccount>();
}

export async function entitlements(env: Env, organizationId: string): Promise<Entitlements> {
  const value = await billingAccount(env, organizationId);
  if (activeStripe(value)) {
    return {
      plan: "premium",
      customDomainLimit: PREMIUM_DOMAIN_LIMIT,
      tunnelLimit: null,
      tunnelLifetimeSeconds: null,
      maximumIdleSeconds: 3600,
    };
  }
  return {
    plan: value !== null && value.domain_credits > 0 ? "domain_credit" : "free",
    customDomainLimit: value?.domain_credits ?? 0,
    tunnelLimit: 5,
    tunnelLifetimeSeconds: 3600,
    maximumIdleSeconds: 900,
  };
}

function identifier(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function basic(value: string): string {
  return `Basic ${btoa(`${value}:`)}`;
}

export async function createQrisCharge(
  env: Env,
  organizationId: string,
  amountIdr: number,
): Promise<unknown> {
  if (env.MIDTRANS_SERVER_KEY === undefined)
    throw new Error("MIDTRANS_SERVER_KEY is not configured");
  if (!Number.isSafeInteger(amountIdr) || amountIdr < QRIS_MINIMUM_IDR)
    throw new RangeError(`QRIS payments must be at least Rp${QRIS_MINIMUM_IDR}`);
  const orderId = identifier("qris");
  const now = Date.now();
  await env.DOMAINS.prepare(
    `INSERT INTO billing_orders
       (id, organization_id, provider, amount_idr, status, created_at, updated_at)
     VALUES (?, ?, 'midtrans', ?, 'pending', ?, ?)`,
  )
    .bind(orderId, organizationId, amountIdr, now, now)
    .run();
  const host =
    env.MIDTRANS_IS_PRODUCTION === "true" ? "api.midtrans.com" : "api.sandbox.midtrans.com";
  const response = await fetch(`https://${host}/v2/charge`, {
    method: "POST",
    headers: { authorization: basic(env.MIDTRANS_SERVER_KEY), "content-type": "application/json" },
    body: JSON.stringify({
      payment_type: "qris",
      transaction_details: { order_id: orderId, gross_amount: amountIdr },
      item_details: [
        { id: "custom-domain-credit", price: amountIdr, quantity: 1, name: "Custom domain credit" },
      ],
    }),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Midtrans returned status ${response.status}`);
  return result;
}

function formBody(entries: readonly (readonly [string, string])[]): URLSearchParams {
  const body = new URLSearchParams();
  for (const [name, value] of entries) body.append(name, value);
  return body;
}

export async function createStripeCheckout(
  env: Env,
  organizationId: string,
  origin: string,
): Promise<unknown> {
  if (env.STRIPE_SECRET_KEY === undefined) throw new Error("STRIPE_SECRET_KEY is not configured");
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: formBody([
      ["mode", "subscription"],
      ["payment_method_types[]", "card"],
      ["client_reference_id", organizationId],
      ["metadata[organization_id]", organizationId],
      ["subscription_data[metadata][organization_id]", organizationId],
      ["line_items[0][quantity]", "1"],
      ["line_items[0][price_data][currency]", "idr"],
      ["line_items[0][price_data][unit_amount]", String(CARD_MONTHLY_IDR * 100)],
      ["line_items[0][price_data][recurring][interval]", "month"],
      ["line_items[0][price_data][product_data][name]", "ztunnel Premium"],
      ["success_url", `${origin}/?billing=success`],
      ["cancel_url", `${origin}/?billing=cancelled`],
    ]),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Stripe returned status ${response.status}`);
  return result;
}

export async function createStripePortal(
  env: Env,
  organizationId: string,
  origin: string,
): Promise<unknown> {
  if (env.STRIPE_SECRET_KEY === undefined) throw new Error("STRIPE_SECRET_KEY is not configured");
  const value = await env.DOMAINS.prepare(
    "SELECT stripe_customer_id FROM billing_accounts WHERE organization_id = ?",
  )
    .bind(organizationId)
    .first<{ stripe_customer_id: string | null }>();
  if (value?.stripe_customer_id === undefined || value.stripe_customer_id === null)
    throw new RangeError("This organization does not have a Stripe customer yet");
  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: formBody([
      ["customer", value.stripe_customer_id],
      ["return_url", `${origin}/?billing=portal-return`],
    ]),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Stripe returned status ${response.status}`);
  return result;
}

async function digestHex(algorithm: "SHA-256" | "SHA-512", value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(algorithm, new TextEncoder().encode(value)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function handleMidtransWebhook(request: Request, env: Env): Promise<boolean> {
  if (env.MIDTRANS_SERVER_KEY === undefined) return false;
  const value: unknown = await request.json().catch(() => null);
  if (!isRecord(value)) return false;
  const orderId = value.order_id;
  const statusCode = value.status_code;
  const grossAmount = value.gross_amount;
  const signature = value.signature_key;
  const transactionStatus = value.transaction_status;
  if (
    typeof orderId !== "string" ||
    typeof statusCode !== "string" ||
    typeof grossAmount !== "string" ||
    typeof signature !== "string" ||
    typeof transactionStatus !== "string"
  )
    return false;
  const expected = await digestHex(
    "SHA-512",
    `${orderId}${statusCode}${grossAmount}${env.MIDTRANS_SERVER_KEY}`,
  );
  if (signature !== expected) return false;
  const paid = transactionStatus === "settlement" || transactionStatus === "capture";
  const row = await env.DOMAINS.prepare(
    "SELECT organization_id, amount_idr, status FROM billing_orders WHERE id = ? AND provider = 'midtrans'",
  )
    .bind(orderId)
    .first<{ organization_id: string; amount_idr: number; status: string }>();
  if (row === null || Number.parseInt(grossAmount, 10) !== row.amount_idr) return false;
  const now = Date.now();
  const nextStatus = paid ? "paid" : transactionStatus;
  await env.DOMAINS.batch([
    env.DOMAINS.prepare(
      "UPDATE billing_orders SET status = ?, provider_reference = ?, updated_at = ? WHERE id = ?",
    ).bind(nextStatus, value.transaction_id ?? null, now, orderId),
    ...(paid
      ? [
          env.DOMAINS.prepare(
            `INSERT INTO billing_domain_credits (order_id, organization_id, created_at)
           VALUES (?, ?, ?) ON CONFLICT(order_id) DO NOTHING`,
          ).bind(orderId, row.organization_id, now),
        ]
      : []),
  ]);
  return true;
}

function stripeSignature(
  header: string,
): { timestamp: string; signatures: readonly string[] } | null {
  const values = header.split(",").map((part) => part.split("=", 2));
  const timestamp = values.find(([key]) => key === "t")?.[1];
  const signatures = values
    .filter(([key]) => key === "v1")
    .flatMap((entry) => (entry[1] === undefined ? [] : [entry[1]]));
  return timestamp === undefined || signatures.length === 0 ? null : { timestamp, signatures };
}

export async function handleStripeWebhook(request: Request, env: Env): Promise<boolean> {
  if (env.STRIPE_WEBHOOK_SECRET === undefined) return false;
  const raw = await request.text();
  const parsedSignature = stripeSignature(request.headers.get("stripe-signature") ?? "");
  if (
    parsedSignature === null ||
    Math.abs(Date.now() / 1000 - Number(parsedSignature.timestamp)) > 300
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${parsedSignature.timestamp}.${raw}`),
  );
  const expectedHex = [...new Uint8Array(expected)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (!parsedSignature.signatures.includes(expectedHex)) return false;
  const event: unknown = JSON.parse(raw);
  if (!isRecord(event) || !isRecord(event.data) || !isRecord(event.data.object)) return false;
  const object = event.data.object;
  if (typeof event.type !== "string" || !event.type.startsWith("customer.subscription."))
    return true;
  if (
    typeof object.id !== "string" ||
    typeof object.status !== "string" ||
    !isRecord(object.metadata) ||
    typeof object.metadata.organization_id !== "string"
  )
    return false;
  if (event.type !== "customer.subscription.deleted") {
    if (!isRecord(object.items) || !Array.isArray(object.items.data)) return false;
    const validPrice = object.items.data.some((item) => {
      if (!isRecord(item) || !isRecord(item.price) || !isRecord(item.price.recurring)) return false;
      return (
        item.price.currency === "idr" &&
        item.price.unit_amount === CARD_MONTHLY_IDR * 100 &&
        item.price.recurring.interval === "month"
      );
    });
    if (!validPrice) return false;
  }
  const customerId = typeof object.customer === "string" ? object.customer : null;
  const periodEnd =
    typeof object.current_period_end === "number" ? object.current_period_end * 1000 : null;
  await env.DOMAINS.prepare(
    `INSERT INTO billing_accounts
       (organization_id, stripe_customer_id, stripe_subscription_id, stripe_status, stripe_current_period_end, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id, stripe_status = excluded.stripe_status,
       stripe_current_period_end = excluded.stripe_current_period_end, updated_at = excluded.updated_at`,
  )
    .bind(
      object.metadata.organization_id,
      customerId,
      object.id,
      object.status,
      periodEnd,
      Date.now(),
    )
    .run();
  return true;
}
