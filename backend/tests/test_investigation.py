import pytest
from test_analysis_exports import fixture_dataset

from money_graph.analysis import Config, analyze
from money_graph.investigation import Investigation, InvestigationStore


def investigation(transfers, *, config=None, **dataset_options):
    return Investigation(
        InvestigationStore(analyze(fixture_dataset(transfers, **dataset_options), config))
    )


def test_adjacent_18_digit_identifiers_remain_distinct_strings_in_tools_and_evidence():
    first, second, third = 100000000000000001, 100000000000000002, 100000000000000003
    case = investigation(
        [(first, second, "2026-07-01", 0.10), (second, third, "2026-07-02", 0.10)],
        seeds={first},
    )

    result = case.execute("trace_seed_paths", gid=str(third))
    path = [str(first), str(second), str(third)]

    assert result["data"]["paths"] == [path]
    assert case.evidence[result["evidence_id"]]["paths"] == [{"node_ids": path}]
    assert case.execute("get_node", gid=str(second))["data"]["gid"] == str(second)
    transfer = case.execute("get_transactions", gid=str(first))["data"]["transactions"][0]
    assert (transfer["src"], transfer["dst"], transfer["sum_minor"]) == (
        str(first),
        str(second),
        10,
    )
    with pytest.raises(ValueError, match="GID"):
        case.execute("get_node", gid=second)


def test_seed_paths_follow_transfer_direction_and_do_not_treat_neighbors_as_reachable():
    case = investigation(
        [(1, 2, "2026-07-01", 100), (3, 2, "2026-07-01", 100)],
        seeds={1},
    )

    forward = case.execute("trace_seed_paths", gid="2")["data"]
    reversed_neighbor = case.execute("trace_seed_paths", gid="3")["data"]

    assert forward["paths"] == [["1", "2"]]
    assert forward["total_seed_sources"] == 1
    assert reversed_neighbor["paths"] == []
    assert reversed_neighbor["total_seed_sources"] == 0


def test_trace_can_exceed_four_hops_and_agrees_with_analysis_seed_sources():
    case = investigation(
        [(gid, gid + 1, "2026-07-01", 100) for gid in range(1, 7)] + [(8, 3, "2026-07-01", 50)],
        seeds={1, 8},
        depths={7: 4},
    )

    result = case.execute("trace_seed_paths", gid="7")["data"]

    assert result["total_seed_sources"] == case.store.node("7")["seed_sources"] == 2
    assert result["paths"] == [
        ["1", "2", "3", "4", "5", "6", "7"],
        ["8", "3", "4", "5", "6", "7"],
    ]
    assert result["truncated"] is False


def test_path_display_limit_does_not_reduce_total_seed_count():
    case = investigation(
        [(seed, 20, "2026-07-01", 100) for seed in range(1, 10)],
        seeds=set(range(1, 10)),
    )

    result = case.execute("trace_seed_paths", gid="20")["data"]

    assert result["total_seed_sources"] == case.store.node("20")["seed_sources"] == 9
    assert len(result["paths"]) == 8
    assert result["truncated"] is True


def test_isolated_seed_and_disjoint_seeds_produce_no_fabricated_paths():
    case = investigation(
        [(1, 2, "2026-07-01", 100), (3, 4, "2026-07-01", 100)],
        seeds={1, 3, 5},
        isolates={5},
    )

    isolated = case.execute("trace_seed_paths", gid="5")["data"]
    disjoint = case.execute("find_common_downstream", seed_gids=["1", "3"])["data"]
    with_isolated = case.execute("find_common_downstream", seed_gids=["1", "5"])["data"]

    assert isolated["total_seed_sources"] == 0
    assert isolated["paths"] == []
    assert isolated["truncated"] is False
    for result in (disjoint, with_isolated):
        assert result["nodes"] == []
        assert result["paths"] == []
        assert result["total"] == 0
        assert result["truncated"] is False


def test_common_downstream_returns_actual_directed_paths_from_each_selected_seed():
    case = investigation(
        [
            (1, 3, "2026-07-01", 100),
            (2, 4, "2026-07-01", 100),
            (3, 5, "2026-07-02", 100),
            (4, 5, "2026-07-02", 100),
            (6, 1, "2026-07-01", 100),
            (6, 2, "2026-07-01", 100),
        ],
        seeds={1, 2},
    )

    result = case.execute("find_common_downstream", seed_gids=["1", "2", "1"])["data"]

    assert [row["gid"] for row in result["nodes"]] == ["5"]
    assert result["total"] == 1
    assert result["paths"] == [["1", "3", "5"], ["2", "4", "5"]]
    assert result["seed_gids"] == ["1", "2"]


