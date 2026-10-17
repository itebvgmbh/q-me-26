import React, { useMemo } from 'react';
import { isToday } from 'date-fns';
import { Staff } from '../utils/firestore/types';
import { TimeSlot } from '../utils/types';
import { QueueOption, QueueStepShell } from './queue/QueueStepShell';
import { Searching, slotLabel } from './queue/SlotStatus';

export interface QueueStaffStepProps {
  staff: Staff[];
  selectedService: string;
  selectedStaff: string;
  onSelectStaff: (staffId: string) => void;
  onSelectAny: () => void;
  useAnyStaff: boolean;
  onBack: () => void;
  /** frühester Platz je Person (null = nichts frei), noch nicht geladen = null */
  earliestByStaff: Record<string, TimeSlot | null> | null;
  searching: boolean;
}

export const QueueStaffStep: React.FC<QueueStaffStepProps> = ({
  staff,
  selectedService,
  selectedStaff,
  onSelectStaff,
  onSelectAny,
  useAnyStaff,
  onBack,
  earliestByStaff,
  searching,
}) => {
  // Nur wer die gewählte Leistung anbietet; ist niemand zugeordnet, alle zeigen
  const eligible = useMemo(() => {
    const offering = staff.filter((s) => s.serviceIds?.includes(selectedService));
    return offering.length > 0 ? offering : staff;
  }, [staff, selectedService]);

  // Frühester Platz über alle Personen für "egal wer"
  const fastest = useMemo(() => {
    if (!earliestByStaff) return null;
    return eligible
      .map((s) => ({ person: s, slot: earliestByStaff[s.id] }))
      .filter((e): e is { person: Staff; slot: TimeSlot } => !!e.slot)
      .sort((a, b) => a.slot.start.getTime() - b.slot.start.getTime())[0] ?? null;
  }, [earliestByStaff, eligible]);

  // Während der Suche ein Kreisel je Zeile; schlug sie fehl, einfach ohne Zeiten weiter
  const loadingMeta = searching ? <Searching>Suche freie Zeiten …</Searching> : null;
  const personMeta = (id: string) => {
    if (loadingMeta) return loadingMeta;
    if (!earliestByStaff) return undefined;
    const slot = earliestByStaff[id];
    return slot ? `Nächster Platz ${slotLabel(slot.start)}` : 'In den nächsten 2 Wochen nichts frei';
  };
  const anyMeta =
    loadingMeta ??
    (!earliestByStaff
      ? 'Nächste freie Person'
      : fastest
        ? `Nächster Platz ${slotLabel(fastest.slot.start)} bei ${fastest.person.name}`
        : 'In den nächsten 2 Wochen nichts frei');

  // Heute nichts mehr frei (Laden zu oder ausgebucht): deutlich sagen statt kommentarlos "Montag 09:00"
  const notToday = !searching && earliestByStaff && (!fastest || !isToday(fastest.slot.start));

  return (
    <QueueStepShell title="Bei wem?" description="Am schnellsten geht’s mit der nächsten freien Person." onBack={onBack} backLabel="Andere Leistung wählen">
      <p className="sr-only" role="status">{searching ? 'Suche freie Zeiten …' : ''}</p>
      {notToday && (
        <p className="rounded-2xl border border-border bg-background px-4 py-3 text-sm" role="note">
          <span className="font-semibold">Heute ist nichts mehr frei.</span>{' '}
          {fastest ? 'Du kannst trotzdem eine Nummer für den nächsten freien Platz ziehen.' : 'Versuch es später noch einmal oder ruf im Laden an.'}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <QueueOption
          selected={useAnyStaff}
          onClick={onSelectAny}
          title="Egal wer – Hauptsache schnell"
          meta={anyMeta}
          badge={<span className="shrink-0 rounded-full bg-signal px-2.5 py-1 text-xs font-semibold text-signal-foreground">Am schnellsten</span>}
        />
        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Für diese Leistung ist niemand fest eingetragen.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {eligible.map((s) => (
              <QueueOption key={s.id} selected={!useAnyStaff && s.id === selectedStaff} onClick={() => onSelectStaff(s.id)} title={s.name} meta={personMeta(s.id)} />
            ))}
          </div>
        )}
      </div>
    </QueueStepShell>
  );
};
