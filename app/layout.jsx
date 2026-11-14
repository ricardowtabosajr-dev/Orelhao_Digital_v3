import { Outfit, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata = {
  title: 'Orelhão Digital — Mapa dos TUPs do Brasil',
  description: 'Mapa interativo com a localização de mais de 6 mil orelhões (TUPs) distribuídos por 25 estados e 1.917 municípios brasileiros.',
};

export const viewport = { themeColor: '#070b18' };

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" className={`${outfit.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
