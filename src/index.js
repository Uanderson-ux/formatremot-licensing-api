require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const fastify = require('fastify')({
  logger: true
});

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
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

  // Log initial request info
  fastify.log.info({ email, hasEnvVars }, 'New validation request');

  // 1) Validate env vars
  if (!hasEnvVars) {
    fastify.log.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    return reply.status(500).send({
      ok: false,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY"
    });
  }

  if (!email) {
    return reply.status(400).send({
      ok: false,
      error: "Email is required"
    });
  }

  // 2) Envolver toda lógica em try/catch
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
    // Logar o erro completo no console
    fastify.log.error(err, 'Error during validation');

    // Responder com JSON estruturado
    return reply.status(500).send({
      ok: false,
      error: "Internal error",
      details: err.message || "Unknown error"
    });
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
