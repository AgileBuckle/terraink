import { AppProviders } from "@/core/AppProviders";
import AppShell from "@/shared/ui/AppShell";

export default function App() {
  return (
    <AppProviders>
      <AppShell />
    </AppProviders>
  );
}
