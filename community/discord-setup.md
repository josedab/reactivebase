# ReactiveBase Discord Server Configuration

## Channel Structure

```
📢 INFORMATION
  #announcements     — Release notes, blog posts, events (read-only)
  #rules             — Community guidelines + Code of Conduct link

💬 COMMUNITY
  #general           — General discussion about ReactiveBase
  #showcase          — Share what you've built with ReactiveBase
  #introductions     — New members introduce themselves

🛠️ HELP
  #help              — Get help with ReactiveBase
  #bugs              — Report and discuss bugs
  #feature-requests  — Suggest new features

👨‍💻 DEVELOPMENT
  #contributing      — Discussion for contributors
  #pull-requests     — PR notifications (bot)
  #releases          — Release notifications (bot)

🏢 ECOSYSTEM
  #plugins           — Plugin development and sharing
  #integrations      — Third-party integrations (Clerk, Stripe, etc.)
```

## Roles

| Role | Color | Description |
|------|-------|-------------|
| `@Maintainer` | Red | Core team |
| `@Contributor` | Green | Merged PR |
| `@Community` | Blue | Active community member |

## Bot: GitHub Webhook
- Channel: `#pull-requests` and `#releases`
- Events: Pull requests, releases, issues

## Server Settings
- Verification level: Low (verified email)
- Default notification: Mentions only
