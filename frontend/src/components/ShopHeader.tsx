import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { MapPin, Phone, Mail, Info } from 'lucide-react';
import { Shop } from '../utils/firestore';
import { BusinessHours } from './BusinessHours';

interface Props {
  shop: Shop;
  onBookAppointment: () => void;
}

/**
 * Displays shop header information including logo, name, address,
 * contact information, and description
 */
export const ShopHeader = ({ shop, onBookAppointment }: Props) => {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div className="flex-grow">
            <CardTitle className="text-2xl">{shop.name}</CardTitle>
            {shop.address && (
              <div className="space-y-1">
                <CardDescription className="flex items-center gap-1 mt-1">
                  <MapPin className="h-4 w-4" />
                  <span>{shop.address}</span>
                </CardDescription>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-1 text-xs flex items-center gap-1"
                  onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(shop.address)}`, '_blank')}
                >
                  <MapPin className="h-3 w-3" /> Route planen
                </Button>
              </div>
            )}
          </div>
          {shop.logoUrl && (
            <div className="flex-shrink-0">
              <Avatar className="h-20 w-20">
                <img src={shop.logoUrl} alt={`${shop.name} Logo`} />
              </Avatar>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Shop description */}
        {shop.description && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium flex items-center gap-1">
              <Info className="h-4 w-4" /> Beschreibung
            </h3>
            <p className="text-sm text-muted-foreground">{shop.description}</p>
          </div>
        )}

        {/* Contact information */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {shop.phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{shop.phone}</span>
            </div>
          )}
          {shop.email && (
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span>{shop.email}</span>
            </div>
          )}
        </div>

        {/* Opening hours */}
        {shop.businessHoursByDay && shop.businessHoursByDay.length > 0 && (
          <BusinessHours businessHours={shop.businessHoursByDay} />
        )}

        {/* Booking button */}
        <div className="pt-4">
          <Button 
            onClick={onBookAppointment} 
            className="w-full md:w-auto"
          >
            Termin buchen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
