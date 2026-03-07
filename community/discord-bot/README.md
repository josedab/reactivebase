# ReactiveBase Discord Bot

> **Status: Planned** — This bot is not yet implemented. The module contains the FAQ index and architecture design for future development.

Community support bot for the ReactiveBase Discord server.

## Planned Features

- **FAQ matching** — search docs and answer common questions automatically
- **Slash commands** — `/docs <topic>`, `/example <name>`, `/status`
- **Issue triage** — link Discord reports to GitHub issues

## Contributing

Want to help build this? See the [contributing guide](../../CONTRIBUTING.md) or open an issue.

The `src/faq-bot.ts` file contains the FAQ index structure that will power the bot's search functionality. The implementation will use [discord.js](https://discord.js.org/) when built.

## Architecture

```
src/
  faq-bot.ts    # FAQ index and search logic (implemented)
  bot.ts        # Discord.js client (not yet implemented)
  commands.ts   # Slash command handlers (not yet implemented)
```
