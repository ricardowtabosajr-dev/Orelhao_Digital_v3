import Home from '@/components/Home';

export const metadata = { title: 'Orelhão Digital — Modo TV' };

// Modo TV (teste): o sistema se apresenta sozinho, em loop, para uma tela grande.
// Brasil → estado → região → pesquisa → orelhão localizado em 3D → volta. Só lê o banco.
export default function Tv() {
  return <Home regioes novidades tv />;
}
