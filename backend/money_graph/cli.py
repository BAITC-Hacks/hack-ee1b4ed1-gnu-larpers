import argparse
import sys
from pathlib import Path

from money_graph.analysis import Config, analyze
from money_graph.dataset import DataError, load_dataset
from money_graph.export import write_outputs


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Explainable analysis of a bank transfer graph")
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--out", type=Path, default=Path("out"))
    parser.add_argument("--top", type=int, default=50)
    parser.add_argument("--window-days", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--resolution", type=float, default=1.0)
    args = parser.parse_args(argv)
    try:
        config = Config(args.top, args.window_days, args.seed, args.resolution)
        analysis = analyze(load_dataset(args.data), config)
        paths = write_outputs(analysis, args.out)
    except (DataError, ValueError, OSError) as exc:
        print(f"Analysis failed: {exc}", file=sys.stderr)
        return 1
    metadata = analysis.metadata
    print(
        f"Analyzed {metadata['n_nodes']} nodes, {metadata['n_edges']} edges, "
        f"{metadata['n_transactions']} transactions."
    )
    print(
        f"Preserved {metadata['n_isolated']} isolated nodes; "
        f"flagged {metadata['n_boundary']} depth-boundary nodes."
    )
    print(f"Produced {metadata['n_clusters']} clusters and {len(analysis.top_nodes)} ranked nodes.")
    for name, path in paths.items():
        print(f"{name}: {path.resolve()}")
    return 0
