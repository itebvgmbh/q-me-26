import { collection, doc, getDoc, getDocs, query, where, Timestamp, setDoc, limit } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { Customer } from './types';

/** So lange gilt der Link, mit dem eine angelegte Person ihr Konto verbindet (Seite /activate) */
const ACTIVATION_DAYS = 30;

/** Neuer Link: 128 Bit Zufall, nicht zu erraten. Prüfen und Verbinden: backend/app/apis/customer_activation */
const newActivation = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return {
    activationToken: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''),
    activationExpires: Timestamp.fromDate(new Date(Date.now() + ACTIVATION_DAYS * 24 * 60 * 60 * 1000)),
  };
};

/** Link zum Verbinden des Kontos, z. B. https://dranzeit.de/activate?token=… */
export const activationLink = (customer: Customer, base: string) => `${base}/activate?token=${encodeURIComponent(customer.activationToken || '')}`;

/** Noch nicht verbunden und Link abgelaufen (oder nie erzeugt): Dann braucht es einen neuen */
export const activationExpired = (customer: Customer) =>
  !customer.userId && (!customer.activationToken || !customer.activationExpires || customer.activationExpires.toMillis() < Date.now());

/** Neuen Link für eine noch nicht verbundene Person erzeugen (der alte gilt dann nicht mehr) */
export const renewActivation = async (customer: Customer): Promise<Customer> => {
  const db = getFirestore(firebaseApp);
  const update = { ...newActivation(), updatedAt: Timestamp.now() };
  await setDoc(doc(db, 'customers', customer.id), update, { merge: true });
  return { ...customer, ...update };
};

/**
 * customerId für einen Termin dieser Person. Hat sie ihr Konto verbunden, gehört der Termin dem Konto –
 * dann steht er unter "Meine Termine", und "Früher dran" kann sie erreichen. Sonst die ID des Eintrags.
 */
export const appointmentCustomerId = (customer: Customer) => customer.userId || customer.id;

// Filter customers to ensure unique entries by ID and email
export const getUniqueCustomers = (customers: Customer[]): Customer[] => {
  // First, create a map to deduplicate by ID
  const idMap = new Map<string, Customer>();
  const emailMap = new Map<string, Customer>();
  const result: Customer[] = [];
  
  // First pass: Deduplicate by ID
  customers.forEach(customer => {
    if (!idMap.has(customer.id)) {
      idMap.set(customer.id, customer);
    }
  });
  
  // Convert to array of unique ID customers
  const uniqueByIdCustomers = Array.from(idMap.values());
  
  // Second pass: Deduplicate by email if it exists
  uniqueByIdCustomers.forEach(customer => {
    if (customer.email) {
      if (!emailMap.has(customer.email)) {
        emailMap.set(customer.email, customer);
        result.push(customer);
      }
    } else {
      // If no email, just add to result
      result.push(customer);
    }
  });
  
  console.log('Original customers count:', customers.length);
  console.log('Unique customers count:', result.length);
  
  return result;
};

export const getCustomersByShopId = async (shopId: string): Promise<Customer[]> => {
  console.log('Getting customers for shop:', shopId);
  try {
    const db = getFirestore(firebaseApp);
    const customersRef = collection(db, 'customers');
    const q = query(customersRef, where('shopId', '==', shopId));
    const querySnapshot = await getDocs(q);
    const customers = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Customer[];
    console.log('Found customers:', customers);
    // Return deduplicated customers
    return getUniqueCustomers(customers);
  } catch (error) {
    console.error('Error getting customers:', error);
    return [];
  }
};

/** Alle Einträge eines Ladens, auch doppelte – für die Kundenliste, aus der man löschen kann */
export const getCustomerEntries = async (shopId: string): Promise<Customer[]> => {
  const db = getFirestore(firebaseApp);
  const snapshot = await getDocs(query(collection(db, 'customers'), where('shopId', '==', shopId)));
  return snapshot.docs.map((d) => ({ ...d.data(), id: d.id }) as Customer).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
};

/**
 * Sucht nach einem Kunden anhand von Email und ShopId
 * @param email Email des Kunden
 * @param shopId ID des Shops
 * @returns Customer Objekt oder null, wenn nicht gefunden
 */
export const findCustomerByEmailAndShop = async (email: string, shopId: string): Promise<Customer | null> => {
  if (!email || !shopId) {
    console.log('Cannot find customer without email and shopId');
    return null;
  }
  
  try {
    const db = getFirestore(firebaseApp);
    const customersRef = collection(db, 'customers');
    const q = query(
      customersRef, 
      where('email', '==', email),
      where('shopId', '==', shopId),
      limit(1)
    );
    
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      console.log(`No customer found with email ${email} for shop ${shopId}`);
      return null;
    }
    
    const customerDoc = querySnapshot.docs[0];
    console.log(`Found existing customer with ID: ${customerDoc.id}`);
    return {
      id: customerDoc.id,
      ...customerDoc.data()
    } as Customer;
  } catch (error) {
    console.error('Error finding customer:', error);
    return null;
  }
};

/**
 * Erstellt einen neuen Kunden oder gibt den existierenden Kunden zurück,
 * wenn bereits ein Kunde mit dieser Email für den Shop existiert
 * @param data Kundendaten
 * @returns Erstellter oder existierender Kunde
 */
export const createCustomer = async (data: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'activationToken' | 'activationExpires' | 'isActive'>): Promise<Customer> => {
  console.log('Creating customer with data:', data);
  try {
    // Prüfe zuerst, ob bereits ein Kunde mit dieser Email für diesen Shop existiert
    if (data.email) {
      const existingCustomer = await findCustomerByEmailAndShop(data.email, data.shopId);
      if (existingCustomer) {
        console.log('Customer already exists, returning existing customer:', existingCustomer);
        return existingCustomer;
      }
    }
    
    // Wenn kein Kunde gefunden wurde, erstelle einen neuen
    const db = getFirestore(firebaseApp);
    const customerRef = doc(collection(db, 'customers'));

    const now = Timestamp.now();
    const customerData = {
      id: customerRef.id,
      ...data,
      ...newActivation(),
      isActive: false,
      createdAt: now,
      updatedAt: now,
    };
    
    await setDoc(customerRef, customerData);
    console.log('Customer created successfully:', customerData);
    return customerData;
  } catch (error) {
    console.error('Error creating customer:', error);
    throw error;
  }
};