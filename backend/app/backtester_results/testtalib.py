from nubra_python_sdk.marketdata.market_data import MarketData
from nubra_python_sdk.start_sdk import InitNubraSdk, NubraEnv

from nubra_talib import to_ohlcv_df, to_ist, add_talib, add_basics
import pandas as pd
import pandas_ta as ta

def main():
    # Initialize the Nubra SDK client
    # Use NubraEnv.UAT for testing or NubraEnv.PROD for production
    nubra = InitNubraSdk(NubraEnv.PROD)

    # Initialize MarketData with the client
    md_instance = MarketData(nubra)

    result = md_instance.historical_data({
        "exchange": "NSE",
        "type": "STOCK",
        "values": ["HDFCBANK", "TMPV"],
        "fields": ["close", "high", "low", "open", "cumulative_volume"],
        "startDate": "2025-02-01T11:01:57.000Z",
        "endDate": "2026-03-31T06:13:57.000Z",
        "interval": "1d",
        "intraDay": False,
        "realTime": False,
    })

    # By default, datetime is converted to IST and prices to rupees
    df = to_ohlcv_df(result, symbol="HDFCBANK", interval="1d")
    # df["rsi"] = ta.rsi(df["close"], length=14)
    # df.to_csv(
    # "output.csv",
    # index=True,
    # encoding="utf-8",
    # sep=","
    # )
    df = add_talib(
        df,
        funcs={
            "RSI": {"timeperiod": 14},
            "EMA": {"timeperiod": 21},
            "CCI": {"timeperiod": 14},
            # "MACD": {"fastperiod": 12, "slowperiod": 26, "signalperiod": 9},
        },
    )

    # df = add_basics(df)

    # print(df.tail())
    df.to_csv(
    "output_small.csv",
    index=True,
    encoding="utf-8",
    sep=","
    )

if __name__ == "__main__":
    main()