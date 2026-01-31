# Stock Data Plugin

A [Pear Intelligence](https://github.com/pear-intelligence/pear-intelligence) plugin that provides real-time stock and ETF market data via the [Finnhub API](https://finnhub.io/).

## Features

- **Real-time quotes** — Current price, change, high/low, open/close
- **Multi-quote** — Fetch multiple symbols at once for portfolio views
- **Symbol search** — Find tickers by company name or keyword
- **Company profiles** — Market cap, industry, IPO date, website
- **Historical candles** — OHLCV data with configurable resolution and range
- **Market news** — General or company-specific news articles
- **Peer comparison** — Related companies with live quotes
- **Financial metrics** — P/E, EPS, 52-week range, beta, dividend yield, ROE

## Installation

Install from the Pear Intelligence marketplace in the iOS app, or via the API:

```bash
curl -X POST http://localhost:3000/plugins/marketplace/install \
  -H "Content-Type: application/json" \
  -d '{"name": "stock-data", "repoUrl": "https://github.com/pear-intelligence/plugin-stock-data"}'
```

## Setup

1. Sign up for a free API key at [finnhub.io](https://finnhub.io/register) (60 requests/min)
2. Open the Pear Intelligence app → Settings → Plugins → Stock Data
3. Enter your Finnhub API key and save

## MCP Tools

| Tool | Description |
|------|-------------|
| `stock_quote` | Real-time quote for a single symbol |
| `stock_quotes` | Quotes for multiple symbols at once |
| `stock_search` | Search for tickers by name or keyword |
| `stock_company_profile` | Company info, market cap, industry |
| `stock_candles` | Historical OHLCV candle data |
| `stock_news` | Market or company-specific news |
| `stock_peers` | Related companies with quotes |
| `stock_metrics` | Key financial metrics (P/E, EPS, beta, etc.) |

## HTTP Routes

When enabled, the plugin also exposes REST endpoints under `/px/stock-data/`:

- `GET /px/stock-data/quote/:symbol` — JSON quote for a symbol
- `GET /px/stock-data/search/:query` — Symbol search results

## Rate Limiting

The plugin includes a 15-second in-memory cache to stay within Finnhub's free tier limit of 60 API calls per minute.

## Development

This plugin follows the [Pear Intelligence plugin spec](https://github.com/pear-intelligence/pear-intelligence/blob/master/plugins/EXTENSION.md). The entry point is `index.ts` with `activate()` and `deactivate()` exports.

## License

MIT
