from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from numbers import Integral
from pathlib import Path

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Dataset:
    nodes: pd.DataFrame
    edges: pd.DataFrame
    transactions: pd.DataFrame


class DataError(ValueError):
    pass


def _columns(frame: pd.DataFrame, names: list[str], label: str) -> pd.DataFrame:
    missing = set(names) - set(frame.columns)
    if missing:
        raise DataError(f"{label}: missing columns {sorted(missing)}")
    result = frame[names].copy()
    if result.isna().any().any():
        raise DataError(f"{label}: null values are not allowed")
    return result


def _integers(series: pd.Series, label: str, minimum: int = 0) -> pd.Series:
    values = []
    for value in series:
        if isinstance(value, (bool, np.bool_)) or not isinstance(value, Integral):
            raise DataError(f"{label}: expected integers")
        if not minimum <= int(value) <= 2**63 - 1:
            raise DataError(f"{label}: integer out of range")
        values.append(int(value))
    return pd.Series(values, index=series.index, dtype="int64")


def _minor_units(series: pd.Series, label: str) -> pd.Series:
    values = []
    for value in series:
        try:
            amount = Decimal(str(value))
            if not amount.is_finite() or amount <= 0:
                raise DataError(f"{label}: amounts must be finite and positive")
            minor = (amount * 100).to_integral_value()
            if minor <= 0:
                raise DataError(f"{label}: amounts must be at least one minor unit")
            if abs(amount * 100 - minor) > Decimal("0.0001"):
                raise DataError(f"{label}: amounts must have at most two decimal places")
            if minor > 2**53 - 1:
                raise DataError(f"{label}: amount exceeds the JSON safe integer range")
            values.append(int(minor))
        except (InvalidOperation, TypeError, ValueError) as exc:
            if isinstance(exc, DataError):
                raise
            raise DataError(f"{label}: invalid amount") from exc
    if sum(values) > 2**52 - 1:
        raise DataError(f"{label}: aggregate exceeds the supported amount range")
    return pd.Series(values, index=series.index, dtype="int64")


def validate_dataset(dataset: Dataset) -> Dataset:
    nodes = _columns(dataset.nodes, ["gid", "depth", "is_seed"], "nodes")
    edges = _columns(dataset.edges, ["src", "dst", "sum_kzt", "n_tx", "depth"], "edges")
    tx = _columns(dataset.transactions, ["src", "dst", "date", "sum_kzt"], "transactions")
    if nodes.empty:
        raise DataError("nodes: dataset must contain at least one node")
    for frame, names, label in (
        (nodes, ["gid", "depth"], "nodes"),
        (edges, ["src", "dst", "depth", "n_tx"], "edges"),
        (tx, ["src", "dst"], "transactions"),
    ):
        for name in names:
            frame[name] = _integers(frame[name], f"{label}.{name}", int(name == "n_tx"))
    if nodes.gid.duplicated().any():
        raise DataError("nodes: duplicate gid")
    if edges.duplicated(["src", "dst"]).any():
        raise DataError("edges: duplicate directed pair")
    if not nodes.is_seed.map(lambda value: isinstance(value, (bool, np.bool_))).all():
        raise DataError("nodes.is_seed: expected booleans")
    nodes["is_seed"] = nodes.is_seed.astype(bool)
    if not (nodes.is_seed == nodes.depth.eq(0)).all():
        raise DataError("nodes: is_seed must correspond to depth 0")
    if not nodes.depth.between(0, 4).all() or not edges.depth.between(1, 4).all():
        raise DataError("depth: expected nodes 0..4 and edges 1..4")
    ids = set(nodes.gid)
    for frame, label in ((edges, "edges"), (tx, "transactions")):
        if not (set(frame.src) | set(frame.dst)) <= ids:
            raise DataError(f"{label}: unknown endpoint")
        frame["sum_minor"] = _minor_units(frame.sum_kzt, f"{label}.sum_kzt")
        frame["sum_kzt"] = frame.sum_minor / 100
    try:
        dates = pd.to_datetime(tx.date, errors="raise", format="mixed")
        if dates.isna().any() or not dates.eq(dates.dt.normalize()).all():
            raise DataError("transactions.date: expected dates with day precision")
        if dates.dt.tz is not None:
            raise DataError("transactions.date: timezone-aware values are not supported")
        tx["date"] = dates
    except (ValueError, TypeError, AttributeError, OverflowError) as exc:
        if isinstance(exc, DataError):
            raise
        raise DataError("transactions.date: invalid dates") from exc
    aggregate = tx.groupby(["src", "dst"], as_index=False).agg(
        actual_minor=("sum_minor", "sum"), actual_n_tx=("sum_minor", "size")
    )
    comparison = edges.merge(aggregate, on=["src", "dst"], how="outer", indicator=True)
    if not comparison["_merge"].eq("both").all():
        raise DataError("edges and transactions contain different directed pairs")
    if not comparison.sum_minor.eq(comparison.actual_minor).all():
        raise DataError("edges and transactions disagree on amounts")
    if not comparison.n_tx.eq(comparison.actual_n_tx).all():
        raise DataError("edges and transactions disagree on transaction counts")
    return Dataset(
        nodes.sort_values("gid").reset_index(drop=True),
        edges.sort_values(["src", "dst"]).reset_index(drop=True),
        tx.sort_values(["date", "src", "dst", "sum_minor"]).reset_index(drop=True),
    )


def load_dataset(directory: Path) -> Dataset:
    try:
        return validate_dataset(
            Dataset(
                *(
                    pd.read_parquet(directory / f"{name}.parquet")
                    for name in ("nodes", "edges", "transactions")
                )
            )
        )
    except (OSError, ValueError) as exc:
        if isinstance(exc, DataError):
            raise
        raise DataError(f"Cannot load dataset from {directory}: {exc}") from exc
