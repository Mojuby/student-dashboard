const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normalize = (c) => String(c).toUpperCase().replace(/[^A-Z0-9]/g, '');

function generateCode(length = 10) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

function hashCode(code, pepper = process.env.INVITE_PEPPER) {
  return crypto.createHmac('sha256', pepper).update(normalize(code)).digest('hex');
}

function codeMatches(code, storedHash, pepper) {
  const a = Buffer.from(hashCode(code, pepper), 'hex');
  const b = Buffer.from(String(storedHash), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { generateCode, hashCode, codeMatches };