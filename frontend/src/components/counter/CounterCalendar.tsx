import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { DndContext, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent } from '@dnd-kit/core';
import { format, isSameDay } from 'date-fns';
import { collection, getFirestore, onSnapshot, query, Timestamp, where } from 'firebase/firestore';
import { toast } from 'sonner';
import { firebaseApp } from 'app';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Appointment, Service, Shop, Staff, offeredServices, updateAppointment } from '../../utils/firestore';
import { buildDayContext, findConflict, type StaffDayContext } from '../../utils/booking-rules';
import { delayMinutes, expectedStart, projectLane, SHOW_DELAY_MINUTES } from '../../utils/queue-lane';
import { atMinute, minuteAt, minuteOfDay, movedStart, sideBySide, visibleHours, weekDays } from '../../utils/calendar-layout';
import { useStaffBreaks, type StaffBreaks } from '../../utils/hooks/useStaffBreaks';
import useTimeSlotStore from '../../utils/timeSlotStore';
import { CreateAppointmentDialog } from '../CreateAppointmentDialog';
import { STATUS_LABEL } from '../AppointmentsList';
import { customerLabel } from './CounterLane';
import { datumsLocale, t } from '@/i18n';

/** Pixel je Minute: eine Stunde 90 px, auch ein 15-Minuten-Termin bleibt lesbar */
const PX = 1.5;

const hm = (d: Date) => format(d, 'HH:mm');
/** Minuten seit Mitternacht des Tages für einen Zeitstempel aus booking-rules (ms) */
const sinceMidnight = (day: Date, ms: number) => Math.round((ms - atMinute(day, 0).getTime()) / 60000);
/** Bietet die Person die Leistung an? Ohne Auswahl bietet sie alles an (wie im Formular "Termin eintragen") */
const offers = (staff: Staff, serviceId: string) => !Array.isArray(staff.serviceIds) || staff.serviceIds.length === 0 || staff.serviceIds.includes(serviceId);

const STATUS_STYLE: Record<Appointment['status'], string> = {
  scheduled: 'border border-foreground/25 bg-card hover:border-foreground',
  'in-progress': 'bg-signal text-signal-foreground',
  completed: 'bg-foreground/75 text-background',
  cancelled: 'bg-destructive/10 text-destructive line-through',
};

/** Eine Spalte des Kalenders: eine Person an einem Tag */
export interface CalendarColumn {
  key: string;
  staff: Staff;
  day: Date;
  title: string;
  /** zweite Zeile im Kopf, z. B. das Datum in der Wochenansicht */
  subtitle?: string;
}

/** Termin an seinem (beim Verschieben schon neuen) Platz */
type Placed = { a: Appointment; start: Date; end: Date; pending: boolean };

/** Minuten des Tages, die ein Termin belegt (über Mitternacht: bis 24 Uhr), mindestens eine */
const span = (p: Placed) => {
  const start = minuteOfDay(p.start);
  return { start, end: Math.max(start + 1, isSameDay(p.start, p.end) ? minuteOfDay(p.end) : 24 * 60) };
};

const Block = ({
  placed,
  style,
  draggable,
  conflict,
  title,
  onSelect,
  children,
}: {
  placed: Placed;
  style: { top: number; height: number; lane: number; lanes: number };
  draggable: boolean;
  conflict: boolean;
  title: string;
  onSelect: () => void;
  children: ReactNode;
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: placed.a.id, disabled: !draggable });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'absolute z-20 overflow-hidden rounded-lg px-2 text-start text-xs leading-tight shadow-sm',
        STATUS_STYLE[placed.a.status],
        conflict && 'ring-2 ring-destructive',
        placed.pending && 'opacity-60',
        draggable ? 'cursor-grab' : 'cursor-pointer',
        isDragging && 'z-40 cursor-grabbing shadow-lg',
      )}
      style={{
        top: style.top,
        height: style.height,
        insetInlineStart: `calc(${(style.lane / style.lanes) * 100}% + 2px)`,
        width: `calc(${100 / style.lanes}% - 4px)`,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
    >
      {children}
    </div>
  );
};

