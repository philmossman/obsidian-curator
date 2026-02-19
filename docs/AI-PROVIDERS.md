# AI Providers

obsidian-curator supports several AI providers for the `process` and `file` commands. All other features work without AI.

---

## Which features need AI?

| Feature | Without AI | With AI |
|---------|-----------|---------|
| `capture` | ✓ Full support | ✓ |
| `process` | ✗ No-op (skipped) | ✓ Adds tags, summary, folder suggestion |
| `file` | ✗ Cannot route | ✓ Moves notes to correct folders |
| `audit` | ✓ Full support | ✓ |
| `tidy` (dupes/structure) | ✓ Full support | ✓ |
| `tidy` (stubs, ambiguous) | ⚠ Flags for manual review | ✓ Auto-triages |
| `tasks` / `task` / `done` | ✓ Full support | ✓ |

---

## Provider: `none` (rule-based only)

No API key, no cost, no privacy concerns.

The `process` and `file` commands will be skipped. Everything else works.

```json
{
  "ai": {
    "provider": "none"
  }
}
```

**Use this if:**
- You want to use the task system and vault tools without AI enrichment
- You don't have an AI provider yet
- You're testing or scripting without live AI calls

---

## Provider: `ollama` (local, free)

Run large language models locally. No API key, no cloud, no cost. Requires [Ollama](https://ollama.com) installed.

### Install Ollama

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Start the server
ollama serve
```

### Pull a model

```bash
ollama pull llama3.2        # 3B — fast, good for most tasks
ollama pull llama3.1:8b     # 8B — better quality, needs ~8GB RAM
ollama pull mistral         # 7B — good balance
```

### Configure

```json
{
  "ai": {
    "provider": "ollama",
    "model": "llama3.2",
    "baseUrl": "http://localhost:11434"
  }
}
```

The `baseUrl` defaults to `http://localhost:11434` if not specified.

### Via CLI

```bash
obsidian-curator config set ai.provider ollama
obsidian-curator config set ai.model llama3.2
```

**Cost:** Free  
**Privacy:** Fully local — nothing leaves your machine  
**Quality:** Good for tagging and filing; complex notes may need a larger model  
**Speed:** Depends on your hardware — fast on Apple Silicon, slower on CPU-only

---

## Provider: `openai`

Uses the OpenAI API. Also works with any OpenAI-compatible endpoint (OpenRouter, LM Studio, etc.).

### Get an API key

1. Go to [platform.openai.com](https://platform.openai.com)
2. Create an API key
3. Set a spending limit (recommended)

### Configure

```json
{
  "ai": {
    "provider": "openai",
    "apiKey": "sk-...",
    "model": "gpt-4o-mini"
  }
}
```

### Via CLI

```bash
obsidian-curator config set ai.provider openai
obsidian-curator config set ai.apiKey sk-...
obsidian-curator config set ai.model gpt-4o-mini
```

### Models

| Model | Cost (input) | Quality | Notes |
|-------|-------------|---------|-------|
| `gpt-4o-mini` | ~$0.15/1M tokens | ★★★★ | **Default — best value** |
| `gpt-4o` | ~$2.50/1M tokens | ★★★★★ | Highest quality |
| `gpt-3.5-turbo` | ~$0.50/1M tokens | ★★★ | Cheaper but older |

**Cost estimate per operation:**
- `process` one note: ~500–1000 tokens = **~$0.0001–0.0002** with `gpt-4o-mini`
- `file` one note: ~300–500 tokens = **~$0.00005–0.0001**

A vault with 100 notes costs roughly **$0.01–0.02** to fully process and file.

---

## Provider: `anthropic`

Uses the Anthropic Claude API.

### Get an API key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key

### Configure

```json
{
  "ai": {
    "provider": "anthropic",
    "apiKey": "sk-ant-...",
    "model": "claude-haiku-4-5"
  }
}
```

### Via CLI

```bash
obsidian-curator config set ai.provider anthropic
obsidian-curator config set ai.apiKey sk-ant-...
obsidian-curator config set ai.model claude-haiku-4-5
```

### Models

| Model | Cost (input) | Quality | Notes |
|-------|-------------|---------|-------|
| `claude-haiku-4-5` | ~$0.25/1M tokens | ★★★★ | **Default — fast and cheap** |
| `claude-sonnet-4-5` | ~$3/1M tokens | ★★★★★ | Higher quality |

**Cost estimate per operation:**
- `process` one note: ~500–1000 tokens = **~$0.0002–0.0003** with Haiku
- 100 notes: roughly **$0.02–0.03**

---

## Provider: `custom` (any OpenAI-compatible endpoint)

Works with any API that speaks the OpenAI chat completions format.

### OpenRouter

[OpenRouter](https://openrouter.ai) gives you access to many models from a single API key:

```json
{
  "ai": {
    "provider": "openai",
    "apiKey": "sk-or-...",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-3-haiku"
  }
}
```

Popular OpenRouter models for obsidian-curator:
- `anthropic/claude-3-haiku` — cheap, fast
- `mistralai/mistral-7b-instruct` — cheap, open
- `google/gemini-flash-1.5` — cheap, capable

### LM Studio

[LM Studio](https://lmstudio.ai) lets you run models locally with an OpenAI-compatible server:

1. Download and open LM Studio
2. Download a model (e.g. `Meta Llama 3.2 3B`)
3. Start the local server (default: port 1234)

```json
{
  "ai": {
    "provider": "custom",
    "baseUrl": "http://localhost:1234/v1",
    "model": "local-model",
    "apiKey": "not-needed"
  }
}
```

### Any OpenAI-compatible server

```json
{
  "ai": {
    "provider": "custom",
    "baseUrl": "https://your-server.example.com/v1",
    "apiKey": "your-key",
    "model": "your-model-name"
  }
}
```

---

## Setting the API key securely

Instead of putting your API key directly in the config file, you can use an environment variable:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

obsidian-curator checks these environment variables as a fallback when `apiKey` is not set in config.

For persistent use, add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.).

---

## Choosing a provider

| If you want... | Use |
|---------------|-----|
| Zero cost, full privacy | `ollama` with a local model |
| Best quality | `openai` with `gpt-4o` |
| Best value (cloud) | `openai` with `gpt-4o-mini` |
| Anthropic Claude | `anthropic` with `claude-haiku-4-5` |
| Access to many models | `openai` with OpenRouter base URL |
| No AI at all | `none` |

---

## Testing your AI setup

```bash
# The init wizard tests the connection:
obsidian-curator init

# Or run process with a dry-run after capturing a test note:
obsidian-curator capture "Test note for AI provider setup"
obsidian-curator process --limit 1 --dry-run
```
