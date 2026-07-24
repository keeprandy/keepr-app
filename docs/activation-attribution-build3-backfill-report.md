# Activation & Attribution V1 Build 3 Backfill Report

Build 3 does not automatically backfill historical PostHog activity.

The migration adds the read-only admin RPC `report_unmatched_historical_activations()`
to list existing profiles that still have `profiles.acquisition_source_slug` but do
not yet have an authoritative `attribution_records` row.

Intended review query after migration is applied to a non-production validation
environment:

```sql
select *
from public.report_unmatched_historical_activations();
```

This report is intentionally non-mutating. Any historical attribution correction
or import should be handled as a separate approved migration or admin workflow.
