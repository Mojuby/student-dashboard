const path = require('path');
const crypto = require('crypto');
const { admin } = require('../supabase');

// Two PRIVATE Supabase Storage buckets: assessment instruction files, and survey photos. Nobody gets a permanent URL;
// the API checks who may see a file, then hands out a short-lived signed link.
const BUCKET = 'assessment-files';
const SURVEY_BUCKET = 'survey-photos';
const MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
// Extension allow-list. The content type is derived from the extension, never trusted from the client, and nothing a browser
// would render as a web page (html, svg, js) is accepted.
const TYPES = {
  '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.zip': 'application/zip',
};
const safeName = (n, ext) => path.basename(String(n)).replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `file${ext}`;

function describeFile(fileName, size) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (!TYPES[ext]) return { error: `That file type is not allowed. Use: ${Object.keys(TYPES).join(', ')}` };
  if (!size || size > MAX_BYTES) return { error: 'Files must be 10 MB or smaller' };
  return { ext, contentType: TYPES[ext], safeName: safeName(fileName, ext) };
}
// Photos: PNG or JPEG only, 5 MB max, and the file's first bytes must really be an image (a renamed file is refused).
function describePhoto(fileName, buffer) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return { error: 'Please upload a PNG or JPG image.' };
  if (!buffer.length || buffer.length > PHOTO_MAX_BYTES) return { error: 'The photo must be 5 MB or smaller.' };
  const png = buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const jpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if ((ext === '.png') !== png || (ext !== '.png') !== jpg) return { error: 'That file is not a valid image.' };
  return { ext, contentType: TYPES[ext], safeName: safeName(fileName, ext) };
}
const newPath = (a, b, name) => `${a}/${b}/${crypto.randomUUID()}-${name.replace(/\s+/g, '_')}`;

const ready = new Set();
async function ensureBucket(bucket = BUCKET) {
  if (ready.has(bucket)) return;
  const { data } = await admin.storage.getBucket(bucket);
  if (!data) {
    const { error } = await admin.storage.createBucket(bucket, { public: false, fileSizeLimit: bucket === SURVEY_BUCKET ? PHOTO_MAX_BYTES : MAX_BYTES });
    if (error && !/already exists|duplicate/i.test(error.message || '')) throw new Error(`Storage unavailable: ${error.message}`);
  }
  ready.add(bucket);
}
async function putFile(storagePath, buffer, contentType, bucket = BUCKET) {
  await ensureBucket(bucket);
  const { error } = await admin.storage.from(bucket).upload(storagePath, buffer, { contentType, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
}
async function signedUrl(storagePath, downloadName, bucket = BUCKET, seconds = 120) {
  await ensureBucket(bucket);
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(storagePath, seconds, { download: downloadName || true });
  if (error) throw new Error(`Could not create a download link: ${error.message}`);
  return data.signedUrl;
}
async function removeFile(storagePath, bucket = BUCKET) {
  const { error } = await admin.storage.from(bucket).remove([storagePath]);
  if (error) throw new Error(`Could not delete the stored file: ${error.message}`);
}

module.exports = { BUCKET, SURVEY_BUCKET, MAX_BYTES, PHOTO_MAX_BYTES, TYPES, describeFile, describePhoto, newPath, putFile, signedUrl, removeFile };
