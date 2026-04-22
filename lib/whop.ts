/**
 * Whop client stub.
 * Handles checkout creation and webhook verification for the weekly subscription.
 * See PRD §6 (Billing) and §7.1 (Payment flow).
 *
 * IMPORTANT: Whop SDK uses v1 endpoints only. Plan IDs (plan_...) not product IDs.
 * HTTPS redirect URLs required — use ngrok for local dev.
 */
import Whop from "@whop/sdk";

let _client: Whop | null = null;

function getClient(): Whop {
  if (_client) return _client;
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) throw new Error("WHOP_API_KEY not set");
  _client = new Whop({ apiKey });
  return _client;
}

export interface CheckoutResult {
  purchase_url: string;
  id: string;
}

/**
 * Create a checkout configuration for the weekly subscription plan.
 * NOT IMPLEMENTED — wire up once Whop plan is created in dashboard.
 */
export async function createCheckout(
  userId: string,
  metadata: Record<string, string> = {},
): Promise<CheckoutResult> {
  void getClient();
  void userId;
  void metadata;
  // TODO: call client.checkoutConfigurations.create with WHOP_PLAN_ID_WEEKLY
  // and redirect_url pointing to post-paywall success route.
  throw new Error("createCheckout not implemented");
}

/**
 * Verify a Whop webhook payload using WHOP_WEBHOOK_SECRET.
 * NOT IMPLEMENTED — fill in once webhook signing scheme is confirmed.
 */
export function verifyWebhook(
  _rawBody: string,
  _signatureHeader: string | null,
): boolean {
  // TODO: HMAC-SHA256 verify with WHOP_WEBHOOK_SECRET
  throw new Error("verifyWebhook not implemented");
}
