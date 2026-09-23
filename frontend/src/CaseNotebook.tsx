import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FolderOpen, Plus, Save, Trash2 } from 'lucide-react';
import { evidenceTransactionAction, parseEvidenceCard, type EvidenceAction, type EvidenceCard } from './agent';
import { addCaseEvidence, clientCaseEvidence, evidenceContentKey, investigationCompatibility, investigationMarkdown, readInvestigations, restoreInvestigation, saveInvestigation, transactionCaseEvidence, type SavedInvestigation } from './cases';
import { analysisIdentity, type WorkspaceSnapshot } from './stores/workspace';
import type { GraphData } from './types';
import './case-notebook.css';

interface CaseNotebookProps {
  data: GraphData;
  snapshot: WorkspaceSnapshot;
  pendingEvidence: EvidenceCard | null;
  onEvidenceSaved: () => void;
  onRestore: (snapshot: WorkspaceSnapshot) => void;
  onAction: (action: EvidenceAction) => void;
}

function downloadInvestigation(entry: SavedInvestigation, format: 'markdown' | 'json') {
  const content = format === 'json' ? JSON.stringify(entry, null, 2) : investigationMarkdown(entry);
  const blob = new Blob([content], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${entry.title.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80) || 'investigation'}.${format === 'json' ? 'json' : 'md'}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CaseNotebook({ data, snapshot, pendingEvidence, onEvidenceSaved, onRestore, onAction }: CaseNotebookProps) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<string>();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [evidence, setEvidence] = useState<EvidenceCard[]>([]);
  const [saved, setSaved] = useState<SavedInvestigation[]>([]);
  const [unreadable, setUnreadable] = useState(0);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const consumedEvidence = useRef<EvidenceCard | null>(null);
  const identity = analysisIdentity(data);

  const reportError = (error: unknown, fallback: string) => setNotice({ text: error instanceof Error ? error.message : fallback, error: true });
  const refresh = () => {
    try {
      const result = readInvestigations(window.localStorage);
      setSaved(result.records);
      setUnreadable(result.unreadable);
    } catch {
      setNotice({ text: 'Локальное хранилище недоступно. Черновик можно редактировать, но сохранить его сейчас не получится.', error: true });
    }
  };

  useEffect(() => {
    setId(undefined);
    setTitle('');
    setNotes('');
    setEvidence([]);
    setNotice(null);
    refresh();
    const update = () => refresh();
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, [identity]);

  useEffect(() => {
    if (!pendingEvidence) {
      consumedEvidence.current = null;
      return;
    }
    if (consumedEvidence.current === pendingEvidence) return;
    consumedEvidence.current = pendingEvidence;
    try {
      const parsed = parseEvidenceCard(pendingEvidence, data);
      setEvidence(current => addCaseEvidence(current, parsed));
      setOpen(true);
      setNotice({ text: 'Основание добавлено в черновик. Сохраните расследование, чтобы оставить его после обновления страницы.', error: false });
      onEvidenceSaved();
    } catch (error) { reportError(error, 'Не удалось добавить основание.'); }
  }, [pendingEvidence, data, onEvidenceSaved]);

  const addEvidence = (create: () => EvidenceCard) => {
    try {
      const next = create();
      const exists = evidence.some(item => evidenceContentKey(item) === evidenceContentKey(next));
      setEvidence(current => addCaseEvidence(current, next));
      setNotice({ text: exists ? 'Это основание уже есть в черновике.' : 'Основание добавлено в черновик. Изменения сохраняются по кнопке.', error: false });
    } catch (error) { reportError(error, 'Не удалось добавить основание.'); }
  };

  const save = () => {
    let storage: Storage;
    try { storage = window.localStorage; }
    catch {
      setNotice({ text: 'Нет доступа к локальному хранилищу. Расследование не сохранено; черновик остаётся на экране.', error: true });
      return;
    }
    try {
      const entry = saveInvestigation(storage, data, { id, title, notes, snapshot, evidence });
      setId(entry.id);
      setTitle(entry.title);
      setSaved(current => [entry, ...current.filter(item => item.id !== entry.id)]);
      setNotice({ text: 'Расследование сохранено в этом браузере: контекст, заметки и выбранные основания.', error: false });
    } catch (error) { reportError(error, 'Не удалось сохранить расследование. Черновик остаётся на экране.'); }
  };

  const restore = (entry: SavedInvestigation) => {
    try {
      const restored = restoreInvestigation(entry, data);
      onRestore(restored.snapshot);
      setId(entry.id);
      setTitle(entry.title);
      setNotes(entry.notes);
      setEvidence(restored.evidence);
      setNotice({ text: 'Восстановлены контекст исследования, заметки и выбранные основания.', error: false });
    } catch (error) { reportError(error, 'Не удалось открыть расследование.'); }
  };

  const newDraft = () => {
    setId(undefined);
    setTitle('');
    setNotes('');
    setEvidence([]);
    setNotice({ text: 'Новый черновик использует текущий контекст исследования.', error: false });
  };

  return <section className="case-notebook" aria-label="Сохранённые расследования">
    <button className="case-notebook-toggle" aria-expanded={open} aria-controls="case-notebook-content" onClick={() => { if (!open) refresh(); setOpen(!open); }}>
      <span><FolderOpen size={16} />Расследования</span><span className="case-notebook-count">{saved.length} сохранено <ChevronDown size={15} /></span>
    </button>
    {open && <div id="case-notebook-content" className="case-notebook-content">
      <div className="case-draft">
        <div className="case-section-heading"><h2>{id ? 'Открытое расследование' : 'Новое расследование'}</h2><button type="button" onClick={newDraft}><Plus size={14} /> Новый черновик</button></div>
        <p className="case-help">Сохраняется текущий клиент, группа, режим графа, фильтры и выбранные основания. Записи остаются только в этом браузере.</p>
        <form onSubmit={event => { event.preventDefault(); save(); }}>
          <label htmlFor="case-title">Название расследования</label><input id="case-title" value={title} maxLength={200} onChange={event => { setTitle(event.target.value); setNotice(null); }} placeholder="Например, движение средств в группе 12" />
          <label htmlFor="case-notes">Заметки расследования</label><textarea id="case-notes" value={notes} maxLength={100000} rows={4} onChange={event => { setNotes(event.target.value); setNotice(null); }} placeholder="Выводы, вопросы и что проверить дальше" />
          <div className="case-context"><strong>Текущий контекст</strong><span>Клиент {snapshot.selectedGid}{snapshot.clusterId !== null ? ` · группа ${snapshot.clusterId + 1}` : ''}</span><span>{snapshot.from || 'Без начала'} — {snapshot.to || 'без конца'} · {snapshot.direction === 'in' ? 'входящие' : snapshot.direction === 'out' ? 'исходящие' : 'все направления'}</span></div>
          <div className="case-evidence-add"><button type="button" onClick={() => addEvidence(() => clientCaseEvidence(data, snapshot.selectedGid))}>Добавить клиента в основания</button><button type="button" onClick={() => addEvidence(() => transactionCaseEvidence(data, snapshot))}>Добавить операции в основания</button></div>
          <div className="case-section-heading"><h3>Выбранные основания <span>{evidence.length}</span></h3></div>
          {!evidence.length && <p className="case-help">Добавьте текущего клиента, операции или основание из ответа AI.</p>}
          <div className="case-evidence-list">{evidence.map((item, index) => {
            const action = evidenceTransactionAction(item);
            return <article className="case-evidence-card" aria-label={`Основание ${index + 1}`} key={evidenceContentKey(item)}>
              <div className="case-evidence-heading"><strong>{item.title}</strong><button type="button" aria-label="Удалить основание" title="Удалить из черновика" onClick={() => { setEvidence(current => current.filter((_, i) => i !== index)); setNotice({ text: 'Основание удалено из черновика. Сохраните изменения по кнопке.', error: false }); }}><Trash2 size={14} /></button></div>
              <dl>{item.facts.map((fact, factIndex) => <div key={factIndex}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
              <div className="case-evidence-actions">
                {action && <button type="button" onClick={() => onAction(action)}>Операции</button>}
                {item.node_ids[0] && <button type="button" onClick={() => onAction({ type: 'node', gid: item.node_ids[0] })}>Клиент</button>}
                {item.cluster_id !== null && <button type="button" onClick={() => onAction({ type: 'cluster', clusterId: item.cluster_id! })}>Группа</button>}
                {!!item.paths.length && <button type="button" onClick={() => onAction({ type: 'paths', paths: item.paths.map(path => path.node_ids) })}>Пути</button>}
              </div>
            </article>;
          })}</div>
          <button className="case-save" type="submit"><Save size={14} /> Сохранить расследование</button>
        </form>
      </div>
      <div className="case-saved">
        <div className="case-section-heading"><h2>Сохранённые записи</h2></div>
        {!saved.length && <p className="case-help">Сохранённых расследований пока нет.</p>}
        {unreadable > 0 && <p className="case-warning">Не удалось прочитать записей: {unreadable}. Они остаются в хранилище без изменений.</p>}
        <div className="case-saved-list">{saved.map(entry => {
          const incompatible = investigationCompatibility(entry, data);
          return <article className="case-saved-card" aria-label={`Расследование ${entry.title}`} key={entry.id}>
            <h3>{entry.title}</h3><p>{new Date(entry.updatedAt).toLocaleString('ru-RU')} · оснований: {entry.evidence.length}</p>
            {entry.notes && <p className="case-saved-notes">{entry.notes}</p>}
            {incompatible && <p className="case-warning">{incompatible}</p>}
            <div className="case-saved-actions"><button type="button" disabled={!!incompatible} onClick={() => restore(entry)}>Открыть</button><button type="button" onClick={() => { try { downloadInvestigation(entry, 'markdown'); } catch (error) { reportError(error, 'Не удалось экспортировать расследование.'); } }}>Markdown</button><button type="button" onClick={() => { try { downloadInvestigation(entry, 'json'); } catch (error) { reportError(error, 'Не удалось экспортировать расследование.'); } }}>JSON</button></div>
          </article>;
        })}</div>
      </div>
    </div>}
    {notice && <p className={`case-notice${notice.error ? ' case-warning' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
  </section>;
}
