import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RotateCw } from 'lucide-react';
import type { NotificationHistoryItem } from '../utils/hooks/useSchedulerControl';

interface Props {
  historyItems: NotificationHistoryItem[];
  historyLoading: boolean;
  loadHistory: () => Promise<void>;
}

/**
 * Component for displaying the notification history table
 */
export const NotificationHistoryTable = ({ historyItems, historyLoading, loadHistory }: Props) => {
  /**
   * Format a date object with the proper timezone
   */
  const formatLocalDate = (date: Date) => {
    return date.toLocaleDateString(undefined, { timeZone: 'Europe/Berlin' });
  };

  /**
   * Format a date object with the proper timezone for time display
   */
  const formatLocalTime = (date: Date) => {
    return date.toLocaleTimeString([], {
      hour: '2-digit', 
      minute: '2-digit', 
      timeZone: 'Europe/Berlin'
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Benachrichtigungsverlauf</CardTitle>
        <CardDescription>Historie der gefundenen früheren Termine und Kundenaktionen</CardDescription>
      </CardHeader>
      <CardContent>
        {historyLoading && <p>Lädt Verlauf...</p>}
        
        {!historyLoading && historyItems.length === 0 && (
          <div className="py-8 text-center text-slate-500">
            <p>Noch keine Benachrichtigungen vorhanden</p>
          </div>
        )}
        
        {!historyLoading && historyItems.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="p-2 text-left font-medium">Datum</th>
                  <th className="p-2 text-left font-medium">Kunde</th>
                  <th className="p-2 text-left font-medium">Salon</th>
                  <th className="p-2 text-left font-medium">Mitarbeiter</th>
                  <th className="p-2 text-left font-medium">Original Termin</th>
                  <th className="p-2 text-left font-medium">Früherer Termin</th>
                  <th className="p-2 text-left font-medium">Dauer</th>
                  <th className="p-2 text-left font-medium">Zeitersparnis</th>
                  <th className="p-2 text-left font-medium">Status</th>
                  <th className="p-2 text-left font-medium">Buchungs-ID</th>
                </tr>
              </thead>
              <tbody>
                {historyItems.map((item) => {
                  const createdDate = new Date(item.createdAt);
                  // Create date objects and ensure correct timezone handling
                  const originalDate = new Date(item.originalStartTime);
                  const earlierDate = new Date(item.earlierStartTime);
                  
                  return (
                    <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="p-2">{formatLocalDate(createdDate)}</td>
                      <td className="p-2">{item.userName || "Unbekannter Kunde"}</td>
                      <td className="p-2">{item.shopName || "Unbekannt"}</td>
                      <td className="p-2">{item.staffName || "Unbekannt"}</td>
                      <td className="p-2">{formatLocalDate(originalDate)} {formatLocalTime(originalDate)}</td>
                      <td className="p-2">{formatLocalDate(earlierDate)} {formatLocalTime(earlierDate)}</td>
                      <td className="p-2">{item.appointmentDuration ? `${item.appointmentDuration} min` : '30 min'}</td>
                      <td className="p-2">
                        {item.timeDifference ? (
                          <span className="font-medium text-green-600">
                            {item.timeDifference} min
                          </span>
                        ) : "-"}
                      </td>
                      <td className="p-2">
                        {item.isAccepted ? (
                          <Badge className="bg-green-600">Angenommen</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200">Ausstehend</Badge>
                        )}
                      </td>
                      <td className="p-2 text-xs text-slate-500">{item.appointmentId}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <Button variant="outline" onClick={loadHistory} disabled={historyLoading}>
          <RotateCw className="mr-2 h-4 w-4" />
          Aktualisieren
        </Button>
      </CardFooter>
    </Card>
  );
};
