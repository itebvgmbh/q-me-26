import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, RotateCw } from 'lucide-react';
import type { SchedulerStatus } from '../utils/hooks/useSchedulerControl';

interface Props {
  status: SchedulerStatus | null;
  loading: boolean;
  actionLoading: boolean;
  formatDateTime: (dateStr: string | null) => string;
  startScheduler: () => Promise<void>;
  stopScheduler: () => Promise<void>;
  loadStatus: () => Promise<void>;
}

/**
 * Component that displays the current status of the scheduler
 * and provides controls to start or stop it
 */
export const SchedulerStatusCard = ({
  status,
  loading,
  actionLoading,
  formatDateTime,
  startScheduler,
  stopScheduler,
  loadStatus
}: Props) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scheduler-Status</CardTitle>
        <CardDescription>Aktueller Status des Frühere-Termine-Checkers</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between items-center">
          <span className="font-medium">Status:</span>
          {status?.is_running ? (
            <Badge className="bg-green-600">Aktiv</Badge>
          ) : (
            <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200">Inaktiv</Badge>
          )}
        </div>
        <div className="flex justify-between items-center">
          <span className="font-medium">Letzter Lauf:</span>
          <span>{formatDateTime(status?.last_run)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="font-medium">Intervall:</span>
          <span>{status?.interval_seconds} Sekunden</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="font-medium">Nächster Lauf:</span>
          <span>{formatDateTime(status?.next_run)}</span>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end gap-4">
        <Button
          variant="default"
          onClick={loadStatus}
          disabled={actionLoading}
        >
          <RotateCw className="mr-2 h-4 w-4" />
          Aktualisieren
        </Button>
        {status?.is_running ? (
          <Button
            variant="destructive"
            onClick={stopScheduler}
            disabled={actionLoading}
          >
            <Pause className="mr-2 h-4 w-4" />
            Stoppen
          </Button>
        ) : (
          <Button
            variant="default"
            className="bg-green-600 hover:bg-green-700"
            onClick={startScheduler}
            disabled={actionLoading}
          >
            <Play className="mr-2 h-4 w-4" />
            Starten
          </Button>
        )}
      </CardFooter>
    </Card>
  );
};
