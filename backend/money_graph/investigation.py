import hashlib
import json
from datetime import date

import networkx as nx

from money_graph.analysis import Analysis
from money_graph.export import graph_payload
from money_graph.roles import PRIORITY_LABELS, ROLES


def money(minor: int) -> str:
    return f"{minor // 100:,}.{minor % 100:02d} ₸".replace(",", " ")


ROLE_LABELS = {
    "consolidator": "Сборщик",
    "transit": "Транзит",
    "distributor": "Распределитель",
    "terminal": "Конечный узел",
    "coordinator": "Связующий узел",
    "peripheral": "Периферия",
}

VALUE_LABELS = {
    **ROLE_LABELS,
    "observed_pattern": "Наблюдаемый паттерн",
    "boundary_hypothesis": "Неподтверждённая роль на границе наблюдения",
    "insufficient_observation": "Недостаточно наблюдений",
    "partial_observation": "Неполная выборка",
    "seed_inflow_incomplete": "Входящие исходного клиента неполны",
    "depth_boundary": "Граница глубины обхода",
    "temporal_right_censored": "Временное окно обрывается концом выгрузки",
    "self_transfers_observed": "Есть самопереводы",
    "no_observed_external_transfers": "Нет наблюдаемых внешних переводов",
    "no_observed_transfers": "Нет наблюдаемых переводов",
    "all": "Все направления",
    "in": "Входящие",
    "out": "Исходящие",
}

CLAIM_LABELS = {
    "gid": "Клиент",
    "src": "Отправитель",
    "dst": "Получатель",
    "date": "Дата операции",
    "date_from": "Начало периода",
    "date_to": "Конец периода",
    "direction": "Направление операций",
    "role": "Наблюдаемая роль",
    "role_status": "Статус роли",
    "role_score": "Поддержка роли (не вероятность нарушения)",
    "role_margin": "Разница поддержки ролей",
    "priority_score": "Приоритет проверки (не вероятность нарушения)",
    "cluster_id": "Группа",
    "depth": "Глубина обхода",
    "is_seed": "Исходный клиент",
    "in_minor": "Наблюдаемые входящие",
    "out_minor": "Наблюдаемые исходящие",
    "self_minor": "Самопереводы",
    "sum_minor": "Сумма перевода",
    "sum_minor_internal": "Внутренний оборот",
    "following_days_matched_minor": "Объём, совместимый с последующим FIFO-сопоставлением",
    "in_deg": "Входящих контрагентов",
    "out_deg": "Исходящих контрагентов",
    "in_tx": "Входящих операций",
    "out_tx": "Исходящих операций",
    "self_tx": "Самопереводов",
    "n_tx": "Операций",
    "n_nodes": "Клиентов",
    "n_seed": "Исходных клиентов",
    "seed_sources": "Достижимых исходных клиентов",
    "total_seed_sources": "Достижимых исходных клиентов",
    "total": "Всего результатов",
    "truncated": "Показана ограниченная часть результатов",
    "non_seed_only": "Исходные клиенты исключены",
    "active_days": "Активных дней",
    "same_day_activity_days": "Дней с входящими и исходящими",
    "following_days_out_share": "Доля, совместимая с последующим FIFO-сопоставлением",
    "window_days": "Окно сопоставления, дней",
    "truncated_by_depth": "Граница глубины обхода",
    "temporal_right_censored": "Неполное временное окно",
    "cycle_component_size": "Клиентов в циклической компоненте",
    "neighbor_clusters": "Соседних групп",
    "pass_through": "Соотношение входящего и исходящего объёма",
    "betweenness": "Вклад посредничества",
    "turnover": "Вклад оборота",
    "transactions": "Вклад числа переводов",
    "role_support": "Вклад поддержки роли",
    "temporal": "Вклад временного сопоставления",
}


