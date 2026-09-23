import json
import math
from datetime import date, datetime
from numbers import Integral, Real
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
import pandas as pd

from money_graph.analysis import Analysis
from money_graph.roles import ROLES

CSV_SCHEMAS = {
    "nodes_roles.csv": ["gid", "role", "role_score", "cluster_id", "priority_score", "evidence"],
    "clusters.csv": [
        "cluster_id",
        "n_nodes",
        "n_seed",
        "sum_kzt_internal",
        "top_gids",
        "hypothesis",
    ],
    "top_nodes.csv": ["rank", "gid", "role", "priority_score", "why"],
}


def _plain(value):
    if value is None or value is pd.NA:
        return None
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, Integral):
        return int(value)
    if isinstance(value, Real):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, (date, datetime, pd.Timestamp)):
        return value.date().isoformat() if hasattr(value, "date") else value.isoformat()
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _plain(item) for key, item in value.items()}
    return value


def _records(frame: pd.DataFrame) -> list[dict]:
    records = []
    for row in frame.to_dict("records"):
        for name in ("gid", "src", "dst"):
            if name in row:
                row[name] = str(row[name])
        records.append(_plain(row))
    return records


def validate_results(analysis: Analysis) -> None:
    nodes, clusters, top = analysis.nodes, analysis.clusters, analysis.top_nodes
    if len(nodes) != len(analysis.dataset.nodes) or nodes.gid.duplicated().any():
        raise ValueError("Output must contain every input node exactly once")
    if set(nodes.gid) != set(analysis.dataset.nodes.gid):
        raise ValueError("Output node identifiers differ from input")
    if not nodes.role.isin(ROLES).all():
        raise ValueError("Output contains an unsupported role")
    for name in ("role_score", "priority_score"):
        if not nodes[name].between(0, 1).all():
            raise ValueError(f"{name} must be finite and between 0 and 1")
    if not nodes.evidence.str.len().between(1, 200).all():
        raise ValueError("Evidence must contain 1..200 characters")
    if not nodes.evidence.str.contains(r"\d").all():
        raise ValueError("Evidence must contain numeric observations")
    if set(nodes.cluster_id) != set(clusters.cluster_id):
        raise ValueError("Cluster membership and cluster export differ")
    counts = nodes.groupby("cluster_id").size().to_dict()
    if counts != dict(zip(clusters.cluster_id, clusters.n_nodes, strict=True)):
        raise ValueError("Cluster node counts differ from membership")
    expected = min(analysis.metadata["parameters"]["top_n"], len(nodes))
    if len(top) != expected or not top.priority_score.is_monotonic_decreasing:
        raise ValueError("Top nodes must contain the requested number of ranked nodes")
    if top.gid.duplicated().any() or not set(top.gid) <= set(nodes.gid):
        raise ValueError("Top nodes contain duplicate or unknown identifiers")
    if not top.why.str.strip().str.len().gt(0).all():
        raise ValueError("Every ranked node must have a priority explanation")


def _csv(frame: pd.DataFrame) -> str:
    def cell(value):
        value = _plain(value)
        if value is None:
            return "unavailable"
        if isinstance(value, list):
            if any(isinstance(item, (dict, list)) for item in value):
                return json.dumps(value, ensure_ascii=False, sort_keys=True)
            return ";".join(str(item) for item in value) if value else "none"
        if isinstance(value, dict):
            return json.dumps(value, ensure_ascii=False, sort_keys=True)
        return value

    return frame.map(cell).to_csv(index=False, lineterminator="\n")


def _report(analysis: Analysis) -> str:
    metadata = analysis.metadata
    lines = [
        "# Граф денег — результаты анализа",
        "",
        f"Узлы: {metadata['n_nodes']}; связи: {metadata['n_edges']}; "
        f"переводы: {metadata['n_transactions']}.",
        "",
        f"Наблюдаемый оборот: {metadata['sum_minor'] / 100:.2f} ₸. "
        "Сумма по рёбрам, без утверждения об уникальности денег при переходах.",
        "",
        f"Исходных клиентов: {metadata['n_seed']}; изолятов: {metadata['n_isolated']}; "
        f"узлов на границе глубины: {metadata['n_boundary']}.",
        "",
        f"Групп Louvain: {metadata['n_clusters']}; "
        f"слабых компонент: {metadata['n_weak_components']}.",
        "",
        "## Приоритетные узлы",
        "",
        "| gid | Роль | Приоритет | Наблюдения |",
        "|---|---|---:|---|",
    ]
    for row in analysis.top_nodes.head(10).itertuples(index=False):
        lines.append(f"| {row.gid} | {row.role} | {row.priority_score:.3f} | {row.why} |")
    lines.extend(
        [
            "",
            "## Интерпретация",
            "",
            "Оценки — эвристики для исследования. Они не являются вероятностью мошенничества.",
            "",
            "Конечный узел означает отсутствие исходящих в выборке. На границе четвёртого "
            "колена это неподтверждённая гипотеза. Вход seed-клиентов неполон.",
            "",
            "Сопоставление сумм на следующих днях не доказывает происхождение средств. "
            "Порядок переводов внутри дня неизвестен. Структурный цикл не доказывает "
            "возврат тех же денег.",
            "",
            "Состав, численность и статистика групп проверяются; экономическое назначение "
            "без дополнительных данных не устанавливается.",
            "",
            f"Отпечаток нормализованного датасета: `{metadata['dataset_sha256']}`.",
            "",
        ]
    )
    return "\n".join(lines)


def graph_payload(analysis: Analysis) -> dict:
    validate_results(analysis)
    return {
        "metadata": _plain(analysis.metadata),
        "nodes": _records(analysis.nodes),
        "edges": _records(analysis.dataset.edges),
        "clusters": _records(analysis.clusters),
        "top_nodes": _records(analysis.top_nodes),
        "daily_flows": _records(analysis.daily),
        "transactions": _records(analysis.dataset.transactions),
    }


def write_outputs(analysis: Analysis, directory: Path) -> dict[str, Path]:
    graph = graph_payload(analysis)
    artifacts = {
        "nodes_roles.csv": _csv(analysis.nodes[CSV_SCHEMAS["nodes_roles.csv"]]),
        "clusters.csv": _csv(analysis.clusters[CSV_SCHEMAS["clusters.csv"]]),
        "top_nodes.csv": _csv(analysis.top_nodes[CSV_SCHEMAS["top_nodes.csv"]]),
        "graph.json": json.dumps(graph, ensure_ascii=False, allow_nan=False, indent=2) + "\n",
        "summary.json": json.dumps(
            _plain(analysis.metadata), ensure_ascii=False, allow_nan=False, indent=2
        )
        + "\n",
        "report.md": _report(analysis),
    }
    directory.mkdir(parents=True, exist_ok=True)
    paths = {}
    for name, content in artifacts.items():
        path = directory / name
        temporary_path = None
        try:
            with NamedTemporaryFile("w", encoding="utf-8", dir=directory, delete=False) as handle:
                temporary_path = Path(handle.name)
                handle.write(content)
            temporary_path.replace(path)
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
        paths[name] = path
    return paths
