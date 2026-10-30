import { useEffect, useState } from 'react';
import { collection, getDocs, query, where, type DocumentData } from 'firebase/firestore';
import { firestore as db } from '../firestore-client';

/** Pausen einer Person, wie booking-rules sie liest: wiederkehrende (recurring-breaks) und einzelne (breaks) */
export interface StaffBreaks {
  recurring: DocumentData[];
  single: DocumentData[];
}

/** Pausen aller Personen für den Kalender am Tresen – einmal je Team geladen, gilt für jeden Tag */
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
        const [recurring, single] = await Promise.all([
          getDocs(query(collection(db, 'recurring-breaks'), where('staffId', '==', staffId))),
          getDocs(query(collection(db, 'breaks'), where('staffId', '==', staffId))),
        ]);
        return [staffId, { recurring: recurring.docs.map((d) => d.data()), single: single.docs.map((d) => d.data()) }] as const;
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
