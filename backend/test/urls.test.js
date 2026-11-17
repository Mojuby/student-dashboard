const test = require('node:test');
const assert = require('node:assert');
const { normalizeDocUrl, normalizeGoogleUrl, normalizeWhatsAppInvite } = require('../src/lib/urls');

const ID = '1AbCdEfGhIjKlMnOpQrStUv';

test('accepts every kind of Google Workspace link a learner might submit', () => {
  const ok = [
    `https://docs.google.com/document/d/${ID}/edit?usp=sharing`,           // Docs
    `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`,              // Sheets
    `https://docs.google.com/presentation/d/${ID}/edit`,                    // Slides
    `https://docs.google.com/forms/d/${ID}/edit`,                           // Forms (editor)
    `https://docs.google.com/forms/d/e/1FAIpQLSdAbCdEfGhIjKlMn/viewform`,   // Forms (published)
    `https://docs.google.com/drawings/d/${ID}/edit`,                        // Drawings
    `https://docs.google.com/document/u/0/d/${ID}/edit`,                    // account switcher
    `https://docs.google.com/a/example.com/document/d/${ID}/edit`,          // workspace-domain link
    `https://drive.google.com/file/d/${ID}/view?usp=sharing`,               // Drive file: pptx, pdf, docx, xlsx ...
    `https://drive.google.com/file/u/0/d/${ID}/view`,
    `https://drive.google.com/drive/folders/${ID}?usp=sharing`,             // Drive folder
    `https://drive.google.com/drive/u/0/folders/${ID}`,
    `https://drive.google.com/open?id=${ID}`,                               // older Drive link
    'https://sites.google.com/view/my-portfolio/home',                      // Sites
    'https://lookerstudio.google.com/reporting/abcdef12-3456-7890-abcd-ef1234567890/page/p_x',
    'https://datastudio.google.com/reporting/abcdef12-3456-7890-abcd-ef1234567890',
    `https://colab.research.google.com/drive/${ID}`,                        // Colab notebook
    'https://forms.gle/AbCdEfGh12',                                         // Forms short link
  ];
  for (const u of ok) assert.ok(normalizeGoogleUrl(u), `should accept ${u}`);
  assert.equal(normalizeDocUrl, normalizeGoogleUrl, 'the old name still works');
});

test('rejects other hosts, http, credentials, ports, look-alikes, redirectors and links without an id', () => {
  const bad = [
    `http://docs.google.com/document/d/${ID}/edit`,                         // not https
    `https://evil.com/docs.google.com/document/d/${ID}`,                    // look-alike path
    `https://docs.google.com.evil.com/document/d/${ID}`,                    // look-alike host
    `https://docs.google.com@evil.com/document/d/${ID}`,                    // credentials trick
    `https://docs.google.com:8443/document/d/${ID}`,                        // unusual port
    `https://google.com/url?q=https://evil.com`,                            // Google redirector
    `https://mail.google.com/mail/u/0/#inbox`,                              // Google, but not a shared file
    'https://docs.google.com/document',                                     // no id
    'https://docs.google.com/document/d/short',                             // id too short
    'https://drive.google.com/drive/my-drive',                              // no id
    'https://drive.google.com/open?id=short',
    'https://sites.google.com/',                                            // no site
    'https://www.dropbox.com/s/abc/file.docx', 'https://onedrive.live.com/edit.aspx?id=abc', 'https://github.com/someone/repo',
    'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '', '   ', null, undefined, 42,
    `https://docs.google.com/document/d/${ID}/${'x'.repeat(3000)}`,          // over the length limit
  ];
  for (const u of bad) assert.equal(normalizeGoogleUrl(u), null, `should reject ${String(u).slice(0, 60)}`);
});

test('WhatsApp invite validation', () => {
  assert.ok(normalizeWhatsAppInvite('https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV'));
  assert.equal(normalizeWhatsAppInvite('https://wa.me/2348000000000'), null);
  assert.equal(normalizeWhatsAppInvite('https://chat.whatsapp.com/short'), null);
});