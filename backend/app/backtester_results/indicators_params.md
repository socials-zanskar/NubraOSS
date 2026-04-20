

# 📊 Indicator Definitions (LLM-Ready)

## 🧱 Common Base

All indicators support:

```md
offset: int (default: 0, range: 0–500)
```

---

## 1. PRICE

```md
type: PRICE

params:
  source: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"] (default: "close")
  offset: int
```

---

## 2. VOLUME

```md
type: VOLUME

params:
  offset: int
```

---

## 3. RSI (Relative Strength Index)

```md
type: RSI

params:
  length: int (default: 14, range: 2–500)
  source: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"] (default: "close")
  offset: int
```

👉 RSI is a momentum oscillator (0–100) used for overbought/oversold detection ([Groww][1])

---

## 4. SMA (Simple Moving Average)

```md
type: SMA

params:
  source: ["open","high","low","close","hl2","hlc3","ohlc4","volume"] (default: "close")
  period: int (default: 9, range: 1–500)
  offset: int
```

---

## 5. EMA (Exponential Moving Average)

```md
type: EMA

params:
  source: ["open","high","low","close","hl2","hlc3","ohlc4","volume"] (default: "close")
  period: int (default: 9, range: 1–500)
  offset: int
```

---

## 6. WMA (Weighted Moving Average)

```md
type: WMA

params:
  source: ["open","high","low","close","hl2","hlc3","ohlc4","volume"] (default: "close")
  period: int (default: 9, range: 1–500)
  offset: int
```

---

## 7. VWAP (Volume Weighted Average Price)

```md
type: VWAP

params:
  source: ["open","high","low","close","hl2","hlc3","ohlc4"] (default: "hlc3")
  anchor: ["session", "week", "month"] (default: "session")
  offset: int
```

👉 VWAP is a volume-based indicator combining price + volume ([LuxAlgo][2])

---

## 8. BB (Bollinger Bands)

```md
type: BB

params:
  source: ["open","high","low","close","hl2","hlc3","ohlc4","volume"] (default: "close")
  length: int (default: 20, range: 2–500)
  std_dev_up: float (default: 2.0, range: 0.1–10.0)
  std_dev_down: float (default: 2.0, range: 0.1–10.0)
  ma_type: ["SMA","EMA","WMA","DEMA","TEMA","TRIMA","KAMA","MAMA","T3"] (default: "SMA")
  output: ["upper_band","middle_band","lower_band"] (default: "middle_band")
  offset: int
```

👉 Uses moving average + standard deviation bands ([insights.exness.com][3])

---

## 9. PSAR (Parabolic SAR)

```md
type: PSAR

params:
  start: float (default: 0.02, range: 0–1.5)
  increment: float (default: 0.02, range: 0–1.0)
  max_value: float (default: 0.2, range: 0–5.0)
  offset: int
```

---

## 10. MACD (Moving Average Convergence Divergence)

```md
type: MACD

params:
  source: ["open","high","low","close","hl2","hlc3","ohlc4"] (default: "close")
  fast_length: int (default: 12, range: 2–500)
  slow_length: int (default: 26, range: 3–500)
  signal_length: int (default: 9, range: 1–500)
  output: ["macd_line","signal_line","histogram"] (default: "macd_line")
  offset: int
```

👉 MACD compares moving averages to detect momentum shifts ([Groww][1])

---

## 11. STOCH (Stochastic Oscillator)

```md
type: STOCH

params:
  k_length: int (default: 14, range: 1–500)
  smooth_k: int (default: 3, range: 1–200)
  d_length: int (default: 3, range: 1–200)
  k_ma_type: ["SMA","EMA","WMA","DEMA","TEMA","TRIMA","KAMA","MAMA","T3"] (default: "SMA")
  d_ma_type: ["SMA","EMA","WMA","DEMA","TEMA","TRIMA","KAMA","MAMA","T3"] (default: "SMA")
  output: ["k_line","d_line"] (default: "k_line")
  offset: int
```

---

## 12. CCI (Commodity Channel Index)

```md
type: CCI

params:
  length: int (default: 20, range: 2–500)
  source: "hlc3" (fixed)
  offset: int
```

---

## 13. ADX (Average Directional Index)

```md
type: ADX

params:
  length: int (default: 14, range: 2–500)
  output: ["adx_value","plus_di","minus_di"] (default: "adx_value")
  offset: int
```

---

## 14. ATR (Average True Range)

```md
type: ATR

params:
  length: int (default: 14, range: 1–500)
  offset: int
```

👉 Measures volatility in price movement ([LiteFinance][4])

---

## 15. OBV (On-Balance Volume)

```md
type: OBV

params:
  offset: int
```

👉 Volume-based indicator showing buying/selling pressure ([Wikipedia][5])

---

# 🧠 Notes for LLM Usage

### Indicator Categories (important for reasoning)

```md
Trend: SMA, EMA, WMA, MACD, ADX
Momentum: RSI, STOCH, CCI
Volatility: BB, ATR
Volume: OBV, VWAP
Price-based: PRICE
```

### Output Types (multi-line indicators)

```md
BB → upper_band | middle_band | lower_band
MACD → macd_line | signal_line | histogram
STOCH → k_line | d_line
ADX → adx_value | plus_di | minus_di
```