import React, { useMemo } from 'react';
import { Staff } from '../utils/firestore/types';
import { QueueOption, QueueStepShell } from './queue/QueueStepShell';

export interface QueueStaffStepProps {
  staff: Staff[];
  selectedService: string;
  selectedStaff: string;
  onSelectStaff: (staffId: string) => void;
  onSelectAny: () => void;
  useAnyStaff: boolean;
  onBack: () => void;
}

export const QueueStaffStep: React.FC<QueueStaffStepProps> = ({ staff, selectedService, selectedStaff, onSelectStaff, onSelectAny, useAnyStaff, onBack }) => {
  // Nur wer die gewählte Leistung anbietet; ist niemand zugeordnet, alle zeigen
  const eligible = useMemo(() => {
    const offering = staff.filter((s) => s.serviceIds?.includes(selectedService));
    return offering.length > 0 ? offering : staff;
  }, [staff, selectedService]);

  return (
    <QueueStepShell title="Bei wem?" description="Am schnellsten geht’s mit der nächsten freien Person." onBack={onBack} backLabel="Andere Leistung wählen">
      <div className="flex flex-col gap-2">
        <QueueOption
          selected={useAnyStaff}
          onClick={onSelectAny}
          title="Egal wer – Hauptsache schnell"
          meta="Nächste freie Person"
          badge={<span className="shrink-0 rounded-full bg-signal px-2.5 py-1 text-xs font-semibold text-signal-foreground">Am schnellsten</span>}
        />
        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Für diese Leistung ist niemand fest eingetragen.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {eligible.map((s) => (
              <QueueOption key={s.id} selected={!useAnyStaff && s.id === selectedStaff} onClick={() => onSelectStaff(s.id)} title={s.name} />
            ))}
          </div>
        )}
      </div>
    </QueueStepShell>
  );
};
