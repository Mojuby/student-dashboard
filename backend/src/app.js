
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const db = require('./db');
const logger = require('./lib/logger');
const { wrap } = require('./lib/http');
const { requestContext } = require('./middleware/requestContext');
const { notFound, errorHandler } = require('./middleware/errors');
const { requireAuth } = require('./middleware/auth');
const { requireRole, requirePasswordChanged } = require('./middleware/roles');
const { mailMode } = require('./services/mailer');
const { admin: supabaseAdmin } = require('./supabase');

const app = express();

app.set('trust proxy', config.trustProxyHops);
app.disable('x-powered-by');

app.use(requestContext);
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// CSRF defence for cookie-based sessions.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');

    if (origin && !config.allowedOrigins.includes(origin)) {
      return res.status(403).json({
        error: 'Forbidden',
        requestId: req.id
      });
    }

    if (req.get('sec-fetch-site') === 'cross-site') {
      return res.status(403).json({
        error: 'Forbidden',
        requestId: req.id
      });
    }

    const hasBody =
      Number(req.get('content-length') || 0) > 0 ||
      req.get('transfer-encoding');

    if (hasBody && !req.is('application/json')) {
      return res.status(415).json({
        error: 'Content-Type must be application/json',
        requestId: req.id
      });
    }
  }

  next();
});

// Liveness check: confirms that the API process is running.
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime())
  });
});

// Readiness probe cache for Supabase authentication.
let supaProbe = { at: 0, ok: false };

async function supabaseReachable() {
  if (Date.now() - supaProbe.at < 30000) {
    return supaProbe.ok;
  }

  let ok = false;

  try {
    const { error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1
    });

    if (error) {
      logger.error('ready.auth', {
        message: String(error.message || 'Supabase authentication check failed'),
        code: error.code,
        status: error.status
      });
    } else {
      ok = true;
    }
  } catch (err) {
    logger.error('ready.auth', {
      message: String(err?.message || err),
      code: err?.code,
      status: err?.status
    });
  }

  supaProbe = {
    at: Date.now(),
    ok
  };

  return ok;
}

// Readiness check: verifies the database and Supabase authentication.
app.get('/api/ready', wrap(async (req, res) => {
  const checks = {};

  try {
    checks.database = {
      ok: true,
      ...(await db.healthCheck())
    };
  } catch (err) {
    checks.database = { ok: false };

    logger.error('ready.database', {
      message: String(err?.message || err),
      code: err?.code
    });
  }

  checks.auth = {
    ok: await supabaseReachable()
  };

  checks.sheets = {
    configured: !!(
      config.google.sheetId &&
      config.google.clientEmail
    )
  };

  checks.registration = {
    activeCohortNumber: config.activeCohortNumber
  };

  checks.mail = mailMode();

  const ok = checks.database.ok && checks.auth.ok;

  res.status(ok ? 200 : 503).json({
    ok,
    checks,
    requestId: req.id
  });
}));

// Authentication routes.
app.use('/api/auth', require('./routes/auth'));

const guard = (role) => [
  requireAuth,
  requirePasswordChanged,
  requireRole(role)
];

// Protected application routes.
app.use(
  '/api/admin',
  ...guard('admin'),
  require('./routes/admin'),
  require('./routes/adminOps')
);

app.use(
  '/api/learner',
  ...guard('learner'),
  require('./routes/learner')
);

app.use(
  '/api/facilitator',
  ...guard('facilitator'),
  require('./routes/facilitator')
);

// API fallback and centralized error handling.
app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
