import { useEffect, useState } from 'react';
type DocumentData = Record<string, any>;
import { getStaffBreaks } from '../firestore/breaks';

/** Pausen einer Person, wie booking-rules sie liest: wiederkehrende (recurring-breaks) und einzelne (breaks) */
export interface StaffBreaks {
  recurring: DocumentData[];
  single: DocumentData[];
}

/** Pausen aller Personen für den Kalender am Tresen – einmal je Team geladen, gilt für jeden Tag (über das Backend) */
export function useStaffBreaks(staffIds: string[]): Record<string, StaffBreaks> {
  const [breaks, setBreaks] = useState<Record<string, StaffBreaks>>({});
  const key = [...staffIds].sort().join(',');

  useEffect(() => {
    if (!key) {
      setBreaks({});
      return;
    }
    let active = true;
    Promise.all(
      key.split(',').map(async (staffId) => {
        const { einzeln, fest } = await getStaffBreaks(staffId);
        return [staffId, { recurring: fest as DocumentData[], single: einzeln as DocumentData[] }] as const;
      }),
    )
      .then((entries) => active && setBreaks(Object.fromEntries(entries)))
      .catch((error) => console.error('Pausen für den Kalender nicht geladen:', error));
    return () => {
      active = false;
    };
  }, [key]);

  return breaks;
}
