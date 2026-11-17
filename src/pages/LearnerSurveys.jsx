import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { fmt } from '../lib/format';
import LearnerNav from '../components/LearnerNav';
import FeedbackWidget from '../components/FeedbackWidget';
import { Banner, Card } from '../components/ui';

const btn = 'rounded-lg bg-brand-blue px-5 py-2.5 font-semibold text-white hover:bg-brand-navy disabled:opacity-50';
const MAX_PHOTO = 5 * 1024 * 1024;

const isEmpty = (q, a) => {
  if (q.kind === 'rating') return !(a >= 1 && a <= 5);
  if (q.kind === 'yesno') return a !== 'yes' && a !== 'no';
  if (q.kind === 'choice_text') return !(a?.choices?.length || a?.text?.trim());
  if (q.kind === 'text') return !String(a || '').trim();
  return false;
};

function Rating({ q, value, onChange }) {
  return (
    <div>
      <div role="radiogroup" aria-label={q.prompt} className="flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => onChange(n)}
            className={`h-11 w-11 rounded-lg border text-base font-semibold ${value === n ? 'border-brand-blue bg-brand-blue text-white' : 'border-brand-line bg-white text-brand-navy hover:border-brand-blue'}`}>{n}</button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-brand-body" style={{ maxWidth: '16rem' }}><span>1 = {q.options.low}</span><span>5 = {q.options.high}</span></div>
    </div>
  );
}

function SurveyForm({ id, onBack, onDone }) {
  const draftKey = `fv.survey.${id}`;
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState(() => { try { return JSON.parse(sessionStorage.getItem(draftKey) || '{}'); } catch { return {}; } });
  const [photo, setPhoto] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showMissing, setShowMissing] = useState(false);

  useEffect(() => { api(`/learner/surveys/${id}`).then((r) => { setData(r); setPhoto(r.photo); }).catch((e) => setErr(e.message)); }, [id]);
  const set = (qid, value) => setAnswers((a) => { const next = { ...a, [qid]: value }; try { sessionStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* storage blocked */ } return next; });

  const byPos = useMemo(() => new Map((data?.questions || []).map((q) => [q.position, q])), [data]);
  const visible = (q) => !q.show_if || answers[byPos.get(q.show_if.position)?.id] === q.show_if.equals;
  const shown = (data?.questions || []).filter(visible);
  const missing = shown.filter((q) => q.required && isEmpty(q, answers[q.id]));

  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    if (!/\.(png|jpe?g)$/i.test(file.name)) return setErr('Please choose a PNG or JPG image.');
    if (file.size > MAX_PHOTO) return setErr('The photo must be 5 MB or smaller.');
    setBusy(true);
    try {
      const dataBase64 = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = () => reject(new Error('Could not read that file.')); r.readAsDataURL(file); });
      const r = await api(`/learner/surveys/${id}/photo`, { method: 'POST', body: { fileName: file.name, dataBase64 } });
      setPhoto({ fileName: r.fileName });
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  async function removePhoto() { setErr(''); try { await api(`/learner/surveys/${id}/photo`, { method: 'DELETE' }); setPhoto(null); set(data.questions.find((q) => q.kind === 'consent')?.id, false); } catch (e) { setErr(e.message); } }

  async function submit() {
    if (busy) return;
    setShowMissing(true);
    if (missing.length) { setErr(`Please answer question ${missing[0].position} before submitting.`); return; }
    const consentQ = data.questions.find((q) => q.kind === 'consent');
    if (photo && consentQ && visible(consentQ) && answers[consentQ.id] !== true) { setErr('Tick the consent box to share your photo, or remove the photo.'); return; }
    setBusy(true); setErr('');
    try {
      const payload = Object.fromEntries(shown.map((q) => [q.id, answers[q.id]]).filter(([, v]) => v !== undefined));
      await api(`/learner/surveys/${id}/respond`, { method: 'POST', body: { answers: payload } });
      try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
      onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!data) return <Card><Banner error={err} />{!err && <p className="text-brand-body">Loading…</p>}<button className="mt-2 text-sm text-brand-blue underline" onClick={onBack}>← Back</button></Card>;
  if (data.submitted) return <Card><p className="font-semibold text-green-800">You have already submitted this survey. Thank you!</p><button className="mt-2 text-sm text-brand-blue underline" onClick={onBack}>← Back</button></Card>;

  return (
    <div className="space-y-4">
      <button className="text-sm font-semibold text-brand-blue underline" onClick={onBack}>← All surveys</button>
      <Card>
        <h1 className="font-heading text-2xl font-extrabold text-brand-navy">{data.survey.title}</h1>
        {data.survey.intro && <p className="mt-1 text-brand-body">{data.survey.intro}</p>}
        <p className="mt-1 text-xs text-brand-body">Closes {fmt(data.survey.closesAt)}. Your answers are saved on this device while you work.</p>
      </Card>
      {shown.map((q) => {
        const a = answers[q.id];
        const bad = showMissing && q.required && isEmpty(q, a);
        return (
          <Card key={q.id} className={bad ? 'border-red-400' : ''}>
            <fieldset>
              <legend className="font-semibold text-brand-navy">{q.position}. {q.prompt}{q.required ? <span className="text-red-600"> *</span> : <span className="text-xs font-normal text-brand-body"> (optional)</span>}</legend>
              {q.help && <p className="mt-1 text-sm text-brand-body">{q.help}</p>}
              <div className="mt-3">
                {q.kind === 'rating' && <Rating q={q} value={a} onChange={(v) => set(q.id, v)} />}
                {q.kind === 'yesno' && (
                  <div role="radiogroup" aria-label={q.prompt} className="flex gap-2">
                    {[['yes', 'Yes'], ['no', 'No']].map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={a === v} onClick={() => set(q.id, v)} className={`rounded-lg border px-5 py-2 font-semibold ${a === v ? 'border-brand-blue bg-brand-blue text-white' : 'border-brand-line bg-white text-brand-navy hover:border-brand-blue'}`}>{l}</button>)}
                  </div>
                )}
                {q.kind === 'choice_text' && (
                  <div className="space-y-2">
                    {q.options.choices.map((c) => (
                      <label key={c} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={!!a?.choices?.includes(c)}
                        onChange={(e) => { const cur = new Set(a?.choices || []); if (e.target.checked) cur.add(c); else cur.delete(c); set(q.id, { choices: [...cur], text: a?.text || '' }); }} /><span>{c}</span></label>
                    ))}
                    {q.options.allowText && <textarea value={a?.text || ''} onChange={(e) => set(q.id, { choices: a?.choices || [], text: e.target.value })} rows={2} maxLength={1000} aria-label={q.options.textLabel || 'Anything else'} placeholder={q.options.textLabel || 'Anything else?'} className="w-full rounded-lg border border-brand-line px-3 py-2 text-sm" />}
                  </div>
                )}
                {q.kind === 'text' && <textarea value={a || ''} onChange={(e) => set(q.id, e.target.value)} rows={4} maxLength={3000} aria-label={q.prompt} className="w-full rounded-lg border border-brand-line px-3 py-2 text-sm" />}
                {q.kind === 'photo' && (
                  <div className="space-y-2 text-sm">
                    {photo ? <p>Photo ready: <b className="break-anywhere">{photo.fileName}</b> <button type="button" className="ml-2 text-red-700 underline" onClick={removePhoto}>Remove</button></p> : null}
                    <label className="inline-block cursor-pointer rounded-lg border border-brand-line bg-white px-4 py-2 font-semibold hover:bg-slate-50">{photo ? 'Choose a different photo' : 'Choose a photo'}
                      <input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={uploadPhoto} disabled={busy} className="sr-only" />
                    </label>
                    <p className="text-xs text-brand-body">PNG or JPG, up to 5 MB.</p>
                  </div>
                )}
                {q.kind === 'consent' && (
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={a === true} onChange={(e) => set(q.id, e.target.checked)} /><span>I agree. {photo ? <b>(Required to share your photo.)</b> : '(Only needed if you upload a photo.)'}</span></label>
                )}
              </div>
            </fieldset>
          </Card>
        );
      })}
      {err && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</p>}
      <button className={btn} onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit survey'}</button>
    </div>
  );
}

