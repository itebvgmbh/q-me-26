import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Search } from 'lucide-react';

interface Props {
  interval: number;
  actionLoading: boolean;
  setInterval: (value: number) => void;
  updateInterval: () => Promise<void>;
  runNow: () => Promise<void>;
  checkEarlierSlots: () => Promise<void>;
}

/**
 * Component for controlling scheduler settings like interval
 * and manual execution
 */
export const SchedulerControlCard = ({
  interval,
  actionLoading,
  setInterval,
  updateInterval,
  runNow,
  checkEarlierSlots
}: Props) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Intervall-Einstellungen</CardTitle>
        <CardDescription>Wie oft soll der Scheduler laufen?</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="interval">Intervall (Sekunden)</Label>
          <div className="flex gap-2">
            <Input
              id="interval"
              type="number"
              min="60"
              value={interval}
              onChange={(e) => setInterval(parseInt(e.target.value) || 60)}
            />
            <Button
              variant="secondary"
              onClick={updateInterval}
              disabled={actionLoading}
            >
              Speichern
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Empfohlene Werte: 1800 (30 Min.), 3600 (1 Std.), 7200 (2 Std.)
          </p>
        </div>

        <div className="pt-4 border-t border-slate-100 space-y-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={runNow}
            disabled={actionLoading}
          >
            <AlertCircle className="mr-2 h-4 w-4" />
            Jetzt einmalig prüfen
          </Button>
          
          <Button
            variant="outline"
            className="w-full"
            onClick={checkEarlierSlots}
            disabled={actionLoading}
          >
            <Search className="mr-2 h-4 w-4" />
            Frühere Slots prüfen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
