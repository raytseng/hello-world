# crypto-alert — 即時加密貨幣警報服務

24 小時盯盤,價格突破/急漲急跌時秒推 Telegram / Discord / LINE。
訂閱制收費(信用卡自動續扣 + 加密貨幣預付),為「一人公司、高度自動化營運」設計。

**零 npm 依賴**——只用 Node.js 22+ 內建的 `WebSocket`、`fetch`、`node:crypto`、`node:http`,沒有供應鏈風險,`git clone` 下來直接跑。

## 即時性設計(本專案的核心競爭力)

行情警報的價值隨延遲衰減,所以每一層都為延遲做了取捨:

| 層 | 選擇 | 為什麼 |
|---|---|---|
| 資料源 | 交易所原生 WebSocket(Binance `@trade` stream) | 逐筆成交推播,延遲數十 ms。**絕不用** CoinGecko 這類聚合 API——它們有 30–60 秒快取,警報等於慢一分鐘 |
| 串流類型 | `@trade` 而非 `@ticker` | `@ticker` 是 1 秒快照;`@trade` 是每筆成交即時推,是公開資料裡最快的 |
| 熱路徑 | 規則評估全部在記憶體 | tick 進來到發出警報之間零 I/O、零資料庫查詢 |
| 備援 | OKX WebSocket 自動 failover | 主源靜默 10 秒強制重連、30 秒切備援,恢復後自動切回;切換時通知管理員 |
| 半開連線 | 靜默偵測 watchdog | TCP 連線「看起來活著但沒資料」是行情串流最常見的坑,用資料靜默時間判斷健康,不信任連線狀態 |
| 推播 | Telegram/Discord 優先 | 兩者 API 延遲約 100–300ms;LINE 稍慢;Email 最慢所以不做 |
| 可量測 | 每則警報標註端到端延遲 | 用交易所事件時間戳算出 `行情延遲 XXms`,直接印在警報裡——讓用戶看見你的快,也讓你監控自己的慢 |
| 部署位置 | 建議 AWS 東京 (ap-northeast-1) | Binance 撮合引擎在東京 AWS,同區部署延遲可壓到毫秒級 |

## 快速開始

```bash
cp rules.example.json rules.json   # 編輯你的警報規則
cp .env.example .env               # 填 Telegram bot token 等
node --env-file=.env src/index.js
```

`rules.json` 支援熱重載——改完存檔即生效,不用重啟。

### 規則類型

```jsonc
{ "symbol": "BTCUSDT", "type": "cross_above", "price": 125000 }   // 向上突破
{ "symbol": "BTCUSDT", "type": "cross_below", "price": 110000 }   // 向下跌破
{ "symbol": "ETHUSDT", "type": "pct_change", "windowMin": 5, "pct": 3 }  // 5 分鐘內漲跌 ≥3%
```

每條規則可加 `cooldownSec`(預設 900)避免警報轟炸。

## 收費(詳見 [docs/PAYMENTS.md](docs/PAYMENTS.md))

模型:**預付天數制**。

- 信用卡(外幣):Stripe Checkout 訂閱,webhook 自動入帳
- 加密貨幣:NOWPayments(USDT 等 300+ 幣),IPN webhook 自動入帳;加密貨幣無法自動續扣,所以賣 30/90/365 天方案,系統在到期前 3 天自動推播提醒續費——警報系統自己就是催繳系統

設 `BILLING_ENABLED=1` + `PORT` 啟用;不設則所有訂閱者視為已付費(開發模式)。

```
POST /webhook/stripe        Stripe 事件(驗 HMAC-SHA256 簽名)
POST /webhook/nowpayments   NOWPayments IPN(驗 HMAC-SHA512 簽名)
GET  /health                feed 健康狀態(接 UptimeRobot 監控)
```

## 架構

```
Binance WS (@trade) ──┐
                      ├─ FeedManager(watchdog/failover)─→ Evaluator(記憶體規則引擎)
OKX WS (備援) ────────┘                                       │
                                                    ┌─────────┴─────────┐
rules.json(熱重載)──→ Store ←── entitlements.json   Telegram  Discord  LINE
                        ↑
Stripe webhook ─────────┤  ← 付款自動入帳(預付天數)
NOWPayments IPN ────────┘
```

## 營運自動化程度

| 環節 | 狀態 |
|---|---|
| 盯盤、發警報 | 全自動 |
| 收款入帳、開通 | 全自動(webhook) |
| 到期提醒 | 全自動 |
| feed 斷線切換 | 全自動 + 管理員通知 |
| 你要做的事 | 看管理員頻道、行銷、決定要不要加新功能 |

## Roadmap

- [ ] 用戶自助儀表板(自己設規則,取代手編 rules.json)
- [ ] 鏈上事件警報:巨鯨轉帳、Gas 費、合約事件(付費意願最高的利基)
- [ ] Telegram bot 指令直接建規則(`/alert BTC > 125000`)
- [ ] 多交易所價差警報(套利訊號)
