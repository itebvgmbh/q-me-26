import { useState } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Clock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import brain from 'brain';
import { safelyConvertToDate } from '../utils/datetime';

export interface EarlierSlotNotification {
  id: string;
  appointmentId: string;
  userId: string;
  shopId: string;
  staffId: string;
  serviceId: string;
  originalStartTime: any; // Can be Date or Firestore Timestamp
  originalEndTime: any; // Can be Date or Firestore Timestamp
  earlierStartTime: any; // Can be Date or Firestore Timestamp
  earlierEndTime: any; // Can be Date or Firestore Timestamp
  createdAt: any; // Can be Date or Firestore Timestamp
  isRead: boolean;
  isAccepted: boolean;
}

interface Props {
  notifications: EarlierSlotNotification[];
  onAccept: (notificationId: string) => Promise<void>;
  onRefresh: () => void;
}

export const EarlierSlotNotifications = ({ notifications, onAccept, onRefresh }: Props) => {
  const [accepting, setAccepting] = useState<{ [key: string]: boolean }>({});

  if (notifications.length === 0) {
    return null;
  }

  // Format duration difference elegantly
  const formatDurationDiff = (minutes: number) => {
    if (minutes < 60) return `${minutes} Minuten`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      const remainingMinutes = minutes % 60;
      return remainingMinutes > 0 ? `${hours} Stunden und ${remainingMinutes} Minuten` : `${hours} Stunden`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days} Tage und ${remainingHours} Stunden` : `${days} Tage`;
  };

  // Format date for display - safely handles different date formats
  const formatDateTime = (dateInput: any) => {
    try {
      const date = safelyConvertToDate(dateInput);
      return format(date, "EEEE, d. MMMM yyyy 'um' HH:mm 'Uhr'", { locale: de, timeZone: 'Europe/Berlin' } as any);
    } catch (error) {
      console.error('Error formatting date:', error, dateInput);
      return 'Ungültiges Datum';
    }
  };
  
  // Format time only - safely handles different date formats
  const formatTime = (dateInput: any) => {
    try {
      const date = safelyConvertToDate(dateInput);
      return format(date, 'HH:mm', { locale: de, timeZone: 'Europe/Berlin' });
    } catch (error) {
      console.error('Error formatting time:', error, dateInput);
      return '--:--';
    }
  };

  const handleAccept = async (notificationId: string) => {
    try {
      setAccepting({ ...accepting, [notificationId]: true });
      await onAccept(notificationId);
      toast.success("Früherer Termin erfolgreich angenommen");
      onRefresh();
    } catch (error) {
      console.error('Error accepting earlier slot:', error);
      toast.error("Fehler beim Annehmen des früheren Termins");
    } finally {
      setAccepting({ ...accepting, [notificationId]: false });
    }
  };

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardHeader className="pb-2 bg-amber-100">
        <CardTitle className="text-amber-900 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 animate-pulse text-amber-600" /> Frühere Terminoptionen verfügbar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {notifications.map((notification) => {
          // Safely convert dates to calculate time difference
          const originalDate = safelyConvertToDate(notification.originalStartTime);
          const earlierDate = safelyConvertToDate(notification.earlierStartTime);
          const timeDiff = originalDate.getTime() - earlierDate.getTime();
          const minutesDiff = Math.floor(timeDiff / (1000 * 60));
          
          return (
            <Alert key={notification.id} className="border-amber-200 bg-white">
              <Clock className="h-4 w-4 text-amber-600" />
              <AlertTitle className="font-medium text-amber-800">
                Früherer Termin verfügbar!
              </AlertTitle>
              <AlertDescription className="mt-2 text-sm space-y-3">
                <div className="space-y-1">
                  <p>
                    Du kannst deinen Termin um <strong>{formatDurationDiff(minutesDiff)} früher</strong> wahrnehmen.
                  </p>
                  <div className="text-xs text-slate-600 space-y-1 mt-2">
                    <div className="flex gap-2">
                      <span className="font-medium w-24">Termin-ID:</span>
                      <span>{notification.appointmentId}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="font-medium w-24">Neuer Termin:</span>
                      <span>{formatDateTime(notification.earlierStartTime)}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="font-medium w-24">Bisheriger:</span>
                      <span className="line-through opacity-70">{formatDateTime(notification.originalStartTime)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button 
                    size="sm" 
                    className="bg-amber-600 hover:bg-amber-700 shadow-sm ring-2 ring-amber-300 animate-pulse"
                    onClick={() => handleAccept(notification.id)}
                    disabled={accepting[notification.id]}
                  >
                    {accepting[notification.id] ? (
                      <>Wird übernommen...</>
                    ) : (
                      <>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Früheren Termin annehmen
                      </>
                    )}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          );
        })}
      </CardContent>
    </Card>
  );
};
