from __future__ import annotations

import argparse
import json

from .engine import NubraIndicatorEngine


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Fetch Nubra OHLCV data and calculate backtest-ready indicators with warmup handling."
    )
    parser.add_argument("--symbol", required=True, help="Instrument symbol, for example ASHOKLEY.")
    parser.add_argument("--from", dest="start", required=True, help="Start date or datetime.")
    parser.add_argument("--to", dest="end", required=True, help="End date or datetime.")
    parser.add_argument("--interval", default="1d", help="Nubra candle interval, for example 1d or 3m.")
    parser.add_argument("--exchange", default="NSE")
    parser.add_argument("--instrument-type", default="STOCK")
    parser.add_argument("--env", default="PROD", choices=["UAT", "PROD"])
    parser.add_argument(
        "--indicator",
        action="append",
        required=True,
        help='Indicator JSON, for example {"type":"RSI","params":{"length":14},"name":"rsi14"}.',
    )
    parser.add_argument("--totp-login", action="store_true")
    parser.set_defaults(env_creds=True)
    parser.add_argument("--no-env-creds", dest="env_creds", action="store_false")
    parser.add_argument("--output-csv", help="Optional CSV path for the final trimmed output.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    indicators = [json.loads(item) for item in args.indicator]
    engine = NubraIndicatorEngine.from_sdk(
        env=args.env,
        totp_login=args.totp_login,
        env_creds=args.env_creds,
    )
    result = engine.calculate(
        symbol=args.symbol,
        start=args.start,
        end=args.end,
        indicators=indicators,
        exchange=args.exchange,
        instrument_type=args.instrument_type,
        interval=args.interval,
    )

    if args.output_csv:
        result.data.to_csv(args.output_csv, index=False)

    print(
        json.dumps(
            {
                "fetched_start": result.fetched_start.isoformat(),
                "fetched_end": result.fetched_end.isoformat(),
                "warmup_bars_required": result.warmup_bars_required,
                "warmup_rows_available": result.warmup_rows_available,
                "fetch_attempts": result.fetch_attempts,
            },
            indent=2,
        )
    )
    print(result.data.to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
