import React, { useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useCurrentUser } from 'app';
import { useAppointmentBooking } from '../utils/hooks/useAppointmentBooking';
import { linkOwnCustomerEntry } from '../utils/firestore';
import { saveAnonymousBookingCode } from '../utils/localStorageUtils';
import { bookWithoutAccount, isTaken, ticketPath } from '../utils/ticket-key';
import useTimeSlotStore from '../utils/timeSlotStore';
import type { CalendarTimeSlot } from '../utils/types';
import { hasFeature } from '../utils/plans';

// Import all hooks from index
import { 
  useSlotFinder, 
  useShopData,
  useServiceData,
  useStaffData,
  useBookingState
} from '../utils/hooks';

// Import extracted step components
import { ShopSelectionStep } from '../components/ShopSelectionStep';
import { QueueServiceStep } from '../components/QueueServiceStep';
import { QueueStaffStep } from '../components/QueueStaffStep';
import { QueueConfirmationStep } from '../components/QueueConfirmationStep';
import { BookingSuccessStep } from '../components/BookingSuccessStep';
import { StepIndicator } from '../components/StepIndicator';
import type { QueueContact, Wann } from '../components/QueueConfirmationStep';
import { Spinner } from '../components/queue/SlotStatus';
import { ConnectionProblem } from '../components/ConnectionProblem';
import { QueueStepShell } from '../components/queue/QueueStepShell';
import { Button } from '@/components/ui/button';
import { sprache, t } from '@/i18n';

/**
 * Consolidated Queue Join component
 * This component combines functionality from both JoinQueueRefactored and PublicJoinQueue
 * It allows users to join a queue by selecting shop, service, and staff
 * Supports both authenticated and anonymous bookings
 * 
 * This component orchestrates a step-by-step booking process:
 * 1. Select Shop - User selects the shop (or arrives with pre-selected shop via QR code)
 * 2. Select Service - User selects the service they want
 * 3. Select Staff - User selects a specific staff member or the next available one
 * 4. Wann? - Nächster freier Platz (Nummer) oder Wunschzeit (fester Termin), dann bestätigen
 * 5. Success - (Anonymous users only) Show booking reference code
 *
 * Ein Ablauf für Nummer und Termin: „Nummer ziehen“ (/public-join-queue) und „Termin buchen“ (/book-appointment,
 * oder ?wann=wunsch) kommen beide hierher. Die Wahl steht in der Adresse; Umschalten oben oder in Schritt 4 tauscht
 * nur die Adresse, der Ablauf bleibt, wo er ist.
 *
 * Key features:
 * - Works for both logged-in users and anonymous users
 * - Pre-selects shop from QR code links
 * - Pre-selects service and staff from URL parameters (shopId, serviceId, staffId – „Nochmal buchen“)
 * - Provides a booking reference for anonymous users
 * - Uses slot finding logic to find the next available appointment
 * - Encapsulates booking logic in a separate service
 */
