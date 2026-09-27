# Threads 貼文串研究工具

分析 Threads 貼文串的個人研究工具：依貼文類型決定分析方式，把留言整理成有用的資訊，並累積成可以瀏覽的網頁報告庫。之後會擴充成可以從關鍵字或帳號出發的市調工具。

## 這個資料夾裡有什麼

| 檔案 | 內容 |
| --- | --- |
| `CLAUDE.md` | 給 Claude Code 的專案說明與規則（每次開啟會自動讀取） |
| `docs/PRD.md` | 完整產品需求文件 |
| `docs/DISCUSSION.md` | 需求討論紀錄，說明每個決定的理由 |
| `docs/IMPLEMENTATION_PLAN.md` | 開發步驟與驗收標準 |
| `.claude/commands/` | Claude Code 自訂指令：`/analyze-thread`、`/analyze-account` |
| `profiles/` | 分析模式設定檔（M1 徵集型、M4 品牌回饋型） |
| `schemas/` | 資料格式草稿 |
| `scripts/`、`site/`、`data/` | 之後由 Claude Code 依開發計畫建立內容 |

## 在 VS Code 開始使用

1. 在 VS Code 安裝 **Claude Code** 擴充功能，並用你的 Claude Pro／Max 帳號登入（不需要 API 金鑰）。
2. 用 VS Code **直接開啟 `threads-research` 這個資料夾**（要以它作為根目錄，Claude Code 才會讀到 `CLAUDE.md` 和 `.claude/commands/`）。
3. 開啟 Claude Code 面板，貼上下面的第一段指令。

### 第一段指令（直接複製貼上）

```text
請先完整閱讀 CLAUDE.md、docs/PRD.md、docs/DISCUSSION.md 和 docs/IMPLEMENTATION_PLAN.md。

讀完後：
1. 用 5～8 點向我摘要你對這個專案的理解，特別是已確定的決定。
2. 列出你在開始開發前需要我確認的問題（如果有的話）。
3. 等我確認後，從開發計畫的「步驟 1」開始，一步一步做；每完成一步，對照驗收標準檢查，並向我簡短回報再進行下一步。

請全程使用繁體中文，說明時少用術語。
```

### 之後常用的指令

| 指令 | 用途 |
| --- | --- |
| `/analyze-thread <thread_id>` | 分析一篇貼文串（需要先完成開發計畫步驟 1～4） |
| `/analyze-account <帳號>` | 帳號經營分析（第二階段功能） |

### 查看報告

在這個資料夾執行：

```bash
python -m http.server 8000
```

然後用瀏覽器開啟 `http://localhost:8000/site/`（需要先完成開發計畫步驟 5）。

## 注意事項

- 留言原文（`data/**/snapshots/`）與已排除的留言（`data/**/excluded/`）不會進 Git。
- 報告中含有別人的留言，**不要把網站放到公開網址**。
- Threads 官方 API 實際能取得哪些資料，要到開發計畫步驟 8 實測後才能確定；在那之前先用手動匯入與虛構的範例資料開發。
