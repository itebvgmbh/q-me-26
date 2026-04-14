import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export interface BookingSuccessStepProps {
  bookingReference: string;
  shopId: string;
}

/**
 * Success step shown after a successful anonymous booking
 * Displays the booking reference code and offers options to go home or login
 */
export const BookingSuccessStep: React.FC<BookingSuccessStepProps> = ({
  bookingReference,
  shopId,
}) => {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center text-green-600">Buchung erfolgreich!</CardTitle>
        <CardDescription className="text-center">
          Ihr Termin wurde erfolgreich gebucht. Bitte bewahren Sie Ihren Referenzcode auf.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col items-center justify-center">
          <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
          <h2 className="text-xl font-bold">Vielen Dank für Ihre Buchung</h2>
          <p className="text-gray-500 mb-6">Ihr Termin wurde bestätigt.</p>
        </div>

        <div className="p-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 text-center">
          <h3 className="text-sm text-gray-500 mb-2">Ihr Referenzcode:</h3>
          <p className="text-2xl font-bold tracking-wider mb-2">{bookingReference}</p>
          <p className="text-sm text-gray-500">
            Bitte notieren Sie sich diesen Code, um Ihren Termin zu verfolgen oder zu stornieren.
          </p>
        </div>

        <div className="p-4 bg-yellow-50 rounded-md border border-yellow-200">
          <div className="flex items-start">
            <AlertTriangle className="h-6 w-6 text-yellow-500 mr-2 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-yellow-800">Wichtige Information</p>
              <p className="text-sm text-yellow-700 mt-1">
                Ohne Anmeldung erfolgt keine Erinnerung per E-Mail. Sie können sich jedoch jederzeit
                mit diesem Referenzcode anmelden, um Ihren Termin zu verwalten.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={() => navigate('/')}>
          Zurück zur Startseite
        </Button>
        <Button onClick={() => {
          // Navigate to login page with instructions to link booking after successful login
          navigate('/login', { 
            state: { 
              redirectAfterLogin: '/my-bookings',
              linkAnonymousBooking: true,
              shopId: shopId,
              referenceCode: bookingReference
            }
          });
        }}>
          Jetzt anmelden
        </Button>
      </CardFooter>
    </Card>
  );
};
