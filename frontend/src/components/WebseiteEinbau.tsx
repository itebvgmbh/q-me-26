import { useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HilfeLink } from './HilfeLink';
import { hasFeature } from '../utils/plans';
import type { Shop } from '../utils/firestore/types';

/** Der Code landet auf fremden Webseiten und zeigt deshalb immer auf die öffentliche Adresse, auch beim Entwickeln */
export const PUBLIC_ORIGIN = 'https://dranzeit.de';

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

type Ziel = 'nummer' | 'termin' | 'laden';

const ZIELE: Record<Ziel, { label: string; text: string; path: (id: string) => string }> = {
  nummer: { label: 'Nummer ziehen', text: 'Nummer ziehen', path: (id) => `/public-join-queue?shopId=${id}` },
  termin: { label: 'Termin buchen', text: 'Termin buchen', path: (id) => `/book-appointment?shopId=${id}&fromMarketplace=true` },
  laden: { label: 'Deine Seite bei Dranzeit (beides)', text: 'Nummer ziehen oder Termin buchen', path: (id) => `/shop-details?shopId=${id}` },
};

/** Kasten fürs iframe (backend/app/einbau.py). Höhe passt auch bei 280 px Breite und zweizeiligem Namen. */
export const kastenCode = (shop: Pick<Shop, 'id' | 'name'>) =>
  `<iframe src="${PUBLIC_ORIGIN}/einbau/${encodeURIComponent(shop.id)}" title="${escapeHtml(`Nummer ziehen bei ${shop.name}`)}" ` +
  'width="100%" height="300" style="border:0;width:100%;max-width:560px;height:300px" loading="lazy"></iframe>';

/** Schlichter Link-Knopf: Bis jemand klickt, geht nichts an Dranzeit */
export const knopfCode = (href: string, text: string) =>
  `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 24px;border-radius:999px;` +
  `background:#ffc83d;color:#141414;font:700 16px/1.2 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;text-decoration:none">` +
  `${escapeHtml(text)}</a>`;

const copy = (text: string, done = 'Kopiert.') =>
  navigator.clipboard.writeText(text).then(
    () => toast.success(done),
    () => toast.error('Kopieren ging nicht. Markier den Text und kopier ihn von Hand.'),
  );

const CodeBox = ({ id, label, code }: { id: string; label: string; code: string }) => (
  <div className="flex flex-col gap-2">
    <Label htmlFor={id}>{label}</Label>
    <textarea
      id={id}
      readOnly
      value={code}
      rows={4}
      onFocus={(e) => e.currentTarget.select()}
      className="w-full resize-none rounded-2xl border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed"
    />
    <Button variant="signal" className="self-start" onClick={() => copy(code, 'Code kopiert.')}>
      <Copy className="h-4 w-4" aria-hidden="true" />
      Code kopieren
    </Button>
  </div>
);

const DATENSCHUTZ_SATZ =
  'Auf dieser Seite binden wir einen Kasten von Dranzeit (ITEBV GmbH) ein, über den Sie online eine Nummer ziehen oder ' +
  'einen Termin buchen können. Beim Laden des Kastens überträgt Ihr Browser Ihre IP-Adresse an die Server von Dranzeit; ' +
  'Cookies werden dabei nicht gesetzt. Mehr dazu: https://dranzeit.de/datenschutz';

