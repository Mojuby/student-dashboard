export const fmt = (iso, tz = 'Africa/Lagos') =>
  iso ? new Date(iso).toLocaleString('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) : '—';