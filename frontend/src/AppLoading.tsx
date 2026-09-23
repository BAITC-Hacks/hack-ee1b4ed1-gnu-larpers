import { LoaderCircle, Network } from 'lucide-react';

export function AppLoading() {
  return (
    <div className="app-state">
      <Network size={38} />
      <h1>Анализ транзакций</h1>
      <p><LoaderCircle size={17} className="spinner" />Загружаем результаты анализа</p>
    </div>
  );
}
