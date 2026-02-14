require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const fastify = require('fastify')({
  logger: true
});

// Initialize Supabase - Standardized to SUPABASE_SERVICE_ROLE_KEY
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Basic route
fastify.get('/', async (request, reply) => {
  return { hello: 'world' };
});

// Health check
fastify.get('/health', async (request, reply) => {
  return { ok: true };
});

// Endpoint /validate
fastify.post('/validate', async (request, reply) => {
  const { email } = request.body || {};
  const hasEnvVars = !!(supabaseUrl && supabaseKey);

  fastify.log.info({ email, hasEnvVars }, 'New validation request');

  if (!hasEnvVars) {
    fastify.log.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return reply.status(500).send({
      ok: false,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    });
  }

  if (!email) {
    return reply.status(400).send({
      ok: false,
      error: "Email is required"
    });
  }

  try {
    const { data, error } = await supabase
      .from('licenses')
      .select('*')
      .eq('email', email)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (data) {
      return { authorized: true };
    } else {
      return { authorized: false };
    }

  } catch (err) {
    fastify.log.error(err, 'Error during validation');
    return reply.status(500).send({
      ok: false,
      error: "Internal error",
      details: err.message || "Unknown error"
    });
  }
});

// Webhook Kiwify
fastify.post('/webhook/kiwify', async (request, reply) => {
  const body = request.body || {};
  const headers = request.headers;
  const webhookSecret = process.env.KIWIFY_WEBHOOK_SECRET;

  // 1) Log structured and raw for debug
  fastify.log.info({ headers, body }, 'Kiwify Webhook received');

  // 2) Validate token
  const receivedToken = headers['x-kiwify-token'] || body.token;
  if (!webhookSecret || receivedToken !== webhookSecret) {
    fastify.log.warn({ receivedToken, expected: !!webhookSecret }, 'Invalid/Missing Kiwify Token');
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  // 3) Extract data with fallbacks
  const email = body.email || body.customer?.email || body.buyer?.email;
  const status = body.status || body.order_status || body.event;

  if (!email || !status) {
    fastify.log.error({ email, status }, 'Missing email or status in webhook body');
    return reply.status(400).send({ error: 'Missing data' });
  }

  // 4) Map status to actions
  const activateStatus = ['paid', 'approved', 'order_approved', 'invoice_paid'];
  const revokeStatus = ['refunded', 'chargeback', 'canceled', 'subscription_canceled'];

  let action = null;
  if (activateStatus.includes(status)) {
    action = 'activate';
  } else if (revokeStatus.includes(status)) {
    action = 'revoke';
  }

  if (!action) {
    fastify.log.info({ status }, 'Kiwify Webhook status ignored');
    return { received: true, ignored: true };
  }

  // 5) Execute action in Supabase
  try {
    let result;
    if (action === 'activate') {
      result = await supabase
        .from('licenses')
        .upsert({ email: email }, { onConflict: 'email' });
    } else {
      result = await supabase
        .from('licenses')
        .delete()
        .eq('email', email);
    }

    if (result.error) throw result.error;

    fastify.log.info(
      `[Kiwify Webhook] Status: ${status}, Email: ${email}, Action: ${action}, Result: success`
    );

    return { ok: true, action };

  } catch (err) {
    fastify.log.error(
      { error: err.message },
      `[Kiwify Webhook] Status: ${status}, Email: ${email}, Action: ${action}, Result: error`
    );
    return reply.status(500).send({ ok: false, error: err.message });
  }
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
