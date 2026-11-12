import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { intlSprache, t, tn } from '@/i18n';
import { ladenLoeschen, loeschVorschau, passt, type LoeschVorschau } from '../utils/laden-loeschen';

/**
 * Laden löschen (Inhaber): erst zeigen, was mit weggeht und was aufhält (laufendes Abo, Telefon-Assistent), dann zur
 * Bestätigung den Namen des Ladens eintippen. Das Backend sichert vorher alles auf dem Server und prüft noch einmal.
 * Benutzt von „Meine Läden“ (pages/Laeden.tsx) und „Laden“ (pages/ShopProfile.tsx).
 */
export function LadenLoeschenDialog({
  shop,
  onClose,
  onDeleted,
}: {
  shop: { id: string; name: string } | null;
  onClose: () => void;
  onDeleted: (shopId: string) => void;
}) {
  const [vorschau, setVorschau] = useState<LoeschVorschau | null>(null);
  const [fehler, setFehler] = useState('');
  const [eingabe, setEingabe] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setVorschau(null);
    setFehler('');
    setEingabe('');
    if (!shop) return;
    let aktiv = true;
    loeschVorschau(shop.id)
      .then((v) => aktiv && setVorschau(v))
      .catch((e) => aktiv && setFehler(e instanceof Error && e.message ? e.message : t('Das hat nicht geklappt.')));
    return () => {
      aktiv = false;
    };
  }, [shop]);

  const loeschen = async () => {
    if (!shop || !vorschau || busy) return;
    setBusy(true);
    setFehler('');
    try {
      await ladenLoeschen(shop.id, eingabe);
      toast.success(t('„{name}“ ist gelöscht.', { name: vorschau.name }));
      onDeleted(shop.id);
    } catch (e) {
      setFehler(e instanceof Error && e.message ? e.message : t('Das hat nicht geklappt.'));
    } finally {
      setBusy(false);
    }
  };

  const n = vorschau?.anzahl;
  const bereit = Boolean(vorschau && !vorschau.hindernis && passt(eingabe, vorschau.bestaetigung));

  return (
    <Dialog open={shop !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('„{name}“ löschen?', { name: shop?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('Das lässt sich nicht rückgängig machen.')}</DialogDescription>
        </DialogHeader>

        {!vorschau && !fehler && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('Wird geladen')}
          </p>
        )}

        {vorschau?.hindernis && (
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/50 p-4" role="alert">
            <p className="text-sm">{vorschau.hindernis}</p>
            {vorschau.hindernisArt === 'tarif' && (
              <Button variant="outline" size="sm" className="self-start" asChild>
                <Link to={`/tarif?shopId=${encodeURIComponent(vorschau.id)}`} onClick={onClose}>
                  {t('Zum Tarif')}
                </Link>
              </Button>
            )}
            {vorschau.hindernisArt === 'telefon' && (
              <Button variant="outline" size="sm" className="self-start" asChild>
                <Link to={`/telefon-assistent?shopId=${encodeURIComponent(vorschau.id)}`} onClick={onClose}>
                  {t('Zum Telefon-Assistenten')}
                </Link>
              </Button>
            )}
          </div>
        )}

        {vorschau && n && !vorschau.hindernis && (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-col gap-1.5">
              <p className="font-semibold">{t('Das geht mit weg:')}</p>
              <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
                <li>{tn(n.termine, '{n} Termin und Nummer', '{n} Termine und Nummern')}</li>
                <li>{tn(n.team, '{n} Person im Team', '{n} Personen im Team')}</li>
                <li>{tn(n.leistungen, '{n} Leistung', '{n} Leistungen')}</li>
                <li>{tn(n.kunden, '{n} Eintrag in der Kundenliste', '{n} Einträge in der Kundenliste')}</li>
                <li>{t('Logo, Fotos, QR-Code und Links zu diesem Laden')}</li>
              </ul>
              <p className="text-muted-foreground">{t('Dein Konto bleibt, ebenso die Konten deines Teams.')}</p>
            </div>
            {n.kommende > 0 && (
              <p className="flex gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-destructive" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {tn(
                  n.kommende,
                  '{n} Kunde hat noch einen Termin. Er bekommt keine Nachricht – sag vorher selbst ab.',
                  '{n} Kunden haben noch einen Termin. Sie bekommen keine Nachricht – sag vorher selbst ab.',
                )}
              </p>
            )}
            {vorschau.aboEndet && (
              <p className="text-muted-foreground">
                {t('Dein gekündigtes Abo läuft am {datum} aus. Abgebucht wird nichts mehr.', {
                  datum: new Date(vorschau.aboEndet).toLocaleDateString(intlSprache(), { day: 'numeric', month: 'long', year: 'numeric' }),
                })}
              </p>
            )}
            {vorschau.gruender && <p className="text-muted-foreground">{t('Der Gründerpreis gilt nur für diesen Laden und geht mit ihm verloren.')}</p>}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="laden-loeschen-name">{t('Zum Bestätigen tipp den Namen des Ladens ein: {name}', { name: vorschau.bestaetigung })}</Label>
              <Input
                id="laden-loeschen-name"
                autoComplete="off"
                value={eingabe}
                onChange={(e) => setEingabe(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && bereit && loeschen()}
                className="h-11"
              />
            </div>
          </div>
        )}

        {fehler && (
          <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {fehler}
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('Abbrechen')}
          </Button>
          {vorschau && !vorschau.hindernis && (
            <Button variant="destructive" onClick={loeschen} disabled={!bereit || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              {t('Endgültig löschen')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
