import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Shop } from '../utils/firestore/types';

export interface ShopSelectionStepProps {
  shops: Shop[];
  selectedShop: string;
  onSelectShop: (shopId: string) => void;
}

/**
 * Component for selecting a shop in the queue process
 * Displays a list of available shops for the user to select
 */
export const ShopSelectionStep: React.FC<ShopSelectionStepProps> = ({
  shops,
  selectedShop,
  onSelectShop,
}) => {
  if (shops.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-center text-gray-500">Keine Shops verfügbar</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shop auswählen</CardTitle>
        <CardDescription>Wählen Sie den Shop, in dem Sie bedient werden möchten</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {shops.map(shop => (
            <Card 
              key={shop.id}
              className={`cursor-pointer transition-all hover:scale-105 ${selectedShop === shop.id ? 'border-2 border-blue-500 bg-blue-50' : 'border border-gray-200'}`}
              onClick={() => onSelectShop(shop.id)}
            >
              <CardContent className="p-4 flex items-center">
                <div className="mr-4 bg-blue-100 rounded-full p-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-medium">{shop.name}</h3>
                  <p className="text-sm text-gray-500">{shop.address}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-center">
        <p className="text-sm text-gray-500">Klicken Sie auf einen Shop, um fortzufahren</p>
      </CardFooter>
    </Card>
  );
};
