# @reactivebase/migrate-from-prisma

Migrate your Prisma schema to ReactiveBase with one command.

## Usage

```bash
# From your project root (where prisma/schema.prisma exists)
npx @reactivebase/migrate-from-prisma

# Custom paths
npx @reactivebase/migrate-from-prisma --input path/to/schema.prisma --output ./my-app
```

## What It Does

1. Reads your `prisma/schema.prisma` file
2. Converts models → `defineTable()` with typed validators
3. Converts `@id`, `@unique`, `@default` → indexes and defaults
4. Converts `@relation` → foreign key references
5. Generates `convex/schema.ts` + `server.ts`

## Supported Prisma Features

- ✅ Model definitions → `defineTable()`
- ✅ Scalar types (String, Int, Float, Boolean, DateTime, Json)
- ✅ `@id`, `@unique`, `@default`
- ✅ `@relation` with `fields` and `references`
- ✅ `@@index`, `@@unique`
- ✅ Optional fields (`?`)
- ✅ Array fields (`[]`)