const Lane = ({ column, height, onClick, children }: { column: CalendarColumn; height: number; onClick: (e: MouseEvent<HTMLDivElement>) => void; children: ReactNode }) => {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  return (
    <div
      ref={setNodeRef}
      data-kalender-spalte={column.key}
      onClick={onClick}
      className={cn('relative cursor-pointer border-s border-border', isOver && 'bg-signal/15')}
      style={{
        height,
        // Linien je Stunde und halbe Stunde
        backgroundImage: 'linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border) / 0.45) 1px, transparent 1px)',
        backgroundSize: `100% ${60 * PX}px, 100% ${30 * PX}px`,
      }}
    >
      {children}
    </div>
  );
};

interface GridProps {
  columns: CalendarColumn[];
  /** Termine im sichtbaren Zeitraum; abgesagte zeigt der Kalender nicht */
  appointments: Appointment[];
  services: Service[];
  shop: Shop;
  breaks: Record<string, StaffBreaks>;
  now: Date;
  onSelect: (appointment: Appointment) => void;
  onCreate: (column: CalendarColumn, start: Date) => void;
  /** Verschieben speichern; bis dahin steht der Termin schon blass am neuen Platz */
  onMove: (appointment: Appointment, column: CalendarColumn, start: Date, end: Date) => Promise<void>;
}

/**
 * Raster mit Zeitachse, eine Spalte je Person (Tag) oder je Tag (Woche einer Person).
 * Grau: außerhalb von Öffnungs- und Arbeitszeit, schraffiert: Pausen – dieselben Regeln wie beim Buchen (booking-rules).
 * In freie Zeit klicken legt einen Termin an, Wartende lassen sich auf eine andere Zeit, Person oder einen anderen Tag ziehen.
 */
