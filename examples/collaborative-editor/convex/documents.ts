import { query, mutation } from "@reactivebase/server"

export const listDocuments = query(async (ctx, { ownerId }: { ownerId: string }) => {
  return ctx.db.documents.where({ ownerId }).orderBy("updatedAt", "desc")
})

export const getDocument = query(async (ctx, { documentId }: { documentId: string }) => {
  return ctx.db.documents.get(documentId)
})

export const getVersions = query(async (ctx, { documentId }: { documentId: string }) => {
  return ctx.db.document_versions.where({ documentId }).orderBy("version", "desc")
})

export const createDocument = mutation(async (ctx, args: { title: string; ownerId: string }) => {
  return ctx.db.documents.insert({
    title: args.title, ownerId: args.ownerId, isPublic: false,
    createdAt: new Date(), updatedAt: new Date(),
  })
})

export const updateTitle = mutation(async (ctx, args: { documentId: string; title: string }) => {
  await ctx.db.documents.update(args.documentId, { title: args.title, updatedAt: new Date() })
  return { success: true }
})

export const saveVersion = mutation(async (ctx, args: {
  documentId: string; createdBy: string; label?: string
}) => {
  const versions = await ctx.db.document_versions.where({ documentId: args.documentId }).count()
  return ctx.db.document_versions.insert({
    documentId: args.documentId, version: versions + 1,
    label: args.label, createdBy: args.createdBy, createdAt: new Date(),
  })
})
