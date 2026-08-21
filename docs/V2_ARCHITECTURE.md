# Ideal Gas Springs MES / Digital Twin — Version 2

Version 2 is isolated from the frozen Version 1 application. It introduces normalized MES master data, product-specific routes, BOM traceability, feeder planning, station capacity, OEE telemetry, and auditable schedule-adjustment suggestions.

## Allocation rules

- AL 1 accepts only family 615.
- AL 2 accepts only families 818 and 1021.
- Tube Shop and Riveting Shop are monthly feeder plans; completed components are staged before assembly release.
- Every product route stores its own cycle time at each active station. Zero/unused workbook processes are omitted from the route.
- Single-piece-flow release is permitted only when the next required station has both machine and manpower capacity.

## OEE and telemetry

The default profile is 60% OEE, represented as `0.80 Availability × 0.75 Performance × 1.00 Quality`. These factors are editable and the generated OEE is used for capacity and schedule calculations.

Telemetry is accepted at 12:30 and 17:30 (with a configurable tolerance). Each update records actual/good output, runtime, machine availability, manpower, A/P/Q, OEE, and pace variance. The service creates suggestions instead of silently changing a released plan, preserving an approval trail.

`pace_variance_units = actual_output - baseline_planned_output`

`pace_variance_percent = pace_variance_units / baseline_planned_output`

## Artifacts

- `db/schema_v2.sql`: normalized SQL DDL, constraints, FKs, indexes, and non-overlapping date-range triggers.
- `db/seed_v2.sql`: line/family/station routing, representative BOM, and 60% OEE seed data.
- `services/mes_oee_service.py`: telemetry ingestion, A×P×Q calculation, variance evaluation, and adjustment logging.
- `services/test_mes_oee_service.py`: executable unit and integration tests using an in-memory SQLite database.

## Source files reviewed

- `Ideal Project (1)-2.docx`: operating and reporting requirements.
- `Company Logo.docx`: Ideal logo asset extracted to `public/brand/ideal-logo-1.jpg`.
- `Product family - 818 & 1021 - Part nos and cycle time-2.xlsx`: 164 rows × 41 columns.
- `BOM compilled file - 2067 - July 25.xlsx`: 40,565 rows × 16 columns.
