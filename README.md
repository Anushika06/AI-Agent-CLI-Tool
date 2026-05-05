# 🌐 AI Agent CLI Tool — Website Cloner

A conversational CLI agent built with **Node.js** and **Google Gemini AI** that scrapes any website URL and autonomously generates a visually faithful HTML clone — complete with Header, Hero Section, and Footer — saved as a single self-contained `.html` file that auto-opens in your browser.

---

## 🧠 How It Works

The agent follows a strict multi-step reasoning loop:

```
START → THINK → TOOL → OBSERVE → THINK → TOOL → OBSERVE → ... → OUTPUT
```

At each step, Gemini returns a structured JSON object:

```json
{
  "step": "THINK | TOOL | OBSERVE | OUTPUT",
  "content": "Agent's reasoning or message",
  "tool_name": "scrapeWebsite",
  "tool_args": { "url": "https://www.scaler.com/" }
}
```

The agent never rushes — it reasons through multiple THINK steps before calling any tool, re-reads the file it generates, and only outputs once it is satisfied with the result.

---

## 📁 Project Structure

```
AI-Agent-CLI-Tool/
├── index.js        ← Entry point: CLI interface + agent loop
├── tools.js        ← Tool implementations (scrape, write, read, open)
├── prompt.js       ← System prompt defining the agent's behavior
├── package.json    ← Dependencies and project config
├── .env            ← Your Gemini API key (never committed)
├── .gitignore      ← Excludes node_modules and .env
└── README.md       ← This file
```

---

## ⚙️ Setup & Installation

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd AI-Agent-CLI-Tool
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure your API key

Open the `.env` file and replace the placeholder with your real key:

```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
```

> 🔑 Get a free API key at [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)

---

## 🚀 Running the Agent

```bash
node index.js
```

You'll see:

```
╔══════════════════════════════════════════════════════════════╗
║          🌐  Website Cloner Agent  —  Powered by Gemini       ║
╚══════════════════════════════════════════════════════════════╝

Type a URL or instruction to begin. Examples:
  • https://www.scaler.com/
  • clone https://www.stripe.com/
  • exit  (to quit)

You ▶
```

### Example usage

```
You ▶  https://www.scaler.com/
```

The agent will then:
1. **[THINKING]** — Plan the scraping strategy
2. **[TOOL CALL]** — `scrapeWebsite("https://www.scaler.com/")`
3. **[OBSERVING]** — Analyze nav links, hero text, colors, footer
4. **[THINKING]** — Design the full HTML structure
5. **[TOOL CALL]** — `writeFile("scaler_clone.html", "<html>...")`
6. **[TOOL CALL]** — `readFile("scaler_clone.html")` to verify
7. **[TOOL CALL]** — `openInBrowser("scaler_clone.html")` — auto-opens!
8. **[OUTPUT]** — Summary of what was created

---

## 🛠️ Available Tools

| Tool | Description |
|------|-------------|
| `scrapeWebsite(url)` | Fetches the page and returns a structured summary of nav, hero, colors, and footer |
| `writeFile(filename, content)` | Saves the generated HTML clone to disk |
| `readFile(filename)` | Reads back the file to verify completeness |
| `openInBrowser(filename)` | Opens the HTML file in your default browser |

---

## 📦 Dependencies

| Package | Purpose |
|---------|---------|
| `@google/generative-ai` | Gemini SDK for AI completions |
| `axios` | HTTP client for website scraping |
| `cheerio` | Server-side HTML parsing (like jQuery) |
| `dotenv` | Loads `.env` variables into `process.env` |

---

## 🔒 Security Notes

- Your `GEMINI_API_KEY` is **never hardcoded** — it lives only in `.env`
- `.env` is listed in `.gitignore` and will never be committed
- The scraper uses a realistic browser `User-Agent` header to avoid bot-blocking
- If scraping fails, the agent gracefully falls back to knowledge-based generation

---

## 💡 Tips

- Works with most public websites (Scaler, Stripe, Notion, GitHub, etc.)
- If a site blocks scraping, the agent still generates a knowledge-based clone
- Generated files are named after the domain (e.g. `scaler_clone.html`)
- Type `exit` or `quit` to stop the CLI

---

## 📄 License

ISC