const PublicJoinQueue = () => {
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const shopIdFromQR = searchParams.get('shopId');
  const serviceIdFromURL = searchParams.get('serviceId');
  const staffIdFromURL = searchParams.get('staffId');
  // Nummer oder Termin steht in der Adresse: so passen Menü, Überschrift und Neuladen immer zur Wahl
  const wann: Wann = /^\/book-?appointment\/?$/.test(pathname) || searchParams.get('wann') === 'wunsch' ? 'wunsch' : 'sofort';
  const setWann = (next: Wann) => {
    if (next === wann) return;
    const params = new URLSearchParams(searchParams);
    params.delete('wann');
    const search = params.toString();
    navigate({ pathname: next === 'wunsch' ? '/book-appointment' : '/public-join-queue', search: search ? `?${search}` : '' }, { replace: true });
  };
  const [wunschSlot, setWunschSlot] = useState<CalendarTimeSlot | null>(null);
  const [calendarKey, setCalendarKey] = useState(0);
  const { bookAppointment, loading: bookingTermin } = useAppointmentBooking();
  const [bookingAnonymous, setBookingAnonymous] = useState(false);
  
  // Authentication state - since this is a public page, user might be null if not logged in
  const { user, loading: authLoading } = useCurrentUser();
  
  // Use custom hooks for data management
  const { 
    shops, 
    selectedShop, 
    setSelectedShop, 
    loading, 
    loadError,
    unavailable,
    arrivedFromQR, 
    setArrivedFromQR 
  } = useShopData(shopIdFromQR);
  
  const { 
    loading: servicesLoading,
    services, 
    selectedService, 
    setSelectedService 
  } = useServiceData(selectedShop, serviceIdFromURL);
  
  const { 
    loading: staffLoading,
    staff, 
    selectedStaff, 
    useAnyStaff, 
    selectSpecificStaff, 
    selectAnyStaff 
  } = useStaffData(selectedShop);
  
  const { 
    currentStep, 
    setCurrentStep, 
    bookingSuccess, 
    bookingReference, 
    checkEarlierOptions, 
    setCheckEarlierOptions, 
    handleJoinQueue,
    bookedSlot,
    submitting
  } = useBookingState();
  const [contact, setContact] = useState<QueueContact>({ name: '', phone: '' });

  // Einstieg über Link/QR-Code nur EINMAL auswerten. Vorher lief dieser Effekt bei jeder
  // Änderung der Leistung erneut und warf Nutzer von Schritt 3 auf Schritt 2 zurück.
  const urlStepApplied = useRef(false);
  React.useEffect(() => {
    // Shop aus dem QR-Code gibt es nicht (mehr): Liste aller Shops zeigen
    if (shopIdFromQR && !loading && !loadError && !selectedShop) {
      setCurrentStep(1);
      urlStepApplied.current = true;
      return;
    }
    if (urlStepApplied.current) return;
    if (serviceIdFromURL && selectedService === serviceIdFromURL) {
      // „Nochmal buchen“ bringt auch die Person mit: dann gleich zu „Wann?“
      if (staffIdFromURL && staffLoading) return;
      const person = staffIdFromURL ? staff.find((s) => s.id === staffIdFromURL && s.isActive !== false) : undefined;
      if (person) selectSpecificStaff(person.id);
      setCurrentStep(person ? 4 : 3);
      urlStepApplied.current = true;
    } else if (shopIdFromQR && !serviceIdFromURL) {
      setCurrentStep(2);
      urlStepApplied.current = true;
    } else if (shopIdFromQR) {
      setCurrentStep(2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopIdFromQR, serviceIdFromURL, selectedService, setCurrentStep, loading, loadError, selectedShop, staffIdFromURL, staffLoading, staff]);

  // Andere Leistung oder Person: die gewählte Wunschzeit gilt nicht mehr
  React.useEffect(() => {
    setWunschSlot(null);
  }, [selectedShop, selectedService, selectedStaff, useAnyStaff]);

  // Bei jedem Schrittwechsel nach oben, sonst landet man auf dem Handy mitten im nächsten Schritt
  React.useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [currentStep, bookingSuccess]);

  // Bei "egal wer" nur Personen durchsuchen, die die Leistung anbieten (Fallback: alle)
  const serviceStaff = useMemo(() => {
    const offering = staff.filter((s) => s.serviceIds?.includes(selectedService));
    return offering.length > 0 ? offering : staff;
  }, [staff, selectedService]);

  // Suche startet schon bei der Personenauswahl (Schritt 3) für alle passenden Personen –
  // bis jemand gewählt hat, ist das Ergebnis meist schon da
  const {
    searchingForSlot,
    searchFailed,
    nextAvailableSlot,
    selectedStaffForSlot,
    earliestByStaff,
    refresh: refreshSlots,
    refreshIfOlderThan,
  } = useSlotFinder({
    shopId: selectedShop,
    serviceId: selectedService,
    staffId: selectedStaff,
    useAnyStaff,
    staffList: serviceStaff,
    shouldSearch: currentStep >= 3,
  });

  // Wer länger auf einem Schritt stand, bekommt beim Bestätigen einen frischen Platz
  React.useEffect(() => {
    if (currentStep === 4) refreshIfOlderThan(60 * 1000);
  }, [currentStep, refreshIfOlderThan]);

  // Wunschzeiten: bei der gewählten Person, bei „Egal wer“ bei allen, die die Leistung anbieten
  const calendarStaffIds = useMemo(() => serviceStaff.filter((s) => s.isActive !== false).map((s) => s.id), [serviceStaff]);

  /**
   * Fester Termin zur Wunschzeit, über das Backend: mit Konto (useAppointmentBooking), ohne Konto mit Schlüssel wie bei
   * der Nummer. Danach auf die Seite des Termins (/nummer/:id), wie nach dem Einreihen.
   */
  const bookWunschzeit = async () => {
    if (!wunschSlot) return;
    const staffChoices = useAnyStaff ? wunschSlot.staffOptions ?? calendarStaffIds : [selectedStaff];
    if (user) {
      const result = await bookAppointment(selectedShop, staffChoices, selectedService, wunschSlot, checkEarlierOptions);
      if ('appointmentId' in result) {
        // Kunden-Eintrag im Laden, mit dem Konto verbunden – sonst landen Termine aus "Mein Tag" nicht beim Konto
        void linkOwnCustomerEntry(selectedShop);
        navigate(ticketPath(result.appointmentId, null, '?neu=1'));
      } else if ('reason' in result && result.reason === 'slot-unavailable') {
        setWunschSlot(null);
        setCalendarKey((k) => k + 1);
      }
      return;
    }
    setBookingAnonymous(true);
    try {
      const { appointmentId, ticketKey } = await bookWithoutAccount({
        shopId: selectedShop,
        serviceId: selectedService,
        staffIds: staffChoices,
        start: wunschSlot.start,
        name: contact.name.trim(),
        phone: contact.phone.trim() || undefined,
        language: sprache(),
      });
      saveAnonymousBookingCode(selectedShop, appointmentId);
      useTimeSlotStore.getState().invalidateCache(selectedShop, wunschSlot.start);
      navigate(ticketPath(appointmentId, ticketKey, '?neu=1'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Der Termin konnte nicht gebucht werden. Versuch es noch einmal.'));
      if (isTaken(error)) {
        useTimeSlotStore.getState().invalidateCache(selectedShop, wunschSlot.start);
        setWunschSlot(null);
        setCalendarKey((k) => k + 1);
      }
    } finally {
      setBookingAnonymous(false);
    }
  };

  // Wunschzeit nur, wo der Tarif Online-Termine hat; sonst bleibt es bei der Nummer. Solange kein Laden gewählt
  // (oder noch nicht geladen) ist, steht beides offen.
  const shopData = shops.find((s) => s.id === selectedShop);
  const termineAllowed = hasFeature(shopData, 'termine');
  const termineMoeglich = !shopData || termineAllowed;
  const terminZeigen = wann === 'wunsch' && termineMoeglich;

  const processBooking = async () => {
    if (wann === 'wunsch' && termineAllowed) return bookWunschzeit();
    // Inzwischen vorbei (Seite stand offen)? Dann nicht einreihen, sondern neu suchen.
    if (nextAvailableSlot && nextAvailableSlot.start.getTime() <= Date.now()) {
      toast.error(t('Die Zeit ist schon vorbei. Wir suchen dir den nächsten Platz – bitte gleich noch mal bestätigen.'));
      refreshSlots();
      return;
    }
    // Ist der Platz beim Bestätigen schon weg, nimmt QueueBookingService gleich den nächsten: bei derselben
    // Person oder bei „Egal wer“ den der schnellsten (gleiche Personen wie die Suche oben)
    const staffChoices = useAnyStaff
      ? serviceStaff.filter((s) => s.isActive !== false).map((s) => s.id)
      : [selectedStaffForSlot];
    const result = await handleJoinQueue(
      selectedShop,
      selectedService,
      selectedStaffForSlot,
      nextAvailableSlot,
      user,
      contact,
      staffChoices
    );
    if (result && !result.success && isTaken(result.error)) refreshSlots();
  };

  /**
   * Render step content based on current step
   */
  const renderContent = () => {
    if (loadError) return <ConnectionProblem error={loadError} />;

    // Shop, Leistungen und Personen laden gleichzeitig; bis alles da ist, ein deutlicher Ladezustand
    // statt kurz "keine Leistungen" oder "niemand eingetragen"
    const stepNeedsShopData = currentStep >= 2 && currentStep <= 4;
    if (loading || (stepNeedsShopData && (servicesLoading || staffLoading))) {
      return (
        <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-3xl border border-border bg-card" role="status" aria-live="polite">
          <Spinner className="h-9 w-9 border-4" />
          <span className="font-semibold">
            {!shopIdFromQR && currentStep === 1 ? t('Einen Moment – wir holen die Läden …') : t('Einen Moment – wir holen die Leistungen …')}
          </span>
        </div>
      );
    }

    // Laden aus dem QR-Code gesperrt: nicht die (leere) Ladenauswahl zeigen, sondern warum es nicht geht
    if (unavailable) {
      return (
        <QueueStepShell
          title={t('Dieser Laden nimmt gerade keine Nummern an.')}
          description={t('Online geht im Moment weder Nummer ziehen noch Termin buchen.')}
        >
          <Button asChild className="self-start">
            <Link to="/shop-map">{t('Läden finden')}</Link>
          </Button>
        </QueueStepShell>
      );
    }

    // Successful anonymous booking
    if (currentStep === 5) {
      return (
        <BookingSuccessStep 
          bookingReference={bookingReference}
          shopId={selectedShop}
          slot={bookedSlot}
          shopName={shops.find(s => s.id === selectedShop)?.name}
          serviceName={services.find(s => s.id === selectedService)?.name}
          staffName={staff.find(s => s.id === selectedStaffForSlot)?.name}
        />
      );
    }

    // Shop selection step
    if (currentStep === 1) {
      return (
        <ShopSelectionStep 
          shops={shops}
          selectedShop={selectedShop}
          onSelectShop={(shopId) => {
            setSelectedShop(shopId);
            if (shopId !== shopIdFromQR) {
              setArrivedFromQR(false);
            }
            // Advance to next step on selection
            setCurrentStep(2);
          }}
        />
      );
    }
    
    // Service selection step
    if (currentStep === 2) {
      return (
        <QueueServiceStep 
          services={services}
          selectedService={selectedService}
          onSelectService={(serviceId) => {
            setSelectedService(serviceId);
            // Advance to next step on selection
            setCurrentStep(3);
          }}
          onBack={() => {
            if (arrivedFromQR) {
              // If arrived from QR, keep the shop but clear the service
              setSelectedService('');
            } else {
              // Otherwise go back to shop selection
              setCurrentStep(1);
            }
          }}
          arrivedFromQR={arrivedFromQR}
          shopName={shops.find(s => s.id === selectedShop)?.name}
        />
      );
    }
    
    // Staff selection step
    if (currentStep === 3) {
      return (
        <QueueStaffStep 
          staff={staff}
          selectedService={selectedService}
          selectedStaff={selectedStaff}
          onSelectStaff={(staffId) => {
            selectSpecificStaff(staffId);
            // Advance to next step on selection
            setCurrentStep(4);
          }}
          onSelectAny={() => {
            selectAnyStaff();
            // Advance to next step on selection
            setCurrentStep(4);
          }}
          useAnyStaff={useAnyStaff}
          onBack={() => setCurrentStep(2)}
          earliestByStaff={earliestByStaff}
          searching={searchingForSlot}
          anyTitle={terminZeigen ? t('Egal wer') : undefined}
        />
      );
    }
    
    // Confirmation step
    if (currentStep === 4) {
      return (
        <QueueConfirmationStep 
          selectedShop={selectedShop}
          selectedService={selectedService}
          useAnyStaff={useAnyStaff}
          selectedStaff={selectedStaff}
          nextAvailableSlot={nextAvailableSlot}
          selectedStaffForSlot={selectedStaffForSlot}
          searchingForSlot={searchingForSlot}
          searchFailed={searchFailed}
          onRetrySearch={refreshSlots}
          checkEarlierOptions={checkEarlierOptions}
          onCheckEarlierOptionsChange={(checked) => setCheckEarlierOptions(checked)}
          shops={shops}
          services={services}
          staff={staff}
          onBack={() => setCurrentStep(3)}
          onConfirm={processBooking}
          user={user}
          authLoading={authLoading}
          contact={contact}
          onContactChange={setContact}
          submitting={submitting || bookingTermin || bookingAnonymous}
          wann={wann}
          onWannChange={setWann}
          wunschSlot={wunschSlot}
          onWunschSlotChange={setWunschSlot}
          calendarStaffIds={calendarStaffIds}
          calendarKey={calendarKey}
          wunschEntry={wann === 'wunsch'}
        />
      );
    }

    return null;
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">
          {currentStep === 5 ? t('Du bist eingereiht.') : terminZeigen ? t('Termin buchen') : t('Nummer ziehen')}
        </h1>
        {currentStep !== 5 && (
          <p className="text-muted-foreground">
            {terminZeigen ? t('Such dir Tag und Uhrzeit selbst aus.') : t('Wir suchen dir den nächsten freien Platz.')}
            {/* Der andere Weg gleich hier, nicht erst im letzten Schritt */}
            {termineMoeglich && (
              <>
                {' '}
                {terminZeigen ? t('Lieber so früh wie möglich?') : t('Lieber eine feste Uhrzeit?')}{' '}
                <button
                  type="button"
                  onClick={() => setWann(terminZeigen ? 'sofort' : 'wunsch')}
                  className="font-semibold text-foreground underline underline-offset-4 hover:no-underline"
                >
                  {terminZeigen ? t('Nummer ziehen') : t('Termin buchen')}
                </button>
              </>
            )}
          </p>
        )}
      </div>

      {currentStep !== 5 && (
        <StepIndicator currentStep={currentStep} totalSteps={4} labels={[t('Laden'), t('Leistung'), t('Person'), t('Wann?')]} />
      )}

      {renderContent()}
    </div>
  );
};

export default PublicJoinQueue;
