const path = require('path');
const crypto = require('crypto');
const { admin } = require('../supabase');

// Assessment instruction files live in a PRIVATE Supabase Storage bucket. Learners never get a permanent URL: the API checks
// that the learner's stack/cohort may see the assessment, then hands out a short-lived signed link.
const BUCKET = 'assessment-files';
const MAX_BYTES = 10 * 1024 * 1024;
// Extension allow-list. The content type is derived from the extension, never trusted from the client, and nothing that a
// browser would render as a web page (html, svg, js) is accepted.
const TYPES = {
  '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.zip': 'application/zip',
};

function describeFile(fileName, size) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (!TYPES[ext]) return { error: `That file type is not allowed. Use: ${Object.keys(TYPES).join(', ')}` };
  if (!size || size > MAX_BYTES) return { error: `Files must be 10 MB or smaller` };
  const safe = path.basename(String(fileName)).replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `file${ext}`;
  return { ext, contentType: TYPES[ext], safeName: safe };
}
const newPath = (cohortId, assessmentId, safeName) => `${cohortId}/${assessmentId}/${crypto.randomUUID()}-${safeName.replace(/\s+/g, '_')}`;

let ready = false;
async function ensureBucket() {
  if (ready) return;
  const { data } = await admin.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES });
    if (error && !/already exists|duplicate/i.test(error.message || '')) throw new Error(`Storage unavailable: ${error.message}`);
  }
  ready = true;
}
async function putFile(storagePath, buffer, contentType) {
  await ensureBucket();
  const { error } = await admin.storage.from(BUCKET).upload(storagePath, buffer, { contentType, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
}
async function signedUrl(storagePath, downloadName, seconds = 120) {
  await ensureBucket();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, seconds, { download: downloadName || true });
  if (error) throw new Error(`Could not create a download link: ${error.message}`);
  return data.signedUrl;
}
async function removeFile(storagePath) {
  const { error } = await admin.storage.from(BUCKET).remove([storagePath]);
  if (error) throw new Error(`Could not delete the stored file: ${error.message}`);
}

module.exports = { BUCKET, MAX_BYTES, TYPES, describeFile, newPath, putFile, signedUrl, removeFile };
