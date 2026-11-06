import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from 'app';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { createUserProfile, getRedirectPath, loadUserProfile } from '../utils/user-profile-service';
import { authErrorMessage } from '../utils/auth-errors';
import { ROLE_CHOICES, RoleChoiceCard } from '../components/auth/RoleChoice';
import { FormError } from '../components/auth/AuthShell';
import { ConnectionProblem } from '../components/ConnectionProblem';

/**
 * Für Konten ohne Profil (z. B. abgebrochene Registrierung). Mitarbeiter-Rolle gibt es nur
 * per Einladung – vorher konnte sich hier jeder selbst zum Mitarbeiter machen.
 * Die Wahl erscheint erst, wenn feststeht, dass es kein Profil gibt: Ohne Verbindung zur Datenbank sah ein
 * bestehendes Konto sonst so aus, als hätte es keins (iPhone, 27.10.2026).
 */
const RoleSelection = () => {
  const navigate = useNavigate();
  const { user, loading: userLoading } = useCurrentUser();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<{ state: 'pruefen' | 'waehlen' | 'fehler'; error?: unknown }>({ state: 'pruefen' });

  useEffect(() => {
    if (userLoading) return;
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }
    // Wer schon eine Rolle hat, muss hier nicht wählen
    loadUserProfile(user.uid)
      .then(async (profile) => {
        if (profile) navigate(await getRedirectPath(user.uid), { replace: true });
        else setCheck({ state: 'waehlen' });
      })
      .catch((err) => setCheck({ state: 'fehler', error: err }));
  }, [user, userLoading, navigate]);

  const choose = async (role: 'customer' | 'shopOwner') => {
    if (!user) return;
    setSaving(role);
    setError(null);
    try {
      await createUserProfile(user.uid, user.email || '', role);
      toast.success(t('Alles klar, los geht’s.'));
      navigate(await getRedirectPath(user.uid), { replace: true });
    } catch (err) {
      console.error('Firestore Error:', err);
      setError(authErrorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  if (userLoading || !user || check.state === 'pruefen') return null;

  if (check.state === 'fehler') {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-16">
        <ConnectionProblem error={check.error} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:py-16">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('Fast fertig.')}</h1>
        <p className="text-muted-foreground">{t('Sag uns noch, wie du Dranzeit nutzt. Das lässt sich später nicht selbst ändern.')}</p>
      </div>
      {error && <FormError>{error}</FormError>}
      <div className="grid gap-4 sm:grid-cols-2">
        {ROLE_CHOICES.map((choice, i) => (
          <button key={choice.role} type="button" onClick={() => choose(choice.role)} disabled={!!saving} className="rounded-3xl disabled:opacity-60">
            <RoleChoiceCard icon={choice.icon} title={t(choice.title)} text={t(choice.text)} as="span" dark={i === 0}>
              {saving === choice.role ? t('Wird gespeichert …') : t('Auswählen')}
            </RoleChoiceCard>
          </button>
        ))}
      </div>
    </div>
  );
};

export default RoleSelection;
