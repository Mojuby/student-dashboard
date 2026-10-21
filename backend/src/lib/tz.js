const { DateTime } = require('luxon');

function toUtcDate(local, zone) {
  const d = DateTime.fromISO(String(local), { zone });
  if (!d.isValid) throw new Error('Invalid date or time');
  return d.toUTC().toJSDate();
}
const toLocalInput = (date, zone) => DateTime.fromJSDate(new Date(date), { zone }).toFormat("yyyy-MM-dd'T'HH:mm");

module.exports = { toUtcDate, toLocalInput };