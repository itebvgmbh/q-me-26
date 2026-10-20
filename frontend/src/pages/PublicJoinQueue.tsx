import React, { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useCurrentUser } from 'app';
import { isSlotConflict } from '../utils/booking-rules';

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
import type { QueueContact } from '../components/QueueConfirmationStep';
import { Spinner } from '../components/queue/SlotStatus';
import { ConnectionProblem } from '../components/ConnectionProblem';

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
 * 4. Confirmation - Review and confirm the booking details
 * 5. Success - (Anonymous users only) Show booking reference code
 *
 * Key features:
 * - Works for both logged-in users and anonymous users
 * - Pre-selects shop from QR code links
 * - Pre-selects service from URL parameters
 * - Provides a booking reference for anonymous users
 * - Uses slot finding logic to find the next available appointment
 * - Encapsulates booking logic in a separate service
 */
const PublicJoinQueue = () => {
  const [searchParams] = useSearchParams();
  const shopIdFromQR = searchParams.get('shopId');
  const serviceIdFromURL = searchParams.get('serviceId');
  
  // Authentication state - since this is a public page, user might be null if not logged in
  const { user, loading: authLoading } = useCurrentUser();
  
  // Use custom hooks for data management
  const { 
    shops, 
    selectedShop, 
    setSelectedShop, 
    loading, 
    loadError,
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
      setCurrentStep(3);
      urlStepApplied.current = true;
    } else if (shopIdFromQR && !serviceIdFromURL) {
      setCurrentStep(2);
      urlStepApplied.current = true;
    } else if (shopIdFromQR) {
      setCurrentStep(2);
    }
  }, [shopIdFromQR, serviceIdFromURL, selectedService, setCurrentStep, loading, loadError, selectedShop]);

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

  const processBooking = async () => {
    // Inzwischen vorbei (Seite stand offen)? Dann nicht einreihen, sondern neu suchen.
    if (nextAvailableSlot && nextAvailableSlot.start.getTime() <= Date.now()) {
      toast.error('Die Zeit ist schon vorbei. Wir suchen dir den nächsten Platz – bitte gleich noch mal bestätigen.');
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
    if (result && !result.success && isSlotConflict(result.error)) refreshSlots();
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
          <span className="font-semibold">Einen Moment – wir holen {!shopIdFromQR && currentStep === 1 ? 'die Läden' : 'die Leistungen'} …</span>
        </div>
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
          submitting={submitting}
        />
      );
    }
    
    return null;
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">
          {currentStep === 5 ? 'Du bist eingereiht.' : 'Nummer ziehen'}
        </h1>
        {currentStep !== 5 && (
          <p className="text-muted-foreground">Wir suchen dir den nächsten freien Platz. Fester Wunschtermin? <a href="/book-appointment?fromMarketplace=true" className="font-semibold text-foreground underline">Termin buchen</a></p>
        )}
      </div>

      {currentStep !== 5 && (
        <StepIndicator currentStep={currentStep} totalSteps={4} labels={['Laden', 'Leistung', 'Person', 'Bestätigen']} />
      )}

      {renderContent()}
    </div>
  );
};

export default PublicJoinQueue;
