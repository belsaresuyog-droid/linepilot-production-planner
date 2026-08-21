"""OEE telemetry and pace-recovery service for Ideal Gas Springs MES V2."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, time
from typing import Iterable


CHECKPOINTS = (time(12, 30), time(17, 30))


@dataclass(frozen=True)
class ProductionUpdate:
    station_id: int
    production_order_id: int | None
    actual_output: int
    good_output: int
    planned_output_at_checkpoint: float
    runtime_seconds: int
    planned_runtime_seconds: int
    ideal_cycle_time_seconds: float
    machine_count_available: int
    machine_count_required: int
    manpower_available: int
    manpower_required: int
    downtime_reason: str | None = None


@dataclass(frozen=True)
class OeeResult:
    availability: float
    performance: float
    quality: float
    oee: float
    pace_variance_units: float
    pace_variance_percent: float | None


class MesOeeService:
    """Persists telemetry, computes A×P×Q, and records schedule suggestions.

    The service never silently rewrites a released plan. It creates auditable
    suggestions which an operator may accept/apply through the application.
    """

    def __init__(
        self,
        connection: sqlite3.Connection,
        *,
        baseline_oee: float = 0.60,
        variance_threshold: float = 0.10,
        checkpoint_tolerance_minutes: int = 10,
    ) -> None:
        if not 0 < baseline_oee <= 1:
            raise ValueError("baseline_oee must be between 0 and 1")
        if not 0 <= variance_threshold <= 1:
            raise ValueError("variance_threshold must be between 0 and 1")
        self.db = connection
        self.db.row_factory = sqlite3.Row
        self.baseline_oee = baseline_oee
        self.variance_threshold = variance_threshold
        self.checkpoint_tolerance_minutes = checkpoint_tolerance_minutes

    @staticmethod
    def _clamp(value: float) -> float:
        return max(0.0, min(1.0, value))

    @classmethod
    def calculate_oee(cls, update: ProductionUpdate) -> OeeResult:
        availability = cls._clamp(
            update.runtime_seconds / update.planned_runtime_seconds
            if update.planned_runtime_seconds else 0.0
        )
        performance = cls._clamp(
            (update.ideal_cycle_time_seconds * update.actual_output) / update.runtime_seconds
            if update.runtime_seconds else 0.0
        )
        quality = cls._clamp(
            update.good_output / update.actual_output if update.actual_output else 0.0
        )
        oee = availability * performance * quality
        delta = update.actual_output - update.planned_output_at_checkpoint
        delta_pct = (
            delta / update.planned_output_at_checkpoint
            if update.planned_output_at_checkpoint
            else None
        )
        return OeeResult(availability, performance, quality, oee, delta, delta_pct)

    def checkpoint_label(self, observed_at: datetime) -> str:
        observed_minutes = observed_at.hour * 60 + observed_at.minute
        nearest = min(
            CHECKPOINTS,
            key=lambda value: abs(observed_minutes - (value.hour * 60 + value.minute)),
        )
        distance = abs(observed_minutes - (nearest.hour * 60 + nearest.minute))
        if distance > self.checkpoint_tolerance_minutes:
            raise ValueError("telemetry must be entered at the 12:30 or 17:30 checkpoint")
        return nearest.strftime("%H:%M")

    def ingest_updates(
        self,
        *,
        site_id: int,
        capacity_plan_id: int,
        observed_at: datetime,
        updates: Iterable[ProductionUpdate],
        source: str = "MANUAL",
    ) -> list[int]:
        checkpoint = self.checkpoint_label(observed_at)
        batch_observed = observed_at.replace(second=0, microsecond=0).isoformat()
        adjustment_ids: list[int] = []

        with self.db:
            cursor = self.db.execute(
                """INSERT INTO telemetry_batches(site_id, checkpoint, observed_at, source)
                   VALUES (?, ?, ?, ?)""",
                (site_id, checkpoint, batch_observed, source),
            )
            batch_id = int(cursor.lastrowid)

            for update in updates:
                result = self.calculate_oee(update)
                log_cursor = self.db.execute(
                    """INSERT INTO telemetry_logs(
                         telemetry_batch_id, station_id, production_order_id,
                         actual_output, good_output, planned_output_at_checkpoint,
                         runtime_seconds, planned_runtime_seconds, ideal_cycle_time_seconds,
                         machine_count_available, manpower_available,
                         availability, performance, quality, calculated_oee,
                         pace_variance_units, pace_variance_percent, downtime_reason
                       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        batch_id,
                        update.station_id,
                        update.production_order_id,
                        update.actual_output,
                        update.good_output,
                        update.planned_output_at_checkpoint,
                        update.runtime_seconds,
                        update.planned_runtime_seconds,
                        update.ideal_cycle_time_seconds,
                        update.machine_count_available,
                        update.manpower_available,
                        result.availability,
                        result.performance,
                        result.quality,
                        result.oee,
                        result.pace_variance_units,
                        result.pace_variance_percent,
                        update.downtime_reason,
                    ),
                )
                telemetry_log_id = int(log_cursor.lastrowid)
                suggestions = self._suggestions(update, result, checkpoint)
                for severity, reason_code, message, shifted in suggestions:
                    suggestion_cursor = self.db.execute(
                        """INSERT INTO schedule_adjustments(
                             telemetry_batch_id, telemetry_log_id, capacity_plan_id,
                             severity, reason_code, suggestion, quantity_shifted
                           ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (
                            batch_id,
                            telemetry_log_id,
                            capacity_plan_id,
                            severity,
                            reason_code,
                            message,
                            shifted,
                        ),
                    )
                    adjustment_ids.append(int(suggestion_cursor.lastrowid))
        return adjustment_ids

    def _suggestions(
        self, update: ProductionUpdate, result: OeeResult, checkpoint: str
    ) -> list[tuple[str, str, str, int]]:
        suggestions: list[tuple[str, str, str, int]] = []
        shortfall = max(0, round(-result.pace_variance_units))
        variance_broken = (
            result.pace_variance_percent is not None
            and result.pace_variance_percent < -self.variance_threshold
        )

        if update.machine_count_available < update.machine_count_required:
            missing = update.machine_count_required - update.machine_count_available
            suggestions.append((
                "CRITICAL",
                "MACHINE_SHORTAGE",
                f"Restore or reallocate {missing} machine(s) at station {update.station_id}; "
                f"re-sequence the remaining {shortfall} unit shortfall after {checkpoint}.",
                shortfall,
            ))
        if update.manpower_available < update.manpower_required:
            missing = update.manpower_required - update.manpower_available
            suggestions.append((
                "CRITICAL",
                "MANPOWER_SHORTAGE",
                f"Assign {missing} additional operator(s) at station {update.station_id} "
                f"before releasing the next single-piece-flow batch.",
                shortfall,
            ))
        if result.oee < self.baseline_oee:
            suggestions.append((
                "WARNING" if result.oee >= self.baseline_oee * 0.8 else "CRITICAL",
                "PM_OEE_IMPACT" if update.downtime_reason else "PACE_VARIANCE",
                f"Station OEE is {result.oee:.1%} versus the {self.baseline_oee:.1%} baseline; "
                "recalculate downstream start times using current A×P×Q and protect due-date priority.",
                shortfall,
            ))
        elif variance_broken:
            suggestions.append((
                "WARNING",
                "PACE_VARIANCE",
                f"Actual output is {abs(result.pace_variance_percent or 0):.1%} below the baseline plan; "
                "move recoverable quantity to the next feasible station-capacity window.",
                shortfall,
            ))
        if result.quality < 0.98:
            suggestions.append((
                "WARNING",
                "QUALITY_LOSS",
                f"Quality is {result.quality:.1%}; reserve replacement quantity before feeder stock is released.",
                max(0, update.actual_output - update.good_output),
            ))
        if not suggestions:
            suggestions.append((
                "INFO",
                "PACE_VARIANCE",
                f"Station is stable at {result.oee:.1%} OEE; retain the current sequence.",
                0,
            ))
        return suggestions

