import React from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from './Spinner';
import { TimeSlot } from '../utils/types';
import { Shop, Staff, Service } from '../utils/firestore';

interface ConfirmationStepProps {
  shop: Shop | undefined;
  service: Service | undefined;
  staff: Staff[] | undefined;
  selectedStaff: string;
  useAnyStaff: boolean;
  selectedStaffForSlot: string;
  nextAvailableSlot: TimeSlot | null;
  searchingForSlot: boolean;
  checkEarlierOptions: boolean;
  setCheckEarlierOptions: (value: boolean) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
}

/**
 * Component for the confirmation step
 */
export const ConfirmationStep: React.FC<ConfirmationStepProps> = ({
  shop,
  service,
  staff,
  selectedStaff,
  useAnyStaff,
  selectedStaffForSlot,
  nextAvailableSlot,
  searchingForSlot,
  checkEarlierOptions,
  setCheckEarlierOptions,
  onBack,
  onSubmit,
  submitting
}) => {
  const selectedStaffMember = staff?.find(s => s.id === (useAnyStaff ? selectedStaffForSlot : selectedStaff));

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
          <p className="font-medium">{shop?.name}</p>
        </div>
        
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-500">Ausgewählter Service</h3>
          <p className="font-medium">{service?.name}</p>
          <p className="text-sm">{service?.price.toFixed(2)} €</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-500">Mitarbeiter</h3>
          {useAnyStaff ? (
            <p className="font-medium">Nächster freier Mitarbeiter</p>
          ) : (
            <p className="font-medium">{selectedStaffMember?.name}</p>
          )}
        </div>

        <div className="mt-6 p-4 bg-gray-50 rounded-md space-y-2">
          <h3 className="text-lg font-medium">Nächster verfügbarer Termin</h3>
          
          <div className="flex items-center space-x-2 mb-3">                  
            <Checkbox 
              id="check-earlier-options" 
              checked={checkEarlierOptions} 
              onCheckedChange={checked => setCheckEarlierOptions(checked === true)}
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
                  Mitarbeiter: {staff?.find(s => s.id === selectedStaffForSlot)?.name || selectedStaffForSlot}
                </p>
              )}
            </div>
          ) : (
            <p className="text-orange-600">Leider konnte kein freier Zeitslot gefunden werden.</p>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button 
          variant="outline" 
          onClick={onBack}
        >
          Zurück
        </Button>
        <Button
          onClick={onSubmit}
          disabled={!nextAvailableSlot || searchingForSlot || submitting}
        >
          {submitting ? (
            <>
              <Spinner size="sm" color="white" />
              <span className="ml-2">Wird verarbeitet...</span>
            </>
          ) : (
            "In Warteschlange einreihen"
          )}
        </Button>
      </CardFooter>
    </Card>
  );
};
