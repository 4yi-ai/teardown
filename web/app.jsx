import React, {useCallback, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Box, Plus, Sparkles, RotateCw, ExternalLink} from 'lucide-react';
import {Button, Card, Textarea} from './ui.jsx';
import {isValidDescription, MAX_DESCRIPTION_LENGTH} from './description.mjs';
import {initialLocale, messages} from './i18n.mjs';
import './style.css';

async function api(url, options) {
  const r = await fetch(url, options); const value = await r.json();
  if (!r.ok) throw new Error(value.error || 'request_failed');
  return value;
}
function App() {
  const [locale, setLocale] = useState(() => initialLocale(localStorage.getItem('teardown-locale'), navigator.language));
  const t = messages[locale];
  useEffect(() => { if (localStorage.getItem('teardown-locale')) return; api('/api/locale').then(({locale: preferred}) => { if (preferred === 'zh' || preferred === 'en') setLocale(preferred); }).catch(() => {}); }, []);
  useEffect(() => { document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'; }, [locale]);
  const [description, setDescription] = useState(''); const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [loadError, setLoadError] = useState(false);
  const [previewHtml, setPreviewHtml] = useState(null); const [previewError, setPreviewError] = useState(false);
  const refresh = useCallback(async () => {
    try { const value = await api('/api/jobs'); setJobs(value.jobs); setLoadError(false); }
    catch { setLoadError(true); }
  }, []);
  useEffect(() => { void refresh(); const id = setInterval(refresh, 3000); return () => clearInterval(id); }, [refresh]);
  const active = jobs.find(job => job.id === selected) || jobs[0];
  useEffect(() => {
    const controller = new AbortController(); setPreviewHtml(null); setPreviewError(false);
    if (active?.status === 'completed') fetch(`/api/jobs/${active.id}/preview`, {signal: controller.signal}).then(r => { if (!r.ok) throw new Error('preview_failed'); return r.text(); }).then(setPreviewHtml).catch(e => { if (e.name !== 'AbortError') setPreviewError(true); });
    return () => controller.abort();
  }, [active?.id, active?.status]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const job = await api('/api/jobs', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({description, locale})}); setSelected(job.id); setDescription(''); await refresh(); }
    catch (err) { setError(err.message === 'job_already_running' ? 'busyError' : err.message === 'job_capacity_reached' ? 'capacityError' : 'createError'); }
    finally { setBusy(false); }
  }
  async function cancel(id) { try { await api(`/api/jobs/${id}/cancel`, {method:'POST'}); await refresh(); } catch { setError('cancelError'); } }
  return <div className="shell">
    <header className="top"><div className="brand"><Box aria-hidden="true"/><strong>4yi Teardown</strong></div><span className="top-sub">{t.subtitle}</span><Button variant="outline" onClick={() => { const next = locale === 'zh' ? 'en' : 'zh'; localStorage.setItem('teardown-locale', next); setLocale(next); }} aria-label={locale === 'zh' ? 'Switch to English' : '切换为简体中文'}>{t.language}</Button></header>
    <div className="layout"><aside className="sidebar"><Button onClick={() => {setSelected(null); document.querySelector('#description')?.focus();}}><Plus data-icon="inline-start"/>{t.newTask}</Button><h2>{t.tasks}</h2><div className="task-list">{jobs.length === 0 ? <p className="muted">{t.noTasks}</p> : jobs.map(job => <button className={`task ${active?.id === job.id ? 'selected' : ''}`} key={job.id} onClick={() => setSelected(job.id)}><Box aria-hidden="true"/><span><strong>{job.description}</strong><small>{t.statuses[job.status] || job.status}</small></span></button>)}</div></aside>
    <main className="main"><div className="heading"><h1>{t.title}</h1><p>{t.intro}</p></div>
      <Card><form onSubmit={submit} className="form"><label htmlFor="description">{t.question}</label><Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} maxLength={MAX_DESCRIPTION_LENGTH} required aria-describedby="description-help" placeholder={t.placeholder}/><p id="description-help" className="muted">{t.hint}</p><div className="actions"><Button type="submit" disabled={busy || !isValidDescription(description)}><Sparkles data-icon="inline-start"/>{busy ? t.submitting : t.generate}</Button></div></form></Card>
      {(error || loadError) && <div role="alert" className="alert">{error ? t[error] : t.loadError}</div>}
      <div className="section-title"><h2>{t.results}</h2><Button variant="outline" onClick={refresh}><RotateCw data-icon="inline-start"/>{t.refresh}</Button></div>
      <Card className="result">{!active ? <div className="empty"><Box/><h3>{t.emptyTitle}</h3><p>{t.empty}</p></div> : <><div className="result-head"><div className="result-description"><h3>{active.description.length > 60 ? `${active.description.slice(0, 60)}…` : active.description}</h3>{active.description.length > 60 && <details><summary>{t.full}</summary><p>{active.description}</p></details>}<p className="muted">{t.statuses[active.status] || active.status}</p></div><div className="actions">{['queued','generating'].includes(active.status) && <Button variant="outline" onClick={() => cancel(active.id)}>{t.cancel}</Button>}{['failed','cancelled'].includes(active.status) && <Button variant="outline" onClick={() => setDescription(active.description)}>{t.edit}</Button>}{active.status === 'completed' && <Button variant="outline" onClick={() => window.open(`/api/jobs/${active.id}/preview`, '_blank', 'noopener,noreferrer')}><ExternalLink data-icon="inline-start"/>{t.open}</Button>}</div></div>{active.status === 'completed' ? previewError ? <p role="alert">{t.previewError}</p> : previewHtml ? <iframe title={t.preview} sandbox="allow-scripts" srcDoc={previewHtml}/> : <p>{t.working}</p> : <div className="empty"><p>{active.status === 'failed' ? active.error === 'balance_required' ? t.balance : t.failed : active.status === 'cancelled' ? t.cancelled : t.working}</p></div>}</>}</Card>
    </main><aside className="help"><Card><h2>{t.suggestions}</h2><p className="muted">{t.select}</p>{t.examples.map(text => <button key={text} className="suggestion" onClick={() => setDescription(text)}>{text}</button>)}</Card><Card><h2>{t.tips}</h2><ul>{t.tipsList.map(tip => <li key={tip}>{tip}</li>)}</ul></Card></aside></div>
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