def claim_values(data: dict, title: str) -> dict[str, dict]:
    claims = {}

    def add(field, value, label, subject):
        if value is None:
            display = (
                "Начало выгрузки"
                if field == "date_from"
                else "Конец выгрузки"
                if field == "date_to"
                else "Недоступно"
            )
        elif type(value) is bool:
            display = "Да" if value else "Нет"
        elif field.rsplit(".", 1)[-1].endswith("_minor") or field == "sum_minor_internal":
            display = money(value)
        elif field.rsplit(".", 1)[-1] == "cluster_id":
            display = str(value + 1)
        elif isinstance(value, str):
            display = VALUE_LABELS.get(value, value)
        else:
            display = str(value)
        claims[field] = {"value": value, "text": f"{subject} · {label}: {display}."}

    def walk(value, path, subject):
        if isinstance(value, dict):
            if "gid" in value:
                subject = f"Клиент {value['gid']}"
                if not path and "direction" in value:
                    start = value.get("date_from") or "начало выгрузки"
                    end = value.get("date_to") or "конец выгрузки"
                    subject += f" · {start} — {end} · {VALUE_LABELS[value['direction']].lower()}"
            elif "src" in value and "dst" in value:
                subject = f"Перевод {value['src']} → {value['dst']} ({value['date']})"
            for key, child in value.items():
                field = f"{path}.{key}" if path else key
                if isinstance(child, (dict, list)):
                    if key in {
                        "nodes",
                        "transactions",
                        "components",
                        "priority_components",
                        "paths",
                        "top_gids",
                        "seed_gids",
                        "flags",
                    }:
                        walk(child, field, subject)
                elif key in CLAIM_LABELS:
                    label = CLAIM_LABELS[key]
                    if key == "seed_sources" and path in {"components", "priority_components"}:
                        label = "Вклад достижимости исходных клиентов"
                    if key == "total":
                        label = "Операций" if "transactions" in value else "Подходящих клиентов"
                    add(field, child, label, subject)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                field = f"{path}.{index}"
                if isinstance(child, (dict, list)):
                    walk(child, field, subject)
                elif path in {"top_gids", "seed_gids", "flags"}:
                    label = {
                        "top_gids": "Приоритетный клиент группы",
                        "seed_gids": "Выбранный исходный клиент",
                        "flags": "Ограничение наблюдений",
                    }[path]
                    add(field, child, label, subject)
                elif path.startswith("paths."):
                    position = int(path.split(".")[1]) + 1
                    add(field, child, f"Направленный путь {position}, клиент {index + 1}", subject)

    walk(data, "", title)
    return claims


class InvestigationStore:
    def __init__(self, analysis: Analysis):
        self.payload = graph_payload(analysis)
        self.analysis_id = self.payload["metadata"]["analysis_id"]
        self.nodes = {node["gid"]: node for node in self.payload["nodes"]}
        self.clusters = {row["cluster_id"]: row for row in self.payload["clusters"]}
        self.graph = nx.DiGraph()
        self.graph.add_nodes_from(self.nodes)
        self.graph.add_edges_from(
            (edge["src"], edge["dst"])
            for edge in self.payload["edges"]
            if edge["src"] != edge["dst"]
        )
        self.seeds = {gid for gid, row in self.nodes.items() if row["is_seed"]}
        self.transactions = {gid: [] for gid in self.nodes}
        for row in self.payload["transactions"]:
            for gid in {row["src"], row["dst"]}:
                self.transactions[gid].append(row)

    def node(self, gid: str) -> dict:
        if not isinstance(gid, str) or gid not in self.nodes:
            raise ValueError("Клиент с таким строковым GID отсутствует в текущей выгрузке.")
        return self.nodes[gid]

    def ordered(self, nodes):
        return sorted(nodes, key=lambda row: (-row["priority_score"], int(row["gid"])))

    def seed_paths(self, gid: str, limit: int = 8) -> tuple[int, list[list[str]]]:
        self.node(gid)
        paths = nx.single_source_shortest_path(self.graph.reverse(copy=False), gid)
        sources = sorted((self.seeds & paths.keys()) - {gid}, key=int)
        visible = [list(reversed(paths[source])) for source in sources if len(paths[source]) <= 128]
        return len(sources), visible[:limit]


