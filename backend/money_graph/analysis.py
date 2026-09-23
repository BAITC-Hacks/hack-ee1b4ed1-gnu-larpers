import hashlib
import json
import math
from dataclasses import dataclass

import networkx as nx
import pandas as pd

from money_graph import __version__
from money_graph.dataset import Dataset, validate_dataset
from money_graph.roles import classify, priority_explanation
from money_graph.temporal import daily_flows, temporal_features


@dataclass(frozen=True)
class Config:
    top_n: int = 50
    window_days: int = 3
    random_seed: int = 42
    resolution: float = 1.0

    def __post_init__(self):
        if self.top_n < 20:
            raise ValueError("top_n must be at least 20")
        if not 1 <= self.window_days <= 30:
            raise ValueError("window_days must be between 1 and 30")
        if not math.isfinite(self.resolution) or self.resolution <= 0:
            raise ValueError("resolution must be finite and positive")
        if self.random_seed < 0:
            raise ValueError("random_seed must be nonnegative")


@dataclass(frozen=True)
class Analysis:
    dataset: Dataset
    nodes: pd.DataFrame
    clusters: pd.DataFrame
    top_nodes: pd.DataFrame
    daily: pd.DataFrame
    metadata: dict


def build_graph(dataset: Dataset) -> nx.DiGraph:
    graph = nx.DiGraph()
    graph.add_nodes_from(int(gid) for gid in dataset.nodes.gid)
    for row in dataset.edges.itertuples(index=False):
        graph.add_edge(
            int(row.src),
            int(row.dst),
            sum_minor=int(row.sum_minor),
            n_tx=int(row.n_tx),
            depth=int(row.depth),
        )
    return graph


def _communities(graph: nx.DiGraph, config: Config) -> dict[int, int]:
    projection = nx.Graph()
    projection.add_nodes_from(graph)
    for src, dst, attributes in graph.edges(data=True):
        if src == dst:
            continue
        amount = attributes["sum_minor"] + projection.get_edge_data(src, dst, {}).get(
            "sum_minor", 0
        )
        projection.add_edge(src, dst, sum_minor=amount, weight=math.log1p(amount / 500000))
    isolated = sorted(nx.isolates(projection))
    active = projection.subgraph(set(projection) - set(isolated)).copy()
    communities = (
        nx.community.louvain_communities(
            active, weight="weight", resolution=config.resolution, seed=config.random_seed
        )
        if active.number_of_edges()
        else []
    )
    communities.extend({gid} for gid in isolated)
    return {
        gid: cluster_id
        for cluster_id, group in enumerate(sorted(communities, key=min))
        for gid in sorted(group)
    }


def _percentiles(values: pd.Series) -> pd.Series:
    positive = values[values > 0].rank(method="average", pct=True)
    return positive.reindex(values.index, fill_value=0.0)


