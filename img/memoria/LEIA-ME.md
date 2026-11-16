# Fotografias do carrossel (tela de carregamento)

Esta pasta guarda as imagens do carrossel 3D da tela de carregamento da carta.

## Estado atual

As 12 imagens são **ilustrações SVG geradas localmente** pelo Projeto Amor.
Elas existem apenas para que o carrossel funcione sem depender da internet e
sem falhar silenciosamente. **Não são fotografias reais de ninguém** — foram
criadas para ter a mesma atmosfera (entardecer, céu estrelado, flores, chuva,
café, etc.) sem inventar imagens pessoais de um casal.

## Como substituir por fotos reais

1. Coloque seus arquivos nesta pasta (`.jpg`, `.webp` ou `.png`).
   Nomes sugeridos, para manter a ordem alfabética do carrossel:

   ```
   01-entardecer.jpg
   02-ceu-estrelado.jpg
   03-duas-luas.jpg
   04-campo-de-flores.jpg
   05-chuva-na-janela.jpg
   06-cafe-quente.jpg
   07-praia-amora.jpg
   08-bosque-nebuloso.jpg
   09-flor-de-lotus.jpg
   10-passaros.jpg
   11-coracao-de-luz.jpg
   12-noite-natal.jpg
   ```

2. Abra `carta.html` e atualize a lista em `#loading-carousel`, trocando
   o `src` e o `alt` de cada item. Nada mais precisa mudar.

## Observações

- Proporção recomendada: **4:3** ou **3:2** (o CSS recorta com
  `object-fit: cover`).
- Se uma imagem falhar ao carregar, o item continua no carrossel com um
  gradiente escuro no lugar — o giro não é interrompido.
- O número de itens não é fixo: basta adicionar ou remover `<figure>`.