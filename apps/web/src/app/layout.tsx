import type { Metadata } from 'next';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { ApolloWrapper } from '@/libs/apollo';
import './globals.css';

// next/font/google was removed in favor of the system stack defined in
// globals.css (--font-sans / --font-mono). The Google fetch broke
// production builds in network-restricted environments. The CSS
// fallback chain (Inter / SF Pro Text / system-ui ...) gives a clean
// look across platforms with zero build-time network dependency.

export const metadata: Metadata = {
  title: 'Codewright',
  description: 'AI-powered execution system for software engineering',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <ApolloWrapper>{children}</ApolloWrapper>
          <Toaster position="top-center" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
