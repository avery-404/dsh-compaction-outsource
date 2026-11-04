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

1. In DSH open **Plugins** → **Add plugin** and paste `https://github.com/avery02072003-cmyk/dsh-compaction-outsource`, press **Install**, then **Enable now**.
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
3. Choose the helper in the **Outsourcing** section of [dsh-llm-monitor](https://github.com/avery02072003-cmyk/dsh-llm-monitor), or edit `<dataDir>/config.json`:

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

讓**別的 AI 幫你寫壓縮檢查點**，取代本地模型慢慢壓。可選 agy、DeepSeek、Claude、Codex，各自選模型與思考強度，隨時切換、不用重啟。**預設關閉。**

* **為什麼**：壓縮要讀完整段對話再寫長摘要，本地模型可能要好幾分鐘，外部模型幾秒。壓縮後主模型仍要讀（變短的）檢查點，但最慢的「讀＋摘要」交給別人。
* **檢查點與本地版可互換**：交給外部 AI 的是 DSH 引擎**自己的摘要指令原文**，格式一致；收到後會驗證 8 個章節齊全且順序正確、比原對話短、不像拒絕回答；失敗（沒安裝、沒登入、逾時、被內容審核擋下、格式不對）就**自動改由主模型壓**，不會卡住。思考區塊不外傳，明顯的金鑰會遮蔽。
* **注意**：對話內容會送到你選的外部 AI；私密或敏感的對話請保持「關閉」。外部 AI 的內容審核可能拒絕或刪減內容（拒絕會被偵測並改用本地，默默刪減偵測不到）。使用審核版本地模型時，請自行判斷其輸出能否依第三方服務條款送出。每個選項都有成本：agy 有額度、DeepSeek 扣餘額、Claude／Codex 計入訂閱用量。用量（次數與大約 token，不含內容）記在 `usage.jsonl`。
* **安裝**：DSH「插件」→「添加插件」→ 貼上 `https://github.com/avery02072003-cmyk/dsh-compaction-outsource` →「安装」→「立即启用」；再依上方英文說明，在壓縮列設定 `summarizationProvider: outsource`、`summarizationModel: auto`，並把 `fallbackProvider` / `fallbackModel` 設成你平常用的模型。用 [dsh-llm-monitor](https://github.com/avery02072003-cmyk/dsh-llm-monitor) 的「外包」區塊切換。
* **Claude 登入**：單獨執行的 Claude Code 需要先登入一次：`claude auth login`（桌面 app 的登入不會共用）。
* **Codex**：模型選單有 `gpt-6-luna`（最省，官方文件說適合摘要）、`gpt-6.1-terra`、`gpt-6.1-sol`、`gpt-6-astra`，留空用 Codex 預設；強度 low / medium / high / xhigh。需先 `codex login`。
* **測試狀況**：agy、DeepSeek 路徑已測；Claude 需先登入；Codex 只用替身程式驗證過指令列，未在真實 Codex 上跑過。
