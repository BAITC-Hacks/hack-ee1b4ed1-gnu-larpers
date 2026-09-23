from datetime import date
from decimal import Decimal

import pandas as pd
import pytest

from money_graph.dataset import DataError, Dataset, validate_dataset
from money_graph.temporal import daily_flows, temporal_features


def make_dataset(transactions=None, gids=(1, 2, 3, 4)):
    if transactions is None:
        transactions = [(1, 2, "2026-01-01", 10.0)]
    nodes = pd.DataFrame(
        {"gid": list(gids), "depth": [1] * len(gids), "is_seed": [False] * len(gids)}
    )
    tx = pd.DataFrame(transactions, columns=["src", "dst", "date", "sum_kzt"])
    pairs = {}
    for src, dst, _, amount in transactions:
        total, count = pairs.get((src, dst), (Decimal(0), 0))
        pairs[(src, dst)] = (total + Decimal(str(amount)), count + 1)
    edges = pd.DataFrame(
        [(src, dst, float(total), count, 1) for (src, dst), (total, count) in pairs.items()],
        columns=["src", "dst", "sum_kzt", "n_tx", "depth"],
    )
    return Dataset(nodes, edges, tx)


def features_for(transactions, gid=2, window_days=3):
    dataset = validate_dataset(make_dataset(transactions))
    return temporal_features(daily_flows(dataset.transactions), window_days)[gid]


@pytest.mark.parametrize(
    ("column", "value", "message"),
    [("sum_kzt", 11.0, "amounts"), ("n_tx", 2, "counts"), ("dst", 3, "pairs")],
)
def test_rejects_edge_transaction_disagreement(column, value, message):
    dataset = make_dataset()
    dataset.edges.loc[0, column] = value

    with pytest.raises(DataError, match=message):
        validate_dataset(dataset)


@pytest.mark.parametrize("table", ["edges", "transactions"])
@pytest.mark.parametrize("column", ["src", "dst"])
def test_rejects_unknown_endpoint(table, column):
    dataset = make_dataset()
    getattr(dataset, table).loc[0, column] = 999

    with pytest.raises(DataError, match="unknown endpoint"):
        validate_dataset(dataset)


def test_rejects_duplicate_node_id():
    dataset = make_dataset()
    nodes = pd.concat([dataset.nodes, dataset.nodes.iloc[[0]]], ignore_index=True)

    with pytest.raises(DataError, match="duplicate gid"):
        validate_dataset(Dataset(nodes, dataset.edges, dataset.transactions))


def test_rejects_duplicate_directed_edge():
    dataset = make_dataset()
    edges = pd.concat([dataset.edges, dataset.edges], ignore_index=True)

    with pytest.raises(DataError, match="duplicate directed pair"):
        validate_dataset(Dataset(dataset.nodes, edges, dataset.transactions))


def test_preserves_identical_transactions_as_separate_transfers():
    dataset = validate_dataset(
        make_dataset([(1, 2, "2026-01-01", 10.0), (1, 2, "2026-01-01", 10.0)])
    )

    assert len(dataset.transactions) == 2
    assert dataset.edges.n_tx.tolist() == [2]
    assert dataset.edges.sum_minor.tolist() == [2000]
    incoming = daily_flows(dataset.transactions).set_index("gid").loc[2]
    assert incoming.in_minor == 2000
    assert incoming.in_tx == 2


def test_preserves_large_adjacent_identifiers():
    gids = (2**53 + 1, 2**53 + 2, 2**53 + 3)
    transactions = [
        (gids[0], gids[1], "2026-01-01", 0.1),
        (gids[1], gids[2], "2026-01-02", 0.2),
    ]
    dataset = validate_dataset(make_dataset(transactions, gids))

    assert dataset.nodes.gid.tolist() == list(gids)
    assert list(zip(dataset.edges.src, dataset.edges.dst, strict=True)) == [
        (gids[0], gids[1]),
        (gids[1], gids[2]),
    ]
    assert list(zip(dataset.transactions.src, dataset.transactions.dst, strict=True)) == [
        (gids[0], gids[1]),
        (gids[1], gids[2]),
    ]
    features = temporal_features(daily_flows(dataset.transactions), 3)
    assert set(features) == set(gids)
    assert features[gids[1]]["following_days_matched_minor"] == 10


def test_compares_decimal_amounts_in_minor_units():
    dataset = make_dataset([(1, 2, "2026-01-01", 0.1), (1, 2, "2026-01-02", 0.2)])
    dataset.edges.loc[0, "sum_kzt"] = 0.1 + 0.2

    normalized = validate_dataset(dataset)

    assert normalized.transactions.sum_minor.tolist() == [10, 20]
    assert normalized.edges.sum_minor.tolist() == [30]


