import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { format } from 'date-fns';
import { TimeSlot } from '../utils/types';
import { Spinner } from './Spinner';
import { Shop, Service, Staff } from '../utils/firestore/types';
import { AlertTriangle } from 'lucide-react';
import { User } from 'firebase/auth';

export interface QueueConfirmationStepProps {
  selectedShop: string;
  selectedService: string;
  useAnyStaff: boolean;
  selectedStaff: string;
  nextAvailableSlot: TimeSlot | null;
  selectedStaffForSlot: string;
  searchingForSlot: boolean;
  checkEarlierOptions: boolean;
  onCheckEarlierOptionsChange: (checked: boolean) => void;
  shops: Shop[];
  services: Service[];
  staff: Staff[];
  onBack: () => void;
  onConfirm: () => void;
  user: User | null;
  authLoading: boolean;
}

/**
 * Component for confirming booking details in the queue process
 * Shows all selected options and the next available time slot
 */
export const QueueConfirmationStep: React.FC<QueueConfirmationStepProps> = ({
  selectedShop,
  selectedService,
  useAnyStaff,
  selectedStaff,
  nextAvailableSlot,
  selectedStaffForSlot,
  searchingForSlot,
  checkEarlierOptions,
  onCheckEarlierOptionsChange,
  shops,
  services,
  staff,
  onBack,
  onConfirm,
  user,
  authLoading,
}) => {
  const selectedShopData = shops.find(s => s.id === selectedShop);
  const selectedServiceData = services.find(s => s.id === selectedService);
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Terminbestätigung</CardTitle>
        <CardDescription>
          Überprüfen Sie Ihre Auswahl und bestätigen Sie den Termin
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-500">Ausgewählter Shop</h3>
          <p className="font-medium">{selectedShopData?.name}</p>
        </div>
        
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-500">Ausgewählter Service</h3>
          <p className="font-medium">{selectedServiceData?.name}</p>
          <p className="text-sm">{selectedServiceData?.price.toFixed(2)} €</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-500">Mitarbeiter</h3>
          {useAnyStaff ? (
            <p className="font-medium">Nächster freier Mitarbeiter</p>
          ) : (
            <p className="font-medium">{staff.find(s => s.id === selectedStaff)?.name}</p>
          )}
        </div>

        <div className="mt-6 p-4 bg-gray-50 rounded-md space-y-2">
          <h3 className="text-lg font-medium">Nächster verfügbarer Termin</h3>
          
          <div className="flex items-center space-x-2 mb-3">                  
            <Checkbox 
              id="check-earlier-options" 
              checked={checkEarlierOptions} 
              onCheckedChange={checked => onCheckEarlierOptionsChange(checked === true)}
            />
            <label 
              htmlFor="check-earlier-options"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Bei früherer Option fragen
            </label>
          </div>
          
          {searchingForSlot ? (
            <div className="flex items-center space-x-2 p-4">
              <Spinner />
              <p>Suche nach dem nächsten verfügbaren Zeitslot...</p>
            </div>
          ) : nextAvailableSlot ? (
            <div className="p-4 bg-green-50 rounded-md">
              <p className="font-medium">Der nächste verfügbare Termin ist:</p>
              <p>
                Datum: {format(nextAvailableSlot.start, 'dd.MM.yyyy')}<br/>
                Uhrzeit: {format(nextAvailableSlot.start, 'HH:mm')} - {format(nextAvailableSlot.end, 'HH:mm')} Uhr
              </p>
              {useAnyStaff && selectedStaffForSlot && (
                <p className="mt-2">
                  Mitarbeiter: {staff.find(s => s.id === selectedStaffForSlot)?.name || selectedStaffForSlot}
                </p>
              )}
            </div>
          ) : (
            <p className="text-orange-600">Leider konnte kein freier Zeitslot gefunden werden.</p>
          )}
        </div>

        {!user && !authLoading && (
          <div className="p-4 bg-yellow-50 rounded-md border border-yellow-200">
            <div className="flex items-start">
              <AlertTriangle className="h-6 w-6 text-yellow-500 mr-2 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-yellow-800">Anonyme Buchung</p>
                <p className="text-sm text-yellow-700 mt-1">
                  Sie sind nicht angemeldet. Ihre Buchung wird anonym verarbeitet und Sie erhalten 
                  einen Referenzcode zur Verfolgung. <strong>Es ist keine Anmeldung erforderlich.</strong>
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button 
          variant="outline" 
          onClick={onBack}
        >
          Zurück
        </Button>
        <Button
          onClick={onConfirm}
          disabled={!nextAvailableSlot || searchingForSlot}
        >
          In Warteschlange einreihen
        </Button>
      </CardFooter>
    </Card>
  );
};
