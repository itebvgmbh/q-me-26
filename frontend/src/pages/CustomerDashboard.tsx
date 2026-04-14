import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from 'app';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Navigation } from '../components/Navigation';
import { getUserProfile } from '../utils/user-profile-service';
import { UserProfile } from '../utils/types';

const CustomerDashboard = () => {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      if (user) {
        const userProfile = await getUserProfile(user.uid);
        setProfile(userProfile);
      }
      setLoading(false);
    };

    loadProfile();
  }, [user]);

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="container mx-auto py-8">
          <p>Lädt...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <div className="container mx-auto py-8 space-y-8">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Willkommen bei Q-ME</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Termine</CardTitle>
              <CardDescription>Verwalten Sie Ihre Termine</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => navigate('/book-appointment')}
              >
                Termin buchen
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Meine Buchungen</CardTitle>
              <CardDescription>Sehen Sie Ihre aktuellen und vergangenen Termine</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => navigate('/my-bookings')}
              >
                Buchungen anzeigen
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Warteschlange</CardTitle>
              <CardDescription>Nächsten verfügbaren Zeitslot finden</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => navigate('/public-join-queue')}
              >
                In Warteschlange einreihen
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Profil</CardTitle>
              <CardDescription>Verwalten Sie Ihre persönlichen Daten</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => navigate('/customer-profile')}
              >
                Profil bearbeiten
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
};

export default CustomerDashboard;