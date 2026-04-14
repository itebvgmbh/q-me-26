import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, Clock, Scissors } from 'lucide-react';
import { Shop, Service } from '../utils/firestore/types';

export interface ShopCardProps {
  shop: Shop;
  services?: Service[];
}

export const ShopCard: React.FC<ShopCardProps> = ({ shop, services = [] }) => {
  const navigate = useNavigate();

  const handleBookAppointment = () => {
    navigate(`/book-appointment?shopId=${shop.id}&fromMarketplace=true`);
  };
  
  return (
    <Card className="h-full flex flex-col hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg cursor-pointer hover:text-primary transition-colors" onClick={() => navigate(`/shop-details?shopId=${shop.id}`)}>
            {shop.name}
          </CardTitle>
        <CardDescription className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          <span>
            {shop.street || shop.city || shop.postalCode ? (
              // Wenn neue Adressfelder vorhanden sind, zeige diese
              [shop.street, shop.postalCode, shop.city].filter(Boolean).join(', ')
            ) : (
              // Ansonsten zeige Legacy-Adresse oder Standardtext
              shop.address || 'Keine Adresse angegeben'
            )}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-grow">
        {shop.description && (
          <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
            {shop.description}
          </p>
        )}
        {services && services.length > 0 && (
          <div className="mt-2">
            <p className="text-sm font-medium mb-1 flex items-center gap-1">
              <Scissors className="h-3 w-3" /> Angebotene Leistungen:
            </p>
            <div className="flex flex-wrap gap-1 mt-1">
              {services.slice(0, 3).map((service) => (
                <Badge 
                  key={service.id} 
                  variant="outline" 
                  className="text-xs cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                  onClick={() => navigate(`/public-join-queue?shopId=${shop.id}&serviceId=${service.id}`)}
                >
                  {service.name}
                </Badge>
              ))}
              {services.length > 3 && (
                <Badge variant="outline" className="text-xs">+{services.length - 3} weitere</Badge>
              )}
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-2 flex gap-2">
        <Button variant="outline" onClick={() => navigate(`/shop-details?shopId=${shop.id}`)} className="flex-grow">
          Details
        </Button>
        <Button onClick={handleBookAppointment} className="flex-grow">
          Termin buchen
        </Button>
      </CardFooter>
    </Card>
  );
};