/** "Mein Laden" → Auf deiner Webseite: Kasten (iframe), Knopf (Link) und QR-Code als Bild */
export const WebseiteEinbau = ({ shop }: { shop: Shop }) => {
  const termine = hasFeature(shop, 'termine');
  const [ziel, setZiel] = useState<Ziel>('nummer');
  const [text, setText] = useState(ZIELE.nummer.text);
  const chooseZiel = (value: Ziel) => {
    setZiel(value);
    setText(ZIELE[value].text);
  };
  const id = encodeURIComponent(shop.id);
  const knopfHref = `${PUBLIC_ORIGIN}${ZIELE[ziel].path(id)}`;
  const knopf = knopfCode(knopfHref, text.trim() || ZIELE[ziel].text);
  const ladenseite = `${PUBLIC_ORIGIN}/shop-details?shopId=${id}`;

  return (
    <section className="flex flex-col gap-5 rounded-3xl border border-border bg-card p-5 sm:p-6" aria-labelledby="webseite-titel">
      <div className="flex flex-col gap-1">
        <h2 id="webseite-titel" className="font-display text-xl font-bold">Auf deiner Webseite</h2>
        <p className="text-sm text-muted-foreground">
          Bau Dranzeit auf deiner eigenen Webseite ein. Kunden ziehen dort eine Nummer oder buchen einen Termin – das Ziehen und Buchen
          selbst läuft bei Dranzeit, in einem neuen Tab.{' '}
          <HilfeLink hilfe="auf-der-webseite">Anleitung</HilfeLink>
        </p>
      </div>

      <Tabs defaultValue="kasten" className="flex flex-col gap-4">
        <TabsList className="self-start">
          <TabsTrigger value="kasten">Kasten</TabsTrigger>
          <TabsTrigger value="knopf">Knopf</TabsTrigger>
          <TabsTrigger value="qr">QR-Code</TabsTrigger>
        </TabsList>

        <TabsContent value="kasten" className="mt-0 grid gap-5 lg:grid-cols-[minmax(0,560px)_1fr]">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Vorschau</p>
            <iframe
              src={`/routes/seo/einbau/${id}`}
              title={`Vorschau: Kasten für ${shop.name}`}
              className="h-[300px] w-full max-w-[560px] rounded-[20px] border-0"
              loading="lazy"
            />
          </div>
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              Zeigt live, ob offen ist und wie viele gerade warten
              {termine ? ', mit „Nummer ziehen“ und „Termin buchen“' : ', mit „Nummer ziehen“'}. Auf breiten Bildschirmen steht der QR-Code
              daneben – zum Scannen mit dem Handy. Änderst du hier etwas am Laden, ändert sich der Kasten von selbst.
            </p>
            <CodeBox id="code-kasten" label="Code für deine Webseite" code={kastenCode(shop)} />
            <p className="text-sm text-muted-foreground">
              Füg den Code dort ein, wo dein Baukasten „HTML“, „Code“ oder „Einbetten“ anbietet – bei WordPress zum Beispiel im Block
              „Individuelles HTML“.
            </p>
            <div className="flex flex-col gap-2 rounded-2xl border border-border bg-muted/40 p-3 text-sm">
              <p>
                <strong>Datenschutz:</strong> Der Kasten lädt von dranzeit.de. Dabei sieht unser Server wie bei jedem Seitenaufruf die
                IP-Adresse der Besucher; Cookies setzt der Kasten nicht. Erwähne ihn in deiner Datenschutzerklärung, zum Beispiel so:
              </p>
              <p className="italic text-muted-foreground">„{DATENSCHUTZ_SATZ}“</p>
              <Button variant="outline" size="sm" className="self-start" onClick={() => copy(DATENSCHUTZ_SATZ, 'Text kopiert.')}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                Text kopieren
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="knopf" className="mt-0 grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="knopf-ziel">Der Knopf führt zu</Label>
              <Select value={ziel} onValueChange={(value) => chooseZiel(value as Ziel)}>
                <SelectTrigger id="knopf-ziel" className="sm:w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nummer">{ZIELE.nummer.label}</SelectItem>
                  {termine && <SelectItem value="termin">{ZIELE.termin.label}</SelectItem>}
                  <SelectItem value="laden">{ZIELE.laden.label}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="knopf-text">Beschriftung</Label>
              <Input id="knopf-text" value={text} maxLength={60} onChange={(e) => setText(e.target.value)} className="sm:w-80" />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Vorschau</p>
              {/* Genau der Code, den der Laden bekommt (Text und Adresse sind maskiert) */}
              <div className="rounded-2xl border border-dashed border-border p-4" data-testid="knopf-vorschau" dangerouslySetInnerHTML={{ __html: knopf }} />
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <CodeBox id="code-knopf" label="Code für deine Webseite" code={knopf} />
            <p className="text-sm text-muted-foreground">
              Ein einfacher Link: Bis jemand draufklickt, erfährt Dranzeit nichts – dafür brauchst du nichts in der Datenschutzerklärung.
              Kann dein Baukasten kein HTML, leg dort einen eigenen Knopf an und trag diesen Link ein:
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded-xl bg-muted/60 px-3 py-2 text-xs">{knopfHref}</code>
              <Button variant="outline" size="sm" onClick={() => copy(knopfHref, 'Link kopiert.')}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                Link kopieren
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="qr" className="mt-0 flex flex-col gap-4 sm:flex-row sm:items-start">
          <img
            src={`/routes/seo/einbau/${id}/qr.svg`}
            alt={`QR-Code: Nummer ziehen bei ${shop.name}`}
            width={176}
            height={176}
            className="self-start rounded-2xl border border-border bg-white"
          />
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Derselbe Code wie auf dem Plakat: Wer ihn scannt, zieht eine Nummer. Für deine Webseite, Flyer, Visitenkarten oder das
              Schaufenster.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="signal" asChild>
                <a href={`/routes/seo/einbau/${id}/qr.png`} download>
                  <Download className="h-4 w-4" aria-hidden="true" />
                  PNG herunterladen
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href={`/routes/seo/einbau/${id}/qr.svg`} download>
                  <Download className="h-4 w-4" aria-hidden="true" />
                  SVG herunterladen
                </a>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">PNG passt für Webseite und Word. SVG lässt sich beliebig groß drucken – gut für die Druckerei.</p>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>
          <strong>Tipp:</strong> Trag den Link zu deiner Seite bei Dranzeit auch in dein Google-Unternehmensprofil ein, als Link für
          Termine oder Buchungen. Dort suchen die meisten Kunden.
        </p>
        <Button variant="outline" size="sm" className="shrink-0 self-start sm:self-auto" onClick={() => copy(ladenseite, 'Link kopiert.')}>
          <Copy className="h-4 w-4" aria-hidden="true" />
          Link kopieren
        </Button>
      </div>
    </section>
  );
};
