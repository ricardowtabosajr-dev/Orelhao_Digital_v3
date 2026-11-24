// Manifesto do app (PWA): permite instalar o Orelhão Digital no celular, tablet ou computador.
export default function manifest() {
  return {
    name: 'Orelhão Digital — Mapa dos TUPs do Brasil',
    short_name: 'Orelhão Digital',
    description: 'Mapa interativo dos orelhões (TUPs) do Brasil · Método',
    lang: 'pt-BR',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#070b18',
    theme_color: '#1b5f61',
    icons: [
      { src: '/app/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app/icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
