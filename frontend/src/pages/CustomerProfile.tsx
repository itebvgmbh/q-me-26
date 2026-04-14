import { useState, useEffect } from 'react';
import { useCurrentUser } from 'app';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Navigation } from '../components/Navigation';
import { getUserProfile, updateUserProfile, type UpdateProfileData } from '../utils/user-profile-service';
import type { UserProfile } from '../utils/types';

const CustomerProfile = () => {
  const { user } = useCurrentUser();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState<UpdateProfileData>({
    displayName: '',
    email: '',
    phone: '',
  });

  useEffect(() => {
    const loadProfile = async () => {
      if (user) {
        try {
          const userProfile = await getUserProfile(user.uid);
          setProfile(userProfile);
          setFormData({
            displayName: userProfile?.displayName || '',
            email: userProfile?.email || '',
            phone: userProfile?.phone || '',
          });
        } catch (error) {
          console.error('Error loading profile:', error);
          toast.error('Fehler beim Laden des Profils');
        }
      }
      setLoading(false);
    };

    loadProfile();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      await updateUserProfile(user.uid, formData);
      toast.success('Profil erfolgreich aktualisiert');
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error('Fehler beim Aktualisieren des Profils');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <div className="container mx-auto py-8">
          <p>Lädt...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="container mx-auto py-8 space-y-8">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Mein Profil</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Persönliche Daten</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="displayName">Name</Label>
                <Input
                  id="displayName"
                  value={formData.displayName}
                  onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
                  placeholder="Ihr Name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">E-Mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="ihre.email@beispiel.de"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Telefon</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="+49 123 456789"
                />
              </div>

              <Button type="submit" className="w-full">
                Speichern
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CustomerProfile;
