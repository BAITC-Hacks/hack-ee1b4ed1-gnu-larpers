from collections import deque

import pandas as pd


def daily_flows(transactions: pd.DataFrame) -> pd.DataFrame:
    columns = ["gid", "date", "in_minor", "out_minor", "in_tx", "out_tx"]
    transactions = transactions.loc[transactions.src != transactions.dst]
    if transactions.empty:
        return pd.DataFrame(columns=columns)
    incoming = (
        transactions.groupby(["dst", "date"], as_index=False)
        .agg(in_minor=("sum_minor", "sum"), in_tx=("sum_minor", "size"))
        .rename(columns={"dst": "gid"})
    )
    outgoing = (
        transactions.groupby(["src", "date"], as_index=False)
        .agg(out_minor=("sum_minor", "sum"), out_tx=("sum_minor", "size"))
        .rename(columns={"src": "gid"})
    )
    daily = incoming.merge(outgoing, on=["gid", "date"], how="outer").fillna(0)
    daily[["in_minor", "out_minor", "in_tx", "out_tx"]] = daily[
        ["in_minor", "out_minor", "in_tx", "out_tx"]
    ].astype("int64")
    return daily[columns].sort_values(["gid", "date"]).reset_index(drop=True)


def temporal_features(
    daily: pd.DataFrame,
    window_days: int = 3,
    *,
    observation_end: pd.Timestamp | None = None,
) -> dict[int, dict]:
    if not 1 <= window_days <= 30:
        raise ValueError("window_days must be between 1 and 30")
    if daily.empty:
        return {}
    end_date = observation_end if observation_end is not None else daily.date.max()
    result = {}
    for gid, rows in daily.groupby("gid", sort=True):
        lots = deque()
        matched = 0
        for row in rows.itertuples(index=False):
            while lots and (row.date - lots[0][0]).days > window_days:
                lots.popleft()
            remaining = int(row.out_minor)
            while remaining and lots:
                allocated = min(remaining, lots[0][1])
                remaining -= allocated
                matched += allocated
                lots[0][1] -= allocated
                if lots[0][1] == 0:
                    lots.popleft()
            if row.in_minor:
                lots.append([row.date, int(row.in_minor)])
        in_total = int(rows.in_minor.sum())
        out_total = int(rows.out_minor.sum())
        incoming_dates = rows.loc[rows.in_minor > 0, "date"]
        result[int(gid)] = {
            "active_days": len(rows),
            "same_day_activity_days": int(((rows.in_minor > 0) & (rows.out_minor > 0)).sum()),
            "following_days_matched_minor": matched,
            "following_days_out_share": matched / in_total if in_total else None,
            "following_days_available": in_total > 0,
            "temporal_right_censored": bool(
                len(incoming_dates) and (end_date - incoming_dates.max()).days < window_days
            ),
            "max_daily_out_share": int(rows.out_minor.max()) / out_total if out_total else 0.0,
        }
    return result
