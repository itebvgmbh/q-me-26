import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Printer } from 'lucide-react';
import { APP_BASE_PATH, useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import { BrandMark } from '../components/brand/Logo';
import { getShopsByOwnerId, type Shop } from '../utils/firestore';
import { merkeLaden, waehleLaden } from '../utils/laden-wahl';
import { ladeTelefon, nummerFuerKunden, type TelefonStand } from '../utils/telefon-assistent';
import { HilfeLink } from '../components/HilfeLink';
import { markOnboarding } from '../components/onboarding/Startklar';
import { merke, t } from '@/i18n';

const STEPS = [
  merke('QR-Code scannen'),
  merke('Leistung wählen, Nummer ziehen'),
  merke('Draußen warten. Auf dem Handy siehst du, wann du dran bist.'),
];

/** QR-Plakat für Tür und Tresen, A4 hoch. Gedruckt wird über den Browser (Strg+P). */
export default function Plakat() {
  const { user } = useCurrentUser();
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [shopId, setShopId] = useState('');
  const [telefon, setTelefon] = useState<TelefonStand | null>(null);
  const [mitTelefon, setMitTelefon] = useState(true);

  useEffect(() => {
    if (!user) return;
    getShopsByOwnerId(user.uid).then((list) => {
      setShops(list);
      // ?shopId= vom Tresen oder von „Laden“, sonst der zuletzt gezeigte Laden
      setShopId((current) => current || waehleLaden(list)?.id || '');
    });
  }, [user]);

  useEffect(() => {
    if (shopId) merkeLaden(shopId);
  }, [shopId]);

  useEffect(() => {
    setTelefon(null);
    if (!shopId) return;
    let aktuell = true;
    ladeTelefon(shopId)
      .then((stand) => aktuell && setTelefon(stand))
      .catch(() => undefined);
    return () => {
      aktuell = false;
    };
  }, [shopId]);

  const shop = shops?.find((s) => s.id === shopId);
  if (shops === null) return <div className="mx-auto max-w-3xl px-4 py-16 text-muted-foreground">{t('Plakat wird vorbereitet …')}</div>;
  if (!shop) return <div className="mx-auto max-w-3xl px-4 py-16">{t('Richte zuerst deinen Laden ein.')}</div>;

  const url = `${window.location.origin}${APP_BASE_PATH}/public-join-queue?shopId=${shop.id}`;
  const host = window.location.host.replace(/^www\./, '');
  // Gedruckt bleibt die Zeile hängen, auch wenn der Assistent später aus ist: deshalb nur auf Wunsch und nur, wenn er gerade abnimmt
  const telefonNummer = telefon?.weitersagen ? nummerFuerKunden(telefon, shop.phone) : '';
  const mitZeile = mitTelefon && Boolean(telefonNummer);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 print:max-w-none print:p-0">
      <style>{'@page { size: A4 portrait; margin: 12mm; }'}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em]">{t('QR-Plakat')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('Auf A4 drucken und an Tür oder Tresen hängen.')} <HilfeLink hilfe="plakat">{t('Tipps fürs Aufhängen')}</HilfeLink>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {telefonNummer && (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={mitTelefon} onChange={(e) => setMitTelefon(e.target.checked)} />
              {t('Telefon-Hinweis aufs Plakat')}
            </label>
          )}
          {shops.length > 1 && (
            <select aria-label={t('Laden wählen')} className="rounded-xl border border-border bg-card px-3 py-2" value={shopId} onChange={(e) => setShopId(e.target.value)}>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <Button
            onClick={() => {
              markOnboarding(shop.id, 'plakatAt');
              window.print();
            }}
          >
            <Printer className="me-2 h-4 w-4" aria-hidden="true" /> {t('Drucken')}
          </Button>
        </div>
      </div>

      {/* Das Blatt: auf dem Bildschirm als Vorschau, beim Drucken allein */}
      <article className="mx-auto flex aspect-[210/297] w-full max-w-[640px] flex-col justify-between gap-6 rounded-3xl border border-border bg-white p-[6%] text-[#141414] shadow-sm print:max-w-none print:overflow-hidden print:rounded-none print:border-0 print:shadow-none">
        <header className="flex flex-col gap-3">
          <p className="text-[clamp(14px,2.4vw,18px)] font-semibold uppercase tracking-[0.12em]">{shop.name}</p>
          <h2 className="font-display text-[clamp(40px,8vw,72px)] font-extrabold leading-[0.92] tracking-[-0.045em]">
            {t('Nummer ziehen.')}
            <br />
            {t('Ohne App.')}
          </h2>
        </header>

        <div className={`mx-auto rounded-[8%] bg-[#ffc83d] p-[5%] ${mitZeile ? 'w-[42%] print:w-[50%]' : 'w-[62%]'}`}>
          <QRCodeSVG value={url} size={512} className="h-auto w-full" bgColor="#ffc83d" fgColor="#141414" marginSize={0} />
        </div>

        <ol className="flex flex-col gap-2">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-baseline gap-3 text-[clamp(16px,2.8vw,22px)] font-semibold">
              <span className="font-mono font-bold">{i + 1}</span>
              {t(step)}
            </li>
          ))}
        </ol>

        {mitZeile && (
          <p className="text-[clamp(14px,2.4vw,18px)] font-semibold print:text-[22px]">
            <strong className="font-display text-[clamp(18px,3vw,24px)] font-extrabold print:text-[34px]">
              {t('Lieber anrufen?')}{' '}
              <span dir="ltr" className="whitespace-nowrap font-mono">
                {telefonNummer}
              </span>
            </strong>
            <br />
            {t('Geht keiner ran, nimmt unser KI-Assistent ab und bucht deinen Termin.')}
          </p>
        )}

        <footer className="flex items-center justify-between gap-3 border-t-2 border-dashed border-[#141414]/30 pt-4">
          <span className="flex items-center gap-2 font-display text-[clamp(18px,3vw,24px)] font-extrabold">
            <BrandMark className="h-8 w-8" /> Dranzeit
          </span>
          <span className="font-mono text-[clamp(12px,2vw,15px)]">{host}</span>
        </footer>
      </article>
    </div>
  );
}