def test_non_seed_queue_filters_full_analysis_before_applying_ranking_limit():
    analysis = analyze(
        fixture_dataset(
            [(seed, 100, "2026-07-01", 1000) for seed in range(1, 26)],
            seeds=set(range(1, 26)),
            isolates={1000, 1001, 1002},
        ),
        Config(top_n=20),
    )
    case = Investigation(InvestigationStore(analysis))
    assert not {1000, 1001, 1002} & set(analysis.top_nodes.gid)

    result = case.execute("find_nodes", limit=3)["data"]

    assert result["total"] == 4
    assert result["non_seed_only"] is True
    assert result["truncated"] is True
    assert [row["gid"] for row in result["nodes"]] == ["100", "1000", "1001"]
    assert all(not case.store.node(row["gid"])["is_seed"] for row in result["nodes"])
    assert case.execute("find_nodes", non_seed_only=False)["data"]["total"] == 29


def test_priority_explanation_reconstructs_score_for_active_boundary_and_self_only_nodes():
    case = investigation(
        [
            (1, 2, "2026-07-01", 100),
            (3, 2, "2026-07-01", 80),
            (2, 4, "2026-07-02", 150),
            (5, 5, "2026-07-02", 1000),
        ],
        seeds={1, 3},
        depths={4: 4},
        isolates={6},
    )

    for gid in case.store.nodes:
        explanation = case.execute("explain_priority", gid=gid)["data"]
        assert explanation["priority_score"] == case.store.node(gid)["priority_score"]
        assert round(sum(explanation["components"].values()), 6) == explanation["priority_score"]
        assert all(value >= 0 for value in explanation["components"].values())
        if gid in {"5", "6"}:
            assert explanation["priority_score"] == 0
            assert set(explanation["components"].values()) == {0}
    assert case.store.node("4")["role_status"] == "boundary_hypothesis"


@pytest.mark.parametrize(
    ("direction", "total", "incoming", "outgoing"),
    [("all", 4, 2000, 700), ("in", 3, 2000, 0), ("out", 2, 0, 700)],
)
def test_transaction_filters_preserve_duplicates_and_separate_self_transfers(
    direction,
    total,
    incoming,
    outgoing,
):
    case = investigation(
        [
            (1, 2, "2026-07-01", 10),
            (1, 2, "2026-07-01", 10),
            (2, 3, "2026-07-02", 7),
            (2, 2, "2026-07-02", 50),
            (3, 2, "2026-07-03", 5),
        ],
        seeds={1},
    )

    response = case.execute(
        "get_transactions",
        gid="2",
        direction=direction,
        date_from="2026-07-01",
        date_to="2026-07-02",
    )
    data = response["data"]

    assert data["total"] == total
    assert len(data["transactions"]) == total
    assert data["in_minor"] == incoming
    assert data["out_minor"] == outgoing
    assert data["self_minor"] == 5000
    assert all("2026-07-01" <= row["date"] <= "2026-07-02" for row in data["transactions"])
    if direction != "out":
        assert sum(row["src"] == "1" for row in data["transactions"]) == 2
    evidence = case.evidence[response["evidence_id"]]
    assert evidence["date_from"] == "2026-07-01"
    assert evidence["date_to"] == "2026-07-02"


def test_transaction_cap_preserves_totals_and_does_not_recalculate_full_dataset_roles():
    case = investigation(
        [(1, 2, "2026-07-01", 10)] * 3 + [(2, 3, "2026-07-02", 30)],
        seeds={1},
    )
    original = case.execute("get_node", gid="2")["data"].copy()

    data = case.execute(
        "get_transactions",
        gid="2",
        date_from="2026-07-01",
        date_to="2026-07-01",
        limit=1,
    )["data"]

    assert len(data["transactions"]) == 1
    assert data["total"] == 3
    assert data["in_minor"] == 3000
    assert data["out_minor"] == 0
    assert data["truncated"] is True
    assert "full dataset" in data["scope"]
    assert case.execute("get_node", gid="2")["data"] == original


