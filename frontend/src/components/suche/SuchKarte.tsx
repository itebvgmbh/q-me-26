import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RefreshCw } from 'lucide-react';
import { t, tn } from '@/i18n';
import { hatLage, offenJetzt, type Frei, type Grenzen, type Punkt, type SalonTreffer, type Treffer } from '../../utils/suche';
import { zeitKurz } from '../../utils/suche-daten';
import { UebernehmenLink } from './TrefferKarte';

const BERLIN: [number, number] = [52.517, 13.389];

const html = (text: string) => text.replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[z] as string);

/** Was auf der Stecknadel steht: live, was zählt – sonst der Name */
export const pinText = (treffer: Treffer, frei: Frei | undefined, jetzt: Date): string => {
  const offen = offenJetzt(treffer.laden, jetzt);
  if (frei && offen) return frei.warten === 0 ? t('Kein Warten') : tn(frei.warten, '{n} wartet', '{n} warten');
  if (frei?.termine[0]) return zeitKurz(frei.termine[0].start, jetzt);
  const name = treffer.laden.name.trim();
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
};

const pin = (text: string, aktiv: boolean, offen: boolean) =>
  L.divIcon({
    className: 'suche-pin',
    // Größe aus dem Inhalt (Leaflet: null), Spitze der Sprechblase auf dem Punkt
    iconSize: null as unknown as undefined,
    iconAnchor: [0, 0],
    html: `<span class="${[
      'absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full border px-2.5 py-1 font-sans text-[13px] font-semibold shadow-md transition-transform',
      aktiv ? 'z-10 scale-110 border-foreground bg-foreground text-signal' : offen ? 'border-foreground/20 bg-card text-foreground' : 'border-border bg-muted text-muted-foreground',
    ].join(' ')}">${html(text)}</span>`,
  });

