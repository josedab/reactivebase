# ReactiveBase Launch Checklist

## Pre-Publish Verification

### Code Quality
- [x] All 425 tests pass (`npm run test`)
- [x] All 12 packages build (`npm run build`)
- [x] TypeScript strict mode, zero type errors
- [x] No console.log in production code (only in dev/debug paths)
- [x] All package.json have `publishConfig: { access: "public" }`
- [x] All package.json have `files: ["dist", "README.md"]`
- [x] All package.json have `repository` field

### Documentation
- [x] README.md with badges, quickstart, architecture diagram
- [x] CONTRIBUTING.md with architecture guide, coding conventions
- [x] SECURITY.md with vulnerability reporting process
- [x] CODE_OF_CONDUCT.md
- [x] LICENSE (MIT)
- [x] .github/FUNDING.yml
- [x] .github/ISSUE_TEMPLATE.md
- [x] .github/PULL_REQUEST_TEMPLATE.md

### CI/CD
- [x] .github/workflows/ci.yml (Node 20/22 matrix)
- [x] .github/workflows/release.yml (npm publish on tag)

### Website
- [x] Docusaurus site builds (`cd website && npm run build`)
- [x] 9 documentation pages
- [x] 3 comparison guides (Convex, Supabase, Firebase)
- [x] Blog post: "From Prisma+tRPC to ReactiveBase"
- [x] Playground page (StackBlitz embed)
- [x] Cloud pricing page

### Examples
- [x] basic-todo example app
- [x] collaborative-board demo app

### Deployment
- [x] Dockerfile
- [x] docker-compose.yml (Postgres + Redis + ReactiveBase)
- [x] fly.toml
- [x] railway.json
- [x] render.yaml
- [x] deploy/README.md

## Publish Steps

```bash
# 1. Verify everything builds and passes
npm run build
npm run test

# 2. Verify docs build
cd website && npm run build && cd ..

# 3. Dry-run npm publish (verify package contents)
for pkg in packages/server packages/client packages/react packages/vue \
  packages/svelte packages/nextjs packages/edge packages/testing \
  packages/cli packages/reactivebase packages/create-reactivebase \
  packages/migrate-from-prisma; do
  echo "=== $pkg ==="
  cd $pkg && npm pack --dry-run && cd -
done

# 4. Create git tag
git tag v0.1.0

# 5. Push tag (triggers release workflow)
git push origin v0.1.0

# 6. Or publish manually
for pkg in packages/server packages/client packages/react packages/vue \
  packages/svelte packages/nextjs packages/edge packages/testing \
  packages/cli packages/reactivebase packages/create-reactivebase \
  packages/migrate-from-prisma; do
  cd $pkg && npm publish --access public && cd -
done
```

## Post-Publish Actions

### Day 1
- [ ] Verify all npm packages are accessible
- [ ] Test `npx create-reactivebase test-app` works
- [ ] Test `npx @reactivebase/migrate-from-prisma` works
- [ ] Submit to Hacker News: "Show HN: ReactiveBase – Convex DX on Postgres (MIT)"
- [ ] Post on Reddit: r/typescript, r/webdev, r/reactjs
- [ ] Tweet announcement thread

### Week 1
- [ ] Submit to DevHunt
- [ ] Submit to Product Hunt
- [ ] Post on dev.to and Hashnode
- [ ] Create Discord server
- [ ] Monitor GitHub issues and respond within 24h

### Month 1
- [ ] Deploy live demo on Fly.io
- [ ] Record first tutorial video
- [ ] Write "vs Convex" detailed comparison blog post
- [ ] Reach out to 3 potential enterprise pilots
- [ ] Submit CFP to React Summit / Node Congress
