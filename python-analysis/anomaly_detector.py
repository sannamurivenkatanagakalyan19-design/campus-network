#!/usr/bin/env python3
"""Flag unusually frequent synthetic campus logins exported by the Java service."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


DEFAULT_INPUT = Path(__file__).resolve().parents[1] / "data" / "login_frequency.csv"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data" / "anomaly_results.csv"
FIXED_LOGIN_THRESHOLD = 12
Z_SCORE_THRESHOLD = 2.5
OUTPUT_COLUMNS = [
    "user_id",
    "role",
    "login_count",
    "average_login_count",
    "z_score",
    "anomaly_reason",
    "risk_level",
]


def detect_anomalies(input_path: Path, output_path: Path) -> pd.DataFrame:
    """Analyze counts within each campus role, then save only flagged accounts."""
    logins = pd.read_csv(input_path)
    required = {"user_id", "role", "login_count"}
    missing = required.difference(logins.columns)
    if missing:
        raise ValueError(f"Input is missing required columns: {', '.join(sorted(missing))}")

    logins = logins[["user_id", "role", "login_count"]].copy()
    logins["login_count"] = pd.to_numeric(logins["login_count"], errors="raise")
    if logins.empty:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        pd.DataFrame(columns=OUTPUT_COLUMNS).to_csv(output_path, index=False)
        return pd.DataFrame(columns=OUTPUT_COLUMNS)

    # Compare students with students and staff with staff; this avoids mixing
    # populations with different expected login frequencies.
    grouped = logins.groupby("role")["login_count"]
    logins["average_login_count"] = grouped.transform("mean")
    # Population standard deviation describes the complete synthetic roster.
    # Replace a zero spread with NaN so a constant group gets a neutral z-score.
    standard_deviation = grouped.transform(lambda counts: counts.std(ddof=0)).replace(0, np.nan)
    # A z-score counts standard deviations above that role's mean.
    # It is neutral when every account in the role has the same count.
    logins["z_score"] = ((logins["login_count"] - logins["average_login_count"]) / standard_deviation).fillna(0.0)

    logins["z_flag"] = logins["z_score"] > Z_SCORE_THRESHOLD
    logins["threshold_flag"] = logins["login_count"] > FIXED_LOGIN_THRESHOLD
    flagged = logins[logins["z_flag"] | logins["threshold_flag"]].copy()

    reasons: list[str] = []
    risks: list[str] = []
    for row in flagged.itertuples(index=False):
        parts = []
        if row.z_flag:
            parts.append(f"z-score {row.z_score:.2f} exceeds {Z_SCORE_THRESHOLD}")
        if row.threshold_flag:
            parts.append(f"login count {int(row.login_count)} exceeds fixed threshold {FIXED_LOGIN_THRESHOLD}")
        reasons.append("; ".join(parts))
        risks.append("Critical" if row.z_score > 4.0 or row.login_count > FIXED_LOGIN_THRESHOLD * 2 else "High")

    flagged["anomaly_reason"] = reasons
    flagged["risk_level"] = risks
    result = flagged[OUTPUT_COLUMNS].sort_values(["risk_level", "z_score", "login_count"], ascending=[True, False, False])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(output_path, index=False, float_format="%.4f")
    print(f"Analyzed {len(logins)} accounts; flagged {len(result)}. Results: {output_path}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Java-exported login-frequency CSV")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Destination anomaly-results CSV")
    args = parser.parse_args()
    detect_anomalies(args.input, args.output)


if __name__ == "__main__":
    main()
