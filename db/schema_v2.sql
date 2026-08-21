PRAGMA foreign_keys = ON;

-- Ideal Gas Springs MES / Digital Twin, Version 2
-- SQLite and Cloudflare D1 compatible. Percentages are stored as fractions (0..1).

CREATE TABLE sites (
  site_id INTEGER PRIMARY KEY,
  site_code TEXT NOT NULL UNIQUE,
  site_name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE production_lines (
  line_id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL,
  line_code TEXT NOT NULL,
  line_name TEXT NOT NULL,
  line_type TEXT NOT NULL CHECK (line_type IN ('ASSEMBLY', 'FEEDER', 'WAREHOUSE')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (site_id, line_code),
  FOREIGN KEY (site_id) REFERENCES sites(site_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE product_families (
  family_id INTEGER PRIMARY KEY,
  family_code TEXT NOT NULL UNIQUE,
  family_name TEXT NOT NULL,
  assembly_line_id INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  FOREIGN KEY (assembly_line_id) REFERENCES production_lines(line_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE products (
  product_id INTEGER PRIMARY KEY,
  family_id INTEGER NOT NULL,
  material_code TEXT NOT NULL UNIQUE,
  segment TEXT,
  description TEXT,
  bom_available INTEGER NOT NULL DEFAULT 0 CHECK (bom_available IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (family_id) REFERENCES product_families(family_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE stations (
  station_id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL,
  station_code TEXT NOT NULL,
  station_name TEXT NOT NULL,
  shop_type TEXT NOT NULL CHECK (shop_type IN ('TUBE_FEEDER', 'RIVETING_FEEDER', 'ASSEMBLY', 'WAREHOUSE')),
  default_machine_count INTEGER NOT NULL DEFAULT 1 CHECK (default_machine_count > 0),
  default_manpower_count INTEGER NOT NULL DEFAULT 1 CHECK (default_manpower_count >= 0),
  structural_bottleneck INTEGER NOT NULL DEFAULT 0 CHECK (structural_bottleneck IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (site_id, station_code),
  FOREIGN KEY (site_id) REFERENCES sites(site_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE line_stations (
  line_station_id INTEGER PRIMARY KEY,
  line_id INTEGER NOT NULL,
  station_id INTEGER NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  UNIQUE (line_id, station_id),
  UNIQUE (line_id, sequence_no),
  FOREIGN KEY (line_id) REFERENCES production_lines(line_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (station_id) REFERENCES stations(station_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- Product-level routing is the source of truth for different cycle times per material code.
CREATE TABLE product_routes (
  product_route_id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL,
  line_station_id INTEGER NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  cycle_time_seconds REAL NOT NULL CHECK (cycle_time_seconds > 0),
  setup_time_seconds REAL NOT NULL DEFAULT 0 CHECK (setup_time_seconds >= 0),
  manpower_required INTEGER NOT NULL DEFAULT 1 CHECK (manpower_required >= 0),
  machines_required INTEGER NOT NULL DEFAULT 1 CHECK (machines_required > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (product_id, sequence_no),
  UNIQUE (product_id, line_station_id),
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (line_station_id) REFERENCES line_stations(line_station_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE components (
  component_id INTEGER PRIMARY KEY,
  material_code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  base_unit TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE product_bom (
  product_bom_id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL,
  component_id INTEGER NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  scrap_factor REAL NOT NULL DEFAULT 0 CHECK (scrap_factor >= 0 AND scrap_factor < 1),
  effective_from TEXT,
  effective_to TEXT,
  UNIQUE (product_id, component_id, effective_from),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (component_id) REFERENCES components(component_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE planning_periods (
  planning_period_id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL,
  period_name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'RELEASED', 'CLOSED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date),
  UNIQUE (site_id, start_date, end_date),
  FOREIGN KEY (site_id) REFERENCES sites(site_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE oee_profiles (
  oee_profile_id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL,
  profile_name TEXT NOT NULL,
  availability REAL NOT NULL CHECK (availability BETWEEN 0 AND 1),
  performance REAL NOT NULL CHECK (performance BETWEEN 0 AND 1),
  quality REAL NOT NULL CHECK (quality BETWEEN 0 AND 1),
  baseline_oee REAL GENERATED ALWAYS AS (availability * performance * quality) STORED,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  editable INTEGER NOT NULL DEFAULT 1 CHECK (editable IN (0, 1)),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (site_id) REFERENCES sites(site_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE working_calendars (
  calendar_id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  is_working_day INTEGER NOT NULL DEFAULT 1 CHECK (is_working_day IN (0, 1)),
  shift_seconds INTEGER NOT NULL DEFAULT 57600 CHECK (shift_seconds > 0),
  reason TEXT,
  UNIQUE (site_id, work_date),
  FOREIGN KEY (site_id) REFERENCES sites(site_id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE station_capacity (
  station_capacity_id INTEGER PRIMARY KEY,
  station_id INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  shift_code TEXT NOT NULL DEFAULT 'DAY',
  machine_count INTEGER NOT NULL CHECK (machine_count >= 0),
  available_machine_seconds INTEGER NOT NULL CHECK (available_machine_seconds >= 0),
  manpower_available INTEGER NOT NULL CHECK (manpower_available >= 0),
  available_manpower_seconds INTEGER NOT NULL CHECK (available_manpower_seconds >= 0),
  planned_downtime_seconds INTEGER NOT NULL DEFAULT 0 CHECK (planned_downtime_seconds >= 0),
  UNIQUE (station_id, work_date, shift_code),
  FOREIGN KEY (station_id) REFERENCES stations(station_id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE capacity_plans (
  capacity_plan_id INTEGER PRIMARY KEY,
  planning_period_id INTEGER NOT NULL,
  line_id INTEGER NOT NULL,
  oee_profile_id INTEGER NOT NULL,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('MONTHLY_FEEDER', 'DAILY_ASSEMBLY')),
  version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no > 0),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'RELEASED', 'SUPERSEDED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (planning_period_id, line_id, plan_type, version_no),
  FOREIGN KEY (planning_period_id) REFERENCES planning_periods(planning_period_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (line_id) REFERENCES production_lines(line_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (oee_profile_id) REFERENCES oee_profiles(oee_profile_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE production_orders (
  production_order_id INTEGER PRIMARY KEY,
  capacity_plan_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  order_reference TEXT NOT NULL,
  planned_quantity INTEGER NOT NULL CHECK (planned_quantity > 0),
  due_date TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'RELEASED', 'RUNNING', 'COMPLETED', 'CANCELLED')),
  UNIQUE (capacity_plan_id, order_reference),
  FOREIGN KEY (capacity_plan_id) REFERENCES capacity_plans(capacity_plan_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE scheduled_operations (
  scheduled_operation_id INTEGER PRIMARY KEY,
  production_order_id INTEGER NOT NULL,
  product_route_id INTEGER NOT NULL,
  station_capacity_id INTEGER NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  planned_start TEXT NOT NULL,
  planned_finish TEXT NOT NULL,
  planned_quantity INTEGER NOT NULL CHECK (planned_quantity > 0),
  planned_machine_seconds REAL NOT NULL CHECK (planned_machine_seconds >= 0),
  planned_manpower_seconds REAL NOT NULL CHECK (planned_manpower_seconds >= 0),
  planned_oee REAL NOT NULL CHECK (planned_oee BETWEEN 0 AND 1),
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'READY', 'RUNNING', 'COMPLETED', 'BLOCKED')),
  CHECK (planned_finish >= planned_start),
  UNIQUE (production_order_id, sequence_no),
  FOREIGN KEY (production_order_id) REFERENCES production_orders(production_order_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (product_route_id) REFERENCES product_routes(product_route_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (station_capacity_id) REFERENCES station_capacity(station_capacity_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE feeder_targets (
  feeder_target_id INTEGER PRIMARY KEY,
  capacity_plan_id INTEGER NOT NULL,
  station_id INTEGER NOT NULL,
  component_id INTEGER NOT NULL,
  target_quantity REAL NOT NULL CHECK (target_quantity >= 0),
  staged_quantity REAL NOT NULL DEFAULT 0 CHECK (staged_quantity >= 0),
  required_by_date TEXT NOT NULL,
  UNIQUE (capacity_plan_id, station_id, component_id, required_by_date),
  FOREIGN KEY (capacity_plan_id) REFERENCES capacity_plans(capacity_plan_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (station_id) REFERENCES stations(station_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (component_id) REFERENCES components(component_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE maintenance_events (
  maintenance_event_id INTEGER PRIMARY KEY,
  station_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('PM', 'BREAKDOWN', 'CHANGEOVER')),
  planned_start TEXT NOT NULL,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  availability_impact REAL NOT NULL DEFAULT 0 CHECK (availability_impact BETWEEN 0 AND 1),
  FOREIGN KEY (station_id) REFERENCES stations(station_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE telemetry_batches (
  telemetry_batch_id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL,
  checkpoint TEXT NOT NULL CHECK (checkpoint IN ('12:30', '17:30')),
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'MANUAL',
  UNIQUE (site_id, checkpoint, observed_at),
  FOREIGN KEY (site_id) REFERENCES sites(site_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE telemetry_logs (
  telemetry_log_id INTEGER PRIMARY KEY,
  telemetry_batch_id INTEGER NOT NULL,
  station_id INTEGER NOT NULL,
  production_order_id INTEGER,
  actual_output INTEGER NOT NULL DEFAULT 0 CHECK (actual_output >= 0),
  good_output INTEGER NOT NULL DEFAULT 0 CHECK (good_output >= 0 AND good_output <= actual_output),
  planned_output_at_checkpoint REAL NOT NULL DEFAULT 0 CHECK (planned_output_at_checkpoint >= 0),
  runtime_seconds INTEGER NOT NULL DEFAULT 0 CHECK (runtime_seconds >= 0),
  planned_runtime_seconds INTEGER NOT NULL DEFAULT 0 CHECK (planned_runtime_seconds >= 0),
  ideal_cycle_time_seconds REAL CHECK (ideal_cycle_time_seconds > 0),
  machine_count_available INTEGER NOT NULL DEFAULT 0 CHECK (machine_count_available >= 0),
  manpower_available INTEGER NOT NULL DEFAULT 0 CHECK (manpower_available >= 0),
  availability REAL NOT NULL CHECK (availability BETWEEN 0 AND 1),
  performance REAL NOT NULL CHECK (performance BETWEEN 0 AND 1),
  quality REAL NOT NULL CHECK (quality BETWEEN 0 AND 1),
  calculated_oee REAL NOT NULL CHECK (calculated_oee BETWEEN 0 AND 1),
  pace_variance_units REAL NOT NULL,
  pace_variance_percent REAL,
  downtime_reason TEXT,
  FOREIGN KEY (telemetry_batch_id) REFERENCES telemetry_batches(telemetry_batch_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (station_id) REFERENCES stations(station_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (production_order_id) REFERENCES production_orders(production_order_id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE schedule_adjustments (
  adjustment_id INTEGER PRIMARY KEY,
  telemetry_batch_id INTEGER NOT NULL,
  telemetry_log_id INTEGER NOT NULL,
  capacity_plan_id INTEGER NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('PACE_VARIANCE', 'MACHINE_SHORTAGE', 'MANPOWER_SHORTAGE', 'PM_OEE_IMPACT', 'QUALITY_LOSS')),
  suggestion TEXT NOT NULL,
  original_finish TEXT,
  suggested_finish TEXT,
  quantity_shifted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'SUGGESTED' CHECK (status IN ('SUGGESTED', 'ACCEPTED', 'REJECTED', 'APPLIED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (telemetry_batch_id) REFERENCES telemetry_batches(telemetry_batch_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (telemetry_log_id) REFERENCES telemetry_logs(telemetry_log_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (capacity_plan_id) REFERENCES capacity_plans(capacity_plan_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_products_family ON products(family_id, active);
CREATE INDEX idx_routes_product_sequence ON product_routes(product_id, sequence_no);
CREATE INDEX idx_bom_product ON product_bom(product_id);
CREATE INDEX idx_capacity_station_date ON station_capacity(station_id, work_date);
CREATE INDEX idx_orders_due ON production_orders(due_date, priority);
CREATE INDEX idx_operations_station_time ON scheduled_operations(station_capacity_id, planned_start, planned_finish);
CREATE INDEX idx_telemetry_observed ON telemetry_batches(site_id, observed_at);
CREATE INDEX idx_telemetry_station ON telemetry_logs(station_id, telemetry_batch_id);
CREATE INDEX idx_adjustments_status ON schedule_adjustments(status, severity);

-- A production order can only be placed on the assembly line assigned to its family.
CREATE TRIGGER production_orders_validate_line_insert
BEFORE INSERT ON production_orders
WHEN (
  SELECT pf.assembly_line_id
  FROM products p JOIN product_families pf ON pf.family_id = p.family_id
  WHERE p.product_id = NEW.product_id
) <> (
  SELECT cp.line_id FROM capacity_plans cp WHERE cp.capacity_plan_id = NEW.capacity_plan_id
)
BEGIN
  SELECT RAISE(ABORT, 'product family is not assigned to this assembly line');
END;

CREATE TRIGGER production_orders_validate_line_update
BEFORE UPDATE OF product_id, capacity_plan_id ON production_orders
WHEN (
  SELECT pf.assembly_line_id
  FROM products p JOIN product_families pf ON pf.family_id = p.family_id
  WHERE p.product_id = NEW.product_id
) <> (
  SELECT cp.line_id FROM capacity_plans cp WHERE cp.capacity_plan_id = NEW.capacity_plan_id
)
BEGIN
  SELECT RAISE(ABORT, 'product family is not assigned to this assembly line');
END;

-- Prevent overlapping planning periods at a site; adjacency is allowed.
CREATE TRIGGER planning_periods_no_overlap_insert
BEFORE INSERT ON planning_periods
WHEN EXISTS (
  SELECT 1 FROM planning_periods p
  WHERE p.site_id = NEW.site_id
    AND NEW.start_date <= p.end_date
    AND NEW.end_date >= p.start_date
)
BEGIN
  SELECT RAISE(ABORT, 'planning period overlaps an existing date range');
END;

CREATE TRIGGER planning_periods_no_overlap_update
BEFORE UPDATE OF site_id, start_date, end_date ON planning_periods
WHEN EXISTS (
  SELECT 1 FROM planning_periods p
  WHERE p.site_id = NEW.site_id
    AND p.planning_period_id <> NEW.planning_period_id
    AND NEW.start_date <= p.end_date
    AND NEW.end_date >= p.start_date
)
BEGIN
  SELECT RAISE(ABORT, 'planning period overlaps an existing date range');
END;
