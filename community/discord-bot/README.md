# ReactiveBase Discord Bot

FAQ answering, issue triage, and community metrics for the ReactiveBase Discord server.

## Features

- **FAQ matching** — searches docs and answers common questions automatically
- **Issue triage** — links Discord reports to GitHub issues with labels
- **Community metrics** — tracks active members, questions answered, response time
- **Slash commands** — `/docs <topic>`, `/example <name>`, `/status`

## Setup

```bash
cd community/discord-bot
npm install
cp .env.example .env
# Add DISCORD_BOT_TOKEN and DISCORD_GUILD_ID
npm run dev
```

## Commands

| Command | Description |
|---------|-------------|
| `/docs <query>` | Search docs and return relevant page |
| `/example <name>` | Link to an example app |
| `/status` | Show ReactiveBase server status |
| `/report <description>` | Create a GitHub issue from Discord |

## Environment Variables

```
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_GUILD_ID=your-server-id
GITHUB_TOKEN=optional-for-issue-creation
```
