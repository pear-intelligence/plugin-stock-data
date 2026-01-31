/**
 * Stock Data Plugin
 * Live stock quotes, ETF data, company profiles, candles, and market news via Finnhub.
 */

import type { PluginContext, PluginRegistrations } from "./types"
import { Elysia } from "elysia"

const BASE = "https://finnhub.io/api/v1"

interface FinnhubQuote {
  c: number  // current
  d: number  // change
  dp: number // percent change
  h: number  // high
  l: number  // low
  o: number  // open
  pc: number // previous close
  t: number  // timestamp
}

interface FinnhubProfile {
  country: string
  currency: string
  exchange: string
  finnhubIndustry: string
  ipo: string
  logo: string
  marketCapitalization: number
  name: string
  phone: string
  shareOutstanding: number
  ticker: string
  weburl: string
}

interface FinnhubSearchResult {
  count: number
  result: Array<{
    description: string
    displaySymbol: string
    symbol: string
    type: string
  }>
}

interface FinnhubCandles {
  c: number[] // close
  h: number[] // high
  l: number[] // low
  o: number[] // open
  s: string   // status
  t: number[] // timestamps
  v: number[] // volume
}

interface FinnhubNewsItem {
  category: string
  datetime: number
  headline: string
  id: number
  image: string
  related: string
  source: string
  summary: string
  url: string
}

// Simple in-memory cache to respect rate limits
const cache = new Map<string, { data: unknown; expiry: number }>()
const CACHE_TTL_MS = 15_000 // 15 seconds

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiry) {
    cache.delete(key)
    return null
  }
  return entry.data as T
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS })
}

