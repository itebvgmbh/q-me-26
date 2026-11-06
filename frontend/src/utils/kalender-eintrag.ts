/**
 * Fester Termin in den eigenen Kalender: als .ics-Datei (Apple, Outlook, die meisten Handys) oder als Link zu Google
 * Kalender. Ohne den Schlüssel der Nummer – Kalender werden oft geteilt; absagen geht auf diesem Handy trotzdem.
 */
export interface KalenderTermin {
  id: string;
  start: Date;
  end: Date;
  titel: string;
  ort?: string;
  /** Seite des Termins (/nummer/:id) */
  link: string;
  beschreibung?: string;
}

// 20261109T130000Z
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Text in ICS: Backslash, Komma, Semikolon und Zeilenumbruch maskieren
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n');

export const icsInhalt = (termin: KalenderTermin, jetzt = new Date()): string => {
  const beschreibung = [termin.beschreibung, termin.link].filter(Boolean).join('\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dranzeit//Termin//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${termin.id}@dranzeit.de`,
    `DTSTAMP:${utc(jetzt)}`,
    `DTSTART:${utc(termin.start)}`,
    `DTEND:${utc(termin.end)}`,
    `SUMMARY:${icsText(termin.titel)}`,
    ...(termin.ort ? [`LOCATION:${icsText(termin.ort)}`] : []),
    `DESCRIPTION:${icsText(beschreibung)}`,
    `URL:${termin.link}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT1H',
    `DESCRIPTION:${icsText(termin.titel)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
};

/** .ics herunterladen – das Handy fragt dann, in welchen Kalender */
export const kalenderDateiLaden = (termin: KalenderTermin) => {
  const blob = new Blob([icsInhalt(termin)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'termin.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export const googleKalenderLink = (termin: KalenderTermin) => {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: termin.titel,
    dates: `${utc(termin.start)}/${utc(termin.end)}`,
    details: [termin.beschreibung, termin.link].filter(Boolean).join('\n'),
  });
  if (termin.ort) params.set('location', termin.ort);
  return `https://calendar.google.com/calendar/render?${params}`;
};
