import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { APP_BASE_PATH } from 'app';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { firebaseAuth } from 'app';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { getRedirectPath } from '../utils/user-profile-service';
import { linkAnonymousBookingsToUser } from '../utils/AnonymousBookingLinker';

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(firebaseAuth, email, password);
      
      // If returnTo parameter exists, navigate there, otherwise use role-based redirect
      // Nach erfolgreichem Login, prüfe ob es eine anonyme Buchung gibt, die verknüpft werden soll
      if (location.state?.linkAnonymousBooking) {
        console.log('Verknüpfe anonyme Buchung nach Login:', location.state);
        
        // Verknüpfe spezifische Buchung, wenn shopId und referenceCode vorhanden sind
        if (location.state.shopId && location.state.referenceCode) {
          await linkAnonymousBookingsToUser(
            userCredential.user.uid,
            location.state.shopId,
            location.state.referenceCode
          );
        } else {
          // Ansonsten alle anonymen Buchungen verknüpfen
          await linkAnonymousBookingsToUser(userCredential.user.uid);
        }
        
        // Navigiere zur angegebenen Seite nach der Verknüpfung
        if (location.state.redirectAfterLogin) {
          navigate(location.state.redirectAfterLogin);
        } else {
          navigate('/my-bookings');
        }
      } else if (returnTo) {
        navigate(returnTo);
      } else {
        const redirectPath = await getRedirectPath(userCredential.user.uid);
        navigate(redirectPath);
      }
    } catch (error: any) {
      console.error('Login error:', error);
      toast.error('Anmeldung fehlgeschlagen: ' + (error.message || 'Unbekannter Fehler'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto max-w-md py-12">
      <Card>
        <CardHeader>
          <CardTitle>Anmeldung</CardTitle>
          <CardDescription>Melden Sie sich bei Ihrem Q-ME Konto an</CardDescription>
        </CardHeader>
        <CardContent>
          {returnTo?.includes('/public-join-queue') && (
            <div className="mb-4 p-4 bg-blue-50 rounded-md border border-blue-100">
              <h3 className="font-medium text-blue-800 mb-1">Anonyme Buchung möglich</h3>
              <p className="text-sm text-blue-700">
                Sie können einen Termin auch ohne Anmeldung buchen. 
                <Button 
                  variant="link" 
                  className="p-0 h-auto text-blue-600"
                  onClick={() => navigate(returnTo || '/public-join-queue')}
                >
                  Zurück zur anonymen Buchung
                </Button>
              </p>
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Anmeldung...' : 'Anmelden'}
            </Button>
            <div className="text-center text-sm text-gray-600">
              Noch kein Konto?{' '}
              <a
                href={`${APP_BASE_PATH}/register-options`}
                className="text-primary hover:underline font-normal"
              >
                Jetzt registrieren
              </a>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;