def _features(
    dataset: Dataset, graph: nx.DiGraph, config: Config
) -> tuple[pd.DataFrame, pd.DataFrame]:
    rows = dataset.nodes.copy()
    self_loops = {gid: graph.get_edge_data(gid, gid, {}) for gid in graph}
    rows["self_tx"] = [self_loops[gid].get("n_tx", 0) for gid in rows.gid]
    rows["self_minor"] = [self_loops[gid].get("sum_minor", 0) for gid in rows.gid]
    graph = graph.copy()
    graph.remove_edges_from(list(nx.selfloop_edges(graph)))
    metrics = {
        "in_deg": dict(graph.in_degree()),
        "out_deg": dict(graph.out_degree()),
        "in_minor": dict(graph.in_degree(weight="sum_minor")),
        "out_minor": dict(graph.out_degree(weight="sum_minor")),
        "in_tx": dict(graph.in_degree(weight="n_tx")),
        "out_tx": dict(graph.out_degree(weight="n_tx")),
        "pagerank": nx.pagerank(graph, weight="sum_minor", max_iter=500, tol=1e-12),
        "betweenness": nx.betweenness_centrality(graph, normalized=True, weight=None),
    }
    for name, metric in metrics.items():
        rows[name] = rows.gid.map(metric)
    rows["in_kzt"] = rows.in_minor / 100
    rows["out_kzt"] = rows.out_minor / 100
    rows["pass_through"] = pd.Series(
        [
            out / inc if inc else None
            for inc, out in zip(rows.in_minor, rows.out_minor, strict=True)
        ],
        dtype=object,
    )
    rows["pass_through_available"] = rows.in_minor > 0
    rows["truncated_by_depth"] = (rows.depth == 4) & (rows.out_deg == 0)
    rows["cluster_id"] = rows.gid.map(_communities(graph, config))
    clusters = dict(zip(rows.gid, rows.cluster_id, strict=True))
    rows["neighbor_clusters"] = [
        len(
            {clusters[other] for other in set(graph.predecessors(gid)) | set(graph.successors(gid))}
        )
        for gid in rows.gid
    ]
    seed_sources = dict.fromkeys(graph, 0)
    for gid in dataset.nodes.loc[dataset.nodes.is_seed, "gid"]:
        for descendant in nx.descendants(graph, int(gid)):
            seed_sources[descendant] += 1
    rows["seed_sources"] = rows.gid.map(seed_sources)
    cycle_sizes = {}
    for component in nx.strongly_connected_components(graph):
        size = len(component)
        for gid in component:
            cycle_sizes[gid] = size if size > 1 or self_loops[gid] else 0
    rows["cycle_component_size"] = rows.gid.map(cycle_sizes)
    rows["reciprocal_neighbors"] = [
        len(set(graph.predecessors(gid)) & set(graph.successors(gid)) - {gid}) for gid in rows.gid
    ]
    daily = daily_flows(dataset.transactions)
    temporal = temporal_features(
        daily, config.window_days, observation_end=dataset.transactions.date.max()
    )
    defaults = {
        "active_days": 0,
        "same_day_activity_days": 0,
        "following_days_matched_minor": 0,
        "following_days_out_share": None,
        "following_days_available": False,
        "temporal_right_censored": False,
        "max_daily_out_share": 0.0,
    }
    for name, default in defaults.items():
        rows[name] = pd.Series(
            [temporal.get(int(gid), defaults).get(name, default) for gid in rows.gid],
            dtype=object if default is None else None,
        )
    rows["window_days"] = config.window_days
    for name, values in {
        "in_amount_percentile": rows.in_minor,
        "out_amount_percentile": rows.out_minor,
        "in_tx_percentile": rows.in_tx,
        "out_tx_percentile": rows.out_tx,
        "turnover_percentile": rows.in_minor + rows.out_minor,
        "tx_percentile": rows.in_tx + rows.out_tx,
        "betweenness_percentile": rows.betweenness,
    }.items():
        rows[name] = _percentiles(values)
    return rows, daily


def _cluster_rows(nodes: pd.DataFrame, edges: pd.DataFrame) -> pd.DataFrame:
    membership = dict(zip(nodes.gid, nodes.cluster_id, strict=True))
    internal = dict.fromkeys(set(membership.values()), 0)
    incoming = internal.copy()
    outgoing = internal.copy()
    for edge in edges.itertuples(index=False):
        src_cluster, dst_cluster = membership[edge.src], membership[edge.dst]
        if src_cluster == dst_cluster:
            internal[src_cluster] += int(edge.sum_minor)
        else:
            outgoing[src_cluster] += int(edge.sum_minor)
            incoming[dst_cluster] += int(edge.sum_minor)
    result = []
    for cluster_id, group in nodes.groupby("cluster_id", sort=True):
        ranked = group.sort_values(["priority_score", "gid"], ascending=[False, True])
        roles = group.role.value_counts().sort_index().to_dict()
        active = int(((group.in_deg + group.out_deg) > 0).sum())
        collectors = roles.get("consolidator", 0)
        distributors = roles.get("distributor", 0)
        if collectors and distributors:
            purpose = "сбор и дальнейшее распределение средств"
        elif collectors:
            purpose = "консолидация входящих переводов"
        elif distributors:
            purpose = "распределение средств по получателям"
        elif roles.get("transit", 0):
            purpose = "передача средств через промежуточные узлы"
        elif roles.get("coordinator", 0):
            purpose = "связывание разных частей графа"
        else:
            purpose = "локальный фрагмент входящих переводов"
        hypothesis = (
            "Внешних переводов не наблюдается; назначение не определяется."
            if not active
            else f"Гипотеза: {purpose}; {len(group)} узлов, "
            f"сборщиков {collectors}, распределителей {distributors}, "
            f"транзитных {roles.get('transit', 0)}. "
            "Экономическое назначение не установлено."
        )
        result.append(
            {
                "cluster_id": int(cluster_id),
                "n_nodes": len(group),
                "n_seed": int(group.is_seed.sum()),
                "sum_kzt_internal": internal[cluster_id] / 100,
                "sum_minor_internal": internal[cluster_id],
                "incoming_minor_external": incoming[cluster_id],
                "outgoing_minor_external": outgoing[cluster_id],
                "top_gids": [str(gid) for gid in ranked.gid.head(5)],
                "hypothesis": hypothesis,
            }
        )
    return pd.DataFrame(result)


