import React, {useCallback, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Box, Plus, Sparkles, RotateCw, ExternalLink} from 'lucide-react';
import {Button, Card, Textarea} from './ui.jsx';
import './style.css';

const labels = {queued: '排队中', generating: '生成中', completed: '已完成', failed: '生成失败', cancelled: '已取消'};
async function api(url, options) {
  const r = await fetch(url, options); const value = await r.json();
  if (!r.ok) throw new Error(value.error || 'request_failed');
  return value;
}
function App() {
  const [description, setDescription] = useState(''); const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [loadError, setLoadError] = useState('');
  const refresh = useCallback(async () => {
    try { const value = await api('/api/jobs'); setJobs(value.jobs); setLoadError(''); }
    catch { setLoadError('无法读取任务，请检查连接并重试。'); }
  }, []);
  useEffect(() => { void refresh(); const id = setInterval(refresh, 3000); return () => clearInterval(id); }, [refresh]);
  const active = jobs.find(job => job.id === selected) || jobs[0];
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const job = await api('/api/jobs', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({description})});
      setSelected(job.id); setDescription(''); await refresh();
    } catch (err) { setError(err.message === 'job_already_running' ? '已有任务正在生成，请等待完成。' : err.message === 'job_capacity_reached' ? '当前任务较多，请稍后重试。' : '无法创建任务，请检查输入或稍后重试。'); }
    finally { setBusy(false); }
  }
  async function cancel(id) {
    try { await api(`/api/jobs/${id}/cancel`, {method: 'POST'}); await refresh(); }
    catch { setError('无法取消任务，请刷新后重试。'); }
  }
  return <div className="shell">
    <header className="top"><div className="brand"><Box aria-hidden="true"/><strong>4yi Teardown</strong></div><span className="top-sub">机械模拟器工作台</span></header>
    <div className="layout"><aside className="sidebar"><Button onClick={() => {setSelected(null); document.querySelector('#description')?.focus();}}><Plus data-icon="inline-start"/>新建任务</Button><h2>生成任务</h2><div className="task-list">{jobs.length === 0 ? <p className="muted">暂无任务</p> : jobs.map(job => <button className={`task ${active?.id === job.id ? 'selected' : ''}`} key={job.id} onClick={() => setSelected(job.id)}><Box aria-hidden="true"/><span><strong>{job.description}</strong><small>{labels[job.status] || job.status}</small></span></button>)}</div></aside>
    <main className="main"><div className="heading"><h1>生成机械模拟器</h1><p>描述机械结构和你希望了解的工作原理，生成可交互的 3D 页面。</p></div>
      <Card><form onSubmit={submit} className="form"><label htmlFor="description">你想了解什么？</label><Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} minLength={8} maxLength={8000} required placeholder="例如：展示一个曲柄连杆如何把旋转运动转换成往复运动。"/><p className="muted">请说明主要部件、运动方式和希望交互的内容。</p><div className="actions"><Button type="submit" disabled={busy || description.trim().length < 8}><Sparkles data-icon="inline-start"/>{busy ? '正在提交…' : '生成模拟器'}</Button></div></form></Card>
      {(error || loadError) && <div role="alert" className="alert">{error || loadError}</div>}
      <div className="section-title"><h2>任务结果</h2><Button variant="outline" onClick={refresh}><RotateCw data-icon="inline-start"/>刷新</Button></div>
      <Card className="result">{!active ? <div className="empty"><Box/><h3>从一个问题开始</h3><p>提交描述后，生成进度和结果会显示在这里。</p></div> : <><div className="result-head"><div className="result-description"><h3>{active.description.length > 60 ? `${active.description.slice(0, 60)}…` : active.description}</h3>{active.description.length > 60 && <details><summary>查看完整描述</summary><p>{active.description}</p></details>}<p className="muted">{labels[active.status] || active.status}</p></div><div className="actions">{['queued', 'generating'].includes(active.status) && <Button variant="outline" onClick={() => cancel(active.id)}>取消任务</Button>}{['failed', 'cancelled'].includes(active.status) && <Button variant="outline" onClick={() => setDescription(active.description)}>重新编辑</Button>}{active.status === 'completed' && <Button variant="outline" onClick={() => window.open(`/api/jobs/${active.id}/preview`, '_blank', 'noopener,noreferrer')}><ExternalLink data-icon="inline-start"/>打开预览</Button>}</div></div>{active.status === 'completed' ? <iframe title="模拟器预览" sandbox="allow-scripts" src={`/api/jobs/${active.id}/preview`} /> : <div className="empty"><p>{active.status === 'failed' ? active.error === 'balance_required' ? '模型请求未通过额度检查，请检查该安装的网关额度。' : '任务未完成，请重新提交。' : active.status === 'cancelled' ? '任务已取消。' : '正在生成，完成后会自动显示预览。'}</p></div>}</>}</Card>
    </main><aside className="help"><Card><h2>试试这些问题</h2><p className="muted">选择一个示例，再按需要调整。</p>{['展示曲柄连杆如何将旋转转为往复运动。','展示齿轮箱的啮合和传动过程。','展示飞机起落架如何折叠和展开。'].map(text => <button key={text} className="suggestion" onClick={() => setDescription(text)}>{text}</button>)}</Card><Card><h2>描述建议</h2><ul><li>说明机械对象及关键部件。</li><li>描述希望观察的动作或变化。</li><li>注明希望使用的交互方式。</li></ul></Card></aside></div>
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
