import { backendSenden, liveLesen } from './live';

/**
 * Tablet am Tresen per QR-Code koppeln (backend/app/apis/geraete, backend/app/libs/geraete.py).
 *
 * Tablet (pages/Koppeln.tsx): starten → QR-Code mit code zeigen → alle 2 s abholen, bis „fertig“.
 * Handy des Inhabers (pages/KoppelnBestaetigen.tsx): info → Prüfzahl vergleichen → bestaetigen.
 * Laden-Seite (components/GekoppelteTablets.tsx): liste, abmelden.
 */

export type KoppelStart = { code: string; abholen: string; pruefzahl: string; gueltigSekunden: number };

export type KoppelStatus =
  | { status: 'wartet' | 'abgelaufen' }
  | {
      status: 'fertig';
      uid: string;
      email: string | null;
      emailVerified: boolean;
      displayName?: string | null;
      bereich: string;
      laden: string | null;
    };

export type KoppelInfo = {
  pruefzahl: string;
  geraet: string | null;
  laeden: { id: string; name: string; gesperrt?: boolean }[];
};

export type GekoppeltesTablet = {
  kennung: string;
  geraet: string | null;
  laden: string | null;
  ladenName: string | null;
  angelegt: string;
  zuletzt: string;
};

/** So meldet sich das Tablet in der Liste; ein iPad gibt sich im Browser als Mac aus, deshalb hier statt im Backend */
export const geraetVorschlag = (): string => {
  try {
    const ua = navigator.userAgent;
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android-Handy' : 'Android-Tablet';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/Windows/.test(ua)) return 'Windows-Rechner';
    if (/Macintosh/.test(ua)) return 'Mac';
  } catch {
    /* ohne navigator: das Backend rät selbst */
  }
  return '';
};

/** Adresse im QR-Code: öffnet am Handy die Bestätigung */
export const bestaetigenAdresse = (code: string) => `${window.location.origin}/koppeln/bestaetigen?code=${encodeURIComponent(code)}`;

export const koppelnStarten = () => backendSenden<KoppelStart>('geraete/koppeln/start', { geraet: geraetVorschlag() });

export const koppelnAbholen = (abholen: string) => backendSenden<KoppelStatus>('geraete/koppeln/abholen', { abholen });

export const koppelnInfo = (code: string) => liveLesen<KoppelInfo>(`geraete/koppeln/info?${new URLSearchParams({ code })}`, true);

export const koppelnBestaetigen = (code: string, laden: string) =>
  backendSenden<{ ok: boolean; laden: string }>('geraete/koppeln/bestaetigen', { code, laden });

export const ladeTablets = async () => (await liveLesen<{ geraete: GekoppeltesTablet[] }>('geraete', true)).geraete;

export const tabletAbmelden = (kennung: string) =>
  backendSenden<{ ok: boolean }>(`geraete/${encodeURIComponent(kennung)}/abmelden`, {});
