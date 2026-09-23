import json
from pathlib import Path

import pandas as pd
import pytest

from money_graph.analysis import Config, analyze
from money_graph.cli import main
from money_graph.dataset import Dataset
from money_graph.export import write_outputs


def fixture_dataset(transfers, depths=None, seeds=None, isolates=()):
    tx = pd.DataFrame(transfers, columns=["src", "dst", "date", "sum_kzt"])
    ids = sorted(set(tx.src) | set(tx.dst) | set(isolates))
    seeds = set(seeds or ())
    depths = depths or {}
    nodes = pd.DataFrame(
        {
            "gid": ids,
            "depth": [0 if gid in seeds else depths.get(gid, 1) for gid in ids],
            "is_seed": [gid in seeds for gid in ids],
        }
    )
    edges = tx.groupby(["src", "dst"], as_index=False).agg(
        sum_kzt=("sum_kzt", "sum"), n_tx=("sum_kzt", "size")
    )
    edges["depth"] = 1
    return Dataset(nodes, edges, tx)


def test_boundary_is_uncertain_but_interior_observed_sink_has_more_support():
    dataset = fixture_dataset(
        [(1, 2, "2026-07-01", 100), (1, 3, "2026-07-01", 100)],
        depths={2: 4},
        seeds={1},
        isolates={4},
    )
    nodes = analyze(dataset).nodes.set_index("gid")
    assert nodes.loc[2, "role"] == "terminal"
    assert nodes.loc[2, "role_status"] == "boundary_hypothesis"
    assert nodes.loc[2, "role_score"] <= 0.2 < nodes.loc[3, "role_score"]
    assert "depth_boundary" in nodes.loc[2, "flags"]
    assert "4-го колена" in nodes.loc[2, "evidence"]
    assert nodes.loc[4, "role"] == "peripheral"
    assert nodes.loc[4, "priority_score"] == 0


def test_seed_cannot_be_called_transit_based_on_incomplete_inflow():
    dataset = fixture_dataset([(2, 1, "2026-07-01", 100), (1, 3, "2026-07-02", 100)], seeds={1})
    node = analyze(dataset).nodes.set_index("gid").loc[1]
    assert node.role != "transit"
    assert "seed_inflow_incomplete" in node["flags"]


def test_direction_distinguishes_fan_in_and_fan_out():
    collector = fixture_dataset([(src, 20, "2026-07-01", 100) for src in range(1, 9)])
    distributor = fixture_dataset([(20, dst, "2026-07-01", 100) for dst in range(1, 9)])
    assert analyze(collector).nodes.set_index("gid").loc[20, "role"] == "consolidator"
    assert analyze(distributor).nodes.set_index("gid").loc[20, "role"] == "distributor"


def test_cycles_are_reported_without_claiming_temporal_provenance():
    result = analyze(
        fixture_dataset(
            [
                (1, 2, "2026-07-21", 100),
                (2, 3, "2026-07-13", 100),
                (3, 1, "2026-07-09", 100),
            ]
        )
    )
    assert result.nodes.cycle_component_size.eq(3).all()
    assert result.nodes.following_days_matched_minor.eq(0).all()


def test_reordering_inputs_produces_identical_exports(tmp_path):
    dataset = fixture_dataset(
        [
            (1, 2, "2026-07-01", 100),
            (1, 3, "2026-07-02", 200),
            (2, 3, "2026-07-03", 80),
            (3, 1, "2026-07-04", 50),
            (4, 5, "2026-07-05", 40),
            (3, 4, "2026-07-06", 20),
        ],
        seeds={1},
        isolates={6},
    )
    reordered = Dataset(
        *(
            frame.sample(frac=1, random_state=17).reset_index(drop=True)
            for frame in (dataset.nodes, dataset.edges, dataset.transactions)
        )
    )
    first = write_outputs(analyze(dataset), tmp_path / "first")
    second = write_outputs(analyze(reordered), tmp_path / "second")
    assert first.keys() == second.keys()
    for name in first:
        assert first[name].read_bytes() == second[name].read_bytes(), name


