import Telefone from '@/components/Telefone';

export const metadata = { title: 'Seu orelhão agora é digital' };
export const dynamic = 'force-dynamic';

// Discador por QR Code (/telefone?token=…). Página isolada: não faz parte do sistema principal.
export default function PaginaTelefone() {
  return <Telefone />;
}
