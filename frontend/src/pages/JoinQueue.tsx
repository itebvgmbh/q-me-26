// Complete refactored code with better organization, maintainability, and reusability
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCurrentUser } from 'app';
import { Navigation } from '../components/Navigation';
import { ShopCardSelector } from '../components/ShopCardSelector';
import { ServiceSelectorStep } from '../components/ServiceSelectorStep';
import { StaffSelectorStep } from '../components/StaffSelectorStep';
import { ConfirmationStep } from '../components/ConfirmationStep';
import { StepIndicator, LoadingState } from '../components/QueueUIComponents';
import { 
  useShops, 
  useServices, 
  useStaff, 
  useTimeSlot, 
  useQueueSubmission 
} from '../utils/hooks';

/**
 * JoinQueue page component for adding customers to a shop's queue
 * This component handles the multi-step process of booking an appointment:
 * 1. Shop selection
 * 2. Service selection
 * 3. Staff selection
 * 4. Appointment confirmation
 */
const JoinQueue = () => {
  // Query parameters and navigation
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shopIdFromQR = searchParams.get('shopId');
  const { user } = useCurrentUser();
  
  // Step state for the funnel approach - 1: shop, 2: service, 3: staff, 4: confirm
  const [currentStep, setCurrentStep] = useState<number>(shopIdFromQR ? 2 : 1);

  // Data management using custom hooks
  const { 
    shops, 
    selectedShop, 
    setSelectedShop, 
    loading: shopsLoading,
    arrivedFromQR, 
    setArrivedFromQR 
  } = useShops(shopIdFromQR);
  
  const { 
    services, 
    selectedService, 
    setSelectedService, 
    loading: servicesLoading 
  } = useServices(selectedShop);
  
  const { 
    staff, 
    selectedStaff, 
    setSelectedStaff, 
    selectedStaffForSlot,
    setSelectedStaffForSlot,
    useAnyStaff, 
    setUseAnyStaff,
    loading: staffLoading 
  } = useStaff(selectedShop);
  
  const { 
    nextAvailableSlot, 
    searchingForSlot, 
    checkEarlierOptions, 
    setCheckEarlierOptions 
  } = useTimeSlot(
    selectedShop,
    selectedService,
    selectedStaff,
    useAnyStaff,
    staff,
    currentStep
  );
  
  const { handleJoinQueue, submitting } = useQueueSubmission();

  // Helpers for step navigation
  const handleShopSelect = (shopId: string) => {
    setSelectedShop(shopId);
    if (shopId !== shopIdFromQR) {
      setArrivedFromQR(false);
    }
    setCurrentStep(2);
  };

  const handleServiceSelect = (serviceId: string) => {
    setSelectedService(serviceId);
    setCurrentStep(3);
  };

  const handleStaffSelect = (staffId: string) => {
    setSelectedStaff(staffId);
    setUseAnyStaff(false);
    setCurrentStep(4);
  };

  const handleSelectAnyStaff = () => {
    setUseAnyStaff(true);
    setSelectedStaff('');
    setCurrentStep(4);
  };

  const handleBack = (step: number) => {
    if (step === 2 && arrivedFromQR) {
      // If arrived from QR, keep the shop but clear the service
      setSelectedService('');
    } else {
      // Otherwise go back to previous step
      setCurrentStep(step);
    }
  };

  const handleSubmit = () => {
    if (!user) {
      return;
    }
    
    handleJoinQueue({
      user,
      selectedShop,
      selectedService,
      selectedStaffForSlot: selectedStaffForSlot || selectedStaff,
      nextAvailableSlot: nextAvailableSlot!,
      checkEarlierOptions
    });
  };

  // Loading indicator for the entire page
  const isLoading = shopsLoading || 
    (currentStep >= 2 && servicesLoading) || 
    (currentStep >= 3 && staffLoading);

  // Get selected entities for display
  const selectedShopEntity = shops.find(s => s.id === selectedShop);
  const selectedServiceEntity = services.find(s => s.id === selectedService);

  // Render component based on current step
  const renderContent = () => {
    if (isLoading) {
      return <LoadingState />;
    }

    switch (currentStep) {
      case 1: // Shop selection
        return (
          <Card>
            <CardHeader>
              <CardTitle>Shop auswählen</CardTitle>
              <CardDescription>Wählen Sie den Shop, in dem Sie bedient werden möchten</CardDescription>
            </CardHeader>
            <CardContent>
              <ShopCardSelector 
                shops={shops} 
                selectedShop={selectedShop} 
                onSelectShop={handleShopSelect} 
              />
            </CardContent>
            <CardFooter className="flex items-center justify-center">
              <p className="text-sm text-gray-500">Klicken Sie auf einen Shop, um fortzufahren</p>
            </CardFooter>
          </Card>
        );
      
      case 2: // Service selection
        return (
          <ServiceSelectorStep
            services={services}
            selectedService={selectedService}
            onSelectService={handleServiceSelect}
            onBack={() => handleBack(1)}
            arrivedFromQR={arrivedFromQR}
            shopName={selectedShopEntity?.name}
          />
        );
      
      case 3: // Staff selection
        return (
          <StaffSelectorStep
            staff={staff}
            selectedService={selectedService}
            selectedStaff={selectedStaff}
            useAnyStaff={useAnyStaff}
            onSelectStaff={handleStaffSelect}
            onSelectAny={handleSelectAnyStaff}
            onBack={() => handleBack(2)}
          />
        );
      
      case 4: // Confirmation
        return (
          <ConfirmationStep
            shop={selectedShopEntity}
            service={selectedServiceEntity}
            staff={staff}
            selectedStaff={selectedStaff}
            useAnyStaff={useAnyStaff}
            selectedStaffForSlot={selectedStaffForSlot}
            nextAvailableSlot={nextAvailableSlot}
            searchingForSlot={searchingForSlot}
            checkEarlierOptions={checkEarlierOptions}
            setCheckEarlierOptions={setCheckEarlierOptions}
            onBack={() => handleBack(3)}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        );
      
      default:
        return null;
    }
  };

  return (
    <>
      <Navigation />
      <div className="container mx-auto py-8 space-y-8">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">In Warteschlange einreihen</h1>
        </div>

        <StepIndicator currentStep={currentStep} />

        {renderContent()}
      </div>
    </>
  );
};

export default JoinQueue;