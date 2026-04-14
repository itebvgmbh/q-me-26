import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { safelyConvertToDate } from '../utils/datetime';
import type { Appointment, Service, Shop, Staff } from '../utils/firestore';
import type { EarlierSlotNotificationType } from '../utils/types';

interface AppointmentCardProps {
  appointment: Appointment & { 
    service?: Service; 
    shop?: Shop; 
    staff?: Staff; 
    queuePosition?: number 
  };
  onCancelClick: (appointmentId: string) => void;
  onAcceptEarlierSlot?: (notificationId: string) => Promise<boolean>;
  notification?: EarlierSlotNotificationType;
}

/**
 * AppointmentCard component displays details of a single appointment
 * including service, shop, staff, and timing information.
 */
export const AppointmentCard: React.FC<AppointmentCardProps> = ({ 
  appointment, 
  onCancelClick,
  onAcceptEarlierSlot,
  notification
}) => {
  // Handle both Firestore Timestamp objects and raw date values
  const startTime = safelyConvertToDate(appointment.startTime);
  const endTime = safelyConvertToDate(appointment.endTime);
  
  /**
   * Format date with from-to time
   */
  const formatDateTime = (start: Date, end: Date) => {
    const dateStr = start.toLocaleDateString(undefined, { timeZone: 'Europe/Berlin' });
    const startTime = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
    const endTime = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
    return `${dateStr}, ${startTime} - ${endTime}`;
  };
  
  /**
   * Render status badge based on appointment status
   */
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'scheduled':
        return <Badge className="whitespace-nowrap">Geplant</Badge>;
      case 'in-progress':
        return <Badge variant="secondary" className="whitespace-nowrap">In Bearbeitung</Badge>;
      case 'completed':
        return <Badge variant="default" className="whitespace-nowrap">Abgeschlossen</Badge>;
      case 'cancelled':
        return <Badge variant="destructive" className="whitespace-nowrap">Storniert</Badge>;
      default:
        return null;
    }
  };
  
  /**
   * Format time from notification date
   */
  const formatNotificationTime = (dateValue: any): string => {
    try {
      const date = safelyConvertToDate(dateValue);
      return date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    } catch (e) {
      return '---';
    }
  };
  
  return (
    <Card key={appointment.id} className="overflow-hidden hover:shadow-md transition-shadow relative">
      {notification && (
        <div className="absolute top-0 right-0 m-2 z-10">
          <Button 
            size="sm" 
            className="bg-amber-600 hover:bg-amber-700 text-white animate-pulse flex items-center gap-1 px-2 py-1 h-auto min-h-0 text-xs shadow-md ring-2 ring-amber-300"
            onClick={() => onAcceptEarlierSlot && onAcceptEarlierSlot(notification.id)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clipRule="evenodd" />
            </svg>
            Früher: {formatNotificationTime(notification.earlierStartTime)}
          </Button>
        </div>
      )}
      <CardContent className="p-0">
        <div className="flex w-full">
          {/* Shop Logo */}
          <div className="w-24 h-24 shrink-0 bg-slate-100 flex items-center justify-center">
            {appointment.shop?.logoUrl ? (
              <img 
                src={appointment.shop.logoUrl} 
                alt={`${appointment.shop.name} Logo`}
                className="w-full h-full object-contain p-2" 
              />
            ) : (
              <div className="text-2xl font-bold text-slate-400">
                {appointment.shop?.name?.substring(0, 2) || 'S'}
              </div>
            )}
          </div>
          
          {/* Appointment Details */}
          <div className="flex-1 p-4">
            {notification && (
              <div className="mb-2 p-2 border-2 border-amber-400 bg-amber-50 rounded-md shadow-sm">
                <div className="flex items-center gap-2 text-amber-800">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-amber-600 animate-pulse">
                    <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clipRule="evenodd" />
                  </svg>
                  <span className="font-medium text-sm">Früherer Termin verfügbar!</span>
                </div>
                <div className="mt-1 text-sm flex items-center justify-between">
                  <span>Neuer Termin: <strong>
                    {formatNotificationTime(notification.earlierStartTime)}
                  </strong></span>
                  <button 
                    className="ml-3 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded px-3 py-1.5 shadow-sm animate-pulse ring-1 ring-amber-300"
                    onClick={() => onAcceptEarlierSlot && onAcceptEarlierSlot(notification.id)}
                  >
                    Annehmen
                  </button>
                </div>
              </div>
            )}
            <div className="flex flex-col md:flex-row md:justify-between md:items-start mb-2 gap-2">
              <div className="font-medium text-base">{appointment.service?.name || 'Unbekannter Service'}</div>
              <div>{getStatusBadge(appointment.status)}</div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="flex items-center gap-1">
                <span className="font-medium">Shop:</span>
                <span>{appointment.shop?.name || 'Unbekannter Shop'}</span>
              </div>
              
              <div className="flex items-center gap-1">
                <span className="font-medium">Termin:</span>
                <span>{formatDateTime(startTime, endTime)}</span>
              </div>
              
              {appointment.staff && (
                <div className="flex items-center gap-1">
                  <span className="font-medium">Mitarbeiter:</span>
                  <span>{appointment.staff.name}</span>
                </div>
              )}
              
              {appointment.service && (
                <div className="flex items-center gap-1">
                  <span className="font-medium">Preis:</span>
                  <span>{appointment.service.price.toFixed(2)} €</span>
                </div>
              )}
              
              {appointment.queuePosition > 0 && appointment.status !== 'completed' && appointment.status !== 'cancelled' && (
                <div className="flex items-center gap-1">
                  <span className="font-medium">Warteschlange:</span>
                  {appointment.queuePosition === 1 ? (
                    <Badge variant="outline" className="bg-green-50 text-green-700 font-medium">
                      Du bist dran
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-blue-50">
                      Position {appointment.queuePosition}
                    </Badge>
                  )}
                </div>
              )}
            </div>
            
            {appointment.status !== 'cancelled' && (
              <div className="mt-3 flex justify-end">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onCancelClick(appointment.id)}
                >
                  Stornieren
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
