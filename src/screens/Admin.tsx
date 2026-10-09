import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc } from '../lib/api';
import { CSV_TEMPLATE, csvToQuestions } from '../lib/csv';
import { useI18n } from '../lib/i18n';
import { useSession } from '../lib/session';
import { UNITS } from '../lib/units';
import { Button, Card, Empty, ErrorBox, Field, Loading, Screen, Segmented, Sheet, cx, inputClass, useToast } from '../components/ui';

// Admin pages: CSV upload, two-reviewer queue, question bank, reports,
// settings and moderation. English only: used by the builder and volunteer reviewers.

interface AdminQuestion {
  id: number;
  unit: string;
  subtopic: string;
  difficulty: number;
  text_ta: string | null;
  text_en: string | null;
  options_ta: string[] | null;
  options_en: string[] | null;
  answer: number;
  explanation_ta: string | null;
  explanation_en: string | null;
  source: string | null;
  book_ref: string | null;
  image_url: string | null;
  status: string;
  review_note: string | null;
  reviewer_names: string[];
  created_by_name: string | null;
  i_reviewed?: boolean;
  times_shown: number;
  accuracy: number | null;
  report_count: number;
}

type Tab = 'overview' | 'upload' | 'review' | 'bank' | 'reports' | 'settings' | 'moderation';

