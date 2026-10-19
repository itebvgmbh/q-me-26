import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Printer } from 'lucide-react';
import { APP_BASE_PATH, useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import { BrandMark } from '../components/brand/Logo';
import { getShopsByOwnerId, type Shop } from '../utils/firestore';

const STEPS = ['QR-Code scannen', 'Leistung wählen, Nummer ziehen', 'Draußen warten. Wir sagen dir Bescheid.'];

/** QR-Plakat für Tür und Tresen, A4 hoch. Gedruckt wird über den Browser (Strg+P). */
export default function Plakat() {
  const { user } = useCurrentUser();
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [shopId, setShopId] = useState('');

  useEffect(() => {
    if (!user) return;
    getShopsByOwnerId(user.uid).then((list) => {
      setShops(list);
      setShopId((s) => s || list[0]?.id || '');
    });
  }, [user]);

  const shop = shops?.find((s) => s.id === shopId);
  if (shops === null) return <div className="mx-auto max-w-3xl px-4 py-16 text-muted-foreground">Plakat wird vorbereitet …</div>;
  if (!shop) return <div className="mx-auto max-w-3xl px-4 py-16">Richte zuerst deinen Laden ein.</div>;

  const url = `${window.location.origin}${APP_BASE_PATH}/public-join-queue?shopId=${shop.id}`;
  const host = window.location.host.replace(/^www\./, '');

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 print:max-w-none print:p-0">
      <style>{'@page { size: A4 portrait; margin: 12mm; }'}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em]">QR-Plakat</h1>
          <p className="text-sm text-muted-foreground">Auf A4 drucken und an Tür oder Tresen hängen.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {shops.length > 1 && (
            <select aria-label="Laden wählen" className="rounded-xl border border-border bg-card px-3 py-2" value={shopId} onChange={(e) => setShopId(e.target.value)}>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <Button onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" aria-hidden="true" /> Drucken
          </Button>
        </div>
      </div>

      {/* Das Blatt: auf dem Bildschirm als Vorschau, beim Drucken allein */}
      <article className="mx-auto flex aspect-[210/297] w-full max-w-[640px] flex-col justify-between gap-6 overflow-hidden rounded-3xl border border-border bg-white p-[6%] text-[#141414] shadow-sm print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        <header className="flex flex-col gap-3">
          <p className="text-[clamp(14px,2.4vw,18px)] font-semibold uppercase tracking-[0.12em]">{shop.name}</p>
          <h2 className="font-display text-[clamp(40px,8vw,72px)] font-extrabold leading-[0.92] tracking-[-0.045em]">
            Nummer ziehen.
            <br />
            Ohne App.
          </h2>
        </header>

        <div className="mx-auto w-[62%] rounded-[8%] bg-[#ffc83d] p-[5%]">
          <QRCodeSVG value={url} size={512} className="h-auto w-full" bgColor="#ffc83d" fgColor="#141414" marginSize={0} />
        </div>

        <ol className="flex flex-col gap-2">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-baseline gap-3 text-[clamp(16px,2.8vw,22px)] font-semibold">
              <span className="font-mono font-bold">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>

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
