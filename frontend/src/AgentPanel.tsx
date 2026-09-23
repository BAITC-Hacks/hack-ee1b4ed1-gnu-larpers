import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Callout, Card, IconButton, TextArea, Theme, Tooltip } from '@radix-ui/themes';
import { ArrowUp, ArrowUpRight, Bot, Check, ChevronDown, CircleHelp, GitBranch, Info, LoaderCircle, MessageSquarePlus, Network, RefreshCw, ScanSearch, Square, X } from 'lucide-react';
import { agentError, evidenceTransactionAction, parseAgentStatus, readAgentStream, type AgentResponse, type AgentStatus, type AgentStreamUpdate, type EvidenceAction, type EvidenceCard } from './agent';
import { roles, type GraphData, type Role } from './types';

interface AgentPanelProps {
  data: GraphData;
  selectedGid: string;
  clusterId: number | null;
  role: Role | 'all';
  direction: 'all' | 'in' | 'out';
  from: string;
  to: string;
  onAction: (action: EvidenceAction) => void;
  onSaveEvidence?: (evidence: EvidenceCard) => void;
}

interface Turn {
  id: number;
  question: string;
  selectedGid: string;
  response: AgentResponse;
  activity: AgentActivity;
}

interface AgentActivity {
  startedAt: number;
  elapsedMs: number;
  phase: 'connecting' | 'thinking' | 'tool' | 'answer' | 'validating';
  reasoning: string;
  tools: { id: string; name: string; state: 'started' | 'completed' }[];
}

type AnswerPreview = Extract<AgentStreamUpdate, { type: 'answer_preview' }>;

const toolLabels: Record<string, string> = {
  get_node: 'Показатели клиента',
  find_nodes: 'Поиск клиентов',
  get_cluster: 'Состав группы',
  get_transactions: 'Операции за период',
  trace_seed_paths: 'Пути от исходных клиентов',
  find_common_downstream: 'Общие получатели',
  explain_priority: 'Расчёт приоритета',
  suggest_data_request: 'Пробелы в данных',
};

const phaseLabels: Record<AgentActivity['phase'], string> = {
  connecting: 'Подключается к агенту',
  thinking: 'Анализирует вопрос',
  tool: 'Проверяет данные',
  answer: 'Формирует ответ',
  validating: 'Проверяет основания',
};

function ActivityDisclosure({ activity, pending = false, now }: { activity: AgentActivity; pending?: boolean; now: number }) {
  const [expanded, setExpanded] = useState(pending);
  const seconds = Math.max(0, Math.round((pending ? now - activity.startedAt : activity.elapsedMs) / 1000));
  return <details className="trace-agent-activity" data-pending={pending} open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><span className="trace-agent-activity-state">{pending ? <LoaderCircle size={14} className="trace-agent-spinner" /> : <Check size={14} />}</span><span>{pending ? phaseLabels[activity.phase] : 'Ход исследования'}</span><span className="trace-agent-activity-meta">{activity.tools.length > 0 && <span>{activity.tools.length} инстр. · </span>}{seconds} с</span><ChevronDown size={13} /></summary>
    <div className="trace-agent-activity-body">
      {activity.tools.length > 0 && <ol>{activity.tools.map(tool => <li key={tool.id}><span>{tool.state === 'completed' ? <Check size={13} /> : pending ? <LoaderCircle size={13} className="trace-agent-spinner" /> : <Info size={13} />}</span><span>{toolLabels[tool.name] || tool.name}</span><small>{tool.state === 'completed' ? 'Готово' : pending ? 'Выполняется' : 'Без статуса'}</small></li>)}</ol>}
      {activity.reasoning && <div className="trace-agent-reasoning"><span>Краткое объяснение модели</span><p>{activity.reasoning}</p></div>}
      {!activity.tools.length && !activity.reasoning && <p className="trace-agent-activity-empty">{pending ? 'Ожидаем ответ модели.' : 'Ответ получен без дополнительных сведений о ходе исследования.'}</p>}
    </div>
  </details>;
}

const prompts = [
  { title: 'Почему этот клиент важен?', description: 'Разобрать приоритет и ключевые связи', icon: ScanSearch },
  { title: 'Покажи пути от исходных клиентов', description: 'Найти направленные связи в выборке', icon: GitBranch },
  { title: 'Каких данных здесь не хватает?', description: 'Проверить ограничения и пробелы', icon: CircleHelp },
];

