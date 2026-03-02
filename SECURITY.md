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

### PGP Key for Encrypted Reports

For sensitive disclosures, you may encrypt your report using our PGP key:

- **Key ID:** `0xREACTIVEBASE`
- **Fingerprint:** Available upon request at security@reactivebase.dev
- **Public key:** Published at [keys.openpgp.org](https://keys.openpgp.org) (search for security@reactivebase.dev)

## Bug Bounty

We appreciate responsible disclosure and are committed to recognizing security researchers:

- **Eligible reports:** Remote code execution, SQL injection, authentication bypass, authorization flaws, data exposure
- **Out of scope:** Denial of service, social engineering, issues in dependencies (report upstream), self-XSS
- **Recognition:** Security researchers who report valid vulnerabilities will be credited in our release notes (unless they prefer to remain anonymous)
- **Bounty program:** We do not currently offer monetary bounties, but are happy to discuss this for critical findings

## Supported Versions

| Version | Supported  |
| ------- | ---------- |
| 0.1.x   | ✅ Current |

## Audit & Disclosure History

| Date | Description                            | Severity | Status |
| ---- | -------------------------------------- | -------- | ------ |
| —    | No security incidents reported to date | —        | —      |

We will update this table as vulnerabilities are reported and resolved. Each entry will include a CVE identifier (when applicable), severity rating, affected versions, and a link to the fix.

## Security Best Practices

When using ReactiveBase in production:

- Always set `NODE_ENV=production`
- Use strong, unique `JWT_SECRET` values (minimum 256 bits of entropy)
- Enable HTTPS/WSS via a reverse proxy
- Set appropriate rate limits
- Review RLS policies and access rules
- Keep dependencies updated
- Use `DATABASE_URL` with SSL (`?sslmode=require`)
