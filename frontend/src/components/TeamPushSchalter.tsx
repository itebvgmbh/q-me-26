import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useCurrentUser } from 'app';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { getPushConfig, isIos, type PushConfig } from '../utils/push';
import { inNativeApp } from '../utils/native-app';
import {
  ALLE_EREIGNISSE,
  disableTeamPush,
  enableTeamPush,
  refreshTeamPush,
  savedTeamPush,
  teamPushAvailable,
  type TeamEvent,
  type TeamEvents,
} from '../utils/team-push';
import { t } from '@/i18n';

/**
 * „Mein Tag“: Benachrichtigungen auf diesem Gerät, wenn Kunden selbst eine Nummer ziehen, buchen oder absagen – für die
 * eigenen Termine, als Inhaber für den ganzen Laden (backend/app/libs/team_notify.py). Gilt je Gerät und Konto; beim
 * Öffnen frischt die Seite die Anmeldung auf (utils/team-push.ts).
 */
export function TeamPushSchalter() {
  const { user } = useCurrentUser();
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [events, setEvents] = useState<TeamEvents | null>(() => (user ? savedTeamPush(user.uid) : null));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    getPushConfig().then(async (loaded) => {
      if (!alive) return;
      setConfig(loaded);
      if (teamPushAvailable(loaded)) {
        const refreshed = await refreshTeamPush(user.uid, loaded);
        if (alive) setEvents(refreshed);
      }
    });
    return () => {
      alive = false;
    };
  }, [user]);

  if (!user || !config || (!config.push && !config.app)) return null;
  const available = teamPushAvailable(config);

  const apply = async (next: TeamEvents | null) => {
    setBusy(true);
    try {
      if (!next) {
        await disableTeamPush(user.uid);
        setEvents(null);
        toast.success(t('Benachrichtigungen sind aus.'));
        return;
      }
      const result = await enableTeamPush(user.uid, next, config);
      if (result === 'ok') {
        if (!events) toast.success(t('Benachrichtigungen sind an.'));
        setEvents(next);
      } else if (result === 'denied' && inNativeApp()) {
        toast.error(t('Mitteilungen für Dranzeit sind aus. Du kannst sie in den Einstellungen deines Geräts unter Dranzeit einschalten.'));
      } else if (result === 'denied') {
        toast.error(t('Benachrichtigungen sind für diese Seite blockiert. Du kannst sie in den Browser-Einstellungen erlauben.'));
      } else {
        toast.error(t('Dieser Browser kann keine Benachrichtigungen.'));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Das hat nicht geklappt. Versuch es noch einmal.'));
    } finally {
      setBusy(false);
    }
  };

  const choices: { key: TeamEvent; label: string }[] = [
    { key: 'nummer', label: t('Neue Nummern') },
    { key: 'buchung', label: t('Neue Buchungen') },
    { key: 'absage', label: t('Absagen') },
  ];

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border p-4" aria-labelledby="team-push-titel">
      <div className="flex items-start justify-between gap-4">
        <label htmlFor="team-push" className="flex cursor-pointer flex-col gap-1 text-sm">
          <strong id="team-push-titel" className="text-foreground">
            {t('Benachrichtigungen auf diesem Gerät')}
          </strong>
          <span className="text-muted-foreground">
            {t('Wenn Kunden selbst eine Nummer ziehen, online oder am Telefon buchen oder absagen – für deine Termine, als Inhaber für den ganzen Laden.')}
          </span>
          <span className="text-muted-foreground">{t('Zwischen 21 und 8 Uhr ist Ruhe; was nachts passiert, kommt morgens zusammengefasst.')}</span>
        </label>
        <Switch
          id="team-push"
          checked={Boolean(events)}
          disabled={busy || (!available && !events)}
          onCheckedChange={(on) => apply(on ? events ?? ALLE_EREIGNISSE : null)}
          className="mt-0.5"
        />
      </div>

      {events && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {choices.map(({ key, label }) => (
            <label key={key} className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={events[key]}
                disabled={busy}
                onCheckedChange={(checked) => apply({ ...events, [key]: checked === true })}
              />
              {label}
            </label>
          ))}
        </div>
      )}

      {!available && !events && (
        <p className="text-sm text-muted-foreground">
          {isIos()
            ? t('Auf dem iPhone geht das nur mit Dranzeit auf dem Home-Bildschirm: in Safari „Teilen“ → „Zum Home-Bildschirm“, dann von dort öffnen.')
            : t('Dieser Browser kann keine Benachrichtigungen.')}
        </p>
      )}
    </section>
  );
}