def test_boundary_and_censored_data_requests_preserve_uncertainty_and_do_not_send_requests():
    case = investigation(
        [(1, 2, "2026-07-01", 100)],
        seeds={1},
        depths={2: 4},
    )

    boundary = case.execute("suggest_data_request", gid="2")["data"]
    seed = case.execute("suggest_data_request", gid="1")["data"]

    assert "depth_boundary" in boundary["flags"]
    assert "temporal_right_censored" in boundary["flags"]
    assert len(boundary["requests"]) == 2
    assert any("ещё одно колено" in item["request"] for item in boundary["requests"])
    assert any("следующие 3 дня" in item["request"] for item in boundary["requests"])
    assert "no request has been sent" in boundary["status"]
    assert "seed_inflow_incomplete" in seed["flags"]
    assert any("входящая история" in item["request"] for item in seed["requests"])


def test_structural_path_does_not_claim_chronological_money_provenance():
    case = investigation(
        [(1, 2, "2026-07-03", 100), (2, 3, "2026-07-01", 100)],
        seeds={1},
    )

    response = case.execute("trace_seed_paths", gid="3")

    assert response["data"]["paths"] == [["1", "2", "3"]]
    assert case.store.node("2")["following_days_matched_minor"] == 0
    assert "not chronological proof" in response["data"]["meaning"]
    evidence = case.evidence[response["evidence_id"]]
    assert any("не доказывает" in fact["value"] for fact in evidence["facts"])


def test_observation_cards_reference_existing_nodes_clusters_and_directed_paths():
    case = investigation(
        [(1, 3, "2026-07-01", 100), (2, 3, "2026-07-01", 100)],
        seeds={1, 2},
    )
    cluster_id = case.store.node("3")["cluster_id"]
    calls = [
        ("get_node", {"gid": "3"}),
        ("find_nodes", {}),
        ("get_cluster", {"cluster_id": cluster_id}),
        ("get_transactions", {"gid": "3"}),
        ("trace_seed_paths", {"gid": "3"}),
        ("find_common_downstream", {"seed_gids": ["1", "2"]}),
        ("explain_priority", {"gid": "3"}),
        ("suggest_data_request", {"gid": "3"}),
    ]

    for name, arguments in calls:
        response = case.execute(name, **arguments)
        card = case.evidence[response["evidence_id"]]
        assert response["analysis_id"] == case.store.analysis_id
        assert card["id"] == response["evidence_id"]
        assert card["facts"]
        assert set(card["node_ids"]) <= case.store.nodes.keys()
        if card["cluster_id"] is not None:
            assert card["cluster_id"] in case.store.clusters
        for path in card["paths"]:
            ids = path["node_ids"]
            assert set(ids) <= case.store.nodes.keys()
            assert all(
                case.store.graph.has_edge(src, dst) for src, dst in zip(ids, ids[1:], strict=False)
            )


@pytest.mark.parametrize(
    ("tool", "arguments"),
    [
        ("get_node", {"gid": "999"}),
        ("find_nodes", {"limit": 21}),
        ("find_nodes", {"role": "guilty"}),
        ("get_cluster", {"cluster_id": 999}),
        ("get_transactions", {"gid": "2", "direction": "backwards"}),
        ("get_transactions", {"gid": "2", "date_from": "2026-07-02", "date_to": "2026-07-01"}),
        ("get_transactions", {"gid": "2", "date_from": "2026-02-30"}),
        ("find_common_downstream", {"seed_gids": ["1", "1"]}),
        ("find_common_downstream", {"seed_gids": ["1", "2"]}),
        ("__init__", {}),
    ],
)
def test_invalid_tool_requests_fail_without_recording_evidence(tool, arguments):
    case = investigation([(1, 2, "2026-07-01", 100)], seeds={1})

    with pytest.raises(ValueError):
        case.execute(tool, **arguments)

    assert case.evidence == {}


def test_investigation_rejects_calls_past_the_per_question_budget():
    case = investigation([(1, 2, "2026-07-01", 100)], seeds={1})
    for _ in range(16):
        case.execute("get_node", gid="2")

    with pytest.raises(ValueError, match="16"):
        case.execute("get_node", gid="2")
