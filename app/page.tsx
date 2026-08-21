"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Machine = { key: string; name: string; section: string };
type Product = { id: number; materialCode: string; family: string; assemblyLine?: AssemblyLine; segment: string; bomAvailable: boolean; orderQty: number; cycleTimes: number[]; totalCycleSeconds: number; bottleneckSeconds: number; bottleneckMachine: string };
type PlannerData = { source: string; machines: Machine[]; families: string[]; products: Product[] };
type Planned = Product & { planId: string; planQty: number; dueDate: string; dueDay?: number; priority: "High" | "Normal" };
type ActualProduction = { id: string; date: string; planId: string; materialCode: string; family: string; assemblyLine: AssemblyLine; quantity: number; beforeLunchQuantity?: number; endOfDayQuantity?: number };
type FeederShiftCheckpoint = { beforeLunchQuantity?: number; endOfDayQuantity?: number };
type DailyProductionEdit = { plannedQuantity?: number; actualQuantity?: number; reworkQuantity?: number; rejectionQuantity?: number; manpower?: number; interruption?: "none" | "breakdown" | "power-cut"; downtimeMinutes?: number };
type PreventiveMaintenanceSlot = { id: string; date: string; assemblyLine: AssemblyLine; machineKey: string; startTime: string; durationMinutes: number };
type SkillWorker = { id: number; name: string; designation: string; skills: number[]; percentage: number };
type SkillMatrix = { source: string; scale: string; machines: string[]; workers: SkillWorker[] };
type MachineOwnerEntry = { plannedOperator?: string; actualOperator?: string };
type AuthUser = { id: string; email: string; name: string; picture?: string | null };
type SavedPlan = { planned: Planned[]; holidays: string[]; hours: number; efficiency: number; actualOee?: number; dailyShiftHours?: Record<string, number>; dailyAssemblyLines?: Record<string, AssemblyLine>; dailyProductionEdits?: Record<string, DailyProductionEdit>; machineOwners?: Record<string, MachineOwnerEntry>; preventiveMaintenanceSlots?: PreventiveMaintenanceSlot[]; routeOrder?: string[]; stationBooths?: Record<string, number>; feederStaged?: Record<string, number>; feederProductCompleted?: Record<string, number>; feederShiftActual?: Record<string, FeederShiftCheckpoint>; powderCoatingSent?: Record<string, number>; powderCoatingReturned?: Record<string, number>; powderCoatingLeadDays?: number; vendorDispatchCapacity?: number; actualProduction?: ActualProduction[] };
type CatalogPayload = { customProducts: Product[]; deletedProductIds: number[] };
type ProductDraft = { materialCode: string; family: string; assemblyLine: AssemblyLine; segment: string; bomAvailable: boolean; orderQty: number; cycleTimes: number[] };
type AssemblyLine = "AL1" | "AL2";
type ChatMessage = { id: string; role: "user" | "assistant"; text: string };
type AssistantAction = { kind: "oee" | "hours" | "addHoliday" | "removeHoliday" | "planQty" | "dueDate" | "booths"; label: string; value: number | string; planId?: string; machineKey?: string; machineIndex?: number; line?: AssemblyLine | null };
const ASSEMBLY_START_INDEX = 10;
const TUBE_SHOP_AVAILABLE_STATIONS: Record<string, number> = { m1: 2, m2: 1, m3: 2, m4: 2, m5: 3, m6: 1, m7: 1, m8: 1, m9: 1, m10: 2 };
const SHIFT_SEGMENTS = [{ start: 8 * 60, end: 12 * 60 + 30 }, { start: 13 * 60, end: 16 * 60 }, { start: 16 * 60 + 10, end: 17 * 60 }];

const fmt = new Intl.NumberFormat("en-IN");
const monthName = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });
const dayName = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "2-digit", month: "short" });

function assemblyLineForFamily(family: string): AssemblyLine {
  return family === "615" ? "AL1" : "AL2";
}

function assemblyLineForProduct(product: { family: string; assemblyLine?: AssemblyLine }): AssemblyLine {
  return product.assemblyLine ?? assemblyLineForFamily(product.family);
}

function assemblyLineName(product: { family: string; assemblyLine?: AssemblyLine }) {
  return assemblyLineForProduct(product) === "AL1" ? "Assembly Line 1" : "Assembly Line 2";
}

function configuredBooths(values: Record<string, number>, machineKey: string, index: number, line?: AssemblyLine) {
  const lineKey = line && index >= ASSEMBLY_START_INDEX ? `${line}:${machineKey}` : machineKey;
  return Math.max(1, values[lineKey] ?? values[machineKey] ?? (index < ASSEMBLY_START_INDEX ? TUBE_SHOP_AVAILABLE_STATIONS[machineKey] : 1) ?? 1);
}

function planningBooths(values: Record<string, number>, machineKey: string, index: number) {
  if (index < ASSEMBLY_START_INDEX) return configuredBooths(values, machineKey, index);
  return Math.max(configuredBooths(values, machineKey, index, "AL1"), configuredBooths(values, machineKey, index, "AL2"));
}

