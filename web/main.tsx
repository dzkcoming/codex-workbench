import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { api, rpc, short, states, type TerminalInfo, type Jump } from './api';
import { TerminalPanel } from './TerminalPanel';
import './styles.css';

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={close}><div className="modal-heading"><h2>{title}</h2><button onClick={close} aria-label="关闭">×</button></div>{children}</dialog>;
}
function App() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null); const [token, setToken] = useState('');
  const [boot, setBoot] = useState<any>(null); const [workspace, setWorkspace] = useState(localStorage.getItem('workbench.workspace') || '');
  const [active, setActive] = useState(''); const [split, setSplit] = useState(false); const [error, setError] = useState('');
  const [modal, setModal] = useState<string | null>(null); const [devices, setDevices] = useState<any[]>([]);
  const [kind, setKind] = useState('shell'); const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<any>({ items: [], events: [], approvals: [] }); const revision = useRef('');
  const [text, setText] = useState(''); const [references, setReferences] = useState<any[]>([]);
  const [snapshot, setSnapshot] = useState<any>(null); const [jump, setJump] = useState<Jump | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({}); const messages = useRef<HTMLDivElement>(null);
  const onError = (e: any) => setError(e.message || String(e));
  const refresh = async () => {
    const b = await api('/api/bootstrap'); setBoot(b); setLoggedIn(true);
    setWorkspace(prev => b.workspaces.some((w: any) => w.id === prev) ? prev : b.workspaces[0]?.id || '');
  };
  useEffect(() => {
    const init = async () => {
      const hash = new URLSearchParams(location.hash.slice(1)); const saved = hash.get('token');
      if (saved) { history.replaceState(null, '', location.pathname); await api('/api/login', { token: saved }); }
      await refresh();
    };
    init().catch(() => setLoggedIn(false));
  }, []);
  useEffect(() => {
    if (!loggedIn) return;
    let stop = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { await refresh(); } catch (e) { if (!stop) onError(e); } if (!stop) timer = setTimeout(poll, 2500); };
    timer = setTimeout(poll, 2500); return () => { stop = true; clearTimeout(timer); };
  }, [loggedIn]);
  useEffect(() => {
    localStorage.setItem('workbench.workspace', workspace); setReferences([]); setActive(''); revision.current = '';
    setChat({ items: [], events: [], approvals: [] });
    if (!workspace || !loggedIn) return;
    let stop = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const r = await api(`/api/chat?workspace=${workspace}&revision=${revision.current}`); if (!stop) { revision.current = String(r.revision); setChat((prev: any) => ({ ...prev, ...r })); } }
      catch (e) { if (!stop) onError(e); }
      if (!stop) timer = setTimeout(poll, 600);
    };
    void poll(); return () => { stop = true; clearTimeout(timer); };
  }, [workspace, loggedIn]);
  useEffect(() => {
    const el = messages.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight;
  }, [chat.revision]);
  const terminals: TerminalInfo[] = (boot?.terminals || []).filter((t: TerminalInfo) => t.workspace_id === workspace);
  const chosen = terminals.find(t => t.id === active) || terminals[0];
  const current = boot?.workspaces?.find((w: any) => w.id === workspace);
  const act = async (fn: () => Promise<any>) => { setBusy(true); setError(''); try { await fn(); await refresh(); } catch (e) { onError(e); } finally { setBusy(false); } };
  const addTerminal = () => { setModal('terminal'); rpc('devices').then(setDevices).catch(onError); };
  const createTerminal = (form: HTMLFormElement) => act(async () => {
    const p = Object.fromEntries(new FormData(form));
    const t = await rpc('terminal_create', { ...p, kind, workspace_id: workspace }); setActive(t.id); setModal(null);
  });
  const addReference = (r: any) => setReferences(prev => [...prev.filter(s => s.id !== r.id), r]);
  const openLink = async (link: string) => {
    try {
      if (link.startsWith('#ref=')) setSnapshot(await rpc('snapshot_get', { id: link.slice(5) }));
      if (link.startsWith('#log=')) {
        const [terminal, session, start, end] = link.slice(5).split('/');
        const t = boot.terminals.find((t: TerminalInfo) => t.id === terminal);
        if (!t) throw new Error('引用的终端不存在');
        if (t.workspace_id !== workspace) setWorkspace(t.workspace_id);
        setActive(terminal); setJump({ terminal, session, start: Number(start), end: Number(end), nonce: Date.now() });
      }
    } catch (e) { onError(e); }
  };
  const rich = (content: string) => content.split(/(\[[^\]]+\]\(#(?:ref|log)=[^)]+\))/g).map((part, i) => {
    const match = part.match(/^\[([^\]]+)\]\((#[^)]+)\)$/);
    return match ? <button key={i} className="citation" onClick={() => openLink(match[2])}>{match[1]} ↗</button> : part;
  });
  const send = () => act(async () => {
    await api('/api/chat/send', { workspace_id: workspace, text, references: references.map(s => s.id) }); setText(''); setReferences([]);
  });
  const errorEvent = chat.events?.find((e: any) => ['error', 'client/error', 'connection/lost'].includes(e.method));
  if (loggedIn === null) return <main className="login"><p className="brand">Codex 调试台</p><p>正在连接本机后台…</p></main>;
  if (!loggedIn) return <main className="login"><p className="eyebrow">LOCAL WORKSPACE</p><p className="brand">Codex 调试台</p><h1>把终端、日志和分析放在一起。</h1><form onSubmit={e => { e.preventDefault(); act(async () => { await api('/api/login', { token }); await refresh(); }); }}><label>本机访问口令<input type="password" autoComplete="current-password" value={token} onChange={e => setToken(e.target.value)} autoFocus /></label><button className="primary" disabled={busy || !token}>进入工作台</button></form><p className="muted">在本机运行 <code>./start.sh</code> 可自动登录。远程访问时，口令位于项目的 <code>data/access-token</code>。</p>{error && <p className="error" role="alert">{error}</p>}</main>;
  return <div className="page">
    <header className="hero"><div><p className="eyebrow">TERMINAL WORKBENCH <span>/ 01</span></p><p className="brand">Codex 调试台</p><h1>多个终端，一处分析。让每条日志都有来处。</h1></div><div className="header-right"><a href={`http://${location.hostname}:10000/`}>AI Entry ↗</a><span className="status-pill"><span className={`dot ${boot?.collector?.ok ? 'live' : ''}`} />{boot?.collector?.ok ? '采集服务在线' : '采集服务异常'}</span></div></header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="关闭提示">×</button></div>}
    <main className="workbench">
      <aside className="sidebar"><div className="section-label">工作空间<button className="text-button" onClick={() => setModal('workspace')}>＋ 项目</button></div><select aria-label="当前项目" className="workspace-select" value={workspace} onChange={e => setWorkspace(e.target.value)}>{boot?.workspaces.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select><p className="project-path" title={current?.cwd}>{current?.cwd}</p>
        <div className="run-card"><span className="section-label">当前测试批次</span><code>{short(current?.run_id)}</code><button onClick={() => act(() => rpc('run_start', { workspace_id: workspace }))}>开始新批次</button></div>
        <div className="section-label terminal-label">终端 <span>{terminals.length.toString().padStart(2, '0')}</span></div><nav aria-label="终端列表">{terminals.map(t => <button className={`terminal-nav ${chosen?.id === t.id ? 'active' : ''}`} key={t.id} onClick={() => setActive(t.id)}><span className={`dot ${t.state === 'connected' ? 'live' : ''}`} /><span><strong>{t.name}</strong><small>{t.kind.toUpperCase()} · {states[t.state]}</small></span></button>)}</nav>
        <button className="add-terminal" onClick={addTerminal}>＋ 添加终端</button><div className="sidebar-note"><span className="section-label">保持现场</span><p>关闭网页后，终端仍会采集。停止 Codex 任务也不会中断日志。</p></div>
      </aside>
      <section className="terminal-workspace"><div className="workspace-heading"><h2>终端现场</h2><button disabled={terminals.length < 2} onClick={() => setSplit(!split)}>{split ? '单终端' : '双终端分屏'}</button></div>
        {!chosen ? <div className="empty-state"><span className="empty-mark">›_</span><h2>连接你的第一个终端</h2><p>打开本地 Shell、连接 SSH，<br />或接入开发板串口，开始记录现场。</p><button className="primary" onClick={addTerminal}>添加终端</button><div className="empty-types">SHELL <span>/</span> SSH <span>/</span> SERIAL</div></div> : <div className={`terminal-stack ${split ? 'split' : ''}`}>
          {(split ? [chosen, terminals.find(t => t.id !== chosen.id)].filter(Boolean) as TerminalInfo[] : [chosen]).map(t => <TerminalPanel key={t.id} info={t} jump={jump} onReference={addReference} onError={onError} refresh={() => void refresh().catch(onError)} />)}
        </div>}
      </section>
      <section className="chat-panel"><div className="workspace-heading"><h2>与 Codex 对话</h2><span className="meta">{chat.active ? '正在处理' : states[chat.status] || '未启动'}</span></div><div className="chat-toolbar"><span title={chat.thread?.thread}>{chat.thread?.model || '沿用本机 Codex 配置'} · {short(chat.thread?.thread)}</span><details><summary aria-label="会话操作">•••</summary><button disabled={busy || !!chat.active} onClick={() => act(() => api('/api/chat/new', { workspace_id: workspace }))}>新建会话</button><button disabled={busy} onClick={() => act(() => api('/api/chat/restart', {}))}>重启 Codex</button></details></div>
        <div className="messages" ref={messages}>{!chat.items?.length && <div className="chat-empty"><span className="section-label">从证据出发</span><h3>把问题交给 Codex，<br />把现场留在终端。</h3><p>选取日志引用，或用 <code>@终端名</code> 指定来源。Codex 可以继续检索完整记录。</p><button className="prompt-example" onClick={() => setText(terminals.length > 1 ? `结合 @{${terminals[0].name}} 和 @{${terminals[1].name}} 的最新日志，分析当前问题并引用证据。` : '请列出当前项目的终端，并说明它们的连接状态。')}>比较多个终端的日志 ↗</button></div>}
          {chat.items?.map((item: any) => item.type === 'agentMessage' || item.type === 'userMessage' ? <article key={item.id} className={`message ${item.type === 'userMessage' ? 'user' : 'assistant'}`}><span className="section-label">{item.type === 'userMessage' ? '你' : 'CODEX'}</span><div className="message-text">{rich(item.type === 'userMessage' ? item.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text.split('\n\n以下 JSON 为终端日志快照')[0]).join('\n') : item.text || '')}</div></article> : <details className="tool-item" key={item.id}><summary>{item.type === 'mcpToolCall' ? `终端工具 · ${item.tool}` : item.type === 'commandExecution' ? '执行命令' : item.type === 'fileChange' ? '文件修改' : item.type} <span>{item.status}</span></summary><pre>{item.command ? `${item.command}\n${item.aggregatedOutput || ''}\nexit: ${item.exitCode ?? '—'}` : JSON.stringify(item, null, 2)}</pre></details>)}
          {chat.active && <p className="working"><span className="dot live" />Codex 正在处理任务…</p>}
          {errorEvent && <details className="tool-item warning"><summary>最近的连接或任务提示</summary><pre>{JSON.stringify(errorEvent.data, null, 2)}</pre></details>}
          {chat.error && <p className="error">{chat.error}</p>}
          {chat.approvals?.map((r: any) => <div className="approval" key={r.id}><strong>{r.method.includes('UserInput') ? 'Codex 需要补充信息' : '待处理确认'}</strong>{r.params.questions ? r.params.questions.map((q: any) => <label key={q.id}>{q.question}{q.options?.map((o: any) => <button key={o.label} onClick={() => setAnswers(prev => ({ ...prev, [q.id]: o.label }))}>{o.label}</button>)}<input value={answers[q.id] || ''} onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))} /></label>) : <pre>{JSON.stringify(r.params, null, 2)}</pre>}<div className="button-row"><button onClick={() => act(() => api('/api/chat/answer', { id: r.id, accept: true, answers }))}>{r.params.questions ? '提交回答' : '允许本次'}</button>{!r.params.questions && <button onClick={() => act(() => api('/api/chat/answer', { id: r.id, accept: false }))}>拒绝</button>}</div></div>)}
        </div>
        <div className="composer">{references.length > 0 && <div className="reference-chips">{references.map(s => <div key={s.id}><button onClick={() => setSnapshot(s)}>#{s.start_seq}–{s.end_seq} · {terminals.find(t => t.id === s.terminal_id)?.name}</button><button aria-label="移除引用" onClick={() => setReferences(prev => prev.filter(r => r.id !== s.id))}>×</button></div>)}</div>}
          <textarea aria-label="给 Codex 的消息" placeholder="描述问题，或输入 @终端名…" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && text.trim() && !busy && !chat.active) void send(); }} />
          <div className="composer-actions"><span>Ctrl + Enter 发送</span>{chat.active ? <button onClick={() => act(() => api('/api/chat/interrupt', {}))}>停止任务</button> : <button className="primary" disabled={busy || !text.trim()} onClick={send}>{busy ? '正在提交…' : '发送消息 ↗'}</button>}</div>
        </div>
      </section>
    </main>
    <footer className="statusbar"><span><span className={`dot ${boot?.collector?.ok ? 'live' : ''}`} />{terminals.filter(t => t.state === 'connected').length} 路连接 · 原始日志保存在本机</span><span title={boot?.data_dir}>批次 {short(current?.run_id)} <i>/</i> Codex 0.163.0 <i>/</i> {location.host}</span></footer>
    {modal === 'terminal' && <Modal title="添加终端" close={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); void createTerminal(e.currentTarget); }}><div className="kind-tabs">{[['shell', '本地 Shell'], ['ssh', 'SSH'], ['serial', '串口']].map(([id, label]) => <button type="button" key={id} className={kind === id ? 'selected' : ''} onClick={() => setKind(id)}>{label}</button>)}</div><label>终端名称<input name="name" placeholder={kind === 'serial' ? 'dut-uart' : kind === 'ssh' ? 'build' : 'local'} required maxLength={80} autoFocus /></label>{kind === 'serial' ? <><label>设备路径<input name="path" list="serial-devices" placeholder="/dev/ttyUSB0" required /><datalist id="serial-devices">{devices.map(d => <option key={d.path} value={d.path}>{d.manufacturer} {d.serialNumber}</option>)}</datalist></label><label>波特率<input name="baudRate" type="number" defaultValue="115200" required min="50" max="4000000" /></label></> : <>{kind === 'ssh' && <><label>SSH 主机或配置别名<input name="host" placeholder="user@host 或 ~/.ssh/config 中的别名" required /></label><label>端口（22 时沿用 SSH 配置）<input name="port" type="number" defaultValue="22" min="1" max="65535" /></label></>}<label>本机工作目录<input name="cwd" defaultValue={current?.cwd} required /></label></>}<p className="muted">连接由后台持有。SSH 登录与主机指纹确认在终端中完成。</p><button className="primary" disabled={busy}>{busy ? '正在连接…' : '创建并连接'}</button></form></Modal>}
    {modal === 'workspace' && <Modal title="添加项目" close={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); const p = Object.fromEntries(new FormData(e.currentTarget)); act(async () => { const w = await rpc('workspace_create', p); setWorkspace(w.id); setModal(null); }); }}><label>项目名称<input name="name" required /></label><label>现有项目目录<input name="cwd" placeholder="/home/用户/projects/example" required /></label><button className="primary" disabled={busy}>添加项目</button></form></Modal>}
    {snapshot && <Modal title="固定日志引用" close={() => setSnapshot(null)}><div className="snapshot-meta"><span>终端 {short(snapshot.terminal_id)}</span><span>会话 {short(snapshot.session_id)}</span><span>#{snapshot.start_seq}–{snapshot.end_seq}</span><span>批次 {snapshot.run_ids?.map(short).join(', ')}</span></div>{snapshot.raw_available === false && <p className="warning">原始文件已不可用；以下快照仍完整保留。</p>}<pre className="snapshot-text">{snapshot.selection || snapshot.text}</pre><div className="button-row"><button onClick={() => { void openLink(`#log=${snapshot.terminal_id}/${snapshot.session_id}/${snapshot.start_seq}/${snapshot.end_seq}`); setSnapshot(null); }}>跳转原始记录</button><button onClick={() => { addReference(snapshot); setSnapshot(null); }}>加入对话引用</button></div></Modal>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