export const CalendarGrid = ({ columns, appointments, services, shop, breaks, now, onSelect, onCreate, onMove }: GridProps) => {
  const [pending, setPending] = useState<Record<string, { key: string; start: Date; end: Date }>>({});
  const [drag, setDrag] = useState<{ id: string; key: string | null; start: number } | null>(null);
  // Nach dem Ziehen kommt noch ein Klick – der soll weder den Status-Dialog noch "Termin anlegen" öffnen
  const justDragged = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  // Buchbares Fenster und Pausen je Spalte – ohne Termine, die zeigt der Kalender selbst
  const contexts = useMemo<StaffDayContext[]>(
    () =>
      columns.map((c) =>
        buildDayContext(
          { shop: { ...shop }, staffId: c.staff.id, staff: { ...c.staff }, recurringBreaks: breaks[c.staff.id]?.recurring ?? [], breaks: breaks[c.staff.id]?.single ?? [], appointments: [] },
          c.day,
        ),
      ),
    [columns, shop, breaks],
  );

  const byColumn = useMemo(() => {
    const lists: Placed[][] = columns.map(() => []);
    appointments.forEach((a) => {
      if (a.status === 'cancelled') return;
      const moved = pending[a.id];
      const start = moved ? moved.start : a.startTime.toDate();
      const end = moved ? moved.end : a.endTime.toDate();
      const index = moved ? columns.findIndex((c) => c.key === moved.key) : columns.findIndex((c) => c.staff.id === a.staffId && isSameDay(start, c.day));
      if (index >= 0) lists[index].push({ a, start, end, pending: !!moved });
    });
    return lists;
  }, [columns, appointments, pending]);

  const layouts = useMemo(() => byColumn.map((list) => sideBySide(list.map((p) => ({ id: p.a.id, ...span(p) })))), [byColumn]);

  const { first, last } = useMemo(
    () =>
      visibleHours([
        ...contexts.flatMap((ctx, i) => (ctx.open ? [{ start: sinceMidnight(columns[i].day, ctx.open.start), end: sinceMidnight(columns[i].day, ctx.open.end) }] : [])),
        ...byColumn.flat().map(span),
      ]),
    [contexts, columns, byColumn],
  );
  const y = (minute: number) => (minute - first * 60) * PX;
  const height = (last - first) * 60 * PX;

  // Heute: Verzug der Schlange wie in der Spalte am Tresen ("ca. 10:40")
  const nowMs = now.getTime();
  const projections = useMemo(
    () => columns.map((c, i) => (isSameDay(c.day, nowMs) ? projectLane(byColumn[i].map((p) => p.a), nowMs) : null)),
    [columns, byColumn, nowMs],
  );

  // Beim Öffnen und beim Blättern: heute zur Uhrzeit, sonst zum ersten Termin oder Arbeitsbeginn
  const scrollKey = `${columns.map((c) => c.key).join(',')}|${first}`;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const today = columns.some((c) => isSameDay(c.day, new Date()));
    const starts = byColumn.flat().map((p) => minuteOfDay(p.start));
    const opens = contexts.flatMap((ctx, i) => (ctx.open ? [sinceMidnight(columns[i].day, ctx.open.start)] : []));
    const target = today ? minuteOfDay(new Date()) : Math.min(...starts, ...opens, 24 * 60);
    el.scrollTop = Math.max(0, y(target) - 45);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  const placedById = useMemo(() => new Map(byColumn.flat().map((p) => [p.a.id, p])), [byColumn]);
  const target = (event: DragMoveEvent | DragEndEvent) => {
    const placed = placedById.get(String(event.active.id));
    if (!placed) return null;
    const duration = Math.round((placed.end.getTime() - placed.start.getTime()) / 60000);
    const start = movedStart(minuteOfDay(placed.start), duration, event.delta.y / PX);
    return { placed, duration, start, column: columns.find((c) => c.key === event.over?.id) ?? null };
  };
  const endDrag = () => {
    setDrag(null);
    setTimeout(() => (justDragged.current = false), 0);
  };

  const pick = (e: MouseEvent<HTMLDivElement>, i: number) => {
    if (justDragged.current) return;
    const column = columns[i];
    const start = atMinute(column.day, minuteAt(e.clientY - e.currentTarget.getBoundingClientRect().top, first, PX));
    const reason = findConflict(contexts[i], start.getTime(), start.getTime() + 60000);
    if (reason) {
      toast.info(reason);
      return;
    }
    onCreate(column, start);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={() => (justDragged.current = true)}
      onDragMove={(event) => {
        const r = target(event);
        setDrag(r ? { id: r.placed.a.id, key: r.column?.key ?? null, start: r.start } : null);
      }}
      onDragCancel={endDrag}
      onDragEnd={(event) => {
        const r = target(event);
        endDrag();
        if (!r?.column) return;
        const { placed, column, duration } = r;
        const start = atMinute(column.day, r.start);
        const end = atMinute(column.day, r.start + duration);
        if (column.staff.id === placed.a.staffId && start.getTime() === placed.start.getTime()) return;
        const id = placed.a.id;
        setPending((p) => ({ ...p, [id]: { key: column.key, start, end } }));
        onMove(placed.a, column, start, end).finally(() =>
          setPending((p) => {
            const next = { ...p };
            delete next[id];
            return next;
          }),
        );
      }}
    >
      <div ref={scrollRef} role="region" aria-label={t('Kalender')} className="max-h-[75vh] overflow-auto rounded-3xl border border-border bg-card">
        <div className="grid min-w-full" style={{ gridTemplateColumns: `3rem repeat(${columns.length}, minmax(8.5rem, 1fr))` }}>
          {/* Kopf: Person bzw. Tag, darunter Arbeitszeit oder warum geschlossen */}
          <div className="sticky start-0 top-0 z-40 border-b border-border bg-card" />
          {columns.map((c, i) => {
            const ctx = contexts[i];
            const hours = ctx.open ? `${hm(new Date(ctx.open.start))}–${hm(new Date(ctx.open.end))}` : ctx.closedReason || '';
            return (
              <div key={c.key} className="sticky top-0 z-30 min-w-0 border-b border-s border-border bg-card px-3 py-2">
                <div className={cn('truncate text-sm font-semibold', columns.length > 1 && c.subtitle && isSameDay(c.day, now) && 'underline decoration-signal decoration-4 underline-offset-4')}>{c.title}</div>
                {c.subtitle && <div className="truncate text-xs text-muted-foreground">{c.subtitle}</div>}
                <div className="truncate font-mono text-[11px] text-muted-foreground" title={hours}>
                  {hours}
                </div>
              </div>
            );
          })}

          {/* Zeitachse */}
          <div className="sticky start-0 z-30 bg-card" style={{ height }}>
            {Array.from({ length: last - first }, (_, i) => first + i).map((h) => (
              <span key={h} className="absolute end-1.5 font-mono text-[11px] text-muted-foreground" style={{ top: y(h * 60) + 2 }}>
                {`${h}:00`}
              </span>
            ))}
          </div>

          {columns.map((c, i) => {
            const ctx = contexts[i];
            const projection = projections[i];
            const nowMinute = minuteOfDay(now);
            return (
              <Lane key={c.key} column={c} height={height} onClick={(e) => pick(e, i)}>
                {/* nicht buchbar: vor und nach der Arbeitszeit, ganzer Tag, wenn geschlossen */}
                {ctx.open ? (
                  <>
                    <div className="pointer-events-none absolute inset-x-0 top-0 bg-muted/70" style={{ height: Math.max(0, y(sinceMidnight(c.day, ctx.open.start))) }} />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-muted/70" style={{ top: Math.min(height, y(sinceMidnight(c.day, ctx.open.end))) }} />
                  </>
                ) : (
                  <div className="pointer-events-none absolute inset-0 bg-muted/70" />
                )}
                {ctx.blocked.map((b, k) => (
                  <div
                    key={k}
                    className="pointer-events-none absolute inset-x-0 overflow-hidden border-y border-dashed border-foreground/25 bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,hsl(var(--muted))_6px,hsl(var(--muted))_12px)] px-2 py-0.5 text-[11px] leading-tight text-muted-foreground"
                    style={{ top: y(sinceMidnight(c.day, b.start)), height: ((b.end - b.start) / 60000) * PX }}
                  >
                    {b.reason}
                  </div>
                ))}
                {isSameDay(c.day, now) && nowMinute >= first * 60 && nowMinute <= last * 60 && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-destructive" style={{ top: y(nowMinute) }} />
                )}

                {byColumn[i].map((p) => {
                  const { start, end } = span(p);
                  const pos = layouts[i].get(p.a.id) ?? { lane: 0, lanes: 1 };
                  const blockHeight = Math.max(14, (end - start) * PX);
                  const service = services.find((s) => s.id === p.a.serviceId)?.name ?? '';
                  const late = projection && p.a.status === 'scheduled' ? delayMinutes(p.a, projection) : 0;
                  const ca = projection && late >= SHOW_DELAY_MINUTES ? t('ca. {zeit}', { zeit: hm(expectedStart(p.a, projection)) }) : '';
                  const conflict = p.a.status === 'scheduled' ? findConflict(ctx, p.start.getTime(), p.end.getTime()) : null;
                  const moving = drag?.id === p.a.id ? drag : null;
                  const preview = moving
                    ? `→ ${hm(atMinute(c.day, moving.start))}${moving.key && moving.key !== c.key ? ` · ${columns.find((x) => x.key === moving.key)?.title ?? ''}` : ''}`
                    : '';
                  const who = customerLabel(p.a);
                  return (
                    <Block
                      key={p.a.id}
                      placed={p}
                      style={{ top: y(start), height: blockHeight, ...pos }}
                      draggable={p.a.status === 'scheduled' && !p.pending}
                      conflict={!!conflict}
                      title={[`${hm(p.start)}–${hm(p.end)}`, who, service, ca, conflict].filter(Boolean).join(' · ')}
                      onSelect={() => !justDragged.current && onSelect(p.a)}
                    >
                      <div className="flex h-full min-w-0 flex-col justify-center">
                        <span className="truncate font-semibold">
                          {preview ? (
                            <span className="font-mono">{preview}</span>
                          ) : (
                            <>
                              {conflict && <span className="me-1 rounded-full bg-destructive px-1 text-[10px] font-bold uppercase text-destructive-foreground">{t('Konflikt')}</span>}
                              <span className="font-mono">{hm(p.start)}</span> {who}
                            </>
                          )}
                        </span>
                        {blockHeight >= 34 && <span className="truncate opacity-80">{preview ? who : [service, ca].filter(Boolean).join(' · ')}</span>}
                      </div>
                    </Block>
                  );
                })}
              </Lane>
            );
          })}
        </div>
      </div>
    </DndContext>
  );
};

