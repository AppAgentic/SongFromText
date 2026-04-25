/**
 * Whop client stub.
 * Handles checkout creation and webhook verification for the weekly subscription.
 * See PRD §6 (Billing) and §7.1 (Payment flow).
 *
 * IMPORTANT: Whop SDK uses v1 endpoints only.
 * We create checkout configurations with inline dynamic plans so price changes
 * do not require a pre-created weekly plan id.
 * HTTPS redirect URLs required — use ngrok for local dev.
 */
import Whop from "@whop/sdk";
import type { UnwrapWebhookEvent } from "@whop/sdk/resources/webhooks";

const DEFAULT_WEEKLY_PRICE_GBP = 6.99;
const BILLING_PERIOD_DAYS = 7;
const PRODUCT_EXTERNAL_IDENTIFIER = "songfromtext-weekly";

let _client: Whop | null = null;
let _webhookClient: Whop | null = null;

function getClient(): Whop {
  if (_client) return _client;
  const apiKey = process.env.WHOP_API_KEY?.trim();
  if (!apiKey) throw new Error("WHOP_API_KEY not set");
  _client = new Whop({ apiKey });
  return _client;
}

function getWhopCompanyId(): string {
  const companyId = process.env.WHOP_COMPANY_ID?.trim();
  if (!companyId) throw new Error("WHOP_COMPANY_ID not set");
  return companyId;
}

export function getWeeklyPriceGbp(): number {
  const configuredPrice = process.env.SONG_WEEKLY_PRICE_GBP;
  if (!configuredPrice) return DEFAULT_WEEKLY_PRICE_GBP;

  const price = Number(configuredPrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("SONG_WEEKLY_PRICE_GBP must be a positive number");
  }

  return price;
}

export interface CreateCheckoutOptions {
  userId: string;
  redirectUrl: string;
  sourceUrl?: string;
  metadata?: Record<string, string>;
  priceGbp?: number;
}

export interface CheckoutResult {
  purchase_url: string;
  id: string;
  plan_id: string;
  price_gbp: number;
  billing_period_days: number;
}

/**
 * Create a checkout configuration for the weekly subscription.
 * Mirrors StoryCrest's dynamic Whop pattern: create an inline plan at checkout
 * time and persist the returned checkout/plan IDs for webhook reconciliation.
 */
export async function createCheckout(
  options: CreateCheckoutOptions,
): Promise<CheckoutResult> {
  const client = getClient();
  const priceGbp = options.priceGbp ?? getWeeklyPriceGbp();

  const checkoutConfiguration = await client.checkoutConfigurations.create({
    plan: {
      company_id: getWhopCompanyId(),
      currency: "gbp",
      initial_price: 0,
      renewal_price: priceGbp,
      billing_period: BILLING_PERIOD_DAYS,
      plan_type: "renewal",
      trial_period_days: 0,
      title: "SongFromText Weekly",
      description: "Weekly subscription for SongFromText song generation.",
      product: {
        external_identifier: PRODUCT_EXTERNAL_IDENTIFIER,
        title: "SongFromText Weekly",
        description: "Turn their messages into songs using their exact words.",
        collect_shipping_address: false,
      },
      internal_notes:
        "Created dynamically by SongFromText checkout. Change SONG_WEEKLY_PRICE_GBP to switch price.",
    },
    redirect_url: options.redirectUrl,
    source_url: options.sourceUrl,
    metadata: {
      ...options.metadata,
      user_id: options.userId,
      product: PRODUCT_EXTERNAL_IDENTIFIER,
      price_gbp: priceGbp.toFixed(2),
      billing_period_days: String(BILLING_PERIOD_DAYS),
    },
  });

  return {
    purchase_url: checkoutConfiguration.purchase_url,
    id: checkoutConfiguration.id,
    plan_id: checkoutConfiguration.plan?.id ?? "",
    price_gbp: priceGbp,
    billing_period_days: BILLING_PERIOD_DAYS,
  };
}

/**
 * Verify a Whop webhook payload using WHOP_WEBHOOK_SECRET.
 * Whop uses the Standard Webhooks header set:
 * webhook-id, webhook-timestamp, and webhook-signature.
 */
export function verifyWebhook(
  rawBody: string,
  headers: Headers,
): boolean {
  try {
    unwrapWebhook(rawBody, headers);
    return true;
  } catch {
    return false;
  }
}

export function unwrapWebhook(
  rawBody: string,
  headers: Headers,
): UnwrapWebhookEvent {
  const webhookSecret = process.env.WHOP_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) throw new Error("WHOP_WEBHOOK_SECRET not set");
  const webhookKey = toStandardWebhookKey(webhookSecret);

  if (!_webhookClient) {
    _webhookClient = new Whop({
      apiKey: process.env.WHOP_API_KEY?.trim() ?? "webhook_verification_only",
      webhookKey,
    });
  }

  return _webhookClient.webhooks.unwrap(rawBody, {
    headers: Object.fromEntries(headers.entries()),
    key: webhookKey,
  });
}

function toStandardWebhookKey(webhookSecret: string): string {
  if (webhookSecret.startsWith("whsec_")) return webhookSecret;
  if (webhookSecret.startsWith("ws_")) {
    return Buffer.from(webhookSecret, "utf8").toString("base64");
  }
  return webhookSecret;
}
