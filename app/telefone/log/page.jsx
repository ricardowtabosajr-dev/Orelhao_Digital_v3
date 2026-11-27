import TelefoneLog from '@/components/TelefoneLog';

export const metadata = { title: 'Log do discador', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// Consulta da caixa-preta do discador (/telefone/log), protegida pela senha do log.
export default function PaginaLogTelefone() {
  return <TelefoneLog />;
}
