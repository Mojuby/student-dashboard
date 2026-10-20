function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

function requirePasswordChanged(req, res, next) {
  if (req.user?.mustChangePassword) {
    return res.status(403).json({ error: 'Password change required', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  next();
}

module.exports = { requireRole, requirePasswordChanged };