# Security & Pending Items

- [ ] Add authentication to `/api/inbound.post.ts` - validate Authorization header with `INBOUND_API_KEY` (see `apps/api-server/src/server/api/inbound.post.ts:28`)
- [ ] Fix path traversal vulnerability in `/api/attachment/[...path].ts` - validate path doesn't contain `..` sequences (see `apps/api-server/src/server/api/attachment/[...path].ts:29`)
- [ ] Gate dev endpoints behind environment check - disable `/api/dev/*` in production (see `apps/api-server/src/server/api/dev/*`)
- [ ] Change `LOCAL_DEV` flag to use environment variable instead of hardcoded `true` (see `apps/api-server/src/server/api/inbound.post.ts:14`)
- [ ] Implement email sending logic in compose/forward email views (see `apps/api-server/src/bolt/listeners/views/compose-email-view.ts:18` and `forward-email-view.ts:21`)

