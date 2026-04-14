import { useNavigate } from 'react-router-dom';
import { APP_BASE_PATH } from 'app';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Store, User } from 'lucide-react';

// @ts-ignore
// @auth open
const RegisterOptions = () => {
  const navigate = useNavigate();

  return (
    <div className="container mx-auto max-w-4xl py-12">
      <CardHeader className="text-center mb-8">
        <CardTitle className="text-3xl">Registrierung bei Q-ME</CardTitle>
        <CardDescription className="text-lg">
          Wählen Sie, wie Sie Q-ME nutzen möchten
        </CardDescription>
      </CardHeader>

      <div className="grid md:grid-cols-2 gap-8">
        <Card className="relative overflow-hidden transition-all hover:shadow-md cursor-pointer group" onClick={() => {
          window.location.href = `${window.location.origin}${APP_BASE_PATH}/register-shop-owner`;
        }}>
          <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <CardHeader className="text-center">
            <Store className="w-16 h-16 mx-auto text-primary mb-2" />
            <CardTitle>Als Shop-Betreiber registrieren</CardTitle>
            <CardDescription>Verwalten Sie Ihr Geschäft, Termine und Mitarbeiter</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <ul className="text-left text-gray-600 space-y-2 mb-6">
              <li>• Terminplanung für Ihr Geschäft</li>
              <li>• Mitarbeiterverwaltung</li>
              <li>• Service-Konfiguration</li>
              <li>• Kundenverwaltung</li>
            </ul>
            <Button className="w-full">Als Shop-Betreiber fortfahren</Button>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden transition-all hover:shadow-md cursor-pointer group" onClick={() => {
          window.location.href = `${window.location.origin}${APP_BASE_PATH}/register-customer`;
        }}>
          <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <CardHeader className="text-center">
            <User className="w-16 h-16 mx-auto text-primary mb-2" />
            <CardTitle>Als Kunde registrieren</CardTitle>
            <CardDescription>Buchen Sie Termine bei Ihren Lieblingsshops</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <ul className="text-left text-gray-600 space-y-2 mb-6">
              <li>• Einfache Terminbuchung</li>
              <li>• Terminübersicht</li>
              <li>• Benachrichtigungen</li>
              <li>• Favoriten speichern</li>
            </ul>
            <Button className="w-full">Als Kunde fortfahren</Button>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 text-center text-gray-600">
        <p>Mitarbeiter werden von Shop-Betreibern eingeladen und haben einen speziellen Registrierungslink.</p>
        <p className="mt-4">
          Bereits ein Konto?{' '}
          <a
            href={`${APP_BASE_PATH}/login`}
            className="text-primary hover:underline font-normal"
          >
            Jetzt anmelden
          </a>
        </p>
      </div>
    </div>
  );
};

export default RegisterOptions;