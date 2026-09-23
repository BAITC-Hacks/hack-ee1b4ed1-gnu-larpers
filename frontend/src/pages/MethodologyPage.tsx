import { CircleHelp } from 'lucide-react';
import { roles, type GraphData, type Role } from '../types';
import { RoleBadge, number } from '../format';

export default function MethodologyPage({ data }: { data: GraphData }) {
  return <section className="methodology-page"><div className="section-intro"><span className="eyebrow">Прозрачный анализ</span><h2>Что стоит за результатами</h2><p>Роли — объяснимые гипотезы о поведении внутри доступной выборки.</p></div>
    <div className="method-grid"><article><span className="method-number">01</span><h3>Движение средств</h3><p>Учитываем направление связей, число контрагентов, суммы и количество переводов. Посредничество показывает положение на направленных кратчайших путях.</p></article><article><span className="method-number">02</span><h3>Группы клиентов</h3><p>Louvain объединяет клиентов по ненаправленной проекции связей с логарифмом денежного веса. Параметр разрешения: {data.metadata.parameters.resolution}; seed: {data.metadata.parameters.random_seed}.</p></article><article><span className="method-number">03</span><h3>Проверка по датам</h3><p>Объёмы сопоставляются в следующие {data.metadata.parameters.window_days} дня. Один входящий объём используется не больше одного раза. Это не доказательство происхождения денег.</p></article></div>
    <h3 className="method-role-heading">Роли в графе</h3><div className="method-roles">{Object.entries(roles).map(([key, role]) => <article key={key}><RoleBadge role={key as Role} /><p>{role.description}</p></article>)}</div>
    <div className="method-limits"><CircleHelp size={24} /><div><h3>Границы наблюдения — часть результата</h3><p>{number.format(data.metadata.n_boundary)} узла находятся на границе обхода: отсутствие исходящих не подтверждает, что деньги остались у них. У {data.metadata.n_seed} seed-клиентов входящие неполны. Видны только внутрибанковские переводы от 5 000 ₸ за июль 2026 года.</p><p>Приоритет и поддержка роли — эвристические оценки от 0 до 1. Они не являются вероятностью нарушения. Размеченных ролей для измерения точности нет.</p></div></div>
  </section>;
}

