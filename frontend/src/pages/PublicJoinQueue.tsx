import React, { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCurrentUser } from 'app';
import { TimeSlot } from '../utils/types';

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
    arrivedFromQR, 
    setArrivedFromQR 
  } = useShopData(shopIdFromQR);
  
  const { 
    services, 
    selectedService, 
    setSelectedService 
  } = useServiceData(selectedShop, serviceIdFromURL);
  
  const { 
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
  }, [shopIdFromQR, serviceIdFromURL, selectedService, setCurrentStep]);

  // Bei jedem Schrittwechsel nach oben, sonst landet man auf dem Handy mitten im nächsten Schritt
  React.useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [currentStep, bookingSuccess]);

  // Bei "egal wer" nur Personen durchsuchen, die die Leistung anbieten (Fallback: alle)
  const serviceStaff = useMemo(() => {
    const offering = staff.filter((s) => s.serviceIds?.includes(selectedService));
    return offering.length > 0 ? offering : staff;
  }, [staff, selectedService]);

  // Use the custom hook for slot finding
  const { 
    searchingForSlot,
    nextAvailableSlot,
    selectedStaffForSlot 
  } = useSlotFinder({
    shopId: selectedShop,
    serviceId: selectedService,
    staffId: selectedStaff,
    useAnyStaff,
    staffList: serviceStaff,
    isAuthenticated: !!user,
    shouldSearch: currentStep >= 3 // Only search when at staff selection or confirmation step
  });

  /**
   * Wrapper around the handleJoinQueue from useBookingState
   * to provide the current context values
   */
  const processBooking = () => {
    handleJoinQueue(
      selectedShop,
      selectedService,
      selectedStaffForSlot,
      nextAvailableSlot,
      user,
      contact
    );
  };

  /**
   * Render step content based on current step
   */
  const renderContent = () => {
    if (loading) {
      return <div className="h-64 animate-pulse rounded-3xl bg-muted" aria-busy="true" aria-label="Wird geladen" />;
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
        <StepIndicator currentStep={currentStep} totalSteps={4} labels={['Shop', 'Leistung', 'Person', 'Bestätigen']} />
      )}

      {renderContent()}
    </div>
  );
};

export default PublicJoinQueue;
