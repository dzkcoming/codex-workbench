import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { rpc, operationId, short, plain, states, type TerminalInfo, type Jump } from './api';

export function TerminalPanel({ info, jump, onReference, onError, refresh }: { info: TerminalInfo; jump: Jump | null; onReference: (s: any) => void; onError: (e: any) => void; refresh: () => void }) {
  const host = useRef<HTMLDivElement>(null); const xterm = useRef<Terminal | null>(null);
  const [mode, setMode] = useState('screen'); const [paused, setPaused] = useState(false);
  const [session, setSession] = useState(info.session_id); const [sessions, setSessions] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]); const [cursor, setCursor] = useState(0); const [status, setStatus] = useState('');
  const [pattern, setPattern] = useState(''); const [search, setSearch] = useState<any>(null);
  const [anchor, setAnchor] = useState<number | null>(null); const [selection, setSelection] = useState<number[]>([]);
  const [ops, setOps] = useState<any[]>([]); const [showOps, setShowOps] = useState(false);
  const [localError, setLocalError] = useState(''); const [reload, setReload] = useState(0);
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const currentRef = useRef(info); currentRef.current = info;
  const sendQueue = useRef(Promise.resolve());
  useEffect(() => { setSession(info.session_id); setAnchor(null); setSelection([]); }, [info.session_id]);
  useEffect(() => { rpc('terminal_sessions', { id: info.id }).then(setSessions).catch(onError); }, [info.id, info.state, info.session_id]);
  useEffect(() => {
    if (jump?.terminal === info.id) { setSession(jump.session); setAnchor(Math.max(0, jump.start - 5)); setMode('logs'); setPaused(false); setSelection([jump.start, jump.end]); setReload(n => n + 1); }
  }, [jump]);
  useEffect(() => {
    if (!host.current) return;
    const t = new Terminal({ fontFamily: '"IBM Plex Mono", "Source Code Pro", ui-monospace, monospace', fontSize: 13, cursorBlink: false,
      scrollback: 5000, convertEol: info.kind === 'serial', theme: { background: '#0c1218', foreground: '#e8eef4', cursor: '#3d9a7a', selectionBackground: '#3d9a7a66' } });
    const fit = new FitAddon(); t.loadAddon(fit); t.open(host.current); xterm.current = t;
    const resize = () => {
      if (!host.current?.clientWidth || !host.current?.clientHeight) return;
      fit.fit();
      if (currentRef.current.state === 'connected' && session === currentRef.current.session_id) void rpc('terminal_resize', { id: info.id, cols: t.cols, rows: t.rows }).catch(() => {});
    };
    const observer = new ResizeObserver(resize); observer.observe(host.current); resize();
    const disposable = t.onData(data => {
      if (currentRef.current.state !== 'connected' || session !== currentRef.current.session_id) return;
      const operation_id = operationId();
      sendQueue.current = sendQueue.current.then(async () => {
        const r = await rpc('terminal_send', { id: info.id, data, operation_id });
        if (r.state !== 'sent') throw new Error(r.error || `输入状态：${r.state}`);
      }).catch(e => setLocalError(`${e.message}；操作 ID：${operation_id}`));
    });
    return () => { disposable.dispose(); observer.disconnect(); xterm.current = null; t.dispose(); };
  }, [info.id, session]);
  useEffect(() => {
    if (!session) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>; let after = anchor ?? 0; let initialized = false;
    setRecords([]); setCursor(0); setLocalError(''); xterm.current?.reset();
    const poll = async () => {
      try {
        if (stopped) return;
        if (pausedRef.current) { timer = setTimeout(poll, 300); return; }
        if (!initialized) {
          const all = await rpc('terminal_sessions', { id: info.id });
          if (stopped) return;
          const s = all.find((s: any) => s.id === session);
          if (anchor === null) after = Math.max(0, (s?.last_seq || 0) - 128);
          initialized = true; setStatus(after > 0 ? `屏幕从 #${after + 1} 回放；完整历史可搜索` : '原始字节回放');
        }
        const result = await rpc('terminal_read', { id: info.id, session_id: session, after_cursor: after, max_bytes: 65536 });
        if (stopped) return;
        if (result.gaps.length) setLocalError('日志存在缺口：' + result.gaps.map((g: any) => g.reason).join('；'));
        if (result.records.length) {
          const term = xterm.current;
          for (const row of result.records) {
            if (stopped || !term) break;
            if (row.raw_base64) await new Promise<void>(resolve => term.write(Uint8Array.from(atob(row.raw_base64), c => c.charCodeAt(0)), resolve));
          }
          if (stopped) return;
          setRecords(prev => [...prev, ...result.records].slice(-1500));
        }
        after = result.next_cursor; setCursor(after);
        timer = setTimeout(poll, result.has_more ? 10 : 500);
      } catch (e: any) { if (!stopped) { setLocalError(e.message); timer = setTimeout(poll, 2000); } }
    };
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [info.id, session, anchor, reload]);
  const act = async (method: string, params: any = {}) => { try { await rpc(method, { id: info.id, ...params }); refresh(); } catch (e) { onError(e); } };
  const reference = async () => {
    try {
      if (!records.length) return;
      const chosen = selection.length ? selection : [records[Math.max(0, records.length - 16)].seq, records.at(-1).seq];
      onReference(await rpc('snapshot_create', { id: info.id, session_id: session, start_seq: Math.min(...chosen), end_seq: Math.max(...chosen) }));
    } catch (e) { onError(e); }
  };
  const doSearch = async (more = false) => {
    try {
      const r = await rpc('terminal_search', { id: info.id, session_id: session, pattern, after_cursor: more ? search?.next_cursor : 0 });
      setSearch({ ...r, matches: more ? [...search.matches, ...r.matches].slice(-500) : r.matches });
    } catch (e) { onError(e); }
  };
  const connected = info.state === 'connected';
  return <section className="terminal-panel">
    <div className="panel-heading"><div><span className={`dot ${connected ? 'live' : ''}`} /><strong>{info.name}</strong><span className="badge">{info.kind.toUpperCase()}</span></div><span className="meta">{states[info.state]}</span></div>
    <div className="terminal-tools">
      <div className="segmented"><button className={mode === 'screen' ? 'selected' : ''} onClick={() => setMode('screen')}>终端</button><button className={mode === 'logs' ? 'selected' : ''} onClick={() => setMode('logs')}>日志</button></div>
      <button onClick={() => setPaused(!paused)}>{paused ? '继续显示' : '暂停显示'}</button>
      <button disabled={!records.length} onClick={reference}>{selection.length ? '引用所选范围' : '引用最近日志'}</button>
      <button className="quiet" onClick={() => act(connected ? 'terminal_close' : 'terminal_connect')}>{connected ? '断开' : '重连'}</button>
    </div>
    <div className="session-line"><select aria-label={`${info.name} 会话`} value={session || ''} onChange={e => { setSession(e.target.value); setAnchor(null); setSelection([]); }}>{sessions.map(s => <option key={s.id} value={s.id}>{new Date(s.started).toLocaleString()} · {s.ended ? '历史' : '当前'}</option>)}</select><span>#{cursor} · {short(session)}</span></div>
    {info.error && <div className="terminal-note">{info.error}</div>}
    {localError && <div className="inline-error" role="alert">{localError}</div>}
    <div className={`terminal-screen ${mode !== 'screen' ? 'hidden-screen' : ''}`} ref={host} />
    {mode === 'logs' && <div className="log-area">
      <form className="search-line" onSubmit={e => { e.preventDefault(); void doSearch(); }}><input aria-label="搜索日志" placeholder="搜索当前会话的完整日志" value={pattern} onChange={e => setPattern(e.target.value)} /><button disabled={!pattern}>搜索</button>{search && <button type="button" onClick={() => setSearch(null)}>收起</button>}</form>
      {search && <div className="search-results"><span className="meta">找到 {search.matches.length} 处 · 扫描至 #{search.next_cursor}</span>{search.matches.map((m: any, i: number) => <button key={i} onClick={() => { setAnchor(Math.max(0, m.start_seq - 5)); setSelection([m.start_seq, m.end_seq]); setReload(n => n + 1); }}><span>#{m.start_seq}–{m.end_seq}</span><pre>{m.text}</pre></button>)}{search.has_more && <button onClick={() => doSearch(true)}>继续搜索</button>}</div>}
      <div className="log-records">{!records.length && <p className="muted">等待终端输出…</p>}{records.map(row => <div className={`log-row ${selection.length && row.seq >= Math.min(...selection) && row.seq <= Math.max(...selection) ? 'highlight' : ''}`} key={row.seq}>
        <input type="checkbox" aria-label={`选择日志 ${row.seq}`} checked={selection.includes(row.seq)} onChange={e => setSelection(prev => e.target.checked ? [...prev, row.seq] : prev.filter(n => n !== row.seq))} />
        <div className="log-meta"><span>#{row.seq}</span><time>{row.received.slice(11, 23)}</time><span title={row.run_id}>{short(row.run_id)}</span></div><pre>{plain(row.text) || '〈控制字节 / 分包〉'}</pre>
      </div>)}</div>
    </div>}
    <div className="terminal-footer"><span>{paused ? '显示已暂停，后台持续采集' : status}</span><button className="text-button" onClick={async () => { setShowOps(!showOps); if (!showOps) setOps(await rpc('operation_list', { id: info.id })); }}>操作记录</button></div>
    {showOps && <div className="operations">{!ops.length && <span className="muted">暂无发送记录</span>}{ops.map(op => <div key={op.id}><span>{op.actor === 'model' ? '模型' : '人工'} · {states[op.state]}</span><code>{JSON.stringify(op.data)}</code><small title={op.id}>边界 #{op.before_cursor} · {short(op.id)} {op.error}</small></div>)}</div>}
    <label className="permission-line"><input type="checkbox" checked={info.model_write} onChange={e => act('terminal_update', { model_write: e.target.checked })} />允许模型输入<span>{info.model_write ? '关闭即可接管，已发出的输入不会撤销' : '人工控制 · 模型可读取日志'}</span></label>
  </section>;
}
