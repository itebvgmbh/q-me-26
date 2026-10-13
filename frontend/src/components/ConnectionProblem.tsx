import { Button } from '@/components/ui/button';
import { describeConnectionError } from '../utils/connection';

/** Meldung, wenn die Datenbank nicht erreichbar ist – statt "Shop nicht gefunden" */
export const ConnectionProblem = ({ error }: { error: unknown }) => (
  <div role="alert" className="flex flex-col items-start gap-3 rounded-3xl border border-border bg-card p-5 sm:p-7">
    <h2 className="font-display text-2xl font-bold">Keine Verbindung zur Datenbank.</h2>
    <p className="text-muted-foreground">
      Das liegt meist am WLAN. Schalt es kurz aus und versuch’s mit mobilen Daten.
    </p>
    <Button onClick={() => window.location.reload()}>Noch mal versuchen</Button>
    <p className="break-all font-mono text-xs text-muted-foreground">Technisch: {describeConnectionError(error)}</p>
  </div>
);
