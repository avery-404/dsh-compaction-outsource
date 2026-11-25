# dsh-compaction-outsource

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) that lets **another AI write your compaction checkpoint** instead of a slow local model. Pick agy, DeepSeek, Claude or Codex, and the model and effort for each; switch it at any time without a restart. **Off by default.**

English | [繁體中文](#繁體中文)

> Unofficial community plugin. Not affiliated with or endorsed by DeepSeek.

## Why

Compaction makes the model read the whole conversation and write a long summary. On a local model that can take minutes. An outside model does the same job in seconds. After compaction the main model still has to read the (now short) checkpoint at its own speed, but the slow part, reading and summarizing, is done elsewhere.

## What it does

* Registers one extra model route named `outsource` (never shown in the model menu).
* You point a compaction row at it. Every compaction, automatic or manual, then reads the **live choice** and dispatches:

| Choice | How the checkpoint is written | Cost |
|---|---|---|
| off (default) | your normal model, through `fallbackProvider` / `fallbackModel` | none extra |
| DeepSeek | DSH's own DeepSeek route (`deepseek-account` / `deepseek-flash` by default) | your DeepSeek balance |
| agy | `helper/outsource_cli.py` runs `agy_ask.py` | free, with a daily quota |
| Claude | Claude Code, `-p` mode (finds `claude` on PATH or the Claude desktop app's bundled copy) | your Claude plan usage |
| Codex | `codex exec` (read-only sandbox, empty temp folder, no session files kept; finds `codex` on PATH or the VS Code / Cursor ChatGPT extension's bundled copy) | your ChatGPT / Codex quota |

Model and effort are chosen per tool: DeepSeek `off / low / high / max`, Claude `low … max`, Codex `low / medium / high / xhigh`; agy's strength is part of its model name. The first entry (cheapest) is the default. Codex model names offered in the menu (from OpenAI's docs): `gpt-6-luna` (most efficient, meant for summarization-type work), `gpt-6.1-terra`, `gpt-6.1-sol`, `gpt-6-astra`; leave it empty to use Codex's own default. `minimal`, `max` and `ultra` are not offered because support depends on the model.

### The checkpoint stays interchangeable with a local one

* The outside AI is given **DSH's own summarization directive** (the engine's final message), not a paraphrase, so the required layout is identical.
* Before it is accepted the result is checked: every required `## ` section is present and in order, it is shorter than the conversation, and it does not read like a refusal. Chatty prefaces and code fences are stripped.
* If anything fails (not installed, not signed in, timeout, content refused, bad layout) **the main model writes the checkpoint instead**, so compaction never gets stuck. The outcome is saved to `last_compaction.json` and shown in the monitor tab.
* Reasoning blocks are never sent, and obvious credentials (`sk-…`, `Bearer …`, `api_key=…`) are masked.

### Things to know

* The conversation text leaves your machine for whichever AI you choose. Keep the setting **off** for private or sensitive sessions. Content filters of the outside AI may refuse or thin out some content (a refusal is detected and falls back; silent omissions are not). If you run an uncensored local model, think about whether its output may be sent to a third-party service under that service's terms.
* Every option costs something: agy has a quota, DeepSeek spends balance, Claude and Codex spend your plan. Usage (calls and rough tokens, never content) is logged to `usage.jsonl`.

## Install

1. In DSH open **Plugins** → **Add plugin** and paste `https://github.com/avery-404/dsh-compaction-outsource`, press **Install**, then **Enable now**.
2. Point your compaction row at the route and name your main model as the fallback. In the profile's `cordis.patch.yml`:

   ```yaml
   # the plugin row (the installer adds it; set the fallback = your normal model)
   - id: compaction-outsource
     name: dsh-compaction-outsource
     config:
       fallbackProvider: qwen38          # your normal model's provider
       fallbackModel: your-model-id      # ... and its model id
       # dataDir: ~/.dsh/outsource       # config.json / usage.jsonl / last_compaction.json
       # python: python                  # needed only for agy / Claude / Codex
   ```

   and on the compaction row of the agent preset you use:

   ```yaml
   - id: compaction-basic
     name: '@deepseek-ai/dsh-compaction-basic'
     config:
       summarizationProvider: outsource
       summarizationModel: auto
   ```

   (With the "off" choice nothing leaves your machine and the main model writes the checkpoint exactly as before.)
3. Choose the helper in the **Outsourcing** section of [dsh-llm-monitor](https://github.com/avery-404/dsh-llm-monitor), or edit `<dataDir>/config.json`:

   ```json
   { "backend": "agy", "models": { "agy": "gemini-3.8-flash-high" }, "efforts": {} }
   ```

### Codex sign-in

Run `codex login` once (or set up the API key the way Codex documents). The Codex path was written from OpenAI's documentation and checked against a stand-in executable only; it has not been run against a real Codex install.

### Claude sign-in

Claude Code run on its own needs a one-time sign-in: `claude auth login` (use the full path to the bundled copy if `claude` is not on PATH). The desktop app's own session is not shared.

## Requirements

DSH 0.2.x, Node ≥ 22.14 (bundled with DSH). Python 3 only for agy / Claude / Codex. Tested on Windows 11 with DSH `0.2.1-rc.5`; agy and DeepSeek paths tested, Claude path needs the sign-in above, Codex path is untested against a real install.

## License

MIT

---

## 繁體中文

這是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的插件，讓**別的 AI 幫你寫壓縮檢查點**，取代本地模型慢慢壓。可選 agy、DeepSeek、Claude、Codex，各自選模型與思考強度，隨時切換、不用重啟。**預設關閉。**

> 非官方社群插件，與 DeepSeek 無關聯，也未獲其背書。

### 為什麼需要

壓縮時模型要讀完整段對話，再寫出很長的摘要；本地模型可能要花好幾分鐘，外部模型只要幾秒。壓縮後主模型仍要用自己的速度讀（已變短的）檢查點，但最慢的「讀整段對話＋寫摘要」交給了別人。

### 它做什麼

* 註冊一條名為 `outsource` 的額外模型路由（不會出現在模型選單裡）。
* 你把壓縮列指向這條路由後，每次壓縮（自動或手動）都會讀取**即時選擇**並分派：

| 選擇 | 檢查點由誰寫 | 成本 |
|---|---|---|
| 關閉（預設） | 你平常的模型，透過 `fallbackProvider` / `fallbackModel` | 無額外成本 |
| DeepSeek | DSH 自己的 DeepSeek 路由（預設 `deepseek-account` / `deepseek-flash`） | 扣你的 DeepSeek 餘額 |
| agy | `helper/outsource_cli.py` 呼叫 `agy_ask.py` | 免費，有每日額度 |
| Claude | Claude Code 的 `-p` 模式（自動找 PATH 上的 `claude`，或 Claude 桌面 app 內建的那份） | 計入 Claude 方案用量 |
| Codex | `codex exec`（唯讀沙盒、空的暫存資料夾、不留工作階段檔；自動找 PATH 上的 `codex`，或 VS Code／Cursor 的 ChatGPT 擴充內建的那份） | 計入 ChatGPT／Codex 額度 |

模型與強度依工具分別選擇：DeepSeek 為 `off / low / high / max`，Claude 為 `low … max`，Codex 為 `low / medium / high / xhigh`；agy 的強度包含在模型名稱裡。每個清單的第一項（最省）即預設值。Codex 選單提供的模型名稱取自 OpenAI 文件：`gpt-6-luna`（最省，適合摘要類工作）、`gpt-6.1-terra`、`gpt-6.1-sol`、`gpt-6-astra`；留空則用 Codex 自己的預設。`minimal`、`max`、`ultra` 因為是否支援取決於模型，所以不提供。

### 檢查點與本地版可以互換

* 交給外部 AI 的是 **DSH 引擎自己的摘要指令原文**（引擎送出的最後一則訊息），不是改寫過的版本，所以要求的格式完全相同。
* 收到結果後會先驗證才採用：每個必要的 `## ` 章節都在且順序正確、比原對話短、讀起來不像拒絕回答。多餘的開場白與程式碼圍欄會被去掉。
* 任何一步失敗（沒安裝、沒登入、逾時、內容被拒絕、格式不對）都**改由主模型來寫檢查點**，壓縮不會卡住。結果記在 `last_compaction.json`，並顯示在監控分頁。
* 思考區塊絕不外傳，明顯的金鑰（`sk-…`、`Bearer …`、`api_key=…`）會被遮蔽。

### 注意事項

* 對話內容會離開你的電腦，送到你選的那個 AI。私密或敏感的對話請保持「**關閉**」。外部 AI 的內容審核可能拒絕或刪減部分內容（拒絕會被偵測並自動改用本地；默默刪減則偵測不到）。若你用的是未審核（abliterated）的本地模型，請自行判斷它的輸出能否依第三方服務的條款送出。
* 每個選項都有成本：agy 有額度、DeepSeek 扣餘額、Claude 與 Codex 計入你的訂閱方案。用量（呼叫次數與大約 token 數，絕不含內容）記錄在 `usage.jsonl`。

### 安裝

1. 在 DSH 開啟**插件** →**添加插件**，貼上 `https://github.com/avery-404/dsh-compaction-outsource`，按**安装**，再按**立即启用**。
2. 把壓縮列指向這條路由，並把你的主模型設為備援。在 profile 的 `cordis.patch.yml`：

   ```yaml
   # 插件那一列（安裝器會加上；把備援設成你平常用的模型）
   - id: compaction-outsource
     name: dsh-compaction-outsource
     config:
       fallbackProvider: qwen38          # 你平常模型的 provider
       fallbackModel: your-model-id      # ……與它的 model id
       # dataDir: ~/.dsh/outsource       # config.json / usage.jsonl / last_compaction.json 放的位置
       # python: python                  # 只有 agy / Claude / Codex 需要
   ```

   然後在你使用的 agent 預設的壓縮列加上：

   ```yaml
   - id: compaction-basic
     name: '@deepseek-ai/dsh-compaction-basic'
     config:
       summarizationProvider: outsource
       summarizationModel: auto
   ```

   （選「關閉」時沒有任何東西離開你的電腦，檢查點跟原本一樣由主模型寫。）
3. 到 [dsh-llm-monitor](https://github.com/avery-404/dsh-llm-monitor) 的**外包（Outsourcing）**區塊選擇要用的 AI，或直接編輯 `<dataDir>/config.json`：

   ```json
   { "backend": "agy", "models": { "agy": "gemini-3.8-flash-high" }, "efforts": {} }
   ```

#### Codex 登入

先執行一次 `codex login`（或依 Codex 文件設定 API 金鑰）。Codex 這條路徑是依 OpenAI 文件寫的，只用替身執行檔驗證過指令列，**尚未在真實的 Codex 安裝上跑過**。

#### Claude 登入

單獨執行的 Claude Code 需要一次性登入：`claude auth login`（若 `claude` 不在 PATH，請用內建那份的完整路徑）。桌面 app 本身的登入狀態不會共用。

### 需求

DSH 0.2.x、Node ≥ 22.14（DSH 已內建）。只有 agy／Claude／Codex 需要 Python 3。在 Windows 11、DSH `0.2.1-rc.5` 上測試；agy 與 DeepSeek 路徑已測，Claude 路徑需先完成上述登入，Codex 路徑尚未在真實安裝上測試。

### 授權

MIT