/** Ausschnitt anpassen, wenn eine neue Suche kommt (zaehler), und merken, ob danach jemand selbst die Karte bewegt */
function Steuerung({
  punkte,
  mitte,
  zaehler,
  onBewegt,
}: {
  punkte: [number, number][];
  mitte: Punkt | null;
  zaehler: number;
  onBewegt: (grenzen: Grenzen | null) => void;
}) {
  const map = useMap();
  // Nur wer selbst zieht, scrollt, tippt oder die Tasten nimmt, bekommt „In diesem Bereich suchen“ – nicht, wenn die
  // Seite den Ausschnitt anpasst (Leaflet meldet beides gleich als moveend)
  const vomNutzer = useRef(false);
  useEffect(() => {
    const el = map.getContainer();
    const an = () => (vomNutzer.current = true);
    const arten = ['mousedown', 'wheel', 'touchstart', 'keydown'] as const;
    arten.forEach((a) => el.addEventListener(a, an, { passive: true }));
    return () => arten.forEach((a) => el.removeEventListener(a, an));
  }, [map]);
  const einpassen = useRef(() => {});
  einpassen.current = () => {
    vomNutzer.current = false;
    if (punkte.length > 1) map.fitBounds(L.latLngBounds(punkte), { padding: [48, 48], maxZoom: 14 });
    else if (punkte.length === 1) map.setView(punkte[0], 14);
    else if (mitte) map.setView([mitte.lat, mitte.lng], 13);
    else map.setView(BERLIN, 11);
  };
  useEffect(() => {
    einpassen.current();
    onBewegt(null);
    // Nur bei neuer Suche, nicht bei jedem Neuzeichnen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zaehler]);
  // Am Handy liegt die Karte erst versteckt (Größe 0): beim Einblenden neu messen und einpassen, sonst rechnet Leaflet
  // mit 0 × 0 und die Stecknadeln liegen außerhalb
  useEffect(() => {
    const el = map.getContainer();
    let warVersteckt = el.clientWidth === 0;
    const beobachter = new ResizeObserver(() => {
      map.invalidateSize();
      if (warVersteckt && el.clientWidth > 0) einpassen.current();
      warVersteckt = el.clientWidth === 0;
    });
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [map]);
  useMapEvents({
    moveend: () => {
      if (!vomNutzer.current) return;
      vomNutzer.current = false;
      const b = map.getBounds();
      onBewegt({ sued: b.getSouth(), west: b.getWest(), nord: b.getNorth(), ost: b.getEast() });
    },
  });
  return null;
}

/** Bei geöffnetem Laden auf der Karte: dorthin schieben, wenn er nicht zu sehen ist */
function ZumAktiven({ punkt }: { punkt: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (punkt && !map.getBounds().pad(-0.1).contains(punkt)) map.panTo(punkt);
  }, [map, punkt]);
  return null;
}

export function SuchKarte({
  treffer,
  salons,
  frei,
  jetzt,
  aktivId,
  onAktiv,
  onWaehlen,
  mitte,
  nahe,
  fokus,
  zaehler,
  onBereichSuchen,
}: {
  treffer: Treffer[];
  salons: SalonTreffer[];
  frei: Record<string, Frei>;
  jetzt: Date;
  aktivId: string | null;
  onAktiv: (id: string | null) => void;
  /** Klick auf eine Stecknadel */
  onWaehlen: (id: string) => void;
  mitte: Punkt | null;
  /** eigener Standort (blauer Punkt) */
  nahe: Punkt | null;
  /** auf diese Läden einstellen (die im gesuchten Bereich); fehlt es, auf alle */
  fokus?: string[];
  /** neue Suche: Ausschnitt anpassen */
  zaehler: number;
  onBereichSuchen: (grenzen: Grenzen) => void;
}) {
  const [bewegt, setBewegt] = useState<Grenzen | null>(null);
  const mitLage = useMemo(() => treffer.filter((x) => hatLage(x.laden)), [treffer]);
  // Ausschnitt: die Treffer im gesuchten Bereich (sonst alle), dazu Mitte und eigener Standort
  const punkte = useMemo<[number, number][]>(() => {
    const im = fokus ? mitLage.filter((x) => fokus.includes(x.laden.id)) : mitLage;
    return [
      ...im.map((x): [number, number] => [x.laden.lat as number, x.laden.lng as number]),
      ...(mitte ? [[mitte.lat, mitte.lng] as [number, number]] : []),
      ...(nahe ? [[nahe.lat, nahe.lng] as [number, number]] : []),
    ];
  }, [mitLage, fokus, mitte, nahe]);
  const aktiv = mitLage.find((x) => x.laden.id === aktivId);

  return (
    // isolate: Leaflet zählt seine Ebenen bis 1000 hoch, sonst lägen sie beim Scrollen über der Kopfzeile
    <div className="relative isolate h-full w-full overflow-hidden rounded-3xl border border-border">
      <MapContainer center={BERLIN} zoom={11} className="h-full w-full" zoomControl={false} attributionControl>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Steuerung punkte={punkte} mitte={mitte} zaehler={zaehler} onBewegt={setBewegt} />
        <ZumAktiven punkt={aktiv ? [aktiv.laden.lat as number, aktiv.laden.lng as number] : null} />
        {salons.map(({ salon }) => (
          <CircleMarker
            key={`s-${salon.id}`}
            center={[salon.lat, salon.lng]}
            radius={5}
            pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: '#8a8a80', fillOpacity: 0.9 }}
          >
            <Tooltip direction="top" offset={[0, -4]}>{salon.name}</Tooltip>
            <Popup>
              <div className="flex flex-col gap-1">
                <strong className="font-display">{salon.name}</strong>
                <span className="text-xs text-muted-foreground">{t('Noch nicht online buchbar')}</span>
                <a href={salon.pfad} className="text-sm font-semibold underline">
                  {t('Ansehen')}
                </a>
                <UebernehmenLink id={salon.id} />
              </div>
            </Popup>
          </CircleMarker>
        ))}
        {nahe && (
          <CircleMarker center={[nahe.lat, nahe.lng]} radius={8} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -6]}>{t('Du bist hier')}</Tooltip>
          </CircleMarker>
        )}
        {mitLage.map((x) => {
          const istAktiv = x.laden.id === aktivId;
          return (
            <Marker
              key={x.laden.id}
              position={[x.laden.lat as number, x.laden.lng as number]}
              icon={pin(pinText(x, frei[x.laden.id], jetzt), istAktiv, offenJetzt(x.laden, jetzt) !== false)}
              zIndexOffset={istAktiv ? 1000 : 0}
              keyboard
              title={x.laden.name}
              eventHandlers={{
                click: () => onWaehlen(x.laden.id),
                mouseover: () => onAktiv(x.laden.id),
                mouseout: () => onAktiv(null),
              }}
            />
          );
        })}
      </MapContainer>
      {bewegt && (
        <button
          type="button"
          onClick={() => {
            onBereichSuchen(bewegt);
            setBewegt(null);
          }}
          className="absolute left-1/2 top-3 z-[1000] inline-flex h-10 -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold shadow-md hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t('In diesem Bereich suchen')}
        </button>
      )}
    </div>
  );
}