export default function AgentPanel({ data, selectedGid, clusterId, role, direction, from, to, onAction, onSaveEvidence }: AgentPanelProps) {
  const [open, setOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [activity, setActivity] = useState<AgentActivity | null>(null);
  const [preview, setPreview] = useState<AnswerPreview | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const followBottom = useRef(true);
  const contextKey = JSON.stringify([data.metadata.analysis_id, selectedGid, clusterId, role, direction, from, to]);
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;

  useEffect(() => {
    const controller = new AbortController();
    setStatus(null);
    setStatusError('');
    fetch('/api/agent/status', { signal: controller.signal })
      .then(async response => { if (!response.ok) throw await agentError(response); return parseAgentStatus(await response.json()); })
      .then(result => { if (!controller.signal.aborted) setStatus(result); })
      .catch(reason => { if (!controller.signal.aborted) setStatusError(reason instanceof Error ? reason.message : 'Сервер агента недоступен.'); });
    return () => controller.abort();
  }, [data.metadata.analysis_id, statusAttempt]);

  useEffect(() => {
    if (request.current) {
      sequence.current += 1;
      request.current.abort();
      request.current = null;
      setPending(false);
      setActivity(null);
      setPreview(null);
      setConversationId(null);
      setNotice('Контекст изменился. Запрос остановлен; следующий вопрос начнёт новый диалог.');
    }
  }, [contextKey]);

  useEffect(() => () => { request.current?.abort(); sequence.current += 1; }, []);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);

  useEffect(() => {
    const viewport = results.current;
    if (!viewport || !followBottom.current) return;
    const latestTurn = viewport.querySelector<HTMLElement>('.trace-agent-turn:last-child');
    viewport.scrollTop = pending ? viewport.scrollHeight : latestTurn ? viewport.scrollTop + latestTurn.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 24 : 0;
  }, [pending, turns.length, open, activity, preview]);

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus());
  };
  const act = (action: EvidenceAction) => {
    onAction(action);
    close();
  };
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => (panel.current?.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)') ?? closeButton.current)?.focus());
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        requestAnimationFrame(() => launcher.current?.focus());
      }
    };
    document.addEventListener('keydown', escape);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', escape); };
  }, [open]);

  const matchingAnalysis = Boolean(data.metadata.analysis_id && status?.analysis_id === data.metadata.analysis_id);
  const available = Boolean(status?.available && matchingAnalysis);
  const invalidPeriod = Boolean(from && to && from > to);
  const reset = () => {
    sequence.current += 1;
    request.current?.abort();
    request.current = null;
    setPending(false);
    setActivity(null);
    setPreview(null);
    setTurns([]);
    setMessage('');
    setConversationId(null);
    setError('');
    setNotice('');
    followBottom.current = true;
  };
  const cancel = () => {
    sequence.current += 1;
    request.current?.abort();
    request.current = null;
    setPending(false);
    setActivity(null);
    setPreview(null);
    setConversationId(null);
    setNotice('Запрос остановлен. Следующий вопрос начнёт новый диалог.');
  };
  const send = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || trimmed.length > 4000 || !available || pending || request.current || invalidPeriod || !data.metadata.analysis_id) return;
    const controller = new AbortController();
    const requestId = ++sequence.current;
    const sentContext = contextKey;
    const sentConversation = conversationId;
    let requestActivity: AgentActivity = { startedAt: Date.now(), elapsedMs: 0, phase: 'connecting', reasoning: '', tools: [] };
    request.current = controller;
    followBottom.current = true;
    setActivity(requestActivity);
    setPreview(null);
    setNow(requestActivity.startedAt);
    setPending(true);
    setError('');
    setNotice('');
    setMessage(trimmed);
    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, signal: controller.signal,
        body: JSON.stringify({
          analysis_id: data.metadata.analysis_id, message: trimmed, conversation_id: sentConversation,
          selected_gid: selectedGid, cluster_id: clusterId, date_from: from || null, date_to: to || null,
          role_filter: role === 'all' ? null : role, direction,
        }),
      });
      const result = await readAgentStream(response, data, sentConversation, update => {
        if (controller.signal.aborted || sequence.current !== requestId || currentContext.current !== sentContext) return;
        if (update.type === 'answer_preview') {
          setPreview(update);
        } else if (update.type === 'reasoning_delta') {
          requestActivity = { ...requestActivity, reasoning: requestActivity.reasoning + update.delta };
          setActivity(requestActivity);
        } else {
          requestActivity = { ...requestActivity, phase: update.phase };
          if (update.phase === 'answer') setPreview(null);
          if (update.phase === 'tool') {
            const tool = { id: update.call_id, name: update.tool, state: update.state };
            requestActivity = { ...requestActivity, tools: requestActivity.tools.some(item => item.id === tool.id) ? requestActivity.tools.map(item => item.id === tool.id ? tool : item) : [...requestActivity.tools, tool] };
          }
          setActivity(requestActivity);
        }
      }, controller.signal);
      if (controller.signal.aborted || sequence.current !== requestId || currentContext.current !== sentContext) return;
      setConversationId(result.conversation_id);
      setTurns(previous => [...previous, { id: requestId, question: trimmed, selectedGid, response: result, activity: { ...requestActivity, elapsedMs: Date.now() - requestActivity.startedAt } }]);
      setMessage('');
    } catch (reason) {
      if (!controller.signal.aborted && sequence.current === requestId && currentContext.current === sentContext) {
        setConversationId(null);
        setError(reason instanceof Error ? reason.message : 'Не удалось связаться с агентом.');
        setNotice('Следующий вопрос начнёт новый диалог. Предыдущие ответы сохранены в истории.');
      }
    } finally {
      if (sequence.current === requestId) {
        request.current = null;
        setPending(false);
        setActivity(null);
        setPreview(null);
      }
    }
  };

  return <Theme appearance="dark" accentColor="violet" grayColor="mauve" radius="large" scaling="100%" hasBackground={false} className="trace-agent-theme">
    <Tooltip content="Ассистент расследования">
      <Button ref={launcher} type="button" size="3" className="trace-agent-launcher" data-open={open} aria-hidden={open} tabIndex={open ? -1 : 0} aria-label="Открыть ассистента расследования" aria-expanded={open} aria-controls="investigation-agent" onClick={() => setOpen(true)}>
        {pending ? <LoaderCircle size={19} className="trace-agent-spinner" /> : <Bot size={20} />}
        <span>Ассистент</span>
        <span className="trace-agent-status-dot" data-ready={available} />
      </Button>
    </Tooltip>
    {open && <section ref={panel} id="investigation-agent" className="trace-agent-panel" role="dialog" aria-modal="false" aria-labelledby="agent-heading">
      <header className="trace-agent-header">
        <div className="trace-agent-identity">
          <span className="trace-agent-mark"><Bot size={21} strokeWidth={1.7} /></span>
          <div><span className="trace-agent-wordmark">TRACE <span>/ AI</span></span><h2 id="agent-heading">Ассистент расследования</h2></div>
        </div>
        <div className="trace-agent-header-actions">
          <Tooltip content="Новый диалог"><IconButton type="button" variant="ghost" color="gray" size="2" aria-label="Новый диалог" onClick={reset} disabled={!turns.length && !pending && !error && !message}><MessageSquarePlus size={18} /></IconButton></Tooltip>
          <Tooltip content="Свернуть · Esc"><IconButton ref={closeButton} type="button" variant="ghost" color="gray" size="2" aria-label="Свернуть панель ассистента" onClick={close}><X size={19} /></IconButton></Tooltip>
        </div>
        <div className="trace-agent-status-line" role="status">
          <Badge color={available ? 'green' : 'gray'} variant="soft" size="1">
            {!status && !statusError ? <LoaderCircle size={11} className="trace-agent-spinner" /> : <span className="trace-agent-status-dot" data-ready={available} />}
            {!status && !statusError ? 'Проверяем доступность' : available ? 'Агент готов' : 'Агент недоступен'}
          </Badge>
          {status?.model && <span className="trace-agent-model" title={`Текущая модель: ${status.model}`}>{status.model}</span>}
        </div>
      </header>

      <details className="trace-agent-context">
        <summary><span className="trace-agent-context-label"><Network size={15} />Контекст</span><span className="trace-agent-context-client" title={selectedGid}>Клиент …{selectedGid.slice(-8)}</span><ChevronDown size={14} /></summary>
        <div className="trace-agent-context-body">
          <span className="trace-agent-full-id">{selectedGid}</span>
          <div className="trace-agent-context-badges"><Badge color="gray" variant="surface">{clusterId === null ? 'Все группы' : `Группа ${clusterId + 1}`}</Badge><Badge color="gray" variant="surface">{role === 'all' ? 'Все роли' : roles[role].label}</Badge><Badge color="gray" variant="surface">{direction === 'all' ? 'Все направления' : direction === 'in' ? 'Входящие операции' : 'Исходящие операции'}</Badge></div>
          <p>{from || 'Начало выборки'} — {to || 'Конец выборки'}</p>
          <small>Период относится к операциям. Роли и приоритет рассчитаны за всю выгрузку.</small>
        </div>
      </details>

      <div ref={results} className="trace-agent-results" role="log" aria-label="История диалога" aria-live="polite" aria-busy={pending} onScroll={event => { const viewport = event.currentTarget; followBottom.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 72; }}>
        {!turns.length && !pending && <div className="trace-agent-welcome">
          <Badge variant="outline" color="gray" size="1">Исследование с опорой на данные</Badge>
          <h3>От вопроса <br />к связям в графе.</h3>
          <p>Разберитесь в приоритете клиента, проследите переводы и проверьте основания каждого вывода.</p>
          <div className="trace-agent-prompts">{prompts.map(({ title, description, icon: Icon }) => <Card key={title} asChild variant="surface" size="2"><button type="button" className="trace-agent-prompt" disabled={!available || invalidPeriod} onClick={() => void send(title)}><span className="trace-agent-prompt-icon"><Icon size={18} strokeWidth={1.6} /></span><span><strong>{title}</strong><small>{description}</small></span><ArrowUpRight size={16} /></button></Card>)}</div>
          <span className="trace-agent-welcome-note"><Info size={13} />Выводы ограничены загруженной выборкой.</span>
        </div>}

        {turns.map(turn => <article className="trace-agent-turn" key={turn.id}>
          <div className="trace-agent-question"><span title={turn.selectedGid}>Вы · клиент …{turn.selectedGid.slice(-8)}</span><p>{turn.question}</p></div>
          <ActivityDisclosure activity={turn.activity} now={now} />
          <div className="trace-agent-answer-label"><Bot size={15} /><strong>TRACE</strong><span>Интерпретация модели</span></div>
          <p className="trace-agent-summary">{turn.response.answer.summary}</p>
          <p className="trace-agent-preview-note">Интерпретация и гипотезы требуют проверки аналитиком.</p>
          {(turn.response.answer.hypotheses?.length ?? 0) > 0 && <div className="trace-agent-hypotheses"><h4>Гипотезы и рекомендации</h4><ul>{turn.response.answer.hypotheses!.map((hypothesis, index) => <li key={index}>{hypothesis}</li>)}</ul></div>}
          {turn.response.answer.findings.length > 0 && <h4 className="trace-agent-evidence-heading">Проверенные факты из выборки</h4>}
          {turn.response.answer.findings.length > 0 && <ul className="trace-agent-findings">{turn.response.answer.findings.map((finding, index) => <li key={index}><p>{finding.text}</p><div>{finding.evidence_ids.map(id => <Button asChild size="1" variant="soft" color="gray" key={id}><a href={`#agent-${turn.id}-${encodeURIComponent(id)}`}>Основание {turn.response.evidence.findIndex(item => item.id === id) + 1}<ArrowUpRight size={11} /></a></Button>)}</div></li>)}</ul>}
          {turn.response.evidence.length > 0 && <div className="trace-agent-evidence-heading"><span>Основания ответа</span><Badge variant="soft" color="gray">{turn.response.evidence.length}</Badge></div>}
          <div className="trace-agent-evidence-list">{turn.response.evidence.map((evidence, index) => {
            const transactionAction = evidenceTransactionAction(evidence);
            return <Card asChild size="2" variant="surface" key={evidence.id}><article className="trace-agent-evidence" id={`agent-${turn.id}-${encodeURIComponent(evidence.id)}`}>
            <h4><Badge variant="soft" size="1">{String(index + 1).padStart(2, '0')}</Badge>{evidence.title}</h4>
            {evidence.facts.length > 0 && <dl>{evidence.facts.map((fact, factIndex) => <div key={factIndex}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
            <div className="trace-agent-evidence-actions">
              {evidence.node_ids.map(gid => <Button type="button" size="1" variant="soft" color="gray" key={gid} title={gid} onClick={() => act({ type: 'node', gid })}>Клиент …{gid.slice(-8)}<ArrowUpRight size={12} /></Button>)}
              {evidence.cluster_id !== null && <Button type="button" size="1" variant="soft" color="gray" onClick={() => act({ type: 'cluster', clusterId: evidence.cluster_id! })}>Группа {evidence.cluster_id + 1}<ArrowUpRight size={12} /></Button>}
              {evidence.paths.length > 0 && <Button type="button" size="1" variant="soft" onClick={() => act({ type: 'paths', paths: evidence.paths.map(path => path.node_ids) })}><GitBranch size={13} />Показать пути ({evidence.paths.length})</Button>}
              {transactionAction && <Button type="button" size="1" variant="soft" color="gray" onClick={() => act(transactionAction)}>Операции …{transactionAction.gid.slice(-8)}<ArrowUpRight size={12} /></Button>}
              {onSaveEvidence && <Button type="button" size="1" variant="outline" color="gray" onClick={() => onSaveEvidence(evidence)}>Сохранить основание</Button>}
            </div>
          </article></Card>;
          })}</div>
          {turn.response.answer.limitations.length > 0 && <details className="trace-agent-limitations"><summary><Info size={14} /><span>Границы вывода</span><Badge color="gray" variant="soft" size="1">{turn.response.answer.limitations.length}</Badge><ChevronDown size={14} /></summary><ul>{turn.response.answer.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul></details>}
        </article>)}

        {pending && activity && <div className="trace-agent-pending-turn"><div className="trace-agent-question"><span title={selectedGid}>Вы · клиент …{selectedGid.slice(-8)}</span><p>{message}</p></div><ActivityDisclosure activity={activity} pending now={now} />{preview && (preview.summary || preview.findings.length > 0) && <div className="trace-agent-preview"><div className="trace-agent-answer-label"><Bot size={15} /><strong>TRACE</strong><Badge variant="soft" size="1">Формируется ответ</Badge></div><p className="trace-agent-summary">{preview.summary}</p>{preview.findings.length > 0 && <ul className="trace-agent-findings">{preview.findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul>}<span className="trace-agent-preview-note">Предварительная интерпретация модели · факты ещё проверяются</span></div>}</div>}
      </div>

      <div className="trace-agent-composer">
        {!available && (status || statusError) && <Callout.Root size="1" color="gray" className="trace-agent-feedback"><Callout.Icon><Info size={15} /></Callout.Icon><div><Callout.Text>{statusError ? 'Не удалось подключиться к серверу агента.' : !matchingAnalysis ? 'Граф и агент используют разные версии анализа. Обновите страницу после загрузки актуального графа.' : status?.reason || 'Агент пока не настроен на сервере.'}</Callout.Text><p className="trace-agent-feedback-note">Граф и аналитика остаются доступны.</p><Button type="button" size="1" variant="soft" color="gray" onClick={() => setStatusAttempt(attempt => attempt + 1)}><RefreshCw size={12} />Проверить снова</Button></div></Callout.Root>}
        {invalidPeriod && <Callout.Root size="1" color="amber" role="alert" className="trace-agent-feedback"><Callout.Icon><Info size={15} /></Callout.Icon><Callout.Text>Начальная дата должна быть не позже конечной.</Callout.Text></Callout.Root>}
        {error && <Callout.Root size="1" color="red" role="alert" className="trace-agent-feedback"><Callout.Icon><Info size={15} /></Callout.Icon><div><Callout.Text>{error}</Callout.Text><Button type="button" size="1" variant="soft" color="red" disabled={!available || pending || invalidPeriod || !message.trim()} onClick={() => void send(message)}><RefreshCw size={12} />Повторить запрос</Button></div></Callout.Root>}
        {notice && <p className="trace-agent-notice" role="status">{notice}</p>}
        <form onSubmit={event => { event.preventDefault(); void send(message); }}>
          <label className="trace-agent-visually-hidden" htmlFor="agent-message">Ваш вопрос</label>
          <TextArea id="agent-message" className="trace-agent-input" size="2" variant="surface" value={pending ? '' : message} maxLength={4000} rows={2} placeholder={pending ? 'Агент работает над вашим вопросом…' : 'Спросите о клиенте, переводах или связях…'} onChange={event => setMessage(event.target.value)} disabled={!available || pending} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(message); } }} />
          <div className="trace-agent-send-row"><span className="trace-agent-keyboard-hint">Enter — отправить <span>·</span> Shift + Enter — перенос</span><span className="trace-agent-counter">{pending ? 0 : message.length}/4000</span>{pending ? <Button key="cancel" type="button" size="2" variant="soft" color="gray" onClick={event => { event.preventDefault(); cancel(); }}><Square size={12} />Остановить</Button> : <Button key="send" size="2" type="submit" disabled={!available || !message.trim() || invalidPeriod}><ArrowUp size={16} />Исследовать</Button>}</div>
        </form>
        <p className="trace-agent-session-note">История сохраняется до обновления страницы.</p>
      </div>
    </section>}
  </Theme>;
}
