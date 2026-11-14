import Home from '@/components/Home';

// Página de teste: igual à principal + o que estiver em `novidades` (ainda não aprovado).
// Ao aprovar, o ajuste deixa de depender de `novidades` e passa a valer na principal também.
export default function Teste() {
  return <Home regioes novidades />;
}
