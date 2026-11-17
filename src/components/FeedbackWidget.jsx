import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

const CATEGORIES = [['bug', 'Something is broken'], ['content', 'Problem with an assessment or class'], ['access', 'I cannot sign in or open something'], ['suggestion', 'Suggestion'], ['other', 'Something else']];

// Floating "Report a problem" button for learners. The server attaches the learner's name, email, stack and cohort from
// their session, so nothing about who they are is typed or editable here.
export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('bug');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const first = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    first.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api('/learner/feedback', { method: 'POST', body: { category, message: message.trim(), pageUrl: window.location.pathname } });
      setSent(true); setMessage('');
    } catch (err) { setError(err.message); } finally { setBusy(false); } // the typed message is kept if sending fails
  }
  const close = () => { setOpen(false); setSent(false); setError(''); };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
        className="fixed bottom-4 right-4 z-40 rounded-full bg-brand-blue px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-brand-navy">
        Report a problem
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="fb-title" className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 id="fb-title" className="font-heading text-xl font-bold text-brand-navy">Report a problem</h2>
              <button type="button" onClick={close} aria-label="Close" className="text-brand-body hover:text-brand-blue">✕</button>
            </div>
            {sent ? (
              <div className="space-y-3">
                <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800" role="status">Thank you. The FUSE Varsity team has received your message and will follow up.</p>
                <button type="button" onClick={close} className="w-full rounded-lg bg-brand-blue px-4 py-2 font-semibold text-white">Close</button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <p className="text-sm text-brand-body">Your name, email and stack are included automatically.</p>
                <label className="block text-sm font-semibold text-brand-navy">What kind of problem?
                  <select ref={first} value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-brand-line bg-white px-3 py-2 font-normal">
                    {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-semibold text-brand-navy">Tell us what happened
                  <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={2000} required minLength={5}
                    className="mt-1 w-full rounded-lg border border-brand-line px-3 py-2 font-normal" placeholder="What were you trying to do, and what went wrong?" />
                  <span className="block text-right text-xs font-normal text-brand-body">{message.length}/2000</span>
                </label>
                {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
                <button disabled={busy || message.trim().length < 5} className="w-full rounded-lg bg-brand-blue px-4 py-2.5 font-semibold text-white hover:bg-brand-navy disabled:opacity-50">{busy ? 'Sending…' : 'Send'}</button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
