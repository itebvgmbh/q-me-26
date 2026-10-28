import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart3, CalendarDays, CreditCard, Monitor, Plus, Scissors, Store, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GeraetWahl } from './GeraetWahl';
import { TeamPushSchalter } from './TeamPushSchalter';
import { inStoreApp } from '../utils/app-shell';
import { ROLLEN, gespeichertesGeraet, merkeGeraet, type GeraetRolle } from '../utils/geraet';
import { merke, t } from '@/i18n';

type Kachel = { to: string; icon: typeof Users; titel: string; text: string; verkauf?: boolean };

// Was früher oben im Menü und im „…“-Menü am Tresen stand – jetzt an einer Stelle
const KACHELN: Kachel[] = [
  { to: '/staff-management', icon: Users, titel: merke('Team'), text: merke('Personen, Arbeitszeiten, Pausen, Einladungen') },
  { to: '/service-management', icon: Scissors, titel: merke('Leistungen'), text: merke('Was du anbietest, Dauer und Preis') },
  { to: '/employee-dashboard', icon: CalendarDays, titel: merke('Mein Tag'), text: merke('Deine eigene Woche, wenn du selbst mitarbeitest') },
  { to: '/auswertung', icon: BarChart3, titel: merke('Auswertung'), text: merke('Kunden, Wartezeit und Umsatz') },
  { to: '/tarif', icon: CreditCard, titel: merke('Tarif'), text: merke('Dein Tarif und Rechnungen'), verkauf: true },
  { to: '/shop-setup', icon: Plus, titel: merke('Weiterer Laden'), text: merke('Noch einen Laden einrichten') },
];

/** „Laden“: alles, was nicht Heute oder Kalender ist – Verwalten und was auf diesem Gerät gilt */
export function LadenUebersicht({ shopId }: { shopId: string }) {
  const navigate = useNavigate();
  const [geraet, setGeraet] = useState(gespeichertesGeraet);
  const [fragen, setFragen] = useState(false);
  const rolle = ROLLEN.find((r) => r.rolle === geraet?.rolle);

  const waehle = (neu: GeraetRolle) => {
    const gewaehlt = { rolle: neu, shopId };
    merkeGeraet(gewaehlt);
    setGeraet(gewaehlt);
    setFragen(false);
    if (neu === 'bildschirm') navigate(`/bildschirm/${shopId}`);
    else if (neu === 'tresen') navigate('/shop-dashboard');
    else if (neu === 'handy') navigate('/shop-dashboard?nur=ich');
  };

  return (
    <>
      <section className="flex flex-col gap-3" aria-labelledby="verwalten">
        <h2 id="verwalten" className="font-display text-2xl font-bold">
          {t('Verwalten')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {KACHELN.filter((k) => !(k.verkauf && inStoreApp())).map(({ to, icon: Icon, titel, text }) => (
            <Link key={to} to={to} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-foreground">
              <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="flex flex-col gap-0.5">
                <span className="font-display text-lg font-bold">{t(titel)}</span>
                <span className="text-sm text-muted-foreground">{t(text)}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="dieses-geraet">
        <h2 id="dieses-geraet" className="font-display text-2xl font-bold">
          {t('Auf diesem Gerät')}
        </h2>
        <div className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            {rolle?.rolle === 'bildschirm' ? <Monitor className="mt-0.5 h-5 w-5" aria-hidden="true" /> : <Store className="mt-0.5 h-5 w-5" aria-hidden="true" />}
            <div className="flex flex-col gap-0.5">
              <p className="font-semibold">{rolle ? t('Dieses Gerät ist: {rolle}', { rolle: t(rolle.titel) }) : t('Für dieses Gerät ist noch nichts eingestellt.')}</p>
              <p className="text-sm text-muted-foreground">{rolle ? t(rolle.text) : t('Sag einmal, wofür es da ist – dann startet es immer dort.')}</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => setFragen(true)}>
            {rolle ? t('Ändern') : t('Festlegen')}
          </Button>
        </div>
        <TeamPushSchalter />
      </section>

      <GeraetWahl open={fragen} onChoose={waehle} onLater={() => setFragen(false)} />
    </>
  );
}
