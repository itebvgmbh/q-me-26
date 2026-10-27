import { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserProfile, USER_ROLES } from '../utils/types';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { DeleteAccountCard } from './DeleteAccountCard';
import { EmailVerificationNote } from './EmailVerificationNote';
import { PasswordChangeCard } from './PasswordChangeCard';

interface ProfileFormProps {
  userId: string;
}

export const ProfileForm = ({ userId }: ProfileFormProps) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const db = getFirestore(firebaseApp);
        const docRef = doc(db, 'users', userId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data() as UserProfile;
          setProfile(data);
          setDisplayName(data.displayName || '');
          setPhoneNumber(data.phoneNumber || '');
        }
      } catch (error) {
        toast.error(t('Dein Profil konnte nicht geladen werden.'));
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [userId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);

    try {
      const db = getFirestore(firebaseApp);
      const docRef = doc(db, 'users', userId);
      
      await updateDoc(docRef, {
        displayName,
        phoneNumber,
        updatedAt: new Date()
      });

      toast.success(t('Gespeichert.'));
    } catch (error) {
      toast.error(t('Speichern hat nicht geklappt.'));
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return <div className="h-64 animate-pulse rounded-3xl bg-muted" aria-busy="true" aria-label={t('Profil wird geladen')} />;
  }

  if (!profile) {
    return (
      <>
        <p className="rounded-3xl border border-border bg-card p-5 text-muted-foreground">{t('Zu deinem Konto gibt es noch kein Profil.')}</p>
        <PasswordChangeCard />
      </>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="profil-email">{t('E-Mail')}</Label>
            <Input id="profil-email" value={profile.email} dir="ltr" disabled />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="profil-rolle">{t('Konto')}</Label>
            <Input id="profil-rolle" value={t(USER_ROLES[profile.role])} disabled />
          </div>
        </div>
        <EmailVerificationNote role={profile.role} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="displayName">{t('Name')}</Label>
          <Input id="displayName" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t('So rufen wir dich auf')} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="phoneNumber">{t('Handynummer')}</Label>
          <Input id="phoneNumber" type="tel" autoComplete="tel" dir="ltr" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder={t('Damit der Laden dich erreicht')} />
        </div>
        <Button type="submit" className="self-start" disabled={updating}>
          {updating ? t('Wird gespeichert …') : t('Speichern')}
        </Button>
      </form>
      <PasswordChangeCard />
      <DeleteAccountCard role={profile.role} />
    </>
  );
};
