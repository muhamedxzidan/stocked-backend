# Balance query contract blueprint

Status: explicitly approved by the user with «نفذ»; implemented on 2026-10-09. Verification is recorded in BACKEND_PROGRESS.md.

## Purpose and verified change point

`GET /balances` currently accepts the shared `ListInventoryDto`, including
`actorId`, `kind`, `from`, and `to`. `InventoryService.balances` never uses
those fields. Rejecting unsupported filters prevents silently misleading results.

## Current flow and structure

HTTP query → validation/transformation of `ListInventoryDto` →
`InventoryController` → `InventoryService` merchant scope → Prisma read transaction
→ existing balance or movement response DTO. No UI is involved.

`InventoryController` owns request boundaries. Query DTOs own accepted fields
and validation. `InventoryService` owns inventory reads and merchant scoping.
Prisma remains the existing database boundary; no new layers are needed.

## Proposed solution and file map

- Add `src/inventory/dto/list-balances.dto.ts`: standalone DTO containing
  `merchantId`, `itemId`, `page`, and `limit`, preserving existing UUID v4,
  strict numeric transformation, defaults and limits.
- Update `src/inventory/inventory.controller.ts`: use the new DTO only for
  `GET /balances`; movement endpoints retain their supported filters.
- Update `src/inventory/inventory.service.ts`: change the balances query type
  only; preserve all SQL predicates, role checks, response shapes and ordering.
- Update `src/inventory/dto/list-inventory.dto.ts`: document existing page/limit
  defaults and bounds explicitly in Swagger for movement requests.
- Extend `test/inventory/read-contracts.e2e-spec.ts`: assert rejected unsupported
  balance filters, exact Swagger query fields, accepted merchant/item filters,
  paging validation, merchant isolation, and working movement filters including
  actor/kind/date ranges.
- Update `docs/inventory-api.md` and `docs/BACKEND_PROGRESS.md` with compatibility,
  changed files, executed checks and remaining work.

Separate DTOs express separate request contracts. A controller-only manual check
would duplicate validation and leave Swagger and accepted fields inconsistent.
Do not introduce inheritance merely to share pagination decorators.

## Ordered work and verification

1. Add regression tests demonstrating ignored balance filters.
2. Split the query boundary and complete Swagger pagination metadata.
3. Verify existing merchant scoping and movement filtering using real API tests.
4. Run build, lint, focused integration tests, then the complete integration and
   unit suites; check formatting and diff whitespace.
5. Record actual outcomes and review the final diff.

Compatibility: unsupported balance query fields will return HTTP 400 instead
of being silently ignored. No migrations, dependencies, stock calculations,
write permissions, Flutter edits, production deployment or audit-system design
are included. Durable audit work requires a separate traced and approved plan.
