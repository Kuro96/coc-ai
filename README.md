# coc-ai

This project is a fork of [vim-ai](https://github.com/madox2/vim-ai) by [madox2](https://github.com/madox2).
I would like to express my gratitude to the original author for their work.

## Changes in This Fork

- Replaced Python code with TypeScript.
- Integrated with [coc.nvim](https://github.com/neoclide/coc.nvim) for async AI features.

## Install

This project uses `yarn` for package management during development.

1. Ensure your vim is newer than 9 and node is newer than 18: `node --version`,
hint for miserable CentOS users: [Node.js unofficial-builds project](https://github.com/nodejs/unofficial-builds?tab=readme-ov-file#local-installation)
2. Install `coc.nvim`. Checkout
 [Install coc.nvim](https://github.com/neoclide/coc.nvim/wiki/Install-coc.nvim)
 for more infomation.
3. Use command `:CocInstall https://github.com/Kuro96/coc-ai` in your vim

## Configurations

### Role Options

See `roles-example.toml`.
Make a copy of your own and specify path to it with `coc-ai.global.rolesConfigPath`.

Available Options, all options are optional:

```toml
[<your role name>]
prompt = "<extra prompt which will be add to user prompt>"

[<your role name>.options]
model = "<model name>"
endpointUrl = "<protocol>://<hostname>/v1/chat/completions"
requiresAuth = true # <true/false>
authProvider = "api-key" # "api-key" or "openai-codex"
tokenPath = "<path to your token file>"
oauthTokenPath = "~/.opencode/auth/openai.json" # for authProvider = "openai-codex"; falls back to ~/.local/share/opencode/auth.json, then ~/.codex/auth.json when unset/default path is missing
proxy = "<protocol>://<ip>:<port>"
maxTokens = 4096  # <max token num>
temperature = 0.6  # <temperature>
thinking = { type = "enabled" } # OpenAI-compatible thinking switch: "enabled" or "disabled"
reasoningEffort = "high" # sent as reasoning_effort; native values are preserved unless a provider needs compatibility mapping
initialPrompt = "<overrides `initialPrompt` in coc-settings>"

[<your role name>.options-chat]
# same as options, overrides for `AIChat` command

[<your role name>.options-complete]
# same as options, overrides for `AI` command

[<your role name>.options-edit]
# same as options, overrides for `AIEdit` command
```

### Chat Options

Same as role options, but **ONLY** available with `AIChat` command.

Put it on top of ai chat window, or simply modify after one conversation
with `coc-ai.chat.populatesOptions` set to `true`.

### Coc options

`coc-settings.json`, see [docs](https://github.com/neoclide/coc.nvim/wiki/Using-the-configuration-file)
of `coc.nvim` for more info. You can edit it by command `:CocConfig`.

- `coc-ai.tab.enabled`: boolean (default: `false`). Enable/disable AI tab completion.
- `coc-ai.chat.autoTitle`: boolean (default: `true`). Automatically title the chat buffer after the first exchange.
- `coc-ai.*.thinking`: object (example: `{ "type": "enabled" }`). OpenAI-compatible thinking mode switch for providers that support it; omitted for OpenAI GPT requests.
- `coc-ai.*.reasoningEffort`: string (example: `"minimal"`, `"low"`, `"high"`, or `"xhigh"`). Sent as OpenAI-compatible `reasoning_effort`; provider compatibility maps unsupported aliases when needed.
- `coc-ai.*.authProvider`: string (`"api-key"` or `"openai-codex"`). `"openai-codex"` reuses an OpenCode/Codex OAuth token to access ChatGPT Plus/Pro subscription models through the Codex backend.
- `coc-ai.*.oauthTokenPath`: string (default: `"~/.opencode/auth/openai.json"`). Token file created by OpenCode Codex auth plugins; when the default path is missing, coc-ai falls back to modern OpenCode auth at `"~/.local/share/opencode/auth.json"`, then the official Codex CLI cache at `"~/.codex/auth.json"`.
  See `roles-example.toml` for GPT 5.5 / 5.4 mini presets that also demonstrate `proxy`.

For ChatGPT Plus/Pro subscription access, sign in once with OpenCode/Codex first so an OAuth cache exists, then run `:AIConfig` and choose **Provider/model wizard** -> **ChatGPT Plus/Pro (Codex OAuth)** to select the concrete model for `global`, `chat`, `edit`, `complete`, or `tab`. Supported file caches are OpenCode plugin auth at `~/.opencode/auth/openai.json`, modern OpenCode auth at `~/.local/share/opencode/auth.json`, and official Codex CLI auth at `~/.codex/auth.json`.

`:AIConfig` is a small configuration center inspired by OpenCode's discoverable config workflow, adapted to coc.nvim's Vim UI constraints. Coc does not provide a full multi-pane settings TUI inside Vim, so coc-ai keeps common changes in menu/input prompts and sends complex edits back to normal files:

- **Provider/model wizard**: configure ChatGPT Plus/Pro OAuth, OpenAI-compatible API keys, or just the model for `global`, `chat`, `edit`, `complete`, or `tab`.
- **Edit one common setting**: update frequently changed values such as model, endpoint, proxy, token paths, reasoning effort, chat UI behavior, and tab completion without remembering JSON keys.
- **Set roles config path**: change `coc-ai.global.rolesConfigPath` interactively.
- **Open roles TOML**: open the roles file in Vim, creating a starter file if it does not exist.
- **Open coc-settings.json**: jump to `:CocConfig` for advanced or bulk edits.

The `/chatgpt-plan` role is intentionally only an auth/backend mixin for ChatGPT subscription plans. It does not pick a model by itself; configure `coc-ai.*.model` with `:AIConfig`, `:CocConfig`, or another role, then use `/chatgpt-plan` when you want that request to go through the Codex OAuth backend.

Also you can refer to my example below:

```json
{
  "coc-ai.global.model": "deepseek-v4-pro",
  "coc-ai.global.endpointUrl": "https://api.deepseek.com/v1/chat/completions",
  "coc-ai.global.thinking": { "type": "enabled" },
  "coc-ai.global.reasoningEffort": "high",
  "coc-ai.global.requiresAuth": true,
  "coc-ai.global.tokenPath": "~/.vim/token",
  "coc-ai.global.rolesConfigPath": "~/.vim/vimrc.d/coc-ai-roles.toml",
  "coc-ai.chat.autoScroll": true,
  "coc-ai.chat.scratchBufferKeepOpen": false,
  "coc-ai.chat.populatesOptions": true,
  "coc-ai.chat.preserveFocus": true,
  "coc-ai.chat.openChatCommand": "preset_right",
  "coc-ai.chat.autoTitle": true,
  "coc-ai.tab.enabled": true
}
```

### Priority

role options > chat options > Coc options

## Usage

1. AIChat: `:[%]['<,'>]AIC[hat] [/<role>] [<prompt>]`
2. AIEdit: `:[%]['<,'>]AIE[dit] [/<role>] [<prompt>]`
3. AIComplete: `:[%]['<,'>]AI [/<role>] [<prompt>]`
4. AIStop: `:AIS[top]`
5. AIBack(resume hidden chat window if `scratchBufferKeepOpen` set to `true`): `:AIB[ack]`
6. AIConfig: `:AIConfig` opens the interactive configuration center for provider/model/auth setup, common settings, roles TOML, and `coc-settings.json`.

NOTE:

- any characters inside `[]` is optional
- `:%` equal to `:1,$`, checkout `:help :%`, as well as `:help '<` `:help '>`
- `/role` **MUST** precede `prompt`
- `/role` can be specified multiple times, and the latter configuration will
 override the former.

### Examples

```viml
:AIC hello world
:AIC /v4pro who are you?
:%AIC /gpt55 /explain 用中文回答
:%AIC /gpt54mini /explain 用中文回答
:AIConfig
:AIC /chatgpt-plan implement this with my configured ChatGPT subscription model
```

## TODOs

- [x] Proxy for api request
- [x] Option for chat whether keep track with cursor
- [x] Implement ai complete
- [x] Implement ai edit
- [x] Support `CocInstall`
- [x] README
- [x] Auto attach with `.aichat` files
- [x] Implemented AI tab completion
- [x] Added optional auto-titling for AIChat.


## License

MIT

---

> This extension is built with [create-coc-extension](https://github.com/fannheyward/create-coc-extension)