const REMEMBER = 'tresen.wochePerson';
const remembered = () => {
  try {
    return localStorage.getItem(REMEMBER) ?? '';
  } catch {
    return '';
  }
};

/** Termine einer Woche (ab Montag) live mitlesen; ohne shopId nichts */
const useWeekAppointments = (shopId: string | null, monday: Date) => {
  const [list, setList] = useState<Appointment[]>([]);
  const key = format(monday, 'yyyy-MM-dd');
  useEffect(() => {
    if (!shopId) return;
    const db = getFirestore(firebaseApp);
    const q = query(
      collection(db, 'appointments'),
      where('shopId', '==', shopId),
      where('startTime', '>=', Timestamp.fromDate(monday)),
      where('startTime', '<', Timestamp.fromDate(atMinute(monday, 7 * 24 * 60))),
    );
    return onSnapshot(
      q,
      (snapshot) => setList(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Appointment)),
      (error) => console.error('Error in week appointments listener:', error),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, key]);
  return list;
};

interface Props {
  /** tag: eine Spalte je Person; woche: eine Person, eine Spalte je Tag */
  mode: 'tag' | 'woche';
  shop: Shop;
  /** aktive Personen des Ladens */
  staff: Staff[];
  services: Service[];
  /** Termine des gewählten Tages, live vom Tresen */
  dayAppointments: Appointment[];
  selectedDate: Date;
  now: Date;
}

