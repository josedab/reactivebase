# ReactiveBase Discord — Rules & Welcome

## Welcome Message (auto-sent on join)

```
Welcome to the ReactiveBase community! 👋

⚡ **ReactiveBase** — Convex DX on Postgres. MIT license.

**Quick links:**
📖 Docs: https://reactivebase.dev
🎮 Playground: https://reactivebase.dev/play
💻 GitHub: https://github.com/reactivebase/reactivebase

**Get started:**
• Introduce yourself in #introductions
• Ask questions in #help
• Show what you've built in #showcase

**Contribute:**
• Read CONTRIBUTING.md on GitHub
• Check issues labeled "good first issue"
• Discuss in #contributing
```

## Rules (#rules channel)

```
📜 Community Rules

1. Be respectful and inclusive
2. No spam or self-promotion (outside #showcase)
3. Search before asking — check docs and existing threads
4. Use code blocks for code snippets
5. Report bugs on GitHub Issues, not Discord
6. Follow our Code of Conduct: https://github.com/reactivebase/reactivebase/blob/main/CODE_OF_CONDUCT.md

Violations → warning → mute → ban
```

## GitHub Webhook Setup

1. Go to Discord channel settings → Integrations → Webhooks
2. Create webhook for `#pull-requests` channel
3. Copy webhook URL
4. Go to GitHub repo → Settings → Webhooks → Add webhook
5. Payload URL: (paste Discord webhook URL + `/github`)
6. Content type: `application/json`
7. Events: Pull requests, Releases, Issues
