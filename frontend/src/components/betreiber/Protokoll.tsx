import type { LogEntry } from '../../utils/betreiber';
import { fmtDateTime } from './format';

const targetLabel = (e: LogEntry) => e.target.name || e.target.email || e.target.shopId || e.target.uid || '';

/** Eingriffe des Betreibers, neueste zuerst (liegt auf dem Server, nicht in Firestore) */
export function Protokoll({ entries, compact = false }: { entries: LogEntry[]; compact?: boolean }) {
  if (!entries.length) return <p className="text-sm text-muted-foreground">Noch keine Eingriffe.</p>;
  return (
    <ol className="flex flex-col divide-y divide-border text-sm">
      {entries.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex flex-col gap-0.5 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-semibold">
              {e.action}
              {!compact && targetLabel(e) && <span className="font-normal text-muted-foreground"> · {targetLabel(e)}</span>}
            </span>
            <span className="tabular-nums text-xs text-muted-foreground">{fmtDateTime(e.at)}</span>
          </div>
          {e.reason && <p className="text-foreground/80">„{e.reason}“</p>}
          <p className="text-xs text-muted-foreground">von {e.by}</p>
        </li>
      ))}
    </ol>
  );
}
