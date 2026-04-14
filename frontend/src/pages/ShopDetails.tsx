/**
 * ShopDetails Page
 * 
 * Displays detailed information about a shop, including:
 * - Shop information (name, logo, address, contact details)
 * - Business hours
 * - Services offered
 * - Staff/team members
 */
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Navigation } from '../components/Navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft } from 'lucide-react';
import { ShopHeader } from '../components/ShopHeader';
import { StaffList } from '../components/StaffList';
import { useShopDetails } from '../utils/hooks/useShopDetails';

const ShopDetails = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const shopId = searchParams.get('shopId');
  
  // Use custom hook to handle data fetching
  const { shop, services, staff, loading } = useShopDetails(shopId);

  /**
   * Navigate to booking page when user clicks "Book Appointment"
   */
  const handleBookAppointment = () => {
    if (shopId) {
      navigate(`/book-appointment?shopId=${shopId}&fromMarketplace=true`);
    }
  };

  // Loading state
  if (loading) {
    return (
      <>
        <Navigation />
        <div className="container mx-auto py-8">
          <p>Lädt...</p>
        </div>
      </>
    );
  }

  // Error state
  if (!shop) {
    return (
      <>
        <Navigation />
        <div className="container mx-auto py-8">
          <p>Shop nicht gefunden</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <div className="container mx-auto py-8 space-y-8">
        {/* Page header with back button */}
        <div className="flex items-center space-x-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Shop-Details</h1>
        </div>

        {/* Main content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left column - Shop info and services */}
          <div className="lg:col-span-2 space-y-6">
            {/* Shop header information */}
            <ShopHeader 
              shop={shop} 
              onBookAppointment={handleBookAppointment} 
            />

            {/* Custom shop services component */}
            <ServiceDisplayShopDetails 
              services={services} 
              shopId={shopId || ''} 
            />
          </div>

          {/* Right column - Staff/team overview */}
          <div>
            <StaffList staff={staff} services={services} />
          </div>
        </div>
      </div>
    </>
  );
};

/**
 * Custom services display for shop details page
 * This adapts the existing services to the specific layout needed for this page
 */
interface ServiceDisplayProps {
  services: any[];
  shopId: string;
}

const ServiceDisplayShopDetails = ({ services, shopId }: ServiceDisplayProps) => {
  const navigate = useNavigate();
  
  return (
    <Card>
      <CardContent className="pt-6">
        <h3 className="text-lg font-semibold mb-4">Angebotene Leistungen</h3>
        {services.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {services.map(service => (
              <div key={service.id} className="flex flex-col">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-lg font-medium">{service.name}</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{service.duration} Min.</span>
                    <span className="font-medium">{service.price.toFixed(2)} €</span>
                  </div>
                </div>
                {service.description && (
                  <p className="text-sm text-muted-foreground mb-3">{service.description}</p>
                )}
                <Button 
                  size="sm"
                  className="self-start"
                  onClick={() => navigate(`/service-booking?shopId=${shopId}&serviceId=${service.id}`)}
                >
                  Diesen Service buchen
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Keine Leistungen verfügbar</p>
        )}
      </CardContent>
    </Card>
  );
};

export default ShopDetails;