function localDateKey(input: Date) {
  const year = input.getFullYear();
  const month = String(input.getMonth() + 1).padStart(2, "0");
  const day = String(input.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isNonWorkingDay(input: Date, holidays: Set<string>) {
  return input.getDay() === 2 || holidays.has(localDateKey(input));
}

function nextWorkingDay(input: Date, holidays: Set<string>) {
  const value = new Date(input);
  while (isNonWorkingDay(value, holidays)) value.setDate(value.getDate() + 1);
  return value;
}

function addWorkingDays(input: Date, count: number, holidays: Set<string>) {
  let value = nextWorkingDay(input, holidays);
  let remaining = Math.max(0, count);
  while (remaining > 0) {
    value = new Date(value.getFullYear(), value.getMonth(), value.getDate() + 1);
    if (!isNonWorkingDay(value, holidays)) remaining -= 1;
  }
  return value;
}

function workingDaysBetween(start: Date, end: Date, holidays: Set<string>) {
  let count = 0;
  let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const limit = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor < limit) {
    if (!isNonWorkingDay(cursor, holidays)) count += 1;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }
  return count;
}

function shiftOffsetLabel(seconds: number) {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m into shift`;
}

function productiveMinuteToClockMinute(productiveMinutes: number) {
  let remaining = Math.max(0, Math.round(productiveMinutes));
  for (const segment of SHIFT_SEGMENTS) {
    const duration = segment.end - segment.start;
    if (remaining <= duration) return segment.start + remaining;
    remaining -= duration;
  }
  return 17 * 60 + remaining;
}
function clockMinuteLabel(clockMinute: number) {
  const clock = Math.max(0, Math.round(clockMinute));
  const hour = Math.floor(clock / 60);
  const minute = clock % 60;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour % 24 >= 12 ? "PM" : "AM"}${clock > 17 * 60 ? " · overtime" : ""}`;
}
function productiveMinuteLabel(productiveMinutes: number) {
  return clockMinuteLabel(productiveMinuteToClockMinute(productiveMinutes));
}

export default function Home() {
  const [data, setData] = useState<PlannerData | null>(null);
  const dataReady = data !== null;
  const [sourceProducts, setSourceProducts] = useState<Product[]>([]);
  const [customProducts, setCustomProducts] = useState<Product[]>([]);
  const [deletedProductIds, setDeletedProductIds] = useState<number[]>([]);
  const [selectedFamilies, setSelectedFamilies] = useState(["615", "818", "1021"]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"plan" | "feeder" | "actual" | "schedule" | "capacity" | "catalog" | "skills" | "twin">("plan");
  const [skillMatrix, setSkillMatrix] = useState<SkillMatrix | null>(null);
  const [skillView, setSkillView] = useState<"matrix" | "owners">("matrix");
  const [skillMachineIndex, setSkillMachineIndex] = useState(0);
  const [skillSearch, setSkillSearch] = useState("");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [capacityView, setCapacityView] = useState<"overview" | "daily" | "graph">("overview");
  const [scheduleLine, setScheduleLine] = useState<AssemblyLine>("AL1");
  const [scheduleView, setScheduleView] = useState<AssemblyLine | "FEEDER">("AL1");
  const [scheduleDayView, setScheduleDayView] = useState<"plan" | "breakdown">("plan");
  const [actualLine, setActualLine] = useState<AssemblyLine>("AL1");
  const [feederWorkingHoursOpen, setFeederWorkingHoursOpen] = useState(true);
  const [graphProcessIndex, setGraphProcessIndex] = useState(0);
  const [startDate, setStartDate] = useState("2026-08-01");
  const [endDate, setEndDate] = useState("2026-08-31");
  const month = `${startDate}_${endDate}`;
  const [savedRanges, setSavedRanges] = useState<string[]>([]);
  const [draftStartDate, setDraftStartDate] = useState("2026-08-01");
  const [draftEndDate, setDraftEndDate] = useState("2026-08-31");
  const [periodMessage, setPeriodMessage] = useState("");
  const [deletingPeriod, setDeletingPeriod] = useState(false);
  const deletedPeriodsRef = useRef(new Set<string>());
  const planSaveAbortRef = useRef<AbortController | null>(null);
  const [hours, setHours] = useState(16);
  const [efficiency, setEfficiency] = useState(60);
  const [actualOee, setActualOee] = useState(80);
  const [dailyShiftHours, setDailyShiftHours] = useState<Record<string, number>>({});
  const [dailyAssemblyLines, setDailyAssemblyLines] = useState<Record<string, AssemblyLine>>({});
  const [dailyProductionEdits, setDailyProductionEdits] = useState<Record<string, DailyProductionEdit>>({});
  const [machineOwners, setMachineOwners] = useState<Record<string, MachineOwnerEntry>>({});
  const [preventiveMaintenanceSlots, setPreventiveMaintenanceSlots] = useState<PreventiveMaintenanceSlot[]>([]);
  const [pmDraft, setPmDraft] = useState({ date: "", assemblyLine: "AL1" as AssemblyLine, machineKey: "", startTime: "10:00", durationMinutes: 15 });
  const [planned, setPlanned] = useState<Planned[]>([]);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [holidayDraft, setHolidayDraft] = useState("");
  const [hydratedMonth, setHydratedMonth] = useState("");
  const [saveState, setSaveState] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const [showProductForm, setShowProductForm] = useState(false);
  const [productDraft, setProductDraft] = useState<ProductDraft>({ materialCode: "", family: "818", assemblyLine: "AL2", segment: "NON AUTO", bomAvailable: true, orderQty: 0, cycleTimes: [] });
  const [catalogState, setCatalogState] = useState<"saved" | "saving" | "error">("saved");
  const [twinRunning, setTwinRunning] = useState(true);
  const [twinSpeed, setTwinSpeed] = useState(25);
  const [twinTime, setTwinTime] = useState(0);
  const [twinView, setTwinView] = useState<"dashboard" | "production" | "trace" | "scenario" | "route" | "factory3d">("dashboard");
  const [twinLine, setTwinLine] = useState<AssemblyLine>("AL1");
  const [traceQuery, setTraceQuery] = useState("");
  const [traceFamily, setTraceFamily] = useState("all");
  const [selectedTwinStation, setSelectedTwinStation] = useState(0);
  const [twinHealth, setTwinHealth] = useState(98);
  const [downStations, setDownStations] = useState<string[]>([]);
  const [extraStations, setExtraStations] = useState<Array<{ id: string; name: string; cycle: number; machines: number; after: string }>>([]);
  const [stationDraft, setStationDraft] = useState({ name: "", cycle: 60, machines: 1, after: "" });
  const [routeOrder, setRouteOrder] = useState<string[]>([]);
  const [stationBooths, setStationBooths] = useState<Record<string, number>>({});
  const [feederStaged, setFeederStaged] = useState<Record<string, number>>({});
  const [feederProductCompleted, setFeederProductCompleted] = useState<Record<string, number>>({});
  const [feederShiftActual, setFeederShiftActual] = useState<Record<string, FeederShiftCheckpoint>>({});
  const [feederActualDraft, setFeederActualDraft] = useState({ date: "", planId: "", beforeLunchQuantity: "", endOfDayQuantity: "" });
  const [powderCoatingSent, setPowderCoatingSent] = useState<Record<string, number>>({});
  const [powderCoatingReturned, setPowderCoatingReturned] = useState<Record<string, number>>({});
  const [powderCoatingLeadDays, setPowderCoatingLeadDays] = useState(3);
  const [vendorDispatchCapacity, setVendorDispatchCapacity] = useState(2500);
  const [actualProduction, setActualProduction] = useState<ActualProduction[]>([]);
  const [actualDraft, setActualDraft] = useState({ date: "2026-08-01", planId: "", beforeLunchQuantity: "", endOfDayQuantity: "" });
  const [scheduleActualDraft, setScheduleActualDraft] = useState({ date: "2026-08-01", planId: "", beforeLunchQuantity: "", endOfDayQuantity: "" });
  const [editingActualId, setEditingActualId] = useState<string | null>(null);
  const [feederSaveState, setFeederSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [tubeCompletionOpen, setTubeCompletionOpen] = useState(true);
  const [powderTrackerOpen, setPowderTrackerOpen] = useState(true);
  const [workingHoursOpen, setWorkingHoursOpen] = useState(true);
  const [selectedDayPlanDate, setSelectedDayPlanDate] = useState("2026-08-01");
  const [selectedFeederDayPlanDate, setSelectedFeederDayPlanDate] = useState("2026-07-01");
  const [draggedStationId, setDraggedStationId] = useState<string | null>(null);
  const [dropStationId, setDropStationId] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<ChatMessage[]>([]);
  const [pendingAssistantAction, setPendingAssistantAction] = useState<AssistantAction | null>(null);
  const [assistantThinking, setAssistantThinking] = useState(false);

  useEffect(() => { fetch("/api/auth/session").then((response) => response.ok ? response.json() : { user: null }).then((payload: { user?: AuthUser | null }) => { setAuthUser(payload.user ?? null); setAuthChecked(true); }).catch(() => { setAuthUser(null); setAuthChecked(true); }); }, []);
  useEffect(() => { if (!authChecked || !authUser) return; Promise.all([
    fetch("/planner-data.json").then((r) => r.json()) as Promise<PlannerData>,
    fetch("/api/products").then((r) => r.ok ? r.json() : { customProducts: [], deletedProductIds: [] }) as Promise<CatalogPayload>,
    fetch("/skill-matrix.json").then((r) => r.ok ? r.json() : null) as Promise<SkillMatrix | null>,
  ]).then(([d, catalog, skills]) => {
    setSkillMatrix(skills);
    const custom = Array.isArray(catalog.customProducts) ? catalog.customProducts : [];
    const deleted = Array.isArray(catalog.deletedProductIds) ? catalog.deletedProductIds : [];
    setSourceProducts(d.products);
    setCustomProducts(custom);
    setDeletedProductIds(deleted);
    const mergedProducts = [...new Map([...d.products, ...custom].map((product) => [product.id, { ...product, assemblyLine: assemblyLineForProduct(product) }])).values()].filter((product) => !deleted.includes(product.id));
    setData({ ...d, products: mergedProducts, families: [...new Set(mergedProducts.map((product) => product.family))].sort() });
  }); }, [authChecked, authUser]);

  useEffect(() => {
    if (!authChecked || !authUser) return;
    fetch("/api/plans?list=1").then((response) => response.ok ? response.json() : { ranges: [] }).then((payload: { ranges?: string[] }) => setSavedRanges(Array.isArray(payload.ranges) ? payload.ranges : []));
  }, [authChecked, authUser]);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    setHydratedMonth("");
    setSaveState("loading");
    fetch(`/api/plans?month=${month}`).then(async (response) => {
      if (!response.ok) throw new Error("Unable to load saved plan");
      return response.json() as Promise<{ plan: SavedPlan | null }>;
    }).then(({ plan }) => {
      if (cancelled) return;
      if (plan) {
        setPlanned(Array.isArray(plan.planned) ? plan.planned.map((item) => { const fallback = new Date(`${startDate}T00:00:00`); fallback.setDate(fallback.getDate() + Math.max(0, (item.dueDay ?? 1) - 1)); const masterProduct = data.products.find((product) => product.id === item.id || product.materialCode === item.materialCode); return { ...item, assemblyLine: masterProduct ? assemblyLineForProduct(masterProduct) : assemblyLineForProduct(item), dueDate: item.dueDate || localDateKey(fallback) }; }) : []);
        setHolidays(Array.isArray(plan.holidays) ? plan.holidays : []);
        setHours(Number(plan.hours) || 16);
        setEfficiency(Number(plan.efficiency) || 60);
        setActualOee(Math.min(100, Math.max(1, Number(plan.actualOee) || 80)));
        setDailyShiftHours(plan.dailyShiftHours && typeof plan.dailyShiftHours === "object" ? plan.dailyShiftHours : {});
        setDailyAssemblyLines(plan.dailyAssemblyLines && typeof plan.dailyAssemblyLines === "object" ? plan.dailyAssemblyLines : {});
        setDailyProductionEdits(plan.dailyProductionEdits && typeof plan.dailyProductionEdits === "object" ? plan.dailyProductionEdits : {});
        setMachineOwners(plan.machineOwners && typeof plan.machineOwners === "object" ? plan.machineOwners : {});
        setPreventiveMaintenanceSlots(Array.isArray(plan.preventiveMaintenanceSlots) ? plan.preventiveMaintenanceSlots : []);
        setRouteOrder(Array.isArray(plan.routeOrder) ? plan.routeOrder : []);
        setStationBooths(plan.stationBooths && typeof plan.stationBooths === "object" ? plan.stationBooths : {});
        setFeederStaged(plan.feederStaged && typeof plan.feederStaged === "object" ? plan.feederStaged : {});
        setFeederProductCompleted(plan.feederProductCompleted && typeof plan.feederProductCompleted === "object" ? plan.feederProductCompleted : {});
        setFeederShiftActual(plan.feederShiftActual && typeof plan.feederShiftActual === "object" ? plan.feederShiftActual : {});
        setPowderCoatingSent(plan.powderCoatingSent && typeof plan.powderCoatingSent === "object" ? plan.powderCoatingSent : {});
        setPowderCoatingReturned(plan.powderCoatingReturned && typeof plan.powderCoatingReturned === "object" ? plan.powderCoatingReturned : {});
        setPowderCoatingLeadDays(Math.max(1, Number(plan.powderCoatingLeadDays) || 3));
        setVendorDispatchCapacity(Math.max(1, Number(plan.vendorDispatchCapacity) || 2500));
        setActualProduction(Array.isArray(plan.actualProduction) ? plan.actualProduction : []);
        setFeederSaveState("saved");
      } else {
        const seed = data.products.filter((p) => ["615", "818", "1021"].includes(p.family) && p.orderQty > 0).slice(0, 8);
        setPlanned(seed.map((p, i) => { const due = new Date(`${startDate}T00:00:00`); due.setDate(due.getDate() + 3 + i * 3); const cappedDue = due > new Date(`${endDate}T00:00:00`) ? new Date(`${endDate}T00:00:00`) : due; return { ...p, planId: `seed-${month}-${p.id}-${i}`, planQty: p.orderQty, dueDate: localDateKey(cappedDue), priority: i < 2 ? "High" : "Normal" }; }));
        setHolidays([]);
        setHours(16);
        setEfficiency(60);
        setActualOee(80);
        setDailyShiftHours({});
        setDailyAssemblyLines({});
        setDailyProductionEdits({});
        setMachineOwners({});
        setPreventiveMaintenanceSlots([]);
        setRouteOrder([]);
        setStationBooths({});
        setFeederStaged({});
        setFeederProductCompleted({});
        setFeederShiftActual({});
        setPowderCoatingSent({});
        setPowderCoatingReturned({});
        setPowderCoatingLeadDays(3);
        setVendorDispatchCapacity(2500);
        setActualProduction([]);
        setFeederSaveState("saved");
      }
      setHydratedMonth(month);
      setSaveState("saved");
    }).catch(() => { if (!cancelled) setSaveState("error"); });
    return () => { cancelled = true; };
  }, [dataReady, month]);

  useEffect(() => {
    if (hydratedMonth !== month || deletedPeriodsRef.current.has(month) || !savedRanges.includes(month)) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      if (deletedPeriodsRef.current.has(month)) return;
      const controller = new AbortController();
      planSaveAbortRef.current = controller;
      fetch("/api/plans", { method: "PUT", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ month, plan: { planned, holidays, hours, efficiency, actualOee, dailyShiftHours, dailyAssemblyLines, dailyProductionEdits, machineOwners, preventiveMaintenanceSlots, routeOrder, stationBooths, feederStaged, feederProductCompleted, feederShiftActual, powderCoatingSent, powderCoatingReturned, powderCoatingLeadDays, vendorDispatchCapacity, actualProduction } }) })
        .then((response) => { if (!response.ok) throw new Error("Save failed"); if (deletedPeriodsRef.current.has(month)) return; setSaveState("saved"); setSavedRanges((old) => old.includes(month) ? old : [...old, month].sort()); })
        .catch((error) => { if (error instanceof DOMException && error.name === "AbortError") return; setSaveState("error"); });
    }, 500);
    return () => { window.clearTimeout(timer); planSaveAbortRef.current?.abort(); };
  }, [planned, holidays, hours, efficiency, actualOee, dailyShiftHours, dailyAssemblyLines, dailyProductionEdits, machineOwners, preventiveMaintenanceSlots, routeOrder, stationBooths, feederStaged, feederProductCompleted, feederShiftActual, powderCoatingSent, powderCoatingReturned, powderCoatingLeadDays, vendorDispatchCapacity, actualProduction, month, hydratedMonth, savedRanges]);

  useEffect(() => {
    if (!twinRunning) return;
    const timer = window.setInterval(() => setTwinTime((value) => value + twinSpeed), 500);
    return () => window.clearInterval(timer);
  }, [twinRunning, twinSpeed]);

  useEffect(() => { setTwinTime(0); }, [twinLine]);

  useEffect(() => {
    const isCompletionInput = (target: EventTarget | null): target is HTMLInputElement => target instanceof HTMLInputElement && target.matches(".product-completion-entry input[type='number'], input[aria-label='Vendor transport capacity']");
    const selectExistingValue = (event: FocusEvent) => { if (isCompletionInput(event.target)) event.target.select(); };
    const blockNonIntegers = (event: KeyboardEvent) => { if (isCompletionInput(event.target) && [".", ",", "-", "+", "e", "E"].includes(event.key)) event.preventDefault(); };
    const rejectInvalidPaste = (event: ClipboardEvent) => {
      if (isCompletionInput(event.target) && !/^\d+$/.test(event.clipboardData?.getData("text") ?? "")) event.preventDefault();
    };
    document.addEventListener("focusin", selectExistingValue);
    document.addEventListener("keydown", blockNonIntegers, true);
    document.addEventListener("paste", rejectInvalidPaste, true);
    return () => {
      document.removeEventListener("focusin", selectExistingValue);
      document.removeEventListener("keydown", blockNonIntegers, true);
      document.removeEventListener("paste", rejectInvalidPaste, true);
    };
  }, []);

  const products = useMemo(() => (data?.products ?? []).filter((p) => selectedFamilies.includes(p.family) && p.materialCode.toLowerCase().includes(query.toLowerCase())), [data, selectedFamilies, query]);
  const totalUnits = planned.reduce((s, p) => s + p.planQty, 0);
  const actualAllocationByPlan = useMemo(() => {
    const remainingActual = new Map<string, number>();
    actualProduction.forEach((record) => remainingActual.set(record.materialCode, (remainingActual.get(record.materialCode) ?? 0) + record.quantity));
    const allocation = new Map<string, number>();
    [...planned].sort((a, b) => (a.priority === b.priority ? a.dueDate.localeCompare(b.dueDate) : a.priority === "High" ? -1 : 1)).forEach((product) => {
      const allocated = Math.min(product.planQty, remainingActual.get(product.materialCode) ?? 0);
      allocation.set(product.planId, allocated);
      remainingActual.set(product.materialCode, Math.max(0, (remainingActual.get(product.materialCode) ?? 0) - allocated));
    });
    return allocation;
  }, [planned, actualProduction]);
  const assemblyRequiredByPlan = useMemo(() => new Map(planned.map((product) => [product.planId, Math.max(0, product.planQty - (actualAllocationByPlan.get(product.planId) ?? 0))])), [planned, actualAllocationByPlan]);
  const totalAssemblyRequirement = [...assemblyRequiredByPlan.values()].reduce((sum, quantity) => sum + quantity, 0);
  const averageShiftHours = useMemo(() => {
    const from = new Date(`${startDate}T00:00:00`); const to = new Date(`${endDate}T00:00:00`); const offDates = new Set(holidays); const values: number[] = [];
    for (let cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) if (!isNonWorkingDay(cursor, offDates)) values.push(dailyShiftHours[localDateKey(cursor)] ?? hours);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : hours;
  }, [startDate, endDate, holidays, dailyShiftHours, hours]);
  const availableSeconds = averageShiftHours * 3600 * (efficiency / 100);
  const loadByMachine = useMemo(() => (data?.machines ?? []).map((m, i) => {
    if (i < ASSEMBLY_START_INDEX) {
      const seconds = planned.reduce((s, p) => s + p.planQty * (p.cycleTimes[i] || 0), 0);
      const booths = configuredBooths(stationBooths, m.key, i);
      return { ...m, index: i, line: null as AssemblyLine | null, seconds, booths, days: seconds / (availableSeconds * booths) };
    }
    const lineLoads = (["AL1", "AL2"] as AssemblyLine[]).map((line) => {
      const seconds = planned.filter((product) => assemblyLineForProduct(product) === line).reduce((sum, product) => {
        const completed = actualAllocationByPlan.get(product.planId) ?? 0;
        return sum + Math.max(0, product.planQty - completed) * (product.cycleTimes[i] || 0);
      }, 0);
      const booths = configuredBooths(stationBooths, m.key, i, line);
      return { line, seconds, booths, days: seconds / (availableSeconds * booths) };
    }).sort((a, b) => b.days - a.days);
    return { ...m, index: i, ...lineLoads[0] };
  }).sort((a, b) => b.days - a.days), [data, planned, actualAllocationByPlan, availableSeconds, stationBooths]);
  const assemblyLoadByMachine = loadByMachine.filter((machine) => machine.index >= ASSEMBLY_START_INDEX);
  const assemblyBottleneck = assemblyLoadByMachine[0];
  const maxLoad = assemblyBottleneck?.days || 0;
  const date = new Date(`${startDate}T00:00:00`);
  const periodEnd = new Date(`${endDate}T00:00:00`);
  const daysInMonth = Math.max(1, Math.floor((periodEnd.getTime() - date.getTime()) / 86400000) + 1);
  const holidaySet = useMemo(() => new Set(holidays), [holidays]);
  const workingDays = Array.from({ length: daysInMonth }, (_, i) => i).filter((offset) => {
    const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
    return !isNonWorkingDay(candidate, holidaySet);
  }).length;
  const loadPct = Math.round((maxLoad / workingDays) * 100);
  const feederMonthStart = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const feederMonthEnd = new Date(date.getFullYear(), date.getMonth(), 0);
  const feederWorkingDays = Array.from({ length: feederMonthEnd.getDate() }, (_, offset) => new Date(feederMonthStart.getFullYear(), feederMonthStart.getMonth(), offset + 1)).filter((candidate) => !isNonWorkingDay(candidate, holidaySet)).length;
  const feederMonthLabel = monthName.format(feederMonthStart);
  const feederTargets = useMemo(() => (data?.machines ?? []).map((machine, index) => {
    if (index >= ASSEMBLY_START_INDEX) return null;
    const requiredQuantity = planned.reduce((sum, product) => sum + ((product.cycleTimes[index] || 0) > 0 ? (assemblyRequiredByPlan.get(product.planId) ?? 0) : 0), 0);
    const requiredSeconds = planned.reduce((sum, product) => sum + (assemblyRequiredByPlan.get(product.planId) ?? 0) * (product.cycleTimes[index] || 0), 0);
    const booths = Math.max(1, stationBooths[machine.key] ?? TUBE_SHOP_AVAILABLE_STATIONS[machine.key] ?? 1);
    const stagedQuantity = Math.min(requiredQuantity, Math.max(0, feederStaged[machine.key] ?? 0));
    const actualCycleTimes = [...new Set(planned.map((product) => product.cycleTimes[index] || 0).filter((seconds) => seconds > 0))].sort((a, b) => a - b);
    const requiredHours = requiredSeconds / (3600 * booths);
    return { ...machine, name: `${machine.name} · ${booths} STN`, index, shop: "Tube Shop", requiredQuantity, stagedQuantity, requiredSeconds, requiredHours, actualCycleTimes, booths, days: requiredSeconds / (availableSeconds * booths), ready: requiredQuantity === 0 || stagedQuantity >= requiredQuantity };
  }).filter((target): target is NonNullable<typeof target> => Boolean(target && target.requiredQuantity > 0)), [data, planned, assemblyRequiredByPlan, stationBooths, feederStaged, availableSeconds]);
  const feederShiftActualByPlan = useMemo(() => {
    const totals = new Map<string, number>();
    Object.entries(feederShiftActual).forEach(([key, checkpoint]) => { const planId = key.slice(key.indexOf(":") + 1); const quantity = checkpoint.endOfDayQuantity ?? checkpoint.beforeLunchQuantity ?? 0; totals.set(planId, (totals.get(planId) ?? 0) + quantity); });
    return totals;
  }, [feederShiftActual]);
  const feederShopSummary = useMemo(() => ["Tube Shop"].map((shop) => {
    const targets = feederTargets.filter((target) => target.shop === shop);
    const requiredQuantity = targets.reduce((sum, target) => sum + target.requiredQuantity, 0);
    const stagedQuantity = targets.reduce((sum, target) => sum + target.stagedQuantity, 0);
    const days = Math.max(0, ...targets.map((target) => target.days));
    const completedItems = planned.reduce((sum, product) => sum + Math.min(assemblyRequiredByPlan.get(product.planId) ?? 0, Math.max(0, feederShiftActualByPlan.get(product.planId) ?? 0)), 0);
    const completionRatio = totalAssemblyRequirement ? completedItems / totalAssemblyRequirement : 0;
    const monthlyCapacity = days ? Math.floor(totalAssemblyRequirement * feederWorkingDays / days) : 0;
    const bottleneck = targets.find((target) => target.days === days);
    const productRows = planned.map((product) => {
      const processes = targets.map((target) => ({ target, cycleSeconds: product.cycleTimes[target.index] || 0 })).filter((item) => item.cycleSeconds > 0);
      const productBottleneck = processes.reduce<{ target: typeof targets[number]; cycleSeconds: number; effectiveSeconds: number } | null>((slowest, item) => {
        const effectiveSeconds = item.cycleSeconds / item.target.booths;
        return !slowest || effectiveSeconds > slowest.effectiveSeconds ? { ...item, effectiveSeconds } : slowest;
      }, null);
      const requirementQty = assemblyRequiredByPlan.get(product.planId) ?? 0;
      const requiredHours = productBottleneck ? requirementQty * productBottleneck.effectiveSeconds / 3600 : 0;
      return { planId: product.planId, materialCode: product.materialCode, family: product.family, assemblyLine: assemblyLineForProduct(product), planQty: requirementQty, dueDate: product.dueDate, processes, productBottleneck, requiredHours, completedItems: Math.min(requirementQty, Math.max(0, feederShiftActualByPlan.get(product.planId) ?? 0)) };
    }).filter((product) => product.processes.length > 0);
    return { shop, targets, productRows, requiredQuantity, stagedQuantity, completionRatio, completedItems, monthlyCapacity, bottleneck, days, ready: totalAssemblyRequirement === 0 || completedItems >= totalAssemblyRequirement };
  }), [feederTargets, totalAssemblyRequirement, feederWorkingDays, planned, assemblyRequiredByPlan, feederShiftActualByPlan]);
  const feederDurationDays = Math.max(0, ...feederShopSummary.map((shop) => shop.days));
  const feederSupportedByPlan = useMemo(() => new Map(planned.map((product) => {
    const requirementQty = assemblyRequiredByPlan.get(product.planId) ?? 0;
    const tubeCompleted = Math.min(requirementQty, Math.max(0, feederShiftActualByPlan.get(product.planId) ?? 0));
    const sent = Math.min(tubeCompleted, Math.max(0, powderCoatingSent[product.planId] ?? 0));
    const returned = Math.min(sent, Math.max(0, powderCoatingReturned[product.planId] ?? 0));
    return [product.planId, returned];
  })), [planned, assemblyRequiredByPlan, feederShiftActualByPlan, powderCoatingSent, powderCoatingReturned]);
  const tubeShopProductStatuses = useMemo(() => {
    const grouped = new Map<string, { materialCode: string; family: string; assemblyLine: AssemblyLine; planIds: string[]; required: number; tubeCompleted: number; sent: number; returned: number }>();
    planned.forEach((product) => {
      const required = assemblyRequiredByPlan.get(product.planId) ?? 0;
      const tubeCompleted = Math.min(required, Math.max(0, feederShiftActualByPlan.get(product.planId) ?? 0));
      const sent = Math.min(tubeCompleted, Math.max(0, powderCoatingSent[product.planId] ?? 0));
      const returned = Math.min(sent, Math.max(0, powderCoatingReturned[product.planId] ?? 0));
      const current = grouped.get(product.materialCode) ?? { materialCode: product.materialCode, family: product.family, assemblyLine: assemblyLineForProduct(product), planIds: [], required: 0, tubeCompleted: 0, sent: 0, returned: 0 };
      current.planIds.push(product.planId);
      current.required += required;
      current.tubeCompleted += tubeCompleted;
      current.sent += sent;
      current.returned += returned;
      grouped.set(product.materialCode, current);
    });
    return Array.from(grouped.values()).map((product) => ({ ...product, readyForPowderCoating: Math.max(0, product.tubeCompleted - product.sent), atVendor: Math.max(0, product.sent - product.returned) }));
  }, [planned, assemblyRequiredByPlan, feederShiftActualByPlan, powderCoatingSent, powderCoatingReturned]);
  const feederProducibleQuantity = [...feederSupportedByPlan.values()].reduce((sum, quantity) => sum + quantity, 0);
  const feederCompletionRatio = totalUnits ? feederProducibleQuantity / totalUnits : 0;
  const feederReadyDate = feederDurationDays > 0 ? addWorkingDays(feederMonthStart, Math.max(0, Math.ceil(feederDurationDays) - 1), holidaySet) : feederMonthStart;
  const feederCapacityOk = feederDurationDays <= feederWorkingDays && feederReadyDate <= feederMonthEnd;
  // Keep the original month-start plan as the calendar baseline. Actual output
  // reduces the open balance from the end of the schedule; resetting a day can
  // therefore restore that date's original planned quantity exactly.
  const feederRemainingPlanStart = feederMonthStart;
  const feederProductiveSecondsForDate = (value: Date) => isNonWorkingDay(value, holidaySet) ? 0 : (dailyShiftHours[localDateKey(value)] ?? hours) * 3600 * (efficiency / 100);
  const feederElapsedCapacityBeforeDate = (target: Date) => { let total = 0; for (let cursor = new Date(feederRemainingPlanStart); cursor < target; cursor.setDate(cursor.getDate() + 1)) total += feederProductiveSecondsForDate(cursor); return total; };
  const feederCapacityPosition = (elapsedSeconds: number) => {
    let remaining = Math.max(0, elapsedSeconds); const cursor = new Date(feederRemainingPlanStart);
    for (let guard = 0; guard < 3660; guard += 1, cursor.setDate(cursor.getDate() + 1)) { const capacity = feederProductiveSecondsForDate(cursor); if (capacity > 0 && remaining < capacity) return { date: new Date(cursor), within: remaining, capacity }; if (capacity > 0) remaining -= capacity; }
    return { date: new Date(cursor), within: 0, capacity: Math.max(1, availableSeconds) };
  };
  const feederDateSchedule = useMemo(() => {
    let tubeShopElapsedSeconds = 0;
    return [...planned].sort((a, b) => (a.priority === b.priority ? a.dueDate.localeCompare(b.dueDate) : a.priority === "High" ? -1 : 1)).map((product) => {
      const feederLane = assemblyLineForProduct(product);
      const requirementQty = Math.max(0, (assemblyRequiredByPlan.get(product.planId) ?? 0) - (feederShiftActualByPlan.get(product.planId) ?? 0));
      const processes = product.cycleTimes.slice(0, ASSEMBLY_START_INDEX).map((seconds, index) => { const machineKey = data?.machines[index]?.key ?? ""; return { seconds, index, booths: Math.max(1, stationBooths[machineKey] ?? TUBE_SHOP_AVAILABLE_STATIONS[machineKey] ?? 1), name: data?.machines[index]?.name ?? "—" }; }).filter((process) => process.seconds > 0);
      const bottleneck = processes.reduce<(typeof processes)[number] | null>((slowest, process) => !slowest || process.seconds / process.booths > slowest.seconds / slowest.booths ? process : slowest, null);
      const effectiveSeconds = Math.max(1, bottleneck ? bottleneck.seconds / bottleneck.booths : 1);
      const startOffsetSeconds = tubeShopElapsedSeconds;
      const workloadSeconds = requirementQty * effectiveSeconds;
      const finishOffsetSeconds = startOffsetSeconds + workloadSeconds;
      const startPosition = feederCapacityPosition(startOffsetSeconds);
      const finishPosition = feederCapacityPosition(Math.max(startOffsetSeconds, finishOffsetSeconds - (workloadSeconds > 0 ? 0.0001 : 0)));
      const start = startPosition.date;
      const finish = requirementQty > 0 ? finishPosition.date : new Date(start.getTime() - 86400000);
      if (requirementQty > 0) tubeShopElapsedSeconds = finishOffsetSeconds;
      return { ...product, feederLane, requirementQty, bottleneckName: bottleneck ? `${bottleneck.name} · ${bottleneck.booths} station${bottleneck.booths === 1 ? "" : "s"}` : "—", effectiveSeconds, dailyCapacity: Math.floor(startPosition.capacity / effectiveSeconds), startOffsetSeconds, finishOffsetSeconds, start, finish };
    });
  }, [planned, assemblyRequiredByPlan, feederShiftActualByPlan, stationBooths, data, availableSeconds, feederMonthStart, feederRemainingPlanStart, holidaySet, dailyShiftHours, hours, efficiency]);
  const feederLatestFinish = feederDateSchedule.reduce((latest, item) => item.finish > latest ? item.finish : latest, feederMonthEnd);
  const feederCalendarEnd = feederLatestFinish > feederMonthEnd ? new Date(feederLatestFinish.getFullYear(), feederLatestFinish.getMonth() + 1, 0) : feederMonthEnd;
  const feederCalendarDays = Math.max(1, Math.floor((feederCalendarEnd.getTime() - feederMonthStart.getTime()) / 86400000) + 1);
  const feederCalendarLabel = feederCalendarEnd > feederMonthEnd ? `${feederMonthLabel} – ${monthName.format(feederCalendarEnd)}` : feederMonthLabel;
  const feederDailyPlan = useMemo(() => Array.from({ length: feederCalendarDays }, (_, offset) => {
    const value = new Date(feederMonthStart.getFullYear(), feederMonthStart.getMonth(), feederMonthStart.getDate() + offset);
    const key = localDateKey(value);
    const off = isNonWorkingDay(value, holidaySet);
    const dayStartSeconds = feederElapsedCapacityBeforeDate(value);
    const dayCapacitySeconds = feederProductiveSecondsForDate(value);
    const entries = off || value < feederRemainingPlanStart ? [] : feederDateSchedule.flatMap((item) => {
      const overlapSeconds = Math.max(0, Math.min(item.finishOffsetSeconds, dayStartSeconds + dayCapacitySeconds) - Math.max(item.startOffsetSeconds, dayStartSeconds));
      if (overlapSeconds <= 0 || item.requirementQty <= 0) return [];
      return [{ planId: item.planId, materialCode: item.materialCode, family: item.family, quantity: Math.min(item.requirementQty, Math.max(1, Math.round(overlapSeconds / item.effectiveSeconds))), bottleneckName: item.bottleneckName }];
    });
    return { value, key, off, entries, total: entries.reduce((sum, entry) => sum + entry.quantity, 0) };
  }), [feederCalendarDays, feederMonthStart, feederRemainingPlanStart, holidaySet, availableSeconds, feederDateSchedule, dailyShiftHours, hours, efficiency]);
  const feederHasOverflow = feederCalendarEnd > feederMonthEnd;
  const feederNextMonthLabel = feederHasOverflow ? monthName.format(new Date(feederMonthEnd.getFullYear(), feederMonthEnd.getMonth() + 1, 1)) : "—";
  const feederOverflowQuantity = feederDailyPlan.filter((day) => day.value > feederMonthEnd).reduce((sum, day) => sum + day.total, 0);
  const feederDailyWorkingHourSuggestions = useMemo(() => feederDailyPlan.map((day) => {
    const workloadSeconds = day.entries.reduce((sum, entry) => {
      const scheduled = feederDateSchedule.find((item) => item.planId === entry.planId);
      return sum + entry.quantity * Math.max(0, scheduled?.effectiveSeconds ?? 0);
    }, 0);
    const suggestedHours = day.off || workloadSeconds <= 0 ? 0 : Math.ceil((workloadSeconds / (3600 * Math.max(.01, efficiency / 100))) * 2) / 2;
    const products = [...new Set(day.entries.map((entry) => entry.materialCode))];
    const bottlenecks = [...new Set(day.entries.map((entry) => entry.bottleneckName))];
    const status = day.off ? "OFF" : workloadSeconds <= 0 ? "NO PRODUCTION" : suggestedHours > hours ? "EXTENDED SHIFT" : "REGULAR SHIFT";
    return { ...day, workloadSeconds, suggestedHours, products, bottlenecks, status };
  }), [feederDailyPlan, feederDateSchedule, efficiency, hours]);
  const feederCalendarProductRows = useMemo(() => {
    const grouped = new Map<string, typeof feederDateSchedule>();
    feederDateSchedule.forEach((item) => grouped.set(item.materialCode, [...(grouped.get(item.materialCode) ?? []), item]));
    return Array.from(grouped, ([materialCode, items]) => ({ materialCode, items, planIds: new Set(items.map((item) => item.planId)), requiredQuantity: items.reduce((sum, item) => sum + item.requirementQty, 0), family: items[0]?.family ?? "—" }));
  }, [feederDateSchedule]);
  const feederTimeWiseWorkingDays = useMemo(() => feederDailyPlan.filter((day) => !day.off), [feederDailyPlan]);
  const selectedFeederDayExists = feederTimeWiseWorkingDays.some((day) => day.key === selectedFeederDayPlanDate);
  const firstFeederProductionDay = feederTimeWiseWorkingDays.find((day) => day.entries.length > 0);
  const activeFeederDayPlanKey = selectedFeederDayExists ? selectedFeederDayPlanDate : firstFeederProductionDay?.key ?? feederTimeWiseWorkingDays[0]?.key ?? localDateKey(feederMonthStart);
  const activeFeederDayPlan = feederDailyPlan.find((day) => day.key === activeFeederDayPlanKey);
  const activeFeederActualEntries = useMemo(() => Object.entries(feederShiftActual).flatMap(([key, checkpoint]) => {
    if (!key.startsWith(`${activeFeederDayPlanKey}:`)) return [];
    const planId = key.slice(key.indexOf(":") + 1); const scheduled = feederDateSchedule.find((item) => item.planId === planId); const quantity = checkpoint.endOfDayQuantity ?? checkpoint.beforeLunchQuantity ?? 0;
    if (!scheduled || quantity <= 0) return [];
    return [{ planId, materialCode: scheduled.materialCode, family: scheduled.family, quantity, bottleneckName: scheduled.bottleneckName, historicalActual: true }];
  }), [feederShiftActual, activeFeederDayPlanKey, feederDateSchedule]);
  const activeFeederDisplayEntries = useMemo(() => {
    const plannedEntries = activeFeederDayPlan?.entries ?? [];
    return [...plannedEntries, ...activeFeederActualEntries.filter((actual) => !plannedEntries.some((plannedEntry) => plannedEntry.planId === actual.planId))];
  }, [activeFeederDayPlan, activeFeederActualEntries]);
  const activeFeederActualTotal = activeFeederActualEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  const feederTimeWiseDayPlan = useMemo(() => {
    let elapsedProductiveSeconds = 0;
    return activeFeederDisplayEntries.map((entry) => {
      const scheduled = feederDateSchedule.find((item) => item.planId === entry.planId);
      const effectiveCycleSeconds = Math.max(1, scheduled?.effectiveSeconds ?? 1);
      const durationProductiveSeconds = entry.quantity * effectiveCycleSeconds;
      const startWorkMinutes = elapsedProductiveSeconds / Math.max(.01, efficiency / 100) / 60;
      const durationMinutes = durationProductiveSeconds / Math.max(.01, efficiency / 100) / 60;
      elapsedProductiveSeconds += durationProductiveSeconds;
      return { ...entry, effectiveCycleSeconds, startWorkMinutes, durationMinutes, clockStartMinute: productiveMinuteToClockMinute(startWorkMinutes), clockEndMinute: productiveMinuteToClockMinute(startWorkMinutes + durationMinutes), clockStart: productiveMinuteLabel(startWorkMinutes), clockEnd: productiveMinuteLabel(startWorkMinutes + durationMinutes) };
    });
  }, [activeFeederDisplayEntries, feederDateSchedule, efficiency]);
  const feederTimeWiseAgendaBlocks = useMemo(() => feederTimeWiseDayPlan.flatMap((item) => {
    const workWindows = [[8 * 60, 12 * 60 + 30], [13 * 60, 16 * 60], [16 * 60 + 10, Number.POSITIVE_INFINITY]];
    return workWindows.flatMap(([windowStart, windowEnd], windowIndex) => {
      const startMinute = Math.max(item.clockStartMinute, windowStart);
      const endMinute = Math.min(item.clockEndMinute, windowEnd);
      if (endMinute <= startMinute) return [];
      const segmentMinutes = endMinute - startMinute;
      return [{ ...item, startMinute, endMinute, segmentQuantity: Math.max(1, Math.round(item.quantity * segmentMinutes / Math.max(1, item.durationMinutes))), windowIndex }];
    });
  }), [feederTimeWiseDayPlan]);
  const vendorDispatchPlan = useMemo(() => {
    const availableBatches = feederDailyPlan.flatMap((day) => day.entries.map((entry) => ({ ...entry, tubeCompletionDate: day.value })));
    const loads: Array<{ loadNumber: number; items: Array<{ planId: string; materialCode: string; family: string; quantity: number }>; quantity: number; utilization: number; latestTubeCompletion: Date; dispatchDate: Date; expectedReturnDate: Date }> = [];
    let items: Array<{ planId: string; materialCode: string; family: string; quantity: number }> = [];
    let quantity = 0;
    let latestTubeCompletion = feederMonthStart;
    const closeLoad = () => {
      if (!quantity) return;
      const nextDate = new Date(latestTubeCompletion);
      nextDate.setDate(nextDate.getDate() + 1);
      const dispatchDate = nextWorkingDay(nextDate, holidaySet);
      loads.push({ loadNumber: loads.length + 1, items, quantity, utilization: Math.round(quantity / vendorDispatchCapacity * 100), latestTubeCompletion, dispatchDate, expectedReturnDate: addWorkingDays(dispatchDate, powderCoatingLeadDays, holidaySet) });
      items = []; quantity = 0;
    };
    availableBatches.forEach((batch) => {
      let remaining = batch.quantity;
      while (remaining > 0) {
        const loaded = Math.min(remaining, vendorDispatchCapacity - quantity);
        items.push({ planId: batch.planId, materialCode: batch.materialCode, family: batch.family, quantity: loaded });
        quantity += loaded;
        if (batch.tubeCompletionDate > latestTubeCompletion) latestTubeCompletion = batch.tubeCompletionDate;
        remaining -= loaded;
        if (quantity >= vendorDispatchCapacity) closeLoad();
      }
    });
    closeLoad();
    return loads;
  }, [feederDailyPlan, feederMonthStart, holidaySet, powderCoatingLeadDays, vendorDispatchCapacity]);
  const requestedAssemblyStart = nextWorkingDay(date, holidaySet);
  // Assembly planning always begins on Working Day 1 of the selected period.
  // Late Tube Shop readiness is shown as a warning and does not shift the plan baseline.
  const assemblyReleaseDate = requestedAssemblyStart;
  const productiveSecondsForDate = (value: Date, assemblyLine?: AssemblyLine) => {
    if (isNonWorkingDay(value, holidaySet)) return 0;
    const dateKey = localDateKey(value);
    const maintenanceMinutes = preventiveMaintenanceSlots.filter((slot) => slot.date === dateKey && (!assemblyLine || slot.assemblyLine === assemblyLine)).reduce((sum, slot) => sum + slot.durationMinutes, 0);
    return Math.max(0, (dailyShiftHours[dateKey] ?? hours) * 3600 - maintenanceMinutes * 60) * (efficiency / 100);
  };
  const elapsedCapacityBeforeDate = (target: Date, assemblyLine?: AssemblyLine) => {
    let total = 0;
    for (let cursor = new Date(assemblyReleaseDate); cursor < target; cursor.setDate(cursor.getDate() + 1)) total += productiveSecondsForDate(cursor, assemblyLine);
    return total;
  };
  const capacityPosition = (elapsedSeconds: number, assemblyLine?: AssemblyLine) => {
    let remaining = Math.max(0, elapsedSeconds);
    const cursor = new Date(assemblyReleaseDate);
    for (let guard = 0; guard < 3660; guard += 1, cursor.setDate(cursor.getDate() + 1)) {
      const capacity = productiveSecondsForDate(cursor, assemblyLine);
      if (capacity > 0 && remaining < capacity) return { date: new Date(cursor), within: remaining, capacity };
      if (capacity > 0) remaining -= capacity;
    }
    return { date: new Date(cursor), within: 0, capacity: Math.max(1, availableSeconds) };
  };
  const allFeedersStaged = feederShopSummary.every((shop) => shop.ready);
  const updatePowderProductTotal = (materialCode: string, field: "sent" | "returned", requestedValue: number) => {
    const matchingPlans = planned.filter((product) => product.materialCode === materialCode);
    let remaining = Math.max(0, Math.trunc(requestedValue));
    if (field === "sent") {
      const nextSent = { ...powderCoatingSent };
      const nextReturned = { ...powderCoatingReturned };
      matchingPlans.forEach((product) => {
        const required = assemblyRequiredByPlan.get(product.planId) ?? 0;
        const tubeCompleted = Math.min(required, Math.max(0, feederShiftActualByPlan.get(product.planId) ?? 0));
        const allocation = Math.min(tubeCompleted, remaining);
        nextSent[product.planId] = allocation;
        nextReturned[product.planId] = Math.min(nextReturned[product.planId] ?? 0, allocation);
        remaining -= allocation;
      });
      setPowderCoatingSent(nextSent);
      setPowderCoatingReturned(nextReturned);
    } else {
      const nextReturned = { ...powderCoatingReturned };
      matchingPlans.forEach((product) => {
        const sent = Math.max(0, powderCoatingSent[product.planId] ?? 0);
        const allocation = Math.min(sent, remaining);
        nextReturned[product.planId] = allocation;
        remaining -= allocation;
      });
      setPowderCoatingReturned(nextReturned);
    }
    setFeederSaveState("dirty");
  };
  const saveFeederPlan = async () => {
    setFeederSaveState("saving");
    try {
      const response = await fetch("/api/plans", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ month, plan: { planned, holidays, hours, efficiency, actualOee, dailyShiftHours, dailyAssemblyLines, dailyProductionEdits, machineOwners, preventiveMaintenanceSlots, routeOrder, stationBooths, feederStaged, feederProductCompleted, feederShiftActual, powderCoatingSent, powderCoatingReturned, powderCoatingLeadDays, vendorDispatchCapacity, actualProduction } }) });
      if (!response.ok) throw new Error("Unable to save feeder plan");
      setFeederSaveState("saved");
      setSaveState("saved");
    } catch {
      setFeederSaveState("error");
    }
  };
  const schedule = useMemo(() => {
    const lineElapsedSeconds = new Map<AssemblyLine, number>([["AL1", 0], ["AL2", 0]]);
    const orderedPlans = [...planned].sort((a, b) => (a.priority === b.priority ? a.dueDate.localeCompare(b.dueDate) : a.priority === "High" ? -1 : 1));
    return orderedPlans.map((product) => {
      const assemblyLine = assemblyLineForProduct(product);
      const feederSupportedQty = feederSupportedByPlan.get(product.planId) ?? 0;
      const actualCompletedQty = actualAllocationByPlan.get(product.planId) ?? 0;
      const remainingQty = Math.max(0, product.planQty - actualCompletedQty);
      const effectiveProcesses = product.cycleTimes.map((seconds, index) => {
        const machine = data?.machines[index];
        const booths = index >= ASSEMBLY_START_INDEX ? planningBooths(stationBooths, machine?.key ?? "", index) : 1;
        return { index, machine, booths, effectiveSeconds: index >= ASSEMBLY_START_INDEX ? seconds / booths : 0 };
      }).filter((process) => process.effectiveSeconds > 0);
      const effectiveBottleneck = effectiveProcesses.reduce<(typeof effectiveProcesses)[number] | null>((slowest, process) => !slowest || process.effectiveSeconds > slowest.effectiveSeconds ? process : slowest, null);
      const effectiveBottleneckSeconds = Math.max(1, effectiveBottleneck?.effectiveSeconds ?? 1);
      const startOffsetSeconds = lineElapsedSeconds.get(assemblyLine) ?? 0;
      const startPosition = capacityPosition(startOffsetSeconds, assemblyLine);
      const dailyCapacity = Math.max(1, Math.floor(startPosition.capacity / effectiveBottleneckSeconds));
      // Actual shop-floor output reduces the open load without changing the
      // line's original planning-period start. Freed capacity pulls subsequent
      // work forward instead of shifting the whole plan to the actual-entry date.
      const predictionQty = remainingQty;
      const exactDurationDays = predictionQty > 0 ? predictionQty * effectiveBottleneckSeconds / availableSeconds : 0;
      const workloadSeconds = predictionQty * effectiveBottleneckSeconds;
      const finishOffsetSeconds = startOffsetSeconds + workloadSeconds;
      const finishPosition = capacityPosition(Math.max(startOffsetSeconds, finishOffsetSeconds - (workloadSeconds > 0 ? 0.0001 : 0)), assemblyLine);
      const start = startPosition.date;
      const finish = predictionQty > 0 ? finishPosition.date : new Date(start.getTime() - 86400000);
      const startWithinShiftSeconds = startPosition.within;
      const finishWithinShiftSeconds = workloadSeconds > 0 ? Math.min(finishPosition.capacity, finishPosition.within + 0.0001) : 0;
      const duration = predictionQty > 0 ? workingDaysBetween(start, finish, holidaySet) + 1 : 0;
      const due = new Date(`${product.dueDate}T00:00:00`);
      const lateDays = Math.max(0, Math.ceil((finish.getTime() - due.getTime()) / 86400000));
      if (duration > 0) lineElapsedSeconds.set(assemblyLine, finishOffsetSeconds);
      return { ...product, requestedPlanQty: product.planQty, actualCompletedQty, remainingQty, predictionQty, planQty: feederSupportedQty, feederSupportedQty, feederPendingQty: Math.max(0, product.planQty - feederSupportedQty), assemblyLine, effectiveBottleneckSeconds, effectiveBottleneckMachine: effectiveBottleneck?.machine?.name ?? "—", effectiveBottleneckBooths: effectiveBottleneck?.booths ?? 1, dailyCapacity, exactDurationDays, workloadSeconds, startOffsetSeconds, finishOffsetSeconds, startWithinShiftSeconds, finishWithinShiftSeconds, duration, start, finish, due, lateDays, onTime: remainingQty === 0 || finish <= due };
    });
  }, [planned, availableSeconds, holidaySet, stationBooths, data, assemblyReleaseDate, feederSupportedByPlan, actualAllocationByPlan, dailyShiftHours, hours, efficiency, preventiveMaintenanceSlots]);
  const selectedLineSchedule = useMemo(() => schedule.filter((item) => item.assemblyLine === scheduleLine), [schedule, scheduleLine]);
  useEffect(() => {
    if (!schedule.length || !Object.keys(dailyAssemblyLines).length) return;
    const next = { ...dailyAssemblyLines };
    let changed = false;
    Object.entries(dailyAssemblyLines).forEach(([key, destinationLine]) => {
      const separator = key.indexOf(":");
      const dateKey = key.slice(0, separator);
      const planId = key.slice(separator + 1);
      const movedItem = schedule.find((item) => item.planId === planId);
      if (!movedItem || movedItem.assemblyLine === destinationLine) return;
      const selectedDate = new Date(`${dateKey}T00:00:00`);
      schedule.forEach((item) => {
        const conflictKey = `${dateKey}:${item.planId}`;
        const effectiveConflictLine = next[conflictKey] ?? item.assemblyLine;
        if (item.planId !== planId && item.remainingQty > 0 && selectedDate >= item.start && selectedDate <= item.finish && effectiveConflictLine === destinationLine) {
          next[conflictKey] = movedItem.assemblyLine;
          changed = true;
        }
      });
    });
    if (changed) setDailyAssemblyLines(next);
  }, [schedule, dailyAssemblyLines]);
  const scheduleActualDate = scheduleActualDraft.date >= startDate && scheduleActualDraft.date <= endDate ? scheduleActualDraft.date : startDate;
  const scheduleActualProducts = useMemo(() => {
    const selectedDate = new Date(`${scheduleActualDate}T00:00:00`);
    if (isNonWorkingDay(selectedDate, holidaySet)) return [];
    return selectedLineSchedule.filter((item) => item.remainingQty > 0 && selectedDate >= item.start && selectedDate <= item.finish);
  }, [selectedLineSchedule, scheduleActualDate, holidaySet]);
  const actualLineSchedule = useMemo(() => schedule.filter((item) => item.assemblyLine === actualLine), [schedule, actualLine]);
  const actualLineProduction = useMemo(() => actualProduction.filter((item) => item.assemblyLine === actualLine), [actualProduction, actualLine]);
  const selectedLineCalendarRows = useMemo(() => {
    const grouped = new Map<string, typeof schedule>();
    schedule.forEach((item) => grouped.set(item.materialCode, [...(grouped.get(item.materialCode) ?? []), item]));
    return Array.from(grouped, ([materialCode, items]) => ({ materialCode, items })).filter((group) => group.items.some((item) => item.assemblyLine === scheduleLine) || Object.entries(dailyAssemblyLines).some(([key, line]) => line === scheduleLine && group.items.some((item) => key.endsWith(`:${item.planId}`))));
  }, [schedule, scheduleLine, dailyAssemblyLines]);
  const calendarDays = useMemo(() => Array.from({ length: daysInMonth }, (_, index) => {
    const value = new Date(date.getFullYear(), date.getMonth(), date.getDate() + index);
    return { value, key: localDateKey(value), day: value.getDate(), weekday: value.toLocaleDateString("en-IN", { weekday: "narrow" }), off: isNonWorkingDay(value, holidaySet) };
  }), [date, daysInMonth, holidaySet]);
  const actualVsPlannedByDay = useMemo(() => {
    let cumulativePlanned = 0;
    let cumulativeActual = 0;
    return calendarDays.map((day) => {
      const dayStartSeconds = elapsedCapacityBeforeDate(day.value, actualLine);
      const dayCapacitySeconds = productiveSecondsForDate(day.value, actualLine);
      const plannedPieces = day.off ? 0 : actualLineSchedule.reduce((sum, item) => {
        if (day.value < item.start || day.value > item.finish) return sum;
        const overlapSeconds = Math.max(0, Math.min(item.finishOffsetSeconds, dayStartSeconds + dayCapacitySeconds) - Math.max(item.startOffsetSeconds, dayStartSeconds));
        return sum + (overlapSeconds > 0 ? Math.max(1, Math.round(overlapSeconds / Math.max(1, item.effectiveBottleneckSeconds))) : 0);
      }, 0);
      const actualPieces = actualLineProduction.filter((record) => record.date === day.key).reduce((sum, record) => sum + record.quantity, 0);
      cumulativePlanned += plannedPieces;
      cumulativeActual += actualPieces;
      return { ...day, plannedPieces, actualPieces, backlogPieces: Math.max(0, cumulativePlanned - cumulativeActual), variance: actualPieces - plannedPieces };
    });
  }, [calendarDays, assemblyReleaseDate, holidaySet, availableSeconds, actualLineSchedule, actualLineProduction, dailyShiftHours, hours, efficiency]);
  const actualVsPlannedPeak = Math.max(1, ...actualVsPlannedByDay.flatMap((day) => [day.plannedPieces, day.actualPieces, day.backlogPieces]));
  const actualGraphWidth = Math.max(900, actualVsPlannedByDay.length * 46);
  const actualGraphStep = actualVsPlannedByDay.length > 1 ? (actualGraphWidth - 80) / (actualVsPlannedByDay.length - 1) : 0;
  const actualGraphX = (index: number) => 50 + index * actualGraphStep;
  const actualGraphY = (value: number) => 20 + (1 - value / actualVsPlannedPeak) * 195;
  const plannedLinePoints = actualVsPlannedByDay.flatMap((day, index) => day.off ? [] : [`${actualGraphX(index)},${actualGraphY(day.plannedPieces)}`]).join(" ");
  const actualLinePoints = actualVsPlannedByDay.flatMap((day, index) => day.off ? [] : [`${actualGraphX(index)},${actualGraphY(day.actualPieces)}`]).join(" ");
  const backlogLinePoints = actualVsPlannedByDay.flatMap((day, index) => day.off ? [] : [`${actualGraphX(index)},${actualGraphY(day.backlogPieces)}`]).join(" ");
  const timeWiseWorkingDays = useMemo(() => calendarDays.filter((day) => !day.off), [calendarDays]);
  const activeDayPlanKey = timeWiseWorkingDays.some((day) => day.key === selectedDayPlanDate) ? selectedDayPlanDate : timeWiseWorkingDays[0]?.key ?? startDate;
  const activeDayPlanDate = new Date(`${activeDayPlanKey}T00:00:00`);
  const timeWiseDayPlan = useMemo(() => {
    const dayStartSeconds = elapsedCapacityBeforeDate(activeDayPlanDate, scheduleLine);
    const dayCapacitySeconds = productiveSecondsForDate(activeDayPlanDate, scheduleLine);
    const assignedItems = schedule.flatMap((item) => {
      if (item.remainingQty <= 0 || activeDayPlanDate < item.start || activeDayPlanDate > item.finish) return [];
      const assignedLine = dailyAssemblyLines[`${activeDayPlanKey}:${item.planId}`] ?? item.assemblyLine;
      if (assignedLine !== scheduleLine) return [];
      const startSeconds = Math.max(item.startOffsetSeconds, dayStartSeconds);
      const endSeconds = Math.min(item.finishOffsetSeconds, dayStartSeconds + dayCapacitySeconds);
      const effectiveSeconds = Math.max(0, endSeconds - startSeconds);
      if (!effectiveSeconds) return [];
      const startWorkMinutes = (startSeconds - dayStartSeconds) / Math.max(.01, efficiency / 100) / 60;
      const durationMinutes = effectiveSeconds / Math.max(.01, efficiency / 100) / 60;
      const clockStartMinute = productiveMinuteToClockMinute(startWorkMinutes);
      const clockEndMinute = productiveMinuteToClockMinute(startWorkMinutes + durationMinutes);
      return [{ ...item, allocatedCycleSeconds: effectiveSeconds, pieces: Math.max(1, Math.round(effectiveSeconds / item.effectiveBottleneckSeconds)), clockStart: productiveMinuteLabel(startWorkMinutes), clockEnd: productiveMinuteLabel(startWorkMinutes + durationMinutes), clockStartMinute, clockEndMinute, durationMinutes }];
    }).sort((a, b) => a.startOffsetSeconds - b.startOffsetSeconds || a.materialCode.localeCompare(b.materialCode));
    let lineCursorMinutes = 0;
    return assignedItems.map((item) => {
      const destinationBottleneckSeconds = Math.max(1, ...item.cycleTimes.map((seconds, index) => index >= ASSEMBLY_START_INDEX && seconds > 0 ? seconds / planningBooths(stationBooths, data?.machines[index]?.key ?? "", index) : 0));
      const calculatedPieces = Math.max(1, Math.floor(item.allocatedCycleSeconds / destinationBottleneckSeconds));
      const pieces = Math.max(0, dailyProductionEdits[`${activeDayPlanKey}:${item.planId}`]?.plannedQuantity ?? calculatedPieces);
      const durationMinutes = pieces * destinationBottleneckSeconds / Math.max(.01, efficiency / 100) / 60;
      const startWorkMinutes = lineCursorMinutes;
      const clockStartMinute = productiveMinuteToClockMinute(startWorkMinutes);
      const clockEndMinute = productiveMinuteToClockMinute(startWorkMinutes + durationMinutes);
      lineCursorMinutes += durationMinutes;
      return { ...item, pieces, effectiveBottleneckSeconds: destinationBottleneckSeconds, durationMinutes, clockStart: productiveMinuteLabel(startWorkMinutes), clockEnd: productiveMinuteLabel(startWorkMinutes + durationMinutes), clockStartMinute, clockEndMinute };
    });
  }, [schedule, scheduleLine, dailyAssemblyLines, dailyProductionEdits, activeDayPlanKey, activeDayPlanDate, assemblyReleaseDate, holidaySet, availableSeconds, efficiency, dailyShiftHours, hours, stationBooths, data]);
  const timeWiseAgendaBlocks = useMemo(() => timeWiseDayPlan.flatMap((item) => {
    const workWindows = [[8 * 60, 12 * 60 + 30], [13 * 60, 16 * 60], [16 * 60 + 10, Number.POSITIVE_INFINITY]];
    const totalVisibleMinutes = Math.max(1, item.durationMinutes);
    return workWindows.flatMap(([windowStart, windowEnd], windowIndex) => {
      const startMinute = Math.max(item.clockStartMinute, windowStart);
      const endMinute = Math.min(item.clockEndMinute, windowEnd);
      if (endMinute <= startMinute) return [];
      const segmentMinutes = endMinute - startMinute;
      return [{ ...item, startMinute, endMinute, segmentPieces: Math.max(1, Math.round(item.pieces * segmentMinutes / totalVisibleMinutes)), windowIndex }];
    });
  }), [timeWiseDayPlan]);
  const processOccupancy = useMemo(() => (data?.machines ?? []).map((machine, machineIndex) => ({
    ...machine,
    values: calendarDays.map((calendarDay) => {
      if (calendarDay.off) return { percent: 0, products: [] as string[] };
      const dayCapacitySeconds = productiveSecondsForDate(calendarDay.value);
      const active = schedule.filter((item) => calendarDay.value >= item.start && calendarDay.value <= item.finish);
      const effectiveSeconds = active.reduce((sum, item) => {
        const booths = configuredBooths(stationBooths, machine.key, machineIndex, item.assemblyLine);
        return sum + ((item.cycleTimes[machineIndex] || 0) * item.remainingQty / Math.max(1, item.duration) / booths);
      }, 0);
      return { percent: Math.round(effectiveSeconds / Math.max(1, dayCapacitySeconds) * 100), products: active.map((item) => item.materialCode) };
    }),
  })), [data, calendarDays, schedule, availableSeconds, stationBooths, dailyShiftHours, hours, efficiency]);
  const dailyWorkingHourSuggestions = useMemo(() => calendarDays.map((calendarDay) => {
    const lineSuggestion = (line: AssemblyLine) => {
      if (calendarDay.off) return { hours: 0, bottleneck: "Non-working day", products: [] as string[] };
      const active = schedule.filter((item) => item.assemblyLine === line && calendarDay.value >= item.start && calendarDay.value <= item.finish);
      const processLoads = (data?.machines ?? []).map((machine, machineIndex) => {
        if (machineIndex < ASSEMBLY_START_INDEX) return { name: machine.name, requiredHours: 0 };
        const effectiveSeconds = active.reduce((sum, item) => {
          const booths = configuredBooths(stationBooths, machine.key, machineIndex, line);
          return sum + ((item.cycleTimes[machineIndex] || 0) * item.remainingQty / Math.max(1, item.duration) / booths);
        }, 0);
        return { name: machine.name, requiredHours: effectiveSeconds / Math.max(1, 3600 * efficiency / 100) };
      }).sort((a, b) => b.requiredHours - a.requiredHours);
      const rawHours = processLoads[0]?.requiredHours ?? 0;
      return { hours: rawHours > 0 ? Math.ceil(rawHours * 2) / 2 : 0, bottleneck: rawHours > 0 ? processLoads[0].name : "No production", products: [...new Set(active.map((item) => item.materialCode))] };
    };
    const al1 = lineSuggestion("AL1");
    const al2 = lineSuggestion("AL2");
    const suggestedHours = Math.max(al1.hours, al2.hours);
    return { ...calendarDay, al1, al2, suggestedHours, status: calendarDay.off ? "OFF" : suggestedHours > 24 ? "CAPACITY SHORT" : suggestedHours > hours ? "EXTENDED SHIFT" : suggestedHours > 0 ? "REGULAR SHIFT" : "NO PRODUCTION" };
  }), [calendarDays, schedule, data, stationBooths, efficiency, hours]);
  const sortedProcessOccupancy = useMemo(() => [...processOccupancy].sort((a, b) => {
    const peakA = Math.max(0, ...a.values.map((value) => value.percent));
    const peakB = Math.max(0, ...b.values.map((value) => value.percent));
    if (peakB !== peakA) return peakB - peakA;
    const totalA = a.values.reduce((sum, value) => sum + value.percent, 0);
    const totalB = b.values.reduce((sum, value) => sum + value.percent, 0);
    return totalB - totalA || a.name.localeCompare(b.name);
  }), [processOccupancy]);
  const scheduleTiming = useMemo(() => {
    return new Map(schedule.map((item) => {
    return [item.planId, { startSeconds: item.startOffsetSeconds, start: item.start, finish: item.finish }];
    }));
  }, [schedule]);
  const twinTokens = useMemo(() => schedule.map((product, orderIndex) => {
    const processRank = new Map(routeOrder.map((key, index) => [key, index]));
    const route = product.cycleTimes.map((seconds, stationIndex) => ({ seconds, stationIndex, key: data?.machines[stationIndex]?.key ?? "" })).filter((step) => step.seconds > 0 && step.stationIndex >= ASSEMBLY_START_INDEX).sort((a, b) => {
      const aRank = processRank.get(a.key);
      const bRank = processRank.get(b.key);
      return (aRank ?? a.stationIndex + routeOrder.length) - (bRank ?? b.stationIndex + routeOrder.length);
    });
    const routeSeconds = Math.max(1, route.reduce((sum, step) => sum + step.seconds, 0));
    const startSeconds = scheduleTiming.get(product.planId)?.startSeconds ?? 0;
    const elapsed = Math.max(0, twinTime - startSeconds);
    const completed = Math.min(product.planQty, Math.floor(elapsed / product.effectiveBottleneckSeconds));
    const started = twinTime >= startSeconds;
    const active = started && completed < product.planQty;
    let phase = (elapsed + orderIndex * Math.max(7, routeSeconds / Math.max(1, schedule.length))) % routeSeconds;
    let selected = route[0] ?? { stationIndex: 0, seconds: 1, key: "" };
    let progress = 0;
    for (const step of route) {
      if (phase <= step.seconds) { selected = step; progress = phase / step.seconds; break; }
      phase -= step.seconds;
    }
    if (!active && completed >= product.planQty && route.length) { selected = route[route.length - 1]; progress = 1; }
    return { planId: product.planId, materialCode: product.materialCode, family: product.family, assemblyLine: product.assemblyLine, stationIndex: selected.stationIndex, cycleSeconds: selected.seconds, progress, started, active };
  }), [schedule, scheduleTiming, twinTime, routeOrder, data]);
  const twinStations = useMemo(() => (data?.machines ?? []).map((machine, index) => ({ machine, index })).filter(({ index }) => index >= ASSEMBLY_START_INDEX && planned.some((product) => assemblyLineForProduct(product) === twinLine && (product.cycleTimes[index] || 0) > 0)).map(({ machine, index }) => {
    const tokens = twinTokens.filter((token) => assemblyLineForProduct(token) === twinLine && token.active && token.stationIndex === index);
    const booths = configuredBooths(stationBooths, machine.key, index, twinLine);
    const lineSeconds = planned.filter((product) => assemblyLineForProduct(product) === twinLine).reduce((sum, product) => sum + product.planQty * (product.cycleTimes[index] || 0), 0);
    const occupancy = Math.round(lineSeconds / Math.max(1, availableSeconds * booths * workingDays) * 100);
    const status = downStations.includes(machine.key) ? "DOWN" : occupancy > 100 ? "OVERLOAD" : tokens.length ? "RUNNING" : "IDLE";
    const health = status === "DOWN" ? 0 : Math.max(40, Math.round(twinHealth - Math.max(0, occupancy - 70) * .35));
    return { ...machine, index, tokens, booths, occupancy, status, health, queue: Math.max(0, tokens.length - booths) };
  }).sort((a, b) => {
    const aRank = routeOrder.indexOf(a.key);
    const bRank = routeOrder.indexOf(b.key);
    return (aRank < 0 ? Number.MAX_SAFE_INTEGER : aRank) - (bRank < 0 ? Number.MAX_SAFE_INTEGER : bRank);
  }), [data, twinTokens, workingDays, availableSeconds, twinHealth, downStations, routeOrder, stationBooths, planned, twinLine]);
  const orderedTwinStations = useMemo(() => {
    const rank = new Map(routeOrder.map((id, index) => [id, index]));
    return [...twinStations].sort((a, b) => (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER));
  }, [twinStations, routeOrder]);
  const twinBottleneck = useMemo(() => {
    // Capacity forecasting must use the complete production plan. `planQty` is
    // feeder-released quantity and can be zero before Tube Shop completion,
    // which previously made the twin highlight a zero-load station and meant
    // booth changes appeared to have no effect on the schedule.
    const lineOrders = schedule.filter((product) => product.assemblyLine === twinLine && product.remainingQty > 0);
    return twinStations.map((station) => {
      const machineIndex = data?.machines.findIndex((machine) => machine.key === station.key) ?? -1;
      const workloadSeconds = lineOrders.reduce((sum, product) => sum + (product.cycleTimes[machineIndex] || 0) * product.remainingQty, 0) / Math.max(1, station.booths);
      const occupancy = Math.round(workloadSeconds / Math.max(1, availableSeconds * workingDays) * 100);
      const effectiveCycle = Math.max(0, ...lineOrders.map((product) => (product.cycleTimes[machineIndex] || 0) / Math.max(1, station.booths)));
      return { ...station, workloadSeconds, occupancy, effectiveCycle };
    }).sort((a, b) => b.workloadSeconds - a.workloadSeconds)[0] ?? null;
  }, [schedule, twinLine, twinStations, data, availableSeconds, workingDays]);
  const designerStations = useMemo(() => {
    const base = twinStations.map((station) => {
      const machineIndex = data?.machines.findIndex((machine) => machine.key === station.key) ?? -1;
      return { id: station.key, name: station.name, cycle: planned.find((product) => assemblyLineForProduct(product) === twinLine && (product.cycleTimes[machineIndex] || 0) > 0)?.cycleTimes[machineIndex] ?? 0, machines: station.booths };
    });
    const all = [...base, ...extraStations];
    const rank = new Map(routeOrder.map((id, index) => [id, index]));
    return all.sort((a, b) => (rank.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER));
  }, [twinStations, planned, data, extraStations, routeOrder, twinLine]);
  const twinClock = `${String(Math.floor(twinTime / 3600)).padStart(2, "0")}:${String(Math.floor(twinTime / 60) % 60).padStart(2, "0")}:${String(Math.floor(twinTime) % 60).padStart(2, "0")}`;
  const twinLineFirstStart = schedule
    .filter((item) => item.assemblyLine === twinLine && item.planQty > 0)
    .reduce<Date | null>((earliest, item) => (!earliest || item.start < earliest ? item.start : earliest), null) ?? date;
  const simulatedDayIndex = Math.floor(twinTime / Math.max(1, availableSeconds));
  const simulatedDate = addWorkingDays(twinLineFirstStart, simulatedDayIndex, holidaySet);
  const slowestCycle = Math.max(1, ...schedule.map((product) => product.effectiveBottleneckSeconds));
  const completedByPlan = useMemo(() => {
    const counts = new Map<string, number>();
    schedule.forEach((product) => {
      const productCycle = product.effectiveBottleneckSeconds;
      const startSeconds = scheduleTiming.get(product.planId)?.startSeconds ?? 0;
      const completed = twinTime < startSeconds ? 0 : Math.min(product.planQty, Math.floor((twinTime - startSeconds) / productCycle));
      counts.set(product.planId, completed);
    });
    return counts;
  }, [schedule, scheduleTiming, twinTime]);
  const twinLineOrders = schedule.filter((product) => product.assemblyLine === twinLine);
  const twinLineTotalUnits = twinLineOrders.reduce((sum, product) => sum + product.planQty, 0);
  const twinProduced = twinLineOrders.reduce((sum, product) => sum + (completedByPlan.get(product.planId) ?? 0), 0);
  const twinForecast = maxLoad > 0 ? Math.floor(twinLineTotalUnits / maxLoad) : Math.floor(availableSeconds / slowestCycle);
  const familyCompletion = useMemo(() => {
    const totals = new Map<string, { family: string; planned: number; completed: number }>();
    planned.filter((product) => assemblyLineForProduct(product) === twinLine).forEach((product) => {
      const current = totals.get(product.family) ?? { family: product.family, planned: 0, completed: 0 };
      current.planned += product.planQty;
      current.completed += completedByPlan.get(product.planId) ?? 0;
      totals.set(product.family, current);
    });
    return [...totals.values()].sort((a, b) => a.family.localeCompare(b.family));
  }, [planned, completedByPlan, twinLine]);
  const traceTokens = twinTokens.filter((token) =>
    assemblyLineForProduct(token) === twinLine &&
    (traceFamily === "all" || token.family === traceFamily) &&
    token.materialCode.toLowerCase().includes(traceQuery.toLowerCase())
  );
  const moveStation = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const currentIds = designerStations.map((station) => String(station.id));
    const from = currentIds.indexOf(sourceId);
    const to = currentIds.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...currentIds];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setRouteOrder(next);
  };

  const updatePlan = (planId: string, field: "planQty", value: number) => setPlanned((old) => old.map((p) => p.planId === planId ? { ...p, [field]: Math.max(1, value || 1) } : p));
  const updateDueDate = (planId: string, value: string) => setPlanned((old) => old.map((product) => product.planId === planId ? { ...product, dueDate: value } : product));
  const addProduct = (p: Product) => setPlanned((old) => [...old, { ...p, planId: crypto.randomUUID(), planQty: p.orderQty || 1, dueDate: endDate, priority: "Normal" }]);
  const toggleFamily = (family: string) => setSelectedFamilies((old) => old.includes(family) ? old.filter((f) => f !== family) : [...old, family]);
  const addHoliday = () => {
    if (!holidayDraft || holidays.includes(holidayDraft)) return;
    setHolidays((old) => [...old, holidayDraft].sort());
    setHolidayDraft("");
  };
  const persistCatalog = (custom: Product[], deleted: number[]) => {
    setCatalogState("saving");
    setCustomProducts(custom);
    setDeletedProductIds(deleted);
    setData((current) => {
      if (!current) return current;
      const nextProducts = [...new Map([...sourceProducts, ...custom].map((product) => [product.id, product])).values()].filter((product) => !deleted.includes(product.id));
      return { ...current, products: nextProducts, families: [...new Set(nextProducts.map((product) => product.family))].sort() };
    });
    fetch("/api/products", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ customProducts: custom, deletedProductIds: deleted }) })
      .then((response) => { if (!response.ok) throw new Error("Save failed"); setCatalogState("saved"); })
      .catch(() => setCatalogState("error"));
  };
  const openProductForm = () => {
    if (!data) return;
    setProductDraft({ materialCode: "", family: "818", assemblyLine: "AL2", segment: "NON AUTO", bomAvailable: true, orderQty: 0, cycleTimes: Array(data.machines.length).fill(0) });
    setShowProductForm(true);
  };
  const createProduct = (event: React.FormEvent) => {
    event.preventDefault();
    if (!data || !productDraft.materialCode.trim() || !productDraft.segment.trim() || productDraft.orderQty < 0 || productDraft.cycleTimes.length !== data.machines.length) return;
    const cycleTimes = productDraft.cycleTimes.map((value) => Number(value) || 0);
    const bottleneckSeconds = Math.max(...cycleTimes);
    const bottleneckIndex = cycleTimes.indexOf(bottleneckSeconds);
    const product: Product = {
      id: -Date.now(), materialCode: productDraft.materialCode.trim().toUpperCase(), family: productDraft.family.trim(), assemblyLine: productDraft.assemblyLine, segment: productDraft.segment.trim().toUpperCase(), bomAvailable: productDraft.bomAvailable, orderQty: productDraft.orderQty, cycleTimes,
      totalCycleSeconds: cycleTimes.reduce((sum, value) => sum + value, 0), bottleneckSeconds, bottleneckMachine: data.machines[bottleneckIndex]?.name ?? "—",
    };
    persistCatalog([...customProducts, product], deletedProductIds);
    setSelectedFamilies((old) => old.includes(product.family) ? old : [...old, product.family]);
    setShowProductForm(false);
  };
  const deleteProduct = (product: Product) => persistCatalog(customProducts, [...new Set([...deletedProductIds, product.id])]);
  const restoreProduct = (id: number) => persistCatalog(customProducts, deletedProductIds.filter((item) => item !== id));
  const updateProductAssemblyLine = (product: Product, assemblyLine: AssemblyLine) => {
    const updated = { ...product, assemblyLine };
    const affectedPlanIds = new Set(planned.filter((item) => item.id === product.id).map((item) => item.planId));
    const nextCustom = customProducts.some((item) => item.id === product.id)
      ? customProducts.map((item) => item.id === product.id ? updated : item)
      : [...customProducts, updated];
    persistCatalog(nextCustom, deletedProductIds);
    setPlanned((old) => old.map((item) => item.id === product.id ? { ...item, assemblyLine } : item));
    setDailyAssemblyLines((old) => Object.fromEntries(Object.entries(old).filter(([key]) => ![...affectedPlanIds].some((planId) => key.endsWith(`:${planId}`)))) as Record<string, AssemblyLine>);
    setActualProduction((old) => old.map((item) => affectedPlanIds.has(item.planId) ? { ...item, assemblyLine } : item));
  };
  const updateDailyAssemblyLine = (dateKey: string, planId: string, assemblyLine: AssemblyLine) => {
    const movedItem = schedule.find((item) => item.planId === planId);
    if (!movedItem) return;
    const sourceLine = dailyAssemblyLines[`${dateKey}:${planId}`] ?? movedItem.assemblyLine;
    if (sourceLine === assemblyLine) return;
    const selectedDate = new Date(`${dateKey}T00:00:00`);
    const displacedPlanIds = schedule.filter((item) => item.planId !== planId && item.remainingQty > 0 && selectedDate >= item.start && selectedDate <= item.finish && (dailyAssemblyLines[`${dateKey}:${item.planId}`] ?? item.assemblyLine) === assemblyLine).map((item) => item.planId);
    setDailyAssemblyLines((old) => {
      const next = { ...old, [`${dateKey}:${planId}`]: assemblyLine };
      displacedPlanIds.forEach((displacedPlanId) => { next[`${dateKey}:${displacedPlanId}`] = sourceLine; });
      return next;
    });
    setActualProduction((old) => old.map((item) => item.date !== dateKey ? item : item.planId === planId ? { ...item, assemblyLine } : displacedPlanIds.includes(item.planId) ? { ...item, assemblyLine: sourceLine } : item));
  };
  const updateDailyProductionEdit = (dateKey: string, product: Planned, field: keyof DailyProductionEdit, value: number | string) => {
    const key = `${dateKey}:${product.planId}`;
    setDailyProductionEdits((old) => ({ ...old, [key]: { ...old[key], [field]: value } }));
    if (field !== "actualQuantity") return;
    const quantity = Math.max(0, Number(value) || 0);
    const assemblyLine = dailyAssemblyLines[key] ?? assemblyLineForProduct(product);
    setActualProduction((old) => {
      const existing = old.find((item) => item.date === dateKey && item.planId === product.planId);
      if (existing) return old.map((item) => item.id === existing.id ? { ...item, quantity, endOfDayQuantity: quantity, assemblyLine } : item);
      return [...old, { id: crypto.randomUUID(), date: dateKey, planId: product.planId, materialCode: product.materialCode, family: product.family, assemblyLine, quantity, endOfDayQuantity: quantity }];
    });
  };
  const updateMachineOwner = (dateKey: string, assemblyLine: AssemblyLine, machineKey: string, field: keyof MachineOwnerEntry, value: string) => {
    const key = `${dateKey}:${assemblyLine}:${machineKey}`;
    setMachineOwners((old) => ({ ...old, [key]: { ...old[key], [field]: value } }));
  };
  const addPreventiveMaintenanceSlot = () => {
    if (!pmDraft.date || !pmDraft.machineKey || pmDraft.durationMinutes < 1) return;
    setPreventiveMaintenanceSlots((old) => [...old, { id: crypto.randomUUID(), ...pmDraft, durationMinutes: Math.max(1, Math.trunc(pmDraft.durationMinutes)) }]);
    setPmDraft((old) => ({ ...old, date: "", durationMinutes: 15 }));
  };
  const updatePreventiveMaintenanceSlot = (id: string, field: keyof PreventiveMaintenanceSlot, value: string | number) => setPreventiveMaintenanceSlots((old) => old.map((slot) => slot.id === id ? { ...slot, [field]: field === "durationMinutes" ? Math.max(1, Math.trunc(Number(value) || 15)) : value } as PreventiveMaintenanceSlot : slot));

  const overlappingRange = (candidate: string, ignore?: string) => savedRanges.find((range) => {
    if (range === ignore || range === candidate) return false;
    const [candidateStart, candidateEnd] = candidate.split("_");
    const [rangeStart, rangeEnd] = range.split("_");
    return candidateStart <= rangeEnd && rangeStart <= candidateEnd;
  });
  const validateDraftRange = (ignore?: string) => {
    if (!draftStartDate || !draftEndDate || draftStartDate > draftEndDate) { setPeriodMessage("Select a valid From and To date."); return null; }
    const candidate = `${draftStartDate}_${draftEndDate}`;
    const overlap = overlappingRange(candidate, ignore);
    if (overlap) { const [from, to] = overlap.split("_"); setPeriodMessage(`Dates overlap the saved period ${from} to ${to}.`); return null; }
    return candidate;
  };
  const addPlanningPeriod = () => {
    const candidate = validateDraftRange();
    if (!candidate) return;
    if (savedRanges.includes(candidate)) { setPeriodMessage("This planning period already exists."); return; }
    deletedPeriodsRef.current.delete(candidate);
    setSavedRanges((old) => [...new Set([...old, candidate])].sort());
    setStartDate(draftStartDate); setEndDate(draftEndDate); setTwinTime(0); setPeriodMessage("New planning period added.");
  };
  const updatePlanningPeriod = async () => {
    const candidate = validateDraftRange(month);
    if (!candidate) return;
    if (candidate === month) { setPeriodMessage("Change a date before updating this period."); return; }
    const response = await fetch("/api/plans", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ oldMonth: month, newMonth: candidate }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { setPeriodMessage(payload.error ?? "Unable to update planning period."); return; }
    setSavedRanges((old) => [...new Set(old.map((range) => range === month ? candidate : range))].sort());
    setStartDate(draftStartDate); setEndDate(draftEndDate); setTwinTime(0); setPeriodMessage("Planning period updated.");
  };
  const removePlanningPeriod = async () => {
    if (!window.confirm(`Remove planning period ${startDate} to ${endDate}?`)) return;
    const removedMonth = month;
    deletedPeriodsRef.current.add(removedMonth);
    planSaveAbortRef.current?.abort();
    setDeletingPeriod(true);
    setPeriodMessage("Removing planning period from database…");
    const response = await fetch(`/api/plans?month=${encodeURIComponent(removedMonth)}`, { method: "DELETE" });
    if (!response.ok) { deletedPeriodsRef.current.delete(removedMonth); setDeletingPeriod(false); setPeriodMessage("Unable to remove planning period from database."); return; }
    const payload = await response.json() as { ranges?: string[] };
    const remaining = Array.isArray(payload.ranges) ? payload.ranges.filter((range) => range !== removedMonth) : savedRanges.filter((range) => range !== removedMonth);
    setSavedRanges(remaining);
    if (remaining.length) {
      const [from, to] = remaining[0].split("_"); setStartDate(from); setEndDate(to); setDraftStartDate(from); setDraftEndDate(to);
    } else {
      const nextStart = new Date(`${endDate}T00:00:00`); nextStart.setDate(nextStart.getDate() + 1);
      const nextEnd = new Date(nextStart); nextEnd.setDate(nextEnd.getDate() + 29);
      const from = localDateKey(nextStart); const to = localDateKey(nextEnd);
      setStartDate(from); setEndDate(to); setDraftStartDate(from); setDraftEndDate(to);
    }
    setTwinTime(0); setDeletingPeriod(false); setPeriodMessage("Planning period permanently removed from database.");
  };

  const applyMiddayRecovery = (planId: string, productionDate: string, actualBeforeLunch: number) => {
    const scheduled = schedule.find((item) => item.planId === planId);
    if (!scheduled) return;
    const value = new Date(`${productionDate}T00:00:00`);
    const dayStartSeconds = elapsedCapacityBeforeDate(value);
    const dayCapacitySeconds = productiveSecondsForDate(value);
    const plannedSeconds = Math.max(0, Math.min(scheduled.finishOffsetSeconds, dayStartSeconds + dayCapacitySeconds) - Math.max(scheduled.startOffsetSeconds, dayStartSeconds));
    const plannedPieces = Math.round(plannedSeconds / Math.max(1, scheduled.effectiveBottleneckSeconds));
    const shiftHoursForDay = dailyShiftHours[productionDate] ?? hours;
    const expectedBeforeLunch = Math.round(plannedPieces * Math.min(1, 4.5 / Math.max(1, shiftHoursForDay)));
    const shortfall = Math.max(0, expectedBeforeLunch - actualBeforeLunch);
    if (!shortfall) return;
    const recoveryHours = shortfall * scheduled.effectiveBottleneckSeconds / Math.max(0.01, efficiency / 100) / 3600;
    setDailyShiftHours((old) => ({ ...old, [productionDate]: Math.min(24, Math.ceil((shiftHoursForDay + recoveryHours) * 2) / 2) }));
  };
  const resetShiftForDate = (productionDate: string) => setDailyShiftHours((old) => {
    const next = { ...old };
    delete next[productionDate];
    return next;
  });
  const resetAssemblyDay = (productionDate: string, line: AssemblyLine) => {
    resetShiftForDate(productionDate);
    setActualProduction((old) => old.filter((record) => record.date !== productionDate || record.assemblyLine !== line));
    setScheduleActualDraft({ date: productionDate, planId: "", beforeLunchQuantity: "", endOfDayQuantity: "" });
  };
  const resetFeederDay = (productionDate: string) => {
    resetShiftForDate(productionDate);
    const removedPlanIds = Object.keys(feederShiftActual).filter((key) => key.startsWith(`${productionDate}:`)).map((key) => key.slice(key.indexOf(":") + 1));
    const nextRecords = Object.fromEntries(Object.entries(feederShiftActual).filter(([key]) => !key.startsWith(`${productionDate}:`)));
    const remainingCompleted = new Map(removedPlanIds.map((planId) => [planId, Object.entries(nextRecords).filter(([key]) => key.slice(key.indexOf(":") + 1) === planId).reduce((sum, [, checkpoint]) => sum + (checkpoint.endOfDayQuantity ?? checkpoint.beforeLunchQuantity ?? 0), 0)]));
    setFeederShiftActual(nextRecords);
    setFeederProductCompleted((old) => {
      const next = { ...old };
      removedPlanIds.forEach((planId) => { next[`Tube Shop:${planId}`] = Object.entries(nextRecords).filter(([key]) => key.slice(key.indexOf(":") + 1) === planId).reduce((sum, [, checkpoint]) => sum + (checkpoint.endOfDayQuantity ?? checkpoint.beforeLunchQuantity ?? 0), 0); });
      return next;
    });
    setPowderCoatingSent((old) => ({ ...old, ...Object.fromEntries(removedPlanIds.map((planId) => [planId, Math.min(old[planId] ?? 0, remainingCompleted.get(planId) ?? 0)])) }));
    setPowderCoatingReturned((old) => ({ ...old, ...Object.fromEntries(removedPlanIds.map((planId) => [planId, Math.min(old[planId] ?? 0, powderCoatingSent[planId] ?? 0, remainingCompleted.get(planId) ?? 0)])) }));
    setFeederActualDraft({ date: productionDate, planId: "", beforeLunchQuantity: "", endOfDayQuantity: "" });
  };
  const saveFeederShiftActual = (event: React.FormEvent) => {
    event.preventDefault();
    const scheduled = feederDateSchedule.find((item) => item.planId === feederActualDraft.planId);
    const beforeLunchQuantity = feederActualDraft.beforeLunchQuantity === "" ? undefined : Number(feederActualDraft.beforeLunchQuantity);
    const endOfDayQuantity = feederActualDraft.endOfDayQuantity === "" ? undefined : Number(feederActualDraft.endOfDayQuantity);
    const quantity = endOfDayQuantity ?? beforeLunchQuantity;
    if (!scheduled || quantity === undefined || !Number.isInteger(quantity) || quantity < 0 || (beforeLunchQuantity !== undefined && (!Number.isInteger(beforeLunchQuantity) || beforeLunchQuantity < 0)) || (endOfDayQuantity !== undefined && (!Number.isInteger(endOfDayQuantity) || endOfDayQuantity < (beforeLunchQuantity ?? 0)))) return;
    const recordKey = `${activeFeederDayPlanKey}:${scheduled.planId}`;
    const nextRecords = { ...feederShiftActual, [recordKey]: { beforeLunchQuantity, endOfDayQuantity } };
    setFeederShiftActual(nextRecords);
    const completedTotal = Object.entries(nextRecords).filter(([key]) => key.slice(key.indexOf(":") + 1) === scheduled.planId).reduce((sum, [, checkpoint]) => sum + (checkpoint.endOfDayQuantity ?? checkpoint.beforeLunchQuantity ?? 0), 0);
    setFeederProductCompleted((old) => ({ ...old, [`Tube Shop:${scheduled.planId}`]: Math.max(old[`Tube Shop:${scheduled.planId}`] ?? 0, completedTotal) }));
    if (beforeLunchQuantity !== undefined) {
      const plannedToday = activeFeederDayPlan?.entries.find((entry) => entry.planId === scheduled.planId)?.quantity ?? 0;
      const shiftHoursForDay = dailyShiftHours[activeFeederDayPlanKey] ?? hours;
      const expectedBeforeLunch = Math.round(plannedToday * Math.min(1, 4.5 / Math.max(1, shiftHoursForDay)));
      const shortfall = Math.max(0, expectedBeforeLunch - beforeLunchQuantity);
      if (shortfall > 0) { const recoveryHours = shortfall * scheduled.effectiveSeconds / Math.max(.01, efficiency / 100) / 3600; setDailyShiftHours((old) => ({ ...old, [activeFeederDayPlanKey]: Math.min(24, Math.ceil((shiftHoursForDay + recoveryHours) * 2) / 2) })); }
    }
    setFeederActualDraft({ date: activeFeederDayPlanKey, planId: "", beforeLunchQuantity: "", endOfDayQuantity: "" });
  };

  const saveActualProduction = (event: React.FormEvent) => {
    event.preventDefault();
    const product = planned.find((item) => item.planId === actualDraft.planId);
    const beforeLunchQuantity = actualDraft.beforeLunchQuantity === "" ? undefined : Number(actualDraft.beforeLunchQuantity);
    const endOfDayQuantity = actualDraft.endOfDayQuantity === "" ? undefined : Number(actualDraft.endOfDayQuantity);
    const quantity = endOfDayQuantity ?? beforeLunchQuantity;
    const productionDate = actualDraft.date >= startDate && actualDraft.date <= endDate ? actualDraft.date : startDate;
    if (!product || quantity === undefined || !Number.isInteger(quantity) || quantity < 0 || (beforeLunchQuantity !== undefined && (!Number.isInteger(beforeLunchQuantity) || beforeLunchQuantity < 0)) || (endOfDayQuantity !== undefined && (!Number.isInteger(endOfDayQuantity) || endOfDayQuantity < 0 || endOfDayQuantity < (beforeLunchQuantity ?? 0)))) return;
    const existing = actualProduction.find((item) => item.id === editingActualId || (item.planId === product.planId && item.date === productionDate));
    const record: ActualProduction = { id: existing?.id ?? crypto.randomUUID(), date: productionDate, planId: product.planId, materialCode: product.materialCode, family: product.family, assemblyLine: assemblyLineForProduct(product), quantity, beforeLunchQuantity, endOfDayQuantity };
    setActualProduction((old) => [...old.filter((item) => item.id !== existing?.id && (item.planId !== product.planId || item.date !== productionDate)), record]);
    if (beforeLunchQuantity !== undefined) applyMiddayRecovery(product.planId, productionDate, beforeLunchQuantity);
    setEditingActualId(null);
    setActualDraft({ date: productionDate, planId: "", beforeLunchQuantity: "", endOfDayQuantity: "" });
  };
  const saveScheduleActualProduction = (event: React.FormEvent) => {
    event.preventDefault();
    const product = scheduleActualProducts.find((item) => item.planId === scheduleActualDraft.planId);
    const beforeLunchQuantity = scheduleActualDraft.beforeLunchQuantity === "" ? undefined : Number(scheduleActualDraft.beforeLunchQuantity);
    const endOfDayQuantity = scheduleActualDraft.endOfDayQuantity === "" ? undefined : Number(scheduleActualDraft.endOfDayQuantity);
    const quantity = endOfDayQuantity ?? beforeLunchQuantity;
    if (!product || quantity === undefined || !Number.isInteger(quantity) || quantity < 0 || (beforeLunchQuantity !== undefined && (!Number.isInteger(beforeLunchQuantity) || beforeLunchQuantity < 0)) || (endOfDayQuantity !== undefined && (!Number.isInteger(endOfDayQuantity) || endOfDayQuantity < 0 || endOfDayQuantity < (beforeLunchQuantity ?? 0)))) return;
    setActualProduction((old) => {
      const existing = old.find((item) => item.planId === product.planId && item.date === scheduleActualDate);
      const record: ActualProduction = { id: existing?.id ?? crypto.randomUUID(), date: scheduleActualDate, planId: product.planId, materialCode: product.materialCode, family: product.family, assemblyLine: product.assemblyLine, quantity, beforeLunchQuantity, endOfDayQuantity };
      return [...old.filter((item) => item.planId !== product.planId || item.date !== scheduleActualDate), record];
    });
    if (beforeLunchQuantity !== undefined) applyMiddayRecovery(product.planId, scheduleActualDate, beforeLunchQuantity);
    setScheduleActualDraft((old) => ({ ...old, planId: "", beforeLunchQuantity: "", endOfDayQuantity: "" }));
  };
  const editActualProduction = (record: ActualProduction) => {
    setEditingActualId(record.id);
    setActualDraft({ date: record.date, planId: record.planId, beforeLunchQuantity: record.beforeLunchQuantity ? String(record.beforeLunchQuantity) : "", endOfDayQuantity: (record.endOfDayQuantity ?? record.quantity) ? String(record.endOfDayQuantity ?? record.quantity) : "" });
  };
  const sortedActualProduction = [...actualLineProduction].sort((a, b) => b.date.localeCompare(a.date) || a.materialCode.localeCompare(b.materialCode));
  const actualTotal = actualLineProduction.reduce((sum, item) => sum + item.quantity, 0);
  const actualProductCount = new Set(actualLineProduction.map((item) => item.materialCode)).size;
  const actualByPlanAndDate = new Map<string, number>();
  const actualByPlan = new Map<string, number>();
  actualProduction.forEach((record) => {
    const dailyKey = `${record.planId}:${record.date}`;
    actualByPlanAndDate.set(dailyKey, (actualByPlanAndDate.get(dailyKey) ?? 0) + record.quantity);
    actualByPlan.set(record.planId, (actualByPlan.get(record.planId) ?? 0) + record.quantity);
  });

  const answerPlanningQuestion = (question: string) => {
    if (!data) return "Production data is still loading.";
    const q = question.trim().toLowerCase();
    const lines = (title: string, items: string[]) => [title, ...items.map((item) => `• ${item}`)].join("\n");
    const requestedLine: AssemblyLine | null = /\bal\s*1\b|assembly line 1|615 family/.test(q) ? "AL1" : /\bal\s*2\b|assembly line 2|818|1021/.test(q) ? "AL2" : null;
    const scopedPlans = requestedLine ? schedule.filter((item) => item.assemblyLine === requestedLine) : schedule;
    const scopedActual = requestedLine ? actualProduction.filter((item) => item.assemblyLine === requestedLine) : actualProduction;
    const product = [...planned, ...data.products].find((item) => q.includes(item.materialCode.toLowerCase()));
    const productSchedules = product ? schedule.filter((item) => item.materialCode === product.materialCode) : [];
    const answerOrdinalWords: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
    const answerWordBatch = Object.entries(answerOrdinalWords).find(([word]) => new RegExp(`\\b${word}\\s+batch\\b`).test(q))?.[1];
    const answerNumericBatch = q.match(/\bbatch\s*(\d+)\b|\b(\d+)(?:st|nd|rd|th)?\s+batch\b/);
    const answerBatchNumber = answerWordBatch ?? Number(answerNumericBatch?.[1] ?? answerNumericBatch?.[2] ?? 0);
    const batchWasRequested = answerBatchNumber > 0;
    const actualQuantity = scopedActual.reduce((sum, item) => sum + item.quantity, 0);
    const plannedQuantity = scopedPlans.reduce((sum, item) => sum + item.requestedPlanQty, 0);
    const remainingQuantity = scopedPlans.reduce((sum, item) => sum + item.remainingQty, 0);
    const lateOrders = scopedPlans.filter((item) => !item.onTime && item.remainingQty > 0);
    const scopeName = requestedLine ? `${requestedLine} (${requestedLine === "AL1" ? "615 family" : "818 & 1021 families"})` : "both assembly lines";
    const isoDate = q.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
    const monthNumbers: Record<string, number> = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
    const naturalDateMatch = q.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/);
    const naturalMonth = naturalDateMatch ? monthNumbers[naturalDateMatch[2]] : undefined;
    const selectedDay = isoDate ? calendarDays.find((day) => day.key === isoDate) : naturalDateMatch && naturalMonth !== undefined ? calendarDays.find((day) => day.day === Number(naturalDateMatch[1]) && day.value.getMonth() === naturalMonth) : undefined;
    if (isoDate || naturalDateMatch) {
      if (!selectedDay) return `${isoDate ?? naturalDateMatch?.[0]} is outside the active planning range ${startDate} to ${endDate}.`;
      const workingDayIndex = workingDaysBetween(assemblyReleaseDate, selectedDay.value, holidaySet);
      const dayStartSeconds = workingDayIndex * availableSeconds;
      const dayPlans = scopedPlans.flatMap((item) => {
        if (selectedDay.off || selectedDay.value < item.start || selectedDay.value > item.finish) return [];
        const startSeconds = Math.max(item.startOffsetSeconds, dayStartSeconds);
        const endSeconds = Math.min(item.finishOffsetSeconds, dayStartSeconds + availableSeconds);
        const overlapSeconds = Math.max(0, endSeconds - startSeconds);
        if (!overlapSeconds) return [];
        const startMinutes = (startSeconds - dayStartSeconds) / Math.max(.01, efficiency / 100) / 60;
        const endMinutes = (endSeconds - dayStartSeconds) / Math.max(.01, efficiency / 100) / 60;
        return [{ item, plannedPieces: Math.max(1, Math.round(overlapSeconds / Math.max(1, item.effectiveBottleneckSeconds))), actualPieces: actualByPlanAndDate.get(`${item.planId}:${selectedDay.key}`) ?? 0, startTime: productiveMinuteLabel(startMinutes), endTime: productiveMinuteLabel(endMinutes) }];
      });
      const dayActual = dayPlans.reduce((sum, entry) => sum + entry.actualPieces, 0);
      const dayPlanned = dayPlans.reduce((sum, entry) => sum + entry.plannedPieces, 0);
      const detailRows = (["AL1", "AL2"] as AssemblyLine[]).flatMap((line) => {
        const entries = dayPlans.filter((entry) => entry.item.assemblyLine === line);
        if (!entries.length) return [`${line} · ${line === "AL1" ? "615 family" : "818 & 1021 families"}: No production planned`];
        return [`${line} · ${line === "AL1" ? "615 family" : "818 & 1021 families"}`, ...entries.map((entry, index) => `  ${String(index + 1).padStart(2, "0")}  ${entry.startTime} → ${entry.endTime} | ${entry.item.materialCode} | ${fmt.format(entry.plannedPieces)} planned | ${fmt.format(entry.actualPieces)} actual`)];
      });
      return lines(`Detailed day plan · ${dayName.format(selectedDay.value)}`, [`Status: ${selectedDay.off ? "Non-working day" : "Working day"}`, `Total planned: ${fmt.format(dayPlanned)} pieces`, `Total actual: ${fmt.format(dayActual)} pieces`, ...detailRows]);
    }
    if (/date range|planning period|selected period|from date|to date/.test(q)) return lines("Active planning range", [`From: ${startDate}`, `To: ${endDate}`, `Calendar days: ${daysInMonth}`, `Working days: ${workingDays}`, `Weekly off: Every Tuesday`, `Sundays: Working days`, `Added holidays: ${holidays.length}`]);
    if (/holiday|working day|weekly off|tuesday|sunday/.test(q)) { const added = holidays.filter((item) => item >= startDate && item <= endDate); return lines("Working calendar", [`Working days: ${workingDays}`, "Weekly off: Every Tuesday", "Sundays: Working days", ...(added.length ? ["Added holidays:", ...added.map((item) => `  ${dayName.format(new Date(`${item}T00:00:00`))}`)] : ["Added holidays: None"])]); }
    if (product && /cycle|process|station/.test(q)) {
      const cycles = data.machines.map((machine, index) => ({ name: machine.name, seconds: product.cycleTimes[index] ?? 0 })).filter((item) => item.seconds > 0);
      return lines(`${product.materialCode} · Process cycle times`, [...cycles.map((item, index) => `${String(index + 1).padStart(2, "0")}  ${item.name}: ${item.seconds}s / piece`), `Bottleneck: ${product.bottleneckMachine} · ${product.bottleneckSeconds}s / piece`]);
    }
    if (product) {
      const productActual = actualProduction.filter((item) => item.materialCode === product.materialCode).reduce((sum, item) => sum + item.quantity, 0);
      if (!productSchedules.length) return `${product.materialCode} belongs to family ${product.family} on ${assemblyLineForProduct(product)}, but it is not in the selected production plan.`;
      if (batchWasRequested) {
        const batch = productSchedules[answerBatchNumber - 1];
        if (!batch) return lines(`${product.materialCode} · Batch not found`, [`Requested batch: ${answerBatchNumber}`, `Available batches: ${productSchedules.length}`]);
        const batchActual = actualProduction.filter((item) => item.planId === batch.planId).reduce((sum, item) => sum + item.quantity, 0);
        const finishClock = productiveMinuteLabel(batch.finishWithinShiftSeconds / Math.max(.01, efficiency / 100) / 60);
        return lines(`${product.materialCode} · Batch ${answerBatchNumber} of ${productSchedules.length}`, [`Assembly line: ${batch.assemblyLine}`, `Planned quantity: ${fmt.format(batch.requestedPlanQty)} pieces`, `Actual quantity: ${fmt.format(batchActual)} pieces`, `Remaining quantity: ${fmt.format(batch.remainingQty)} pieces`, `Production start: ${dayName.format(batch.start)}`, `Estimated completion: ${dayName.format(batch.finish)} · ${finishClock}`, `Due date: ${dayName.format(batch.due)}`, `Delivery status: ${batch.onTime ? "On time" : `${batch.lateDays} day${batch.lateDays === 1 ? "" : "s"} late`}`]);
      }
      const productPlanned = productSchedules.reduce((sum, item) => sum + item.requestedPlanQty, 0);
      const productRemaining = productSchedules.reduce((sum, item) => sum + item.remainingQty, 0);
      return lines(product.materialCode, [`Family: ${product.family}`, `Assembly line: ${productSchedules[0].assemblyLine}`, `Planned: ${fmt.format(productPlanned)} pieces`, `Actual: ${fmt.format(productActual)} pieces`, `Remaining: ${fmt.format(productRemaining)} pieces`, `Schedule: ${dayName.format(productSchedules[0].start)} → ${dayName.format(productSchedules.at(-1)!.finish)}`, `Dispatches: ${productSchedules.length}`]);
    }
    if (/actual|completed|produced|output/.test(q)) return lines(`Production status · ${scopeName}`, [`Planned: ${fmt.format(plannedQuantity)} pieces`, `Actual: ${fmt.format(actualQuantity)} pieces`, `Balance: ${fmt.format(Math.max(0, plannedQuantity - actualQuantity))} pieces`]);
    if (/backlog|pending|remaining|balance/.test(q)) return lines(`Backlog · ${scopeName}`, [`Rebalanced schedule remaining: ${fmt.format(remainingQuantity)} pieces`, `Cumulative plan vs actual backlog: ${fmt.format(Math.max(0, plannedQuantity - actualQuantity))} pieces`]);
    if (/late|due|on time|completion date|finish/.test(q)) return lateOrders.length ? lines(`Late orders · ${scopeName}`, lateOrders.map((item, index) => `${String(index + 1).padStart(2, "0")}  ${item.materialCode} · finish ${dayName.format(item.finish)} · ${item.lateDays}d late`)) : lines(`Delivery status · ${scopeName}`, [`All ${scopedPlans.length} planned orders are predicted on time`]);
    if (/bottleneck|constraint/.test(q)) {
      const bottleneck = [...scopedPlans].sort((a, b) => b.effectiveBottleneckSeconds - a.effectiveBottleneckSeconds)[0];
      return bottleneck ? lines(`Bottleneck · ${scopeName}`, [`Process: ${bottleneck.effectiveBottleneckMachine}`, `Product: ${bottleneck.materialCode}`, `Effective cycle: ${bottleneck.effectiveBottleneckSeconds.toFixed(1)}s / piece`, `Booths: ${bottleneck.effectiveBottleneckBooths}`]) : `No active bottleneck is available because ${scopeName} has no planned products.`;
    }
    if (/capacity|how many|load|occupancy|oee/.test(q)) {
      const capacities = scopedPlans.map((item) => `${item.materialCode}: ${fmt.format(item.dailyCapacity)}/day`);
      return lines(`Daily capacity · ${scopeName}`, [`Baseline OEE: ${efficiency}%`, `Shift hours: ${hours}`, ...(capacities.length ? capacities : ["No products are planned"])]);
    }
    if (/feeder|tube shop|powder|vendor|dispatch/.test(q)) return lines("Feeder and powder-coating status", [`Total planned: ${fmt.format(totalUnits)} pieces`, `Assembly-supported: ${fmt.format(feederProducibleQuantity)} pieces`, `Estimated feeder readiness: ${dayName.format(feederReadyDate)}`, `Vendor vehicle capacity: ${fmt.format(vendorDispatchCapacity)} pieces`, "Assembly release: Only after powder-coated material is received back"]);
    if (/plan|quantity|schedule|production/.test(q)) return lines(`Production plan · ${scopeName}`, [`Orders: ${scopedPlans.length}`, `Planned: ${fmt.format(plannedQuantity)} pieces`, `Actual: ${fmt.format(actualQuantity)} pieces`, `Remaining: ${fmt.format(remainingQuantity)} pieces`]);
    return lines(`Planning snapshot · ${startDate} to ${endDate}`, [`Orders: ${planned.length}`, `Planned: ${fmt.format(planned.reduce((sum, item) => sum + item.planQty, 0))} pieces`, `Actual: ${fmt.format(actualProduction.reduce((sum, item) => sum + item.quantity, 0))} pieces`, "Ask about: product codes, AL1/AL2, backlog, bottlenecks, capacity, due dates, holidays, Tube Shop or powder coating"]);
  };

  const parseAssistantAction = (question: string): AssistantAction | null => {
    if (!data) return null;
    const q = question.toLowerCase().replaceAll(",", "").replace(/\s+/g, " ").trim();
    const oee = q.match(/(?:set|change|update)\s+(?:baseline\s+)?oee(?:\s+(?:to|as))?\s+(\d+(?:\.\d+)?)/);
    if (oee) { const value = Math.min(100, Math.max(10, Number(oee[1]))); return { kind: "oee", value, label: `Change baseline OEE from ${efficiency}% to ${value}%` }; }
    const shift = q.match(/(?:set|change|update)\s+(?:daily\s+)?shift(?:\s+hours?)?(?:\s+(?:to|as))?\s+(\d+(?:\.\d+)?)/);
    if (shift) { const value = Math.min(24, Math.max(1, Number(shift[1]))); return { kind: "hours", value, label: `Change shift hours from ${hours} to ${value}` }; }
    const holidayDate = q.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
    if (holidayDate && /add|mark|make/.test(q) && /holiday|off/.test(q)) return { kind: "addHoliday", value: holidayDate, label: `Add ${holidayDate} as a non-working holiday` };
    if (holidayDate && /remove|delete|unmark/.test(q) && /holiday|off/.test(q)) return { kind: "removeHoliday", value: holidayDate, label: `Remove ${holidayDate} from the added holiday list` };
    const requestedMaterialCode = [...new Set(planned.map((item) => item.materialCode))].find((code) => q.includes(code.toLowerCase()));
    const plannedProductMatches = requestedMaterialCode ? planned.filter((item) => item.materialCode === requestedMaterialCode) : [];
    const ordinalWords: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
    const wordBatch = Object.entries(ordinalWords).find(([word]) => new RegExp(`\\b${word}\\s+batch\\b`).test(q))?.[1];
    const numericBatchMatch = q.match(/\bbatch\s*(\d+)\b|\b(\d+)(?:st|nd|rd|th)?\s+batch\b/);
    const requestedBatch = wordBatch ?? Number(numericBatchMatch?.[1] ?? numericBatchMatch?.[2] ?? 1);
    const plannedProduct = plannedProductMatches[Math.max(0, requestedBatch - 1)];
    const batchLabel = plannedProductMatches.length > 1 ? ` · batch ${requestedBatch} of ${plannedProductMatches.length}` : "";
    const qty = q.match(/(?:plan(?:ned)?\s+)?quantity(?:\s+(?:to|as))?\s+(\d+)/);
    if (plannedProduct && qty && /set|change|update|make/.test(q)) { const value = Math.max(0, Number(qty[1])); return { kind: "planQty", value, planId: plannedProduct.planId, label: `Change ${plannedProduct.materialCode}${batchLabel} plan quantity from ${fmt.format(plannedProduct.planQty)} to ${fmt.format(value)} pieces` }; }
    const dueDateInput = q.match(/due\s+date(?:\s+(?:to|as))?\s+((?:20\d{2}-\d{2}-\d{2})|(?:\d{1,2}[/-]\d{1,2}[/-]20\d{2}))/)?.[1];
    const dueDateParts = dueDateInput?.match(/^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})$/);
    const dueMonthNumbers: Record<string, number> = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
    const naturalDueDate = q.match(/due\s+date(?:\s+(?:to|as))?\s+(?:(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(20\d{2}))?|(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(20\d{2}))?)/);
    let naturalDueIso: string | undefined;
    if (naturalDueDate) {
      const dayNumber = Number(naturalDueDate[1] ?? naturalDueDate[5]);
      const monthNumber = dueMonthNumbers[naturalDueDate[2] ?? naturalDueDate[4]];
      const periodStart = new Date(`${startDate}T00:00:00`);
      let yearNumber = Number(naturalDueDate[3] ?? naturalDueDate[6] ?? periodStart.getFullYear());
      if (!naturalDueDate[3] && !naturalDueDate[6] && monthNumber < periodStart.getMonth()) yearNumber += 1;
      const candidate = new Date(yearNumber, monthNumber, dayNumber);
      if (candidate.getFullYear() === yearNumber && candidate.getMonth() === monthNumber && candidate.getDate() === dayNumber) naturalDueIso = localDateKey(candidate);
    }
    const dueDate = naturalDueIso ?? (dueDateParts ? `${dueDateParts[3]}-${dueDateParts[2].padStart(2, "0")}-${dueDateParts[1].padStart(2, "0")}` : dueDateInput);
    if (plannedProduct && dueDate && !Number.isNaN(new Date(`${dueDate}T00:00:00`).getTime()) && /set|change|update|make/.test(q)) return { kind: "dueDate", value: dueDate, planId: plannedProduct.planId, label: `Change ${plannedProduct.materialCode}${batchLabel} due date from ${plannedProduct.dueDate} to ${dueDate}` };
    const boothCount = q.match(/booths?(?:\s+(?:to|as))?\s+(\d+)/)?.[1];
    const machineMatch = [...data.machines].map((machine, index) => ({ machine, index })).sort((a, b) => b.machine.name.length - a.machine.name.length).find(({ machine }) => q.includes(machine.name.toLowerCase()));
    if (boothCount && machineMatch && /set|change|update|add|make/.test(q)) {
      const value = Math.max(1, Number(boothCount));
      const line: AssemblyLine | null = /\bal\s*1\b|assembly line 1/.test(q) ? "AL1" : /\bal\s*2\b|assembly line 2/.test(q) ? "AL2" : null;
      const target = machineMatch.index >= ASSEMBLY_START_INDEX ? line ? line : null : null;
      return { kind: "booths", value, machineKey: machineMatch.machine.key, machineIndex: machineMatch.index, line: target, label: `Set ${machineMatch.machine.name} to ${value} booth${value === 1 ? "" : "s"}${machineMatch.index >= ASSEMBLY_START_INDEX ? line ? ` on ${line}` : " on both AL1 and AL2" : ""}` };
    }
    return null;
  };

  const confirmAssistantAction = () => {
    const action = pendingAssistantAction;
    if (!action) return;
    if (action.kind === "oee") setEfficiency(Number(action.value));
    if (action.kind === "hours") setHours(Number(action.value));
    if (action.kind === "addHoliday") setHolidays((old) => [...new Set([...old, String(action.value)])].sort());
    if (action.kind === "removeHoliday") setHolidays((old) => old.filter((item) => item !== String(action.value)));
    if (action.kind === "planQty" && action.planId) setPlanned((old) => old.map((item) => item.planId === action.planId ? { ...item, planQty: Number(action.value) } : item));
    if (action.kind === "dueDate" && action.planId) setPlanned((old) => old.map((item) => item.planId === action.planId ? { ...item, dueDate: String(action.value) } : item));
    if (action.kind === "booths" && action.machineKey && action.machineIndex !== undefined) setStationBooths((old) => {
      if (action.machineIndex! < ASSEMBLY_START_INDEX) return { ...old, [action.machineKey!]: Number(action.value) };
      if (action.line) return { ...old, [`${action.line}:${action.machineKey}`]: Number(action.value) };
      return { ...old, [`AL1:${action.machineKey}`]: Number(action.value), [`AL2:${action.machineKey}`]: Number(action.value) };
    });
    const now = Date.now();
    setAssistantMessages((old) => [...old, { id: `done-${now}`, role: "assistant", text: `Change completed\n• ${action.label}\n• Saved automatically to the active planning period` }]);
    setPendingAssistantAction(null);
  };

  const askPlanningAssistant = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question || assistantThinking) return;
    if (pendingAssistantAction && /^(confirm|yes|apply|proceed|do it)$/i.test(question)) { confirmAssistantAction(); setAssistantQuestion(""); return; }
    if (pendingAssistantAction && /^(cancel|no|stop)$/i.test(question)) { setPendingAssistantAction(null); setAssistantMessages((old) => [...old, { id: `cancel-${Date.now()}`, role: "assistant", text: "Proposed change cancelled. No planning data was modified." }]); setAssistantQuestion(""); return; }
    const now = Date.now();
    const action = parseAssistantAction(question);
    setAssistantMessages((old) => [...old, { id: `q-${now}`, role: "user", text: question }]);
    setAssistantQuestion("");
    if (/\b(?:what(?:'s| is)?|tell me|show me)?\s*(?:today'?s|current)\s+date\b|\bwhat day is (?:it|today)\b/i.test(question)) {
      const today = new Date();
      setAssistantMessages((old) => [...old, { id: `a-${now}`, role: "assistant", text: `Today's date\n• ${today.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}\n• ISO date: ${localDateKey(today)}\n• This is the computer's current date, not a production-plan date.` }]);
      return;
    }
    const requestedProcess = [...data.machines].map((machine, index) => ({ machine, index })).sort((a, b) => b.machine.name.length - a.machine.name.length).find(({ machine }) => question.toLowerCase().includes(machine.name.toLowerCase()));
    if (requestedProcess && /capacity|how many|output|pieces?\s+per\s+day|pcs?\s*\/\s*day/i.test(question)) {
      const applicableProducts = planned.filter((product) => (product.cycleTimes[requestedProcess.index] ?? 0) > 0);
      const productSource = applicableProducts.length ? applicableProducts : data.products.filter((product) => (product.cycleTimes[requestedProcess.index] ?? 0) > 0);
      const capacityGroups = new Map<string, { line: string; cycleSeconds: number; booths: number; capacity: number; products: string[] }>();
      productSource.forEach((product) => {
        const line = requestedProcess.index < ASSEMBLY_START_INDEX ? "Tube Shop" : assemblyLineForProduct(product);
        const cycleSeconds = product.cycleTimes[requestedProcess.index] ?? 0;
        const booths = configuredBooths(stationBooths, requestedProcess.machine.key, requestedProcess.index, line === "Tube Shop" ? undefined : line as AssemblyLine);
        const capacity = Math.floor(hours * 3600 * (efficiency / 100) * booths / cycleSeconds);
        const key = `${line}:${cycleSeconds}:${booths}`;
        const current = capacityGroups.get(key) ?? { line, cycleSeconds, booths, capacity, products: [] };
        if (!current.products.includes(product.materialCode)) current.products.push(product.materialCode);
        capacityGroups.set(key, current);
      });
      const rows = [...capacityGroups.values()].map((group) => `• ${group.line}: ${fmt.format(group.capacity)} pieces/day · ${group.cycleSeconds}s cycle · ${group.booths} booth${group.booths === 1 ? "" : "s"}${group.products.length ? ` · products ${group.products.slice(0, 4).join(", ")}${group.products.length > 4 ? ` +${group.products.length - 4} more` : ""}` : ""}`);
      setAssistantMessages((old) => [...old, { id: `a-${now}`, role: "assistant", text: `${requestedProcess.machine.name} capacity\n${rows.length ? rows.join("\n") : "• No applicable products were found."}\n\nCalculation\n• Shift: ${hours} hours\n• OEE: ${efficiency}%\n• Formula: shift seconds × OEE × booths ÷ product cycle time` }]);
      return;
    }
    if (action) {
      setAssistantMessages((old) => [...old, { id: `a-${now}`, role: "assistant", text: `Proposed change\n• ${action.label}\n• Review and confirm before I update the saved plan.` }]);
      setPendingAssistantAction(action);
      return;
    }
    setAssistantThinking(true);
    const thinkingId = `thinking-${now}`;
    setAssistantMessages((old) => [...old, { id: thinkingId, role: "assistant", text: "Analysing the active production plan with the local model…" }]);
    try {
      const feederQuestion = /feeder|tube|powder|vendor|dispatch|coating/i.test(question);
      const capacityQuestion = /capacity|bottleneck|process|station|machine|booth|oee|cycle|load|occupancy/i.test(question);
      const applicationContext = {
        currentSystemDate: localDateKey(new Date()),
        activePlanningPeriod: { startDate, endDate, calendarDays: daysInMonth, workingDays, holidays, weeklyOff: "Tuesday", sundaysWorking: true },
        settings: { defaultShiftHours: hours, baselineOeePercent: efficiency, actualOeePercent: actualOee, dailyShiftHours, vendorDispatchCapacity, powderCoatingLeadDays },
        productionSummary: { totalPlanned: planned.reduce((sum, item) => sum + item.planQty, 0), totalActual: actualProduction.reduce((sum, item) => sum + item.quantity, 0), orders: planned.length },
        productionOrders: planned.map((item, index) => { const prediction = schedule.find((entry) => entry.planId === item.planId); const sameProductBatch = planned.slice(0, index + 1).filter((entry) => entry.materialCode === item.materialCode).length; return { product: item.materialCode, batch: sameProductBatch, family: item.family, assemblyLine: assemblyLineForProduct(item), planned: item.planQty, actual: actualAllocationByPlan.get(item.planId) ?? 0, remaining: Math.max(0, item.planQty - (actualAllocationByPlan.get(item.planId) ?? 0)), dueDate: item.dueDate, start: prediction ? localDateKey(prediction.start) : null, estimatedFinish: prediction ? localDateKey(prediction.finish) : null, onTime: prediction?.onTime ?? null, dailyCapacity: prediction?.dailyCapacity ?? null, bottleneck: prediction?.effectiveBottleneckMachine ?? null } }),
        actualProduction,
        ...(feederQuestion ? { tubeShopProducts: tubeShopProductStatuses, tubeShopDailyPlan: feederDailyPlan.filter((day) => day.total > 0).map((day) => ({ date: day.key, total: day.total, products: day.entries.map((entry) => ({ product: entry.materialCode, quantity: entry.quantity })) })), powderCoatingDispatch: vendorDispatchPlan.map((load) => ({ load: load.loadNumber, dispatchDate: localDateKey(load.dispatchDate), quantity: load.quantity, expectedReturnDate: localDateKey(load.expectedReturnDate), products: load.items })) } : {}),
        ...(capacityQuestion ? { processWorkload: loadByMachine.map((machine) => ({ process: machine.name, requiredLoadDays: machine.days, note: "This is workload in days, not pieces-per-day capacity." })) } : {}),
      };
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 35000);
      const response = await fetch("/api/assistant", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ question, context: applicationContext, history: assistantMessages.slice(-6).map((message) => ({ role: message.role, text: message.text })) }) });
      window.clearTimeout(timeout);
      const payload = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !payload.answer) throw new Error(payload.error || "Unable to get an LLM answer");
      setAssistantMessages((old) => old.map((message) => message.id === thinkingId ? { id: `a-${now}`, role: "assistant", text: payload.answer! } : message));
    } catch {
      setAssistantMessages((old) => old.map((message) => message.id === thinkingId ? { id: `a-${now}`, role: "assistant", text: `${answerPlanningQuestion(question)}\n\nThe local model exceeded its response window, so LinePilot returned an immediate verified calculation.` } : message));
    } finally {
      setAssistantThinking(false);
    }
  };
  const submitAssistantQuestion = (event: React.FormEvent) => { event.preventDefault(); askPlanningAssistant(assistantQuestion); };

  if (!authChecked) return <main className="loading"><div className="loader"/><p>Checking Google login…</p></main>;
  if (!authUser) return <main className="auth-gate"><div className="auth-gate-card"><img src="/brand/ideal-logo-1.jpg" alt="Ideal Gas Springs" /><p className="eyebrow">IDEAL LINEPILOT · MES &amp; DIGITAL TWIN</p><h1>Sign in to Production Planner</h1><p>Production plans, actuals, machine owners and digital-twin data are available to authorized users only.</p><a className="auth-button auth-google-button" href="/api/auth/google">Continue with Google</a><small>Use your authorized Google Workspace account.</small></div></main>;
  if (!data) return <main className="loading"><div className="loader"/><p>Preparing production data…</p></main>;

  return <main>
    <header className="topbar">
      <a className="brand" href="#"><span className="ideal-mark"><img src="/brand/ideal-logo-1.jpg" alt="Ideal Gas Springs" /></span><span><b>Ideal LinePilot</b><small>MES &amp; Digital Twin · Version 2</small></span></a>
      <nav><button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}>Production plan</button><button className={tab === "feeder" ? "active" : ""} onClick={() => setTab("feeder")}>PC Tube Store</button><button className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}>Date-wise schedule</button><button className={tab === "actual" ? "active" : ""} onClick={() => setTab("actual")}>Actual production</button><button className={tab === "capacity" ? "active" : ""} onClick={() => setTab("capacity")}>Capacity</button><button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}>Product family</button><button className={tab === "skills" ? "active" : ""} onClick={() => setTab("skills")}>Skill Matrix</button><button className={tab === "twin" ? "active" : ""} onClick={() => setTab("twin")}>Digital twin</button></nav>
      <div className="auth-area">{authUser ? <><span className="auth-user">{authUser.name}</span><a className="auth-button signed-in" href="/api/auth/logout">Sign out</a></> : <a className="auth-button" href="/api/auth/google">Continue with Google</a>}</div>
      <div className="period-manager"><label className="saved-periods"><span>Active planning period</span><select aria-label="Saved planning periods" value={month} onChange={(e) => { const [from, to] = e.target.value.split("_"); setStartDate(from); setEndDate(to); setDraftStartDate(from); setDraftEndDate(to); setTwinTime(0); setPeriodMessage(""); }}>{[...new Set([month, ...savedRanges])].sort().map((range) => { const [from, to] = range.split("_"); return <option value={range} key={range}>{from} → {to}</option>; })}</select></label><div className="month-control date-range-control"><label><span>From date</span><input aria-label="Planning start date" type="date" value={draftStartDate} onChange={(e) => { const nextStart = e.target.value; setDraftStartDate(nextStart); if (nextStart > draftEndDate) { const suggestedEnd = new Date(`${nextStart}T00:00:00`); suggestedEnd.setDate(suggestedEnd.getDate() + 29); setDraftEndDate(localDateKey(suggestedEnd)); } setPeriodMessage(""); }} /></label><label><span>To date</span><input aria-label="Planning end date" type="date" value={draftEndDate} min={draftStartDate} onChange={(e) => { setDraftEndDate(e.target.value); setPeriodMessage(""); }} /></label><div className="period-actions"><button type="button" onClick={addPlanningPeriod} disabled={deletingPeriod}>Add</button><button type="button" className="edit-period" onClick={updatePlanningPeriod} disabled={deletingPeriod}>Update</button><button type="button" className="delete-period" onClick={removePlanningPeriod} disabled={deletingPeriod}>{deletingPeriod ? "Removing…" : "Remove"}</button></div></div>{periodMessage && <span className={`period-message ${periodMessage.includes("overlap") || periodMessage.includes("Unable") || periodMessage.includes("valid") || periodMessage.includes("already") ? "error" : ""}`}>{periodMessage}</span>}</div>
    </header>

    <section className="hero">
      <div><p className="eyebrow">DATE-RANGE PRODUCTION CONTROL</p><h1>{dayName.format(date)} – {dayName.format(periodEnd)} production plan</h1><p>Turn product-family demand into an achievable line plan using actual process cycle times.</p></div>
      <div className="planning-note"><span className="calendar-icon">↔</span><div><b>Selected planning period</b><small>{daysInMonth} calendar days · {workingDays} working days available</small><i className={`save-state ${saveState}`}>{saveState === "loading" ? "Loading saved plan…" : saveState === "saving" ? "Saving to database…" : saveState === "saved" ? "Saved to database" : "Database save failed"}</i></div></div>
    </section>

    <section className="kpis">
      <article><span>Planned quantity</span><strong>{fmt.format(totalUnits)}</strong><small>{planned.length} production orders</small></article>
      <article><span>Product mix</span><strong>{new Set(planned.map((p) => p.family)).size}</strong><small>Families in this plan</small></article>
      <article><span>Assembly bottleneck load</span><strong className={loadPct > 100 ? "danger" : "good"}>{loadPct}%</strong><small>{assemblyBottleneck?.line ?? ""} · {assemblyBottleneck?.name ?? "—"} · {assemblyBottleneck?.booths ?? 1} booth{assemblyBottleneck?.booths === 1 ? "" : "s"}</small></article>
      <article><span>Estimated line days</span><strong>{maxLoad.toFixed(1)}</strong><small>of {workingDays} working days</small></article>
    </section>

    <section className={`workspace ${tab === "twin" ? "twin-mode" : ""}`}>
      {tab !== "twin" && <aside>
        <div className="aside-head"><div><span>PRODUCT FAMILY</span><b>Demand pool</b></div><span className="count">{products.length}</span></div>
        <div className="family-chips">{data.families.map((f) => <button key={f} className={selectedFamilies.includes(f) ? "selected" : ""} onClick={() => toggleFamily(f)}>{f}</button>)}</div>
        <label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search material code" /></label>
        <div className="product-list">{products.slice(0, 40).map((p) => <button key={p.id} className="product-card" onClick={() => addProduct(p)}>
          <span><b>{p.materialCode}</b><small>{assemblyLineName(p)} · {p.segment} · {fmt.format(p.orderQty)} pcs</small></span><span className="add">+</span><em>{p.bottleneckSeconds}s</em>
        </button>)}</div>
      </aside>}

      <div className={`main-panel ${tab === "feeder" ? `feeder-layout ${tubeCompletionOpen ? "" : "tube-completion-collapsed"} ${powderTrackerOpen ? "" : "powder-tracker-collapsed"}` : tab === "schedule" ? `schedule-layout ${workingHoursOpen ? "" : "working-hours-collapsed"}` : ""}`}>
        {tab === "plan" && <>
          <div className="panel-head"><div><span>PLAN BOARD · AL 1 / AL 2</span><h2>Production sequence</h2></div><div className="settings"><label>Shift hours<input type="number" value={hours} min="1" max="24" onChange={(e) => setHours(+e.target.value)} /></label><label>Baseline OEE %<input type="number" value={efficiency} min="10" max="100" onChange={(e) => setEfficiency(+e.target.value)} /></label></div></div>
          <div className="holiday-panel"><div><span>NON-WORKING DAYS</span><b>Planning-period holiday list</b><small>Every Tuesday is a default holiday. Sundays are working days.</small></div><div className="holiday-controls"><input aria-label="Holiday date" type="date" min={startDate} max={endDate} value={holidayDraft} onChange={(e) => setHolidayDraft(e.target.value)} /><button onClick={addHoliday} disabled={!holidayDraft}>Add holiday</button></div><div className="holiday-list"><span className="default-holiday"><b>All Tuesdays</b><em>Default</em></span>{holidays.filter((holiday) => holiday >= startDate && holiday <= endDate).length === 0 && <em>No additional holidays</em>}{holidays.filter((holiday) => holiday >= startDate && holiday <= endDate).map((holiday) => <span key={holiday}><b>{dayName.format(new Date(`${holiday}T00:00:00`))}</b><button aria-label={`Remove holiday ${holiday}`} onClick={() => setHolidays((old) => old.filter((item) => item !== holiday))}>×</button></span>)}</div></div>
          <div className="plan-table"><div className="tr th"><span>SEQ</span><span>MATERIAL / FAMILY</span><span>PLAN QTY</span><span>DUE DATE</span><span>BOTTLENECK</span><span>LOAD</span><span></span></div>
            {planned.length === 0 && <div className="empty">Add products from the demand pool to create the production plan.</div>}
            {planned.map((p, i) => { const productLine = assemblyLineForFamily(p.family); const processes = p.cycleTimes.map((seconds, index) => { const machine = data.machines[index]; const booths = index >= ASSEMBLY_START_INDEX ? configuredBooths(stationBooths, machine?.key ?? "", index, productLine) : 1; return { machine, booths, effectiveSeconds: index >= ASSEMBLY_START_INDEX ? seconds / booths : 0 }; }); const bottleneck = processes.reduce<(typeof processes)[number] | null>((slowest, process) => process.effectiveSeconds > 0 && (!slowest || process.effectiveSeconds > slowest.effectiveSeconds) ? process : slowest, null); const lineDays = p.planQty * (bottleneck?.effectiveSeconds ?? 0) / availableSeconds; return <div className="tr" key={p.planId}><span className="seq">{String(i + 1).padStart(2, "0")}</span><span><b>{p.materialCode}</b><small><i className={`family f${p.family}`}>{p.family}</i><i className={`line-badge ${productLine.toLowerCase()}`}>{productLine}</i>{p.segment}</small></span><span><input aria-label={`Quantity for ${p.materialCode}`} type="number" value={p.planQty} onChange={(e) => updatePlan(p.planId, "planQty", +e.target.value)} /></span><span><input aria-label={`Due date for ${p.materialCode}`} type="date" min={startDate} max={endDate} value={p.dueDate} onChange={(e) => updateDueDate(p.planId, e.target.value)} /></span><span><b>{bottleneck?.machine?.name ?? "—"}</b><small>{bottleneck?.effectiveSeconds.toFixed(1) ?? "0.0"} effective sec / piece · {bottleneck?.booths ?? 1} booth{bottleneck?.booths === 1 ? "" : "s"}</small></span><span><b>{lineDays.toFixed(2)} d</b><small>{((lineDays / workingDays) * 100).toFixed(1)}% period</small></span><button className="remove" aria-label={`Remove ${p.materialCode}`} onClick={() => setPlanned((old) => old.filter((x) => x.planId !== p.planId))}>×</button></div>})}
          </div>
          <div className={`feeder-release-note ${feederCapacityOk ? "ready" : "late"}`}><div><span>ONE-MONTH-PRIOR FEEDER RELEASE</span><b>Tube Shop planned in {feederCalendarLabel}</b><small>Assembly schedule starts on Working Day 1: {dayName.format(assemblyReleaseDate)} · Tube Shop estimated ready: {dayName.format(feederReadyDate)}{feederHasOverflow ? ` · ${fmt.format(feederOverflowQuantity)} pcs continue in ${feederNextMonthLabel}` : ""}</small></div><button onClick={() => setTab("feeder")}>Open feeder plan</button></div>
        </>}

        {tab === "actual" && <>
          <div className="panel-head"><div><span>SHOP-FLOOR OUTPUT · DATE WISE</span><h2>Actual production</h2></div><p>Saved automatically to the active planning period</p></div>
          <div className="schedule-line-selector actual-line-selector"><div><span>SELECT ASSEMBLY LINE</span><b>Enter and compare actual production independently</b></div><div><button type="button" className={actualLine === "AL1" ? "active al1" : ""} onClick={() => { setActualLine("AL1"); setActualDraft((old) => ({ ...old, planId: "" })); }}><strong>AL1</strong><small>615 family</small></button><button type="button" className={actualLine === "AL2" ? "active al2" : ""} onClick={() => { setActualLine("AL2"); setActualDraft((old) => ({ ...old, planId: "" })); }}><strong>AL2</strong><small>818 &amp; 1021 families</small></button></div></div>
        </>}

        {tab === "schedule" && <>
          <div className="panel-head"><div><span>DATE-WISE EXECUTION PLAN</span><h2>Production schedule</h2></div><div className="settings"><label>Shift hours<input type="number" value={hours} min="1" max="24" onChange={(e) => setHours(+e.target.value)} /></label><label>Baseline OEE %<input type="number" value={efficiency} min="10" max="100" onChange={(e) => setEfficiency(+e.target.value)} /></label></div></div>
          <div className="schedule-line-selector"><div><span>SELECT PRODUCTION AREA</span><b>View an independent schedule and production chart</b></div><div><button className={scheduleView === "AL1" ? "active al1" : ""} onClick={() => { setScheduleView("AL1"); setScheduleLine("AL1"); setScheduleActualDraft((old) => ({ ...old, planId: "" })); }}><strong>AL1</strong><small>615 family</small></button><button className={scheduleView === "AL2" ? "active al2" : ""} onClick={() => { setScheduleView("AL2"); setScheduleLine("AL2"); setScheduleActualDraft((old) => ({ ...old, planId: "" })); }}><strong>AL2</strong><small>818 &amp; 1021 families</small></button><button className={scheduleView === "FEEDER" ? "active feeder" : ""} onClick={() => setScheduleView("FEEDER")}><strong>FEEDER SHOP</strong><small>PC Tube Store</small></button></div></div>
        </>}

        {(tab === "feeder" || (tab === "schedule" && scheduleView === "FEEDER")) && <>
          {tab === "feeder" && <>
          <div className="panel-head"><div><span>{feederCalendarLabel.toUpperCase()} · TUBE SHOP MONTHLY PLAN</span><h2>One month before assembly production</h2></div><p>{feederHasOverflow ? `${fmt.format(feederOverflowQuantity)} pcs carried into ${feederNextMonthLabel}` : `${feederWorkingDays} feeder working days available`}</p></div>
          <div className="feeder-requirement-basis"><div><span>ASSEMBLY PLAN</span><b>{fmt.format(totalUnits)} pcs</b></div><div><span>FINISHED ACTUAL PRODUCTION</span><b>{fmt.format(totalUnits - totalAssemblyRequirement)} pcs</b></div><div><span>TUBE SHOP REQUIREMENT</span><b>{fmt.format(totalAssemblyRequirement)} pcs</b><small>remaining requirement only</small></div><div><span>{feederHasOverflow ? "NEXT FEEDER MONTH" : "PLANNING BASIS"}</span><b>{feederHasOverflow ? feederNextMonthLabel : "Product due-date priority"}</b><small>{feederHasOverflow ? `${fmt.format(feederOverflowQuantity)} pcs overflow plan` : "planned one month before assembly"}</small></div></div>
          <div className="feeder-section-controls"><button type="button" aria-expanded={tubeCompletionOpen} onClick={() => setTubeCompletionOpen((open) => !open)}><span><b>Tube Shop completion</b><small>Material eligible for vendor dispatch</small></span><strong>{tubeCompletionOpen ? "Minimize ▲" : "Expand ▼"}</strong></button><button type="button" aria-expanded={powderTrackerOpen} onClick={() => setPowderTrackerOpen((open) => !open)}><span><b>Powder coating vendor movement</b><small>Sent, vendor WIP and returned quantities</small></span><strong>{powderTrackerOpen ? "Minimize ▲" : "Expand ▼"}</strong></button></div>
          <section className="tube-product-status-board"><header><div><span>PRODUCT FLOW STATUS</span><h3>Tube Shop to powder coating</h3></div><small>Quantities are consolidated by product across all planned batches</small></header><div className="tube-status-grid">{tubeShopProductStatuses.length === 0 && <div className="empty">No Tube Shop products are planned.</div>}{tubeShopProductStatuses.map((product) => <article key={`tube-status-${product.materialCode}`}><header><div><b>{product.materialCode}</b><small><i className={`family f${product.family}`}>{product.family}</i><i className={`line-badge ${product.assemblyLine.toLowerCase()}`}>{product.assemblyLine}</i></small></div><strong>{fmt.format(product.required)} required</strong></header><div className="tube-status-values"><span className="ready"><small>READY FOR POWDER COATING</small><b>{fmt.format(product.readyForPowderCoating)}</b><em>Tube complete · awaiting dispatch</em></span><span className="sent"><small>SENT TO POWDER COATING</small><b>{fmt.format(product.sent)}</b><em>{fmt.format(product.atVendor)} currently at vendor</em></span><span className="returned"><small>POWDER COATED</small><b>{fmt.format(product.returned)}</b><em>Ready for assembly</em></span></div><footer><i><strong style={{ width: `${product.required ? Math.min(100, product.returned / product.required * 100) : 0}%` }} /></i><span>{product.required ? Math.round(product.returned / product.required * 100) : 0}% powder-coated</span></footer></article>)}</div></section>
          </>}
          {tab === "schedule" && <>
          <section className="line-schedule-chart feeder-calendar-chart">
            <header><div><span>TUBE SHOP · DATE-WISE PRODUCTION CHART</span><h3>{feederCalendarLabel} feeder schedule</h3></div><small>Automatically continues into the next month when capacity is exceeded</small></header>
            <div className="line-chart-scroll"><div className="line-chart-grid" style={{ gridTemplateColumns: `200px repeat(${feederCalendarDays}, minmax(40px,1fr))` }}>
              <div className="line-chart-corner">PRODUCT / REQUIRED</div>
              {feederDailyPlan.map((day) => <div className={`line-chart-day ${day.off ? "off" : ""}`} key={`feeder-head-${day.key}`}><b>{day.value.getDate()}</b><small>{day.value.toLocaleDateString("en-IN", { weekday: "narrow" })}</small></div>)}
              {feederCalendarProductRows.flatMap((group) => { const actualTotalForProduct = group.items.reduce((sum, item) => sum + (feederShiftActualByPlan.get(item.planId) ?? 0), 0); return [<div className="line-chart-product" key={`feeder-${group.materialCode}-label`}><b>{group.materialCode}</b><small>{fmt.format(actualTotalForProduct)} actual · {fmt.format(group.requiredQuantity)} remaining</small><em>{group.items.length > 1 ? `${group.items.length} batches` : "Tube Shop"}</em></div>, ...feederDailyPlan.map((day) => { const plannedPieces = day.entries.filter((entry) => group.planIds.has(entry.planId)).reduce((sum, entry) => sum + entry.quantity, 0); const actualPieces = group.items.reduce((sum, item) => { const checkpoint = feederShiftActual[`${day.key}:${item.planId}`]; return sum + (checkpoint?.endOfDayQuantity ?? checkpoint?.beforeLunchQuantity ?? 0); }, 0); return <div className={`line-chart-cell ${day.off ? "off" : plannedPieces ? "active" : ""} ${actualPieces ? "has-actual" : ""}`} title={`${group.materialCode} · ${dayName.format(day.value)} · ${fmt.format(plannedPieces)} planned · ${fmt.format(actualPieces)} actual`} key={`feeder-${group.materialCode}-${day.key}`}>{plannedPieces > 0 && <i><b>{fmt.format(plannedPieces)}</b><small>plan</small></i>}{actualPieces > 0 && <strong className="actual-cell-value"><b>{fmt.format(actualPieces)}</b><small>actual</small></strong>}</div>; })]; })}
              {feederCalendarProductRows.length === 0 && <div className="line-chart-empty" style={{ gridColumn: `1 / span ${feederCalendarDays + 1}` }}>No Tube Shop production is required.</div>}
            </div></div>
          </section>
          <section className="time-wise-planner feeder-time-wise-planner">
            <header className="time-wise-head"><div><span>TIME-WISE TUBE SHOP PLAN</span><h3>Working-day calendar</h3><p>Select a feeder working day to open its shift agenda.</p></div><div className="shift-window"><b>8:00 AM – 5:00 PM</b><small>Lunch 12:30–1:00 · Tea 4:00–4:10</small></div></header>
            <div className="time-wise-layout">
              <aside className="working-day-list" aria-label="Tube Shop working days">{feederTimeWiseWorkingDays.map((day) => <button type="button" className={activeFeederDayPlanKey === day.key ? "active" : ""} onClick={() => { setSelectedFeederDayPlanDate(day.key); setFeederActualDraft({ date: day.key, planId: "", beforeLunchQuantity: "", endOfDayQuantity: "" }); }} key={`feeder-time-day-${day.key}`}><time>{day.value.getDate()}</time><span><b>{day.value.toLocaleDateString("en-IN", { weekday: "long" })}</b><small>{day.value.toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</small></span><i>›</i></button>)}</aside>
              <div className="day-agenda">
                <div className="agenda-title"><div><span>{activeFeederDayPlan?.value.toLocaleDateString("en-IN", { weekday: "long" })}</span><h4>{activeFeederDayPlan?.value.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</h4></div><div className="agenda-shift-actions"><strong>TUBE SHOP · {fmt.format(activeFeederDayPlan?.total ?? 0)} planned · {fmt.format(activeFeederActualTotal)} actual</strong><span>{dailyShiftHours[activeFeederDayPlanKey] ?? hours}h shift · {efficiency}% OEE</span><button type="button" onClick={() => resetFeederDay(activeFeederDayPlanKey)}>Reset shift &amp; quantities</button></div></div>
                <div className="outlook-day" style={{ height: `${Math.max(770, ...feederTimeWiseAgendaBlocks.map((item) => 110 + Math.max(0, item.endMinute - 8 * 60) * 1.2))}px` }}>
                  {Array.from({ length: 10 }, (_, index) => { const minute = 8 * 60 + index * 60; return <div className="outlook-hour" style={{ top: `${20 + index * 72}px` }} key={`feeder-hour-${minute}`}><time>{clockMinuteLabel(minute)}</time><i /></div>; })}
                  {feederTimeWiseDayPlan.length === 0 && <div className="agenda-empty outlook-empty"><b>No Tube Shop production planned</b><span>This feeder working day is available.</span></div>}
                  {feederTimeWiseAgendaBlocks.map((item) => { const top = 22 + Math.max(0, item.startMinute - 8 * 60) * 1.2; const height = Math.max(48, (item.endMinute - item.startMinute) * 1.2 - 5); const isFirstSegment = item.startMinute === item.clockStartMinute; const isLastSegment = item.endMinute === item.clockEndMinute; const afterTea = item.startMinute === 16 * 60 + 10; const checkpointKey = `${activeFeederDayPlanKey}:${item.planId}`; const savedCheckpoint = feederShiftActual[checkpointKey]; const isEditing = feederActualDraft.date === activeFeederDayPlanKey && feederActualDraft.planId === item.planId; const recordedActual = savedCheckpoint?.endOfDayQuantity ?? savedCheckpoint?.beforeLunchQuantity ?? 0; return <article className={`agenda-production outlook-event ${isFirstSegment || isLastSegment ? "has-actual-entry" : ""} ${afterTea ? "end-checkpoint-segment" : ""}`} style={{ top: `${top}px`, height: `${height}px` }} key={`feeder-agenda-${activeFeederDayPlanKey}-${item.planId}-${item.windowIndex}`}><time><b>{clockMinuteLabel(item.startMinute)}</b><small>{clockMinuteLabel(item.endMinute)}</small></time><div><span>TUBE SHOP PRODUCTION{item.startMinute > item.clockStartMinute ? " · CONTINUED" : ""}</span><h5>{item.materialCode}</h5><p>{item.historicalActual ? `${fmt.format(item.segmentQuantity)} completed` : `${fmt.format(item.segmentQuantity)} planned`} · {fmt.format(recordedActual)} actual · {item.bottleneckName}</p></div>{(isFirstSegment || isLastSegment) && <div className="calendar-actual-control">{isEditing ? <form onSubmit={saveFeederShiftActual}>{isFirstSegment ? <input autoFocus aria-label={`Tube Shop before lunch actual for ${item.materialCode}`} type="number" inputMode="numeric" min="0" step="1" placeholder="Before lunch" value={feederActualDraft.beforeLunchQuantity} onChange={(event) => setFeederActualDraft((old) => ({ ...old, date: activeFeederDayPlanKey, planId: item.planId, beforeLunchQuantity: event.target.value }))} /> : <input autoFocus aria-label={`Tube Shop end-of-day actual for ${item.materialCode}`} type="number" inputMode="numeric" min="0" step="1" placeholder="End-of-day" value={feederActualDraft.endOfDayQuantity} onChange={(event) => setFeederActualDraft((old) => ({ ...old, date: activeFeederDayPlanKey, planId: item.planId, endOfDayQuantity: event.target.value }))} />}<button type="submit">Save</button><button type="button" className="cancel" onClick={() => setFeederActualDraft({ date: activeFeederDayPlanKey, planId: "", beforeLunchQuantity: "", endOfDayQuantity: "" })}>×</button></form> : <button type="button" onClick={() => setFeederActualDraft({ date: activeFeederDayPlanKey, planId: item.planId, beforeLunchQuantity: savedCheckpoint?.beforeLunchQuantity ? String(savedCheckpoint.beforeLunchQuantity) : "", endOfDayQuantity: savedCheckpoint?.endOfDayQuantity ? String(savedCheckpoint.endOfDayQuantity) : "" })}><b>{isFirstSegment ? (savedCheckpoint?.beforeLunchQuantity === undefined ? "+ Add before lunch" : "Edit before lunch") : (savedCheckpoint?.endOfDayQuantity === undefined ? "+ Add end-of-day" : "Edit end-of-day")}</b><small>{isFirstSegment ? "Tube Shop midday checkpoint" : "Tube Shop shift-end checkpoint"}</small></button>}</div>}</article>; })}
                  <div className="agenda-break lunch outlook-break" style={{ top: `${22 + (12.5 * 60 - 8 * 60) * 1.2}px`, height: "36px" }}><time>12:30 PM</time><span><b>Lunch break</b><small>30 minutes · resumes 1:00 PM</small></span></div>
                  <div className="agenda-break tea outlook-break" style={{ top: `${22 + (16 * 60 - 8 * 60) * 1.2}px`, height: "32px" }}><time>4:00 PM</time><span><b>Tea break</b><small>10 minutes · resumes 4:10 PM</small></span></div>
                </div>
              </div>
            </div>
          </section>
          </>}
          {tab === "feeder" && <>
          <button type="button" className="working-hours-toggle" aria-expanded={feederWorkingHoursOpen} onClick={() => setFeederWorkingHoursOpen((open) => !open)}><span><b>Suggested day-wise working hours</b><small>Tube Shop shift recommendation across the full feeder schedule</small></span><strong>{feederWorkingHoursOpen ? "Minimize ▲" : "Expand ▼"}</strong></button>
          {feederWorkingHoursOpen && <section className="working-hours-suggestion"><div className="working-hours-head"><div><span>EDITABLE TUBE SHOP SHIFT PLAN</span><h3>Suggested day-wise working hours</h3><p>Recommendations use each day’s product mix, actual Tube Shop cycle times, available stations and baseline OEE.</p></div><div><b>{efficiency}%</b><small>baseline OEE</small><b>{hours.toFixed(1)}h</b><small>default shift</small></div></div><div className="working-hours-table"><div className="working-hours-row working-hours-labels"><span>DATE</span><span>DAY STATUS</span><span>PLANNED QTY</span><span>BOTTLENECK PROCESS</span><span>SUGGESTED HOURS</span><span>PRODUCTS</span><span>EDIT SHIFT HOURS</span></div>{feederDailyWorkingHourSuggestions.map((day) => <div className={`working-hours-row ${day.status.toLowerCase().replaceAll(" ", "-")}`} key={`feeder-hours-${day.key}`}><span><b>{dayName.format(day.value)}</b><small>{day.key}</small></span><span><i>{day.status}</i></span><span><b>{day.total ? `${fmt.format(day.total)} pcs` : "—"}</b><small>{day.entries.length ? `${day.entries.length} scheduled batch${day.entries.length === 1 ? "" : "es"}` : "No production"}</small></span><span><b>{day.bottlenecks.join(", ") || "—"}</b></span><span><b>{day.suggestedHours ? `${day.suggestedHours.toFixed(1)} h` : "—"}</b><small>At {efficiency}% OEE</small></span><span><b>{day.products.join(", ") || "—"}</b></span><span className="daily-hours-editor"><input aria-label={`Tube Shop shift hours for ${day.key}`} type="number" min="1" max="24" step="0.5" disabled={day.off} value={day.off ? 0 : dailyShiftHours[day.key] ?? hours} onChange={(event) => setDailyShiftHours((old) => ({ ...old, [day.key]: Math.min(24, Math.max(1, Number(event.target.value) || hours)) }))} /><button type="button" disabled={day.off || dailyShiftHours[day.key] === undefined} onClick={() => setDailyShiftHours((old) => { const next = { ...old }; delete next[day.key]; return next; })}>Reset</button><small>{day.off ? "Non-working day" : `Suggested ${day.suggestedHours.toFixed(1)} h`}</small></span></div>)}</div><footer><b>Capacity-linked recommendations</b><span>Editing a Tube Shop shift immediately recalculates daily quantities, overflow dates, the time-wise plan and powder-coating dispatch availability.</span></footer></section>}
          <div className="feeder-summary">{feederShopSummary.map((shop) => <article className={shop.ready ? "ready" : "pending"} key={shop.shop}><span>{shop.shop.toUpperCase()}</span><b>{fmt.format(shop.completedItems)} / {fmt.format(totalUnits)}</b><small>finished sets · {shop.days.toFixed(1)} actual workload days · bottleneck: {shop.bottleneck?.name ?? "—"}</small><i><strong style={{ width: `${Math.min(100, shop.completionRatio * 100)}%` }} /></i><em>{shop.ready ? "READY" : "MONTHLY TARGET"}</em></article>)}</div>
          <section className="feeder-daily-plan vendor-dispatch-plan"><header><div><span>TRANSPORT-EFFICIENT OUTSOURCED PROCESS PLAN</span><h3>Powder-coating vendor dispatch</h3><p>Tube batches are consolidated chronologically into full transport loads; only the final load may be partial.</p></div><div className="vendor-settings"><label>Vehicle capacity<input aria-label="Vendor transport capacity" type="number" min="1" step="1" value={vendorDispatchCapacity} onChange={(event) => setVendorDispatchCapacity(Math.max(1, Math.trunc(+event.target.value || 2500)))} /><small>pieces / dispatch</small></label><label>Vendor turnaround<input aria-label="Powder coating turnaround working days" type="number" min="1" max="30" step="1" value={powderCoatingLeadDays} onChange={(event) => setPowderCoatingLeadDays(Math.min(30, Math.max(1, Math.trunc(+event.target.value || 1))))} /><small>working days</small></label></div></header><div className="feeder-daily-scroll"><div className="feeder-daily-row feeder-daily-head"><span>DISPATCH DATE</span><span>TRANSPORT LOAD</span><span>PRODUCT MIX</span><span>EXPECTED RETURN</span><span>UTILIZATION</span></div>{vendorDispatchPlan.length === 0 && <div className="empty">No vendor dispatch is required for the current Tube Shop balance.</div>}{vendorDispatchPlan.map((load) => <div className="feeder-daily-row planned" key={`vendor-load-${load.loadNumber}`}><span><b>{dayName.format(load.dispatchDate)}</b><small>Material ready {dayName.format(load.latestTubeCompletion)}</small></span><span><b>Load {String(load.loadNumber).padStart(2, "0")}</b><strong>{fmt.format(load.quantity)} / {fmt.format(vendorDispatchCapacity)} pcs</strong></span><span className="feeder-day-products">{load.items.map((item, index) => <em key={`${load.loadNumber}-${item.planId}-${index}`}><b>{item.materialCode}</b>{fmt.format(item.quantity)} pcs</em>)}</span><span><b>{dayName.format(load.expectedReturnDate)}</b><small>{powderCoatingLeadDays} working-day turnaround</small></span><span><i>{load.utilization}% FULL</i><small>{fmt.format(vendorDispatchCapacity - load.quantity)} spare</small></span></div>)}</div></section>
          <section className="powder-coating-tracker">
            <div className="feeder-product-title"><div><span>OUTSOURCED PROCESS TRACKING</span><b>Powder coating vendor movement</b></div><small>Only material received back is released to assembly</small></div>
            <div className="powder-flow"><span>1 · Tube Shop complete</span><i>→</i><span>2 · Sent to external vendor</span><i>→</i><span>3 · Received after powder coating</span><i>→</i><strong>READY FOR ASSEMBLY</strong></div>
            <div className="powder-product-grid">{tubeShopProductStatuses.map((product) => <article key={`powder-${product.materialCode}`}><header><div><b>{product.materialCode}</b><small><i className={`family f${product.family}`}>{product.family}</i><i className={`line-badge ${product.assemblyLine.toLowerCase()}`}>{product.assemblyLine}</i>{fmt.format(product.required)} planned · {product.planIds.length} batch{product.planIds.length === 1 ? "" : "es"}</small></div><strong>{fmt.format(product.returned)} ready for assembly</strong></header><div className="powder-entry-fields"><label>Tube Shop complete<input type="number" value={product.tubeCompleted} readOnly /></label><label>Sent to vendor<input type="number" min="0" max={product.tubeCompleted} step="1" value={product.sent} onChange={(event) => updatePowderProductTotal(product.materialCode, "sent", Math.min(product.tubeCompleted, Math.max(0, Math.trunc(+event.target.value || 0))))} /></label><label>Received back<input type="number" min="0" max={product.sent} step="1" value={product.returned} onChange={(event) => updatePowderProductTotal(product.materialCode, "returned", Math.min(product.sent, Math.max(0, Math.trunc(+event.target.value || 0))))} /></label></div><footer><span><b>{fmt.format(product.atVendor)}</b> at vendor</span><span><b>{fmt.format(product.readyForPowderCoating)}</b> awaiting dispatch</span><span className={product.returned >= product.required ? "ready" : "pending"}><b>{product.required ? Math.round(product.returned / product.required * 100) : 0}%</b> assembly ready</span></footer></article>)}</div>
          </section>
          <div className={`schedule-note ${feederCapacityOk ? "" : "feeder-warning"}`}><b>One-month-prior feeder and powder-coating rule</b><span>Tube Shop quantities are planned in the preceding month. Completed tubes are dispatched to the external powder-coating vendor, and only the quantity received back is released to AL1 or AL2. Riveting remains part of each assembly line.</span></div>
          </>}
        </>}

        {tab === "actual" && <>
          <div className="actual-summary actual-summary-with-oee"><article><span>{actualLine} TOTAL COMPLETED</span><b>{fmt.format(actualTotal)} pcs</b></article><article><span>PRODUCTS REPORTED</span><b>{actualProductCount}</b></article><article><span>DAILY ENTRIES</span><b>{actualLineProduction.length}</b></article><article className="actual-oee-card"><span>ACTUAL OEE</span><label><input aria-label="Actual OEE percentage" type="number" min="1" max="100" step="1" value={actualOee} onChange={(event) => setActualOee(Math.min(100, Math.max(1, Math.trunc(Number(event.target.value) || 80))))} /><b>%</b></label><small>Default 80% · saved with this planning period</small></article></div>
          <section className={`actual-plan-graph ${actualLine.toLowerCase()}`}><header><div><span>{actualLine} · DATE-WISE PERFORMANCE</span><h3>Planned, actual and backlog production</h3><p>{actualLine === "AL1" ? "615 family" : "818 & 1021 families"} · points connect across holidays</p></div><div className="actual-plan-legend"><i className="planned" />Planned<i className="actual" />Actual<i className="backlog" />Backlog<i className="holiday" />Added holiday</div></header><div className="actual-graph-scroll"><svg className="actual-line-chart" width={actualGraphWidth} height="280" viewBox={`0 0 ${actualGraphWidth} 280`} role="img" aria-label={`${actualLine} line graph comparing planned, actual and backlog production by date`}>
            {actualVsPlannedByDay.map((day, index) => day.off ? <g key={`off-${day.key}`}><rect className={day.value.getDay() === 2 ? "weekly-off-band" : "added-holiday-band"} x={Math.max(0, actualGraphX(index) - actualGraphStep / 2)} y="10" width={Math.max(20, actualGraphStep)} height="240"><title>{dayName.format(day.value)} · {day.value.getDay() === 2 ? "Tuesday weekly off" : "Added holiday"}</title></rect><text className={day.value.getDay() === 2 ? "off-band-label" : "off-band-label holiday"} x={actualGraphX(index)} y="17">{day.value.getDay() === 2 ? "OFF" : "HOLIDAY"}</text></g> : null)}
            {[0, .25, .5, .75, 1].map((ratio) => <g key={`grid-${ratio}`}><line className="graph-grid-line" x1="50" x2={actualGraphWidth - 20} y1={actualGraphY(actualVsPlannedPeak * ratio)} y2={actualGraphY(actualVsPlannedPeak * ratio)} /><text className="graph-y-label" x="43" y={actualGraphY(actualVsPlannedPeak * ratio) + 3}>{fmt.format(Math.round(actualVsPlannedPeak * ratio))}</text></g>)}
            <polyline className="planned-line" points={plannedLinePoints}><title>Planned production</title></polyline><polyline className="actual-line" points={actualLinePoints}><title>Actual production</title></polyline><polyline className="backlog-line" points={backlogLinePoints}><title>Daily cumulative backlog</title></polyline>
            {actualVsPlannedByDay.map((day, index) => <g key={`points-${day.key}`}>{!day.off && <><circle className="planned-point" cx={actualGraphX(index)} cy={actualGraphY(day.plannedPieces)} r="3.5" /><circle className="graph-hit-point" cx={actualGraphX(index)} cy={actualGraphY(day.plannedPieces)} r="10"><title>{dayName.format(day.value)} · Planned: {fmt.format(day.plannedPieces)} pcs · Actual: {fmt.format(day.actualPieces)} pcs · Backlog: {fmt.format(day.backlogPieces)} pcs</title></circle><circle className="actual-point" cx={actualGraphX(index)} cy={actualGraphY(day.actualPieces)} r="3.5" /><circle className="graph-hit-point" cx={actualGraphX(index)} cy={actualGraphY(day.actualPieces)} r="10"><title>{dayName.format(day.value)} · Planned: {fmt.format(day.plannedPieces)} pcs · Actual: {fmt.format(day.actualPieces)} pcs · Backlog: {fmt.format(day.backlogPieces)} pcs</title></circle><circle className="backlog-point" cx={actualGraphX(index)} cy={actualGraphY(day.backlogPieces)} r="3.5" /><circle className="graph-hit-point" cx={actualGraphX(index)} cy={actualGraphY(day.backlogPieces)} r="10"><title>{dayName.format(day.value)} · Planned: {fmt.format(day.plannedPieces)} pcs · Actual: {fmt.format(day.actualPieces)} pcs · Backlog: {fmt.format(day.backlogPieces)} pcs</title></circle></>}<text className={day.off ? `graph-x-label ${day.value.getDay() === 2 ? "weekly-off-label" : "added-holiday-label"}` : "graph-x-label"} x={actualGraphX(index)} y="250">{day.day}</text><text className={day.off ? `graph-day-label ${day.value.getDay() === 2 ? "weekly-off-label" : "added-holiday-label"}` : "graph-day-label"} x={actualGraphX(index)} y="264">{day.value.toLocaleDateString("en-IN", { weekday: "short" }).slice(0, 2)}</text></g>)}
          </svg></div><footer className="actual-graph-summary"><span><b>{fmt.format(actualVsPlannedByDay.reduce((sum, day) => sum + day.plannedPieces, 0))}</b> total planned</span><span><b>{fmt.format(actualVsPlannedByDay.reduce((sum, day) => sum + day.actualPieces, 0))}</b> total actual</span><span className={actualTotal >= actualVsPlannedByDay.reduce((sum, day) => sum + day.plannedPieces, 0) ? "ahead" : "behind"}><b>{fmt.format(Math.abs(actualTotal - actualVsPlannedByDay.reduce((sum, day) => sum + day.plannedPieces, 0)))}</b> {actualTotal >= actualVsPlannedByDay.reduce((sum, day) => sum + day.plannedPieces, 0) ? "ahead" : "remaining"}</span></footer></section>
          <form className="actual-entry-form" onSubmit={saveActualProduction}>
            <label>Production date<input aria-label="Actual production date" required type="date" min={startDate} max={endDate} value={actualDraft.date >= startDate && actualDraft.date <= endDate ? actualDraft.date : startDate} onChange={(event) => setActualDraft((old) => ({ ...old, date: event.target.value }))} /></label>
            <label>Product<select aria-label="Actual production product" required value={actualDraft.planId} onChange={(event) => setActualDraft((old) => ({ ...old, planId: event.target.value }))}><option value="">Select planned product</option>{planned.filter((product) => assemblyLineForProduct(product) === actualLine).map((product) => <option value={product.planId} key={product.planId}>{product.materialCode} · {actualLine} · {fmt.format(product.planQty)} planned</option>)}</select></label>
            <label>Before lunch (12:30 PM)<input aria-label="Actual production before lunch" inputMode="numeric" pattern="[0-9]*" type="number" min="0" step="1" placeholder="Before lunch" value={actualDraft.beforeLunchQuantity} onChange={(event) => setActualDraft((old) => ({ ...old, beforeLunchQuantity: event.target.value }))} /></label>
            <label>End of day (5:00 PM)<input aria-label="Actual production at end of day" inputMode="numeric" pattern="[0-9]*" type="number" min="0" step="1" placeholder="End-of-day" value={actualDraft.endOfDayQuantity} onChange={(event) => setActualDraft((old) => ({ ...old, endOfDayQuantity: event.target.value }))} /><small>Must include the before-lunch quantity</small></label>
            <button type="submit">{editingActualId ? "Update production" : "Add production"}</button>
            <button type="button" className="actual-reset-shift" onClick={() => resetAssemblyDay(actualDraft.date >= startDate && actualDraft.date <= endDate ? actualDraft.date : startDate, actualLine)}>Reset shift &amp; quantities</button>
            {editingActualId && <button type="button" className="actual-cancel" onClick={() => { setEditingActualId(null); setActualDraft({ date: startDate, planId: "", beforeLunchQuantity: "", endOfDayQuantity: "" }); }}>Cancel edit</button>}
          </form>
          <div className="actual-table"><div className="actual-row actual-head"><span>DATE</span><span>PRODUCT</span><span>FAMILY / LINE</span><span>SHIFT CHECKPOINTS</span><span>ACTIONS</span></div>{sortedActualProduction.length === 0 && <div className="empty">No actual production has been entered for {actualLine} in this planning period.</div>}{sortedActualProduction.map((record) => <div className="actual-row" key={record.id}><span><b>{dayName.format(new Date(`${record.date}T00:00:00`))}</b><small>{record.date}</small></span><span><b>{record.materialCode}</b></span><span><i className={`family f${record.family}`}>{record.family}</i><i className={`line-badge ${record.assemblyLine.toLowerCase()}`}>{record.assemblyLine}</i></span><span><small>Before lunch: {record.beforeLunchQuantity === undefined ? "—" : `${fmt.format(record.beforeLunchQuantity)} pcs`}</small><strong>End of day: {record.endOfDayQuantity === undefined ? "Pending" : `${fmt.format(record.endOfDayQuantity)} pcs`}</strong>{dailyShiftHours[record.date] !== undefined && <small>Shift extended to {dailyShiftHours[record.date]}h</small>}</span><span className="actual-actions"><button type="button" onClick={() => editActualProduction(record)}>Edit</button><button type="button" onClick={() => resetAssemblyDay(record.date, record.assemblyLine)}>Reset shift &amp; quantities</button><button type="button" className="delete" onClick={() => { setActualProduction((old) => old.filter((item) => item.id !== record.id)); if (editingActualId === record.id) setEditingActualId(null); }}>Delete</button></span></div>)}</div>
        </>}

        {tab === "schedule" && scheduleView !== "FEEDER" && <>
          <section className="pm-planner"><header><div><span>PREVENTIVE MAINTENANCE PLAN</span><h3>Weekly machine PM slots</h3><p>Add a 15-minute PM slot on any working day, or edit its start time and total duration.</p></div><b>{preventiveMaintenanceSlots.filter((slot) => slot.assemblyLine === scheduleLine).length} slots · {scheduleLine}</b></header><div className="pm-add-row"><label>Date<input type="date" min={startDate} max={endDate} value={pmDraft.date} onChange={(event) => setPmDraft((old) => ({ ...old, date: event.target.value }))} /></label><label>Assembly line<select value={pmDraft.assemblyLine} onChange={(event) => setPmDraft((old) => ({ ...old, assemblyLine: event.target.value as AssemblyLine }))}><option value="AL1">AL1</option><option value="AL2">AL2</option></select></label><label>Machine<select value={pmDraft.machineKey} onChange={(event) => setPmDraft((old) => ({ ...old, machineKey: event.target.value }))}><option value="">Select machine</option>{data.machines.slice(ASSEMBLY_START_INDEX).map((machine) => <option value={machine.key} key={`pm-machine-${machine.key}`}>{machine.name}</option>)}</select></label><label>Start time<input type="time" min="08:00" max="17:00" value={pmDraft.startTime} onChange={(event) => setPmDraft((old) => ({ ...old, startTime: event.target.value }))} /></label><label>Duration<input type="number" min="1" step="5" value={pmDraft.durationMinutes} onChange={(event) => setPmDraft((old) => ({ ...old, durationMinutes: Math.max(1, Math.trunc(+event.target.value || 15)) }))} /><small>minutes</small></label><button type="button" onClick={addPreventiveMaintenanceSlot} disabled={!pmDraft.date || !pmDraft.machineKey}>Add PM slot</button></div><div className="pm-slot-list">{preventiveMaintenanceSlots.length === 0 && <div className="empty">No preventive-maintenance slots planned.</div>}{preventiveMaintenanceSlots.map((slot) => { const machine = data.machines.find((item) => item.key === slot.machineKey); return <article key={slot.id}><span><b>{machine?.name ?? slot.machineKey}</b><small>{slot.assemblyLine}</small></span><label>Date<input type="date" min={startDate} max={endDate} value={slot.date} onChange={(event) => updatePreventiveMaintenanceSlot(slot.id, "date", event.target.value)} /></label><label>Start<input type="time" value={slot.startTime} onChange={(event) => updatePreventiveMaintenanceSlot(slot.id, "startTime", event.target.value)} /></label><label>Duration<input type="number" min="1" step="5" value={slot.durationMinutes} onChange={(event) => updatePreventiveMaintenanceSlot(slot.id, "durationMinutes", event.target.value)} /></label><button type="button" onClick={() => setPreventiveMaintenanceSlots((old) => old.filter((item) => item.id !== slot.id))}>Remove</button></article>; })}</div><footer>Each PM duration is deducted from that assembly line’s available production time. Daily quantities and estimated completion dates recalculate automatically.</footer></section>
          <div className="schedule-summary"><div><span>{scheduleLine} · REBALANCED START</span><b>{selectedLineSchedule.find((item) => item.remainingQty > 0) ? dayName.format(selectedLineSchedule.find((item) => item.remainingQty > 0)!.start) : "All complete"}</b></div><div className={selectedLineSchedule.some((item) => !item.onTime) ? "summary-late" : "summary-on-time"}><span>LAST ESTIMATED COMPLETION</span><b>{selectedLineSchedule.filter((item) => item.remainingQty > 0).at(-1) ? dayName.format(selectedLineSchedule.filter((item) => item.remainingQty > 0).at(-1)!.finish) : "All complete"}</b></div><div><span>ON-TIME ORDERS</span><b>{selectedLineSchedule.filter((item) => item.onTime).length} / {selectedLineSchedule.length}</b></div></div>
          <section className={`line-schedule-chart ${scheduleLine.toLowerCase()}`}>
            <header><div><span>{scheduleLine} DATE-WISE PRODUCTION CHART</span><h3>{scheduleLine === "AL1" ? "Assembly Line 1 · 615 family" : "Assembly Line 2 · 818 & 1021 families"}</h3></div><small>One row per product · all dispatch dates are consolidated</small></header>
            <div className="line-chart-scroll"><div className="line-chart-grid" style={{ gridTemplateColumns: `200px repeat(${daysInMonth}, minmax(40px,1fr))` }}>
              <div className="line-chart-corner">PRODUCT / PLAN / ACTUAL</div>
              {calendarDays.map((day) => <div className={`line-chart-day ${day.off ? "off" : ""}`} key={`${scheduleLine}-head-${day.key}`}><b>{day.day}</b><small>{day.weekday}</small></div>)}
              {selectedLineCalendarRows.flatMap((group) => {
                const first = group.items[0];
                const plannedTotal = group.items.reduce((sum, item) => sum + item.requestedPlanQty, 0);
                const actualTotalForProduct = group.items.reduce((sum, item) => sum + (actualByPlan.get(item.planId) ?? 0), 0);
                return [<div className="line-chart-product" key={`${group.materialCode}-label`}><b>{group.materialCode}</b><small>{fmt.format(actualTotalForProduct)} actual / {fmt.format(plannedTotal)} planned</small><em>{fmt.format(first.dailyCapacity)}/day{group.items.length > 1 ? ` · ${group.items.length} dispatches` : ""}</em></div>, ...calendarDays.map((day) => {
                  const dayStartSeconds = elapsedCapacityBeforeDate(day.value, scheduleLine);
                  const dayCapacitySeconds = productiveSecondsForDate(day.value, scheduleLine);
                  const plannedPieces = day.off ? 0 : group.items.reduce((sum, item) => {
                    const assignedLine = dailyAssemblyLines[`${day.key}:${item.planId}`] ?? item.assemblyLine;
                    if (assignedLine !== scheduleLine) return sum;
                    const editedPlanQuantity = dailyProductionEdits[`${day.key}:${item.planId}`]?.plannedQuantity;
                    if (editedPlanQuantity !== undefined) return sum + Math.max(0, editedPlanQuantity);
                    const assignedCycleSeconds = Math.max(1, ...item.cycleTimes.map((seconds, index) => index >= ASSEMBLY_START_INDEX && seconds > 0 ? seconds / planningBooths(stationBooths, data?.machines[index]?.key ?? "", index) : 0));
                    const active = day.value >= item.start && day.value <= item.finish;
                    const overlapSeconds = active ? Math.max(0, Math.min(item.finishOffsetSeconds, dayStartSeconds + dayCapacitySeconds) - Math.max(item.startOffsetSeconds, dayStartSeconds)) : 0;
                    return sum + (overlapSeconds > 0 ? Math.max(1, Math.floor(overlapSeconds / assignedCycleSeconds)) : 0);
                  }, 0);
                  const actualPieces = group.items.reduce((sum, item) => (dailyAssemblyLines[`${day.key}:${item.planId}`] ?? item.assemblyLine) === scheduleLine ? sum + (actualByPlanAndDate.get(`${item.planId}:${day.key}`) ?? 0) : sum, 0);
                  const active = plannedPieces > 0;
                  return <div className={`line-chart-cell ${day.off ? "off" : active ? "active" : ""} ${actualPieces ? "has-actual" : ""}`} title={`${group.materialCode} · ${dayName.format(day.value)} · ${fmt.format(plannedPieces)} planned · ${fmt.format(actualPieces)} actual`} key={`${group.materialCode}-${day.key}`}>{active ? <i><b>{fmt.format(plannedPieces)}</b><small>plan</small></i> : null}{actualPieces > 0 && <strong className="actual-cell-value"><b>{fmt.format(actualPieces)}</b><small>actual</small></strong>}</div>;
                })];
              })}
              {selectedLineCalendarRows.length === 0 && <div className="line-chart-empty" style={{ gridColumn: `1 / span ${daysInMonth + 1}` }}>No products are planned for {scheduleLine}.</div>}
            </div></div>
          </section>
          <section className={`time-wise-planner ${scheduleLine.toLowerCase()}`}>
            <header className="time-wise-head"><div><span>TIME-WISE PRODUCTION PLAN</span><h3>Working-day calendar</h3><p>Select a working day to open its shift agenda.</p></div><div className="shift-window"><b>8:00 AM – 5:00 PM</b><small>Lunch 12:30–1:00 · Tea 4:00–4:10</small></div></header>
            <div className="time-wise-layout">
              <aside className="working-day-list" aria-label="Working days">
                {timeWiseWorkingDays.map((day) => <button type="button" className={activeDayPlanKey === day.key ? "active" : ""} onClick={() => { setSelectedDayPlanDate(day.key); setScheduleActualDraft({ date: day.key, planId: "", beforeLunchQuantity: "", endOfDayQuantity: "" }); }} key={`time-day-${day.key}`}><time>{day.day}</time><span><b>{day.value.toLocaleDateString("en-IN", { weekday: "long" })}</b><small>{day.value.toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</small></span><i>›</i></button>)}
              </aside>
              <div className="day-agenda">
                <div className="agenda-title"><div><span>{activeDayPlanDate.toLocaleDateString("en-IN", { weekday: "long" })}</span><h4>{activeDayPlanDate.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</h4></div><div className="agenda-shift-actions"><strong>{scheduleLine} · {timeWiseDayPlan.reduce((sum, item) => sum + item.pieces, 0).toLocaleString("en-IN")} pcs planned</strong><span>{dailyShiftHours[activeDayPlanKey] ?? hours}h shift</span><button type="button" onClick={() => resetAssemblyDay(activeDayPlanKey, scheduleLine)}>Reset shift &amp; quantities</button></div></div>
                <div className="print-day-heading"><span>LINEPILOT · DAILY PRODUCTION PLAN</span><h2>{scheduleLine} · {activeDayPlanDate.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</h2><p>Shift: {dailyShiftHours[activeDayPlanKey] ?? hours} hours · OEE: {efficiency}% · Planned: {fmt.format(timeWiseDayPlan.reduce((sum, item) => sum + item.pieces, 0))} pieces</p></div>
                <div className="print-day-actions"><button type="button" onClick={() => window.print()}>Print day plan</button></div>
                <div className="day-plan-subtabs"><button type="button" className={scheduleDayView === "plan" ? "active" : ""} onClick={() => setScheduleDayView("plan")}>Day plan</button><button type="button" className={scheduleDayView === "breakdown" ? "active" : ""} onClick={() => setScheduleDayView("breakdown")}>Breakdown and Maintenance</button></div>
                <div className="daily-line-editors"><div><span>CHANGE ASSEMBLY LINE FOR THIS DAY</span><small>Select a destination line for each product planned on {activeDayPlanDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</small></div>{timeWiseDayPlan.map((item) => <label key={`daily-line-${activeDayPlanKey}-${item.planId}`}><b>{item.materialCode}</b><select aria-label={`Assembly line for ${item.materialCode} on ${activeDayPlanKey}`} value={dailyAssemblyLines[`${activeDayPlanKey}:${item.planId}`] ?? item.assemblyLine} onChange={(event) => updateDailyAssemblyLine(activeDayPlanKey, item.planId, event.target.value as AssemblyLine)}><option value="AL1">Move to AL1</option><option value="AL2">Move to AL2</option></select></label>)}</div>
                {scheduleDayView === "breakdown" && <section className="daily-shop-floor-entry"><header><div><span>EDITABLE DAILY PRODUCTION &amp; END-OF-SHIFT ENTRY</span><b>Plan, output, quality, manpower and interruptions</b></div><small>Saved automatically</small></header>{timeWiseDayPlan.map((item) => { const editKey = `${activeDayPlanKey}:${item.planId}`; const edit = dailyProductionEdits[editKey] ?? {}; return <article key={`daily-entry-${editKey}`}><div className="daily-entry-product"><b>{item.materialCode}</b><small>{dailyAssemblyLines[editKey] ?? item.assemblyLine} · cycle-based plan</small></div><label>Planned qty<input type="number" inputMode="numeric" min="0" step="1" value={edit.plannedQuantity ?? item.pieces} onChange={(event) => updateDailyProductionEdit(activeDayPlanKey, item, "plannedQuantity", Math.max(0, Math.trunc(+event.target.value || 0)))} /></label><label>Actual qty<input type="number" inputMode="numeric" min="0" step="1" placeholder="End of shift" value={edit.actualQuantity ?? ""} onChange={(event) => updateDailyProductionEdit(activeDayPlanKey, item, "actualQuantity", Math.max(0, Math.trunc(+event.target.value || 0)))} /></label><label>Rework qty<input type="number" inputMode="numeric" min="0" step="1" value={edit.reworkQuantity ?? ""} onChange={(event) => updateDailyProductionEdit(activeDayPlanKey, item, "reworkQuantity", Math.max(0, Math.trunc(+event.target.value || 0)))} /></label><label>Rejection qty<input type="number" inputMode="numeric" min="0" step="1" value={edit.rejectionQuantity ?? ""} onChange={(event) => updateDailyProductionEdit(activeDayPlanKey, item, "rejectionQuantity", Math.max(0, Math.trunc(+event.target.value || 0)))} /></label><label>Manpower<input type="number" inputMode="numeric" min="0" step="1" placeholder="Operators" value={edit.manpower ?? ""} onChange={(event) => updateDailyProductionEdit(activeDayPlanKey, item, "manpower", Math.max(0, Math.trunc(+event.target.value || 0)))} /></label><label>Interruption<select value={edit.interruption ?? "none"} onChange={(event) => updateDailyProductionEdit(activeDayPlanKey, item, "interruption", event.target.value)}><option value="none">No interruption</option><option value="breakdown">Machine breakdown</option><option value="power-cut">Power cut</option></select></label><label>Downtime (min)<input type="number" inputMode="numeric" min="0" step="1" disabled={!edit.interruption || edit.interruption === "none"} value={edit.downtimeMinutes ?? ""} onChange={(event) => updateDailyProductionEdit(activeDayPlanKey, item, "downtimeMinutes", Math.max(0, Math.trunc(+event.target.value || 0)))} /></label></article>; })}</section>}
                <section className="machine-owner-panel"><header><div><span>MACHINE OWNER</span><b>Machine-wise manpower plan and actual</b></div><small>Every assembly-line station is listed; assign the planned and actual owner per machine.</small></header><div className="machine-owner-table"><div className="machine-owner-row machine-owner-head"><span>MACHINE</span><span>BOOTHS</span><span>PLANNED OPERATOR</span><span>ACTUAL OPERATOR</span></div>{data.machines.slice(ASSEMBLY_START_INDEX).map((machine, machineIndex) => { const index = ASSEMBLY_START_INDEX + machineIndex; const machineKey = machine.key; const ownerKey = `${activeDayPlanKey}:${scheduleLine}:${machineKey}`; const owner = machineOwners[ownerKey] ?? {}; return <div className="machine-owner-row" key={ownerKey}><span><b>{machine.name}</b><small>{machine.section} · {scheduleLine}</small></span><span>{configuredBooths(stationBooths, machineKey, index, scheduleLine)}</span><select aria-label={`Planned machine owner for ${machineKey}`} value={owner.plannedOperator ?? ""} onChange={(event) => updateMachineOwner(activeDayPlanKey, scheduleLine, machineKey, "plannedOperator", event.target.value)}><option value="">Select operator</option>{skillMatrix?.workers.map((worker) => <option value={worker.name} key={`planned-owner-${ownerKey}-${worker.id}`}>{worker.name}</option>)}</select><select aria-label={`Actual machine owner for ${machineKey}`} value={owner.actualOperator ?? ""} onChange={(event) => updateMachineOwner(activeDayPlanKey, scheduleLine, machineKey, "actualOperator", event.target.value)}><option value="">Select operator</option>{skillMatrix?.workers.map((worker) => <option value={worker.name} key={`actual-owner-${ownerKey}-${worker.id}`}>{worker.name}</option>)}</select></div>; })}</div></section>
                <div className="outlook-day" style={{ display: scheduleDayView === "plan" ? undefined : "none", height: `${Math.max(770, ...timeWiseAgendaBlocks.map((item) => 110 + Math.max(0, item.endMinute - 8 * 60) * 1.2))}px` }}>
                  {Array.from({ length: 10 }, (_, index) => { const minute = 8 * 60 + index * 60; return <div className="outlook-hour" style={{ top: `${20 + index * 72}px` }} key={`hour-${minute}`}><time>{clockMinuteLabel(minute)}</time><i /></div>; })}
                  {timeWiseDayPlan.length === 0 && <div className="agenda-empty outlook-empty"><b>No production planned</b><span>This is an available working day for {scheduleLine}.</span></div>}
                  {timeWiseAgendaBlocks.map((item) => { const top = 22 + Math.max(0, item.startMinute - 8 * 60) * 1.2; const height = Math.max(48, (item.endMinute - item.startMinute) * 1.2 - 5); const isFirstSegment = item.startMinute === item.clockStartMinute; const isLastSegment = item.endMinute === item.clockEndMinute; const isEditingActual = scheduleActualDraft.date === activeDayPlanKey && scheduleActualDraft.planId === item.planId; const savedCheckpoint = actualProduction.find((record) => record.planId === item.planId && record.date === activeDayPlanKey); const recordedActual = savedCheckpoint?.quantity ?? 0; return <article className={`agenda-production outlook-event ${isFirstSegment || isLastSegment ? "has-actual-entry" : ""} ${isLastSegment ? "end-checkpoint-segment" : ""}`} style={{ top: `${top}px`, height: `${height}px` }} key={`agenda-${activeDayPlanKey}-${item.planId}-${item.windowIndex}`}><time><b>{clockMinuteLabel(item.startMinute)}</b><small>{clockMinuteLabel(item.endMinute)}</small></time><div><span>{scheduleLine} PRODUCTION{item.startMinute > item.clockStartMinute ? " · CONTINUED" : ""}</span><h5>{item.materialCode}</h5><p>{fmt.format(item.segmentPieces)} planned · {fmt.format(recordedActual)} actual · {item.family} family</p></div>{(isFirstSegment || isLastSegment) && <div className="calendar-actual-control">{isEditingActual ? <form onSubmit={saveScheduleActualProduction}>{isFirstSegment ? <input autoFocus aria-label={`Before lunch actual for ${item.materialCode}`} type="number" inputMode="numeric" min="0" step="1" placeholder="Before lunch" value={scheduleActualDraft.beforeLunchQuantity} onChange={(event) => setScheduleActualDraft((old) => ({ ...old, date: activeDayPlanKey, planId: item.planId, beforeLunchQuantity: event.target.value }))} /> : <input autoFocus aria-label={`End-of-day actual for ${item.materialCode}`} type="number" inputMode="numeric" min="0" step="1" placeholder="End-of-day" value={scheduleActualDraft.endOfDayQuantity} onChange={(event) => setScheduleActualDraft((old) => ({ ...old, date: activeDayPlanKey, planId: item.planId, endOfDayQuantity: event.target.value }))} />}<button type="submit">Save</button><button type="button" className="cancel" onClick={() => setScheduleActualDraft({ date: activeDayPlanKey, planId: "", beforeLunchQuantity: "", endOfDayQuantity: "" })}>×</button></form> : <button type="button" onClick={() => setScheduleActualDraft({ date: activeDayPlanKey, planId: item.planId, beforeLunchQuantity: savedCheckpoint?.beforeLunchQuantity ? String(savedCheckpoint.beforeLunchQuantity) : "", endOfDayQuantity: savedCheckpoint?.endOfDayQuantity ? String(savedCheckpoint.endOfDayQuantity) : "" })}><b>{isFirstSegment ? (savedCheckpoint?.beforeLunchQuantity === undefined ? "+ Add before lunch" : "Edit before lunch") : (savedCheckpoint?.endOfDayQuantity === undefined ? "+ Add end-of-day" : "Edit end-of-day")}</b><small>{isFirstSegment ? (savedCheckpoint?.beforeLunchQuantity === undefined ? "Before lunch checkpoint" : `${fmt.format(savedCheckpoint.beforeLunchQuantity)} pcs saved`) : (savedCheckpoint?.endOfDayQuantity === undefined ? "End-of-day checkpoint" : `${fmt.format(savedCheckpoint.endOfDayQuantity)} pcs saved`)}</small></button>}</div>}</article>; })}
                  <div className="agenda-break lunch outlook-break" style={{ top: `${22 + (12.5 * 60 - 8 * 60) * 1.2}px`, height: "36px" }}><time>12:30 PM</time><span><b>Lunch break</b><small>30 minutes · resumes 1:00 PM</small></span></div>
                  <div className="agenda-break tea outlook-break" style={{ top: `${22 + (16 * 60 - 8 * 60) * 1.2}px`, height: "32px" }}><time>4:00 PM</time><span><b>Tea break</b><small>10 minutes · resumes 4:10 PM</small></span></div>
                </div>
              </div>
            </div>
          </section>
          <div className="schedule-table"><div className="schedule-row schedule-head"><span>SEQ</span><span>PRODUCT</span><span>START PRODUCTION</span><span>ESTIMATED COMPLETION</span><span>DUE DATE</span><span>DURATION</span></div>
            {selectedLineSchedule.length === 0 && <div className="empty">Add products for {scheduleLine} in Production plan to generate a date-wise schedule.</div>}
            {selectedLineSchedule.map((item, index) => <div className="schedule-row" key={item.planId}>
              <span className="seq">{String(index + 1).padStart(2, "0")}</span>
              <span className="schedule-product"><b>{item.materialCode}</b><small><i className={`family f${item.family}`}>{item.family}</i><i className={`line-badge ${item.assemblyLine.toLowerCase()}`}>{item.assemblyLine}</i>{fmt.format(item.feederSupportedQty)} supported · {fmt.format(actualByPlan.get(item.planId) ?? 0)} actual / {fmt.format(item.requestedPlanQty)} planned</small></span>
              <span className="date-cell"><b>{dayName.format(item.start)}</b><small>{item.assemblyLine} · {shiftOffsetLabel(item.startWithinShiftSeconds)}</small></span>
              <span className={`date-cell estimated-completion ${item.onTime ? "completion-on-time" : "completion-late"}`}><b>{dayName.format(item.finish)}</b><small>{shiftOffsetLabel(item.finishWithinShiftSeconds)} · {item.onTime ? "on time" : `${item.lateDays}d late`}</small></span>
              <span className="date-cell"><b>{dayName.format(item.due)}</b><small>Customer requirement</small></span>
              <span><b>{item.duration} day{item.duration === 1 ? "" : "s"}</b><small>{item.exactDurationDays.toFixed(2)} full-plan load days · {item.effectiveBottleneckMachine} / {item.effectiveBottleneckBooths} booth{item.effectiveBottleneckBooths === 1 ? "" : "s"}</small></span>
            </div>)}
          </div>
          <div className="schedule-note"><b>Live booth-adjusted prediction</b><span>The dates predict the complete planned order quantity, while each product row separately shows how many pieces are currently feeder-supported. Every booth added to a Digital Twin bottleneck divides that process load, identifies the next bottleneck if necessary, and immediately recalculates this schedule at {efficiency}% OEE. AL1 and AL2 remain independently sequenced; Tuesdays and listed holidays are skipped.</span></div>
          <button type="button" className="working-hours-toggle" aria-expanded={workingHoursOpen} onClick={() => setWorkingHoursOpen((open) => !open)}><span><b>Suggested day-wise working hours</b><small>Month-wide shift recommendation for AL1 and AL2</small></span><strong>{workingHoursOpen ? "Minimize ▲" : "Expand ▼"}</strong></button>
          <section className="working-hours-suggestion"><div className="working-hours-head"><div><span>EDITABLE DAY-WISE SHIFT PLAN</span><h3>Suggested day-wise working hours</h3><p>Edit any working day. Changes are saved and recalculate capacity and completion predictions.</p></div><div><b>{averageShiftHours.toFixed(1)}h</b><small>average shift</small><b>{efficiency}%</b><small>baseline OEE</small></div></div><div className="working-hours-table"><div className="working-hours-row working-hours-labels"><span>DATE</span><span>DAY STATUS</span><span>AL1 · 615</span><span>AL1 BOTTLENECK</span><span>AL2 · 818 / 1021</span><span>AL2 BOTTLENECK</span><span>EDIT SHIFT HOURS</span></div>{dailyWorkingHourSuggestions.map((day) => <div className={`working-hours-row ${day.status.toLowerCase().replaceAll(" ", "-")}`} key={`hours-${day.key}`}><span><b>{dayName.format(day.value)}</b><small>{day.al1.products.concat(day.al2.products).length ? [...new Set([...day.al1.products, ...day.al2.products])].join(", ") : "—"}</small></span><span><i>{day.status}</i></span><span><b>{day.al1.hours ? `${day.al1.hours.toFixed(1)} h` : "—"}</b><small>{day.al1.products.join(", ") || "No production"}</small></span><span><b>{day.al1.bottleneck}</b></span><span><b>{day.al2.hours ? `${day.al2.hours.toFixed(1)} h` : "—"}</b><small>{day.al2.products.join(", ") || "No production"}</small></span><span><b>{day.al2.bottleneck}</b></span><span className="daily-hours-editor"><input aria-label={`Shift hours for ${day.key}`} type="number" min="1" max="24" step="0.5" disabled={day.status === "Off"} value={day.status === "Off" ? 0 : dailyShiftHours[day.key] ?? hours} onChange={(event) => setDailyShiftHours((old) => ({ ...old, [day.key]: Math.min(24, Math.max(1, Number(event.target.value) || hours)) }))} /><button type="button" disabled={day.status === "Off" || dailyShiftHours[day.key] === undefined} onClick={() => setDailyShiftHours((old) => { const next = { ...old }; delete next[day.key]; return next; })}>Reset</button><small>{day.status === "Off" ? "Non-working day" : `Suggested ${day.suggestedHours.toFixed(1)} h`}</small></span></div>)}</div><footer><b>How suggestions are calculated</b><span>The highest booth-adjusted process workload on each line is divided by effective hourly capacity at {efficiency}% OEE and rounded up to the next 30 minutes. Each edited shift now controls that specific date's capacity, planned calendar quantity, time-wise agenda, occupancy and estimated completion date; unfinished work carries forward automatically.</span></footer></section>
        </>}

        {tab === "capacity" && <>
          <div className="panel-head"><div><span>CAPACITY CHECK · TWO ASSEMBLY LINES</span><h2>Process occupancy</h2></div><p>Based on date-wise shifts (average {averageShiftHours.toFixed(1)}h) at {efficiency}% OEE</p></div>
          <div className="line-allocation-strip"><article><span>ASSEMBLY LINE 1</span><b>615 family</b><small>{fmt.format(planned.filter((p) => p.family === "615").reduce((sum, p) => sum + p.planQty, 0))} pcs planned</small></article><article><span>ASSEMBLY LINE 2</span><b>818 &amp; 1021 families</b><small>{fmt.format(planned.filter((p) => ["818", "1021"].includes(p.family)).reduce((sum, p) => sum + p.planQty, 0))} pcs planned</small></article></div>
          <div className="capacity-tabs"><button className={capacityView === "overview" ? "active" : ""} onClick={() => setCapacityView("overview")}>Period overview</button><button className={capacityView === "daily" ? "active" : ""} onClick={() => setCapacityView("daily")}>Date-wise occupancy</button><button className={capacityView === "graph" ? "active" : ""} onClick={() => setCapacityView("graph")}>Graph</button></div>
          {capacityView === "overview" && <div className="capacity-grid">{loadByMachine.map((m) => { const pct = Math.min(100, Math.round(m.days / workingDays * 100)); return <article key={m.key}><div><b>{m.name}</b><span>{m.days.toFixed(1)} days</span></div><div className="bar"><i style={{ width: `${pct}%` }} /></div><small>{pct}% of selected-period capacity</small></article>})}</div>}
          {capacityView === "daily" && <>
            <div className="heatmap-meta"><div><b>Date-wise machine occupancy</b><span>Sorted by highest occupancy · hover a cell to see load and planned products</span></div><div className="heat-legend"><span><i className="heat low"/>1–39%</span><span><i className="heat medium"/>40–69%</span><span><i className="heat high"/>70–100%</span><span><i className="heat overload"/>&gt;100%</span><span><i className="heat off"/>Off</span></div></div>
            <div className="occupancy-scroll"><div className="occupancy-grid" style={{ gridTemplateColumns: `210px repeat(${daysInMonth}, 42px)` }}>
              <div className="machine-label occupancy-header">PROCESS / DATE</div>{calendarDays.map((day) => <div key={day.key} className={`day-header ${day.off ? "off" : ""}`}><b>{day.day}</b><span>{day.weekday}</span></div>)}
              {sortedProcessOccupancy.flatMap((process) => [<div className="machine-label" key={`${process.key}-label`}><b>{process.name}</b><span>{process.section}</span></div>, ...process.values.map((value, index) => { const day = calendarDays[index]; const level = day.off ? "off" : value.percent > 100 ? "overload" : value.percent >= 70 ? "high" : value.percent >= 40 ? "medium" : value.percent > 0 ? "low" : "empty"; return <div key={`${process.key}-${day.key}`} className={`occupancy-cell ${level}`} title={day.off ? `${dayName.format(day.value)} · Non-working day` : `${process.name} · ${dayName.format(day.value)} · ${value.percent}%${value.products.length ? ` · ${value.products.join(", ")}` : ""}`}><span>{day.off ? "×" : value.percent > 0 ? `${value.percent}%` : ""}</span></div>; })])}
            </div></div>
            <div className="schedule-note"><b>Occupancy calculation</b><span>For each scheduled product, process cycle time × quantity is distributed across its planned working days and compared with daily available seconds. Tuesdays and listed holidays are shown as off; Sundays remain available.</span></div>
          </>}
          {capacityView === "graph" && processOccupancy[graphProcessIndex] && <>
            <div className="graph-toolbar"><div><span>PROCESS GRAPH</span><b>Date-wise occupancy trend</b></div><label>Select process<select value={graphProcessIndex} onChange={(e) => setGraphProcessIndex(+e.target.value)}>{processOccupancy.map((process, index) => <option key={process.key} value={index}>{process.name}</option>)}</select></label></div>
            <div className="graph-kpis"><div><span>SELECTED PROCESS</span><b>{processOccupancy[graphProcessIndex].name}</b></div><div><span>PEAK OCCUPANCY</span><b>{Math.max(...processOccupancy[graphProcessIndex].values.map((value) => value.percent))}%</b></div><div><span>ACTIVE DAYS</span><b>{processOccupancy[graphProcessIndex].values.filter((value) => value.percent > 0).length}</b></div></div>
            <div className="bar-chart-wrap"><div className="y-axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><div className="bar-chart" style={{ gridTemplateColumns: `repeat(${daysInMonth}, minmax(24px, 1fr))` }}>
              {processOccupancy[graphProcessIndex].values.map((value, index) => { const day = calendarDays[index]; const level = day.off ? "off" : value.percent > 100 ? "overload" : value.percent >= 70 ? "high" : value.percent >= 40 ? "medium" : value.percent > 0 ? "low" : "empty"; return <div className={`graph-day ${day.off ? "off" : ""}`} key={day.key} title={day.off ? `${dayName.format(day.value)} · Non-working day` : `${dayName.format(day.value)} · ${value.percent}%${value.products.length ? ` · ${value.products.join(", ")}` : ""}`}><div className="graph-value">{value.percent > 0 ? `${value.percent}%` : ""}</div><div className="graph-bar-track"><i className={level} style={{ height: day.off ? "100%" : `${Math.min(100, value.percent)}%` }} /></div><b>{day.day}</b><span>{day.weekday}</span></div>; })}
            </div></div>
            <div className="graph-caption"><span><i className="capacity-line"/>100% daily capacity</span><p>Bars show the selected process occupancy for each calendar date. Red bars indicate demand above available daily capacity.</p></div>
          </>}
        </>}

        {tab === "skills" && skillMatrix && <>
          <div className="panel-head"><div><span>PEOPLE &amp; MACHINE READINESS</span><h2>Worker skill matrix</h2></div><p>{skillMatrix.source}</p></div>
          <div className="skill-subtabs"><button type="button" className={skillView === "matrix" ? "active" : ""} onClick={() => setSkillView("matrix")}>Skill Matrix</button><button type="button" className={skillView === "owners" ? "active" : ""} onClick={() => setSkillView("owners")}>Machine Owner</button></div>
          <section className={`skill-matrix-panel ${skillView === "owners" ? "owners-hidden" : ""}`}><header><div><span>MACHINE SKILL COVERAGE</span><h3>Assign capable workers to the selected machine</h3><p>{skillMatrix.scale}</p></div><label>Search worker<input value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} placeholder="Name or designation" /></label></header><div className="skill-machine-tabs">{skillMatrix.machines.map((machine, index) => <button type="button" className={skillMachineIndex === index ? "active" : ""} onClick={() => setSkillMachineIndex(index)} key={machine}><b>{machine}</b><small>{machine === "Printing machine-02" ? "PRINTING /BOX PACKING" : machine === "Tubing" ? "TUBE SHOP" : machine.toUpperCase()}</small></button>)}</div><div className="skill-summary"><article><span>SELECTED MACHINE</span><b>{skillMatrix.machines[skillMachineIndex]}</b></article><article><span>WORKERS AT LEVEL 4–5</span><b>{skillMatrix.workers.filter((worker) => worker.skills[skillMachineIndex] >= 4).length}</b></article><article><span>AVERAGE SCORE</span><b>{(skillMatrix.workers.reduce((sum, worker) => sum + worker.skills[skillMachineIndex], 0) / Math.max(1, skillMatrix.workers.length)).toFixed(1)} / 5</b></article></div><div className="skill-table"><div className="skill-row skill-head"><span>WORKER</span><span>DESIGNATION</span><span>SKILL LEVEL</span><span>READINESS</span><span>OTHER MACHINE SKILLS</span></div>{skillMatrix.workers.filter((worker) => !skillSearch.trim() || `${worker.name} ${worker.designation}`.toLowerCase().includes(skillSearch.toLowerCase())).sort((a, b) => b.skills[skillMachineIndex] - a.skills[skillMachineIndex]).map((worker) => { const score = worker.skills[skillMachineIndex]; return <div className="skill-row" key={worker.id}><span><b>{worker.name}</b><small>Overall {worker.percentage.toFixed(1)}%</small></span><span>{worker.designation}</span><span className="skill-score"><b>{score || "—"}</b><i>{score >= 5 ? "Trainer" : score === 4 ? "Independent" : score === 3 ? "Supervised" : score > 0 ? "Learning" : "Not rated"}</i></span><span><strong className={score >= 4 ? "ready" : score >= 3 ? "developing" : "gap"}>{score >= 4 ? "READY" : score >= 3 ? "DEVELOPING" : "SKILL GAP"}</strong></span><span className="skill-mini-list">{skillMatrix.machines.map((machine, index) => index !== skillMachineIndex && worker.skills[index] >= 4 ? <em key={machine}>{machine}</em> : null)}</span></div>; })}</div><footer>Scores are from the attached worker matrix. Level 4 means the worker can operate independently; level 5 means the worker can train others.</footer></section>
        </>}

        {tab === "skills" && skillMatrix && skillView === "owners" && <section className="machine-owner-panel"><header><div><span>MACHINE OWNER</span><b>Machine-wise manpower plan and actual</b><small>{activeDayPlanDate.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })}</small></div><label>Assembly line<select value={scheduleLine} onChange={(event) => setScheduleLine(event.target.value as AssemblyLine)}><option value="AL1">AL1 · 615 family</option><option value="AL2">AL2 · 818 / 1021 families</option></select></label></header><div className="machine-owner-toolbar"><label>Date<select value={activeDayPlanKey} onChange={(event) => setSelectedDayPlanDate(event.target.value)}>{timeWiseWorkingDays.map((day) => <option value={day.key} key={`owner-day-${day.key}`}>{day.value.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })}</option>)}</select></label><small>Assign the planned and actual owner for every station. Changes are saved with this planning period.</small></div><div className="machine-owner-table"><div className="machine-owner-row machine-owner-head"><span>MACHINE</span><span>BOOTHS</span><span>PLANNED OPERATOR</span><span>ACTUAL OPERATOR</span></div>{data.machines.slice(ASSEMBLY_START_INDEX).map((machine, machineIndex) => { const index = ASSEMBLY_START_INDEX + machineIndex; const machineKey = machine.key; const ownerKey = `${activeDayPlanKey}:${scheduleLine}:${machineKey}`; const owner = machineOwners[ownerKey] ?? {}; return <div className="machine-owner-row" key={ownerKey}><span><b>{machine.name}</b><small>{machine.section} · {scheduleLine}</small></span><span>{configuredBooths(stationBooths, machineKey, index, scheduleLine)}</span><select aria-label={`Planned machine owner for ${machineKey}`} value={owner.plannedOperator ?? ""} onChange={(event) => updateMachineOwner(activeDayPlanKey, scheduleLine, machineKey, "plannedOperator", event.target.value)}><option value="">Select operator</option>{skillMatrix.workers.map((worker) => <option value={worker.name} key={`skill-planned-owner-${ownerKey}-${worker.id}`}>{worker.name}</option>)}</select><select aria-label={`Actual machine owner for ${machineKey}`} value={owner.actualOperator ?? ""} onChange={(event) => updateMachineOwner(activeDayPlanKey, scheduleLine, machineKey, "actualOperator", event.target.value)}><option value="">Select operator</option>{skillMatrix.workers.map((worker) => <option value={worker.name} key={`skill-actual-owner-${ownerKey}-${worker.id}`}>{worker.name}</option>)}</select></div>; })}</div></section>}

        {tab === "catalog" && <>
          <div className="panel-head"><div><span>MASTER DATA</span><h2>Product family cycle times</h2></div><div className="catalog-actions"><i className={catalogState}>{catalogState === "saving" ? "Saving…" : catalogState === "error" ? "Save failed" : "Saved"}</i><button onClick={openProductForm}>+ Add product</button></div></div>
          {showProductForm && <form className="product-form" onSubmit={createProduct}>
            <div className="form-title"><div><span>NEW PRODUCT MASTER</span><h3>Enter all Excel master details</h3><p>Every process cycle time is recorded in seconds per piece.</p></div><button type="button" onClick={() => setShowProductForm(false)}>×</button></div>
            <div className="master-fields"><label>Material code<input required value={productDraft.materialCode} placeholder="818-IL-0000" onChange={(e) => setProductDraft((old) => ({ ...old, materialCode: e.target.value }))} /></label><label>Product family<select value={productDraft.family} onChange={(e) => { const family = e.target.value; setProductDraft((old) => ({ ...old, family, assemblyLine: assemblyLineForFamily(family) })); }}><option value="615">615</option><option value="818">818</option><option value="1021">1021</option></select></label><label>Assigned assembly line<select value={productDraft.assemblyLine} onChange={(e) => setProductDraft((old) => ({ ...old, assemblyLine: e.target.value as AssemblyLine }))}><option value="AL1">Assembly Line 1</option><option value="AL2">Assembly Line 2</option></select></label><label>Segment<input required value={productDraft.segment} onChange={(e) => setProductDraft((old) => ({ ...old, segment: e.target.value }))} /></label><label>BOM availability<select value={productDraft.bomAvailable ? "yes" : "no"} onChange={(e) => setProductDraft((old) => ({ ...old, bomAvailable: e.target.value === "yes" }))}><option value="yes">Yes</option><option value="no">No</option></select></label><label>Order quantity<input required min="0" type="number" value={productDraft.orderQty} onChange={(e) => setProductDraft((old) => ({ ...old, orderQty: +e.target.value }))} /></label></div>
            <div className="cycle-title"><b>Process cycle times</b><span>{data.machines.length} fields from the Excel master</span></div>
            <div className="cycle-fields">{data.machines.map((machine, index) => <label key={machine.key}><span>{String(index + 1).padStart(2, "0")}</span>{machine.name}<input required min="0" step="0.1" type="number" value={productDraft.cycleTimes[index] ?? 0} onChange={(e) => setProductDraft((old) => ({ ...old, cycleTimes: old.cycleTimes.map((value, itemIndex) => itemIndex === index ? +e.target.value : value) }))} /></label>)}</div>
            <div className="form-footer"><button type="button" onClick={() => setShowProductForm(false)}>Cancel</button><button type="submit">Save product to database</button></div>
          </form>}
          <div className="deleted-products"><div><b>Deleted products</b><span>{deletedProductIds.length} removed from active master</span></div>{deletedProductIds.length === 0 ? <em>No deleted products</em> : <div>{deletedProductIds.map((id) => { const product = [...sourceProducts, ...customProducts].find((item) => item.id === id); return product ? <span key={id}><b>{product.materialCode}</b><button onClick={() => restoreProduct(id)}>Restore</button></span> : null; })}</div>}</div>
          <div className="catalog-table"><div className="cat-row cat-head"><span>Material code</span><span>Family</span><span>Assembly line</span><span>Segment</span><span>Order qty</span><span>Bottleneck</span><span>Total CT</span><span></span></div>{products.map((p) => <div className="cat-row" key={p.id}><b>{p.materialCode}</b><span><i className={`family f${p.family}`}>{p.family}</i></span><select className="catalog-line-select" aria-label={`Assembly line for ${p.materialCode}`} value={assemblyLineForProduct(p)} onChange={(event) => updateProductAssemblyLine(p, event.target.value as AssemblyLine)}><option value="AL1">AL1</option><option value="AL2">AL2</option></select><span>{p.segment}</span><span>{fmt.format(p.orderQty)}</span><span>{p.bottleneckMachine} · {p.bottleneckSeconds}s</span><span>{p.totalCycleSeconds}s</span><button className="catalog-delete" aria-label={`Delete ${p.materialCode}`} onClick={() => deleteProduct(p)}>Delete</button></div>)}</div>
        </>}

        {tab === "twin" && <div className="twin-shell pragati-twin">
          <div className="twin-appbar"><div><b>LINEPILOT DIGITAL TWIN · {twinLine}</b><span>{twinLine === "AL1" ? "Assembly Line 1 · 615 family" : "Assembly Line 2 · 818 & 1021 families"} · {twinStations.length} active processes</span></div><div className="twin-controls"><div className="twin-line-switch"><button className={twinLine === "AL1" ? "active" : ""} onClick={() => { setTwinLine("AL1"); setTraceFamily("all"); }}>AL1 · 615</button><button className={twinLine === "AL2" ? "active" : ""} onClick={() => { setTwinLine("AL2"); setTraceFamily("all"); }}>AL2 · 818/1021</button></div><button className="reset" onClick={() => setTwinTime(0)}>↻ Start over</button><button className={twinRunning ? "pause" : "start"} onClick={() => setTwinRunning((value) => !value)}>{twinRunning ? "Ⅱ Pause" : "▶ Start"}</button><label className="speed-editor"><span>Simulation speed (1× = real time)</span><b>{twinSpeed}×</b><input aria-label="Simulation speed" type="range" min="1" max="500" step="1" value={twinSpeed} onChange={(e) => setTwinSpeed(+e.target.value)} /></label><div className="simulation-date"><span>SIMULATION DATE</span><b>{simulatedDate.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</b></div><div className="simulation-time"><span>ELAPSED TIME</span><strong>{twinClock}</strong></div></div></div>
          <div className="twin-subtabs"><button className={twinView === "dashboard" ? "active" : ""} onClick={() => setTwinView("dashboard")}>Factory Dashboard</button><button className={twinView === "production" ? "active" : ""} onClick={() => setTwinView("production")}>Production Line</button><button className={twinView === "trace" ? "active" : ""} onClick={() => setTwinView("trace")}>Product Traceability</button><button className={twinView === "scenario" ? "active" : ""} onClick={() => setTwinView("scenario")}>What-If & Maintenance</button><button className={twinView === "route" ? "active" : ""} onClick={() => setTwinView("route")}>Line Designer</button><button className={twinView === "factory3d" ? "active" : ""} onClick={() => setTwinView("factory3d")}>3D Factory</button></div>
          <div className="twin-bottleneck-banner"><span>BOTTLENECK PROCESS · {twinLine}</span><b>{twinBottleneck?.name ?? "No active process"}</b><div><strong>{twinBottleneck?.effectiveCycle.toFixed(1) ?? "0.0"}s</strong><small>effective cycle / piece</small></div><div><strong>{twinBottleneck?.occupancy ?? 0}%</strong><small>planned occupancy</small></div><em>{twinBottleneck ? `${twinBottleneck.booths} booth${twinBottleneck.booths === 1 ? "" : "s"}` : "—"}</em></div>
          {twinView === "dashboard" && <>
            <div className="pragati-kpis"><article><span>{twinLine} PRODUCED</span><b>{fmt.format(twinProduced)} / {fmt.format(twinLineTotalUnits)}</b></article><article><span>CURRENT WIP</span><b className="amber">{twinTokens.filter((token) => assemblyLineForProduct(token) === twinLine && token.active).length}</b></article><article><span>FORECAST / DAY</span><b>{fmt.format(twinForecast)} pcs</b></article><article><span>LINE ALLOCATION</span><b className="red">Product-specific</b></article><article><span>LINE HEALTH</span><b>{twinStations.length ? Math.round(twinStations.reduce((sum, station) => sum + station.health, 0) / twinStations.length) : 100}%</b></article></div>
            <section className="live-flow"><h3>LIVE PRODUCTION FLOW <small>Adjust booths independently for {twinLine}; riveting is part of this assembly route</small></h3><div className="flow-list">{twinStations.map((station) => { const active = station.tokens[0]; const cycle = active ? planned.find((item) => item.planId === active.planId)?.cycleTimes[data.machines.findIndex((machine) => machine.key === station.key)] ?? 0 : 0; const temperature = Math.round(36 + station.occupancy * .18); const vibration = (1.1 + station.occupancy * .018).toFixed(1); const isBottleneck = twinBottleneck?.key === station.key; const boothKey = `${twinLine}:${station.key}`; return <div className={`flow-row ${station.status.toLowerCase()} ${isBottleneck ? "bottleneck-process" : ""}`} key={station.key}><b>{station.name}{isBottleneck && <small>BOTTLENECK</small>}</b><div><span>{station.index < 14 ? "Riveting stage" : "Assembly stage"}</span><span>Product <strong>{active?.materialCode ?? "—"}</strong></span><span>Queue {station.queue}</span><span>Cycle {cycle}s</span><span>Health {station.health}%</span><span>{temperature}°C / {vibration} mm/s</span></div><label className="booth-editor"><span>{twinLine} BOOTHS</span><button type="button" aria-label={`Remove booth from ${station.name} on ${twinLine}`} disabled={station.booths <= 1} onClick={() => setStationBooths((old) => ({ ...old, [boothKey]: Math.max(1, station.booths - 1) }))}>−</button><input aria-label={`Booths for ${station.name} on ${twinLine}`} type="number" min="1" max="20" value={station.booths} onChange={(event) => setStationBooths((old) => ({ ...old, [boothKey]: Math.min(20, Math.max(1, +event.target.value || 1)) }))} /><button type="button" aria-label={`Add booth to ${station.name} on ${twinLine}`} disabled={station.booths >= 20} onClick={() => setStationBooths((old) => ({ ...old, [boothKey]: Math.min(20, station.booths + 1) }))}>+</button></label><em>QUEUE {station.queue}</em><i>{station.status}</i></div>; })}</div></section>
          </>}
          {twinView === "production" && <section className="production-line-view">
            <div className="production-line-head"><div><span>LIVE SINGLE-PIECE FLOW · {twinLine}</span><h3>{twinLine === "AL1" ? "Assembly Line 1 · 615 family" : "Assembly Line 2 · 818 & 1021 families"}</h3><p>Feeders planned in {feederMonthLabel} · assembly released {dayName.format(assemblyReleaseDate)}. Each configured booth is shown separately.</p></div><div><b>{orderedTwinStations.length}</b><span>ACTIVE PROCESSES</span><b>{orderedTwinStations.reduce((sum, station) => sum + station.booths, 0)}</b><span>TOTAL BOOTHS</span></div></div>
            <div className="production-route">{orderedTwinStations.map((station, stationIndex) => {
              return <div className={`process-booth-group ${station.booths > 1 ? "multiple-booths" : "single-booth"}`} style={station.booths > 1 ? { backgroundSize: `${100 - (100 / station.booths)}% 3px` } : undefined} key={station.key}>{Array.from({ length: station.booths }, (_, boothIndex) => {
                  const assigned = station.tokens[boothIndex];
                  const boothStatus = station.status === "DOWN" ? "DOWN" : assigned ? "RUNNING" : "AVAILABLE";
                  return <article className={`production-stage booth-process process-tone-${stationIndex % 7} ${boothStatus.toLowerCase()}`} key={`${station.key}-booth-${boothIndex + 1}`}>
                    <div className="stage-sequence"><span>{String(stationIndex + 1).padStart(2, "0")}</span></div>
                    <header><div><small>{twinLine} · {station.index < 14 ? "RIVETING" : "ASSEMBLY"} · BOOTH {String(boothIndex + 1).padStart(2, "0")}</small><h4>{station.name}</h4></div><em>{boothStatus}</em></header>
                    <div className="stage-metrics"><span>Product<b>{assigned?.materialCode ?? (boothStatus === "DOWN" ? "Stopped" : "Waiting")}</b></span><span>Cycle<b>{assigned?.cycleSeconds ?? 0}s / pc</b></span><span>Queue<b>{boothIndex === 0 ? station.queue : 0}</b></span><span>Occupancy<b>{station.occupancy}%</b></span></div>
                    <div className="booth-process-progress"><span>{assigned ? `${Math.round(assigned.progress * 100)}% of current step` : boothStatus}</span><i><strong style={{ width: `${assigned ? Math.round(assigned.progress * 100) : 0}%` }} /></i></div>
                  </article>;
                })}</div>;
            })}</div>
          </section>}
          {twinView === "trace" && <section className="twin-detail">
            <div className="family-completion">
              {familyCompletion.map((item) => {
                const percent = item.planned ? Math.round(item.completed / item.planned * 100) : 0;
                return <button type="button" className={traceFamily === item.family ? "active" : ""} key={item.family} onClick={() => setTraceFamily(item.family)}>
                  <span>PRODUCT FAMILY {item.family}</span><b>{fmt.format(item.completed)} / {fmt.format(item.planned)}</b><small>completed products · {percent}%</small><i><strong style={{ width: `${percent}%` }} /></i>
                </button>;
              })}
            </div>
            <div className="trace-search"><div className="trace-filters"><label>Product family:<select value={traceFamily} onChange={(e) => setTraceFamily(e.target.value)}><option value="all">All families</option>{familyCompletion.map((item) => <option value={item.family} key={item.family}>{item.family}</option>)}</select></label><label>Search product ID:<input value={traceQuery} onChange={(e) => setTraceQuery(e.target.value)} placeholder="818-IL…" /></label></div><span>{traceTokens.length} live orders</span></div>
            <div className="trace-grid wide"><div className="trace-row trace-head"><span>PRODUCT ID</span><span>COMPLETED / PLANNED</span><span>CURRENT PROCESS</span><span>PROCESS CYCLE TIME</span><span>TOTAL ELAPSED</span><span>CURRENT QUEUE WAIT</span><span>TOTAL WAITING</span><span>ESTIMATED COMPLETION</span></div>{traceTokens.map((token, index) => {
              const product = planned.find((item) => item.planId === token.planId);
              const completed = completedByPlan.get(token.planId) ?? 0;
              const planQty = product?.planQty ?? 0;
              return <div className="trace-row" key={token.planId}><b>{token.materialCode}</b><span className={completed >= planQty && planQty > 0 ? "product-count complete" : "product-count"}><strong>{fmt.format(completed)}</strong> / {fmt.format(planQty)}</span><span>{completed >= planQty && planQty > 0 ? "COMPLETED" : !token.started ? `PLANNED · ${dayName.format(scheduleTiming.get(token.planId)?.start ?? date)}` : data.machines[token.stationIndex]?.name}</span><span className="cycle-time-value">{token.cycleSeconds}s / piece</span><span>{token.started ? ((twinTime + index * 13) / 60).toFixed(1) + " min" : "—"}</span><span>{token.active && twinStations.find((station) => station.key === data.machines[token.stationIndex]?.key)?.queue ? `${Math.round(index * 7)} sec` : "—"}</span><span>{token.started ? `${Math.round(index * 4)} sec` : "—"}</span><span>{completed >= planQty && planQty > 0 ? "Done" : !token.started ? "Waiting for start date" : `${((1 - token.progress) * Math.max(1, token.stationIndex + 1)).toFixed(1)} min`}</span></div>;
            })}</div>
          </section>}
          {twinView === "scenario" && <section className="whatif-layout"><div className="twin-detail"><div className="detail-head"><h3>What-if simulation</h3><span>Change assumptions and observe capacity, queues, and output.</span></div><div className="whatif-form"><label>Monthly demand (pieces)<input type="number" value={totalUnits} readOnly /></label><label>Shift hours per day<input type="number" min="1" max="24" value={hours} onChange={(e) => setHours(+e.target.value)} /></label><label>Calculated takt time<strong>{totalUnits ? (availableSeconds * workingDays / totalUnits).toFixed(1) : "0"} seconds / piece</strong></label><label>Starting machine health ({twinHealth}%)<input type="range" min="40" max="100" value={twinHealth} onChange={(e) => setTwinHealth(+e.target.value)} /></label><div><button onClick={() => setTwinTime(0)}>Evaluate current line</button><button onClick={() => { setTwinHealth(100); setDownStations([]); }}>Balance & restore line</button></div></div></div><aside className="maintenance-panel"><h3>Capacity & maintenance</h3><label>Process<select value={selectedTwinStation} onChange={(e) => setSelectedTwinStation(+e.target.value)}>{twinStations.map((station, index) => <option value={index} key={station.key}>{station.name}</option>)}</select></label><article><span>Monthly occupancy</span><b>{twinStations[selectedTwinStation]?.occupancy ?? 0}%</b></article><button onClick={() => twinStations[selectedTwinStation] && setDownStations((old) => [...new Set([...old, twinStations[selectedTwinStation].key])])}>Inject 10-min breakdown</button><button className="restore" onClick={() => twinStations[selectedTwinStation] && setDownStations((old) => old.filter((key) => key !== twinStations[selectedTwinStation].key))}>Perform maintenance</button></aside></section>}
          {twinView === "route" && <section className="designer-layout"><aside className="station-form"><h3>Add production station</h3><p>Insert a simulation stage into the current route.</p><label>Station name<input value={stationDraft.name} onChange={(e) => setStationDraft((old) => ({ ...old, name: e.target.value }))} /></label><label>Cycle time (seconds)<input type="number" min="1" value={stationDraft.cycle} onChange={(e) => setStationDraft((old) => ({ ...old, cycle: +e.target.value }))} /></label><label>Machines<input type="number" min="1" max="6" value={stationDraft.machines} onChange={(e) => setStationDraft((old) => ({ ...old, machines: +e.target.value }))} /></label><label>Insert after<select value={stationDraft.after} onChange={(e) => setStationDraft((old) => ({ ...old, after: e.target.value }))}><option value="">Start of route</option>{designerStations.map((station) => <option value={String(station.id)} key={station.id}>{station.name}</option>)}</select></label><button disabled={!stationDraft.name.trim()} onClick={() => { const id = crypto.randomUUID(); setExtraStations((old) => [...old, { ...stationDraft, id }]); const currentIds = designerStations.map((station) => String(station.id)); const insertAt = stationDraft.after ? currentIds.indexOf(stationDraft.after) + 1 : 0; currentIds.splice(Math.max(0, insertAt), 0, id); setRouteOrder(currentIds); setStationDraft((old) => ({ ...old, name: "" })); }}>Add station</button></aside><section className="twin-detail"><div className="detail-head"><div><h3>Current production route</h3><small>Drag any row and drop it at the required position.</small></div><span>{designerStations.length} simulation stages</span></div><div className="designer-table"><div><b></b><b>Order</b><b>Station</b><b>Cycle</b><b>Machines</b><b>Effective output</b><b></b></div>{designerStations.map((station, index) => { const stationId = String(station.id); return <div className={`${draggedStationId === stationId ? "dragging" : ""} ${dropStationId === stationId ? "drop-target" : ""}`} draggable key={station.id} onDragStart={(event) => { setDraggedStationId(stationId); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", stationId); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropStationId(stationId); }} onDragLeave={() => setDropStationId((current) => current === stationId ? null : current)} onDrop={(event) => { event.preventDefault(); moveStation(event.dataTransfer.getData("text/plain") || draggedStationId || "", stationId); setDraggedStationId(null); setDropStationId(null); }} onDragEnd={() => { setDraggedStationId(null); setDropStationId(null); }}><span className="drag-handle" title="Drag to change sequence" aria-label={`Drag ${station.name} to change sequence`}>⠿</span><span>{index + 1}</span><b>{station.name}</b><span>{station.cycle}s</span><span>{station.machines}</span><span>{(station.cycle / station.machines).toFixed(1)}s</span><button onClick={() => { setExtraStations((old) => old.filter((item) => item.id !== station.id)); setRouteOrder((old) => old.filter((id) => id !== stationId)); }} disabled={!stationId.includes("-")}>Remove</button></div>; })}</div></section></section>}
          {twinView === "factory3d" && <section className="factory3d"><div className="factory3d-head"><div><h3>3D factory · active line</h3><span>Plan-driven 10,000 sq ft conceptual layout</span></div><strong>{twinRunning ? "● LIVE" : "Ⅱ PAUSED"}</strong></div><div className="factory-plane">{twinStations.map((station, index) => <article key={station.key} className={station.status.toLowerCase()} style={{ left: `${8 + (index % 5) * 19}%`, top: `${10 + Math.floor(index / 5) * 18}%` }}><div><i/><i/></div><b>{station.name}</b><span>{station.tokens[0] ? `${station.tokens[0].materialCode} · ${station.tokens[0].cycleSeconds}s/pc` : station.status}</span></article>)}</div></section>}
          <div className="twin-footnote"><b>Simulation model</b><span>Only processes with a non-zero cycle time for planned products are included. Live telemetry is simulated from the saved plan and Excel cycle times.</span></div>
        </div>}
      </div>
    </section>
    <aside className={`planner-assistant ${assistantOpen ? "open" : ""}`} aria-label="Production planning assistant">
      {assistantOpen && <section className="assistant-panel"><header><div><i>LP</i><span><b>LinePilot Assistant</b><small>{startDate} → {endDate}</small></span></div><button type="button" aria-label="Close planning assistant" onClick={() => setAssistantOpen(false)}>×</button></header><div className="assistant-scope"><span>Answers and changes use the active saved plan</span><b>{planned.length} orders · {fmt.format(totalUnits)} pcs</b></div><div className="assistant-messages">{assistantMessages.length === 0 && <div className="assistant-welcome"><b>Ask or update your production plan</b><p>I can analyse data and propose changes to OEE, shift hours, holidays, product quantities, due dates and process booths.</p><div><button type="button" onClick={() => askPlanningAssistant("What is the planned and actual production?")}>Plan vs actual</button><button type="button" onClick={() => askPlanningAssistant("Which orders are late?")}>Late orders</button><button type="button" onClick={() => askPlanningAssistant("What is the bottleneck?")}>Bottleneck</button></div></div>}{assistantMessages.map((message) => <article className={message.role} key={message.id}><span>{message.role === "assistant" ? "LP" : "You"}</span><p>{message.text}</p></article>)}{pendingAssistantAction && <div className="assistant-confirm"><span>CONFIRM PLAN CHANGE</span><b>{pendingAssistantAction.label}</b><div><button type="button" className="apply" onClick={confirmAssistantAction}>Confirm &amp; apply</button><button type="button" onClick={() => { setPendingAssistantAction(null); setAssistantMessages((old) => [...old, { id: `cancel-${Date.now()}`, role: "assistant", text: "Proposed change cancelled. No planning data was modified." }]); }}>Cancel</button></div></div>}</div><form onSubmit={submitAssistantQuestion}><textarea aria-label="Ask about or change production planning data" rows={2} value={assistantQuestion} onChange={(event) => setAssistantQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); askPlanningAssistant(assistantQuestion); } }} placeholder="Ask a question or instruct a plan change…" /><button type="submit" disabled={!assistantQuestion.trim()}>Send</button></form></section>}
      <button type="button" className="assistant-launcher" aria-expanded={assistantOpen} onClick={() => setAssistantOpen((open) => !open)}><i>✦</i><span>{assistantOpen ? "Close assistant" : "Ask LinePilot"}</span></button>
    </aside>
    <footer><span>Source: {data.source}</span><span>Cycle time values are treated as seconds per piece.</span></footer>
  </main>;
}
