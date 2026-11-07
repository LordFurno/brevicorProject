# FHIR Gateway (EHR Integration Layer)

A standalone HL7 FHIR R4 REST API at `/api/fhir/R4`. Callers see one consistent
FHIR interface no matter which EHR sits behind it. Spec: `docs/spec.md`
sections 2.1 and 4H. Contract with the app: `docs/fhir-contract.md`.

## Rules
- Every provider (mock, native, adapters) implements `FhirProvider`
  (`src/core/provider.ts`). EHR-specific code lives only in
  `src/providers/<name>/`. Nothing outside that folder knows which EHR is in use.
- The mock provider follows the exact same contract as real providers.
  No mock-only behaviour.
- Tenant and role come from the verified caller token (`src/core/auth.ts`),
  never from a header or request body. Every DB query is scoped by tenant.
- All errors are FHIR `OperationOutcome` resources (`src/core/outcome.ts`).
- Validate resources against FHIR R4 on the way in and on the way out.
- Unsupported operations return an `OperationOutcome`. Never silently drop
  a write. If an EHR can't store a document, use `src/docstore/` and record
  sync status and where the authoritative copy lives.
- `GET /metadata` (CapabilityStatement) must reflect what the tenant's
  provider actually supports.
- Use FHIR R4 field names and docs (hl7.org/fhir/R4/), not R5.

## Testing
- `tests/conformance/` is one suite that every provider must pass.
  Run it against the mock and against HAPI FHIR in Docker (native stand-in).
- A new provider or endpoint isn't done until conformance passes.

## Initial layout (delete this section once scaffolded)
src/server.ts, src/routes/, src/core/{provider,router,auth,validate,outcome,capability}.ts,
src/providers/{mock,native,adapters}/, src/tenants/, src/docstore/,
tests/{unit,conformance}/, db/migrations/, scripts/{seed,reset}.ts

## Commands
<!-- fill in once scaffolded -->
- Dev: TBD
- Test (unit): TBD
- Test (conformance vs mock): TBD
- Test (conformance vs HAPI): TBD
- Seed / reset mock data: TBD