import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCurrentUser } from 'app';
import { Navigation } from '../components/Navigation';
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
import { LoadingState } from '../components/LoadingState';

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
    handleJoinQueue 
  } = useBookingState();

  // Initialize step based on URL parameters
  React.useEffect(() => {
    if (shopIdFromQR) {
      setCurrentStep(2); // Skip to service selection
    }
    
    if (serviceIdFromURL && selectedService) {
      setCurrentStep(3); // Skip to staff selection
    }
  }, [shopIdFromQR, serviceIdFromURL, selectedService, setCurrentStep]);






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
    staffList: staff,
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
      user
    );
  };

  /**
   * Render step content based on current step
   */
  const renderContent = () => {
    if (loading) {
      return <LoadingState />;
    }

    // Successful anonymous booking
    if (currentStep === 5) {
      return (
        <BookingSuccessStep 
          bookingReference={bookingReference}
          shopId={selectedShop}
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
        />
      );
    }
    
    return null;
  };

  return (
    <>
      <Navigation />
      <div className="container mx-auto py-8 space-y-8">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">In Warteschlange einreihen</h1>
        </div>

        {/* Step indicator */}
        <StepIndicator currentStep={currentStep} totalSteps={4} />

        {renderContent()}
      </div>
    </>
  );
};

export default PublicJoinQueue;