export default function LearnerSurveys() {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState('');
  const [err, setErr] = useState('');
  const [thanks, setThanks] = useState(false);
  const reload = useCallback(() => api('/learner/surveys').then((r) => setList(r.surveys)).catch((e) => setErr(e.message)), []);
  useEffect(() => { api('/learner/surveys').then((r) => setList(r.surveys)).catch((e) => setErr(e.message)); }, []);

  return (
    <div className="min-h-screen bg-brand-bg font-body">
      <LearnerNav />
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 pb-24 sm:px-6 sm:py-8">
        {openId ? <SurveyForm id={openId} onBack={() => setOpenId('')} onDone={() => { setOpenId(''); setThanks(true); reload(); }} /> : (
          <>
            <h1 className="font-heading text-2xl font-extrabold text-brand-navy sm:text-3xl">Surveys</h1>
            <Banner error={err} message={thanks ? 'Thank you! Your answers were submitted.' : ''} />
            {!list && !err && <p className="text-brand-body">Loading…</p>}
            {list?.length === 0 && <Card><p className="text-brand-body">There are no open surveys right now. We will let you know when one opens.</p></Card>}
            {list?.map((s) => (
              <Card key={s.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-brand-navy">{s.title}</p>
                    {s.intro && <p className="text-sm text-brand-body">{s.intro}</p>}
                    <p className="text-xs text-brand-body">Closes {fmt(s.closesAt)}</p>
                  </div>
                  {s.submitted ? <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-800">Submitted</span> : <button className={btn} onClick={() => { setThanks(false); setOpenId(s.id); }}>Start</button>}
                </div>
              </Card>
            ))}
          </>
        )}
      </main>
      <FeedbackWidget />
    </div>
  );
}
