import { env } from "cloudflare:test";
import {
  createStripeCheckout,
  entitlements,
  handleStripeWebhook,
  syncStripeData,
} from "../src/billing.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

function subscription(customerId: string, status = "active"): Record<string, unknown> {
  return {
    id: `sub_${customerId}`,
    customer: customerId,
    status,
    current_period_start: 1_700_000_000,
    current_period_end: 4_700_000_000,
    cancel_at_period_end: false,
    default_payment_method: { card: { brand: "visa", last4: "4242" } },
    items: {
      data: [
        {
          price: {
            id: "price_premium",
            currency: "idr",
            unit_amount: 5_000_000,
            recurring: { interval: "month" },
          },
        },
      ],
    },
  };
}

async function saveCustomer(organizationId: string, customerId: string): Promise<void> {
  await env.DOMAINS.prepare(
    `INSERT INTO billing_accounts (organization_id, stripe_customer_id, updated_at)
     VALUES (?, ?, ?)`,
  )
    .bind(organizationId, customerId, Date.now())
    .run();
}

async function stripeSignature(body: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("whsec_worker"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)),
  );
  const hex = [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

describe("Stripe billing synchronization", () => {
  it("creates and persists a customer before creating Checkout", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      requests.push({ url, body: init?.body?.toString() ?? "" });
      return Response.json(
        url.endsWith("/customers")
          ? { id: "cus_checkout" }
          : { id: "cs_test", url: "https://checkout.stripe.test" },
      );
    });

    await createStripeCheckout(env, "org-checkout", "https://worker.test");

    expect(requests.map((request) => request.url)).toEqual([
      "https://api.stripe.com/v1/customers",
      "https://api.stripe.com/v1/checkout/sessions",
    ]);
    expect(requests[1]?.body).toContain("customer=cus_checkout");
  });

  it("stores authoritative active subscription state", async () => {
    await saveCustomer("org-active", "cus_active");
    vi.stubGlobal("fetch", async () => Response.json({ data: [subscription("cus_active")] }));

    expect(await syncStripeData(env, "cus_active")).toBe(true);
    await expect(entitlements(env, "org-active")).resolves.toMatchObject({
      plan: "premium",
      customDomainLimit: 5,
      tunnelLimit: null,
    });
  });

  it("ignores subscription state in the webhook payload and resyncs from Stripe", async () => {
    await saveCustomer("org-webhook", "cus_webhook");
    vi.stubGlobal("fetch", async () => Response.json({ data: [] }));
    const body = JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: subscription("cus_webhook", "active") },
    });
    const request = new Request("https://worker.test/api/v1/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": await stripeSignature(body) },
      body,
    });

    expect(await handleStripeWebhook(request, env)).toBe(true);
    await expect(entitlements(env, "org-webhook")).resolves.toMatchObject({ plan: "free" });
  });
});
