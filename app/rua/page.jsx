import { Suspense } from 'react';
import Rua from '@/components/Rua';

export const metadata = { title: 'Street View — Orelhão Digital' };

// Aba do Street View: aberta pelo botão "Ver na rua" do mapa (precisa da chave da API do Google Maps)
export default function PaginaRua() {
  return <Suspense fallback={null}><Rua /></Suspense>;
}
