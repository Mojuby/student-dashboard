const test = require('node:test');
const assert = require('node:assert');
const { normalizeDocUrl, normalizeWhatsAppInvite } = require('../src/lib/urls');

test('accepts Google Docs and Drive folder links', () => {
  assert.ok(normalizeDocUrl('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit'));
  assert.ok(normalizeDocUrl('https://drive.google.com/drive/folders/1AbCdEfGhIjKl?usp=sharing'));
});

test('rejects other hosts, http, credentials, sheets, and look-alikes', () => {
  assert.equal(normalizeDocUrl('http://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit'), null);
  assert.equal(normalizeDocUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit'), null);
  assert.equal(normalizeDocUrl('https://evil.com/docs.google.com/document/d/1AbCdEfGhIjKlMnOp'), null);
  assert.equal(normalizeDocUrl('https://docs.google.com@evil.com/document/d/1AbCdEfGhIjKlMnOp'), null);
  assert.equal(normalizeDocUrl('javascript:alert(1)'), null);
  assert.equal(normalizeDocUrl(''), null);
});

test('WhatsApp invite validation', () => {
  assert.ok(normalizeWhatsAppInvite('https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV'));
  assert.equal(normalizeWhatsAppInvite('https://wa.me/2348000000000'), null);
  assert.equal(normalizeWhatsAppInvite('https://chat.whatsapp.com/short'), null);
});