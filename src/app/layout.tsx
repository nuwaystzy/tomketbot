import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tomket Admin',
  description: 'Internal workspace untuk review dan recap garapan.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
