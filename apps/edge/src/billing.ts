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

async function stripeRequest(
  env: Env,
  path: string,
  init?: { readonly body?: URLSearchParams; readonly idempotencyKey?: string },
): Promise<unknown> {
  if (env.STRIPE_SECRET_KEY === undefined) throw new Error("STRIPE_SECRET_KEY is not configured");
  const headers: Record<string, string> = { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (init?.body !== undefined) headers["content-type"] = "application/x-www-form-urlencoded";
  if (init?.idempotencyKey !== undefined) headers["idempotency-key"] = init.idempotencyKey;
  const requestInit: RequestInit = {
    method: init?.body === undefined ? "GET" : "POST",
    headers,
  };
  if (init?.body !== undefined) requestInit.body = init.body;
  const response = await fetch(`https://api.stripe.com${path}`, requestInit);
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Stripe returned status ${response.status}`);
  return result;
}

async function stripeCustomerForOrganization(env: Env, organizationId: string): Promise<string> {
  const existing = await env.DOMAINS.prepare(
    "SELECT stripe_customer_id FROM billing_accounts WHERE organization_id = ?",
  )
    .bind(organizationId)
    .first<{ stripe_customer_id: string | null }>();
  if (existing?.stripe_customer_id !== null && existing?.stripe_customer_id !== undefined)
    return existing.stripe_customer_id;
  const value = await stripeRequest(env, "/v1/customers", {
    body: formBody([["metadata[organization_id]", organizationId]]),
    idempotencyKey: `ztunnel-customer-${organizationId}`,
  });
  if (!isRecord(value) || typeof value.id !== "string")
    throw new Error("Stripe returned an invalid customer");
  await env.DOMAINS.prepare(
    `INSERT INTO billing_accounts (organization_id, stripe_customer_id, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(organization_id) DO UPDATE SET
       stripe_customer_id = COALESCE(billing_accounts.stripe_customer_id, excluded.stripe_customer_id),
       updated_at = excluded.updated_at`,
  )
    .bind(organizationId, value.id, Date.now())
    .run();
  const saved = await env.DOMAINS.prepare(
    "SELECT stripe_customer_id FROM billing_accounts WHERE organization_id = ?",
  )
    .bind(organizationId)
    .first<{ stripe_customer_id: string | null }>();
  if (saved?.stripe_customer_id === null || saved?.stripe_customer_id === undefined)
    throw new Error("Stripe customer could not be stored");
  return saved.stripe_customer_id;
}

export async function createStripeCheckout(
  env: Env,
  organizationId: string,
  origin: string,
): Promise<unknown> {
  const customerId = await stripeCustomerForOrganization(env, organizationId);
  return stripeRequest(env, "/v1/checkout/sessions", {
    body: formBody([
      ["mode", "subscription"],
      ["payment_method_types[]", "card"],
      ["customer", customerId],
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
}

export async function createStripePortal(
  env: Env,
  organizationId: string,
  origin: string,
): Promise<unknown> {
  const value = await env.DOMAINS.prepare(
    "SELECT stripe_customer_id FROM billing_accounts WHERE organization_id = ?",
  )
    .bind(organizationId)
    .first<{ stripe_customer_id: string | null }>();
  if (value?.stripe_customer_id === undefined || value.stripe_customer_id === null)
    throw new RangeError("This organization does not have a Stripe customer yet");
  return stripeRequest(env, "/v1/billing_portal/sessions", {
    body: formBody([
      ["customer", value.stripe_customer_id],
      ["return_url", `${origin}/?billing=portal-return`],
    ]),
  });
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

const STRIPE_SYNC_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.upcoming",
  "invoice.marked_uncollectible",
  "invoice.payment_succeeded",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
]);

interface StripeSubscriptionState {
  readonly id: string;
  readonly status: string;
  readonly priceId: string;
  readonly currentPeriodStart: number | null;
  readonly currentPeriodEnd: number | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly paymentMethodBrand: string | null;
  readonly paymentMethodLast4: string | null;
}

function stripeSubscriptionState(value: unknown): StripeSubscriptionState | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string")
    return null;
  if (!isRecord(value.items) || !Array.isArray(value.items.data)) return null;
  const item = value.items.data[0];
  if (!isRecord(item) || !isRecord(item.price) || !isRecord(item.price.recurring)) return null;
  if (
    typeof item.price.id !== "string" ||
    item.price.currency !== "idr" ||
    item.price.unit_amount !== CARD_MONTHLY_IDR * 100 ||
    item.price.recurring.interval !== "month"
  )
    return null;
  const paymentMethod = isRecord(value.default_payment_method)
    ? value.default_payment_method
    : null;
  const card = paymentMethod !== null && isRecord(paymentMethod.card) ? paymentMethod.card : null;
  const periodStart =
    typeof value.current_period_start === "number"
      ? value.current_period_start
      : typeof item.current_period_start === "number"
        ? item.current_period_start
        : null;
  const periodEnd =
    typeof value.current_period_end === "number"
      ? value.current_period_end
      : typeof item.current_period_end === "number"
        ? item.current_period_end
        : null;
  return {
    id: value.id,
    status: value.status,
    priceId: item.price.id,
    currentPeriodStart: periodStart === null ? null : periodStart * 1000,
    currentPeriodEnd: periodEnd === null ? null : periodEnd * 1000,
    cancelAtPeriodEnd: value.cancel_at_period_end === true,
    paymentMethodBrand: card !== null && typeof card.brand === "string" ? card.brand : null,
    paymentMethodLast4: card !== null && typeof card.last4 === "string" ? card.last4 : null,
  };
}

export async function syncStripeData(env: Env, customerId: string): Promise<boolean> {
  const account = await env.DOMAINS.prepare(
    "SELECT organization_id FROM billing_accounts WHERE stripe_customer_id = ?",
  )
    .bind(customerId)
    .first<{ organization_id: string }>();
  if (account === null) return false;
  const query = new URLSearchParams({ customer: customerId, limit: "1", status: "all" });
  query.append("expand[]", "data.default_payment_method");
  const value = await stripeRequest(env, `/v1/subscriptions?${query.toString()}`);
  if (!isRecord(value) || !Array.isArray(value.data))
    throw new Error("Stripe returned an invalid subscription list");
  const now = Date.now();
  if (value.data.length === 0) {
    await env.DOMAINS.prepare(
      `UPDATE billing_accounts SET stripe_subscription_id = NULL, stripe_status = 'none',
         stripe_price_id = NULL, stripe_current_period_start = NULL,
         stripe_current_period_end = NULL, stripe_cancel_at_period_end = 0,
         stripe_payment_method_brand = NULL, stripe_payment_method_last4 = NULL, updated_at = ?
       WHERE organization_id = ?`,
    )
      .bind(now, account.organization_id)
      .run();
    return true;
  }
  const state = stripeSubscriptionState(value.data[0]);
  if (state === null) {
    await env.DOMAINS.prepare(
      `UPDATE billing_accounts SET stripe_status = 'invalid_price', updated_at = ?
       WHERE organization_id = ?`,
    )
      .bind(now, account.organization_id)
      .run();
    return true;
  }
  await env.DOMAINS.prepare(
    `UPDATE billing_accounts SET stripe_subscription_id = ?, stripe_status = ?,
       stripe_price_id = ?, stripe_current_period_start = ?, stripe_current_period_end = ?,
       stripe_cancel_at_period_end = ?, stripe_payment_method_brand = ?,
       stripe_payment_method_last4 = ?, updated_at = ? WHERE organization_id = ?`,
  )
    .bind(
      state.id,
      state.status,
      state.priceId,
      state.currentPeriodStart,
      state.currentPeriodEnd,
      state.cancelAtPeriodEnd ? 1 : 0,
      state.paymentMethodBrand,
      state.paymentMethodLast4,
      now,
      account.organization_id,
    )
    .run();
  return true;
}

export async function syncOrganizationStripeData(
  env: Env,
  organizationId: string,
): Promise<boolean> {
  const account = await env.DOMAINS.prepare(
    "SELECT stripe_customer_id FROM billing_accounts WHERE organization_id = ?",
  )
    .bind(organizationId)
    .first<{ stripe_customer_id: string | null }>();
  if (account?.stripe_customer_id === null || account?.stripe_customer_id === undefined)
    return false;
  return syncStripeData(env, account.stripe_customer_id);
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
  if (
    !parsedSignature.signatures.some(
      (signature) =>
        signature.length === expectedHex.length &&
        crypto.subtle.timingSafeEqual(
          new TextEncoder().encode(signature),
          new TextEncoder().encode(expectedHex),
        ),
    )
  )
    return false;
  const event: unknown = JSON.parse(raw);
  if (!isRecord(event) || !isRecord(event.data) || !isRecord(event.data.object)) return false;
  const object = event.data.object;
  if (typeof event.type !== "string" || !STRIPE_SYNC_EVENTS.has(event.type)) return true;
  if (typeof object.customer !== "string") return false;
  await syncStripeData(env, object.customer);
  return true;
}
