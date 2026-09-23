import pytest
from pydantic import ValidationError
from test_analysis_exports import fixture_dataset

from money_graph.agent import Answer, Claim, checked_answer
from money_graph.analysis import Config, analyze
from money_graph.investigation import Investigation, InvestigationStore


@pytest.fixture
def case():
    return Investigation(
        InvestigationStore(
            analyze(
                fixture_dataset(
                    [(100000000000000001, 100000000000000002, "2026-07-01", 100.01)],
                    seeds={100000000000000001},
                    depths={100000000000000002: 4},
                )
            )
        )
    )


def answer(evidence_id, field, value, **overrides):
    return Answer(
        **{
            "kind": "investigation",
            "summary": "Интерпретация требует проверки аналитиком.",
            "claims": [Claim(evidence_id=evidence_id, field=field, value=value)],
            "hypotheses": [],
            "limitations": [],
            **overrides,
        }
    )


@pytest.mark.parametrize(
    ("field", "value", "display"),
    [
        ("in_minor", 10001, "100.01 ₸"),
        ("gid", "100000000000000002", "100000000000000002"),
        ("role", "terminal", "Конечный узел"),
        ("role_status", "boundary_hypothesis", "Неподтверждённая роль"),
        ("truncated_by_depth", True, "Да"),
    ],
)
def test_grounded_claims_render_from_trusted_snapshot_with_readable_labels(
    case, field, value, display
):
    result = case.execute("get_node", gid="100000000000000002")
    assert field in result["claimable_fields"]

    verified, cards = checked_answer(answer(result["evidence_id"], field, value), case)

    assert display in verified["findings"][0]["text"]
    assert verified["findings"][0]["evidence_ids"] == [result["evidence_id"]]
    assert not any(key.startswith("_") for key in cards[0])


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("in_minor", 999999999),
        ("in_minor", 10001.0),
        ("in_minor", "10001"),
        ("gid", 100000000000000002),
        ("gid", "100000000000000001"),
        ("is_seed", 0),
        ("seed_sources", True),
        ("role", "coordinator"),
        ("missing_metric", 0),
        ("priority_components", None),
        ("flags.99", "partial_observation"),
        ("role_candidates.0.role", "terminal"),
    ],
)
def test_fabricated_metrics_wrong_types_and_unknown_fields_fail_with_real_evidence(
    case, field, value
):
    result = case.execute("get_node", gid="100000000000000002")

    with pytest.raises(ValueError, match="Утверждение"):
        checked_answer(answer(result["evidence_id"], field, value), case)


def test_transaction_claims_keep_dates_direction_large_ids_and_exact_minor_amounts(case):
    result = case.execute(
        "get_transactions", gid="100000000000000002", direction="in", date_to="2026-07-01"
    )
    evidence_id = result["evidence_id"]
    claims = [
        Claim(evidence_id=evidence_id, field="transactions.0.src", value="100000000000000001"),
        Claim(evidence_id=evidence_id, field="transactions.0.date", value="2026-07-01"),
        Claim(evidence_id=evidence_id, field="transactions.0.sum_minor", value=10001),
        Claim(evidence_id=evidence_id, field="date_from", value=None),
        Claim(evidence_id=evidence_id, field="in_minor", value=10001),
    ]

    verified, cards = checked_answer(answer(evidence_id, "total", 1, claims=claims), case)

    assert "100.01 ₸" in verified["findings"][2]["text"]
    assert "Дата операции: 2026-07-01" in verified["findings"][1]["text"]
    assert "начало выгрузки — 2026-07-01 · входящие" in verified["findings"][4]["text"]
    assert all("transactions.0" not in row["text"] for row in verified["findings"])
    assert cards[0]["source"] == {
        "tool": "get_transactions",
        "gid": "100000000000000002",
        "direction": "in",
    }
    with pytest.raises(ValueError, match="Утверждение"):
        checked_answer(answer(evidence_id, "transactions.0.date", "2026-07-02"), case)


def test_full_period_operations_have_a_source_even_without_date_boundaries(case):
    result = case.execute("get_transactions", gid="100000000000000002", direction="out")
    verified, cards = checked_answer(answer(result["evidence_id"], "total", 0), case)

    assert cards[0]["date_from"] is None and cards[0]["date_to"] is None
    assert cards[0]["source"]["direction"] == "out"
    assert "Операций: 0" in verified["findings"][0]["text"]


def test_free_interpretation_and_hypotheses_cannot_become_verified_findings(case):
    result = case.execute("get_node", gid="100000000000000002")
    invented = "Клиент получил 999999999 рублей."

    verified, _ = checked_answer(
        answer(result["evidence_id"], "in_minor", 10001, summary=invented, hypotheses=[invented]),
        case,
    )

    assert verified["summary"] == invented
    assert verified["hypotheses"] == [invented]
    assert invented not in verified["findings"][0]["text"]
    assert "100.01 ₸" in verified["findings"][0]["text"]
    with pytest.raises(ValidationError):
        Answer.model_validate(
            {
                "summary": invented,
                "findings": [{"text": invented, "evidence_ids": [result["evidence_id"]]}],
                "hypotheses": [],
                "limitations": [],
            }
        )


def test_evidence_from_another_snapshot_cannot_ground_current_claim(case):
    result = case.execute("get_node", gid="100000000000000002")
    other = Investigation(
        InvestigationStore(
            analyze(fixture_dataset([(1, 2, "2026-07-01", 100)], seeds={1}), Config(window_days=2))
        )
    )
    other.evidence.update(case.evidence)

    with pytest.raises(ValueError, match="ссылки"):
        checked_answer(answer(result["evidence_id"], "in_minor", 10001), other)


def test_nested_results_and_empty_paths_have_grounded_claims_without_invented_connections(case):
    result = case.execute("find_nodes")
    verified, _ = checked_answer(
        answer(result["evidence_id"], "nodes.0.gid", "100000000000000002"), case
    )
    assert "Клиент 100000000000000002" in verified["findings"][0]["text"]
    result = case.execute("trace_seed_paths", gid="100000000000000001")
    verified, _ = checked_answer(answer(result["evidence_id"], "total_seed_sources", 0), case)
    assert "Достижимых исходных клиентов: 0" in verified["findings"][0]["text"]
    with pytest.raises(ValueError, match="Утверждение"):
        checked_answer(answer(result["evidence_id"], "paths.0.0", "100000000000000001"), case)
