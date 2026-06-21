'use client';

import { ThemeProvider } from './ThemeProvider';
import { ToastProvider } from './ToastProvider';
import { ConfirmProvider } from './ConfirmProvider';
import { AuthProvider } from './AuthProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>{children}</AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