def analyze(dataset: Dataset, config: Config | None = None) -> Analysis:
    config = config or Config()
    dataset = validate_dataset(dataset)
    graph = build_graph(dataset)
    features, daily = _features(dataset, graph, config)
    classification = pd.DataFrame([classify(row) for row in features.to_dict("records")])
    nodes = pd.concat([features, classification], axis=1)
    clusters = _cluster_rows(nodes, dataset.edges)
    top = nodes.sort_values(["priority_score", "gid"], ascending=[False, True]).head(config.top_n)
    explanations = [priority_explanation(row) for row in top.to_dict("records")]
    top = top[["gid", "role", "priority_score"]].copy()
    top["why"] = explanations
    top.insert(0, "rank", range(1, len(top) + 1))
    canonical = "\n".join(
        frame.to_csv(index=False) for frame in (dataset.nodes, dataset.edges, dataset.transactions)
    )
    transactions = dataset.transactions
    metadata = {
        "schema_version": 1,
        "analysis_version": __version__,
        "dataset_sha256": hashlib.sha256(canonical.encode()).hexdigest(),
        "n_nodes": len(nodes),
        "n_edges": len(dataset.edges),
        "n_transactions": len(transactions),
        "n_seed": int(nodes.is_seed.sum()),
        "n_isolated": nx.number_of_isolates(graph),
        "n_self_transfer_nodes": int((nodes.self_tx > 0).sum()),
        "n_boundary": int(nodes.truncated_by_depth.sum()),
        "n_clusters": len(clusters),
        "n_weak_components": nx.number_weakly_connected_components(graph),
        "sum_minor": sum(int(value) for value in dataset.edges.sum_minor),
        "date_from": transactions.date.min().date().isoformat() if len(transactions) else None,
        "date_to": transactions.date.max().date().isoformat() if len(transactions) else None,
        "role_counts": nodes.role.value_counts().sort_index().to_dict(),
        "parameters": {
            "top_n": config.top_n,
            "window_days": config.window_days,
            "random_seed": config.random_seed,
            "resolution": config.resolution,
        },
        "methods": {
            "pagerank": "directed, amount-weighted",
            "betweenness": "directed, unweighted shortest paths; normalized",
            "communities": "Louvain; undirected pair sums; log1p(sum_kzt/5000); no self-loops",
            "temporal": "FIFO amount compatibility on following days; same-day order unknown",
            "role_score": "heuristic support, not a calibrated probability",
            "priority_score": "inspection priority, not a fraud probability",
        },
        "limitations": [
            "Only observed transfers are analyzed; sampling follows outgoing links from seeds.",
            "Depth-4 endpoints cannot be proven terminal; seed inflow is incomplete.",
            "Dates have day precision; amount matching and paths do not prove money provenance.",
            "Cycles and structural coordinators do not establish intent or wrongdoing.",
            "One primary role is selected; mixed behavior can occur.",
            "No labeled ground truth is available; classification accuracy is not measured.",
            "Self-transfers are preserved but excluded from role and temporal features.",
        ],
    }
    identity = {key: metadata[key] for key in ("dataset_sha256", "analysis_version", "parameters")}
    metadata["analysis_id"] = hashlib.sha256(
        json.dumps(identity, sort_keys=True).encode()
    ).hexdigest()
    json.dumps(metadata, allow_nan=False)
    return Analysis(dataset, nodes, clusters, top.reset_index(drop=True), daily, metadata)
