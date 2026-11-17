import { downloadCsv } from '../lib/csv';
import { Card } from './ui';

// Invite codes that could not be emailed. Shown once; only hashes are stored on the server.
export default function CodesPanel({ title, rows, onDismiss }) {
  if (!rows) return null;
  return (
    <Card className="border-brand-gold">
      <h2 className="font-heading text-xl font-bold text-brand-navy mb-1">{title}</h2>
      <p className="text-sm text-brand-body mb-3">Shown once. Send each person their code privately (not in a group chat), together with the activation link on your site (/claim). Only hashes are stored.</p>
      {rows.length === 0 ? <p className="text-sm">Nothing to hand over.</p> : (
        <>
          <div className="max-h-64 overflow-auto text-sm">
            {rows.map((r) => <div key={r.email} className="flex gap-4 py-1 border-b border-brand-border"><span className="flex-1">{r.name || ''} {r.email}</span><code className="font-bold">{r.code}</code></div>)}
          </div>
          <button className="mt-3 bg-brand-blue text-white px-4 py-2 rounded-lg font-semibold hover:bg-brand-navy" onClick={() => downloadCsv('invite-codes.csv', rows.map(({ name, email, code }) => ({ name, email, code })))}>Download CSV</button>
        </>
      )}
      <button className="ml-3 text-sm text-brand-body underline" onClick={onDismiss}>Dismiss</button>
    </Card>
  );
}
