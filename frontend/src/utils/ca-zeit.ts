import { format } from 'date-fns';

// So weit kann es nach der ca.-Zeit noch dauern, bis man dran ist (Puffer für Schnitte, die länger dauern)
const SPIELRAUM_MINUTEN = 15;

/**
 * Zeitfenster für eine Nummer: ab der ca.-Zeit bis etwa eine Viertelstunde danach, auf 5 Minuten aufgerundet.
 * Beginnt nie früher als die ca.-Zeit – die Zeiten wandern nur nach hinten (utils/queue-lane.ts).
 */
export const caFenster = (ca: Date) => {
  const bis = new Date(ca.getTime() + SPIELRAUM_MINUTEN * 60_000);
  bis.setSeconds(0, 0);
  const rest = bis.getMinutes() % 5;
  if (rest) bis.setMinutes(bis.getMinutes() + 5 - rest);
  return { von: format(ca, 'HH:mm'), bis: format(bis, 'HH:mm') };
};
