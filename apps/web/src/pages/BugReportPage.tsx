import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api.js';

const MAX_FILES = 3;
const MAX_SIZE = 2 * 1024 * 1024;

export function BugReportPage() {
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const chosen = Array.from(e.target.files ?? []);
    if (chosen.length > MAX_FILES) {
      setError(`At most ${MAX_FILES} screenshots`);
      e.target.value = '';
      return;
    }
    const oversized = chosen.find((f) => f.size > MAX_SIZE);
    if (oversized) {
      setError(`“${oversized.name}” is over 2 MB`);
      e.target.value = '';
      return;
    }
    setFiles(chosen);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('description', description);
      for (const f of files) form.append('screenshots', f);
      await api.post('/api/bug-reports', form);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Report a bug</h1>
        <Link to="/" className="muted">
          ← All groups
        </Link>
      </div>

      <div className="card">
        {sent ? (
          <div className="notice">
            Thanks — your report is on its way. We read every one.
          </div>
        ) : (
          <form className="stack" onSubmit={submit}>
            <p className="muted">
              What went wrong, and what did you expect to happen? Screenshots
              help a lot.
            </p>
            <textarea
              rows={6}
              placeholder="Describe the bug…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              minLength={10}
              maxLength={2000}
              required
            />
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={pick}
            />
            {files.length > 0 && (
              <span className="muted">
                {files.map((f) => f.name).join(', ')} (
                {(files.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(
                  1,
                )}{' '}
                MB)
              </span>
            )}
            {error && <div className="error">{error}</div>}
            <div className="row">
              <button disabled={busy}>Send report</button>
              <span className="muted">Up to 3 screenshots, 2 MB each</span>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
