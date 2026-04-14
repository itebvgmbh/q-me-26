import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserGuardContext } from 'app';
import { getShopByOwner, ShopProfile as ShopProfileType } from '../utils/firestore';
import { EditShopForm } from '../components/EditShopForm';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Navigation } from '../components/Navigation';
import { getIndustryNameById } from '../utils/industries';
import { Store } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { QRCodeGenerator } from '../components/QRCodeGenerator';

const ShopProfile = () => {
  const { user } = useUserGuardContext();
  const navigate = useNavigate();
  const [shop, setShop] = useState<ShopProfileType | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEditDialog, setShowEditDialog] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const loadShop = async () => {
      try {
        const shopData = await getShopByOwner(user.uid);
        setShop(shopData);
      } catch (error) {
        console.error('Error loading shop:', error);
      } finally {
        setLoading(false);
      }
    };

    loadShop();
  }, [user]);

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="container mx-auto py-8">
          <div className="text-center">Laden...</div>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <Navigation />
        <div className="container mx-auto py-8">
          <div className="text-center">
            <p className="mb-4">Bitte melden Sie sich an.</p>
            <Button onClick={() => navigate('/login')}>Zum Login</Button>
          </div>
        </div>
      </>
    );
  }

  if (!shop) {
    return (
      <>
        <Navigation />
        <div className="container mx-auto py-8">
          <div className="text-center">
            <p className="mb-4">Sie haben noch keinen Shop erstellt.</p>
            <Button onClick={() => navigate('/shop-dashboard')}>Shop erstellen</Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <div className="container mx-auto py-8">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center space-x-4">
            {shop.logoUrl ? (
              <div className="w-16 h-16 rounded-md overflow-hidden border border-gray-200 flex-shrink-0">
                <img 
                  src={shop.logoUrl} 
                  alt={`${shop.name} Logo`} 
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0">
                <Store className="w-8 h-8 text-gray-400" />
              </div>
            )}
            <h1 className="text-2xl font-bold">{shop.name}</h1>
          </div>
          <Button
            variant="outline"
            onClick={() => setShowEditDialog(true)}
          >
            Shop-Profil bearbeiten
          </Button>
        </div>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="info">Shop-Info</TabsTrigger>
            <TabsTrigger value="qrcode">QR-Code</TabsTrigger>
          </TabsList>
          
          <TabsContent value="info" className="mt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold mb-2">Kontakt</h2>
                  <p>{shop.address}</p>
                  <p>{shop.phone}</p>
                  <p>{shop.email}</p>
                </div>
                
                {shop.industry && (
                  <div>
                    <h2 className="text-lg font-semibold mb-2">Branche</h2>
                    <p>{getIndustryNameById(shop.industry)}</p>
                  </div>
                )}

                {shop.businessHours && (
                  <div>
                    <h2 className="text-lg font-semibold mb-2">Öffnungszeiten</h2>
                    <p>{shop.businessHours}</p>
                  </div>
                )}

                {shop.description && (
                  <div>
                    <h2 className="text-lg font-semibold mb-2">Beschreibung</h2>
                    <p>{shop.description}</p>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="qrcode" className="mt-0">
            <QRCodeGenerator shopId={shop.id} shopName={shop.name} />
          </TabsContent>
        </Tabs>

        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="sm:max-w-xl p-6 max-h-[90vh] overflow-y-auto">
            <DialogHeader className="mb-4">
              <DialogTitle>Shop-Profil bearbeiten</DialogTitle>
              <DialogDescription>
                Bearbeiten Sie die Details Ihres Shops.
              </DialogDescription>
            </DialogHeader>
            
            <EditShopForm
              shop={shop}
              onUpdate={(updatedShop) => {
                setShop(updatedShop);
                setShowEditDialog(false);
              }}
              onCancel={() => setShowEditDialog(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};

export default ShopProfile;
