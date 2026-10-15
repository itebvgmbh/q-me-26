import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { BusinessHoursDay } from '../utils/firestore/types';
import { DAY_NAMES, HOUR_PRESETS, normalizeHours, WEEK_ORDER } from '../utils/opening-hours';

interface Props {
  value: BusinessHoursDay[];
  onChange: (hours: BusinessHoursDay[]) => void;
  /** Vorlagen (Mo–Fr 9–18 …) oben anzeigen */
  presets?: boolean;
}

const TimeField = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-muted-foreground">
    {label}
    <Input type="time" step={300} value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className="h-11 font-mono text-base text-foreground" />
  </label>
);

/** Öffnungszeiten je Tag, mit Pausen (z. B. mittags zu) – Montag zuerst */
export const OpeningHoursEditor = ({ value, onChange, presets = false }: Props) => {
  const hours = normalizeHours(value);
  const set = (dayOfWeek: number, patch: Partial<BusinessHoursDay>) =>
    onChange(hours.map((h) => (h.dayOfWeek === dayOfWeek ? { ...h, ...patch } : h)));

  const firstOpen = WEEK_ORDER.map((d) => hours[d]).find((h) => h.isOpen);
  const copyToAll = () => {
    if (!firstOpen) return;
    onChange(hours.map((h) => (h.isOpen ? { ...h, openTime: firstOpen.openTime, closeTime: firstOpen.closeTime, breaks: [...(firstOpen.breaks ?? [])] } : h)));
  };

  return (
    <div className="flex flex-col gap-3">
      {presets && (
        <div className="flex flex-wrap gap-2" aria-label="Vorlagen">
          {HOUR_PRESETS.map((p) => (
            <Button key={p.label} type="button" variant="secondary" size="sm" onClick={() => onChange(p.hours())}>
              {p.label}
            </Button>
          ))}
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {WEEK_ORDER.map((d) => {
          const h = hours[d];
          const breaks = h.breaks ?? [];
          return (
            <li key={d} className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-3 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{DAY_NAMES[d]}</span>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  {h.isOpen ? 'geöffnet' : 'geschlossen'}
                  <Switch checked={h.isOpen} onCheckedChange={(isOpen) => set(d, { isOpen })} aria-label={`${DAY_NAMES[d]} geöffnet`} />
                </label>
              </div>
              {h.isOpen && (
                <>
                  <div className="flex gap-3">
                    <TimeField label="von" value={h.openTime} onChange={(openTime) => set(d, { openTime })} />
                    <TimeField label="bis" value={h.closeTime} onChange={(closeTime) => set(d, { closeTime })} />
                  </div>
                  {breaks.map((b, i) => (
                    <div key={i} className="flex items-end gap-3 rounded-xl bg-muted/60 p-2">
                      <TimeField label="Pause von" value={b.startTime} onChange={(startTime) => set(d, { breaks: breaks.map((x, j) => (j === i ? { ...x, startTime } : x)) })} />
                      <TimeField label="bis" value={b.endTime} onChange={(endTime) => set(d, { breaks: breaks.map((x, j) => (j === i ? { ...x, endTime } : x)) })} />
                      <Button type="button" variant="ghost" size="icon" onClick={() => set(d, { breaks: breaks.filter((_, j) => j !== i) })} aria-label={`Pause am ${DAY_NAMES[d]} entfernen`}>
                        <X className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  {breaks.length === 0 && (
                    <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => set(d, { breaks: [{ startTime: '12:30', endTime: '13:30' }] })}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Mittagspause
                    </Button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {firstOpen && hours.filter((h) => h.isOpen).length > 1 && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={copyToAll}>
          Zeiten vom {DAY_NAMES[firstOpen.dayOfWeek]} für alle offenen Tage
        </Button>
      )}
    </div>
  );
};
