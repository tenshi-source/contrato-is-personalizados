# Gerador de contratos I&S Personalizados

Site estático para preencher o molde do contrato, calcular as condições de pagamento e gerar uma cópia em PDF no navegador. Os dados digitados não são enviados a um servidor nem armazenados pelo site. As bibliotecas de PDF são servidas junto com o site; não há dependência de CDN.

## Usar localmente

Abra esta pasta em um servidor estático local (por exemplo, a extensão Live Server do VS Code). O PDF é carregado por `fetch`, então não abra `index.html` diretamente com `file://`.

## Publicar no GitHub Pages

1. Envie os arquivos desta pasta para um repositório GitHub.
2. Em **Settings → Pages**, escolha **Deploy from a branch**.
3. Selecione a branch principal e a pasta `/ (root)`.
4. Abra a URL publicada. O site edita e exibe o documento localmente no navegador.

O arquivo `assets/contrato-base.pdf` é o modelo do contrato com os dados do cliente removidos. Revise o documento e as condições antes de coletar assinaturas.

## Licenças de bibliotecas

- `pdf-lib` 1.17.1: licença MIT em `assets/LICENSE-PDFLIB.txt`.
- `pdf.js` 3.11.174: licença Apache 2.0 em `assets/LICENSE-PDFJS.txt`.
