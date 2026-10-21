const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { requireAuth } = require('./middleware/auth');
const { requireRole, requirePasswordChanged } = require('./middleware/roles');

const app = express();
app.set('trust proxy', config.trustProxyHops);
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && !config.allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));

const guard = (role) => [requireAuth, requirePasswordChanged, requireRole(role)];
app.use('/api/admin', ...guard('admin'), require('./routes/admin'));
app.use('/api/learner', ...guard('learner'), require('./routes/learner'));
app.use('/api/facilitator', ...guard('facilitator'), require('./routes/facilitator'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.code === '23505') return res.status(409).json({ error: 'That record already exists' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Server error' : err.message });
});

module.exports = app;