/** Kalender am Tresen: Raster mit Status ändern, Termin anlegen und Verschieben */
export const CounterCalendar = ({ mode, shop, staff, services, dayAppointments, selectedDate, now }: Props) => {
  const breaks = useStaffBreaks(staff.map((s) => s.id));
  const invalidateCache = useTimeSlotStore((state) => state.invalidateCache);
  const [personId, setPersonId] = useState(remembered);
  const person = staff.find((s) => s.id === personId) ?? staff[0];
  const weekKey = format(weekDays(selectedDate)[0], 'yyyy-MM-dd');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const days = useMemo(() => weekDays(selectedDate), [weekKey]);
  const weekAppointments = useWeekAppointments(mode === 'woche' ? shop.id : null, days[0]);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [creating, setCreating] = useState<{ staff: Staff; start: Date } | null>(null);

  const columns = useMemo<CalendarColumn[]>(() => {
    if (mode === 'tag') return staff.map((s) => ({ key: s.id, staff: s, day: selectedDate, title: s.name }));
    if (!person) return [];
    return days.map((d) => ({ key: format(d, 'yyyy-MM-dd'), staff: person, day: d, title: format(d, 'EEEE', { locale: datumsLocale() }), subtitle: format(d, t('dd.MM.')) }));
  }, [mode, staff, selectedDate, person, days]);

  const shown = useMemo(
    () => (mode === 'tag' ? dayAppointments : weekAppointments.filter((a) => a.staffId === person?.id)),
    [mode, dayAppointments, weekAppointments, person],
  );

  const changeStatus = async (status: Appointment['status']) => {
    if (!selected) return;
    try {
      // Sagt der Laden ab, bekommt der Kunde Bescheid (Push/E-Mail, siehe updateAppointment)
      await updateAppointment(selected.id, { status }, { notifyCustomer: true });
      invalidateCache(shop.id, selected.startTime.toDate());
      toast.success(t('Status geändert.'));
      setSelected(null);
    } catch (error) {
      console.error('Error updating appointment status:', error);
      toast.error(t('Fehler beim Aktualisieren des Status'));
    }
  };

  // Verschoben: der Kunde bekommt die neue Zeit per Push/E-Mail; Platz und Regeln prüft updateAppointment
  const move = async (a: Appointment, column: CalendarColumn, start: Date, end: Date) => {
    if (!offers(column.staff, a.serviceId)) {
      toast.error(t('{name} bietet diese Leistung nicht an.', { name: column.staff.name }));
      return;
    }
    try {
      await updateAppointment(a.id, { staffId: column.staff.id, startTime: Timestamp.fromDate(start), endTime: Timestamp.fromDate(end) }, { notifyCustomer: true });
      invalidateCache(shop.id, a.startTime.toDate());
      invalidateCache(shop.id, start);
      toast.success(t('Verschoben: {wann} bei {name}.', { wann: `${format(start, t('dd.MM.'))} ${hm(start)}`, name: column.staff.name }));
    } catch (error) {
      console.error('Error moving appointment:', error);
      toast.error(t('Nicht verschoben: {fehler}', { fehler: error instanceof Error ? error.message : t('unbekannter Fehler') }));
    }
  };

  if (!person) return null;

  return (
    <div className="flex flex-col gap-3">
      {mode === 'woche' &&
        (staff.length > 1 ? (
          <Select
            value={person.id}
            onValueChange={(id) => {
              setPersonId(id);
              try {
                localStorage.setItem(REMEMBER, id);
              } catch {
                // nur Komfort
              }
            }}
          >
            <SelectTrigger className="w-auto min-w-48 self-start" aria-label={t('Person wählen')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {staff.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="font-semibold">{person.name}</p>
        ))}

      <CalendarGrid
        columns={columns}
        appointments={shown}
        services={services}
        shop={shop}
        breaks={breaks}
        now={now}
        onSelect={setSelected}
        onCreate={(column, start) => setCreating({ staff: column.staff, start })}
        onMove={move}
      />
      <p className="text-sm text-muted-foreground">
        {mode === 'tag'
          ? t('Termin anklicken ändert den Status, in freie Zeit klicken legt einen an. Wartende ziehst du auf eine andere Zeit oder Person.')
          : t('Termin anklicken ändert den Status, in freie Zeit klicken legt einen an. Wartende ziehst du auf eine andere Zeit oder einen anderen Tag.')}
      </p>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Status ändern')}</DialogTitle>
            {selected && (
              <DialogDescription>
                {hm(selected.startTime.toDate())} · {customerLabel(selected)}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(STATUS_LABEL) as Appointment['status'][]).map((status) => (
              <Button key={status} variant={selected?.status === status ? 'default' : 'outline'} onClick={() => changeStatus(status)}>
                {t(STATUS_LABEL[status])}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {creating && (
        <CreateAppointmentDialog
          isOpen
          onClose={() => setCreating(null)}
          startTime={creating.start}
          employee={creating.staff}
          services={offeredServices(services).filter((s) => offers(creating.staff, s.id))}
          onAppointmentCreated={() => setCreating(null)}
        />
      )}
    </div>
  );
};