def test_all_json_identifiers_preserve_int64_precision_and_unavailable_is_explicit(tmp_path):
    first, second, third = 100000000000000001, 100000000000000002, 100000000000000003
    dataset = fixture_dataset(
        [(first, second, "2026-07-01", 0.10)], seeds={first}, isolates={third}
    )
    artifacts = write_outputs(analyze(dataset), tmp_path)
    graph = json.loads(artifacts["graph.json"].read_text())
    assert {row["gid"] for row in graph["nodes"]} == {str(first), str(second), str(third)}
    for table in ("nodes", "top_nodes", "daily_flows", "edges", "transactions"):
        for row in graph[table]:
            for key in ("gid", "src", "dst"):
                if key in row:
                    assert isinstance(row[key], str)
    assert graph["transactions"][0]["sum_minor"] == 10
    first_row = next(row for row in graph["nodes"] if row["gid"] == str(first))
    assert first_row["pass_through"] is None
    csv = pd.read_csv(artifacts["nodes_roles.csv"], dtype=str, keep_default_na=False)
    assert csv.loc[csv.gid == str(first), "pass_through"].item() == "unavailable"
    assert not csv.eq("").any().any()


def test_outputs_cover_all_nodes_and_form_a_consistent_partition(tmp_path):
    dataset = fixture_dataset(
        [(1, dst, "2026-07-01", float(dst * 100)) for dst in range(2, 32)],
        seeds={1},
        isolates={99},
    )
    result = analyze(dataset, Config(top_n=20))
    artifacts = write_outputs(result, tmp_path)
    assert len(result.nodes) == 32
    assert result.clusters.n_nodes.sum() == 32
    assert len(result.top_nodes) == 20
    assert result.top_nodes.priority_score.is_monotonic_decreasing
    assert result.top_nodes["rank"].tolist() == list(range(1, 21))
    for name, columns in {
        "nodes_roles.csv": {
            "gid",
            "role",
            "role_score",
            "cluster_id",
            "priority_score",
            "evidence",
        },
        "clusters.csv": {
            "cluster_id",
            "n_nodes",
            "n_seed",
            "sum_kzt_internal",
            "top_gids",
            "hypothesis",
        },
        "top_nodes.csv": {"rank", "gid", "role", "priority_score", "why"},
    }.items():
        frame = pd.read_csv(artifacts[name], keep_default_na=False)
        assert columns <= set(frame.columns)
        assert not frame.eq("").any().any()


def test_edgeless_graph_and_self_loop_are_supported(tmp_path):
    only_isolates = fixture_dataset([], seeds={1}, isolates={1, 2})
    result = analyze(only_isolates)
    assert result.metadata["n_isolated"] == 2
    assert len(result.clusters) == 2
    write_outputs(result, tmp_path / "empty")
    loop = analyze(fixture_dataset([(1, 1, "2026-07-01", 100)], seeds={1}))
    assert loop.nodes.cycle_component_size.item() == 1
    assert loop.metadata["sum_minor"] == 10000


def test_repeated_self_transfers_do_not_create_a_transit_role(tmp_path):
    result = analyze(
        fixture_dataset(
            [
                (2, 2, "2026-07-01", 10),
                (2, 2, "2026-07-02", 10),
            ]
        )
    )
    node = result.nodes.iloc[0]
    assert node.role == "peripheral"
    assert node.in_deg == node.out_deg == 0
    assert node.following_days_matched_minor == 0
    assert node.self_tx == 2
    assert "self_transfers_observed" in node["flags"]
    assert result.metadata["n_isolated"] == 0
    payload = json.loads(write_outputs(result, tmp_path)["graph.json"].read_text())
    assert len(payload["transactions"]) == 2


def test_cli_generates_outputs_and_reports_invalid_input_without_writing(tmp_path, capsys):
    data = tmp_path / "data"
    data.mkdir()
    dataset = fixture_dataset([(1, 2, "2026-07-01", 100)], seeds={1})
    for name, frame in zip(
        ("nodes", "edges", "transactions"),
        (dataset.nodes, dataset.edges, dataset.transactions),
        strict=True,
    ):
        frame.to_parquet(data / f"{name}.parquet", index=False)
    output = tmp_path / "out"
    assert main(["--data", str(data), "--out", str(output)]) == 0
    assert (output / "graph.json").is_file()
    invalid_out = tmp_path / "invalid"
    assert main(["--data", str(data), "--out", str(invalid_out), "--top", "1"]) == 1
    assert not invalid_out.exists()
    assert "at least 20" in capsys.readouterr().err


@pytest.mark.parametrize("config", [{"window_days": 0}, {"resolution": float("nan")}])
def test_invalid_configuration_fails_early(config):
    with pytest.raises(ValueError):
        Config(**config)


def test_missing_files_produce_a_clear_cli_error(tmp_path, capsys):
    assert main(["--data", str(tmp_path / "missing"), "--out", str(tmp_path / "out")]) == 1
    assert "Cannot load dataset" in capsys.readouterr().err
    assert not Path(tmp_path / "out").exists()
