const router = require('express').Router();
const { query } = require('../db');
const { audit } = require('../lib/audit');
const { wrap, httpError, uuid } = require('../lib/http');
const { defaultSections, sectionsSchema, narrativeSchema, reportBodySchema } = require('../lib/reportSchema');
const { gatherReportData } = require('../services/reportData');
const { buildReportDocx, fileNameFor } = require('../services/reportDoc');

const log = (req, action, id, details) => audit({ actorId: req.user.id, action, entityType: 'cohort_report', entityId: id, details, ip: req.ip });
const VER = `to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const COLS = `r.id, r.cohort_id, r.title, r.status, r.sections, r.narrative, r.created_at, r.last_downloaded_at, ${VER} as version, p.full_name as updated_by`;
const shape = (r) => ({
  id: r.id, cohortId: r.cohort_id, title: r.title, status: r.status, sections: sectionsSchema.parse(r.sections || {}), narrative: narrativeSchema.parse(r.narrative || {}),
  createdAt: r.created_at, lastDownloadedAt: r.last_downloaded_at, version: r.version, updatedBy: r.updated_by,
});
const load = async (id) => {
  const { rows: [r] } = await query(`select ${COLS} from cohort_reports r left join profiles p on p.id = r.updated_by where r.id = $1`, [id]);
  if (!r) throw httpError(404, 'Report not found');
  return shape(r);
};

router.get('/reports', wrap(async (req, res) => {
  const { rows } = await query(
    `select r.id, r.title, r.status, r.last_downloaded_at, r.updated_at, ${VER} as version, p.full_name as updated_by
     from cohort_reports r left join profiles p on p.id = r.updated_by where r.cohort_id = $1 order by r.updated_at desc limit 100`, [uuid(req.query.cohortId)]);
  res.json({ reports: rows.map((r) => ({ id: r.id, title: r.title, status: r.status, updatedAt: r.updated_at, updatedBy: r.updated_by, lastDownloadedAt: r.last_downloaded_at, version: r.version })) });
}));

router.post('/reports', wrap(async (req, res) => {
  const cohortId = uuid(req.query.cohortId);
  const { rows: [c] } = await query('select name from cohorts where id = $1', [cohortId]);
  if (!c) throw httpError(404, 'Cohort not found');
  const title = String(req.body?.title || `${c.name} Performance Report`).trim().slice(0, 160);
  if (title.length < 2) throw httpError(400, 'Give the report a title');
  const { rows: [r] } = await query(
    `insert into cohort_reports (cohort_id, title, sections, narrative, created_by, updated_by) values ($1,$2,$3,$4,$5,$5) returning id`,
    [cohortId, title, JSON.stringify(defaultSections()), JSON.stringify(narrativeSchema.parse({})), req.user.id]);
  await log(req, 'report.create', r.id, { cohortId });
  res.status(201).json({ report: await load(r.id) });
}));

router.get('/reports/:id', wrap(async (req, res) => res.json({ report: await load(uuid(req.params.id)) })));

// Saves the draft. If someone else saved first, this save is refused instead of silently overwriting theirs.
router.put('/reports/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = reportBodySchema.safeParse(req.body);
  if (!p.success) throw httpError(400, 'Check the report: it needs a title, and some text is too long or malformed');
  const r = await query(
    `update cohort_reports r set title = $2, status = $3, sections = $4, narrative = $5, updated_by = $6, updated_at = now()
     where r.id = $1 and ($7::text is null or ${VER} = $7)`,
    [id, p.data.title, p.data.status, JSON.stringify(p.data.sections), JSON.stringify(p.data.narrative), req.user.id, p.data.version ?? null]);
  if (!r.rowCount) {
    if (!(await query('select 1 from cohort_reports where id = $1', [id])).rowCount) throw httpError(404, 'Report not found');
    throw httpError(409, 'Someone else saved changes to this report while you were editing. Reload it to see their changes before saving again.');
  }
  await log(req, 'report.save', id, { status: p.data.status });
  res.json({ report: await load(id) });
}));

router.delete('/reports/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  if (!(await query('delete from cohort_reports where id = $1', [id])).rowCount) throw httpError(404, 'Report not found');
  await log(req, 'report.delete', id, {});
  res.json({ ok: true });
}));

router.get('/reports/:id/data', wrap(async (req, res) => {
  const report = await load(uuid(req.params.id));
  res.json({ data: await gatherReportData(report.cohortId, report.sections) });
}));

router.get('/reports/:id/download', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const report = await load(id);
  const data = await gatherReportData(report.cohortId, report.sections);
  const buffer = await buildReportDocx({ report, data, preparedBy: req.user.fullName });
  await query('update cohort_reports set last_downloaded_at = now() where id = $1', [id]);
  await log(req, 'report.download', id, { cohortId: report.cohortId });
  const name = fileNameFor(report.title);
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Content-Length': String(buffer.length),
  });
  res.send(buffer);
}));

module.exports = router;
