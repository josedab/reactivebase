# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ReactiveBase, please report it responsibly:

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Email security@reactivebase.dev with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
3. You will receive a response within 48 hours
4. A fix will be released as soon as possible

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ Current |

## Security Best Practices

When using ReactiveBase in production:

- Always set `NODE_ENV=production`
- Use strong, unique `JWT_SECRET` values
- Enable HTTPS/WSS via a reverse proxy
- Set appropriate rate limits
- Review RLS policies and access rules
- Keep dependencies updated
- Use `DATABASE_URL` with SSL (`?sslmode=require`)