def test_rejects_positive_amount_that_rounds_to_zero_minor_units():
    with pytest.raises(DataError):
        validate_dataset(make_dataset([(1, 2, "2026-01-01", 0.000001)]))


def test_preserves_self_transfer_but_excludes_it_from_daily_flows():
    dataset = validate_dataset(make_dataset([(2, 2, "2026-01-01", 10.0)]))
    daily = daily_flows(dataset.transactions)

    assert len(dataset.transactions) == 1
    assert dataset.transactions.src.tolist() == [2]
    assert dataset.transactions.dst.tolist() == [2]
    assert dataset.transactions.sum_minor.tolist() == [1000]
    assert dataset.edges.sum_minor.tolist() == [1000]
    assert daily.empty
    assert temporal_features(daily, 3) == {}


def test_self_transfers_do_not_inflate_daily_amounts_or_temporal_matching():
    dataset = validate_dataset(
        make_dataset(
            [
                (1, 2, "2026-01-01", 10.0),
                (2, 2, "2026-01-01", 100.0),
                (2, 3, "2026-01-02", 6.0),
                (2, 2, "2026-01-02", 100.0),
            ]
        )
    )
    daily = daily_flows(dataset.transactions)
    node_daily = daily.loc[daily.gid == 2]

    assert len(dataset.transactions) == 4
    assert node_daily.in_minor.tolist() == [1000, 0]
    assert node_daily.out_minor.tolist() == [0, 600]
    assert node_daily.in_tx.tolist() == [1, 0]
    assert node_daily.out_tx.tolist() == [0, 1]
    features = temporal_features(daily, 3)[2]
    assert features["same_day_activity_days"] == 0
    assert features["following_days_matched_minor"] == 600
    assert features["following_days_out_share"] == 0.6


@pytest.mark.parametrize("day", ["2026-01-01", date(2026, 1, 1), pd.Timestamp("2026-01-01")])
def test_accepts_dates_at_day_precision(day):
    dataset = validate_dataset(make_dataset([(1, 2, day, 10.0)]))

    assert dataset.transactions.date.tolist() == [pd.Timestamp("2026-01-01")]


@pytest.mark.parametrize("day", ["2026-01-01T12:01:02", "2026-01-01T00:00:00Z", "2026-02-30"])
def test_rejects_intraday_timezone_and_invalid_dates(day):
    with pytest.raises(DataError, match="date"):
        validate_dataset(make_dataset([(1, 2, day, 10.0)]))


def test_same_day_activity_does_not_establish_transfer_order():
    features = features_for([(1, 2, "2026-01-01", 10.0), (2, 3, "2026-01-01", 10.0)])

    assert features["same_day_activity_days"] == 1
    assert features["following_days_matched_minor"] == 0
    assert features["following_days_out_share"] == 0


def test_outgoing_before_incoming_is_never_matched():
    features = features_for([(2, 3, "2026-01-01", 10.0), (1, 2, "2026-01-02", 10.0)])

    assert features["following_days_matched_minor"] == 0


def test_incoming_amount_cannot_be_reused_for_multiple_outgoing_days():
    features = features_for(
        [
            (1, 2, "2026-01-01", 10.0),
            (2, 3, "2026-01-02", 7.0),
            (2, 4, "2026-01-03", 7.0),
        ]
    )

    assert features["following_days_matched_minor"] == 1000
    assert features["following_days_out_share"] == 1


@pytest.mark.parametrize(("out_day", "expected_minor"), [("2026-01-04", 1000), ("2026-01-05", 0)])
def test_matching_window_includes_boundary_and_excludes_older_incoming(out_day, expected_minor):
    features = features_for([(1, 2, "2026-01-01", 10.0), (2, 3, out_day, 10.0)])

    assert features["following_days_matched_minor"] == expected_minor


@pytest.mark.parametrize(
    ("last_day", "expected_censored"), [("2026-01-03", True), ("2026-01-04", False)]
)
def test_right_censoring_uses_dataset_end_and_complete_window(last_day, expected_censored):
    features = features_for([(1, 2, "2026-01-01", 10.0), (3, 4, last_day, 1.0)])

    assert features["temporal_right_censored"] is expected_censored


def test_no_incoming_means_temporal_out_share_is_unavailable():
    features = features_for([(2, 3, "2026-01-01", 10.0)])

    assert features["following_days_available"] is False
    assert features["following_days_out_share"] is None
    assert features["temporal_right_censored"] is False


def test_temporal_features_default_to_three_day_window():
    dataset = validate_dataset(
        make_dataset([(1, 2, "2026-01-01", 10.0), (2, 3, "2026-01-04", 10.0)])
    )

    assert (
        temporal_features(daily_flows(dataset.transactions))[2]["following_days_matched_minor"]
        == 1000
    )