class Investigation:
    def __init__(self, store: InvestigationStore):
        self.store = store
        self.evidence: dict[str, dict] = {}
        self.calls = 0

    def record(
        self,
        tool,
        title,
        data,
        facts,
        node_ids=(),
        paths=(),
        cluster_id=None,
        date_from=None,
        date_to=None,
    ) -> dict:
        identity = json.dumps([tool, data], sort_keys=True, ensure_ascii=False)
        evidence_id = hashlib.sha256(f"{self.store.analysis_id}:{identity}".encode()).hexdigest()[
            :20
        ]
        claims = claim_values(data, title)
        self.evidence[evidence_id] = {
            "_analysis_id": self.store.analysis_id,
            "_claims": claims,
            "id": evidence_id,
            "title": title,
            "facts": [{"label": label, "value": str(value)} for label, value in facts],
            "node_ids": list(node_ids),
            "paths": [{"node_ids": path} for path in paths],
            "cluster_id": cluster_id,
            "date_from": date_from,
            "date_to": date_to,
            "source": {
                "tool": tool,
                "gid": data.get("gid"),
                "direction": data.get("direction") if tool == "get_transactions" else None,
            },
        }
        return {
            "evidence_id": evidence_id,
            "analysis_id": self.store.analysis_id,
            "data": data,
            "claimable_fields": list(claims),
        }

    def execute(self, name: str, **arguments) -> dict:
        self.calls += 1
        if self.calls > 16:
            raise ValueError("Достигнут лимит 16 инструментов на один вопрос.")
        allowed = {
            "get_node",
            "find_nodes",
            "get_cluster",
            "get_transactions",
            "trace_seed_paths",
            "find_common_downstream",
            "explain_priority",
            "suggest_data_request",
        }
        if name not in allowed:
            raise ValueError("Неизвестный инструмент.")
        return getattr(self, name)(**arguments)

    def get_node(self, gid: str) -> dict:
        node = self.store.node(gid)
        return self.record(
            "get_node",
            f"Клиент {gid}",
            node,
            [
                ("Наблюдаемая роль", ROLE_LABELS[node["role"]]),
                ("Статус роли", VALUE_LABELS.get(node["role_status"], node["role_status"])),
                ("Приоритет", node["priority_score"]),
                ("Входящие", money(node["in_minor"])),
                ("Исходящие", money(node["out_minor"])),
                ("Источников seed", node["seed_sources"]),
                ("Ограничения", ", ".join(VALUE_LABELS.get(flag, flag) for flag in node["flags"])),
            ],
            [gid],
        )

    def find_nodes(
        self,
        role: str | None = None,
        cluster_id: int | None = None,
        non_seed_only: bool = True,
        limit: int = 10,
    ) -> dict:
        if role is not None and role not in ROLES:
            raise ValueError("Неизвестная роль.")
        if cluster_id is not None and cluster_id not in self.store.clusters:
            raise ValueError("Группа отсутствует в выгрузке.")
        if not 1 <= limit <= 20:
            raise ValueError("Лимит клиентов должен быть от 1 до 20.")
        matches = self.store.ordered(
            [
                row
                for row in self.store.nodes.values()
                if (not non_seed_only or not row["is_seed"])
                and (role is None or row["role"] == role)
                and (cluster_id is None or row["cluster_id"] == cluster_id)
            ]
        )
        rows = [
            {
                key: row[key]
                for key in (
                    "gid",
                    "role",
                    "role_status",
                    "priority_score",
                    "seed_sources",
                    "flags",
                )
            }
            for row in matches[:limit]
        ]
        return self.record(
            "find_nodes",
            "Очередь проверки",
            {
                "nodes": rows,
                "total": len(matches),
                "truncated": len(matches) > limit,
                "non_seed_only": non_seed_only,
            },
            [("Всего подходящих клиентов", len(matches))]
            + [
                (row["gid"], f"{row['role']} · приоритет {row['priority_score']:.6f}")
                for row in rows
            ],
            [row["gid"] for row in rows],
            cluster_id=cluster_id,
        )

    def get_cluster(self, cluster_id: int) -> dict:
        if cluster_id not in self.store.clusters:
            raise ValueError(
                "Группа отсутствует в выгрузке. В интерфейсе номер равен cluster_id + 1."
            )
        row = self.store.clusters[cluster_id]
        return self.record(
            "get_cluster",
            f"Группа {cluster_id + 1}",
            row,
            [
                ("Клиентов", row["n_nodes"]),
                ("Seed", row["n_seed"]),
                ("Внутренний оборот", money(row["sum_minor_internal"])),
                ("Гипотеза", row["hypothesis"]),
            ],
            row["top_gids"],
            cluster_id=cluster_id,
        )

    def get_transactions(
        self,
        gid: str,
        date_from: str | None = None,
        date_to: str | None = None,
        direction: str = "all",
        limit: int = 20,
    ) -> dict:
        self.store.node(gid)
        if direction not in ("all", "in", "out") or not 1 <= limit <= 30:
            raise ValueError("Направление: all/in/out; лимит: от 1 до 30.")
        for value in (date_from, date_to):
            if value is not None and date.fromisoformat(value).isoformat() != value:
                raise ValueError("Нужна дата YYYY-MM-DD.")
        if date_from and date_to and date_from > date_to:
            raise ValueError("Начало периода позже конца.")
        rows = [
            row
            for row in self.store.transactions[gid]
            if (not date_from or row["date"] >= date_from)
            and (not date_to or row["date"] <= date_to)
            and (direction == "all" or row["dst" if direction == "in" else "src"] == gid)
        ]
        external = [row for row in rows if row["src"] != row["dst"]]
        incoming = sum(row["sum_minor"] for row in external if row["dst"] == gid)
        outgoing = sum(row["sum_minor"] for row in external if row["src"] == gid)
        return self.record(
            "get_transactions",
            f"Операции клиента {gid}",
            {
                "gid": gid,
                "date_from": date_from,
                "date_to": date_to,
                "direction": direction,
                "transactions": rows[:limit],
                "total": len(rows),
                "truncated": len(rows) > limit,
                "in_minor": incoming,
                "out_minor": outgoing,
                "self_minor": sum(row["sum_minor"] for row in rows if row["src"] == row["dst"]),
                "scope": "Only transactions are filtered; "
                "roles and priorities cover the full dataset.",
            },
            [
                ("Операций в выбранном направлении", len(rows)),
                ("Направление", VALUE_LABELS[direction]),
                ("Внешние входящие", money(incoming)),
                ("Внешние исходящие", money(outgoing)),
                ("Период", f"{date_from or 'начало выгрузки'} — {date_to or 'конец выгрузки'}"),
                ("Роли и приоритеты", "Рассчитаны за всю выгрузку"),
            ],
            [gid],
            date_from=date_from,
            date_to=date_to,
        )

    def trace_seed_paths(self, gid: str) -> dict:
        total, paths = self.store.seed_paths(gid)
        return self.record(
            "trace_seed_paths",
            f"Пути от seed к {gid}",
            {
                "gid": gid,
                "total_seed_sources": total,
                "paths": paths,
                "truncated": len(paths) < total,
                "meaning": "Directed structural paths, "
                "not chronological proof of money provenance.",
            },
            [
                ("Достижимых источников seed", total),
                ("Показано путей", len(paths)),
                ("Ограничение", "Направленный путь не доказывает движение тех же денег"),
            ],
            [gid],
            paths,
        )

    def find_common_downstream(self, seed_gids: list[str], limit: int = 5) -> dict:
        seeds = list(dict.fromkeys(seed_gids))
        if not 2 <= len(seeds) <= 8 or not 1 <= limit <= 10:
            raise ValueError("Нужно от 2 до 8 разных seed; лимит результатов от 1 до 10.")
        for gid in seeds:
            if not self.store.node(gid)["is_seed"]:
                raise ValueError(f"Клиент {gid} не является seed.")
        common = set.intersection(*(nx.descendants(self.store.graph, gid) for gid in seeds))
        ranked = self.store.ordered(self.store.nodes[gid] for gid in common)[:limit]
        paths = []
        for row in ranked:
            for gid in seeds:
                path = nx.shortest_path(self.store.graph, gid, row["gid"])
                if len(path) <= 128 and len(paths) < 16:
                    paths.append(path)
        rows = [
            {key: row[key] for key in ("gid", "priority_score", "role", "role_status")}
            for row in ranked
        ]
        return self.record(
            "find_common_downstream",
            "Общие достижимые клиенты",
            {
                "seed_gids": seeds,
                "nodes": rows,
                "total": len(common),
                "paths": paths,
                "truncated": len(common) > limit or len(paths) < len(ranked) * len(seeds),
                "meaning": "Reachability in the observed directed graph; "
                "not proof of common ownership.",
            },
            [
                ("Общих достижимых клиентов", len(common)),
                ("Выбрано seed", len(seeds)),
                ("Показано путей", len(paths)),
            ],
            [row["gid"] for row in rows],
            paths,
        )

    def explain_priority(self, gid: str) -> dict:
        row = self.store.node(gid)
        return self.record(
            "explain_priority",
            f"Приоритет клиента {gid}",
            {
                "gid": gid,
                "priority_score": row["priority_score"],
                "components": row["priority_components"],
                "flags": row["flags"],
                "meaning": "Heuristic inspection priority, not a probability of wrongdoing.",
            },
            [
                (PRIORITY_LABELS[key], f"{value:.6f}")
                for key, value in row["priority_components"].items()
            ]
            + [("Итого", f"{row['priority_score']:.6f}")],
            [gid],
        )

    def suggest_data_request(self, gid: str) -> dict:
        row = self.store.node(gid)
        requests = []
        if row["truncated_by_depth"]:
            requests.append(
                {
                    "request": "Исходящие операции клиента за период выгрузки и ещё одно колено.",
                    "question": "Продолжается ли наблюдаемая цепочка за границей обхода?",
                }
            )
        if row["is_seed"]:
            requests.append(
                {
                    "request": "Полная входящая история исходного клиента за период выгрузки.",
                    "question": "Какие источники поступлений отсутствуют в выборке?",
                }
            )
        if row["temporal_right_censored"]:
            requests.append(
                {
                    "request": f"Операции за следующие {row['window_days']} дня "
                    "после конца выгрузки.",
                    "question": "Есть ли последующие исходящие в полном временном окне?",
                }
            )
        if not requests:
            requests.append(
                {
                    "request": "Время операций внутри дня и остатки на счёте за выбранный период.",
                    "question": "Допускает ли порядок операций проверяемую гипотезу транзита?",
                }
            )
        return self.record(
            "suggest_data_request",
            f"Недостающие данные: {gid}",
            {
                "gid": gid,
                "flags": row["flags"],
                "requests": requests,
                "status": "Recommendation only; no request has been sent.",
            },
            [(item["question"], item["request"]) for item in requests],
            [gid],
        )