export default function Admin() {
  const { profile } = useSession();
  const [tab, setTab] = useState<Tab>('review');
  const [editing, setEditing] = useState<Partial<AdminQuestion> | null>(null);
  const [version, setVersion] = useState(0);
  if (!profile?.is_admin) {
    return (
      <Screen title="Admin" back="/profile">
        <Empty icon="🔒">Admins only.</Empty>
      </Screen>
    );
  }
  return (
    <Screen title="Admin" back="/profile" wide>
      <div className="space-y-4">
        <Segmented
          small
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'upload', label: 'Upload CSV' },
            { value: 'review', label: 'Review queue' },
            { value: 'bank', label: 'Question bank' },
            { value: 'reports', label: 'Reports' },
            { value: 'settings', label: 'Settings' },
            { value: 'moderation', label: 'Moderation' },
          ]}
        />
        <div key={version}>
          {tab === 'overview' && <Overview />}
          {tab === 'upload' && <Upload />}
          {tab === 'review' && <QuestionList status="review" onEdit={setEditing} review />}
          {tab === 'bank' && <QuestionList status="live" onEdit={setEditing} />}
          {tab === 'reports' && <Reports onEdit={setEditing} />}
          {tab === 'settings' && <Settings />}
          {tab === 'moderation' && <Moderation />}
        </div>
        <Button variant="secondary" onClick={() => setEditing({ unit: 'tamil', difficulty: 2, answer: 0 })}>
          + New question
        </Button>
      </div>
      {editing && (
        <QuestionEditor
          q={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </Screen>
  );
}

function useLoad<T>(fn: () => Promise<T>) {
  const { errorText } = useI18n();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const fnRef = useRef(fn);
  fnRef.current = fn; // callers rebuild fn with their current filters
  const load = useCallback(async () => {
    setError('');
    try {
      setData(await fnRef.current());
    } catch (e) {
      setError(errorText(e));
    }
  }, [errorText]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, load, setData };
}

function Overview() {
  const { data, error, load } = useLoad(() => rpc<Record<string, unknown>>('admin_stats'));
  if (error) return <ErrorBox text={error} onRetry={load} />;
  if (!data) return <Loading />;
  return (
    <Card>
      <pre className="overflow-x-auto whitespace-pre-wrap text-sm">{JSON.stringify(data, null, 2)}</pre>
    </Card>
  );
}

function Upload() {
  const toast = useToast();
  const { errorText } = useI18n();
  const [parsed, setParsed] = useState<ReturnType<typeof csvToQuestions> | null>(null);
  const [result, setResult] = useState<{ inserted: number; errors: { row: number; error: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="space-y-3">
      <p className="text-sm">
        Columns: unit, subtopic, difficulty (1–5), answer (A–D), text_ta, option_a_ta…option_d_ta, explanation_ta, text_en, option_a_en…option_d_en,
        explanation_en, source, book_ref, image_url. Unit keys: {UNITS.map((u) => u.key).join(', ')}. Part A (tamil) needs Tamil text. Save as “CSV UTF-8”.
        Imported questions go to the review queue and need two reviewers who did not write them.
      </p>
      <a
        className="inline-block text-sm font-semibold text-accent underline"
        download="question-template.csv"
        href={`data:text/csv;charset=utf-8,${encodeURIComponent('﻿' + CSV_TEMPLATE)}`}
      >
        Download template
      </a>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setResult(null);
          setParsed(csvToQuestions(await file.text()));
        }}
      />
      {parsed && (
        <div className="space-y-2">
          {parsed.missing.length > 0 ? (
            <p className="text-sm text-bad">Missing columns: {parsed.missing.join(', ')}</p>
          ) : (
            <p className="text-sm font-semibold">{parsed.items.length} rows ready.</p>
          )}
          <Button
            disabled={!parsed.items.length || parsed.missing.length > 0}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setResult(await rpc('admin_import_questions', { p_rows: parsed.items }));
              } catch (e) {
                toast(errorText(e), 'bad');
              } finally {
                setBusy(false);
              }
            }}
          >
            Import {parsed.items.length} questions
          </Button>
        </div>
      )}
      {result && (
        <div className="text-sm">
          <p className="font-bold text-ok">Inserted {result.inserted} into the review queue.</p>
          {result.errors.map((e) => (
            <p key={e.row} className="text-bad">
              Row {e.row + 1}: {e.error}
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

function QuestionView({ q }: { q: AdminQuestion }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-muted">
        #{q.id} · {q.unit} · {q.subtopic} · difficulty {q.difficulty} · {q.source ?? 'no source'} · by {q.created_by_name ?? '—'}
        {q.times_shown > 0 && ` · shown ${q.times_shown}, ${Math.round((q.accuracy ?? 0) * 100)}% correct`}
        {q.report_count > 0 && ` · ${q.report_count} reports`}
      </p>
      {(['ta', 'en'] as const).map((l) => {
        const text = l === 'ta' ? q.text_ta : q.text_en;
        const opts = l === 'ta' ? q.options_ta : q.options_en;
        if (!text) return null;
        return (
          <div key={l} lang={l}>
            <p className="font-semibold">{text}</p>
            <ol className="ml-1">
              {opts?.map((o, i) => (
                <li key={i} className={cx(i === q.answer && 'font-bold text-ok')}>
                  {'ABCD'[i]}. {o} {i === q.answer && '✓'}
                </li>
              ))}
            </ol>
            <p className="text-muted">{l === 'ta' ? q.explanation_ta : q.explanation_en}</p>
          </div>
        );
      })}
      {q.book_ref && <p className="text-xs">📘 {q.book_ref}</p>}
      {q.review_note && <p className="text-xs text-bad">Note: {q.review_note}</p>}
      {q.reviewer_names.length > 0 && <p className="text-xs">Approved by: {q.reviewer_names.join(', ')}</p>}
    </div>
  );
}

function QuestionList({ status: initial, onEdit, review }: { status: string; onEdit: (q: AdminQuestion) => void; review?: boolean }) {
  const toast = useToast();
  const { errorText } = useI18n();
  const [status, setStatus] = useState(initial);
  const [unit, setUnit] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const { data, error, load } = useLoad(() =>
    rpc<{ total: number; items: AdminQuestion[] }>('admin_list_questions', {
      p_status: status || null, p_unit: unit || null, p_search: search || null, p_limit: 25, p_offset: offset,
    }),
  );
  useEffect(() => {
    void load();
  }, [status, unit, search, offset, load]);

  const act = async (fn: string, args: Record<string, unknown>) => {
    try {
      await rpc(fn, args);
      void load();
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  };

  return (
    <div className="space-y-3">
      {!review && (
        <div className="grid grid-cols-3 gap-2">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            {['live', 'review', 'draft', 'retired', ''].map((s) => (
              <option key={s} value={s}>
                {s || 'any status'}
              </option>
            ))}
          </select>
          <select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">all units</option>
            {UNITS.map((u) => (
              <option key={u.key} value={u.key}>
                {u.key}
              </option>
            ))}
          </select>
          <input className={inputClass} placeholder="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}
      {error && <ErrorBox text={error} onRetry={load} />}
      {!data && !error && <Loading />}
      {data && <p className="text-sm text-muted">{data.total} questions</p>}
      {data?.items.length === 0 && <Empty icon="✅">Nothing here.</Empty>}
      {data?.items.map((q) => (
        <Card key={q.id}>
          <QuestionView q={q} />
          <div className="mt-3 flex flex-wrap gap-2">
            {review && (
              <>
                <Button size="sm" disabled={q.i_reviewed} onClick={() => void act('admin_review', { p_question: q.id, p_approve: true })}>
                  {q.i_reviewed ? 'Approved by you' : `Approve (${q.reviewer_names.length}/2)`}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const note = prompt('Why is it rejected? (shown to the author)');
                    if (note !== null) void act('admin_review', { p_question: q.id, p_approve: false, p_note: note });
                  }}
                >
                  Reject
                </Button>
              </>
            )}
            <Button size="sm" variant="secondary" onClick={() => onEdit(q)}>
              Edit
            </Button>
            {q.status === 'live' && (
              <Button size="sm" variant="ghost" onClick={() => void act('admin_set_question_status', { p_question: q.id, p_status: 'retired' })}>
                Retire
              </Button>
            )}
            {(q.status === 'draft' || q.status === 'retired') && (
              <Button size="sm" variant="ghost" onClick={() => void act('admin_set_question_status', { p_question: q.id, p_status: 'review' })}>
                Send to review
              </Button>
            )}
          </div>
        </Card>
      ))}
      {data && data.total > 25 && (
        <div className="flex justify-between">
          <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>
            ← Prev
          </Button>
          <Button size="sm" variant="ghost" disabled={offset + 25 >= data.total} onClick={() => setOffset(offset + 25)}>
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}

function QuestionEditor({ q, onClose, onSaved }: { q: Partial<AdminQuestion>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { errorText } = useI18n();
  const [f, setF] = useState({
    unit: q.unit ?? 'tamil', subtopic: q.subtopic ?? '', difficulty: String(q.difficulty ?? 2), answer: 'ABCD'[q.answer ?? 0],
    text_ta: q.text_ta ?? '', options_ta: q.options_ta ?? ['', '', '', ''], explanation_ta: q.explanation_ta ?? '',
    text_en: q.text_en ?? '', options_en: q.options_en ?? ['', '', '', ''], explanation_en: q.explanation_en ?? '',
    source: q.source ?? 'original', book_ref: q.book_ref ?? '', image_url: q.image_url ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Sheet open onClose={onClose} title={q.id ? `Edit #${q.id} (goes back to review)` : 'New question'}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Field label="Unit">
            <select className={inputClass} value={f.unit} onChange={(e) => set('unit', e.target.value)}>
              {UNITS.map((u) => (
                <option key={u.key}>{u.key}</option>
              ))}
            </select>
          </Field>
          <Field label="Difficulty">
            <select className={inputClass} value={f.difficulty} onChange={(e) => set('difficulty', e.target.value)}>
              {[1, 2, 3, 4, 5].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
          <Field label="Answer">
            <select className={inputClass} value={f.answer} onChange={(e) => set('answer', e.target.value)}>
              {['A', 'B', 'C', 'D'].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Sub-topic (GS: “English · தமிழ்”)">
          <input className={inputClass} value={f.subtopic} onChange={(e) => set('subtopic', e.target.value)} />
        </Field>
        {(['ta', 'en'] as const).map((l) => (
          <fieldset key={l} className="space-y-2 rounded-2xl border border-line p-3">
            <legend className="px-1 text-sm font-bold">{l === 'ta' ? 'Tamil' : 'English'}</legend>
            <textarea className={`${inputClass} min-h-20 py-2`} placeholder="Question" lang={l} value={f[`text_${l}`]} onChange={(e) => set(`text_${l}`, e.target.value)} />
            {[0, 1, 2, 3].map((i) => (
              <input
                key={i}
                className={inputClass}
                lang={l}
                placeholder={`Option ${'ABCD'[i]}`}
                value={f[`options_${l}`][i]}
                onChange={(e) => {
                  const o = [...f[`options_${l}`]];
                  o[i] = e.target.value;
                  set(`options_${l}`, o);
                }}
              />
            ))}
            <textarea className={`${inputClass} min-h-16 py-2`} placeholder="Explanation (2–3 lines)" lang={l} value={f[`explanation_${l}`]} onChange={(e) => set(`explanation_${l}`, e.target.value)} />
          </fieldset>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Source (PYQ year or original)">
            <input className={inputClass} value={f.source} onChange={(e) => set('source', e.target.value)} />
          </Field>
          <Field label="Samacheer book / chapter">
            <input className={inputClass} value={f.book_ref} onChange={(e) => set('book_ref', e.target.value)} />
          </Field>
        </div>
        <Field label="Image URL (optional)">
          <input className={inputClass} value={f.image_url} onChange={(e) => set('image_url', e.target.value)} />
        </Field>
        <Button
          block
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await rpc('admin_save_question', {
                p_question: q.id ?? null,
                p_data: { ...f, options_ta: f.text_ta ? f.options_ta : null, options_en: f.text_en ? f.options_en : null },
              });
              toast('Saved: now in the review queue', 'ok');
              onSaved();
            } catch (e) {
              toast(e instanceof Error && !/^[a-z_]+$/.test(e.message) ? e.message : errorText(e), 'bad');
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
      </div>
    </Sheet>
  );
}

interface Report {
  id: number;
  kind: string;
  reason: string;
  details: string | null;
  message_body: string | null;
  created_at: string;
  reporter: { name: string };
  target: { name: string; username: string } | null;
  target_upheld: number;
  question: AdminQuestion | null;
}

function Reports({ onEdit }: { onEdit: (q: AdminQuestion) => void }) {
  const toast = useToast();
  const { errorText } = useI18n();
  const { data, error, load } = useLoad(() => rpc<Report[]>('admin_list_reports', { p_status: 'open' }));
  const resolve = async (id: number, upheld: boolean) => {
    try {
      await rpc('admin_resolve_report', { p_report: id, p_upheld: upheld });
      void load();
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  };
  if (error) return <ErrorBox text={error} onRetry={load} />;
  if (!data) return <Loading />;
  if (!data.length) return <Empty icon="🎉">No open reports. Target: resolve within 48 hours.</Empty>;
  return (
    <div className="space-y-3">
      {data.map((r) => (
        <Card key={r.id}>
          <p className="text-xs text-muted">
            {r.kind} · {r.reason} · {new Date(r.created_at).toLocaleString()} · by {r.reporter.name}
          </p>
          {r.details && <p className="text-sm">“{r.details}”</p>}
          {r.message_body && <p className="rounded-xl bg-surface-2 p-2 text-sm">{r.message_body}</p>}
          {r.target && (
            <p className="text-sm">
              Against @{r.target.username} ({r.target_upheld} upheld so far; 3 → 24 h chat mute)
            </p>
          )}
          {r.question && (
            <div className="mt-2 rounded-xl border border-line p-2">
              <QuestionView q={r.question} />
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void resolve(r.id, true)}>
              Uphold {r.kind === 'question' && '(+20 coins to reporter)'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void resolve(r.id, false)}>
              Reject
            </Button>
            {r.question && (
              <Button size="sm" variant="ghost" onClick={() => onEdit(r.question!)}>
                Fix question
              </Button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Settings() {
  const toast = useToast();
  const { errorText } = useI18n();
  const { data, error, load } = useLoad(() => rpc<{ key: string; value: unknown; note: string | null }[]>('admin_settings'));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (error) return <ErrorBox text={error} onRetry={load} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-2">
      {data.map((s) => {
        const value = drafts[s.key] ?? JSON.stringify(s.value);
        return (
          <Card key={s.key} className="!p-3">
            <p className="font-mono text-sm font-bold">{s.key}</p>
            {s.note && <p className="text-xs text-muted">{s.note}</p>}
            <div className="mt-2 flex gap-2">
              <input className={`${inputClass} font-mono text-sm`} value={value} onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))} />
              <Button
                size="sm"
                disabled={drafts[s.key] === undefined}
                onClick={async () => {
                  try {
                    await rpc('admin_set_setting', { p_key: s.key, p_value: JSON.parse(value) });
                    toast('Saved', 'ok');
                    setDrafts((d) => {
                      const { [s.key]: _, ...rest } = d;
                      return rest;
                    });
                    void load();
                  } catch (e) {
                    toast(e instanceof SyntaxError ? 'Not valid JSON' : errorText(e), 'bad');
                  }
                }}
              >
                Save
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Moderation() {
  const toast = useToast();
  const { errorText } = useI18n();
  const words = useLoad(() => rpc<{ word: string; match_inside: boolean }[]>('admin_banned_words'));
  const flags = useLoad(() =>
    rpc<{ id: number; matches: number; coins: number; a: { name: string; username: string }; b: { name: string; username: string } }[]>('admin_collusion'),
  );
  const [word, setWord] = useState('');
  const [inside, setInside] = useState(false);
  const run = async (fn: string, args: Record<string, unknown>, reload: () => Promise<void>) => {
    try {
      await rpc(fn, args);
      void reload();
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  };
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h3 className="font-bold">Profanity list (Tamil, Tanglish, English)</h3>
        <div className="flex gap-2">
          <input className={inputClass} placeholder="word or phrase" value={word} onChange={(e) => setWord(e.target.value)} />
          <label className="flex shrink-0 items-center gap-1 text-xs">
            <input type="checkbox" checked={inside} onChange={(e) => setInside(e.target.checked)} /> inside words
          </label>
          <Button size="sm" disabled={!word.trim()} onClick={() => void run('admin_set_banned_word', { p_word: word, p_match_inside: inside }, words.load).then(() => setWord(''))}>
            Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {words.data?.map((w) => (
            <button
              key={w.word}
              className="rounded-full bg-surface-2 px-3 py-1 text-sm"
              title="Remove"
              onClick={() => void run('admin_set_banned_word', { p_word: w.word, p_match_inside: false, p_remove: true }, words.load)}
            >
              {w.word}
              {w.match_inside && '*'} ✕
            </button>
          ))}
        </div>
      </Card>
      <ResetPassword />
      <Card className="space-y-2">
        <h3 className="font-bold">Collusion flags (stakes frozen until reviewed)</h3>
        {flags.data?.length === 0 && <p className="text-sm text-muted">None.</p>}
        {flags.data?.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="flex-1">
              @{f.a.username} vs @{f.b.username}: {f.matches} one-sided 250+ matches, {f.coins} coins
            </span>
            <Button size="sm" variant="danger" onClick={() => void run('admin_resolve_collusion', { p_flag: f.id, p_confirmed: true }, flags.load)}>
              Confirm
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void run('admin_resolve_collusion', { p_flag: f.id, p_confirmed: false }, flags.load)}>
              Clear & unfreeze
            </Button>
          </div>
        ))}
      </Card>
    </div>
  );
}

/** No reset emails in this app: an admin sets a temporary password, the player changes it in Profile. */
function ResetPassword() {
  const toast = useToast();
  const { errorText } = useI18n();
  const [username, setUsername] = useState('');
  const [temp, setTemp] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Card className="space-y-3">
      <h3 className="font-bold">Reset a player's password</h3>
      <p className="text-sm text-muted">Check it is really them first (e.g. a message from their known phone). Give them the temporary password; they change it in Profile.</p>
      <div className="flex gap-2">
        <input className={inputClass} placeholder="username" value={username} autoCapitalize="none" onChange={(e) => setUsername(e.target.value.toLowerCase())} />
        <Button
          size="sm"
          disabled={username.length < 3}
          loading={busy}
          onClick={async () => {
            const pw = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
            setBusy(true);
            try {
              await rpc('admin_reset_password', { p_username: username, p_password: pw });
              setTemp(pw);
            } catch (e) {
              toast(errorText(e), 'bad');
            } finally {
              setBusy(false);
            }
          }}
        >
          Reset
        </Button>
      </div>
      {temp && (
        <p className="rounded-xl bg-surface-2 p-3 text-sm">
          Temporary password for @{username}: <span className="font-mono text-lg font-bold">{temp}</span>
        </p>
      )}
    </Card>
  );
}