async function finnhub<T>(path: string, apiKey: string, params: Record<string, string> = {}): Promise<T> {
  const cacheKey = `${path}?${JSON.stringify(params)}`
  const cached = getCached<T>(cacheKey)
  if (cached) return cached

  const url = new URL(`${BASE}${path}`)
  url.searchParams.set("token", apiKey)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }

  const res = await fetch(url.toString())
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Finnhub ${res.status}: ${text}`)
  }

  const data = (await res.json()) as T
  setCache(cacheKey, data)
  return data
}

function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  return n.toLocaleString()
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }], isError: false }
}

function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true }
}

export async function activate(ctx: PluginContext): Promise<PluginRegistrations> {
  ctx.log.info("Activating stock-data plugin")

  function getKey(): string {
    const key = ctx.getSetting<string>("finnhubApiKey")
    if (!key) throw new Error("Finnhub API key not configured. Set it in plugin settings.")
    return key
  }

  return {
    routes: () =>
      new Elysia()
        .get("/quote/:symbol", async ({ params }) => {
          try {
            const quote = await finnhub<FinnhubQuote>("/quote", getKey(), { symbol: params.symbol.toUpperCase() })
            return { symbol: params.symbol.toUpperCase(), ...quote }
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) }
          }
        })
        .get("/search/:query", async ({ params }) => {
          try {
            const results = await finnhub<FinnhubSearchResult>("/search", getKey(), { q: params.query })
            return results
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) }
          }
        }),

    tools: [
      // ── Quote ──
      {
        definition: {
          name: "stock_quote",
          description: "Get a real-time stock or ETF quote. Returns current price, change, high, low, open, and previous close.",
          inputSchema: {
            type: "object" as const,
            properties: {
              symbol: {
                type: "string",
                description: "Ticker symbol (e.g. AAPL, TSLA, SPY, QQQ, VOO)",
              },
            },
            required: ["symbol"],
          },
        },
        handler: async (args) => {
          try {
            const symbol = (args.symbol as string).toUpperCase()
            const quote = await finnhub<FinnhubQuote>("/quote", getKey(), { symbol })

            if (!quote.c && !quote.o) {
              return err(`No data found for symbol "${symbol}". Check the ticker and try again.`)
            }

            const direction = quote.d >= 0 ? "+" : ""
            const lines = [
              `${symbol}: $${formatCurrency(quote.c)}`,
              `Change: ${direction}$${formatCurrency(quote.d)} (${direction}${quote.dp.toFixed(2)}%)`,
              `Open: $${formatCurrency(quote.o)}  |  Prev Close: $${formatCurrency(quote.pc)}`,
              `High: $${formatCurrency(quote.h)}  |  Low: $${formatCurrency(quote.l)}`,
            ]
            return ok(lines.join("\n"))
          } catch (e) {
            return err(e instanceof Error ? e.message : String(e))
          }
        },
      },

      // ── Multi-Quote ──
      {
        definition: {
          name: "stock_quotes",
          description: "Get real-time quotes for multiple symbols at once. Useful for comparing stocks or checking a portfolio.",
          inputSchema: {
            type: "object" as const,
            properties: {
              symbols: {
                type: "array",
                items: { type: "string" },
                description: "Array of ticker symbols (e.g. [\"AAPL\", \"GOOGL\", \"SPY\"])",
              },
            },
            required: ["symbols"],
          },
        },
        handler: async (args) => {
          try {
            const symbols = (args.symbols as string[]).map((s) => s.toUpperCase())
            const results = await Promise.all(
              symbols.map(async (symbol) => {
                try {
                  const q = await finnhub<FinnhubQuote>("/quote", getKey(), { symbol })
                  if (!q.c && !q.o) return `${symbol}: No data`
                  const dir = q.d >= 0 ? "+" : ""
                  return `${symbol}: $${formatCurrency(q.c)} (${dir}${q.dp.toFixed(2)}%)`
                } catch {
                  return `${symbol}: Error fetching`
                }
              })
            )
            return ok(results.join("\n"))
          } catch (e) {
            return err(e instanceof Error ? e.message : String(e))
          }
        },
      },

      // ── Symbol Search ──
      {
        definition: {
          name: "stock_search",
          description: "Search for stock/ETF ticker symbols by company name or keyword. Use this when you don't know the exact ticker.",
          inputSchema: {
            type: "object" as const,
            properties: {
              query: {
                type: "string",
                description: "Company name or keyword to search (e.g. 'Apple', 'electric vehicle', 'semiconductor')",
              },
            },
            required: ["query"],
          },
        },
        handler: async (args) => {
          try {
            const query = args.query as string
            const results = await finnhub<FinnhubSearchResult>("/search", getKey(), { q: query })

            if (!results.result || results.result.length === 0) {
              return err(`No results for "${query}".`)
            }

            // Filter to common stock types and limit
            const filtered = results.result
              .filter((r) => ["Common Stock", "ETP", "ETF", "REIT", "ADR"].includes(r.type) || !r.type)
              .slice(0, 10)

            if (filtered.length === 0) {
              return ok(`Found results but none were common stocks/ETFs. Raw results:\n${results.result.slice(0, 5).map((r) => `${r.symbol} - ${r.description} (${r.type})`).join("\n")}`)
            }

            const lines = filtered.map((r) => `${r.symbol} - ${r.description}${r.type ? ` (${r.type})` : ""}`)
            return ok(`Search results for "${query}":\n${lines.join("\n")}`)
          } catch (e) {
            return err(e instanceof Error ? e.message : String(e))
          }
        },
      },

      // ── Company Profile ──
      {
        definition: {
          name: "stock_company_profile",
          description: "Get company profile including market cap, industry, IPO date, website, and share count.",
          inputSchema: {
            type: "object" as const,
            properties: {
              symbol: {
                type: "string",
                description: "Ticker symbol (e.g. AAPL)",
              },
            },
            required: ["symbol"],
          },
        },
        handler: async (args) => {
          try {
            const symbol = (args.symbol as string).toUpperCase()
            const profile = await finnhub<FinnhubProfile>("/stock/profile2", getKey(), { symbol })

            if (!profile.name) {
              return err(`No company profile found for "${symbol}".`)
            }

            const lines = [
              `${profile.name} (${profile.ticker})`,
              `Industry: ${profile.finnhubIndustry || "N/A"}`,
              `Exchange: ${profile.exchange || "N/A"}`,
              `Market Cap: $${formatLargeNumber(profile.marketCapitalization * 1e6)}`,
              `Shares Outstanding: ${formatLargeNumber(profile.shareOutstanding * 1e6)}`,
              `IPO Date: ${profile.ipo || "N/A"}`,
              `Country: ${profile.country || "N/A"}`,
              `Currency: ${profile.currency || "N/A"}`,
              `Website: ${profile.weburl || "N/A"}`,
            ]
            return ok(lines.join("\n"))
          } catch (e) {
            return err(e instanceof Error ? e.message : String(e))
          }
        },
      },

      // ── Historical Candles ──
      {
        definition: {
          name: "stock_candles",
          description: "Get historical OHLCV (open/high/low/close/volume) candle data for a stock or ETF. Useful for trend analysis.",
          inputSchema: {
            type: "object" as const,
            properties: {
              symbol: {
                type: "string",
                description: "Ticker symbol (e.g. AAPL)",
              },
              resolution: {
                type: "string",
                description: "Candle resolution: 1, 5, 15, 30, 60 (minutes), D (day), W (week), M (month)",
                enum: ["1", "5", "15", "30", "60", "D", "W", "M"],
              },
              days: {
                type: "number",
                description: "Number of days of historical data to fetch (default: 30, max: 365)",
              },
            },
            required: ["symbol"],
          },
        },
        handler: async (args) => {
          try {
            const symbol = (args.symbol as string).toUpperCase()
            const resolution = (args.resolution as string) || "D"
            const days = Math.min(Math.max((args.days as number) || 30, 1), 365)

            const to = Math.floor(Date.now() / 1000)
            const from = to - days * 86400

            const candles = await finnhub<FinnhubCandles>("/stock/candle", getKey(), {
              symbol,
              resolution,
              from: String(from),
              to: String(to),
            })

            if (candles.s !== "ok" || !candles.c || candles.c.length === 0) {
              return err(`No candle data for "${symbol}" with resolution ${resolution} over ${days} days.`)
            }

            const count = candles.c.length
            const latest = candles.c[count - 1]
            const earliest = candles.c[0]
            const periodReturn = ((latest - earliest) / earliest) * 100
            const high = Math.max(...candles.h)
            const low = Math.min(...candles.l)
            const avgVolume = candles.v.reduce((a, b) => a + b, 0) / count

            const lines = [
              `${symbol} — ${count} candles (${resolution} resolution, ${days} days)`,
              ``,
              `Latest Close: $${formatCurrency(latest)}`,
              `Period Start: $${formatCurrency(earliest)}`,
              `Period Return: ${periodReturn >= 0 ? "+" : ""}${periodReturn.toFixed(2)}%`,
              `Period High: $${formatCurrency(high)}`,
              `Period Low: $${formatCurrency(low)}`,
              `Avg Volume: ${formatLargeNumber(Math.round(avgVolume))}`,
            ]

            // Add last 5 data points
            const tail = Math.min(5, count)
            lines.push(``, `Last ${tail} data points:`)
            for (let i = count - tail; i < count; i++) {
              const date = new Date(candles.t[i] * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              lines.push(`  ${date}: O $${formatCurrency(candles.o[i])} H $${formatCurrency(candles.h[i])} L $${formatCurrency(candles.l[i])} C $${formatCurrency(candles.c[i])} V ${formatLargeNumber(candles.v[i])}`)
            }

            return ok(lines.join("\n"))
          } catch (e) {
            return err(e instanceof Error ? e.message : String(e))
          }
        },
      },

      // ── Market News ──
      {
        definition: {
          name: "stock_news",
          description: "Get latest market news or company-specific news. Useful for understanding price movements and sentiment.",
          inputSchema: {
            type: "object" as const,
            properties: {
              symbol: {
                type: "string",
                description: "Ticker symbol for company-specific news. Omit for general market news.",
              },
              limit: {
                type: "number",
                description: "Number of articles to return (default: 5, max: 20)",
              },
            },
          },
        },
        handler: async (args) => {
          try {
            const symbol = args.symbol ? (args.symbol as string).toUpperCase() : null
            const limit = Math.min(Math.max((args.limit as number) || 5, 1), 20)

            let news: FinnhubNewsItem[]

            if (symbol) {
              const to = new Date().toISOString().split("T")[0]
              const fromDate = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]
              news = await finnhub<FinnhubNewsItem[]>("/company-news", getKey(), {
                symbol,
                from: fromDate,
                to,
              })
            } else {
              news = await finnhub<FinnhubNewsItem[]>("/news", getKey(), { category: "general" })
            }

            if (!news || news.length === 0) {
              return ok(symbol ? `No recent news for ${symbol}.` : "No market news available.")
            }

            const articles = news.slice(0, limit)
            const lines = [symbol ? `News for ${symbol}:` : "Market News:"]

            for (const article of articles) {
              const date = new Date(article.datetime * 1000).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
              lines.push(``)
              lines.push(`[${date}] ${article.headline}`)
              if (article.summary) {
                const summary = article.summary.length > 200
                  ? article.summary.slice(0, 200) + "..."
                  : article.summary
                lines.push(`  ${summary}`)
              }
              lines.push(`  Source: ${article.source} | ${article.url}`)
            }

            return ok(lines.join("\n"))
          } catch (e) {
            return err(e instanceof Error ? e.message : String(e))
          }
        },
      },

      // ── Peers / Related Stocks ──
      {
        definition: {
          name: "stock_peers",
          description: "Get peer companies (similar stocks in the same industry). Useful for comparison analysis.",
          inputSchema: {
            type: "object" as const,
            properties: {
              symbol: {
                type: "string",
                description: "Ticker symbol (e.g. AAPL)",
              },
            },
            required: ["symbol"],
          },
        },
        handler: async (args) => {
          try {
            const symbol = (args.symbol as string).toUpperCase()
            const peers = await finnhub<string[]>("/stock/peers", getKey(), {
              symbol,
              grouping: "industry",
            })

            if (!peers || peers.length === 0) {
              return err(`No peers found for "${symbol}".`)
            }

            // Get quotes for the first 8 peers
            const topPeers = peers.filter((p) => p !== symbol).slice(0, 8)
            const quotes = await Promise.all(
              topPeers.map(async (peer) => {
                try {
                  const q = await finnhub<FinnhubQuote>("/quote", getKey(), { symbol: peer })
                  if (!q.c) return `${peer}: No data`
                  const dir = q.d >= 0 ? "+" : ""
                  return `${peer}: $${formatCurrency(q.c)} (${dir}${q.dp.toFixed(2)}%)`
                } catch {
                  return `${peer}: Error`
                }
              })
            )

            return ok(`Peers of ${symbol}:\n${quotes.join("\n")}`)
          } catch (e) {
            return err(e instanceof Error ? e.message : String(e))
          }
        },
      },

      // ── Basic Financials ──
      {
        definition: {
          name: "stock_metrics",
          description: "Get key financial metrics: P/E ratio, EPS, 52-week high/low, beta, dividend yield, and more.",
          inputSchema: {
            type: "object" as const,
            properties: {
              symbol: {
                type: "string",
                description: "Ticker symbol (e.g. AAPL)",
              },
            },
            required: ["symbol"],
          },
        },
        handler: async (args) => {
          try {
            const symbol = (args.symbol as string).toUpperCase()
            const data = await finnhub<{ metric: Record<string, number | null> }>(
              "/stock/metric",
              getKey(),
              { symbol, metric: "all" }
            )

            const m = data.metric
            if (!m || Object.keys(m).length === 0) {
              return err(`No metrics found for "${symbol}".`)
            }

            const fmt = (v: number | null | undefined, prefix = "", suffix = "") =>
              v != null ? `${prefix}${typeof v === "number" ? formatCurrency(v) : v}${suffix}` : "N/A"

            const lines = [
              `Key Metrics for ${symbol}:`,
              ``,
              `52-Week High: ${fmt(m["52WeekHigh"], "$")}`,
              `52-Week Low: ${fmt(m["52WeekLow"], "$")}`,
              `52-Week Return: ${fmt(m["52WeekPriceReturnDaily"], "", "%")}`,
              ``,
              `P/E (TTM): ${m["peTTM"] != null ? m["peTTM"].toFixed(2) : "N/A"}`,
              `P/B (Quarterly): ${m["pbQuarterly"] != null ? m["pbQuarterly"].toFixed(2) : "N/A"}`,
              `EPS (TTM): ${fmt(m["epsTTM"], "$")}`,
              ``,
              `Beta: ${m["beta"] != null ? m["beta"].toFixed(3) : "N/A"}`,
              `Dividend Yield: ${m["dividendYieldIndicatedAnnual"] != null ? (m["dividendYieldIndicatedAnnual"]).toFixed(2) + "%" : "N/A"}`,
              `Dividend Per Share: ${fmt(m["dividendPerShareAnnual"], "$")}`,
              ``,
              `Market Cap: ${m["marketCapitalization"] != null ? "$" + formatLargeNumber(m["marketCapitalization"] * 1e6) : "N/A"}`,
              `Revenue (TTM): ${m["revenueTTM"] != null ? "$" + formatLargeNumber(m["revenueTTM"] * 1e6) : "N/A"}`,
              `Net Income (TTM): ${m["netIncomeTTM"] != null ? "$" + formatLargeNumber(m["netIncomeTTM"] * 1e6) : "N/A"}`,
              `ROE (TTM): ${m["roeTTM"] != null ? m["roeTTM"].toFixed(2) + "%" : "N/A"}`,
            ]

            return ok(lines.join("\n"))
          } catch (e) {
            return err(e instanceof Error ? e.message : String(e))
          }
        },
      },
    ],
  }
}

export function deactivate(): void {
  cache.clear()
}
