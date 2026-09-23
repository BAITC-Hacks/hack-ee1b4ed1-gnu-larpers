ROLES = ("consolidator", "transit", "distributor", "terminal", "coordinator", "peripheral")


def classify(row: dict) -> dict:
    incoming, outgoing = row["in_deg"], row["out_deg"]
    total_degree = incoming + outgoing
    flags = ["partial_observation"]
    if row["is_seed"]:
        flags.append("seed_inflow_incomplete")
    if row["truncated_by_depth"]:
        flags.append("depth_boundary")
    if row["temporal_right_censored"]:
        flags.append("temporal_right_censored")
    if row["self_tx"]:
        flags.append("self_transfers_observed")
    if not total_degree:
        flags.append("no_observed_external_transfers")
        if not row["self_tx"]:
            flags.append("no_observed_transfers")
        return {
            "role": "peripheral",
            "role_score": 0.0,
            "priority_score": 0.0,
            "role_status": "insufficient_observation",
            "flags": flags,
            "evidence": (
                f"Внешние переводы: 0 входящих и 0 исходящих; самопереводов: {row['self_tx']}."
            ),
        }
    scores = {"peripheral": 0.30}
    if incoming >= 3:
        scores["consolidator"] = (
            0.40 * min(1.0, incoming / 8)
            + 0.30 * incoming / total_degree
            + 0.15 * row["in_amount_percentile"]
            + 0.15 * row["in_tx_percentile"]
        )
    if outgoing >= 3:
        scores["distributor"] = (
            0.40 * min(1.0, outgoing / 8)
            + 0.30 * outgoing / total_degree
            + 0.15 * row["out_amount_percentile"]
            + 0.15 * row["out_tx_percentile"]
        )
    temporal = row["following_days_out_share"] or 0.0
    if incoming and outgoing and not row["is_seed"]:
        balance = min(row["in_minor"], row["out_minor"]) / max(row["in_minor"], row["out_minor"])
        if balance >= 0.5:
            scores["transit"] = (
                0.45 * balance + 0.35 * temporal + 0.20 * min(1.0, row["active_days"] / 5)
            )
    if incoming and not outgoing:
        scores["terminal"] = 0.55 + 0.15 * row["in_amount_percentile"]
    if (
        incoming
        and outgoing
        and row["betweenness_percentile"] >= 0.85
        and row["neighbor_clusters"] >= 2
        and row["seed_sources"] >= 2
    ):
        scores["coordinator"] = (
            0.40 * row["betweenness_percentile"]
            + 0.20 * min(1.0, row["neighbor_clusters"] / 3)
            + 0.20 * min(1.0, row["seed_sources"] / 5)
            + 0.20 * min(1.0, total_degree / 10)
        )
    role = max(scores, key=lambda name: (scores[name], -ROLES.index(name)))
    support = scores[role]
    status = "observed_pattern"
    if row["truncated_by_depth"] and role == "terminal":
        support = min(support, 0.20)
        status = "boundary_hypothesis"
    if row["is_seed"] and role == "terminal":
        support = min(support, 0.35)
    if role == "transit" and row["temporal_right_censored"]:
        support *= 0.85
    priority = (
        0.25 * row["betweenness_percentile"]
        + 0.20 * row["turnover_percentile"]
        + 0.15 * row["tx_percentile"]
        + 0.15 * min(1.0, row["seed_sources"] / 5)
        + 0.15 * support
        + 0.10 * (temporal if not row["is_seed"] else 0.0)
    )
    evidence = (
        f"Вх: {row['in_kzt']:.2f}₸/{incoming} контр.; "
        f"исх: {row['out_kzt']:.2f}₸/{outgoing}; "
        f"tx={row['in_tx']}+{row['out_tx']}"
    )
    details = {
        "coordinator": (
            f"; seed-пути={row['seed_sources']}; соседних групп={row['neighbor_clusters']}"
        ),
        "transit": f"; сопост. 1–{row['window_days']}д={temporal:.0%}",
        "terminal": "; исходящих в выборке нет",
    }
    evidence += details.get(role, "")
    if row["truncated_by_depth"]:
        evidence += "; граница 4-го колена"
    if row["is_seed"]:
        evidence += "; вход seed неполон"
    return {
        "role": role,
        "role_score": round(support, 6),
        "priority_score": round(priority, 6),
        "role_status": status,
        "flags": flags,
        "evidence": evidence[:200],
    }
