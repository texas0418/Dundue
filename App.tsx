import { useEffect, useState } from 'react';
import HomeScreen from './src/screens/HomeScreen';
import InvoiceScreen from './src/screens/InvoiceScreen';
import ClientsScreen from './src/screens/ClientsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { SettingsProvider } from './src/SettingsContext';
import { initPurchases } from './src/proAccess';

type Screen =
  | { name: 'home' }
  | { name: 'invoice'; invoiceId: number | null }
  | { name: 'clients' }
  | { name: 'settings' };

function Root() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  if (screen.name === 'invoice')
    return (
      <InvoiceScreen
        invoiceId={screen.invoiceId}
        onBack={() => setScreen({ name: 'home' })}
      />
    );
  if (screen.name === 'clients')
    return <ClientsScreen onBack={() => setScreen({ name: 'home' })} />;
  if (screen.name === 'settings')
    return <SettingsScreen onBack={() => setScreen({ name: 'home' })} />;
  return (
    <HomeScreen
      onOpenInvoice={(invoiceId) => setScreen({ name: 'invoice', invoiceId })}
      onNewInvoice={() => setScreen({ name: 'invoice', invoiceId: null })}
      onClients={() => setScreen({ name: 'clients' })}
      onSettings={() => setScreen({ name: 'settings' })}
    />
  );
}

export default function App() {
  useEffect(() => {
    // Fail-open: unlocks Pro immediately in Expo Go / placeholder builds.
    initPurchases();
  }, []);
  return (
    <SettingsProvider>
      <Root />
    </SettingsProvider>
  );
}
